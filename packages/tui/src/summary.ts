import type { RevueChaptersFile } from "@revue/types";

/**
 * Plain-text render of a chapters file. Used by `revue show --check` and as the fallback
 * when stdout is not a TTY (CI, pipes), where booting an interactive TUI makes no sense.
 */
export function formatSummary(file: RevueChaptersFile): string {
	const lines: string[] = [];
	const { prologue, chapters } = file;

	lines.push("revue — chapters file is valid ✓");
	lines.push("");

	if (prologue) {
		if (prologue.motivation) lines.push(`  motivation  ${prologue.motivation}`);
		if (prologue.outcome) lines.push(`  outcome     ${prologue.outcome}`);
		lines.push(`  complexity  ${prologue.complexity.level} — ${prologue.complexity.reasoning}`);
		if (prologue.focusAreas.length) {
			lines.push(`  focus areas ${prologue.focusAreas.length}`);
			for (const fa of prologue.focusAreas) {
				lines.push(`    [${fa.severity}] ${fa.type}: ${fa.title}`);
			}
		}
		lines.push("");
	}

	lines.push(`  ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}:`);
	for (const ch of [...chapters].sort((a, b) => a.order - b.order)) {
		const hunks = ch.hunkRefs.length;
		const keys = ch.keyChanges.length;
		lines.push(
			`    ${ch.order}. ${ch.title}  (${hunks} hunk${hunks === 1 ? "" : "s"}` +
				`${keys ? `, ${keys} key change${keys === 1 ? "" : "s"}` : ""})`,
		);
	}

	return lines.join("\n");
}
