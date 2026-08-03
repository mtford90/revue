import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import {
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
	type ThreadAnchor,
	threadStoreFileSchema,
} from "@revue/types";
import {
	defaultThreadsPath,
	openThreadStore,
	readThreadStoreFile,
	resolveHumanAuthor,
} from "./threads.ts";

const anchor: ThreadAnchor = {
	filePath: "src/value.ts",
	oldStart: 4,
	side: "additions",
	startLine: 8,
	endLine: 10,
};

const human = { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Ada Reviewer" };
const agent = { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" };
const ids = [
	"00000000-0000-4000-8000-000000000001",
	"00000000-0000-4000-8000-000000000002",
	"00000000-0000-4000-8000-000000000003",
	"00000000-0000-4000-8000-000000000004",
	"00000000-0000-4000-8000-000000000005",
] as const;

const waitForPath = async (path: string, attempts = 200): Promise<void> => {
	if (await Bun.file(path).exists()) return;
	if (attempts === 0) throw new Error(`Timed out waiting for ${path}`);
	await Bun.sleep(10);
	return waitForPath(path, attempts - 1);
};

test("thread paths and human identity follow the reviewed repository", async () => {
	const repository = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-thread-root-"));
	const runDirectory = join(repository, "nested", "review-run");
	try {
		execFileSync("git", ["init", "-q", repository]);
		execFileSync("git", ["-C", repository, "config", "user.name", "Repository Reviewer"]);
		await mkdir(runDirectory, { recursive: true });
		expect(defaultThreadsPath(runDirectory)).toBe(join(repository, ".revue", "threads.json"));
		expect(resolveHumanAuthor(repository)).toEqual({
			kind: THREAD_AUTHOR_KIND.HUMAN,
			name: "Repository Reviewer",
		});
		expect(resolveHumanAuthor(null).name).toBe(userInfo().username);
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

test("concurrent processes preserve every same-run thread", async () => {
	const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-thread-lock-"));
	const path = join(directory, ".revue", "threads.json");
	const go = join(directory, "go");
	const runId = "c".repeat(64);
	const moduleUrl = new URL("./threads.ts", import.meta.url).href;
	const worker = `
		import { existsSync } from "node:fs";
		import { openThreadStore } from ${JSON.stringify(moduleUrl)};
		const store = openThreadStore(process.env.THREAD_PATH, process.env.RUN_ID);
		await Bun.write(process.env.READY_PATH, "ready");
		const wait = async () => {
			if (existsSync(process.env.GO_PATH)) return;
			await Bun.sleep(5);
			return wait();
		};
		await wait();
		store.create(${JSON.stringify(anchor)}, ${JSON.stringify(agent)}, process.env.BODY, {
			id: process.env.THREAD_ID,
			messageId: process.env.MESSAGE_ID,
			createdAt: process.env.CREATED_AT,
		});
	`;
	const spawnWriter = (index: 0 | 1) => {
		const ready = join(directory, `ready-${index}`);
		const child = Bun.spawn([process.execPath, "-e", worker], {
			cwd: process.cwd(),
			env: {
				...process.env,
				THREAD_PATH: path,
				RUN_ID: runId,
				READY_PATH: ready,
				GO_PATH: go,
				BODY: index === 0 ? "First writer" : "Second writer",
				THREAD_ID: ids[index * 2],
				MESSAGE_ID: ids[index * 2 + 1],
				CREATED_AT: `2026-08-02T10:00:0${index}.000Z`,
			},
			stderr: "pipe",
		});
		return { child, ready };
	};
	try {
		const writers = [spawnWriter(0), spawnWriter(1)];
		await Promise.all(writers.map(({ ready }) => waitForPath(ready)));
		await writeFile(go, "go");
		const exitCodes = await Promise.all(writers.map(({ child }) => child.exited));
		if (exitCodes.some((code) => code !== 0)) {
			const errors = await Promise.all(
				writers.map(({ child }) => new Response(child.stderr).text()),
			);
			throw new Error(errors.join("\n"));
		}
		expect(
			openThreadStore(path, runId)
				.get()
				.map((thread) => thread.messages[0]?.body),
		).toEqual(["First writer", "Second writer"]);
		expect(
			(await readdir(join(directory, ".revue"))).filter((name) => name.endsWith(".lock")),
		).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("thread stores preserve duplicate anchors, authored replies, and lifecycle changes", async () => {
	const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "revue-threads-"));
	const path = join(directory, ".revue", "threads.json");
	const runA = "a".repeat(64);
	const runB = "b".repeat(64);
	try {
		const firstStore = openThreadStore(path, runA);
		const first = firstStore.create(anchor, human, "First thought", {
			id: ids[0],
			messageId: ids[1],
			createdAt: "2026-08-02T10:00:00.000Z",
		});
		const second = firstStore.create(anchor, agent, "Second thought", {
			id: ids[2],
			messageId: ids[3],
			createdAt: "2026-08-02T10:00:01.000Z",
		});
		expect(first.id).not.toBe(second.id);
		expect(firstStore.get().map((thread) => thread.messages[0]?.body)).toEqual([
			"First thought",
			"Second thought",
		]);

		const replied = firstStore.reply(first.id, agent, "Agent reply", {
			id: ids[4],
			createdAt: "2026-08-02T09:59:59.000Z",
		});
		expect(replied.messages.map((message) => message.id)).toEqual([ids[1], ids[4]]);
		expect(replied.messages[1]).toMatchObject({ author: agent, body: "Agent reply" });
		expect(() => firstStore.deleteMessage(first.id, ids[1])).toThrow("root message");
		expect(firstStore.deleteMessage(first.id, ids[4]).body).toBe("Agent reply");

		const otherStore = openThreadStore(path, runB);
		expect(otherStore.get()).toEqual([]);
		otherStore.create({ ...anchor, startLine: 9, endLine: 9 }, agent, "Other run");
		expect(openThreadStore(path, runA).get()).toHaveLength(2);

		expect(firstStore.markDealt(first.id).status).toBe(THREAD_STATUS.DEALT_WITH);
		expect(firstStore.reopen(first.id).status).toBe(THREAD_STATUS.OPEN);
		expect(firstStore.delete(second.id)).toEqual(second);
		expect(firstStore.get().map((thread) => thread.id)).toEqual([first.id]);

		const persisted = readThreadStoreFile(path);
		expect(threadStoreFileSchema.parse(persisted)).toEqual(persisted);
		expect(
			(await readdir(join(directory, ".revue"))).filter(
				(name) => name.endsWith(".tmp") || name.endsWith(".lock"),
			),
		).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
