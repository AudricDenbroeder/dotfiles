/**
 * SDK Subagent Extension - Manage subagent instances
 *
 * Provides a `sdk-subagent` tool for spawning, listing, killing, and
 * sending instructions to role-based subagents.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { SubagentManager } from "./SubagentManager";
import { roles } from "./roles";

// ─── Role validation ──────────────────────────────────────────────────────────

function validateRoles(): string[] {
	const warnings: string[] = [];
	for (const role of roles) {
		if (!role.name || !role.systemPrompt || !role.tools) {
			warnings.push(`Invalid role config: ${role.name ?? "unnamed"}`);
		}
	}
	return warnings;
}

// ─── Parameter Schema ─────────────────────────────────────────────────────────

const SubagentParams = Type.Object({
	action: StringEnum(["spawn", "list", "kill", "send"] as const),
	role: Type.Optional(Type.String({ description: "Role name for spawn (e.g., Scout, Coder, Reviewer)" })),
	id: Type.Optional(Type.String({ description: "Subagent ID for kill/send" })),
	message: Type.Optional(Type.String({ description: "Instruction message for send action" })),
});

// ─── Extension Factory ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Validate roles on load
	const warnings = validateRoles();
	for (const w of warnings) console.warn(w);

	// Create the manager — lives for the duration of the extension session
	const manager = new SubagentManager();

	// Lifecycle
	pi.on("session_start", (_event, ctx) => {
		const roleNames = roles.map((r) => r.name).join(", ");
		ctx.ui.notify(`SDK Subagent extension loaded. Roles: ${roleNames}`, "info");
	});

	pi.on("session_shutdown", async () => {
		await manager.shutdown();
	});

	// Tool
	pi.registerTool({
		name: "sdk-subagent",
		label: "SDK Subagent",
		description: "Manage subagent instances: spawn, list, kill, send instructions",
		promptSnippet: "Spawn, list, kill, or send instructions to subagent instances",
		promptGuidelines: [
			"Use sdk-subagent to spawn a subagent with a specific role.",
			"Use sdk-subagent to list active subagents and their status.",
			"Use sdk-subagent to send instructions to an existing subagent.",
			"Use sdk-subagent to kill a subagent when done.",
		],
		parameters: SubagentParams,
		renderCall(args: { action: string; role?: string; id?: string; message?: string }, theme, _context) {
			const action = args.action;
			let detail = "";
			if (action === "spawn" && args.role) {
				detail = args.role;
			} else if ((action === "kill" || action === "send") && args.id) {
				detail = args.id;
			}
			const suffix = detail ? ` ${detail}` : "";
			return new Text(
				theme.fg("toolTitle", theme.bold("sdk-subagent ")) + theme.fg("muted", action + suffix),
				0,
				0,
			);
		},

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as unknown as Record<string, unknown>).cwd as string | undefined ?? process.cwd();

			switch (params.action) {
				case "spawn": {
					if (!params.role) {
						return {
							content: [{ type: "text", text: `Error: spawn requires 'role' parameter` }],
							details: { error: true, message: "spawn requires 'role' parameter" },
						};
					}
					const id = await manager.spawn(params.role, cwd, ctx.model, ctx.thinkingLevel, ctx.modelRegistry);
					if (!id) {
						return {
							content: [{ type: "text", text: `Error: Role "${params.role}" not found.` }],
							details: { error: true, message: `Role "${params.role}" not found.` },
						};
					}
					return {
						content: [{ type: "text", text: `Spawned ${id} with role ${params.role}` }],
						details: { id, role: params.role, status: "idle" },
					};
				}
				case "list": {
					const agents = manager.list();
					return {
						content: [{ type: "text", text: JSON.stringify(agents, null, 2) }],
						details: { subagents: agents },
					};
				}
				case "kill": {
					if (!params.id) {
						return {
							content: [{ type: "text", text: `Error: kill requires 'id' parameter` }],
							details: { error: true, message: "kill requires 'id' parameter" },
						};
					}
					const ok = await manager.kill(params.id);
					if (!ok) {
						return {
							content: [{ type: "text", text: `Error: Subagent "${params.id}" not found.` }],
							details: { error: true, message: `Subagent "${params.id}" not found.` },
						};
					}
					return {
						content: [{ type: "text", text: `Killed ${params.id}` }],
						details: { success: true, id: params.id },
					};
				}
				case "send": {
					if (!params.id) {
						return {
							content: [{ type: "text", text: `Error: send requires 'id' parameter` }],
							details: { error: true, message: "send requires 'id' parameter" },
						};
					}
					if (!params.message) {
						return {
							content: [{ type: "text", text: `Error: send requires 'message' parameter` }],
							details: { error: true, message: "send requires 'message' parameter" },
						};
					}
					const result = await manager.send(params.id, params.message);
					if (!result.success) {
						return {
							content: [{ type: "text", text: `Error: Failed to send instruction to "${params.id}".` }],
							details: { error: true, message: `Failed to send instruction to "${params.id}".` },
						};
					}
					const replyText = result.response ?? "(subagent produced no text response)";
					return {
						content: [
							{
								type: "text",
								text: `Sent to ${params.id}\n${replyText}`,
							},
						],
						details: { success: true, id: params.id, streaming: result.streaming },
					};
				}
				default:
					return {
						content: [{ type: "text", text: `Error: Unknown action: ${params.action}` }],
						details: { error: true, message: `Unknown action: ${params.action}` },
					};
			}
		},
	});

	// Command placeholder
	pi.registerCommand("subagents", {
		description: "Open subagent management TUI (placeholder)",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Subagent TUI coming soon!", "info");
		},
	});
}
