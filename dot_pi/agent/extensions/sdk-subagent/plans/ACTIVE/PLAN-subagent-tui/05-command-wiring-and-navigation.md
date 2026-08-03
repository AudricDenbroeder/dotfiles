## Task: Command Wiring & Navigation

### Overview
Replace the placeholder `subagents` command in `index.ts` with the real navigation loop connecting the floating list (task 03) and full-window detail view (task 04), and make sure every exit path cleans up subscriptions/components correctly.

### Subtasks
- [ ] Replace the current `pi.registerCommand("subagents", { handler: async (_args, ctx) => { ctx.ui.notify(...) } })` placeholder with a loop: show the list; if the user closed it (`{ action: "close" }`), return; if they selected a subagent (`{ action: "open", id }`), show the detail view for that id; when the detail view resolves (`back` or `killed`), loop back to showing the list again (re-fetching live state).
- [ ] Guard against the selected subagent having been killed/removed between list-close and detail-open (e.g. by a concurrent `sdk-subagent kill` tool call) — show a notify + go back to the list instead of crashing.
- [ ] Audit tasks 01/03/04's subscriptions (`onListChange`, `onChange`) and confirm each is unsubscribed on every exit path: normal back-navigation, kill-from-list, kill-from-detail, final close, and `session_shutdown` (existing `manager.shutdown()` hook) — add any missing cleanup.
- [ ] Manually verify repeated `/subagents` invocations in the same session don't leak listeners (e.g. temporarily log listener-set sizes, or add a lightweight assertion during development, then remove/relax before finishing).

### Implementation Details
- File to modify: `~/.pi/agent/extensions/sdk-subagent/index.ts` (the `pi.registerCommand("subagents", ...)` block near the bottom).
- Suggested control flow:
  ```ts
  handler: async (_args, ctx) => {
    let currentId: string | undefined;
    while (true) {
      const listResult = await showSubagentList(ctx, manager); // task 03 factory
      if (listResult.action === "close") return;
      currentId = listResult.id;
      if (!manager.get(currentId)) {
        ctx.ui.notify(`Subagent ${currentId} no longer exists`, "warning");
        continue;
      }
      const detailResult = await showSubagentDetail(ctx, manager, currentId); // task 04 factory
      // detailResult.action is "back" or "killed" either way -> loop back to list
      if (detailResult.action === "killed") {
        ctx.ui.notify(`Killed ${currentId}`, "info");
      }
    }
  }
  ```
- `showSubagentList`/`showSubagentDetail` should be thin wrappers around each view's `ctx.ui.custom()` call, defined in (or re-exported from) tasks 03/04's files, to keep `index.ts` readable.
- Per `tui.md`'s Overlay Lifecycle note: never reuse a disposed overlay component instance — always construct fresh instances inside each loop iteration's `ctx.ui.custom()` call (this falls out naturally from calling the factory function each time).
- Double-check `manager` (the module-level `SubagentManager` instance created once in `index.ts`) is the single shared instance passed into both view factories — no new managers should be constructed by the views.

### Acceptance Criteria
- [ ] `/subagents` → select a subagent → `Esc` in detail view → back at the list showing current live state → `Esc` again → command exits cleanly.
- [ ] `/subagents` → select a subagent → `k` in detail view → back at the list, subagent no longer present, a notify confirms the kill.
- [ ] Killing a subagent via the `sdk-subagent` tool (from the main agent) while the list is open updates the open list live without needing to close/reopen `/subagents`.
- [ ] Opening `/subagents` many times in a row does not accumulate stale listeners (spot-checked manually per the subtasks above).
- [ ] `session_shutdown` still cleanly kills all subagents even if `/subagents` UI was left open mid-navigation (should not throw).
