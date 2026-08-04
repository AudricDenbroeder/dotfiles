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

export interface SubagentHistoryEntry {
	kind: "system" | "user" | "assistant" | "tool_call" | "tool_result";
	text?: string;
	toolName?: string;
	toolCallId?: string;
	timestamp?: number;
}

export interface SubagentInstance {
	id: string;
	role: RoleConfig;
	session: AgentSession;
	status: "idle" | "running" | "error";
	createdAt: Date;
	lastActivity?: Date;
	parentId?: string;
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
	private changeListeners: Map<string, Set<() => void>> = new Map();
	private listChangeListeners: Set<() => void> = new Set();
	private instanceUnsubscribes: Map<string, () => void> = new Map();

	/**
	 * Subscribe to changes on a specific subagent.
	 * Returns an unsubscribe function.
	 */
	onChange(id: string, listener: () => void): () => void {
		if (!this.changeListeners.has(id)) {
			this.changeListeners.set(id, new Set());
		}
		this.changeListeners.get(id)!.add(listener);
		return () => {
			const set = this.changeListeners.get(id);
			set?.delete(listener);
			if (set?.size === 0) {
				this.changeListeners.delete(id);
			}
		};
	}

	/**
	 * Subscribe to manager-wide list changes (spawn, kill, status transitions).
	 * Returns an unsubscribe function.
	 */
	onListChange(listener: () => void): () => void {
		this.listChangeListeners.add(listener);
		return () => {
			this.listChangeListeners.delete(listener);
		};
	}

	/**
	 * Fire per-id change notifications.
	 */
	private notifyChange(id: string): void {
		const listeners = this.changeListeners.get(id);
		if (listeners) {
			for (const listener of listeners) {
				try {
					listener();
				} catch (e) {
					console.warn(`[SubagentManager] Error in onChange listener for "${id}":`, e);
				}
			}
		}
		// Also notify manager-wide
		this.notifyListChange();
	}

	/**
	 * Fire manager-wide list change notifications.
	 */
	private notifyListChange(): void {
		for (const listener of this.listChangeListeners) {
			try {
				listener();
			} catch (e) {
				console.warn(`[SubagentManager] Error in onListChange listener:`, e);
			}
		}
	}

	private emitChange(id: string): void {
		this.notifyChange(id);
	}

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
		opts?: { parentId?: string },
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
			parentId: opts?.parentId,
		};

		// Subscribe to streaming events for this subagent
		this.subscribeToEvents(instance);

		this.subagents.set(id, instance);
		console.log(`[SubagentManager] Spawned "${id}" with role "${role.name}".`);
		this.emitChange(id);
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
		// Clean up per-id listeners
		this.changeListeners.delete(id);
		// Clean up session unsubscribe
		const unsub = this.instanceUnsubscribes.get(id);
		if (unsub) {
			unsub();
			this.instanceUnsubscribes.delete(id);
		}
		this.subagents.delete(id);
		console.log(`[SubagentManager] Killed "${id}".`);
		this.notifyListChange();
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
	 * Return the full ordered history for a subagent, including system prompt,
	 * user messages, assistant text, and tool call/result pairs.
	 */
	getHistory(id: string): SubagentHistoryEntry[] {
		const sub = this.subagents.get(id);
		if (!sub) return [];

		const entries: SubagentHistoryEntry[] = [];

		// Seed with system prompt if available
		const systemPrompt = sub.session.systemPrompt;
		if (systemPrompt) {
			entries.push({
				kind: "system",
				text: systemPrompt,
				timestamp: Date.now(),
			});
		}

		const messages = sub.session.messages;
		for (const msg of messages) {
			const role = (msg as { role?: string }).role;
			const timestamp = (msg as { timestamp?: number }).timestamp;

			if (role === "user") {
				const content = (msg as { content?: string | Array<{ type: string; text?: string }> }).content;
				let text: string | undefined;
				if (typeof content === "string") {
					text = content;
				} else if (Array.isArray(content)) {
					text = content
						.filter((part) => part.type === "text" && typeof part.text === "string")
						.map((part) => part.text as string)
						.join("\n")
						.trim();
				}
				entries.push({ kind: "user", text, timestamp });
			} else if (role === "assistant") {
				const content = (msg as { content?: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: Record<string, any> }> }).content;
				if (Array.isArray(content)) {
					for (const part of content) {
						if (part.type === "text" && typeof part.text === "string") {
							entries.push({ kind: "assistant", text: part.text, timestamp });
						} else if (part.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
							entries.push({
								kind: "tool_call",
								toolName: part.name,
								toolCallId: part.id,
								timestamp,
							});
						}
					}
				}
			} else if (role === "toolResult") {
				const toolCallId = (msg as { toolCallId?: string }).toolCallId;
				const toolName = (msg as { toolName?: string }).toolName;
				const content = (msg as { content?: Array<{ type: string; text?: string }> }).content;
				let text: string | undefined;
				if (Array.isArray(content)) {
					text = content
						.filter((part) => part.type === "text" && typeof part.text === "string")
						.map((part) => part.text as string)
						.join("\n")
						.trim();
				}
				entries.push({ kind: "tool_result", text, toolName, toolCallId, timestamp });
			}
		}

		return entries;
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
		// Clean up all listener sets
		this.changeListeners.clear();
		this.listChangeListeners.clear();
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
				this.notifyChange(instance.id);
			} else if (event.type === "auto_retry_start" || event.type === "compaction_start") {
				instance.status = "running";
				this.notifyChange(instance.id);
			} else if (event.type === "auto_retry_end" && !event.success) {
				instance.status = "error";
				this.notifyChange(instance.id);
			} else if (event.type === "turn_end" || event.type === "tool_execution_end") {
				// History changed — notify so the UI can refresh
				this.notifyChange(instance.id);
			}
			// Streaming text deltas are available here but not surfaced yet (task 05)
		});
		// Store unsubscribe so we can clean up on kill
		this.instanceUnsubscribes.set(instance.id, unsubscribe);
	}
}

// Re-export roles for convenience
export { roles } from "./roles";
export type { RoleConfig } from "./roles";
