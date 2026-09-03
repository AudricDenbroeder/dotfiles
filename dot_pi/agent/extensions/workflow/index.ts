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
import { execFileSync } from "node:child_process";
import { getSharedSubagentManager } from "../sdk-subagent/SubagentManager";

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

/** Derive the short plan name (e.g. "analytics-dashboard") from a plan file's path, using its parent "PLAN-<name>" directory rather than the raw (often verbose) topic string. */
function planNameFromPath(planPath: string): string {
  const dirName = path.basename(path.dirname(planPath));
  return dirName.startsWith("PLAN-") ? dirName.slice("PLAN-".length) : dirName;
}


function readPlan(planPath: string): string | null {
  try {
    return fs.readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }
}

function findActivePlanDirs(plansDir: string): string[] {
  if (!fs.existsSync(plansDir)) return [];


  return fs
    .readdirSync(plansDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith("PLAN-"))

    .map(d => d.name)
    .sort((a, b) => b.localeCompare(a));
}

function findLatestPlan(ctx: ExtensionContext): string | null {
  const plansDir = path.join(ctx.cwd, ".plans", "ACTIVE");
  const planDirs = findActivePlanDirs(plansDir);
  if (planDirs.length === 0) return null;

  const planPath = path.join(plansDir, planDirs[0], "PLAN.md");
  return fs.existsSync(planPath) ? planPath : null;
}

/**
 * Build the model picker's option list, mirroring the built-in /model selector:
 * scoped models (from --models / enabledModels) when scoping is configured,
 * otherwise the full available catalogue. Each option is a "provider/modelId"
 * ref (the format subagentManager.spawn() expects). Sorted with the current
 * session model first, then alphabetically by provider, then by model id.
 */
function modelPickerOptions(ctx: ExtensionContext): string[] {
  const scopedModels = ctx.scopedModels.map((s) => s.model);
  const models = scopedModels.length > 0 ? scopedModels : ctx.modelRegistry.getAvailable();
  const current = ctx.model;
  return [...models]
    .sort((a, b) => {
      const aIsCurrent = current ? a.provider === current.provider && a.id === current.id : false;
      const bIsCurrent = current ? b.provider === current.provider && b.id === current.id : false;
      if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;
      return a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
    })
    .map((m) => `${m.provider}/${m.id}`);
}

// ─── Git helpers for the coder/reviewer loop ───────────────────────────────────────

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; error?: string } {
  try {
    const stdout = execFileSync("git", args, { cwd, encoding: "utf-8" });
    return { ok: true, stdout };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string })?.stderr;
    const message = stderr ? String(stderr) : err instanceof Error ? err.message : String(err);
    return { ok: false, stdout: "", error: message.trim() };
  }
}

function gitStatusClean(cwd: string): { ok: boolean; clean: boolean; error?: string } {
  const res = runGit(cwd, ["status", "--porcelain"]);
  if (!res.ok) return { ok: false, clean: false, error: res.error };
  return { ok: true, clean: res.stdout.trim().length === 0 };
}

/** Checkout `branchName`, creating it from the current HEAD if it doesn't already exist. */
function checkoutBranch(cwd: string, branchName: string): { ok: boolean; error?: string; created: boolean } {
  const exists = runGit(cwd, ["rev-parse", "--verify", "--quiet", branchName]);
  const checkout = runGit(cwd, exists.ok ? ["checkout", branchName] : ["checkout", "-b", branchName]);
  if (!checkout.ok) return { ok: false, error: checkout.error, created: !exists.ok };
  return { ok: true, created: !exists.ok };
}

/** Stage one or more specific paths and commit them. Used for committing an accepted plan (and its TASKS.json manifest, if present). */
function stagePathsAndCommit(cwd: string, targetPaths: string[], message: string): { ok: boolean; error?: string; commitHash?: string } {
  const add = runGit(cwd, ["add", ...targetPaths]);
  if (!add.ok) return { ok: false, error: `git add failed: ${add.error}` };
  const commit = runGit(cwd, ["commit", "-m", message]);
  if (!commit.ok) return { ok: false, error: `git commit failed: ${commit.error}` };
  const rev = runGit(cwd, ["rev-parse", "--short", "HEAD"]);
  return { ok: true, commitHash: rev.ok ? rev.stdout.trim() : undefined };
}

