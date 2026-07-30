---
name: plan-to-task
description: Decompose a high-level plan into detailed, actionable task files with subtasks, implementation details, and acceptance criteria.
---

# plan-to-task

## Description
Takes the structured plan from `brain-to-plan` (`{workspace_root}/plans/ACTIVE/PLAN-<name>/PLAN.md`) and breaks each high-level task into detailed, actionable subtasks. Creates individual task files with implementation guidance and acceptance criteria.

## Process

### 1. Parse the plan
- Read `{workspace_root}/plans/ACTIVE/PLAN-<name>/PLAN.md`
- Extract each task from the `## Tasks` section

- Note difficulty ratings and descriptions for prioritization

### 2. Analyze and prioritize

- Determine which tasks need decomposition (skip trivial/atomic tasks)
- Order tasks by dependency and difficulty (easier tasks first, unless dependencies require otherwise)

- Target subtask count: Aim for 2–4 subtasks per task. If a task has more than 4 subtasks at the 15-60 minute level, it should be split into two separate high-level tasks in the plan (not decomposed further here).

### 3. Generate subtasks for each task
For each high-level task, create concrete subtasks where each subtask is a single implementable step. Include:
- **Task overview**: Brief description of what the task accomplishes

- **Prioritized subtasks**: Numbered checklist of implementation steps

- **Implementation details**: Files to create/modify, code patterns, technical decisions
- **Acceptance criteria**: Clear definition of "done"
- **Granularity rule**: Each subtask should represent 15–60 minutes of focused work. If a subtask can be completed in under 10 minutes, merge it with an adjacent subtask. Subtasks should be logical milestones, not code-level steps — they should describe what to build, not which classes or lines to touch.


### 4a. Create individual task files
- Each task has its own file in the `{workspace_root}/plans/ACTIVE/PLAN-<name>/` directory (same folder as PLAN.md)
- Use numbered naming: `01-task-name.md`, `02-task-name.md`, etc.

- Format each file:


```markdown
## Task: <Task Name>


### Overview
<Brief description>

### Subtasks
- [ ] <Subtask 1>
- [ ] <Subtask 2>
- [ ] ...

### Implementation Details
<Files to create/modify, technical decisions, code patterns>

### Acceptance Criteria

- [ ] <Criterion 1>
- [ ] <Criterion 2>
```

### 4b. Each file are written in one tool call

- Write all task files in a single batch of tool calls
- DO NOT write a file then read the whole context again. Write all the files in one go.

### 5. Create task manifest
- Write `{workspace_root}/plans/ACTIVE/PLAN-<name>/TASKS.json` with an entry for each task file created
- Initialize all entries with `status: "TODO"`
- Write task dependencies 
- Format:

```json

[
  {"id": "01", "name": "scene-setup", "status": "TODO", "depends_on": []},
  {"id": "02", "name": "flight-model", "status": "TODO", "depends_on": ["01"]}
]
```


### 6. Error handling
- Skip tasks that are already atomic (no meaningful subtasks)
- Report which tasks were skipped and why
- Handle malformed plan files gracefully with clear error messages


### 7. Review with user
- Print each task to the user
- Print the TASKS.json to the user
- If adjustment is needed apply and re-judge with user
