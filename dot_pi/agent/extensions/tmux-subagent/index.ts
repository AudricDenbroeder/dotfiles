/**
 * tmux-subagent extension — task 02: spawn sub-agent tool.
 *
 * Registers `tmux_agent` with a `StringEnum` action param. Only `spawn`
 * is implemented here; the other actions return "not implemented yet".
 */
import * as fs from "node:fs/promises";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	checkTmuxAvailable,
	splitWindow,
    killPane,
	sendKeys,
	sendKey,
	setPaneTitle,
	paneExists,
} from "./tmux.js";
import {
	Registry,
	type SubagentHandle,
	getMailboxDir,
	setupMailbox,
	cleanupMailbox,
} from "./registry.js";
import { writeMailboxPrompt } from "./prompt.js";
import { waitForFile } from "./polling.js";

const registry = new Registry();

/**
 * Resolves the correct command to launch `pi` from the current process.
 * Copied/adapted from `examples/extensions/subagent/index.ts`.
 */
function getPiInvocation(extraArgs: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && require("node:fs").existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...extraArgs] };
	}
	const execName = require("node:path").basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args: extraArgs };
	}
	return { command: "pi", args: extraArgs };
}

const TmuxAgentParams = Type.Object({
	action: StringEnum(["spawn", "send", "read", "list", "kill"] as const, {
		description: "Action to perform: spawn | send | read | list | kill",
		default: "spawn",
	}),
	name: Type.Optional(
		Type.String({
			description: "Handle/name for the sub-agent pane (required for spawn, send, read, kill)",
		}),
	),
	text: Type.Optional(
		Type.String({ description: "Message to send to the sub-agent (required for action 'send')" }),
	),
	timeout: Type.Optional(
		Type.Number({ description: "Timeout in ms for the 'read' action (default: 60000)" }),
	),
	direction: Type.Optional(
		Type.String({ description: "Split direction for spawn: 'right' (default) | 'below'" }),
	),
	size: Type.Optional(
		Type.Number({ description: "Initial size (lines/chars) for the new pane (optional)" }),
	),
});

