/**
 * SDK Subagent Extension - Manage subagent instances
 *
 * Provides a `sdk-subagent` tool for spawning, listing, killing, and
 * sending instructions to role-based subagents.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
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
	role: Type.Optional(Type.String({ description: "Role name for spawn action" })),
	agentId: Type.Optional(Type.String({ description: "Target agent ID for send/kill actions" })),
	instruction: Type.Optional(Type.String({ description: "Instruction to send to the subagent" })),
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
		parameters: SubagentParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = (ctx as unknown as Record<string, unknown>).cwd as string | undefined ?? process.cwd();

			switch (params.action) {
				case "spawn": {
					if (!params.role) {
						return {
							content: [{ type: "text", text: "spawn requires 'role' parameter" }],
							details: null,
						};
					}
					const id = await manager.spawn(params.role, cwd, ctx.model, ctx.thinkingLevel);
					if (!id) {
						return {
							content: [{ type: "text", text: `Role "${params.role}" not found.` }],
							details: null,
						};
					}
					return {
						content: [{ type: "text", text: `Subagent "${id}" spawned with role "${params.role}".` }],
						details: { id, role: params.role, status: "idle" },
					};
				}
				case "list": {
					const agents = manager.list();
					if (agents.length === 0) {
						return {
							content: [{ type: "text", text: "No active subagents." }],
							details: [],
						};
					}
					const summary = agents.map((a) => `  ${a.id} [${a.status}] role="${a.role}"`).join("\n");
					return {
						content: [{ type: "text", text: `Active subagents (${agents.length}):\n${summary}` }],
						details: agents,
					};
				}
				case "kill": {
					if (!params.agentId) {
						return {
							content: [{ type: "text", text: "kill requires 'agentId' parameter" }],
							details: null,
						};
					}
					const ok = await manager.kill(params.agentId);
					if (!ok) {
						return {
							content: [{ type: "text", text: `Subagent "${params.agentId}" not found.` }],
							details: null,
						};
					}
					return {
						content: [{ type: "text", text: `Subagent "${params.agentId}" killed.` }],
						details: { id: params.agentId, status: "killed" },
					};
				}
				case "send": {
					if (!params.agentId) {
						return {
							content: [{ type: "text", text: "send requires 'agentId' parameter" }],
							details: null,
						};
					}
					if (!params.instruction) {
						return {
							content: [{ type: "text", text: "send requires 'instruction' parameter" }],
							details: null,
						};
					}
					const result = await manager.send(params.agentId, params.instruction);
					if (!result.success) {
						return {
							content: [{ type: "text", text: `Failed to send instruction to "${params.agentId}".` }],
							details: null,
						};
					}
					return {
						content: [{ type: "text", text: `Instruction sent to "${params.agentId}": ${params.instruction}` }],
						details: { id: params.agentId, streaming: result.streaming },
					};
				}
				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${params.action}` }],
						details: null,
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
