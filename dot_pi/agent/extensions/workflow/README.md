# Workflow Extension

Turns a vague idea into a validated, human-approved plan, breaks that plan
into concrete tasks, and then implements those tasks one at a time using a
coder/reviewer subagent loop — with git commits at every accepted step.

It's built around one command, `/workflow`, with four subcommands that form
a pipeline:

```
/workflow plan <topic>          → write + validate + accept/reject a high-level plan
/workflow task [<plan>]         → decompose an accepted plan into detailed task files
/workflow implement_next_task   → implement the next TODO task with coder/reviewer subagents
```

Each stage writes its artifacts under `.plans/ACTIVE/PLAN-<name>/` in the
project's working directory, and the whole pipeline is designed to be re-run
safely — every step is either idempotent, or explicitly asks the agent to fix
its output before moving on.

## Directory layout

```
.plans/ACTIVE/PLAN-<plan-name>/
├── PLAN.md            # high-level plan (see PLAN_TEMPLATE)
├── 01-<task-name>.md  # detailed task file (see TASK_TEMPLATE)
├── 02-<task-name>.md
├── TASKS.json         # manifest: [{ id, status, depends_on }, ...]
└── 01-<task-name>.diff  # scratch diff written during review, deleted once the task is DONE
```

`TASKS.json` status values: `"TODO"` → `"NEEDS_REVIEW"` (if the reviewer never
approves within the round limit) or `"DONE"` (once approved and committed).

## `/workflow plan <topic>`

1. Sends the agent a prompt that runs the `interview` skill to clarify the
   idea (goal, audience, features, constraints), then asks it to write
   `PLAN.md` using the required template:
   - `## Plan` — a general description
   - `## Tasks` — numbered `### 0N-<task-name>` entries, each with a
     `Difficulty to implement : <1-5>` and a `Description of the task : ...`
2. **Deterministic template validation** (`validatePendingPlan`): checks that
   `## Plan` and `## Tasks` are present and that there are no unexpected
   top-level `##` sections. If it fails, the extension automatically sends a
   follow-up message asking the agent to fix the file and re-validates once
   the agent settles again — no human involved yet.
3. Once the template validates, the extension asks **you** (via
   `ctx.ui.select`) to accept or reject the plan itself (its content, not its
   formatting):
   - **Accept plan (checkout branch + commit)** — checks out (creating if
     needed) a branch named `pi-agent/<plan-name>` and commits the plan
     directory (`PLAN.md`, plus `TASKS.json` if it already exists) with the
     message `Add plan: <plan-name>`.
   - **Reject plan (ask agent to revise)** — prompts you (via `ctx.ui.input`)
     for an optional comment, then sends the agent a follow-up asking it to
     revise the plan (including your comment if you gave one). The plan stays
     "pending", so once the agent settles again the template check and this
     accept/reject prompt both run again automatically.
   - Dismissing the dialog (Escape) leaves the plan as-is with a warning; you
     can re-run `/workflow plan` or otherwise re-trigger validation later.

`<plan-name>` is derived from the plan's own directory name
(`PLAN-<name>` → `<name>`), not from the raw topic string you typed, so the
branch name and prompts stay short even if the topic sentence was long.

## `/workflow task [<plan_path_or_name>]`

Decomposes an already-written plan into detailed, actionable task files.

- Resolves the plan to use from the argument (absolute/relative path, plan
  name, or falls back to the most recent plan under `.plans/ACTIVE`).
- Re-validates the plan's template (`## Plan` / `## Tasks`) before doing
  anything else.
- Parses each `### 0N-<task-name>` entry (name, difficulty, description) from
  `PLAN.md`.
- Sends the agent a prompt asking it to write one task file per plan task
  (`{planDir}/01-task-name.md`, etc.) using the required template:
  - `## Task: <Task Name>`
  - `### Overview`
  - `### Subtasks` (checkboxes, 15–60 min each)
  - `### Implementation Details`
  - `### Acceptance Criteria` (checkboxes)
  - Trivial/atomic plan tasks may be skipped (the agent reports why).
- Also asks the agent to write `TASKS.json`, a manifest listing every task
  file with `status: "TODO"` and a simple linear `depends_on` chain (each
  task depends on the previous one).
- **Deterministic validation** (`validatePendingTask`): every task file must
  match the required template, and `TASKS.json` must exist. Failures trigger
  an automatic follow-up asking the agent to fix them, same pattern as the
  plan step.
