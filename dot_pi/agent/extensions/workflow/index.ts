/**
 * Workflow Extension
 *
 * Provides /workflow plan command that:
 * 1. Asks the agent to write a plan using a template
 * 2. Validates the plan has required sections
 * 3. If missing sections, asks the agent to correct it
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const PLAN_TEMPLATE = `## Plan

<General description of the project, goals, and approach>

## Tasks

### 01-<task-name>
Difficulty to implement : <1-5>
Description of the task : <what this task accomplishes>

### 02-<task-name>
Difficulty to implement : <1-5>
Description of the task : <what this task accomplishes>`;

const REQUIRED_SECTIONS = ["## Plan", "## Tasks"];
const REQUIRED_TASK_SECTIONS = ["## Task:", "### Overview", "### Subtasks", "### Implementation Details", "### Acceptance Criteria"];

const TASK_TEMPLATE = `## Task: <Task Name>

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
- [ ] <Criterion 2>`;

function validatePlan(content: string): string[] {
  const issues: string[] = [];

  // Check required sections are present at the start of a line
  for (const section of REQUIRED_SECTIONS) {
    const sectionRegex = new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
    if (!sectionRegex.test(content)) {
      issues.push(`missing required section: ${section}`);
    }
  }

  // Check for unexpected top-level sections (## ...)
  const headerRegex = /^##\s+\S.+$/gm;
  const headers = content.match(headerRegex) ?? [];
  const allowedHeaders = REQUIRED_SECTIONS;
  const unexpected = headers.filter(h => !allowedHeaders.includes(h));
  if (unexpected.length > 0) {
    issues.push(`unexpected sections: ${unexpected.join(", ")}`);
  }

  return issues;
}

function validateTask(content: string): string[] {
  const issues: string[] = [];

  // Check required sections are present at the start of a line
  for (const section of REQUIRED_TASK_SECTIONS) {
    const sectionRegex = new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
    if (!sectionRegex.test(content)) {
      issues.push(`missing required section: ${section}`);
    }
  }

  const headerRegex = /^##\s+\S.+$/gm;
  const headers = content.match(headerRegex) ?? [];
  const unexpected = headers.filter(h => !REQUIRED_TASK_SECTIONS.some(s => h.startsWith(s)));
  if (unexpected.length > 0) {
    issues.push(`unexpected sections: ${unexpected.join(", ")}`);
  }

  return issues;
}

function getPlanPath(cwd: string, planName: string): string {
  return path.join(cwd, ".plans", "ACTIVE", `PLAN-${planName}`, "PLAN.md");
}

function readPlan(planPath: string): string | null {
  try {
    return fs.readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }
}

function findLatestPlan(ctx: ExtensionContext): string | null {
  const plansDir = path.join(ctx.cwd, ".plans", "ACTIVE");
  if (!fs.existsSync(plansDir)) return null;

  const subdirs = fs
    .readdirSync(plansDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const planFiles = subdirs
    .map(dir => path.join(plansDir, dir, "PLAN.md"))
    .filter(p => fs.existsSync(p));

  return planFiles.length > 0 ? planFiles[planFiles.length - 1] : null;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("workflow", {
    description: "Manage project workflows (usage: /workflow plan <topic>)",
    getArgumentCompletions: (prefix: string) => {
      const subcommands = ["plan", "task"];
      const filtered = subcommands.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim().split(/\s+/)[0];
      const topic = args.trim().slice(subcommand.length).trim();

      if (subcommand === "task") {
        const planArg = args.trim().slice(subcommand.length).trim();

        let planPath: string | null = null;
        if (planArg) {
          // Try as absolute/relative path first, then as plan name
          const resolved = path.resolve(ctx.cwd, planArg);
          if (fs.existsSync(resolved)) {
            planPath = resolved;
          } else {
            // Try as a plan name
            planPath = getPlanPath(ctx.cwd, planArg);
            if (!fs.existsSync(planPath)) {
              // Fall back to latest plan
              planPath = findLatestPlan(ctx);
            }
          }
        } else {
          planPath = findLatestPlan(ctx);
        }

        if (!planPath || !fs.existsSync(planPath)) {
          ctx.ui.notify("Usage: /workflow task [<plan_path_or_name>] — no plan found", "error");
          return;
        }

        const planContent = fs.readFileSync(planPath, "utf-8");
        const planIssues = validatePlan(planContent);
        if (planIssues.length > 0) {
          ctx.ui.notify(`Plan validation failed before task decomposition: ${planIssues.join(", ")}`, "error");
          return;
        }

        // Extract plan dir from plan path
        const planDir = path.dirname(planPath);

        // Extract task info from the plan
        const taskRegex = /###\s+(\d+-[\w-]+)[^\n]*\n.*?Difficulty to implement\s*:\s*(\d+)[^\n]*\n.*?Description of the task\s*:\s*([^\n]+)/gms;
        const planTasks: Array<{ id: string; difficulty: number; description: string }> = [];
        let match;
        while ((match = taskRegex.exec(planContent)) !== null) {
          planTasks.push({ id: match[1], difficulty: parseInt(match[2], 10), description: match[3].trim() });
        }

        if (planTasks.length === 0) {
          ctx.ui.notify("No tasks found in plan. Cannot decompose.", "error");
          return;
        }

        const taskFiles = planTasks.map(t => path.join(planDir, `${t.id}.md`));
        const manifestPath = path.join(planDir, "TASKS.json");
        const manifest: Array<{ id: string; name: string; status: string; depends_on: string[] }> = planTasks.map(t => ({
          id: t.id,
          status: "TODO",
          depends_on: []
        }));
        for (let i = 1; i < manifest.length; i++) {
          manifest[i].depends_on = [manifest[i - 1].id];
        }

        const prompt = `You are decomposing a high-level project plan into detailed, actionable tasks.

Plan file: ${planPath}
Plan directory: ${planDir}

Plan tasks:
${planTasks.map(t => `  - ${t.id} (difficulty ${t.difficulty}): ${t.description}`).join("\n")}

For each high-level task, create a detailed task file in the same directory as the plan.
Use this exact template:

${TASK_TEMPLATE}

Rules:
- One task file per plan task, named like {planDir}/01-task-name.md
- Break each plan task into 2–4 concrete subtasks (checkboxes)
- Each subtask represents 15–60 minutes of focused work; merge subtasks under 10 minutes
- List specific files to create/modify
- Include technical decisions and code patterns
- Write clear acceptance criteria (checkboxes)
- Write all task files in a single batch of tool calls (no reading back)
- Then create {manifestPath}/TASKS.json with this JSON format:

${JSON.stringify(manifest, null, 2)}

- Skip trivial/atomic tasks that need no decomposition; report which were skipped and why
- Order tasks by dependency and difficulty (easier first, unless dependencies require otherwise)`;

        pi.sendUserMessage(prompt, { expandPromptTemplates: true });

        pi.on("agent_settled", (_event, settledCtx: ExtensionContext) => {
          // Validate all task files
          const existingFiles = taskFiles.filter(f => fs.existsSync(f));
          if (existingFiles.length === 0) {
            settledCtx.ui.notify("No task files found. The agent may not have written them.", "warning");
            return;
          }

          const issues: string[] = [];
          for (const taskFile of existingFiles) {
            const content = fs.readFileSync(taskFile, "utf-8");
            const fileIssues = validateTask(content);
            if (fileIssues.length > 0) {
              issues.push(`${path.basename(taskFile)}: ${fileIssues.join(", ")}`);
            }
          }

          if (issues.length > 0) {
            const correctionPrompt = `Some task files have issues:
${issues.join("\n")}

Please update each affected file to match this template:

${TASK_TEMPLATE}

Make sure to keep the existing content where appropriate and fix any issues.`;

            pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
            settledCtx.ui.notify(`Task issues found: ${issues.join(", ")}. Asking agent to correct...`, "warning");
            return;
          }

          // Check manifest exists
          if (!fs.existsSync(manifestPath)) {
            const correctionPrompt = `TASKS.json not found at ${manifestPath}`;
            pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
            settledCtx.ui.notify(`TASKS.json not found at ${manifestPath}. The agent may not have written it.`, "warning");
            return;
          }

          settledCtx.ui.notify(`All ${existingFiles.length} tasks validated successfully in ${planDir}`, "info");
        });

        return;
      }

      if (subcommand !== "plan" || !topic) {
        ctx.ui.notify("Usage: /workflow plan <topic>", "error");
        return;
      }

      const planName = topic.replace(/\s+/g, "-").toLowerCase();

      // Ask the agent to write the plan
      const prompt = `Takes a vague user idea, goal, or project and produces a structured high-level plan. Uses the \`interview\` skill to clarify requirements before writing the plan.
The topic is : "${topic}"

## Process

### 1. Gather requirements
- Use the \`interview\` skill to understand:
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
- Keep tasks at the right granularity 


#### Task granularity rules
- Aim **1-3 tasks** for trivial project, **3–7** for medium projects and **7–15** for complex ones
- Each task should represent a **meaningful milestone** (a few hours of work), not a single file or function
- Group by **feature/module**, not by implementation step (e.g., "User Authentication" not "Create login form" + "Create auth API" + "Add session handling")
- Skip trivial setup tasks (git init, basic config) — they belong in the plan description, not as numbered tasks

### 3. Write the plan file
- Save to \`{workspace_root}/.plans/ACTIVE/PLAN-<short-name>/PLAN.md\` (e.g. \`{workspace_root}/.plans/ACTIVE/PLAN-weather-app/PLAN.md\`)
- Use the exact format below

#### Output format (\`{workspace_root}/.plans/ACTIVE/PLAN-<short-name>/PLAN.md\`)

${PLAN_TEMPLATE}

### 4. Review with user
- Print the plan to the user
- Ask for review
- If adjustments are needed, apply them and re-judge with the user`;

      // Send the instruction to the agent
      pi.sendUserMessage(prompt, { expandPromptTemplates: true });

      // Persistent listener — registers once, fires on every agent_settled
      pi.on("agent_settled", (_event, settledCtx: ExtensionContext) => {
        const planPath =
          findLatestPlan(settledCtx) ??
          getPlanPath(settledCtx.cwd, planName);

        const planContent = readPlan(planPath);
        if (!planContent) {
          settledCtx.ui.notify("Plan file not found. The agent may not have written it.", "warning");
          return;
        }

        const issues = validatePlan(planContent);
        if (issues.length > 0) {
          const correctionPrompt = `The plan at ${planPath} has issues: ${issues.join(", ")}.

Please update the plan to match this template:

${PLAN_TEMPLATE}

Make sure to keep the existing content where appropriate and fix any issues.`;

          pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
          settledCtx.ui.notify(`Plan issues: ${issues.join(", ")}. Asking agent to correct...`, "warning");
          return;
        }

        settledCtx.ui.notify(`Plan validated successfully at ${planPath}`, "info");
      });
    },
  });
}
