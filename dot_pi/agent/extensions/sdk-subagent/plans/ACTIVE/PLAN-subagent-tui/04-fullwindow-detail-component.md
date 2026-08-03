## Task: Full-Window Detail Component

### Overview
Build the non-overlay, full-window view opened when a subagent is selected from the list: renders that subagent's complete history (system prompt, instructions, replies, tool calls) and provides a small prompt box to send new instructions.

### Subtasks
- [ ] Build a history-rendering `Container` that maps `manager.getHistory(id)` (task 01) entries to styled blocks — e.g. `Markdown`/`Text` for assistant/user text (using `theme.fg("userMessageText"/"customMessageText"/...)` conventions), and a compact single-line/`Text` rendering for `tool_call`/`tool_result` entries (tool name + truncated args/result).
- [ ] Add a bottom-pinned prompt input using `Editor` or `Input` from `pi-tui` (per `tui.md`'s Focusable/Container guidance — propagate `focused` if wrapping in a container) that submits on Enter.
- [ ] On submit, call `manager.send(id, text)`; show a `BorderedLoader`-style spinner/status line while the call is in flight (per `tui.md` Pattern 2), and refresh the rendered history from `manager.getHistory(id)` once it resolves.
- [ ] Subscribe to `manager.onChange(id, ...)` (task 01) so the history/status re-renders live as the subagent's status changes or as tool calls happen during the turn, not only after `send()` resolves.
- [ ] Wire `k` → kill this subagent (`manager.kill(id)`) and exit the view back to the list; wire `Esc` → exit back to the list without killing.

### Implementation Details
- Files to add: `~/.pi/agent/extensions/sdk-subagent/SubagentDetailView.ts`, exported factory for use with `ctx.ui.custom<DetailResult>((tui, theme, keybindings, done) => ...)` **without** `{ overlay: true }` so it fully replaces the main session TUI, per the plan.
- Header line: show `id`, `role`, and live `status` (idle/running/error), updated via the `onChange` subscription.
- Scrolling: for v1, simplest acceptable behavior is auto-scroll-to-bottom on every history update (render only the last N lines that fit `height`... note `render(width)` doesn't receive height directly in the basic `Component` interface — check whether the `ctx.ui.custom()` full-window callback gives a height hint, or just render everything and rely on terminal/TUI's own scroll region; if no height is available, keep it simple: render full history, newest at bottom, and accept that very long histories may need external terminal scrollback for v1). Note any limitation found here for task 06 to revisit.
- Prompt box: disable submitting a new message while a turn is already in flight for this subagent (`sub.status === "running"`), showing a "waiting for reply..." hint instead — avoids overlapping `send()` calls per subagent.
- Return value type suggestion: `{ action: "back" } | { action: "killed" }` so task 05 knows whether to just reopen the list or reopen it with a toast.
- Must unsubscribe from `manager.onChange(id, ...)` when leaving the view (any of: back, killed, session shutdown).

### Acceptance Criteria
- [ ] Opening the detail view for a subagent that already has history (spawned + sent a message earlier) shows that full history immediately, in order, including any tool calls it made.
- [ ] Typing an instruction and pressing Enter shows a loader/status while waiting, then appends the new user instruction and the subagent's reply to the visible history once the turn settles.
- [ ] Sending is blocked (with a clear inline hint) while the subagent is already mid-turn, rather than allowing overlapping `send()` calls.
- [ ] Pressing `k` kills the subagent and returns control to the caller with `{ action: "killed" }`; pressing `Esc` returns with `{ action: "back" }` without affecting the subagent.
- [ ] The view fully occupies the terminal (main session's editor/footer are not visible underneath) while open.