- Once valid, asks **you** to accept or reject the task breakdown:
  - **Accept tasks (commit task files + TASKS.json)** — stages every task
    file plus `TASKS.json` and commits them with
    `Add task breakdown for plan: <plan-name>`. No new branch is created here
    — tasks live on whatever branch the plan was accepted onto.
  - **Reject tasks (ask agent to revise)** — same optional-comment +
    follow-up-message pattern as plan rejection; keeps the task breakdown
    "pending" so it gets re-validated and re-prompted after the agent
    revises it.

## `/workflow implement_next_task [local]`

Implements the next `"TODO"` task from the most recent plan's `TASKS.json`,
using a coder subagent and a reviewer subagent in a review/fix loop, then
commits the result.

1. Finds the latest plan directory and its `TASKS.json`, and picks the first
   task with `status: "TODO"`.
2. Refuses to start if the git working tree isn't clean — otherwise the
   coder's diff (and the final commit) would mix in unrelated pre-existing
   changes.
3. Spawns (or **reuses**, see below) a `coder` subagent and sends it the task
   file's content as its instruction.
4. Enters a review loop (up to 5 rounds, `MAX_REVIEW_ROUNDS`):
   - Stages everything (`git add -A`) and takes the cached diff (also
     written to `<task-id>.diff` for reference).
   - Spawns (or reuses) a `reviewer` subagent and sends it the task
     description + diff. The reviewer's response is parsed for a
     `## Verdict` section; anything that isn't clearly `APPROVED` is treated
     as `CHANGES_REQUESTED` (fail-safe: an unclear review never triggers an
     auto-commit).
   - If changes are requested and rounds remain, sends the reviewer's
     `## Issues` back to the coder as a correction prompt and loops again.
5. **If never approved** after all rounds: marks the task `"NEEDS_REVIEW"` in
   `TASKS.json` and leaves both subagents running for manual inspection via
   `/subagents`. Nothing is committed.
6. **If approved**: marks the task `"DONE"`, deletes the scratch
   `<task-id>.diff` file, re-stages everything (`git add -A`, picking up both
   the `TASKS.json` status update and the diff-file removal), and commits
   with a message summarizing the task and crediting the coder/reviewer
   subagent IDs. **Note:** the commit is not pushed and the coder/reviewer
   subagents are not automatically killed — those calls exist in the code but
   are currently commented out, so changes stay local and subagents stay
   alive for you to inspect or reuse.

Coder/reviewer implementation runs in the background (the command handler
returns immediately); use `/subagents` to monitor progress or intervene.

### Subagent reuse

Spawning a fresh coder/reviewer pair for every single task would lose context
and waste time re-establishing subagents that are often still alive from the
previous task. Before spawning, the extension checks for an existing,
non-errored subagent of the right role (`findExistingSubagent`) — picking the
most recently created one — and reuses it instead of spawning a new one. It
still spawns fresh subagents whenever none exist (e.g. they were killed
manually, or this is a new pi session/instance).

### `local` flag

`/workflow implement_next_task local` overrides both the coder's and
reviewer's model with the *current session's* model instead of each role's
configured default model (falls back to the role default with a warning if
the current session's model can't be resolved).

## Design notes

- **One shared listener, not one per command.** All three "write something,
  then validate/decide" flows (plan, task) go through a single persistent
  `agent_settled` listener. Each command sets a small piece of pending state
  (`pendingPlanName` / `pendingTask`) before it returns; the listener checks
  that state on every settle and only acts when there's queued work, so
  unrelated agent turns are ignored.
- **Deterministic checks are separate from human decisions.** Template/shape
  validation (`validatePendingPlan`, `validatePendingTask`) never touches the
  UI or git — it only decides whether to bounce the file back to the agent
  for a fix. The accept/reject prompts (`promptPlanDecision`,
  `promptTaskDecision`) only run after the deterministic check passes, and a
  human rejection re-arms the same pending state so the next revision flows
  back through both steps automatically.
- **`.gitignore` is the intended defense against stray files.** The
  coder/reviewer loop stages with `git add -A`, which would happily commit
  temp/log/build artifacts left behind by the coder running or testing its
  own code. This extension does not attempt to filter that out in code —
  keep your project's `.gitignore` up to date instead.
- Uses the same shared `SubagentManager` instance as the `sdk-subagent`
  extension (`getSharedSubagentManager()`), so any coder/reviewer subagents
  spawned here also show up in `/subagents`.
