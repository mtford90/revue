import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import skillSource from "../../../skills/revue-chapters/SKILL.md" with { type: "text" };
import { REVUE_VERSION } from "./version.ts";

export const SKILL_NAME = "revue-chapters";

export type SkillScope = "project" | "user";

export type SkillInstallOutcome = "installed" | "updated" | "unchanged";

export type SkillInstallResult = {
	path: string;
	outcome: SkillInstallOutcome;
};

// The installed copy carries the CLI version that wrote it, so `revue doctor` can report
// drift between an upgraded CLI and a stale skill.
const stampedSkill = (): string =>
	skillSource.replace(/^---\n/, `---\nrevue-version: ${REVUE_VERSION}\n`);

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

export const installSkill = (scope: SkillScope): SkillInstallResult => {
	const path = skillPathFor(scope);
	const next = stampedSkill();
	const current = existsSync(path) ? readFileSync(path, "utf8") : null;
	if (current === next) return { path, outcome: "unchanged" };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, next, "utf8");
	return { path, outcome: current === null ? "installed" : "updated" };
};

/** The stamped CLI version of an installed skill, or null when absent or unstamped. */
export const installedSkillVersion = (path: string): string | null => {
	if (!existsSync(path)) return null;
	const match = /^revue-version: (.+)$/m.exec(readFileSync(path, "utf8"));
	return match?.[1]?.trim() ?? null;
};
