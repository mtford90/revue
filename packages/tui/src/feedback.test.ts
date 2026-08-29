import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handoffPath, readHandoff, recordAgentOrigin, writeHandoff } from "@revue/prep";
import {
	type HandoffRecord,
	type ReviewThread,
	THREAD_ANCHOR_KIND,
	THREAD_AUTHOR_KIND,
	THREAD_STATUS,
} from "@revue/types";
import { createFeedbackController, WAKE_UP_PROMPT } from "./feedback.ts";
import { createHostAdapter, type HostAdapter, type HostTerminal } from "./host.ts";
import { createThread, createThreadMessage } from "./threads.ts";

const runId = "c".repeat(64);
const reviewer = { kind: THREAD_AUTHOR_KIND.HUMAN, name: "Reviewer" } as const;
const agent = { kind: THREAD_AUTHOR_KIND.AGENT, name: "Review agent" } as const;

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute)).toISOString();

const anchor = (line: number) => ({
	kind: THREAD_ANCHOR_KIND.HUNK,
	filePath: "src/alpha.ts",
	oldStart: 1,
	side: "additions" as const,
	startLine: line,
	endLine: line,
});

const thread = (line: number, minute: number): ReviewThread =>
	createThread(runId, anchor(line), reviewer, `Line ${line}?`, { createdAt: at(minute) });

/** A thread later than any `send()` this test has already made, real-time rather than fixed 2026. */
const freshThread = (line: number): ReviewThread =>
	createThread(runId, anchor(line), reviewer, `Line ${line}?`, {
		createdAt: new Date(Date.now() + 1_000).toISOString(),
	});

const answered = (base: ReviewThread, minute: number): ReviewThread => ({
	...base,
	messages: [...base.messages, createThreadMessage(agent, "Fixed.", { createdAt: at(minute) })],
});

const handoff = (requestedAt: string, threadIds: string[]): HandoffRecord => ({
	schemaVersion: 1,
	handoffId: "11111111-1111-4111-8111-111111111111",
	requestedAt,
	runId,
	threadIds,
	delivery: { kind: "queued" },
});

const scratchRepository = () => mkdtemp(join(tmpdir(), "revue-feedback-"));

const controllerFor = (repositoryRoot: string, threads: readonly ReviewThread[]) =>
	createFeedbackController({ repositoryRoot, runId, threads: () => threads });

