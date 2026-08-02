---
name: brain-to-plan
description: Interview the user about their idea or goal, then produce a structured high-level plan
---

# brain-to-plan

## Description
Takes a vague user idea, goal, or project and produces a structured high-level plan. Uses the `interview` skill to clarify requirements before writing the plan.

## Process

### 1. Gather requirements
- Use the `interview` skill to understand:
  - The user's goal or idea
  - Target audience / users
  - Key features and functionality
  - Constraints (timeline, tech stack, budget, etc.)
  - Success criteria
- If the user already has partial details, ask clarifying questions to fill gaps
- Confirm alignment before proceeding

### 2. Structure the plan
- Create a high-level plan with:
  - **## Plan**: Brief overview of the project/goal
  - **## Tasks**: Numbered high-level tasks with:
    - **Difficulty to implement**: Rating 1-5
    - **Description**: What the task accomplishes
- Order tasks by dependency (upstream tasks first)
- Keep tasks at the right granularity for `plan-to-task` to decompose later


#### Task granularity rules
- Aim **1-3 tasks** for trivial project, **3–7** for medium projects and **7–15** for complex ones
- Each task should represent a **meaningful milestone** (a few hours of work), not a single file or function
- Group by **feature/module**, not by implementation step (e.g., "User Authentication" not "Create login form" + "Create auth API" + "Add session handling")
- Skip trivial setup tasks (git init, basic config) — they belong in the plan description, not as numbered tasks

### 3. Write the plan file
- Save to `{workspace_root}/plans/ACTIVE/PLAN-<short-name>/PLAN.md` (e.g. `{workspace_root}/plans/ACTIVE/PLAN-weather-app/PLAN.md`)
- Use the exact format below

#### Output format (`{workspace_root}/plans/ACTIVE/PLAN-<short-name>/PLAN.md`)


```markdown
## Plan

<General description of the project, goals, and approach>

## Tasks

### 01-<task-name>
Difficulty to implement : <1-5>
Description of the task : <what this task accomplishes>

### 02-<task-name>
Difficulty to implement : <1-5>
Description of the task : <what this task accomplishes>
```

### 4. Review with user
- Print the plan to the user
- Ask for review
- If adjustments are needed, apply them and re-judge with the user
