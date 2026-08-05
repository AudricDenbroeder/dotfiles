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
 * Parse a "provider/modelId" string into its components.
 * Returns undefined for either component if the format is invalid.
 */
function parseModelRef(ref: string): { provider: string; modelId: string } | undefined {
	const idx = ref.indexOf("/");
	if (idx <= 0 || idx === ref.length - 1) return undefined;
	return { provider: ref.slice(0, idx), modelId: ref.slice(idx + 1) };
}

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
	toolArgs?: string;
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
	parentId?: string;
}

export interface SubagentSerialize {
	id: string;
	role: string;
	model?: string;
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
				} catch {
					// Swallow listener errors. Never write to stdout/stderr here:
					// this can fire while the interactive TUI is actively rendering,
					// and a raw console write races pi-tui's own terminal writes,
					// corrupting its row bookkeeping (stale/duplicated overlay and
					// chat content). See notifyListChange() below for the same reason.
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
			} catch {
				// Swallow — see notifyChange() above.
			}
		}
	}

	private emitChange(id: string): void {
		this.notifyChange(id);
	}

	/**
	 * Spawn a new subagent with the given role name.
	 * Creates an in-memory SDK AgentSession with the role's toolset.
	 * If the role defines a `model` or `thinkingLevel`, those are used instead of
	 * the parent's values. An explicit `modelOverride` parameter takes precedence
	 * over the role's default.
	 * Returns the subagent ID on success, or null if the role is not found or the
	 * requested model could not be resolved.
	 */
	async spawn(
		roleName: string,
		cwd: string,
		parentModel?: Model<any>,
		parentThinkingLevel?: ThinkingLevel,
		parentModelRegistry?: ModelRegistry,
		opts?: { parentId?: string; model?: string },
	): Promise<{ id: string | null; errorMessage?: string }> {
		const role = roles.find((r) => r.name === roleName);
		if (!role) {
			return { id: null };
		}

		const id = `subagent-${this.nextId++}`;
		const sm = SessionManager.inMemory(cwd);
		const modelRuntime = extractModelRuntime(parentModelRegistry);

		// Resolve model: spawn override > role default > parent model
		let resolvedModel: Model<any> | undefined;
		let resolvedThinkingLevel: ThinkingLevel | undefined;

		if (opts?.model) {
			// Explicit spawn override — look up in the model registry
			const parsed = parseModelRef(opts.model);
			if (!parsed) {
				return { id: null, errorMessage: `Invalid model format "${opts.model}". Expected provider/modelId (e.g. "anthropic/claude-opus-4-5").` };
			}
			if (modelRuntime) {
				resolvedModel = modelRuntime.getModel(parsed.provider, parsed.modelId);
			}
			if (!resolvedModel && modelRuntime) {
				// Model not found — list available models for this provider to help the user
				const available = modelRuntime.getModels(parsed.provider);
				const suggestions = available.map((m) => `${parsed.provider}/${m.id}`).join(", ");
				return { id: null, errorMessage: `Model "${opts.model}" not found. Available models for provider "${parsed.provider}": ${suggestions || "none"}` };
			}
			resolvedThinkingLevel = role.thinkingLevel;
		} else if (role.model) {
			// Role default model — look up in the model registry
			const parsed = parseModelRef(role.model);
			if (parsed && modelRuntime) {
				resolvedModel = modelRuntime.getModel(parsed.provider, parsed.modelId);
			}
			resolvedThinkingLevel = role.thinkingLevel;
		} else {
			// Fall back to parent's model and thinking level
			resolvedModel = parentModel;
			resolvedThinkingLevel = parentThinkingLevel;
		}

		const { session } = await createAgentSession({
			cwd,
			sessionManager: sm,
			tools: role.tools,
			model: resolvedModel,
			thinkingLevel: resolvedThinkingLevel,
			// Share the parent's ModelRuntime so dynamically-registered providers
			// (e.g. llama.cpp) and already-resolved auth are available to the
			// subagent session instead of bootstrapping a fresh runtime from disk.
			...(modelRuntime ? { modelRuntime: modelRuntime as never } : {}),
		});

		// Append the role's system prompt to the main (built-in) system prompt.
		// createAgentSession initializes systemPrompt to "" and then _rebuildSystemPrompt
		// builds the main prompt from tools and resources. We append the role-specific
		// prompt so the subagent receives both the standard pi context and its role guidance.
		if (role.systemPrompt) {
			const mainPrompt = (session as Record<string, unknown>)._baseSystemPrompt as string;
			const combinedPrompt = mainPrompt + "\n\n--- Role: " + (role.label ?? role.name) + " ---\n\n" + role.systemPrompt;
			(session as Record<string, unknown>)._baseSystemPrompt = combinedPrompt;
			session.agent.state.systemPrompt = combinedPrompt;
		}

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
		this.emitChange(id);
		return { id };
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
			parentId: s.parentId,
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
		} catch {
			// Swallow — raw console writes here would race the interactive TUI's
			// own rendering (see notifyChange() above).
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
		} catch {
			// Swallow — raw console writes here would race the interactive TUI's
			// own rendering (see notifyChange() above). The caller already gets
			// `{ success: false }` to signal the failure.
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
							let toolArgs: string | undefined;
							if (typeof part.arguments === "string") {
								toolArgs = part.arguments;
							} else if (typeof part.arguments === "object" && part.arguments !== null) {
								toolArgs = JSON.stringify(part.arguments);
							}
							entries.push({
								kind: "tool_call",
								toolName: part.name,
								toolCallId: part.id,
								toolArgs,
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
			model: s.role.model,
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

// ─── Tree Data Model ──────────────────────────────────────────────────────────

export interface SubagentTreeRow {
	id: string;
	depth: number;
	prefix: string; // e.g. "│   ├── " matching `tree` command style
	isLast: boolean; // last child among its siblings
	instance: SubagentStatus;
}

/**
 * Build an ordered tree representation of subagents using parentId links.
 * Returns rows in DFS preorder (roots first, each node's children follow).
 * Orphaned nodes (parentId pointing to a non-existent instance) are promoted to root.
 */
export function buildSubagentTree(instances: SubagentStatus[]): SubagentTreeRow[] {
	// Group instances by parentId; orphaned parentIds fall back to undefined (root)
	const childrenMap = new Map<string | undefined, SubagentStatus[]>();
	const knownIds = new Set(instances.map((i) => i.id));

	for (const inst of instances) {
		const parentKey = inst.parentId && knownIds.has(inst.parentId) ? inst.parentId : undefined;
		if (!childrenMap.has(parentKey)) {
			childrenMap.set(parentKey, []);
		}
		childrenMap.get(parentKey)!.push(inst);
	}

	const result: SubagentTreeRow[] = [];

	function dfs(nodeId: string, depth: number, ancestorIsLast: boolean[]): void {
		const node = instances.find((i) => i.id === nodeId);
		if (!node) return;

		// Find this node's siblings: all children of its parent
		const parentKey = node.parentId && knownIds.has(node.parentId) ? node.parentId : undefined;
		const siblingsList = childrenMap.get(parentKey) ?? [];
		const isLast = siblingsList[siblingsList.length - 1]?.id === nodeId;

		// Build prefix: for each ancestor level, emit "│   " if ancestor was not last, else "    "
		let prefix = "";
		for (let i = 0; i < depth; i++) {
			prefix += ancestorIsLast[i] ? "    " : "│   ";
		}
		// Connector for this node
		prefix += isLast ? "└── " : "├── ";

		result.push({ id: nodeId, depth, prefix, isLast, instance: node });

		// Recurse into children, passing current isLast as the ancestor flag for the next depth
		const childBucket = childrenMap.get(nodeId) ?? [];
		for (const child of childBucket) {
			dfs(child.id, depth + 1, [...ancestorIsLast, isLast]);
		}
	}

	// Start DFS from root nodes (those with no parent or orphaned parent)
	const rootBucket = childrenMap.get(undefined) ?? [];
	for (const root of rootBucket) {
		dfs(root.id, 0, []);
	}

	return result;
}

// Re-export roles for convenience
export { roles } from "./roles";
export type { RoleConfig } from "./roles";
