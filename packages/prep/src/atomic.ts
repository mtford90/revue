import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Replace a repository-local record in one step. A reader takes no lock, so a partly written file
 * would read as corruption; a failed write leaves the previous record and no leftover temporary.
 */
export const writeFileAtomically = (path: string, contents: string): void => {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
};
