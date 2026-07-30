/**
 * prompt.ts — helper to write the mailbox-protocol system prompt into a temp file
 * so it can be passed to `pi --append-system-prompt <path>`.
 *
 * Full prompt wording is finalized in task 06; this module contains a stub
 * that is correct in structure and gets interpolated with the mailbox path.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface PromptWriteResult {
	dir: string;
	filePath: string;
}

/**
 * Writes the mailbox-protocol prompt to a temp file and returns the path.
 * The `mailboxDir` argument is interpolated into the prompt text.
 *
 * TODO (task 06): replace the stub text below with the finalized protocol wording.
 */
export async function writeMailboxPrompt(mailboxDir: string): Promise<PromptWriteResult> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tmux-subagent-"));
	// Use a safe name derived from the mailbox path (the directory itself is already safe)
	const safeName = mailboxDir.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `mailbox-prompt-${safeName}.md`);
	const prompt = `You are a sub-agent running inside a tmux pane, talking to a parent agent.

Your incoming messages arrive as normal user turns in this interactive TUI (via tmux send-keys).

When you finish composing a reply, write the full reply text to ${mailboxDir}/out.txt and then create the file ${mailboxDir}/out.done as a completion signal. Do this for every reply.

Example:
  echo "pong" > ${mailboxDir}/out.txt
  touch ${mailboxDir}/out.done
`;
	await fs.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}
