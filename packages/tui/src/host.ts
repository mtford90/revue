import { type AgentHost, detectAgentHost } from "@revue/prep";
import { z } from "zod";

// Delivery is a courtesy laid over the handoff record, so nothing in here reports a failure: an
// unreachable host, a refused command, or output that is not what this module expects all read as
// "no delivery", and the reviewer is left with a queued batch the agent can still find on disk.

const CLI_TIMEOUT_MS = 5_000;
const TITLE_LIMIT = 60;

/** A detected host together with the executable that talks to it. */
export type Host = AgentHost & { cli: string };

/** One terminal a wake-up prompt could go to. `paneKey` is `tabId:leafId`, as the origin records it. */
export type HostTerminal = {
	handle: string;
	paneKey: string;
	title: string;
	lastOutputAt: number | null;
};

/** All the feedback controller asks of a host, so a fake stands in for Orca in tests. */
export type HostAdapter = {
	listTerminals: () => Promise<HostTerminal[] | null>;
	sendToTerminal: (handle: string, text: string) => Promise<boolean>;
};

const identifier = z.union([z.string(), z.number()]).transform(String);

const terminalSchema = z.object({
	handle: z.string().min(1),
	title: z.string().default(""),
	tabId: identifier,
	leafId: identifier,
	lastOutputAt: z.number().nullable().optional(),
	connected: z.boolean().optional(),
	writable: z.boolean().optional(),
});

const terminalListSchema = z.object({
	ok: z.literal(true),
	result: z.object({ terminals: z.array(terminalSchema) }),
});

const commandOkSchema = z.object({ ok: z.literal(true) });

export const detectHost = (env: NodeJS.ProcessEnv = process.env): Host | null => {
	const host = detectAgentHost(env);
	return host ? { ...host, cli: env.ORCA_CLI_COMMAND ?? "orca" } : null;
};

const isControl = (character: string): boolean => {
	const code = character.codePointAt(0) ?? 0;
	return (code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
};

/** The C0/C1 controls the thread schema also refuses, and the format characters — bidi overrides,
 * zero-width joiners — that would otherwise reorder or hide the rest of the line. */
const stripControls = (value: string): string =>
	[...value]
		.filter((character) => !isControl(character))
		.join("")
		.replace(/\p{Cf}/gu, "");

const truncate = (value: string): string => {
	const characters = [...value];
	if (characters.length <= TITLE_LIMIT) return value;
	return `${characters
		.slice(0, TITLE_LIMIT - 1)
		.join("")
		.trimEnd()}…`;
};

/** A title is a shell's idea of a label: it goes on screen and into the record, so it is stripped
 * of the control characters the thread schema also refuses, folded onto one line, and cut short.
 * A title that survives none of that leaves the handle, which is at least addressable. */
const sanitiseTitle = (title: string, handle: string): string => {
	const collapsed = stripControls(title).replace(/\s+/g, " ").trim();
	return collapsed ? truncate(collapsed) : handle;
};

const asHostTerminal = (terminal: z.infer<typeof terminalSchema>): HostTerminal => ({
	handle: terminal.handle,
	paneKey: `${terminal.tabId}:${terminal.leafId}`,
	title: sanitiseTitle(terminal.title, terminal.handle),
	lastOutputAt: terminal.lastOutputAt ?? null,
});

/** Most recently spoken first; a terminal that has never said anything sorts last. */
const byRecentOutput = (left: HostTerminal, right: HostTerminal): number => {
	if (left.lastOutputAt === right.lastOutputAt) return 0;
	if (left.lastOutputAt === null) return 1;
	if (right.lastOutputAt === null) return -1;
	return right.lastOutputAt - left.lastOutputAt;
};

const runCli = async (host: Host, args: string[]): Promise<unknown> => {
	try {
		const child = Bun.spawn([host.cli, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			timeout: CLI_TIMEOUT_MS,
		});
		const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return exitCode === 0 ? JSON.parse(stdout) : null;
	} catch {
		return null;
	}
};

/** The worktree's terminals a prompt could go to: never the TUI's own pane, and never one the host
 * says it cannot reach. The worktree is named by the id the TUI is running under rather than by
 * whichever one has focus, which need not be this one. Null is "the host did not answer", which is
 * not the same as no candidates. */
export const listTerminals = async (host: Host): Promise<HostTerminal[] | null> => {
	const worktree = `id:${host.worktreeId}`;
	const answer = await runCli(host, ["terminal", "list", "--worktree", worktree, "--json"]);
	const parsed = terminalListSchema.safeParse(answer);
	if (!parsed.success) return null;
	return parsed.data.result.terminals
		.filter((terminal) => terminal.connected !== false && terminal.writable !== false)
		.map(asHostTerminal)
		.filter((terminal) => terminal.paneKey !== host.paneKey)
		.sort(byRecentOutput);
};

/** Types the text into a terminal and presses Enter for the reviewer. */
export const sendToTerminal = async (
	host: Host,
	handle: string,
	text: string,
): Promise<boolean> => {
	const args = ["terminal", "send", "--terminal", handle, "--text", text, "--enter", "--json"];
	return commandOkSchema.safeParse(await runCli(host, args)).success;
};

/** The adapter the TUI hands the feedback controller, or null when nothing here can deliver. */
export const createHostAdapter = (env: NodeJS.ProcessEnv = process.env): HostAdapter | null => {
	const host = detectHost(env);
	if (!host) return null;
	return {
		listTerminals: () => listTerminals(host),
		sendToTerminal: (handle, text) => sendToTerminal(host, handle, text),
	};
};
