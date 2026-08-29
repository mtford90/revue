import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostAdapter, detectHost, type Host, listTerminals, sendToTerminal } from "./host.ts";

// The real Orca is not available to a test, and its CLI override is the documented way to put
// something else in its place, so every test here drives a script that answers like Orca does.

const SCRIPT = `#!/bin/sh
dir=$(dirname "$0")
if [ "$2" = "list" ]; then
	cat "$dir/list.json"
	exit "$(cat "$dir/list-exit")"
fi
for argument in "$@"; do printf '%s\\n' "$argument" >> "$dir/send.log"; done
cat "$dir/send.json"
exit "$(cat "$dir/send-exit")"
`;

type FakeTerminal = {
	handle: string;
	title?: string;
	tabId?: string;
	leafId?: string;
	lastOutputAt?: number | null;
	connected?: boolean;
	writable?: boolean;
};

type FakeOrcaInput = {
	terminals?: FakeTerminal[];
	list?: string;
	listExit?: number;
	send?: string;
	sendExit?: number;
};

const OWN_PANE = "tab1:own";

const detectedHost = (cli: string): Host => {
	const host = detectHost({
		ORCA_WORKTREE_ID: "wt-1",
		ORCA_PANE_KEY: OWN_PANE,
		ORCA_CLI_COMMAND: cli,
	});
	if (!host) throw new Error("the fake Orca should read as a host");
	return host;
};

const okList = (terminals: FakeTerminal[]) =>
	JSON.stringify({
		ok: true,
		result: {
			terminals: terminals.map((terminal) => ({
				tabId: "tab1",
				leafId: terminal.handle,
				title: terminal.handle,
				lastOutputAt: null,
				connected: true,
				writable: true,
				...terminal,
			})),
		},
	});

const fakeOrca = async (input: FakeOrcaInput = {}) => {
	const directory = await mkdtemp(join(tmpdir(), "revue-orca-"));
	const cli = join(directory, "orca");
	await writeFile(cli, SCRIPT, { mode: 0o755 });
	await writeFile(join(directory, "list.json"), input.list ?? okList(input.terminals ?? []));
	await writeFile(join(directory, "list-exit"), String(input.listExit ?? 0));
	await writeFile(join(directory, "send.json"), input.send ?? JSON.stringify({ ok: true }));
	await writeFile(join(directory, "send-exit"), String(input.sendExit ?? 0));
	const host = detectedHost(cli);
	const sentArguments = async () =>
		(await readFile(join(directory, "send.log"), "utf8").catch(() => "")).split("\n").slice(0, -1);
	return { host, directory, sentArguments };
};

const withFakeOrca = async (
	input: FakeOrcaInput,
	body: (fake: Awaited<ReturnType<typeof fakeOrca>>) => Promise<void>,
) => {
	const fake = await fakeOrca(input);
	try {
		await body(fake);
	} finally {
		await rm(fake.directory, { recursive: true, force: true });
	}
};

test("the TUI's own pane is never a candidate, nor is a terminal the host cannot reach", async () => {
	await withFakeOrca(
		{
			terminals: [
				{ handle: "term_own", leafId: "own" },
				{ handle: "term_gone", connected: false },
				{ handle: "term_locked", writable: false },
				{ handle: "term_agent" },
			],
		},
		async ({ host }) => {
			const terminals = await listTerminals(host);
			expect(terminals?.map((terminal) => terminal.handle)).toEqual(["term_agent"]);
			expect(terminals?.[0]?.paneKey).toBe("tab1:term_agent");
		},
	);
});

test("candidates are ordered by the most recent output, with silent terminals last", async () => {
	await withFakeOrca(
		{
			terminals: [
				{ handle: "term_quiet", lastOutputAt: null },
				{ handle: "term_old", lastOutputAt: 100 },
				{ handle: "term_recent", lastOutputAt: 900 },
			],
		},
		async ({ host }) => {
			const terminals = await listTerminals(host);
			expect(terminals?.map((terminal) => terminal.handle)).toEqual([
				"term_recent",
				"term_old",
				"term_quiet",
			]);
		},
	);
});

