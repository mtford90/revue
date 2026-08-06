import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const LOCAL_NOTICES = ["diff", "diff-opentui", "tui", "theme", "types"] as const;

export async function copyLocalNotices(stagingDirectory: string): Promise<void> {
	await mkdir(stagingDirectory, { recursive: true });
	const root = resolve(import.meta.dir, "..");
	await Promise.all([
		...LOCAL_NOTICES.map((name) =>
			copyFile(
				join(root, "packages", name, "THIRD_PARTY_NOTICES.md"),
				join(stagingDirectory, `THIRD_PARTY_NOTICES-${name}.md`),
			),
		),
		copyFile(
			join(root, "skills", "revue", "THIRD_PARTY_NOTICES.md"),
			join(stagingDirectory, "THIRD_PARTY_NOTICES-skill.md"),
		),
	]);
}

if (import.meta.main) {
	const stagingDirectory = process.argv[2];
	if (!stagingDirectory)
		throw new Error("usage: bun scripts/copy-local-notices.ts <staging-directory>");
	await copyLocalNotices(stagingDirectory);
}
