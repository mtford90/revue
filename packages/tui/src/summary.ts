import { exclusionSource } from "@revue/prep";
import {
	narratedUnitCount,
	partialDepthLabel,
	type RevueChaptersFile,
	type RunManifest,
} from "@revue/types";

/**
 * What an ignore rule kept out of the run. The narrated count is measured against the run, so a
 * fully narrated run whose prep dropped half the change still reads as complete without this.
 */
export const omissionNotice = (manifest: RunManifest): string | null => {
	const { exclusions } = manifest;
	if (!exclusions.length) return null;
	const sources = [...new Set(exclusions.map(exclusionSource))].sort();
	// Short enough to survive the sidebar, which truncates mid-string rather than wrapping.
	const files = `${exclusions.length} file${exclusions.length === 1 ? "" : "s"}`;
	return `${files} omitted · ${sources.join(" and ")}`;
};

/** Plain-text summary after a validated run, whatever depth it was narrated at. */
export function formatSummary(file: RevueChaptersFile, manifest: RunManifest): string {
	const preparedUnits = manifest.totals.reviewUnits;
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

	const depth = partialDepthLabel(file);
	lines.push(
		`  ${narratedUnitCount(file)} of ${preparedUnits} review unit${preparedUnits === 1 ? "" : "s"} narrated${depth ? ` (${depth})` : ""}`,
	);
	const omitted = omissionNotice(manifest);
	if (omitted) lines.push(`  ${omitted}`);
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
