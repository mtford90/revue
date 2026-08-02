import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMENT_STATUS, type CommentAnchor, commentStoreFileSchema } from "@revue/types";
import { openCommentStore, readCommentStoreFile } from "./comments.ts";

const anchor: CommentAnchor = {
	filePath: "src/value.ts",
	oldStart: 4,
	side: "additions",
	startLine: 8,
	endLine: 10,
};

const ids = [
	"00000000-0000-4000-8000-000000000001",
	"00000000-0000-4000-8000-000000000002",
] as const;

test("comment stores isolate runs and preserve duplicate anchors through lifecycle changes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "revue-comments-"));
	const path = join(directory, ".revue", "comments.json");
	const runA = "a".repeat(64);
	const runB = "b".repeat(64);
	try {
		const firstStore = openCommentStore(path, runA);
		const first = firstStore.add(anchor, "First thought", {
			id: ids[0],
			createdAt: "2026-08-02T10:00:00.000Z",
		});
		const second = firstStore.add(anchor, "Second thought", {
			id: ids[1],
			createdAt: "2026-08-02T10:00:01.000Z",
		});
		expect(first.id).not.toBe(second.id);
		expect(firstStore.get().map((comment) => comment.body)).toEqual([
			"First thought",
			"Second thought",
		]);

		const otherStore = openCommentStore(path, runB);
		expect(otherStore.get()).toEqual([]);
		otherStore.add({ ...anchor, startLine: 9, endLine: 9 }, "Other run");
		expect(openCommentStore(path, runA).get()).toHaveLength(2);

		const dealt = firstStore.markDealt(first.id);
		expect(dealt.status).toBe(COMMENT_STATUS.DEALT_WITH);
		expect(firstStore.reopen(first.id).status).toBe(COMMENT_STATUS.OPEN);
		expect(firstStore.delete(second.id)).toEqual(second);
		expect(firstStore.get().map((comment) => comment.id)).toEqual([first.id]);

		const persisted = readCommentStoreFile(path);
		expect(commentStoreFileSchema.parse(persisted)).toEqual(persisted);
		expect(
			(await readdir(join(directory, ".revue"))).filter((name) => name.endsWith(".tmp")),
		).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
