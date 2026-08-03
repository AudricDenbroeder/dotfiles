## Task: Manager History & Events API

### Overview
Extend `SubagentManager`/`SubagentInstance` (in `~/.pi/agent/extensions/sdk-subagent/SubagentManager.ts`) so the future UI components have everything they need: full ordered history per subagent (including tool calls), a `parentId` for tree rendering, and change-notification hooks so components can live-update instead of polling.

### Subtasks
- [ ] Add `parentId?: string` to `SubagentInstance` and thread an optional caller/parent id through `spawn()` so it can be recorded at creation time.
- [ ] Implement `getHistory(id): SubagentHistoryEntry[]` that walks `sub.session.messages` and returns a normalized, ordered list covering user messages, assistant text, and tool calls/results (not just the last assistant text like the existing `getLastAssistantText`).
- [ ] Implement change-notification APIs: `onChange(id, listener): () => void` (fires on any update to one subagent's status/history) and `onListChange(listener): () => void` (fires on spawn/kill/status-change for the manager as a whole, for the live list).
- [ ] Wire the new notifications into the existing `subscribeToEvents()` per-instance subscription and into `spawn()`/`kill()`, and make sure listener sets are cleaned up in `kill()` and `shutdown()` (no leaks across repeated `/subagents` invocations).

### Implementation Details
- Files to modify: `SubagentManager.ts` only (keep `index.ts`/`roles.ts` untouched in this task).
- `SubagentHistoryEntry` shape suggestion:
  ```ts
  interface SubagentHistoryEntry {
    kind: "system" | "user" | "assistant" | "tool_call" | "tool_result";
    text?: string;
    toolName?: string;
    toolCallId?: string;
    timestamp?: number;
  }
  ```
  Build it by iterating `sub.session.messages` (type `AgentMessage[]` from `@earendil-works/pi-agent-core`) and flattening each message's `content` array, mapping `type: "text"` to `assistant`/`user` entries per `msg.role`, and `type: "tool_use"`/`"tool_result"` (exact type names should be confirmed against the installed `pi-ai`/`pi-agent-core` types while implementing) to `tool_call`/`tool_result` entries. Reuse the existing filtering style from `getLastAssistantText` but do not remove that method — other code (tool `send` action) still depends on it.
  - `sub.session.systemPrompt` (getter on `AgentSession`) can seed a `kind: "system"` entry at the start of the history if useful for the detail view.
- `parentId`: since no role currently grants the `sdk-subagent` tool to a subagent, there is no real caller today. Add the plumbing anyway (`spawn(roleName, cwd, opts?: { parentId?: string; ... })` or an explicit extra parameter) but it's fine if `index.ts` always calls it with `parentId: undefined` for now — this task's job is to make the manager tree-ready, not to solve caller-detection.
- Notification plumbing: a `Map<string, Set<() => void>>` for per-id listeners (`onChange`) and a `Set<() => void>` for the manager-wide `onListChange` is simplest. Call the relevant listeners from inside `subscribeToEvents()`'s existing `instance.session.subscribe(...)` callback (in addition to the current status-updating logic), and from `spawn()` (after adding to the map) and `kill()` (before/after removal).
- Keep `send()`, `list()`, `get()`, `kill()`, `waitForIdle()`, `serializeState()` signatures/behavior unchanged so the existing `sdk-subagent` tool keeps working.

### Acceptance Criteria
- [ ] `getHistory(id)` returns entries in chronological order including at least one `tool_call`/`tool_result` pair when a subagent has used a tool (verify manually by spawning a Coder subagent and having it run a `bash`/`read` command via `sdk-subagent send`).
- [ ] `onChange`/`onListChange` fire at the expected times (spawn, status idle→running→idle, kill) and their returned unsubscribe functions stop further notifications.
- [ ] `parentId` field exists on `SubagentInstance` and is settable at spawn time without breaking existing spawn call sites.
- [ ] Existing `sdk-subagent` tool actions (`spawn`, `list`, `kill`, `send`) still work unmodified from the user's perspective.
