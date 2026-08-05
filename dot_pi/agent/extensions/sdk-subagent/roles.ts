/**
 * Subagent role configuration.
 *
 * Edit this file to add, remove, or modify roles.
 * Each role defines a system prompt, toolset, and description.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

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
