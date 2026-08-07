import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const LOCAL_NOTICES = ["diff", "diff-opentui", "tui", "theme", "types"] as const;
export const REVUEDIFF_LOCAL_NOTICES = ["diff", "theme"] as const;

export async function copyLocalNotices(
	stagingDirectory: string,
	product: "revue" | "revuediff" = "revue",
): Promise<void> {
	await mkdir(stagingDirectory, { recursive: true });
	const root = resolve(import.meta.dir, "..");
	const notices = product === "revuediff" ? REVUEDIFF_LOCAL_NOTICES : LOCAL_NOTICES;
	await Promise.all([
		...notices.map((name) =>
			copyFile(
				join(root, "packages", name, "THIRD_PARTY_NOTICES.md"),
				join(stagingDirectory, `THIRD_PARTY_NOTICES-${name}.md`),
			),
		),
		...(product === "revue"
			? [
					copyFile(
						join(root, "skills", "revue", "THIRD_PARTY_NOTICES.md"),
						join(stagingDirectory, "THIRD_PARTY_NOTICES-skill.md"),
					),
				]
			: []),
	]);
}

if (import.meta.main) {
	const stagingDirectory = process.argv[2];
	const product = process.argv[3] ?? "revue";
	if (!stagingDirectory || (product !== "revue" && product !== "revuediff"))
		throw new Error(
			"usage: bun scripts/copy-local-notices.ts <staging-directory> [revue|revuediff]",
		);
	await copyLocalNotices(stagingDirectory, product);
}
