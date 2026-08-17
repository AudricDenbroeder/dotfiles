/**
 * Workflow Extension
 *
 * Provides /workflow plan command that:
 * 1. Asks the agent to write a plan using a template
 * 2. Validates the plan has required sections
 * 3. If missing sections, asks the agent to correct it
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

function validatePlan(content: string): string[] {
  const missing: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      missing.push(section);
    }
  }
  return missing;
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

export default function (pi: ExtensionAPI) {
  pi.registerCommand("workflow", {
    description: "Manage project workflows (usage: /workflow plan <topic>)",
    getArgumentCompletions: (prefix: string) => {
      if (prefix.startsWith("plan")) {
        return [{ value: "plan", label: "plan" }];
      }
      return null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim().split(/\s+/)[0];
      const topic = args.trim().slice(subcommand.length).trim();

      if (subcommand !== "plan" || !topic) {
        ctx.ui.notify("Usage: /workflow plan <topic>", "error");
        return;
      }

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

      // Wait for the agent to finish writing
      await ctx.waitForIdle();

      // Find the plan file - check if agent told us the path or search for it
      let planPath = getPlanPath(ctx.cwd, topic.replace(/\s+/g, "-").toLowerCase());
      
      // If the exact path doesn't exist, search for PLAN.md in .plans/ACTIVE/
      if (!fs.existsSync(planPath)) {
        const plansDir = path.join(ctx.cwd, ".plans", "ACTIVE");
        if (fs.existsSync(plansDir)) {
          const subdirs = fs.readdirSync(plansDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
          
          // Look for PLAN-*.PLAN.md or just PLAN.md
          const planFiles = subdirs
            .map(dir => path.join(plansDir, dir, "PLAN.md"))
            .filter(p => fs.existsSync(p));
          
          if (planFiles.length > 0) {
            planPath = planFiles[planFiles.length - 1]; // Use the most recently created
          }
        }
      }

      // Read and validate the plan
      const planContent = readPlan(planPath);
      if (!planContent) {
        ctx.ui.notify("Plan file not found. The agent may not have written it.", "warning");
        return;
      }

      const missing = validatePlan(planContent);
      if (missing.length > 0) {
        // Ask the agent to correct the plan
        const correctionPrompt = `The plan at ${planPath} is missing required sections: ${missing.join(", ")}.

Please update the plan to include all required sections from this template:

${PLAN_TEMPLATE}

Make sure to keep the existing content where appropriate and add any missing sections.`;

        pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
        ctx.ui.notify(`Plan missing sections: ${missing.join(", ")}. Asking agent to correct...`, "warning");
      } else {
        ctx.ui.notify(`Plan validated successfully at ${planPath}`, "info");
      }
    },
  });
}
