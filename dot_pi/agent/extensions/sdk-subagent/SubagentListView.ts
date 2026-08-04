/**
 * SubagentListView — floating overlay listing all tracked subagents.
 *
 * Renders every subagent (as a tree via `buildSubagentTree`) inside a
 * self-contained bordered box, with its own selection state — no dependency
 * on `SelectList`. Up/Down move the highlight, Enter opens the highlighted
 * subagent, `k` kills it, and Esc closes the overlay. Live-refreshes in place
 * whenever `manager.onListChange` fires (spawn/kill/status transitions).
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { SubagentManager, buildSubagentTree, type SubagentTreeRow } from "./SubagentManager";

export type SubagentListResult =
	| { action: "open"; id: string }
	| { action: "close" };

/** Max number of subagent rows shown at once; longer lists scroll. */
const MAX_VISIBLE_ROWS = 12;

class SubagentListOverlay {
	private rows: SubagentTreeRow[] = [];
	private selectedIndex = 0;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly manager: SubagentManager,
		private readonly theme: Theme,
		private readonly requestRender: () => void,
		private readonly done: (result: SubagentListResult) => void,
	) {
		this.refresh();
		this.unsubscribe = manager.onListChange(() => {
			this.refresh();
			this.requestRender();
		});
	}

	/** Re-pull the tree from the manager, keeping the highlight on the same id if possible. */
	private refresh(): void {
		const selectedId = this.rows[this.selectedIndex]?.id;
		this.rows = buildSubagentTree(this.manager.list());
		if (this.rows.length === 0) {
			this.selectedIndex = 0;
			return;
		}
		const idx = selectedId ? this.rows.findIndex((r) => r.id === selectedId) : -1;
		this.selectedIndex = idx !== -1 ? idx : Math.min(this.selectedIndex, this.rows.length - 1);
	}

	handleInput(data: string): void {
		if (this.rows.length > 0) {
			if (matchesKey(data, "up")) {
				this.selectedIndex = this.selectedIndex === 0 ? this.rows.length - 1 : this.selectedIndex - 1;
				this.requestRender();
				return;
			}
			if (matchesKey(data, "down")) {
				this.selectedIndex = this.selectedIndex === this.rows.length - 1 ? 0 : this.selectedIndex + 1;
				this.requestRender();
				return;
			}
			if (matchesKey(data, "return")) {
				const row = this.rows[this.selectedIndex];
				if (row) this.done({ action: "open", id: row.id });
				return;
			}
			if (matchesKey(data, "k")) {
				const row = this.rows[this.selectedIndex];
				if (row) {
					this.manager.kill(row.id).catch(() => {
						// Swallow — raw console writes here would race the interactive
						// TUI's own rendering, corrupting on-screen content.
					});
					// onListChange fires -> refresh() runs and picks a sane new selection
				}
				return;
			}
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done({ action: "close" });
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = Math.max(1, width - 2);
		const border = (s: string) => th.fg("accent", s);
		const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);

		const lines: string[] = [];
		lines.push(border(`╭${"─".repeat(innerW)}╮`));
		lines.push(border("│") + padLine(` ${th.bold(th.fg("accent", "Subagents"))}`) + border("│"));

		if (this.rows.length === 0) {
			lines.push(border("│") + padLine(` ${th.fg("muted", "No active subagents")}`) + border("│"));
		} else {
			const start = Math.max(
				0,
				Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE_ROWS / 2), this.rows.length - MAX_VISIBLE_ROWS),
			);
			const end = Math.min(start + MAX_VISIBLE_ROWS, this.rows.length);

			for (let i = start; i < end; i++) {
				const row = this.rows[i];
				if (!row) continue;
				const isSelected = i === this.selectedIndex;
				const text = `${row.prefix}${row.instance.id} · ${row.instance.role} · ${row.instance.status}`;
				const prefix = isSelected ? "→ " : "  ";
				const content = `${prefix}${text}`;
				lines.push(border("│") + padLine(isSelected ? th.fg("accent", content) : content) + border("│"));
			}

			if (start > 0 || end < this.rows.length) {
				lines.push(
					border("│") +
						padLine(th.fg("dim", `  (${this.selectedIndex + 1}/${this.rows.length})`)) +
						border("│"),
				);
			}
		}

		lines.push(
			border("│") +
				padLine(` ${th.fg("dim", "↑↓ navigate • enter open • k kill • esc close")}`) +
				border("│"),
		);
		lines.push(border(`╰${"─".repeat(innerW)}╯`));
		return lines;
	}

	invalidate(): void {
		// No cached render state to invalidate.
	}

	dispose(): void {
		this.unsubscribe();
	}
}

/**
 * Show the floating subagent list overlay. Resolves when the user opens a
 * subagent (Enter) or closes the view (Esc).
 */
export function createSubagentListView(
	manager: SubagentManager,
	ctx: ExtensionContext,
): Promise<SubagentListResult> {
	return ctx.ui.custom<SubagentListResult>(
		(tui, theme, _kb, done) => new SubagentListOverlay(manager, theme, () => tui.requestRender(), done),
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "70%", maxHeight: "80%" },
		},
	);
}
