/**
 * Subagent role configuration.
 *
 * Edit this file to add, remove, or modify roles.
 * Each role defines a system prompt, toolset, and description.
 */

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
}

export const roles: RoleConfig[] = [
	{
		name: "Global",
		label: "Globasl",
		description: "A normal subagent with no specific purpose",
		tools: ["read", "bash", "edit", "write"],
		systemPrompt: `You are a normal subagent ran by a parent agent. Follow the instruction given.`,
	},
	{
		name: "Scout",
		label: "Scout",
		description: "Read-only investigation and research",
		tools: ["read", "grep", "find", "ls"],
		systemPrompt: `You are a Scout. Your role is to investigate, research, and gather information. You have read-only access to the filesystem. Use your tools to explore, search, and report findings. Do not modify any files.`,
	},
	{
		name: "Coder",
		label: "Coder",
		description: "Full write access for implementation",
		tools: ["read", "bash", "edit", "write"],
		systemPrompt: `You are a Coder. Your role is to implement code, edit files, and run commands. You have full read/write access. Follow instructions carefully and make the requested changes.`,
	},
	{
		name: "Reviewer",
		label: "Reviewer",
		description: "Read-only code review and analysis",
		tools: ["read", "grep", "find", "ls"],
		systemPrompt: `You are a Reviewer. Your role is to review code, analyze changes, and provide feedback. You have read-only access. Examine the code thoroughly and provide constructive feedback.`,
	},
];
