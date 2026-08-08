import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChaptersFileError, loadChaptersFile } from "./load.ts";

const roots: string[] = [];

afterAll(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

const chaptersFileWith = async (chapter: Record<string, unknown>): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "revue-chapters-"));
	roots.push(root);
	const path = join(root, "chapters.json");
	await writeFile(path, JSON.stringify({ chapters: [chapter] }), "utf8");
	return path;
};

const baseChapter = {
	id: "chapter-1",
	order: 1,
	title: "Wire the org id through",
	summary: "Why this matters.",
	hunkRefs: [{ filePath: "src/value.ts", oldStart: 4 }],
	keyChanges: [],
};

test("a field this CLI does not know names skill reinstallation rather than a bare schema dump", async () => {
	const path = await chaptersFileWith({ ...baseChapter, epilogue: "written by a newer skill" });

	const failure = await loadChaptersFile(path).catch((error: unknown) => error);

	expect(failure).toBeInstanceOf(ChaptersFileError);
	const message = (failure as Error).message;
	expect(message).toContain("epilogue");
	expect(message).toContain("revue skill install");
	expect(message).toContain("revue doctor");
});

test("a genuinely invalid field keeps its precise error", async () => {
	const path = await chaptersFileWith({
		...baseChapter,
		keyChanges: [
			{
				content: "Should this reset?",
				severity: "medium",
				lineRefs: [{ filePath: "src/value.ts", side: "additions", startLine: 40, endLine: 10 }],
			},
		],
	});

	const failure = await loadChaptersFile(path).catch((error: unknown) => error);

	const message = (failure as Error).message;
	expect(message).toContain("endLine must be greater than or equal to startLine");
	expect(message).not.toContain("revue skill install");
});
