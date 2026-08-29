import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type HandoffRecord, handoffRecordSchema } from "@revue/types";
import { z } from "zod";
import { writeFileAtomically } from "./atomic.ts";
import { threadStorePath, withThreadStoreLock } from "./threads.ts";

// The handoff is the durable half of Send: the reviewer's last batch of feedback, written before
// any wake-up prompt is attempted. It lives beside the thread store rather than in a run, because
// it names threads that outlive the run they were requested against.

export class HandoffError extends Error {}

export const handoffPath = (repositoryRoot: string): string =>
	join(repositoryRoot, ".revue", "handoff.json");

/**
 * The last handoff, or nothing and the reason why. A damaged record is reported rather than
 * thrown: orientation is a cold-start need, and the threads it names are still on disk.
 */
export type HandoffRead = { record: HandoffRecord | null; warning?: string };

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const schemaComplaint = (error: z.ZodError): string =>
	z.prettifyError(error).replace(/\s*\n\s*/g, " ");

export function readHandoff(repositoryRoot: string): HandoffRead {
	const path = handoffPath(repositoryRoot);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { record: null };
		return { record: null, warning: `Could not read the handoff at ${path}: ${describe(error)}` };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		return {
			record: null,
			warning: `The handoff at ${path} is not valid JSON: ${describe(error)}`,
		};
	}
	const parsed = handoffRecordSchema.safeParse(value);
	if (!parsed.success) {
		return {
			record: null,
			warning: `The handoff at ${path} does not match the handoff schema: ${schemaComplaint(parsed.error)}`,
		};
	}
	return { record: parsed.data };
}

/**
 * Overwrite the handoff with this batch. The write takes the thread store's lock, so a Send and a
 * thread mutation cannot interleave, and lands atomically, so a failed Send tells the agent nothing.
 */
export function writeHandoff(repositoryRoot: string, record: HandoffRecord): void {
	const path = handoffPath(repositoryRoot);
	const parsed = handoffRecordSchema.parse(record);
	try {
		withThreadStoreLock(threadStorePath(repositoryRoot), () => {
			writeFileAtomically(path, `${JSON.stringify(parsed, null, 2)}\n`);
		});
	} catch (error) {
		throw new HandoffError(`Could not write the handoff at ${path}: ${describe(error)}`);
	}
}
