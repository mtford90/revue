import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import skillSource from "../../../skills/revue/SKILL.md" with { type: "text" };
import { REVUE_VERSION } from "./version.ts";

export const SKILL_NAME = "revue";

export type SkillScope = "project" | "user";

// The installed copy carries the CLI version that wrote it, so `revue doctor` can report
// drift between an upgraded CLI and a stale skill.
export const stampedSkill = (): string =>
	skillSource.replace(/^---\n/, `---\nrevue-version: ${REVUE_VERSION}\n`);

export type SkillRunner = { label: string; command: string[] };

// Distribution mechanics belong to the skills CLI (vercel-labs/skills): it detects the
// coding agents on the machine and owns every per-harness install path. Revue only
// supplies the version-stamped skill text.
const RUNNERS: SkillRunner[] = [
	{ label: "npx", command: ["npx", "-y", "skills"] },
	{ label: "pnpm", command: ["pnpm", "dlx", "skills"] },
	{ label: "bunx", command: ["bunx", "skills"] },
	{ label: "yarn", command: ["yarn", "dlx", "skills"] },
];

export const resolveSkillRunner = (): SkillRunner | null => {
	const override = process.env.REVUE_SKILL_RUNNER;
	if (override) return { label: override, command: override.split(/\s+/) };
	return RUNNERS.find((runner) => runner.command[0] && Bun.which(runner.command[0])) ?? null;
};

export const installSkill = async (scope: SkillScope, runner: SkillRunner): Promise<number> => {
	const container = await mkdtemp(join(tmpdir(), "revue-skill-"));
	const directory = join(container, SKILL_NAME);
	await mkdir(directory);
	await writeFile(join(directory, "SKILL.md"), stampedSkill(), "utf8");
	const child = Bun.spawn(
		[...runner.command, "add", directory, "--copy", "-y", ...(scope === "user" ? ["-g"] : [])],
		{ stdin: "inherit", stdout: "inherit", stderr: "inherit" },
	);
	return await child.exited;
};

const projectRoot = (): string => {
	const child = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const root = child.success ? new TextDecoder().decode(child.stdout).trim() : "";
	return root || process.cwd();
};

export const skillPathFor = (scope: SkillScope): string =>
	join(scope === "user" ? homedir() : projectRoot(), ".claude", "skills", SKILL_NAME, "SKILL.md");

/** The stamped CLI version of an installed skill, or null when absent or unstamped. */
export const installedSkillVersion = (path: string): string | null => {
	if (!existsSync(path)) return null;
	const match = /^revue-version: (.+)$/m.exec(readFileSync(path, "utf8"));
	return match?.[1]?.trim() ?? null;
};
