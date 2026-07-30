/**
 * polling.ts — utility for polling file-existence with exponential backoff.
 */
import * as fs from "node:fs/promises";

export interface PollOptions {
	/** Initial delay between polls in ms (default: 300) */
	initialDelayMs?: number;
	/** Maximum delay between polls in ms (default: 2000) */
	maxDelayMs?: number;
	/** Timeout for the entire poll in ms (default: 60000) */
	timeoutMs?: number;
	/** Optional abort signal to cancel polling early */
	signal?: AbortSignal;
}

export interface PollResult {
	/** True if the file was found before timeout */
	found: boolean;
	/** Elapsed milliseconds */
	elapsedMs: number;
}

/**
 * Polls for a file to exist at the given path using exponential backoff.
 * Respects an AbortSignal for cancellation.
 */
export async function waitForFile(
	path: string,
	opts: PollOptions = {},
): Promise<PollResult> {
	const {
		initialDelayMs = 300,
		maxDelayMs = 2000,
		timeoutMs = 60000,
		signal,
	} = opts;

	const start = Date.now();
	let delay = initialDelayMs;

	while (true) {
		// Check if we've been aborted
		if (signal?.aborted) {
			return { found: false, elapsedMs: Date.now() - start };
		}

		// Check for timeout
		if (Date.now() - start >= timeoutMs) {
			return { found: false, elapsedMs: Date.now() - start };
		}

		// Check if file exists
		try {
			await fs.access(path);
			return { found: true, elapsedMs: Date.now() - start };
		} catch {
			// File doesn't exist yet — wait and retry
			await new Promise((r) => setTimeout(r, delay));
			// Exponential backoff with cap
			delay = Math.min(delay * 2, maxDelayMs);
		}
	}
}
