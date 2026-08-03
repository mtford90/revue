import { existsSync } from "node:fs";
import { installedSkillVersion, type SkillScope, skillPathFor } from "./skill.ts";
import { REVUE_VERSION } from "./version.ts";

export type DoctorReport = {
	lines: string[];
	healthy: boolean;
};

const commandVersion = (executable: string): string | null => {
	const path = Bun.which(executable);
	if (!path) return null;
	const child = Bun.spawnSync([executable, "--version"], { stdout: "pipe", stderr: "ignore" });
	if (!child.success) return null;
	return new TextDecoder().decode(child.stdout).split("\n")[0]?.trim() || null;
};

const skillLine = (scope: SkillScope): string => {
	const path = skillPathFor(scope);
	if (!existsSync(path)) {
		return `skill ${scope}: not installed — run \`revue skill install${scope === "user" ? " --user" : ""}\``;
	}
	const version = installedSkillVersion(path);
	if (version === REVUE_VERSION) return `skill ${scope}: ok (${version}) at ${path}`;
	const detail = version ? `stamped ${version}, CLI is ${REVUE_VERSION}` : "no version stamp";
	return `skill ${scope}: stale (${detail}) — re-run \`revue skill install${scope === "user" ? " --user" : ""}\``;
};

export const runDoctor = (): DoctorReport => {
	const git = commandVersion("git");
	const difft = commandVersion("difft");
	const lines = [
		`revue ${REVUE_VERSION}`,
		git ? `git: ok (${git})` : "git: MISSING — required by `revue prep`",
		difft
			? `difft: ok (${difft}) — Semantic view available`
			: "difft: not found — optional; Semantic view disabled",
		skillLine("project"),
		skillLine("user"),
	];
	return { lines, healthy: git !== null };
};