/** Stage everything (including new/untracked files) and return the staged diff. */
function stageAndDiff(cwd: string): { ok: boolean; diff: string; error?: string } {
  const add = runGit(cwd, ["add", "-A"]);
  if (!add.ok) return { ok: false, diff: "", error: add.error };
  const diff = runGit(cwd, ["diff", "--cached"]);
  if (!diff.ok) return { ok: false, diff: "", error: diff.error };
  return { ok: true, diff: diff.stdout };
}

/** Commit the currently staged changes and push. Assumes changes are already staged (via stageAndDiff). */
function commitAndPush(cwd: string, message: string): { ok: boolean; error?: string; commitHash?: string } {
  const commit = runGit(cwd, ["commit", "-m", message]);
  if (!commit.ok) return { ok: false, error: `commit failed: ${commit.error}` };

  const rev = runGit(cwd, ["rev-parse", "--short", "HEAD"]);
  const commitHash = rev.ok ? rev.stdout.trim() : undefined;

  //const push = runGit(cwd, ["push"]);
  //if (!push.ok) {
  //  return { ok: false, error: `committed ${commitHash ?? "(unknown hash)"} but push failed: ${push.error}`, commitHash };
  //}

  return { ok: true, commitHash };
}

/** Extract the title from a task file's "## Task: <Name>" heading. */
function extractTaskTitle(taskContent: string): string | null {
  const m = taskContent.match(/^##\s*Task:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

type ReviewVerdict = "APPROVED" | "CHANGES_REQUESTED";

/** Extract a named "## Section" block's body (up to the next "##" heading or end of string). */
function extractSection(response: string, sectionName: string): string | null {
  const regex = new RegExp(`##\\s*${sectionName}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const m = response.match(regex);
  return m ? m[1].trim() : null;
}

/**
 * Parse the reviewer subagent's response, which follows the template defined
 * in its role's system prompt (see sdk-subagent/roles.ts): "## Verdict",
 * "## Issues", "## Rationale". Falls back to CHANGES_REQUESTED when the
 * verdict can't be confidently identified as APPROVED, so a malformed/unclear
 * review never accidentally triggers an auto-commit.
 */
function parseReviewerVerdict(response: string): { verdict: ReviewVerdict; issues: string; rationale: string } {
  const verdictText = extractSection(response, "Verdict") ?? response;
  const approved = /\bAPPROVED\b/i.test(verdictText) && !/CHANGES\s+REQUESTED/i.test(verdictText);

  return {
    verdict: approved ? "APPROVED" : "CHANGES_REQUESTED",
    issues: extractSection(response, "Issues") ?? "",
    rationale: extractSection(response, "Rationale") ?? "",
  };
}

const MAX_REVIEW_ROUNDS = 5;

type ValidationOutcome = "done" | "retry";

export default function (pi: ExtensionAPI) {
  // Manages coder subagents spawned by /workflow implement_next_task. Lives
  // for the duration of the extension session, mirroring the sdk-subagent
  // extension's own manager instance (kept separate since there is no shared
  // cross-extension API to reuse it directly).
  // Shared across extensions (see getSharedSubagentManager) so coder
  // subagents spawned here show up in /subagents (registered by the
  // sdk-subagent extension) too.
  const subagentManager = getSharedSubagentManager();

  /**
   * Find the most recently spawned, still-usable (non-"error") subagent for
   * the given role, so /workflow implement_next_task reuses the coder/reviewer
   * pair across tasks instead of spawning a fresh one for every task. Falls
   * back to spawning (by returning undefined here) when none exist — e.g. the
   * user killed them manually, or this is a new pi session/instance.
   */
  function findExistingSubagent(role: "coder" | "reviewer"): string | undefined {
    const matches = subagentManager
      .list()
      .filter((s) => s.role === role && s.status !== "error")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return matches[0]?.id;
  }

  pi.on("session_shutdown", async () => {
    await subagentManager.shutdown();
  });

  // Set by /workflow plan and /workflow task. The single agent_settled listener
  // below runs the matching validation exactly once, after the agent finishes
  // writing the plan/task files. Reset to null so it never fires again until a
  // new command queues more work.
  let pendingPlanName: string | null = null;
  let pendingTask: { planDir: string; taskFiles: string[]; manifestPath: string } | null = null;


  async function promptPlanDecision(settledCtx: ExtensionContext, planName: string, planPath: string): Promise<ValidationOutcome> {
    const choice = await settledCtx.ui.select(`Plan "${planName}" validated. What would you like to do?`, [
      "Accept plan (checkout branch + commit)",
      "Reject plan (ask agent to revise)",
    ]);

    if (choice === undefined) {
      settledCtx.ui.notify("Plan decision dismissed. Leaving plan as-is; run /workflow plan again or re-trigger validation when ready.", "warning");
      return "done";
    }

    if (choice.startsWith("Accept")) {
      const branchName = `pi-agent/${planName}`;
      const checkout = checkoutBranch(settledCtx.cwd, branchName);
      if (!checkout.ok) {
        settledCtx.ui.notify(`Failed to checkout branch "${branchName}": ${checkout.error}`, "error");
        return "done";
      }

      const planDir = path.dirname(planPath);
      const manifestPath = path.join(planDir, "TASKS.json");
      const hasManifest = fs.existsSync(manifestPath);
      const pathsToCommit = hasManifest ? [planDir, manifestPath] : [planDir];
      const commit = stagePathsAndCommit(settledCtx.cwd, pathsToCommit, `Add plan: ${planName}`);
      if (!commit.ok) {
        settledCtx.ui.notify(`Checked out "${branchName}" but failed to commit the plan: ${commit.error}`, "error");
        return "done";
      }

      settledCtx.ui.notify(
        `Plan accepted. ${checkout.created ? "Created and checked" : "Checked"} out branch "${branchName}" and committed the plan${hasManifest ? " and TASKS.json manifest" : ""} (${commit.commitHash ?? "?"}).`,
        "info",
      );
      return "done";
    }

    // Rejected: optionally collect a comment to steer the revision.
    const comment = await settledCtx.ui.input("Rejection comment (optional)", "What should change?");
    const correctionPrompt = comment && comment.trim().length > 0
      ? `The plan was rejected. Please revise it according to this feedback:

${comment.trim()}`
      : `The plan was rejected. Please revise it and propose an updated version.`;

    pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
    settledCtx.ui.notify("Plan rejected. Asking agent to revise...", "warning");
    return "retry";
  }

  function validatePendingPlan(settledCtx: ExtensionContext, planName: string): ValidationOutcome {
    const planPath = findLatestPlan(settledCtx) ?? getPlanPath(settledCtx.cwd, planName);
    const planContent = readPlan(planPath);
    if (!planContent) {
      settledCtx.ui.notify("Plan file not found. The agent may not have written it.", "warning");

      return "done";
    }

    const issues = validatePlan(planContent);
    if (issues.length > 0) {
      const correctionPrompt = `The plan at ${planPath} has issues: ${issues.join(", ")}.

Please update the plan to match this template:

${PLAN_TEMPLATE}

Make sure to keep the existing content where appropriate and fix any issues.`;

      pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
      settledCtx.ui.notify(`Plan issues: ${issues.join(", ")}. Asking agent to correct...`, "warning");

      return "retry";
    }

    settledCtx.ui.notify(`Plan validated successfully at ${planPath}`, "info");
    return "done";
  }


  function validatePendingTask(settledCtx: ExtensionContext, task: { planDir: string; taskFiles: string[]; manifestPath: string }): ValidationOutcome {
    // Validate all task files
    const existingFiles = task.taskFiles.filter(f => fs.existsSync(f));
    if (existingFiles.length === 0) {
      settledCtx.ui.notify("No task files found. The agent may not have written them.", "warning");
      return "done";
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
      return "retry";
    }

    // Check manifest exists
    if (!fs.existsSync(task.manifestPath)) {
      const correctionPrompt = `TASKS.json not found at ${task.manifestPath}`;
      pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
      settledCtx.ui.notify(`TASKS.json not found at ${task.manifestPath}. The agent may not have written it.`, "warning");
      return "retry";
    }

    settledCtx.ui.notify(`All ${existingFiles.length} tasks validated successfully in ${task.planDir}`, "info");
    return "done";
  }

  async function promptTaskDecision(settledCtx: ExtensionContext, task: { planDir: string; taskFiles: string[]; manifestPath: string }): Promise<ValidationOutcome> {
    const planName = planNameFromPath(path.join(task.planDir, "PLAN.md"));

    const choice = await settledCtx.ui.select(`Tasks for plan "${planName}" validated. What would you like to do?`, [
      "Accept tasks (commit task files + TASKS.json)",
      "Reject tasks (ask agent to revise)",
    ]);

    if (choice === undefined) {
      settledCtx.ui.notify("Task decision dismissed. Leaving task files as-is; re-run /workflow task or re-trigger validation when ready.", "warning");
      return "done";
    }

    if (choice.startsWith("Accept")) {
      const existingFiles = task.taskFiles.filter(f => fs.existsSync(f));
      const pathsToCommit = [...existingFiles, task.manifestPath];
      const commit = stagePathsAndCommit(settledCtx.cwd, pathsToCommit, `Add task breakdown for plan: ${planName}`);
      if (!commit.ok) {
        settledCtx.ui.notify(`Failed to commit task breakdown for plan "${planName}": ${commit.error}`, "error");
        return "done";
      }

      settledCtx.ui.notify(
        `Tasks accepted. Committed ${existingFiles.length} task file(s) and TASKS.json for plan "${planName}" (${commit.commitHash ?? "?"}).`,
        "info",
      );
      return "done";
    }

    // Rejected: optionally collect a comment to steer the revision.
    const comment = await settledCtx.ui.input("Rejection comment (optional)", "What should change?");
    const correctionPrompt = comment && comment.trim().length > 0
      ? `The task breakdown was rejected. Please revise it according to this feedback:

${comment.trim()}`
      : `The task breakdown was rejected. Please revise it and propose an updated version.`;

    pi.sendUserMessage(correctionPrompt, { deliverAs: "followUp" });
    settledCtx.ui.notify("Task breakdown rejected. Asking agent to revise...", "warning");
    return "retry";
  }

  // One persistent listener, shared by every command run. It only acts when a
  // command has queued work, so it never fires repeatedly on unrelated turns.
  pi.on("agent_settled", async (_event, settledCtx: ExtensionContext) => {
    if (pendingPlanName) {
      const planName = pendingPlanName;
      const templateOutcome = validatePendingPlan(settledCtx, planName);
      if (templateOutcome === "retry") {
        // Deterministic template check failed; the agent is being asked to fix
        // it and will re-trigger this same check once it settles again.
        return;
      }

      // Template is valid: ask the user to accept or reject the plan itself.
      const planPath = findLatestPlan(settledCtx) ?? getPlanPath(settledCtx.cwd, planName);
      const displayName = planNameFromPath(planPath);
      const decision = await promptPlanDecision(settledCtx, displayName, planPath);
      if (decision === "done") {
        pendingPlanName = null;
      }
      // decision === "retry" (rejected): keep pendingPlanName set so the
      // revised plan gets re-validated and re-prompted once the agent settles.
      return;
    }

    if (pendingTask) {
      const task = pendingTask;
      const templateOutcome = validatePendingTask(settledCtx, task);
      if (templateOutcome === "retry") {
        // Deterministic template check failed; the agent is being asked to fix
        // it and will re-trigger this same check once it settles again.
        return;
      }

      // Template is valid: ask the user to accept or reject the task breakdown itself.
      const decision = await promptTaskDecision(settledCtx, task);
      if (decision === "done") {
        pendingTask = null;
      }
      // decision === "retry" (rejected): keep pendingTask set so the revised
      // task breakdown gets re-validated and re-prompted once the agent settles.
      return;
    }
  });

  pi.registerCommand("workflow", {
    description: "Manage project workflows (usage: /workflow plan <topic>)",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.split(/\s+/);
      if (parts.length > 1 && parts[0] === "implement_next_task") {
        const last = parts[parts.length - 1];
        const matches = ["local", "ask"].filter((v) => v.startsWith(last));
        if (matches.length === 0) return null;
        return matches.map((value) => ({ value: [...parts.slice(0, -1), value].join(" "), label: value }));
      }
      const subcommands = ["plan", "task", "implement_next_task"];
      const filtered = subcommands.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim().split(/\s+/)[0];
      const topic = args.trim().slice(subcommand.length).trim();
      const subArgs = topic.split(/\s+/).filter(Boolean);


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
        const manifest: Array<{ id: string; status: string; depends_on: string[] }> = planTasks.map(t => ({
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
- Then create the manifest file (TASKS.json) at {manifestPath} with this JSON format:

${JSON.stringify(manifest, null, 2)}

- Skip trivial/atomic tasks that need no decomposition; report which were skipped and why
- Order tasks by dependency and difficulty (easier first, unless dependencies require otherwise)`;

        pi.sendUserMessage(prompt, { expandPromptTemplates: true });

        pendingTask = { planDir, taskFiles, manifestPath };

        return;
      }

      if (subcommand === "implement_next_task") {
        const manifestPath = path.join(ctx.cwd, ".plans", "ACTIVE", "TASKS.json");
        const manifestDir = path.join(ctx.cwd, ".plans", "ACTIVE");

        // Find the latest plan directory
        const planDirs = findActivePlanDirs(manifestDir);

        if (planDirs.length === 0) {
          ctx.ui.notify("No active plans found", "error");
          return;
        }

        const planDir = planDirs[0];

        const taskManifestPath = path.join(manifestDir, planDir, "TASKS.json");

        if (!fs.existsSync(taskManifestPath)) {
          ctx.ui.notify(`No TASKS.json found in plan: ${planDir}`, "error");
          return;
        }

        let manifest: Array<{ id: string; status: string; depends_on: string[] }>;
        try {
          manifest = JSON.parse(fs.readFileSync(taskManifestPath, "utf-8")) as Array<{
            id: string;
            status: string;
            depends_on: string[];
          }>;
        } catch (err) {
          ctx.ui.notify(
            `Failed to read TASKS.json in ${planDir}: ${err instanceof Error ? err.message : String(err)}`,
            "error",

          );
          return;
        }

        const todoTask = manifest.find(t => t.status === "TODO");

        if (!todoTask) {
          ctx.ui.notify("All tasks are complete! No TODO tasks remaining.", "info");
          return;
        }

        const taskFilePath = path.join(manifestDir, planDir, `${todoTask.id}.md`);
        if (!fs.existsSync(taskFilePath)) {
          ctx.ui.notify(`Task file not found: ${taskFilePath}`, "error");
          return;
        }
        const taskContent = fs.readFileSync(taskFilePath, "utf-8");

        // Refuse to start if the working tree already has uncommitted changes:
        // otherwise the coder's diff/review/commit would be contaminated with
        // unrelated pre-existing changes.
        const gitStatus = gitStatusClean(ctx.cwd);
        if (!gitStatus.ok) {
          ctx.ui.notify(`Cannot check git status (${gitStatus.error ?? "unknown error"}). Ensure ${ctx.cwd} is a git repository.`, "error");
          return;
        }
        if (!gitStatus.clean) {
          ctx.ui.notify("Working tree has uncommitted changes. Commit or stash them first so the coder/reviewer/commit only cover this task.", "error");
          return;
        }

        // Model overrides for the coder/reviewer subagents:
        // - "ask": prompt the user to pick one model per role (mirrors /model)
        // - "local": use the current session model for both roles
        // - (no flag): each role's configured default model applies
        const useLocalModel = subArgs.includes("local");
        const useAskModels = subArgs.includes("ask");

        let coderModelRef: string | undefined;
        let reviewerModelRef: string | undefined;

        if (useAskModels) {
          if (!ctx.hasUI) {
            ctx.ui.notify("'ask' requires an interactive session to pick models. Re-run without 'ask' or use 'local'.", "error");
            return;
          }
          const options = modelPickerOptions(ctx);
          if (options.length === 0) {
            ctx.ui.notify("No available models to choose from. Configure a provider (e.g. /login) and re-run.", "error");
            return;
          }

          const coderChoice = await ctx.ui.select(`Pick the coder model for task ${todoTask.id}`, options);
          if (!coderChoice) {
            ctx.ui.notify("Model selection cancelled — nothing spawned. Re-run /workflow implement_next_task ask when ready.", "warning");
            return;
          }

          const reviewerChoice = await ctx.ui.select(`Pick the reviewer model for task ${todoTask.id}`, options);
          if (!reviewerChoice) {
            ctx.ui.notify("Model selection cancelled — nothing spawned. Re-run /workflow implement_next_task ask when ready.", "warning");
            return;
          }

          coderModelRef = coderChoice;
          reviewerModelRef = reviewerChoice;
          ctx.ui.notify(`Selected models — coder: ${coderModelRef}, reviewer: ${reviewerModelRef}`, "info");
        } else if (useLocalModel) {
          const sessionModelRef = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
          if (!sessionModelRef) {
            ctx.ui.notify("Could not resolve current session model for 'local' override; falling back to the subagents' default models.", "warning");
          } else {
            coderModelRef = sessionModelRef;
            reviewerModelRef = sessionModelRef;
          }
        }

        // An existing subagent keeps the model it was spawned with; warn when
        // that differs from a model override the user explicitly requested.
        const warnIfReuseIgnoresModelOverride = (role: "coder" | "reviewer", subagentId: string, requestedRef: string | undefined) => {
          if (!requestedRef) return;
          const subagent = subagentManager.list().find((s) => s.id === subagentId);
          if (subagent && subagent.model && subagent.model !== requestedRef) {
            ctx.ui.notify(
              `Reusing ${role} subagent ${subagentId} with its existing model ${subagent.model}; requested model ${requestedRef} will not apply. Kill it via /subagents first to force the new model.`,
              "warning",
            );
          }
        };

        ctx.ui.notify(`Next task to implement: ${todoTask.id}`, "info");

        let resolvedCoderId = findExistingSubagent("coder");
        if (resolvedCoderId) {
          warnIfReuseIgnoresModelOverride("coder", resolvedCoderId, coderModelRef);
          ctx.ui.notify(`Reusing existing coder subagent ${resolvedCoderId} for task ${todoTask.id}.`, "info");
        } else {
          const spawnResult = await subagentManager.spawn(
            "coder",
            ctx.cwd,
            ctx.model,
            ctx.thinkingLevel,
            ctx.modelRegistry,
            coderModelRef ? { model: coderModelRef } : undefined,
          );

          if (!spawnResult.id) {
            ctx.ui.notify(`Failed to spawn coder subagent: ${spawnResult.errorMessage ?? "unknown error"}`, "error");
            return;
          }

          resolvedCoderId = spawnResult.id;
          ctx.ui.notify(`Spawned coder subagent ${resolvedCoderId}${coderModelRef ? ` (model: ${coderModelRef})` : ""} for task ${todoTask.id}`, "info");
        }

        const instruction = `Implement the following task in this codebase at ${ctx.cwd}.

Task ID: ${todoTask.id}
Task file: ${taskFilePath}

${taskContent}

Implement exactly what is described above (Overview, Subtasks, Implementation Details, Acceptance Criteria).
Do not expand your context with other tasks files.`;

        // Don't await the coder's turn here: `send()` only resolves once the
        // subagent's whole turn settles, which can take a long time. Awaiting
        // it in the command handler would keep this command "in flight" and
        // block other commands (like /subagents) from running until it
        // finishes. Run it in the background instead and let the user
        // monitor/interact with the subagent via /subagents while it works.
        // resolvedCoderId is always set by this point: either reused from an
        // existing coder subagent, or freshly spawned above (the "return" on
        // spawn failure means we never reach here without a value).
        const coderId = resolvedCoderId as string;
        ctx.ui.notify(`Coder subagent ${coderId} is working on task ${todoTask.id} in the background. Use /subagents to monitor or interact with it.`, "info");

        const diffFilePath = path.join(manifestDir, planDir, `${todoTask.id}.diff`);

        const readManifest = (): Array<{ id: string; status: string; depends_on: string[] }> =>
          JSON.parse(fs.readFileSync(taskManifestPath, "utf-8"));

        const setTaskStatus = (status: string): boolean => {
          let fresh: Array<{ id: string; status: string; depends_on: string[] }>;
          try {
            fresh = readManifest();
          } catch (err) {
            ctx.ui.notify(`Failed to re-read TASKS.json to update task "${todoTask.id}": ${err instanceof Error ? err.message : String(err)}`, "error");
            return false;
          }
          const freshTask = fresh.find(t => t.id === todoTask.id);
          if (!freshTask) {
            ctx.ui.notify(`Task "${todoTask.id}" no longer found in TASKS.json.`, "warning");
            return false;
          }
          freshTask.status = status;
          fs.writeFileSync(taskManifestPath, JSON.stringify(fresh, null, 2));
          return true;
        };

        void (async () => {
          try {
            const sendResult = await subagentManager.send(coderId, instruction);

            if (!sendResult.success) {
              ctx.ui.notify(`Coder subagent ${coderId} failed to respond for task ${todoTask.id}. It is still available via /subagents.`, "error");
              return;
            }

            ctx.ui.notify(`Coder subagent ${coderId} finished task ${todoTask.id}:\n${sendResult.response ?? "(no text response)"}`, "info");

            let reviewerId: string | null = null;
            let approved = false;
            let lastReviewText = "";
            let lastRationale = "";

            for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
              const staged = stageAndDiff(ctx.cwd);
              if (!staged.ok) {
                ctx.ui.notify(`Failed to stage/diff task ${todoTask.id}'s changes: ${staged.error}`, "error");
                return;
              }
              if (!staged.diff.trim()) {
                ctx.ui.notify(`Coder subagent ${coderId} produced no file changes for task ${todoTask.id}. Aborting review — inspect via /subagents.`, "error");
                return;
              }
              fs.writeFileSync(diffFilePath, staged.diff);

              if (!reviewerId) {
                const existingReviewer = findExistingSubagent("reviewer");
                if (existingReviewer) {
                  reviewerId = existingReviewer;
                  warnIfReuseIgnoresModelOverride("reviewer", reviewerId, reviewerModelRef);
                  ctx.ui.notify(`Reusing existing reviewer subagent ${reviewerId} for task ${todoTask.id}.`, "info");
                } else {
                  const reviewerSpawn = await subagentManager.spawn(
                    "reviewer",
                    ctx.cwd,
                    ctx.model,
                    ctx.thinkingLevel,
                    ctx.modelRegistry,
                    reviewerModelRef ? { model: reviewerModelRef } : undefined,
                  );
                  if (!reviewerSpawn.id) {
                    ctx.ui.notify(`Failed to spawn reviewer subagent for task ${todoTask.id}: ${reviewerSpawn.errorMessage ?? "unknown error"}`, "error");
                    return;
                  }
                  reviewerId = reviewerSpawn.id;
                  ctx.ui.notify(`Spawned reviewer subagent ${reviewerId}${reviewerModelRef ? ` (model: ${reviewerModelRef})` : ""} for task ${todoTask.id}`, "info");
                }
              }

              const reviewMessage = round === 1
                ? `Review this implementation against the task below. The full diff is saved at ${diffFilePath} and is also embedded here.

Task ID: ${todoTask.id}
Task file: ${taskFilePath}

${taskContent}

Diff:
---
${staged.diff}
---`
                : `The coder subagent has addressed your previous feedback. Re-review the updated diff, saved at ${diffFilePath} and also embedded here.

Diff:
---
${staged.diff}
---`;

              const reviewResult = await subagentManager.send(reviewerId, reviewMessage);
              if (!reviewResult.success || !reviewResult.response) {
                ctx.ui.notify(`Reviewer subagent ${reviewerId} failed to respond for task ${todoTask.id} (round ${round}/${MAX_REVIEW_ROUNDS}). It is still available via /subagents.`, "error");
                return;
              }

              const { verdict, issues, rationale } = parseReviewerVerdict(reviewResult.response);
              lastReviewText = reviewResult.response;
              lastRationale = rationale;

              if (verdict === "APPROVED") {
                ctx.ui.notify(`Reviewer subagent ${reviewerId} approved task ${todoTask.id} (round ${round}/${MAX_REVIEW_ROUNDS}).${rationale ? ` ${rationale}` : ""}`, "info");
                approved = true;
                break;
              }

              ctx.ui.notify(`Reviewer subagent ${reviewerId} requested changes for task ${todoTask.id} (round ${round}/${MAX_REVIEW_ROUNDS}).`, "warning");

              if (round === MAX_REVIEW_ROUNDS) {
                break;
              }

              const correctionMessage = `The reviewer requested changes. Address every [BLOCKING] item and any [SUGGESTION] you accept (briefly note any you decline and why), then reply with a summary of what changed.

Reviewer feedback:
---
${issues || reviewResult.response}
---`;

              const coderFix = await subagentManager.send(coderId, correctionMessage);
              if (!coderFix.success) {
                ctx.ui.notify(`Coder subagent ${coderId} failed to respond to review feedback for task ${todoTask.id} (round ${round}/${MAX_REVIEW_ROUNDS}). It is still available via /subagents.`, "error");
                return;
              }
              ctx.ui.notify(`Coder subagent ${coderId} applied fixes for task ${todoTask.id} (round ${round}/${MAX_REVIEW_ROUNDS}).`, "info");
            }

            if (!approved) {
              setTaskStatus("NEEDS_REVIEW");
              ctx.ui.notify(
                `Task ${todoTask.id} did not get reviewer approval after ${MAX_REVIEW_ROUNDS} round(s). Marked "NEEDS_REVIEW" in ${taskManifestPath}. ` +
                `Coder (${coderId}) and reviewer (${reviewerId ?? "n/a"}) subagents are still running — inspect/continue via /subagents.\n\nLast review:\n${lastReviewText}`,
                "warning",
              );
              return;
            }

            setTaskStatus("DONE");

            // Remove the scratch diff file now that the task is approved — it's
            // only useful during review and shouldn't be committed.
            if (fs.existsSync(diffFilePath)) {
              fs.rmSync(diffFilePath);
            }

            // Re-stage everything so the TASKS.json status update (written
            // after the last stageAndDiff() call above) and the diff-file
            // removal are included in the same commit as the task's changes.
            const restage = runGit(ctx.cwd, ["add", "-A"]);
            if (!restage.ok) {
              ctx.ui.notify(`Task ${todoTask.id} was approved but failed to stage TASKS.json/diff cleanup: ${restage.error}. Changes remain, subagents left running for inspection via /subagents.`, "error");
              return;
            }

            const title = extractTaskTitle(taskContent) ?? todoTask.id;
            const commitMessage = `${todoTask.id}: ${title}\n\n${lastRationale || "Reviewed and approved by reviewer subagent."}\n\nCo-authored via coder/reviewer subagents (${coderId} / ${reviewerId}).`;

            const commitResult = commitAndPush(ctx.cwd, commitMessage);
            if (!commitResult.ok) {
              ctx.ui.notify(`Task ${todoTask.id} was approved but commit/push failed: ${commitResult.error}. Changes remain staged; subagents left running for inspection via /subagents.`, "error");
              return;
            }

            ctx.ui.notify(`Task ${todoTask.id} approved, committed (${commitResult.commitHash ?? "?"}) and pushed. Marked DONE in ${taskManifestPath}.`, "info");

            // Free both subagents now that their work has been recorded.
            //await subagentManager.kill(coderId);
            //if (reviewerId) {
            //  await subagentManager.kill(reviewerId);
            //}
          } catch (err) {
            ctx.ui.notify(`Error while implementing/reviewing task ${todoTask.id}: ${err instanceof Error ? err.message : String(err)}`, "error");
          }
        })();

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

`;

      // Send the instruction to the agent
      pi.sendUserMessage(prompt, { expandPromptTemplates: true });


      pendingPlanName = planName;
    },
  });
}

