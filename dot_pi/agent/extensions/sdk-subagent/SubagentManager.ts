/**
 * SubagentManager — core runtime for managing subagent sessions.
 *
 * Spawns SDK AgentSession instances backed by role configs, tracks them
 * in memory, subscribes to streaming events, and exposes kill/send/list.
 */

import type { AgentSession, AgentSessionEvent, ModelRegistry, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { roles } from "./roles";
import type { RoleConfig } from "./roles";

/**
 * `ModelRegistry` (from `ctx.modelRegistry`) wraps a `ModelRuntime` instance in a
 * private field. There is no public accessor, but `createAgentSession()` accepts a
 * `modelRuntime` option so a subagent session can share the parent's provider
 * registrations (e.g. dynamically-registered providers like llama.cpp) and
 * resolved auth instead of bootstrapping a fresh runtime from disk that knows
 * nothing about them. We reach into the private field at runtime (TS-only
 * privacy, not enforced by JS) to extract it.
 */
function extractModelRuntime(modelRegistry: ModelRegistry | undefined): unknown {
	return modelRegistry ? (modelRegistry as unknown as Record<string, unknown>).runtime : undefined;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubagentInstance {
	id: string;
	role: RoleConfig;
	session: AgentSession;
	status: "idle" | "running" | "error";
	createdAt: Date;
	lastActivity?: Date;
}

export interface SubagentStatus {
	id: string;
	role: string;
	status: "idle" | "running" | "error";
	createdAt: string;
}

export interface SubagentSerialize {
	id: string;
	role: string;
	status: string;
	createdAt: string;
}

// ─── SubagentManager ──────────────────────────────────────────────────────────

export class SubagentManager {
	private subagents: Map<string, SubagentInstance> = new Map();
	private nextId = 1;

	/**
	 * Spawn a new subagent with the given role name.
	 * Creates an in-memory SDK AgentSession with the role's toolset.
	 * Passes parentModel and parentThinkingLevel so the subagent shares
	 * the parent session's model / API credentials.
	 * Returns the subagent ID, or null if the role is not found.
	 */
	async spawn(
		roleName: string,
		cwd: string,
		parentModel?: Model<any>,
		parentThinkingLevel?: ThinkingLevel,
		parentModelRegistry?: ModelRegistry,
	): Promise<string | null> {
		const role = roles.find((r) => r.name === roleName);
		if (!role) {
			console.warn(`[SubagentManager] Role "${roleName}" not found.`);
			return null;
		}

		const id = `subagent-${this.nextId++}`;
		const sm = SessionManager.inMemory(cwd);
		const modelRuntime = extractModelRuntime(parentModelRegistry);

		const { session } = await createAgentSession({
			cwd,
			sessionManager: sm,
			tools: role.tools,
			model: parentModel,
			thinkingLevel: parentThinkingLevel,
			// Share the parent's ModelRuntime so dynamically-registered providers
			// (e.g. llama.cpp) and already-resolved auth are available to the
			// subagent session instead of bootstrapping a fresh runtime from disk.
			...(modelRuntime ? { modelRuntime: modelRuntime as never } : {}),
		});

		const instance: SubagentInstance = {
			id,
			role,
			session,
			status: "idle",
			createdAt: new Date(),
		};

		// Subscribe to streaming events for this subagent
		this.subscribeToEvents(instance);

		this.subagents.set(id, instance);
		console.log(`[SubagentManager] Spawned "${id}" with role "${role.name}".`);
		return id;
	}

	/**
	 * Get a subagent by ID.
	 */
	get(id: string): SubagentInstance | undefined {
		return this.subagents.get(id);
	}

	/**
	 * List all active subagents as status summaries.
	 */
	list(): SubagentStatus[] {
		return Array.from(this.subagents.values()).map((s) => ({
			id: s.id,
			role: s.role.name,
			status: s.status,
			createdAt: s.createdAt.toISOString(),
		}));
	}

	/**
	 * Kill a subagent: abort its session and remove from tracking.
	 */
	async kill(id: string): Promise<boolean> {
		const sub = this.subagents.get(id);
		if (!sub) return false;
		try {
			await sub.session.abort();
			sub.session.dispose();
		} catch (e) {
			console.warn(`[SubagentManager] Error aborting "${id}":`, e);
		}
		this.subagents.delete(id);
		console.log(`[SubagentManager] Killed "${id}".`);
		return true;
	}

	/**
	 * Send an instruction to a subagent and wait for its reply.
	 *
	 * `session.sendUserMessage()` (via `AgentSession.prompt()`) already awaits the
	 * full agent turn when the subagent isn't mid-stream, so by the time it
	 * resolves the subagent's response is present in `session.messages`. We
	 * additionally `waitForIdle()` to cover the case where the message was queued
	 * (e.g. a send arrives while a previous turn is still finishing), then extract
	 * the last assistant message's text so it can be surfaced back to the caller.
	 */
	async send(
		id: string,
		message: string,
	): Promise<{ success: boolean; streaming?: boolean; response?: string }> {
		const sub = this.subagents.get(id);
		if (!sub) {
			return { success: false };
		}
		if (sub.status === "error") {
			return { success: false };
		}
		// Set status to running before dispatch
		sub.status = "running";
		sub.lastActivity = new Date();
		try {
			// Use followUp so the message is queued after the current turn
			await sub.session.sendUserMessage(message, { deliverAs: "followUp" });
			// Ensure the turn has fully settled (covers the queued/streaming edge case)
			// before reading back the response.
			await sub.session.waitForIdle();
			const response = this.getLastAssistantText(sub);
			sub.status = "idle";
			sub.lastActivity = new Date();
			return { success: true, streaming: sub.session.isStreaming, response };
		} catch (e) {
			console.error(`[SubagentManager] Error sending to "${id}":`, e);
			sub.status = "error";
			return { success: false };
		}
	}

	/**
	 * Extract the text of the most recent assistant message from a subagent's
	 * session, used to surface the subagent's reply after `send()`.
	 */
	getLastAssistantText(sub: SubagentInstance): string | undefined {
		const messages = sub.session.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i] as { role?: string; content?: unknown };
			if (msg?.role !== "assistant") continue;
			const content = msg.content as Array<{ type: string; text?: string }> | undefined;
			if (!content) return undefined;
			const text = content
				.filter((part) => part.type === "text" && typeof part.text === "string")
				.map((part) => part.text as string)
				.join("\n")
				.trim();
			return text.length > 0 ? text : undefined;
		}
		return undefined;
	}

	/**
	 * Poll until the subagent becomes idle again.
	 */
	async waitForIdle(id: string): Promise<void> {
		const sub = this.subagents.get(id);
		if (!sub) return;
		await sub.session.waitForIdle();
		sub.status = "idle";
		sub.lastActivity = new Date();
	}

	/**
	 * Serialize all subagent state for persistence / branching support.
	 */
	serializeState(): SubagentSerialize[] {
		return Array.from(this.subagents.values()).map((s) => ({
			id: s.id,
			role: s.role.name,
			status: s.status,
			createdAt: s.createdAt.toISOString(),
		}));
	}

	/**
	 * Get the raw instance map (for extensions that need deep access).
	 */
	getAll(): Map<string, SubagentInstance> {
		return this.subagents;
	}

	/**
	 * Clean up all subagents (called on session shutdown).
	 */
	async shutdown(): Promise<void> {
		for (const id of [...this.subagents.keys()]) {
			await this.kill(id);
		}
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private subscribeToEvents(instance: SubagentInstance): void {
		const unsubscribe = instance.session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "agent_settled") {
				instance.status = "idle";
				instance.lastActivity = new Date();
			} else if (event.type === "auto_retry_start" || event.type === "compaction_start") {
				instance.status = "running";
			} else if (event.type === "auto_retry_end" && !event.success) {
				instance.status = "error";
			}
			// Streaming text deltas are available here but not surfaced yet (task 05)
		});
		// Store unsubscribe on the instance so we can clean up on kill
		(instance as unknown as Record<string, unknown>)._unsubscribe = unsubscribe;
	}
}

// Re-export roles for convenience
export { roles } from "./roles";
export type { RoleConfig } from "./roles";
