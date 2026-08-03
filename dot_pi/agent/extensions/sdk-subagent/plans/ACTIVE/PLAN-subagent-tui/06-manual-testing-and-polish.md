## Task: Manual Testing & Polish

### Overview
End-to-end manual pass over the whole `/subagents` flow built in tasks 01–05, fixing rendering edge cases and rough edges before considering the feature done.

### Subtasks
- [ ] Full happy-path walkthrough: spawn several subagents with different roles via the `sdk-subagent` tool, open `/subagents`, confirm live status updates, drill into one, send multiple instructions in sequence, observe loader + growing history, navigate back, drill into another, kill it, confirm it's gone, close the UI.
- [ ] Tree-rendering check: with only root-level subagents (today's real scenario) confirm the list looks like a plain flat list with no stray prefixes; if feasible, simulate a nested `parentId` manually (e.g. via a temporary debug tweak) to confirm indentation/connectors visually match `tree` command output, and that killing a parent doesn't break the child rows (they fall back to root per task 02).
- [ ] Edge cases: empty subagent list, a subagent that errors mid-turn (status `"error"`), very long history (many tool calls) in the detail view, narrow terminal width (e.g. 60 cols) for both the overlay list and the full-window detail view, and a theme switch while either view is open (`invalidate()` must not crash or lose styling).
- [ ] Fix whatever issues are found above directly in the relevant task's files, then re-run the happy path once more to confirm nothing regressed.

### Implementation Details
- No new files expected; this task only touches files created/modified in tasks 01–05 as bugs are found.
- Keep a running note (in the PR description, commit message, or a short comment block) of any known limitations intentionally deferred (e.g. detail-view scrolling relying on terminal scrollback per task 04's note) so they're not mistaken for bugs later.
- Prefer minimal, targeted fixes — this is a polish pass, not a redesign. If a fix reveals a structural problem, flag it rather than silently expanding scope.

### Acceptance Criteria
- [ ] The full happy-path walkthrough completes with no crashes, no visibly broken rendering, and no leaked-state artifacts (stale entries after kill, list not updating live, etc.).
- [ ] Empty-state, error-status, long-history, narrow-width, and theme-switch cases all render sensibly (no truncation errors, no width overflow, no thrown exceptions).
- [ ] All checkboxes in tasks 01–05's Acceptance Criteria are verified true in the final build, not just assumed.
- [ ] Any deferred limitations are explicitly documented rather than silently left unexplained.
