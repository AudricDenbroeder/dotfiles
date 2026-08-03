## Plan

Implement the `/subagents` command in the `sdk-subagent` extension (`~/.pi/agent/extensions/sdk-subagent/`). Today the command is a placeholder that just shows a notification. The goal is a real interactive TUI:

1. Running `/subagents` opens a **floating (overlay) list** of all subagents tracked by `SubagentManager`, showing id, role, and status (idle/running/error). The list auto-refreshes live while open (new spawns appear, status transitions from running → idle are reflected) using `SubagentManager`'s event subscription plumbing. The list is rendered as a **tree** (like the `tree` command): subagents spawned by another subagent (once/if a role is granted the `sdk-subagent` tool) are nested and indented under their parent using `├──`/`└──`/`│` connector prefixes, at whatever depth applies; top-level subagents (spawned directly by the main session) sit at the root with no indentation.
2. Arrow keys scroll/select an entry. Pressing **Enter** on an entry closes the floating list and switches to a **full-window view** (non-overlay `ctx.ui.custom()`, so the main session's TUI/editor is fully replaced) dedicated to that subagent.
3. The full-window view renders the subagent's own conversation history end-to-end: its system prompt context, every user instruction sent to it (including ones sent via the `sdk-subagent` tool's `send` action), every assistant reply, and every tool call/result it made. Below the history there is a small prompt/input box; pressing Enter sends the typed instruction to the subagent via `SubagentManager.send()`. While a turn is in flight, a loader/spinner is shown; once the turn completes the final reply is appended to the history (no token-level streaming display — matches current `send()` semantics).
4. From either the list or the detail view, a keybinding (e.g. `k`) kills the currently selected/open subagent via `SubagentManager.kill()`.
5. Navigation: `Esc` in the detail view returns to the floating list (re-showing live state). `Esc` in the list closes the whole `/subagents` UI and returns control to the normal session TUI.

This requires: (a) exposing/streaming message history and status from `SubagentManager` in a UI-consumable way (subscribing to `AgentSessionEvent`s per subagent, including tool calls), (b) building the overlay list component (reuse `SelectList`/`DynamicBorder` patterns), (c) building the full-window detail component (history renderer + small input box, likely `Editor`/`Input` from `pi-tui`), and (d) wiring it all together in the `subagents` command handler with proper cleanup (unsubscribing listeners, disposing components) when the user backs out or closes.

## Tasks

### 01-manager-history-and-events-api
Difficulty to implement : 3
Description of the task : Extend `SubagentManager` / `SubagentInstance` to expose what the detail view needs: (a) a way to read the full ordered message/tool-call history for a subagent (reusing/adapting `getLastAssistantText`'s traversal logic to instead return the full list, including tool_use/tool_result entries), (b) a subscription mechanism so a UI component can be notified on any change to a specific subagent (new message chunk, status change, tool call started/finished, spawn/kill events for the manager as a whole so the list can live-refresh), (c) a `parentId` field on `SubagentInstance` set at spawn time (best-effort: if the `spawn` call is itself made from inside a subagent's own session — i.e. a role has been granted the `sdk-subagent` tool — record that subagent's id as the parent; otherwise `parentId` is undefined, meaning top-level/root). Keep `send()`'s existing await-based contract intact (no token streaming) but make sure history is queryable immediately after each turn settles.

### 02-tree-list-data-model
Difficulty to implement : 1
Description of the task : Add a small helper (in `SubagentManager` or a new util) that turns the flat `list()`/`getAll()` map into an ordered tree using each instance's `parentId` (task 01c), producing rows annotated with depth and tree-connector prefix (`├── `, `└── `, `│   `, matching how the `tree` command draws branches) so the list component in task 03 can render indentation without recomputing hierarchy itself. Handle orphaned `parentId`s (parent already killed) by falling back to root level.

### 03-floating-subagent-list-component
Difficulty to implement : 3
Description of the task : Build the overlay list component shown by `/subagents`: a bordered `SelectList`-based (or custom, since `SelectList` labels need the tree-prefix baked in) view showing each row as `<tree-prefix><id> [role] status` using the tree data model from task 02, indenting children under their parent exactly like `tree`. Subscribes to the manager-level change notifications from task 01 and calls `tui.requestRender()` / invalidates on updates so status/new entries and hierarchy changes appear live. Support arrow-key navigation (flattened tree order), Enter to select, `k` to kill the highlighted subagent (with confirmation or immediate removal + toast; killing a parent should also visually fold/remove its now-orphaned children per task 02's fallback), and `Esc` to close. Render with `overlay: true` via `ctx.ui.custom()`.

### 04-fullwindow-detail-component
Difficulty to implement : 4
Description of the task : Build the full-window (non-overlay) detail component: a scrollable history pane rendering the subagent's system prompt, user instructions, assistant replies, and tool calls/results (reuse `Markdown`/`Text`/theme conventions from the docs), plus a small `Editor`/`Input`-based prompt box pinned at the bottom for composing and sending new instructions. Enter sends via `SubagentManager.send()`, showing a `BorderedLoader`-style spinner/status while the turn is running and appending the result to history on completion. `k` kills the subagent from this view too. `Esc` returns to the floating list (task 03).

### 05-command-wiring-and-navigation
Difficulty to implement : 2
Description of the task : Replace the placeholder `subagents` command handler in `index.ts` to open the list (task 03); on select, transition to the detail view (task 04); on the detail view's `Esc`, reopen the list; on the list's `Esc`, resolve/close the whole flow. Ensure all subscriptions/listeners created in tasks 01-04 are properly unsubscribed and components disposed on every exit path (kill, back-navigation, final close, and session shutdown) to avoid leaks across repeated `/subagents` invocations.

### 06-manual-testing-and-polish
Difficulty to implement : 2
Description of the task : Manually exercise the flow end-to-end (spawn multiple subagents via the `sdk-subagent` tool, open `/subagents`, watch live status updates, drill into a subagent, send instructions, observe loader + history growth, kill from both list and detail view, navigate back and forth, close). Verify tree indentation renders correctly for nested subagents (if/when a role has the `sdk-subagent` tool) and stays sane when a parent is killed. Fix rendering edge cases (empty subagent list state, long histories needing scroll, narrow terminal widths, theme invalidation) and tidy up any rough edges found.