const spawnTool = defineTool({
	name: "tmux_agent",
	label: "Tmux Agent",
	description:
		"Spawn and converse with a sub-agent running as a full interactive pi TUI in its own tmux pane.\n" +
		"Actions: spawn, send, read, list, kill.\n" +
		"The sub-agent writes its replies to a file mailbox; the parent reads via `read`.",
	parameters: TmuxAgentParams,

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		await checkTmuxAvailable();

		const action = params.action as string;

		if (action === "spawn") {
			const name = params.name;
			if (!name) {
				return {
					content: [{ type: "text", text: "Missing required parameter: name" }],
					details: { action: "spawn" },
					isError: true,
				};
			}
			if (registry.has(name)) {
				return {
					content: [{ type: "text", text: `A sub-agent named "${name}" is already tracked. Use a different name or kill it first.` }],
					details: { action: "spawn", name },
					isError: true,
				};
			}

			const mailboxDir = getMailboxDir(name);
			await setupMailbox(mailboxDir);

			const paneId = await splitWindow({ direction: (params.direction as "right" | "below") | undefined, size: params.size });
			await setPaneTitle(paneId, name);

			const promptResult = await writeMailboxPrompt(mailboxDir);
			const piArgs = ["--append-system-prompt", promptResult.filePath];
			const { command, args } = getPiInvocation(piArgs);

			// Launch pi in the new pane. We send the command via send-keys so
			// the spawned pi TUI runs interactively inside the pane.
			await sendKeys(paneId, command + " " + args.join(" "));
			// Small delay so the pane's shell registers the full command before Enter
			await new Promise((r) => setTimeout(r, 100));
			await sendKey(paneId, "Enter");

			const handle: SubagentHandle = { name, paneId, mailboxDir };
			registry.set(handle);

			return {
				content: [
					{
						type: "text",
						text: `Spawned sub-agent "${name}" in pane ${paneId}.\nMailbox: ${mailboxDir}`,
					},
				],
				details: { action: "spawn", handle },
			};
		}

		if (action === "send") {
			const name = params.name;
			const text = params.text;
			if (!name) {
				return {
					content: [{ type: "text", text: "Missing required parameter: name" }],
					details: { action: "send" },
					isError: true,
				};
			}
			if (!text) {
				return {
					content: [{ type: "text", text: "Missing required parameter: text" }],
					details: { action: "send", name },
					isError: true,
				};
			}
			const handle = registry.get(name);
			if (!handle) {
				return {
					content: [{ type: "text", text: `No sub-agent named "${name}" is tracked. Use "spawn" first.` }],
					details: { action: "send", name },
					isError: true,
				};
			}
			const alive = await paneExists(handle.paneId);
			if (!alive) {
				return {
					content: [{ type: "text", text: `Pane "${name}" (id ${handle.paneId}) is no longer alive. It may have been killed.` }],
					details: { action: "send", name, paneId: handle.paneId },
					isError: true,
				};
			}
			// Clear stale mailbox files so a subsequent read picks up only the fresh reply.
			await cleanupMailbox(handle.mailboxDir);
			// Re-create an empty mailbox dir.
			await setupMailbox(handle.mailboxDir);

			// Send the message body as literal text, then send Enter after a small delay.
			await sendKeys(handle.paneId, text);
			await new Promise((r) => setTimeout(r, 80));
			await sendKey(handle.paneId, "Enter");

			return {
				content: [
					{
						type: "text",
						text: `Sent to sub-agent "${name}" in pane ${handle.paneId}.`,
					},
				],
				details: { action: "send", name, paneId: handle.paneId, mailbox: handle.mailboxDir },
			};
		}
		if (action === "read") {
			const name = params.name;
			if (!name) {
				return {
					content: [{ type: "text", text: "Missing required parameter: name" }],
					details: { action: "read" },
					isError: true,
				};
			}
			const handle = registry.get(name);
			if (!handle) {
				return {
					content: [{ type: "text", text: `No sub-agent named "${name}" is tracked. Use "spawn" first.` }],
					details: { action: "read", name },
					isError: true,
				};
			}

			const timeout = params.timeout ?? 60000;
			const outDonePath = `${handle.mailboxDir}/out.done`;
			const outTxtPath = `${handle.mailboxDir}/out.txt`;

			// Poll for the completion marker with abort support
			const pollResult = await waitForFile(outDonePath, {
				timeoutMs: timeout,
				signal: _signal,
			});

			if (!pollResult.found) {
				return {
					content: [{ type: "text", text: `No reply from sub-agent "${name}" within ${timeout / 1000}s. The sub-agent may still be thinking.` }],
					details: { action: "read", name, timeout, elapsedMs: pollResult.elapsedMs },
					isError: false,
				};
			}

			// Small grace delay to ensure out.txt is fully written
			await new Promise((r) => setTimeout(r, 50));

			// Read the reply
			let reply: string;
			try {
				reply = await fs.readFile(outTxtPath, { encoding: "utf-8" });
			} catch {
				return {
					content: [{ type: "text", text: `Sub-agent "${name}" created out.done but out.txt is missing. The reply may be incomplete.` }],
					details: { action: "read", name },
					isError: false,
				};
			}

			// Clean up both files
			try {
				await fs.unlink(outDonePath);
			} catch {
				/* ignore */
			}
			try {
				await fs.unlink(outTxtPath);
			} catch {
				/* ignore */
			}

			return {
				content: [{ type: "text", text: reply }],
				details: { action: "read", name, mailbox: handle.mailboxDir, elapsedMs: pollResult.elapsedMs },
			};
		}
		if (action === "list") {
			const handles = registry.values();
			const entries = await Promise.all(
				handles.map(async (h) => {
					const alive = await paneExists(h.paneId);
					return { name: h.name, paneId: h.paneId, mailbox: h.mailboxDir, alive };
				}),
			);
			if (entries.length === 0) {
				return {
					content: [{ type: "text", text: "No tracked sub-agents." }],
					details: { action: "list" },
					isError: false,
				};
			}
			const lines = entries.map((e) => {
				const status = e.alive ? "alive" : "dead";
				return `  ${e.name} pane=${e.paneId} mailbox=${e.mailbox} [${status}]`;
			}).join("\n");
			return {
				content: [{ type: "text", text: `Tracked sub-agents:\n${lines}` }],
				details: { action: "list", count: entries.length, entries },
			};
		}
		if (action === "kill") {
			const name = params.name;
			if (!name) {
				return {
					content: [{ type: "text", text: "Missing required parameter: name" }],
					details: { action: "kill" },
					isError: true,
				};
			}
			const handle = registry.get(name);
			if (!handle) {
				// Idempotent: if not tracked, just inform.
				return {
					content: [{ type: "text", text: `No sub-agent named "${name}" is tracked.` }],
					details: { action: "kill", name },
					isError: false,
				};
			}
			// Kill the pane if it exists.
			try {
				await killPane(handle.paneId);
			} catch {
				/* ignore — pane may already be dead */
			}
			// Remove mailbox directory.
			try {
				await fs.rm(handle.mailboxDir, { recursive: true, force: true });
			} catch {
				/* ignore — dir may already be gone */
			}
			// Remove from registry.
			registry.delete(name);
			return {
				content: [{ type: "text", text: `Killed sub-agent "${name}" (pane ${handle.paneId}) and removed its mailbox.` }],
				details: { action: "kill", name, paneId: handle.paneId, mailbox: handle.mailboxDir },
			};
		}

		return {
			content: [{ type: "text", text: `Unknown action "${action}". Valid: spawn, send, read, list, kill.` }],
			details: {},
			isError: true,
		};
	},

	renderCall(args, theme, _context) {
		const action = (args.action as string) || "...";
		const name = (args.name as string) || "...";
		let text = theme.fg("toolTitle", theme.bold("tmux_agent ")) + theme.fg("accent", action);
		if (action === "spawn") {
			text += theme.fg("muted", ` name=${name}`);
			if (args.direction) text += theme.fg("dim", ` dir=${args.direction}`);
			if (args.size) text += theme.fg("dim", ` size=${args.size}`);
		} else if (action === "send") {
			const textPreview = args.text ? (args.text.length > 40 ? `${args.text.slice(0, 40)}...` : args.text) : "";
			text += theme.fg("muted", ` name=${name}`) + theme.fg("dim", ` "${textPreview}"`);
		} else if (action === "read") {
			text += theme.fg("muted", ` name=${name}`);
			if (args.timeout) text += theme.fg("dim", ` timeout=${args.timeout}ms`);
		}
		return new Text(text, 0, 0);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(spawnTool);
}
