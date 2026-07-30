/**
 * registry.ts — in-memory store for sub-agent handles.
 *
 * Each spawned sub-agent is recorded as a `SubagentHandle` keyed by its user-chosen name.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface SubagentHandle {
	name: string;
	paneId: string;
	mailboxDir: string;
}

export class Registry {
	private readonly map = new Map<string, SubagentHandle>();

	get(name: string): SubagentHandle | undefined {
		return this.map.get(name);
	}

	set(handle: SubagentHandle): void {
		this.map.set(handle.name, handle);
	}

	delete(name: string): void {
		this.map.delete(name);
	}

	values(): SubagentHandle[] {
		return Array.from(this.map.values());
	}

	has(name: string): boolean {
		return this.map.has(name);
	}
}

/**
 * Returns the mailbox directory path for a sub-agent name.
 * Uses a safe filename by replacing non-word characters with underscores.
 */
export function getMailboxDir(name: string): string {
	const safeName = name.replace(/[^\w.-]+/g, "_");
	return path.join(os.tmpdir(), "pi-mailbox", safeName);
}

/**
 * Prepares the mailbox directory for use: removes the entire directory and
 * recreates it empty. This clears all stale files (out.txt, out.done, or any
 * other artifacts) left over from a prior run with the same name.
 */
export async function setupMailbox(mailboxDir: string): Promise<void> {
	// Remove the directory (and everything in it) if it exists.
	try {
		await fs.rm(mailboxDir, { recursive: true, force: true });
	} catch {
		/* ignore — directory may not exist */
	}
	// Recreate an empty mailbox directory.
	await fs.mkdir(mailboxDir, { recursive: true });
}

/**
 * Cleans up a mailbox directory entirely (used when killing a sub-agent).
 */
export async function cleanupMailbox(mailboxDir: string): Promise<void> {
	try {
		await fs.rm(mailboxDir, { recursive: true, force: true });
	} catch {
		/* ignore — directory may not exist */
	}
}