test("titles are stripped of control characters, folded onto one line and cut short", async () => {
	await withFakeOrca(
		{
			terminals: [
				{ handle: "term_a", title: "agent \u001b[31mpane\n\tone", lastOutputAt: 3 },
				{ handle: "term_b", title: `${"long".repeat(30)} tail`, lastOutputAt: 2 },
				{ handle: "term_c", title: "", lastOutputAt: 1 },
			],
		},
		async ({ host }) => {
			const titles = (await listTerminals(host))?.map((terminal) => terminal.title);
			expect(titles?.[0]).toBe("agent [31mpane one");
			expect(titles?.[1]).toBe(`${"long".repeat(14)}lon…`);
			expect(titles?.[1]?.length).toBe(60);
			expect(titles?.[2]).toBe("term_c");
		},
	);
});

test("a list the host refuses, or answers with nonsense, reads as no answer at all", async () => {
	await withFakeOrca({ listExit: 1, terminals: [{ handle: "term_a" }] }, async ({ host }) => {
		expect(await listTerminals(host)).toBeNull();
	});
	await withFakeOrca({ list: "{ not json" }, async ({ host }) => {
		expect(await listTerminals(host)).toBeNull();
	});
	await withFakeOrca(
		{ list: JSON.stringify({ ok: false, error: "no worktree" }) },
		async ({ host }) => {
			expect(await listTerminals(host)).toBeNull();
		},
	);
});

test("a send types the text into the named terminal and presses Enter", async () => {
	await withFakeOrca({}, async ({ host, sentArguments }) => {
		expect(await sendToTerminal(host, "term_agent", "wake up")).toBe(true);
		expect(await sentArguments()).toEqual([
			"terminal",
			"send",
			"--terminal",
			"term_agent",
			"--text",
			"wake up",
			"--enter",
			"--json",
		]);
	});
});

test("a send the host refuses or declines reports failure rather than throwing", async () => {
	await withFakeOrca({ sendExit: 1 }, async ({ host }) => {
		expect(await sendToTerminal(host, "term_agent", "wake up")).toBe(false);
	});
	await withFakeOrca({ send: JSON.stringify({ ok: false }) }, async ({ host }) => {
		expect(await sendToTerminal(host, "term_agent", "wake up")).toBe(false);
	});
});

test("an executable that is not there is no delivery, not a crash", async () => {
	const host = detectedHost(join(tmpdir(), "revue-no-such-orca"));
	expect(await listTerminals(host)).toBeNull();
	expect(await sendToTerminal(host, "term_agent", "wake up")).toBe(false);
});

test("Orca is only present when it names both the worktree and the pane", () => {
	expect(detectHost({ ORCA_WORKTREE_ID: "wt-1" })).toBeNull();
	expect(detectHost({ ORCA_PANE_KEY: OWN_PANE })).toBeNull();
	expect(createHostAdapter({})).toBeNull();
	expect(detectHost({ ORCA_WORKTREE_ID: "wt-1", ORCA_PANE_KEY: OWN_PANE })).toMatchObject({
		host: "orca",
		paneKey: OWN_PANE,
		cli: "orca",
	});
});

test("the adapter carries the detected host into every call", async () => {
	await withFakeOrca({ terminals: [{ handle: "term_agent" }] }, async ({ host, sentArguments }) => {
		const adapter = createHostAdapter({
			ORCA_WORKTREE_ID: "wt-1",
			ORCA_PANE_KEY: OWN_PANE,
			ORCA_CLI_COMMAND: host.cli,
		});
		expect((await adapter?.listTerminals())?.map((terminal) => terminal.handle)).toEqual([
			"term_agent",
		]);
		expect(await adapter?.sendToTerminal("term_agent", "wake up")).toBe(true);
		expect(await sentArguments()).toContain("--enter");
	});
});