test("the first Send queues every open thread a human spoke last", async () => {
	const root = await scratchRepository();
	try {
		const unsent = thread(1, 0);
		const closed = { ...thread(3, 2), status: THREAD_STATUS.DEALT_WITH };
		const threads = [unsent, answered(thread(2, 1), 3), closed, thread(4, 4)];

		const outcome = await controllerFor(root, threads).send();
		expect(outcome).toEqual({ kind: "queued", count: 2 });

		const record = readHandoff(root).record;
		expect(record).toMatchObject({
			runId,
			threadIds: [unsent.id, threads[3]?.id],
			delivery: { kind: "queued" },
		});
		expect(Date.parse(record?.requestedAt ?? "")).toBeGreaterThan(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a second Send with nothing new to say writes nothing", async () => {
	const root = await scratchRepository();
	try {
		const threads = [thread(1, 0)];
		const before = handoff(at(30), [threads[0]?.id ?? ""]);
		writeHandoff(root, before);

		expect(await controllerFor(root, threads).send()).toEqual({ kind: "nothing" });
		expect(readHandoff(root).record).toEqual(before);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a comment written after the last handoff is the only thing the next Send carries", async () => {
	const root = await scratchRepository();
	try {
		const stale = thread(1, 0);
		const fresh = thread(2, 40);
		const before = handoff(at(30), [stale.id]);
		writeHandoff(root, before);

		expect(await controllerFor(root, [stale, fresh]).send()).toEqual({ kind: "queued", count: 1 });
		const record = readHandoff(root).record;
		expect(record?.threadIds).toEqual([fresh.id]);
		expect(record?.handoffId).not.toBe(before.handoffId);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a damaged handoff sends the whole conversation again rather than nothing", async () => {
	const root = await scratchRepository();
	try {
		await mkdir(join(root, ".revue"), { recursive: true });
		await writeFile(handoffPath(root), "{ not a handoff");
		const threads = [thread(1, 0), thread(2, 1)];

		expect(await controllerFor(root, threads).send()).toEqual({ kind: "queued", count: 2 });
		expect(readHandoff(root).record?.threadIds).toEqual(threads.map((each) => each.id));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a successful copy rewrites the record as copied and reports copied", async () => {
	const root = await scratchRepository();
	try {
		const threads = [thread(1, 0), thread(2, 1)];
		const copyPrompt = (text: string) => {
			expect(text).toBe(WAKE_UP_PROMPT);
			return true;
		};

		const outcome = await controllerFor(root, threads).send(copyPrompt);
		expect(outcome).toEqual({ kind: "copied", count: 2 });
		expect(readHandoff(root).record).toMatchObject({ delivery: { kind: "copied" } });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a copy that reports failure leaves the record queued", async () => {
	const root = await scratchRepository();
	try {
		const outcome = await controllerFor(root, [thread(1, 0)]).send(() => false);
		expect(outcome).toEqual({ kind: "queued", count: 1 });
		expect(readHandoff(root).record).toMatchObject({ delivery: { kind: "queued" } });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a copy that throws leaves the record queued", async () => {
	const root = await scratchRepository();
	try {
		const outcome = await controllerFor(root, [thread(1, 0)]).send(() => {
			throw new Error("no clipboard channel");
		});
		expect(outcome).toEqual({ kind: "queued", count: 1 });
		expect(readHandoff(root).record).toMatchObject({ delivery: { kind: "queued" } });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the prompt carries no thread content", () => {
	expect(WAKE_UP_PROMPT).not.toContain("Line ");
	expect(WAKE_UP_PROMPT).toContain("revue status --json");
});

test("a record that cannot be written is reported, and no partial handoff is left", async () => {
	const root = await scratchRepository();
	try {
		await mkdir(handoffPath(root), { recursive: true });

		const outcome = await controllerFor(root, [thread(1, 0)]).send();
		expect(outcome).toMatchObject({
			kind: "error",
			message: expect.stringContaining("Could not write the handoff"),
		});
		expect(readHandoff(root).record).toBeNull();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// ── Delivery through a host ─────────────────────────────────────────────────

const terminal = (handle: string, over: Partial<HostTerminal> = {}): HostTerminal => ({
	handle,
	paneKey: `tab1:${handle}`,
	title: handle,
	lastOutputAt: null,
	...over,
});

type FakeHostInput = {
	terminals?: HostTerminal[] | null;
	send?: (handle: string, text: string) => boolean | Promise<boolean>;
};

const fakeHost = ({ terminals = [], send }: FakeHostInput = {}) => {
	const sent: { handle: string; text: string }[] = [];
	const host: HostAdapter = {
		listTerminals: async () => terminals,
		sendToTerminal: async (handle, text) => {
			sent.push({ handle, text });
			return (await send?.(handle, text)) ?? true;
		},
	};
	return { host, sent };
};

const recordOrigin = (repositoryRoot: string, paneKey: string, origin = runId) => {
	recordAgentOrigin({
		repositoryRoot,
		runId: origin,
		env: { ORCA_WORKTREE_ID: "wt-1", ORCA_PANE_KEY: paneKey },
	});
};

const hostControllerFor = (
	repositoryRoot: string,
	threads: readonly ReviewThread[],
	host: HostAdapter | null,
) => createFeedbackController({ repositoryRoot, runId, threads: () => threads, host });

const refuseClipboard = () => {
	throw new Error("the clipboard must not be reached behind a host");
};

// A silent clipboard call would look like success from the outside, so the tests that cover a
// host declining to deliver count the copies rather than trust the throw above.
const watchedClipboard = () => {
	const copies: string[] = [];
	return {
		copies,
		copy: (text: string) => {
			copies.push(text);
			return true;
		},
	};
};

test("the nudge goes to the pane the agent last worked in, and the record says so", async () => {
	const root = await scratchRepository();
	try {
		const { host, sent } = fakeHost({
			terminals: [terminal("term_other", { lastOutputAt: 20 }), terminal("term_agent")],
		});
		recordOrigin(root, "tab1:term_agent");

		const outcome = await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard);

		expect(outcome).toEqual({ kind: "delivered", count: 1, title: "term_agent" });
		expect(sent).toEqual([{ handle: "term_agent", text: WAKE_UP_PROMPT }]);
		expect(readHandoff(root).record?.delivery).toEqual({
			kind: "delivered",
			host: "orca",
			terminal: "term_agent",
			title: "term_agent",
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("an origin recorded against another review still names the pane to wake", async () => {
	const root = await scratchRepository();
	try {
		const { host, sent } = fakeHost({
			terminals: [terminal("term_other"), terminal("term_agent")],
		});
		recordOrigin(root, "tab1:term_agent", "d".repeat(64));

		const outcome = await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard);

		expect(outcome).toMatchObject({ kind: "delivered", title: "term_agent" });
		expect(sent.map((each) => each.handle)).toEqual(["term_agent"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("an origin the host no longer lists falls through to the one terminal left", async () => {
	const root = await scratchRepository();
	try {
		const { host, sent } = fakeHost({ terminals: [terminal("term_new", { title: "claude" })] });
		recordOrigin(root, "tab1:term_closed");

		const outcome = await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard);

		expect(outcome).toEqual({ kind: "delivered", count: 1, title: "claude" });
		expect(sent.map((each) => each.handle)).toEqual(["term_new"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("with no origin and one terminal, that terminal is the agent", async () => {
	const root = await scratchRepository();
	try {
		const { host, sent } = fakeHost({ terminals: [terminal("term_only")] });

		expect(await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard)).toEqual({
			kind: "delivered",
			count: 1,
			title: "term_only",
		});
		expect(sent).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a host that cannot list its terminals leaves the batch queued, not copied", async () => {
	const root = await scratchRepository();
	const clipboard = watchedClipboard();
	try {
		const { host, sent } = fakeHost({ terminals: null });

		expect(await hostControllerFor(root, [thread(1, 0)], host).send(clipboard.copy)).toEqual({
			kind: "queued",
			count: 1,
		});
		expect(sent).toHaveLength(0);
		expect(readHandoff(root).record?.delivery).toEqual({ kind: "queued" });
		expect(clipboard.copies).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a nudge the host refuses leaves the batch queued", async () => {
	const root = await scratchRepository();
	const clipboard = watchedClipboard();
	try {
		const refused = fakeHost({ terminals: [terminal("term_only")], send: () => false });

		const outcome = await hostControllerFor(root, [thread(1, 0)], refused.host).send(
			clipboard.copy,
		);

		expect(outcome).toEqual({ kind: "queued", count: 1 });
		expect(readHandoff(root).record?.delivery).toEqual({ kind: "queued" });
		expect(clipboard.copies).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a host that throws mid-nudge leaves the batch queued", async () => {
	const root = await scratchRepository();
	const clipboard = watchedClipboard();
	try {
		const { host } = fakeHost({
			terminals: [terminal("term_only")],
			send: () => {
				throw new Error("the host went away");
			},
		});

		expect(await hostControllerFor(root, [thread(1, 0)], host).send(clipboard.copy)).toEqual({
			kind: "queued",
			count: 1,
		});
		expect(readHandoff(root).record?.delivery).toEqual({ kind: "queued" });
		expect(clipboard.copies).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("several terminals and no origin is a choice the reviewer has yet to make", async () => {
	const root = await scratchRepository();
	const clipboard = watchedClipboard();
	try {
		const candidates = [terminal("term_a", { lastOutputAt: 9 }), terminal("term_b")];
		const { host, sent } = fakeHost({ terminals: candidates });

		const outcome = await hostControllerFor(root, [thread(1, 0)], host).send(clipboard.copy);
		expect(outcome).toEqual({
			kind: "choose",
			count: 1,
			handoffId: readHandoff(root).record?.handoffId ?? "",
			candidates,
		});
		expect(sent).toHaveLength(0);
		expect(readHandoff(root).record?.delivery).toEqual({ kind: "queued" });
		expect(clipboard.copies).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("no terminals at all leaves the batch queued rather than an empty choice", async () => {
	const root = await scratchRepository();
	try {
		const { host, sent } = fakeHost({ terminals: [] });

		expect(await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard)).toEqual({
			kind: "queued",
			count: 1,
		});
		expect(sent).toHaveLength(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// ── The picker's choice and the session target it leaves behind ────────────

test("deliverTo delivers, finalises the record, and remembers the choice", async () => {
	const root = await scratchRepository();
	try {
		const candidates = [terminal("term_a", { lastOutputAt: 9 }), terminal("term_b")];
		const { host, sent } = fakeHost({ terminals: candidates });
		const controller = hostControllerFor(root, [thread(1, 0)], host);

		const choice = await controller.send(refuseClipboard);
		expect(choice.kind).toBe("choose");
		const handoffId = readHandoff(root).record?.handoffId ?? "";

		const outcome = await controller.deliverTo(handoffId, candidates[1] as HostTerminal);
		expect(outcome).toEqual({ kind: "delivered", count: 1, title: "term_b" });
		expect(sent).toEqual([{ handle: "term_b", text: WAKE_UP_PROMPT }]);
		expect(readHandoff(root).record?.delivery).toMatchObject({
			kind: "delivered",
			terminal: "term_b",
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the next Send reuses the terminal deliverTo chose, without asking again", async () => {
	const root = await scratchRepository();
	try {
		const candidates = [terminal("term_a", { lastOutputAt: 9 }), terminal("term_b")];
		const { host, sent } = fakeHost({ terminals: candidates });
		let threads = [thread(1, 0)];
		const controller = createFeedbackController({
			repositoryRoot: root,
			runId,
			threads: () => threads,
			host,
		});

		const choice = await controller.send(refuseClipboard);
		expect(choice.kind).toBe("choose");
		const handoffId = readHandoff(root).record?.handoffId ?? "";
		await controller.deliverTo(handoffId, candidates[1] as HostTerminal);

		threads = [...threads, freshThread(2)];
		const outcome = await controller.send(refuseClipboard);
		expect(outcome).toEqual({ kind: "delivered", count: 1, title: "term_b" });
		expect(sent.map((each) => each.handle)).toEqual(["term_b", "term_b"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a session target the host no longer lists falls through to the origin, then the picker", async () => {
	const root = await scratchRepository();
	try {
		const chosen = terminal("term_a", { lastOutputAt: 9 });
		const other = terminal("term_b");
		const sent: { handle: string; text: string }[] = [];
		let listing = [chosen, other];
		const host: HostAdapter = {
			listTerminals: async () => listing,
			sendToTerminal: async (handle, text) => {
				sent.push({ handle, text });
				return true;
			},
		};
		let threads = [thread(1, 0)];
		const controller = createFeedbackController({
			repositoryRoot: root,
			runId,
			threads: () => threads,
			host,
		});
		await controller.send(refuseClipboard);
		const handoffId = readHandoff(root).record?.handoffId ?? "";
		await controller.deliverTo(handoffId, chosen);

		// term_a vanishes; term_b is now the origin, so it wins over the picker.
		listing = [other];
		threads = [...threads, freshThread(2)];
		recordOrigin(root, "tab1:term_b");

		const outcome = await controller.send(refuseClipboard);
		expect(outcome).toEqual({ kind: "delivered", count: 1, title: "term_b" });
		expect(sent.map((each) => each.handle)).toEqual(["term_a", "term_b"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a vanished session target with no origin falls through to the picker", async () => {
	const root = await scratchRepository();
	try {
		const chosen = terminal("term_a", { lastOutputAt: 9 });
		const others = [terminal("term_b"), terminal("term_c")];
		const sent: { handle: string; text: string }[] = [];
		let listing = [chosen, ...others];
		const host: HostAdapter = {
			listTerminals: async () => listing,
			sendToTerminal: async (handle, text) => {
				sent.push({ handle, text });
				return true;
			},
		};
		let threads = [thread(1, 0)];
		const controller = createFeedbackController({
			repositoryRoot: root,
			runId,
			threads: () => threads,
			host,
		});
		await controller.send(refuseClipboard);
		const handoffId = readHandoff(root).record?.handoffId ?? "";
		await controller.deliverTo(handoffId, chosen);

		// term_a vanishes with no origin recorded, so the two remaining terminals go to the picker.
		listing = others;
		threads = [...threads, freshThread(2)];

		const outcome = await controller.send(refuseClipboard);
		expect(outcome).toEqual({
			kind: "choose",
			count: 1,
			handoffId: readHandoff(root).record?.handoffId ?? "",
			candidates: others,
		});
		expect(sent.map((each) => each.handle)).toEqual(["term_a"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("forced choose returns candidates even with a live origin", async () => {
	const root = await scratchRepository();
	try {
		const candidates = [terminal("term_a", { lastOutputAt: 9 }), terminal("term_b")];
		const { host, sent } = fakeHost({ terminals: candidates });
		recordOrigin(root, "tab1:term_b");

		const outcome = await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard, {
			choose: true,
		});

		expect(outcome).toEqual({
			kind: "choose",
			count: 1,
			handoffId: readHandoff(root).record?.handoffId ?? "",
			candidates,
		});
		expect(sent).toHaveLength(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("deliverTo with a stale handoffId does not overwrite a newer record", async () => {
	const root = await scratchRepository();
	try {
		const candidates = [terminal("term_a", { lastOutputAt: 9 }), terminal("term_b")];
		const { host, sent } = fakeHost({ terminals: candidates });
		const controller = hostControllerFor(root, [thread(1, 0)], host);
		const choice = await controller.send(refuseClipboard);
		expect(choice.kind).toBe("choose");
		const staleHandoffId = readHandoff(root).record?.handoffId ?? "";

		const newer = handoff(at(50), []);
		writeHandoff(root, newer);

		const outcome = await controller.deliverTo(staleHandoffId, candidates[1] as HostTerminal);
		expect(outcome).toEqual({ kind: "queued", count: 0 });
		expect(readHandoff(root).record).toEqual(newer);
		expect(sent).toEqual([{ handle: "term_b", text: WAKE_UP_PROMPT }]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a Send that lands while a nudge is in flight is not overwritten by the older delivery", async () => {
	const root = await scratchRepository();
	try {
		const newer = handoff(at(50), []);
		const { host } = fakeHost({
			terminals: [terminal("term_only")],
			send: () => {
				writeHandoff(root, newer);
				return true;
			},
		});

		const outcome = await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard);

		expect(outcome).toEqual({ kind: "queued", count: 1 });
		expect(readHandoff(root).record).toEqual(newer);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// The host module is covered against a fake Orca of its own; this one test joins the two halves,
// so the pane key the agent records and the pane key the CLI reports have to agree.

const ORCA_SCRIPT = `#!/bin/sh
dir=$(dirname "$0")
if [ "$2" = "list" ]; then
	cat "$dir/list.json"
	exit 0
fi
printf '%s\\n' "$*" >> "$dir/send.log"
printf '{"ok":true}\\n'
`;

const orcaTerminal = (leafId: string, title: string) => ({
	handle: `term_${leafId}`,
	tabId: "tab1",
	leafId,
	title,
	lastOutputAt: 1,
	connected: true,
	writable: true,
});

test("through the Orca CLI, Send wakes the pane the agent recorded and stores its title", async () => {
	const root = await scratchRepository();
	const orca = await mkdtemp(join(tmpdir(), "revue-orca-"));
	try {
		await writeFile(join(orca, "orca"), ORCA_SCRIPT, { mode: 0o755 });
		const terminals = [orcaTerminal("own", "revue"), orcaTerminal("agent", "claude\u0007 code")];
		await writeFile(join(orca, "list.json"), JSON.stringify({ ok: true, result: { terminals } }));
		recordOrigin(root, "tab1:agent");
		const host = createHostAdapter({
			ORCA_WORKTREE_ID: "wt-1",
			ORCA_PANE_KEY: "tab1:own",
			ORCA_CLI_COMMAND: join(orca, "orca"),
		});

		const outcome = await hostControllerFor(root, [thread(1, 0)], host).send(refuseClipboard);

		expect(outcome).toEqual({ kind: "delivered", count: 1, title: "claude code" });
		expect(readHandoff(root).record?.delivery).toEqual({
			kind: "delivered",
			host: "orca",
			terminal: "term_agent",
			title: "claude code",
		});
		expect(await readFile(join(orca, "send.log"), "utf8")).toContain("--terminal term_agent");
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(orca, { recursive: true, force: true });
	}
});
