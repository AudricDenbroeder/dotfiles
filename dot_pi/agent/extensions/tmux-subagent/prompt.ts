/**
 * prompt.ts — helper to write the mailbox-protocol system prompt (plus an
 * optional role-specific addendum, see roles.ts) into a temp file so it can
 * be passed to `pi --append-system-prompt <path>`.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ROLE_DEFINITIONS, type Role } from "./roles.js";

export interface PromptWriteResult {
	dir: string;
	filePath: string;
}

/**
 * Writes the mailbox-protocol prompt (and, if provided, a role-specific
 * addendum) to a temp file and returns the path. The `mailboxDir` argument
 * is interpolated into the prompt text.
 *
 * The mailbox protocol section is always included, regardless of role, since
 * it is required infrastructure for parent/sub-agent communication. The role
 * text (if any) is appended afterward as persona/task guidance.
 */
export async function writeMailboxPrompt(mailboxDir: string, role?: Role): Promise<PromptWriteResult> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tmux-subagent-"));
	// Use a safe name derived from the mailbox path (the directory itself is already safe)
	const safeName = mailboxDir.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `mailbox-prompt-${safeName}.md`);
	const basePrompt = `You are a sub-agent running inside a tmux pane, talking to a parent agent.

Your incoming messages arrive as normal user turns in this interactive TUI (via tmux send-keys).

When you finish composing a reply, it is MANDATORY to write the full reply text to ${mailboxDir}/out.txt and then create the file ${mailboxDir}/out.done as a completion signal. Do this for every reply.

Example:
  echo "pong" > ${mailboxDir}/out.txt
  touch ${mailboxDir}/out.done
`;
	const prompt = role ? `${basePrompt}\n---\n\n${ROLE_DEFINITIONS[role].prompt}\n` : basePrompt;
	await fs.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}
