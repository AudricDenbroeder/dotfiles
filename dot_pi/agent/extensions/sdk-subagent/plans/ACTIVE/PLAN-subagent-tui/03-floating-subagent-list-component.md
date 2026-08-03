## Task: Floating Subagent List Component

### Overview
Build the overlay list UI opened by `/subagents`: a bordered, live-updating tree view of all subagents (using tasks 01+02's data), supporting navigation, selection, and killing.

### Subtasks
- [ ] Build the list component following the `tui.md` "Pattern 1: Selection Dialog (SelectList)" convention: `DynamicBorder` + title `Text` + a `SelectList` whose `SelectItem.label` is the precomputed `<prefix><id> · <role> · <status>` string from task 02's tree rows, + help-text `Text`, + bottom `DynamicBorder`.
- [ ] Subscribe to `manager.onListChange(...)` (task 01) to rebuild the `SelectList` items (recreate the `SelectList` instance, since it has no `setItems`, and restore the previous selection by matching the previously-selected `value`/id) and call `tui.requestRender()` whenever the tree changes (spawn/kill/status transitions) while the overlay is open.
- [ ] Wire `Enter` → `done({ action: "open", id })`, `Esc` → `done({ action: "close" })`, and a `k` key → kill the currently highlighted subagent via `manager.kill(id)` (then let the `onListChange` refresh naturally remove it from the tree; also fold/reparent-to-root any now-orphaned children per task 02's fallback).
- [ ] Show an empty-state message ("No active subagents") when the tree has zero rows, without erroring.

### Implementation Details
- Files to add/modify: a new component, e.g. `~/.pi/agent/extensions/sdk-subagent/SubagentListView.ts`, exporting a factory usable from `ctx.ui.custom<SubagentListResult | null>((tui, theme, keybindings, done) => ...)` per the `tui.md` docs pattern.
- Use `overlay: true` with `overlayOptions` sized reasonably (e.g. `width: "70%"`, `anchor: "center"`, `maxHeight: "80%"`) since this is a floating window per the plan.
- Reuse the exact `SelectList` + theme wiring shown in `tui.md`'s Pattern 1 example (`selectedPrefix`, `selectedText`, `description`, `scrollInfo`, `noMatch` all from `theme.fg(...)`).
- Since `SelectList` has no in-place item update method, the simplest correct approach is: keep a small wrapper object holding the current `SelectList` instance; on every `onListChange` notification, rebuild the tree rows (task 02), rebuild the `SelectItem[]`, construct a new `SelectList`, call `setSelectedIndex` to preserve the previous highlighted id if it still exists (else clamp to `0`), and re-render.
- Remember to unsubscribe from `manager.onListChange` in the `done()` callback path (or wherever the overlay is torn down) — this task owns creating the subscription, task 05 verifies the cleanup end-to-end.
- Return value type suggestion: `{ action: "open"; id: string } | { action: "close" }` so task 05's command handler can drive navigation.

### Acceptance Criteria
- [ ] Running `/subagents` with zero subagents shows a friendly empty state instead of a blank/broken list.
- [ ] With multiple subagents spawned, arrow keys move the highlight, and status/tree changes made by other tool calls while the overlay is open are reflected within roughly a render cycle (no manual refresh needed).
- [ ] Pressing `k` on a highlighted subagent kills it and it disappears from the list live.
- [ ] Pressing `Enter` closes the overlay and returns the selected subagent's id to the caller; pressing `Esc` closes the overlay and signals "close" instead.
- [ ] No dangling `onListChange` subscription remains registered on the manager after the overlay closes (verify by opening/closing `/subagents` repeatedly and checking no duplicate render calls / memory growth via manual inspection or a temporary console log count).
