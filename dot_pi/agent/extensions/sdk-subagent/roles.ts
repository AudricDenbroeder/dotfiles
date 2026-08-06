/**
 * Subagent role configuration.
 *
 * Edit this file to add, remove, or modify roles.
 * Each role defines a system prompt, toolset, and description.
 */

import type { ThinkingLevel, AgentSession } from "@earendil-works/pi-agent-core";
import { getDocsPath, getExamplesPath, getReadmePath, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";

export interface RoleConfig {
	/** Unique name used to reference this role (case-sensitive). */
	name: string;
	/** Human-readable label shown in UI. Defaults to `name` if omitted. */
	label?: string;
	/** System prompt injected into the subagent's context. */
	systemPrompt: string;
	/** Tool names available to this role. */
	tools: string[];
	/** Short description shown when listing available roles. */
	description?: string;
	/**
	 * Default model to use for this role, in provider/modelId format
	 * (e.g. "github-copilot/claude-opus-4-5" or if using llamacpp :
     *  "llama.cpp/KAT-Coder-V2.5-bf16-128k"). 
     * When set, subagents spawned with this role will use this model 
     * instead of inheriting the parent.
	 */
	model?: string;
	/**
	 * Default thinking level for this role.
	 * Overrides the parent's thinking level when this role is spawned.
	 */
	thinkingLevel?: ThinkingLevel;
}

/**
 * Build a subagent system prompt by merging core context with role-specific guidance.
 *
 * This function constructs a system prompt for a subagent by:
 * 1. Reusing building blocks from pi-coding-agent (documentation paths, skill formatting)
 * 2. Extracting tool snippets from the created session
 * 3. Building a tailored prompt with role-specific tools only
 * 4. Appending the role-specific system prompt guidance
 *
 * This ensures subagents inherit the same context-awareness as the parent agent
 * (tool descriptions, Pi documentation references, current working directory)
 * while maintaining role-specific behavioral guidance.
 *
 * @param session The AgentSession created for this subagent (has tool registry and metadata)
 * @param role The role configuration containing role-specific guidance
 * @param cwd The current working directory for the subagent session
 * @returns System prompt with core context followed by role guidance
 */
export function buildSubagentPrompt(session: AgentSession, role: RoleConfig, cwd: string): string {
	const promptCwd = cwd.replace(/\\/g, "/");

	// Extract tool snippets from the session's internal tool registry
	// The session has _toolPromptSnippets and _toolPromptGuidelines set up by createAgentSession
	const toolSnippets = extractToolSnippets(session, role.tools);
	const promptGuidelines = extractToolGuidelines(session, role.tools);

	// Get Pi documentation paths using the same config functions as the main agent
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list
	const visibleTools = role.tools.filter((name) => !!toolSnippets[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n") : "(none)";

	// Build guidelines
	const guidelinesList = [];
	const guidelinesSet = new Set<string>();

	const addGuideline = (guideline: string) => {
		if (guidelinesSet.has(guideline)) return;
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	// Add tool-specific guidelines
	for (const guideline of promptGuidelines) {
		addGuideline(guideline);
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	// Extract skills if available and role has read tool
	const hasRead = role.tools.includes("read");
	const loadedSkills = extractSkills(session);
	const skillsSection = hasRead && loadedSkills.length > 0 ? "\n\n" + formatSkillsForPrompt(loadedSkills) : "";

	// Build the complete prompt with our own structure
	let prompt = `Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

	prompt += skillsSection;
	prompt += `\n\nCurrent working directory: ${promptCwd}`;

	// Append role-specific guidance
	let final_prompt = `${role.systemPrompt}\n\n${prompt}`;

	return final_prompt;
}

/**
 * Extract tool snippets from the session's tool registry, filtered to the given tool names.
 * Accesses private _toolPromptSnippets field (TS-only privacy, not enforced in JS).
 */
function extractToolSnippets(session: AgentSession, toolNames: string[]): Record<string, string> {
	const snippets: Record<string, string> = {};
	const sessionRecord = session as Record<string, any>;
	const toolSnippetsMap = sessionRecord._toolPromptSnippets as Map<string, string> | undefined;

	if (toolSnippetsMap) {
		for (const name of toolNames) {
			const snippet = toolSnippetsMap.get(name);
			if (snippet) {
				snippets[name] = snippet;
			}
		}
	}

	return snippets;
}

/**
 * Extract tool-specific guidelines from the session's tool registry, filtered to the given tool names.
 * Accesses private _toolPromptGuidelines field (TS-only privacy, not enforced in JS).
 */
function extractToolGuidelines(session: AgentSession, toolNames: string[]): string[] {
	const guidelines: string[] = [];
	const sessionRecord = session as Record<string, any>;
	const guidelinesMap = sessionRecord._toolPromptGuidelines as Map<string, string[]> | undefined;

	if (guidelinesMap) {
		for (const name of toolNames) {
			const toolGuidelines = guidelinesMap.get(name);
			if (toolGuidelines) {
				guidelines.push(...toolGuidelines);
			}
		}
	}

	return guidelines;
}

/**
 * Extract loaded skills from the session's resource loader.
 * Accesses private _resourceLoader field (TS-only privacy, not enforced in JS).
 */
function extractSkills(session: AgentSession): any[] {
	const sessionRecord = session as Record<string, any>;
	const resourceLoader = sessionRecord._resourceLoader as Record<string, any> | undefined;

	if (resourceLoader && typeof resourceLoader.getSkills === "function") {
		const skillsData = resourceLoader.getSkills();
		return skillsData?.skills || [];
	}

	return [];
}

export const roles: RoleConfig[] = [
	{
		name: "global",
		label: "global",
		description: "A normal subagent with no specific purpose",
		tools: ["read", "bash", "edit", "write"],
		model: "github-copilot/gpt-5-mini",
		thinkingLevel: "off",
		systemPrompt: `You are a normal subagent ran by a parent agent. Follow the instruction given.`,
	},
	{
		name: "scout",
		label: "scout",
		description: "Read-only investigation and research",
		tools: ["read", "grep", "find", "ls"],
		model: "github-copilot/gpt-5.6-luna",
		thinkingLevel: "off",
		systemPrompt: `You are the Scout, a codebase exploration specialist. You are spawned to investigate specific questions and report back only the essential information, so the user/parent agent can proceed without loading unnecessary context.

## Your Purpose
The user/parent agent delegates exploration to you to keep its own context lean. Your value is compression: you read broadly, but report only what matters for planning.

## Responsibilities
- Investigate the codebase to answer the user/parent agent's specific question.
- Locate relevant files, functions, patterns, dependencies, and conventions.
- Distill findings into a tight, structured report.

## Rules
- NEVER write or edit code. You only read and report.
- Answer the user/parent agent's question first; everything else supports it.
- Prefer \`file:line\` references over pasting code.
- Include code snippets ONLY when a description is insufficient—keep them minimal.
- Never speculate. If something is unknown or missing, state it explicitly.

- Omit any output section that has nothing to report—do not pad.
- Be precise: exact paths, exact names, exact locations.

## Output Format
Respond using this structure (skip empty sections):

\`\`\`md
## Summary

<1-2 sentences directly answering the user/parent agent's question>

## Relevant Locations
- \`path/to/file.ext:L120-145\` — <why it matters, one line>
- \`path/to/other.ext\` — <why it matters, one line>

## Key Details
- <fact needed">
- <existing pattern or convention to follow>


## Risks / Notes
- <ambiguity, missing info, or gotcha>
\`\`\`
        `,
	},
	{
		name: "coder",
		label: "coder",
		description: "Full write access for implementation",
		tools: ["read", "bash", "edit", "write"],
		model: "github-copilot/claude-haiku-4.5",
		thinkingLevel: "medium",
		systemPrompt: `You are a Coder. Your role is to implement code, edit files, and run commands. You have full read/write access. Follow instructions carefully and make the requested changes.`,
	},
	{
		name: "reviewer",
		label: "reviewer",
		description: "Read-only code review and analysis",
		tools: ["read", "grep", "find", "ls"],
		model: "github-copilot/gpt-5.6-terra",
		thinkingLevel: "medium",
		systemPrompt: `You are a Reviewer. Your role is to review code, analyze changes, and provide feedback. You have read-only access. Examine the code thoroughly and provide constructive feedback.`,
	},
];
