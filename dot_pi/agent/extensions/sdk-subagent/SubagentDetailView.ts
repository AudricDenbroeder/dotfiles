/**
 * SubagentDetailView — bordered overlay detail view for a single subagent.
 * Shows the complete conversation history (scrollable), a live status
 * indicator, and a prompt input box pinned to the bottom.
 *
 * Rendered as a `{ overlay: true }` component with a `maxHeight` bound so it
 * can never grow past the terminal viewport — content that doesn't fit is
 * scrolled (↑↓ / PageUp / PageDown), not clipped off-screen.
 *
 * Press k to kill the subagent. Press Esc to return to the list.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Component, Input, Loader, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { SubagentManager, type SubagentHistoryEntry } from "./SubagentManager";


export type SubagentDetailResult = { action: "back" } | { action: "killed"; id: string };

const STATUS_COLORS: Record<string, string> = {
	idle: "success",
	running: "warning",
	error: "error",
};

/**
 * Show the subagent detail overlay. Resolves when the user presses
 * Esc (→ `{ action: "back" }`) or kills the subagent (→ `{ action: "killed", id }`).
 */
export function createSubagentDetailView(
	manager: SubagentManager,
	agentId: string,
	ctx: ExtensionContext,
): Promise<SubagentDetailResult> {
	return ctx.ui.custom<SubagentDetailResult>(
		(tui, theme, _keybindings, done) => {
		const sub = manager.get(agentId);
		if (!sub) {
			done({ action: "back" });
			return { dispose: () => {} };
		}

		const unsubChange = manager.onChange(agentId, () => {
			tui.requestRender();
		});

		let isKilled = false;

		// ─── History scrolling ───────────────────────────────────────────────────

		// `scrollOffset` is the index of the first visible history line.
		// `followBottom` keeps the view pinned to the newest content until the
		// user manually scrolls up, at which point auto-follow is disabled until
		// they scroll back down to the bottom (or press End).
		let scrollOffset = 0;
		let followBottom = true;
		// Updated on every render(); used by handleInput to page up/down by the
		// same number of lines that are actually visible.
		let lastVisibleHistoryLines = 1;

		// ─── Loader (must be declared before sendInstruction references it) ─────

		const loader = new Loader(
			tui,
			(s: string) => theme.fg("accent", s),
			(s: string) => theme.fg("muted", s),
			"Waiting for reply…",
		);

		// ─── History rendering ──────────────────────────────────────────────────

		function renderHistoryEntry(entry: SubagentHistoryEntry, theme: Theme, maxLen: number): string {
			const fg = (color: string, text: string) => theme.fg(color, text);
			const bold = (text: string) => theme.bold(text);

			// Truncate the plain text, then apply styling to the truncated result
			const plain = (entry.text ?? "").replace(/\n/g, " ");
			const truncated = plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;

			switch (entry.kind) {
				case "system":
					return `  ${fg("muted", "── System prompt ──")}  ${fg("dim", truncated)}`;
				case "user":
					return `  ${fg("userMessageText", "▶")} ${bold(fg("userMessageText", "You"))}: ${fg("userMessageText", truncated)}`;
				case "assistant":
					return `  ${fg("accent", "●")} ${bold(fg("accent", "Assistant"))}: ${fg("accent", truncated)}`;
				case "tool_call":
					const argsDisplay = entry.toolArgs ? ` ${entry.toolArgs}` : "";
					return `  ${fg("muted", "⟳")} ${fg("muted", `${entry.toolName}${argsDisplay}`)}`;
				case "tool_result":
					return `  ${fg("dim", "⟲")} ${fg("dim", `${entry.toolName}: ${truncated}`)}`;
				default:
					return "";
			}
		}

		function buildHistoryLines(maxLen: number): string[] {
			const entries = manager.getHistory(agentId);
			const lines: string[] = [];
			for (const entry of entries) {
				const rendered = renderHistoryEntry(entry, theme, maxLen);
				if (rendered) {
					lines.push(rendered);
				}
			}
			return lines;
		}

		function scrollBy(delta: number, totalLines: number, visibleLines: number): void {
			const maxOffset = Math.max(0, totalLines - visibleLines);
			scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset + delta));
			followBottom = scrollOffset >= maxOffset;
		}

		// ─── Input box ─────────────────────────────────────────────────────────

		const input = new Input();

		function sendInstruction(text: string): void {
			if (!text.trim() || sub.status === "running") return;
			input.setValue("");
			loader.start();
			manager
				.send(agentId, text)
				.then(() => {
					loader.stop();
					tui.requestRender();
				})
				.catch(() => {
					loader.stop();
					tui.requestRender();
				});
		}

		input.onSubmit = (value: string) => {
			sendInstruction(value);
		};

		input.onEscape = () => {
			if (isKilled) return;
			done({ action: "back" });
		};

		// ─── Component ─────────────────────────────────────────────────────────

		function getStatusColor(): string {
			return STATUS_COLORS[sub.status] ?? "muted";
		}

		const component: Component & { dispose?(): void } = {
			render(width: number): string[] {
				const innerW = Math.max(1, width - 2);
				const border = (s: string) => theme.fg("accent", s);

				// Use visibleWidth for padding calculation to account for ANSI codes
				const pad = (s: string) => {
					const w = visibleWidth(s);
					const padCount = Math.max(0, innerW - w);
					return s + " ".repeat(padCount);
				};

				// Max chars per entry line (content area minus │ borders and prefix)
				const contentW = Math.max(1, innerW - 4); // │ on each side
				const entryMaxLen = Math.max(20, contentW - 30); // leave room for prefix/icons

				const lines: string[] = [];
				lines.push(border(`╭${"─".repeat(innerW)}╮`));
				lines.push(border("│") + pad(` ${theme.bold(theme.fg("accent", `Subagent: ${sub.id} (${sub.role.name})`))}`) + border("│"));
				const ctxDisplay = manager.getContextDisplay(agentId) ? ` · ${manager.getContextDisplay(agentId)!}` : "";
				lines.push(border("│") + pad(` ${theme.fg(getStatusColor(), `Status: ${sub.status}${ctxDisplay}`)}`) + border("│"));

				// History lines — each entry as a single compact line, clipped to the
				// visible viewport height so the box never grows past the terminal.
				const histLines = buildHistoryLines(entryMaxLen);

				// Lines rendered outside the scrollable history area (top border,
				// title, status, loader, input, help line, bottom border).
				const nonHistoryLines =
					4 + // top border + title + status + bottom border
					1 + // help line
					(sub.status === "running" ? 1 : 0) +
					input.render(Math.max(1, innerW - 6)).length;
				// Match the overlay's `maxHeight: "90%"` budget (see overlayOptions
				// below) so our own history-window calculation lines up with what
				// the TUI will actually let this overlay occupy. The TUI still clips
				// as a hard safety net if this estimate is ever slightly too high.
				const terminalRows = Math.floor((tui.terminal?.rows ?? 24) * 0.9);
				// Reserve 2 extra lines for the "N more above/below" scroll
				// indicators, since they may both be shown at once and are not part
				// of `nonHistoryLines`. This keeps the box's total height bounded
				// even in the worst case (scrolled to the middle of a long history).
				const maxVisible = Math.max(3, terminalRows - nonHistoryLines - 2);
				lastVisibleHistoryLines = maxVisible;

				const maxOffset = Math.max(0, histLines.length - maxVisible);
				if (followBottom) {
					scrollOffset = maxOffset;
				} else {
					scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset));
				}

				const visibleHistLines = histLines.slice(scrollOffset, scrollOffset + maxVisible);

				if (histLines.length === 0) {
					lines.push(border("│") + pad("  No history yet") + border("│"));
				} else {
					if (scrollOffset > 0) {
						lines.push(
							border("│") +
								pad(`  ${theme.fg("dim", `▲ ${scrollOffset} more above`)}`) +
								border("│"),
						);
					}
					for (const line of visibleHistLines) {
						const truncated = truncateToWidth(line, contentW - 2, "…", false);
						lines.push(border("│") + pad(`  ${truncated}`) + border("│"));
					}
					const below = histLines.length - (scrollOffset + visibleHistLines.length);
					if (below > 0) {
						lines.push(
							border("│") + pad(`  ${theme.fg("dim", `▼ ${below} more below`)}`) + border("│"),
						);
					}
				}

				// Loader line (shown while running)
				if (sub.status === "running") {
					const loaderLine = loader.render(width).join(" ");
					const truncated = truncateToWidth(loaderLine, contentW - 2, "…", false);
					lines.push(border("│") + pad(`  ${truncated}`) + border("│"));
				}

				// Input box — render with reduced width to leave room for border+prefix
				const inputW = Math.max(1, innerW - 6); // 2 for "│ " prefix, 2 for " │" suffix, 2 for "  " indent
				const inputLines = input.render(inputW);
				for (const il of inputLines) {
					// Explicitly truncate to ensure we never exceed the available width
					const truncated = truncateToWidth(il, contentW - 2, "…", false);
					lines.push(border("│") + pad(`  ${truncated}`) + border("│"));
				}

				const scrollHint =
					histLines.length > maxVisible ? " • ↑↓/PgUp/PgDn scroll • End: bottom" : "";
				lines.push(
					border("│") +
						pad(` ${theme.fg("dim", `k kill • esc back${scrollHint}`)}`) +
						border("│"),
				);
				lines.push(border(`╰${"─".repeat(innerW)}╯`));
				return lines;
			},

			handleInput(data: string): void {
				if (matchesKey(data, "up")) {
					scrollBy(-1, manager.getHistory(agentId).length, lastVisibleHistoryLines);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "down")) {
					scrollBy(1, manager.getHistory(agentId).length, lastVisibleHistoryLines);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "pageup")) {
					scrollBy(-lastVisibleHistoryLines, manager.getHistory(agentId).length, lastVisibleHistoryLines);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "pagedown")) {
					scrollBy(lastVisibleHistoryLines, manager.getHistory(agentId).length, lastVisibleHistoryLines);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "end")) {
					followBottom = true;
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "home")) {
					scrollOffset = 0;
					followBottom = false;
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "k")) {
					isKilled = true;
					unsubChange();
					loader.stop();
					manager.kill(agentId).catch(() => {});
					done({ action: "killed", id: agentId });
					return;
				}
				if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
					if (!isKilled) {
						done({ action: "back" });
					}
					return;
				}
				// Forward to input
				input.handleInput?.(data);
			},

			invalidate(): void {
				loader.invalidate();
				input.invalidate();
			},

			dispose(): void {
				unsubChange();
				loader.stop();
			},
		};

		return component;
		},
		{
			overlay: true,
			// Bound the overlay to the terminal size so it can never grow past the
			// visible viewport; the component itself also clips history lines to
			// this same budget (see `maxVisible` in render()) so the box always
			// fits and the bottom (input box / help line) stays on screen.
			overlayOptions: { anchor: "center", width: "90%", minWidth: 60, maxHeight: "90%" },
		},
	);
}
