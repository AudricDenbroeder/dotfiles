---
name: task-to-code
description: Implement a specific task from a plan or the next pending task in order.
---


# task-to-code

## Description
Reads a task definition from `{workspace_root}/plans/ACTIVE/PLAN-<name>/<id>-<name>.md`, implements it, and edit the task status in `{workspace_root}/plans/ACTIVE/PLAN-<name>/TASKS.json`.

## Input

- `task-file-path` : The path of the task file to implement (e.g., `@plans/ACTIVE/PLAN-cozy-flight-sim/01-scene-setup.md`).


## To know

- The task `id` is in the file name : `{workspace_root}/plans/ACTIVE/PLAN-<name>/<id>-<name>.md` (e.g, `@plans/ACTIVE/PLAN-cozy-flight-sim/01-scene-setup.md` -> `id` is `01`)

## Process

### 1. Read the task definition

- Read `{workspace_root}/plans/ACTIVE/PLAN-<name>/<id>-<name>.md`

- Extract Overview, Subtasks, Implementation Details, and Acceptance Criteria

### 2. Implement the task
- Follow the subtasks and implementation details in the task file
- Create/modify necessary files
- Ensure acceptance criteria are met
- Keep the scope focused on this single task only

### 3. Update task status
- On success: edit task status to `DONE`
- If stuck/blocked: edit task status to `BLOCKED`


### 4. Error handling
- If implementation fails or files are corrupted:
  - Set status to `BLOCKED`
  - Report the error details clearly

### 5. Review with user
- Report which task was implemented
- List the files that were created or modified
- Report any acceptance criteria that were specifically verified
- Inform the user that `TASKS.json` has been updated
- Ask if they want to continue with the next task
