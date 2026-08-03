import type { RevueChaptersFile, RunManifest } from "@revue/types";

/** Plain-text summary after a complete run has passed validation. */
export function formatSummary(file: RevueChaptersFile): string {
	const lines: string[] = [];
	const { prologue, chapters } = file;

	lines.push("revue — run is valid ✓");
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

/** Plain-text summary for a run nobody has narrated yet. */
export function formatChapterlessSummary(manifest: RunManifest): string {
	const totals = manifest.totals;
	return [
		"revue — chapterless run is valid ✓",
		"",
		`  ${totals.files} file${totals.files === 1 ? "" : "s"}, ${totals.reviewUnits} review units, +${totals.additions} -${totals.deletions}`,
		"",
		"  No chapters.json — revue show opens this run as a flat file-by-file diff.",
	].join("\n");
}
