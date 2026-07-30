/**
 * tmux.ts — thin CLI wrapper around the `tmux` binary.
 *
 * All calls go through `execFile("tmux", [...args])` so no shell interpolation
 * is needed and user-controlled values are safe to pass as distinct arguments.
 */
import { execFile } from "node:child_process";
import util from "node:util";

const execFileAsync = util.promisify(execFile);

/**
 * Error thrown when tmux is not available or we are not inside a tmux session.
 */
export class TmuxUnavailableError extends Error {
	constructor(reason: string) {
		super(`tmux unavailable: ${reason}`);
	}
}

/**
 * Validates that tmux is available and we are inside a tmux session.
 * Throws `TmuxUnavailableError` with a descriptive message on failure.
 */
export async function checkTmuxAvailable(): Promise<void> {
	if (!process.env.TMUX) {
		throw new TmuxUnavailableError("not inside a tmux session (TMUX env var not set)");
	}
	try {
		await execFileAsync("tmux", ["-V"]);
	} catch (err) {
		throw new TmuxUnavailableError(`tmux binary not found or not executable: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Splits the current window and returns the new pane's tmux id (e.g. `%12`).
 * `opts.direction` controls where the new pane appears; defaults to `"right"`.
 */
export interface SplitWindowOptions {
	direction?: "right" | "below";
	size?: number;
}
export async function splitWindow(opts: SplitWindowOptions = {}): Promise<string> {
	const directionFlag = opts.direction === "below" ? "-v" : "-h";
	const sizeArg = opts.size ? ["-l", String(opts.size)] : [];
	const { stdout } = await execFileAsync("tmux", ["split-window", "-d", directionFlag, ...sizeArg, "-P", "-F", "#{pane_id}"]);
	return stdout.trim();
}

/**
 * Sends keys to a pane.
 *
 * - `text`: literal text sent via `-l` (use this for message bodies).
 * - `keys`: named keys such as `Enter` sent without `-l` (use this for command keys).
 */
export async function sendKeys(paneId: string, text: string): Promise<void> {
	await execFileAsync("tmux", ["send-keys", "-t", paneId, "-l", text]);
}

export async function sendKey(paneId: string, key: string): Promise<void> {
	await execFileAsync("tmux", ["send-keys", "-t", paneId, key]);
}

/**
 * Captures the current contents of a pane. Useful for debugging; not on the
 * main read path for the PoC.
 */
export async function capturePane(paneId: string): Promise<string> {
	const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", paneId]);
	return stdout;
}

/**
 * Sets the pane title so it appears in tmux's status bar.
 */
export async function setPaneTitle(paneId: string, title: string): Promise<void> {
	await execFileAsync("tmux", ["select-pane", "-t", paneId, "-T", title]);
}

/**
 * Returns a list of currently alive pane ids in the current session.
 */
export async function listPanes(): Promise<string[]> {
	const { stdout } = await execFileAsync("tmux", ["list-panes", "-F", "#{pane_id}"]);
	return stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}


/**
 * Kills a pane by id.
 */
export async function killPane(paneId: string): Promise<void> {
	await execFileAsync("tmux", ["kill-pane", "-t", paneId]);
}

/**
 * Returns true if the pane still exists in the current tmux session.
 */
export async function paneExists(paneId: string): Promise<boolean> {
	const panes = await listPanes();
	return panes.includes(paneId);
}

