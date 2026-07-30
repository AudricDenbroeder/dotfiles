/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns and allow-lists are loaded from permission-gate-config.json
 * located in the same directory as this extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

interface Config {
	patterns: string[];
	allowlist: (string | RegexEntry)[];
}

interface RegexEntry {
	type: "regex";
	pattern: RegExp;
}

function parseRegexEntry(entry: string): RegexEntry | null {
	if (entry.startsWith("/") && entry.endsWith("/")) {
		const match = entry.match(/^\/(.+)\/(.*)$/);
		if (match) {
			const [, pattern, flags] = match;
			return { type: "regex", pattern: new RegExp(pattern, flags || "i") };
		}
	}
	return null;
}

function loadConfig(): Config {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const configPath = join(__dirname, "permission-gate-config.json");
	try {
		const raw = readFileSync(configPath, "utf-8");
		const data = JSON.parse(raw) as { patterns?: string[]; allowlist?: string[] };
		const parsedAllowlist: (string | RegexEntry)[] = (data.allowlist ?? []).map((entry) => {
			const regex = parseRegexEntry(entry);
			return regex ?? entry;
		});
		return { patterns: data.patterns ?? [], allowlist: parsedAllowlist };
	} catch {
		console.error(`[permission-gate] Failed to load config from ${configPath}`);
		return { patterns: [], allowlist: [] };
	}
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();

	const dangerousPatterns = config.patterns.map((p) => new RegExp(p, "i"));

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		if (!command) return undefined;

		// Check allow-list first — if any allow-list entry is a substring match, skip gating
		const isAllowed = config.allowlist.some((allowed) => {
		if (typeof allowed === "string") return command.includes(allowed);
		if (allowed.type === "regex") return allowed.pattern.test(command);
		return false;
	});
		if (isAllowed) return undefined;

		const isDangerous = dangerousPatterns.some((p) => p.test(command));

		if (isDangerous) {
			if (!ctx.hasUI) {
				return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
			}

			const choice = await ctx.ui.select(
				`Command needs to be allowed:\n\n  ${command}\n\nAllow?`,
				["Yes", "No"],
			);

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		}

		return undefined;
	});
}
