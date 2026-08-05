// Builds a throwaway git repository per scenario: one base commit, then the scenario's edit left
// uncommitted so `revue diff --ref work` has something to render.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Scenario } from "./scenarios.ts";

const GITIGNORE = ".revue/\n";

const git = async (cwd: string, args: string[]): Promise<void> => {
	const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr.toString()}`);
	}
};

const writeTree = async (root: string, files: Record<string, string>): Promise<void> => {
	for (const [path, contents] of Object.entries(files)) {
		const target = join(root, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, contents, "utf8");
	}
};

/** Creates (or recreates) the scenario's repository and returns its path. */
export const buildFixture = async (scenario: Scenario, fixturesDir: string): Promise<string> => {
	const root = join(fixturesDir, scenario.id);
	await rm(root, { recursive: true, force: true });
	await mkdir(root, { recursive: true });
	await git(root, ["init", "--quiet", "--initial-branch", "main"]);
	await git(root, ["config", "user.name", "Revue Screenshots"]);
	await git(root, ["config", "user.email", "screenshots@revue.invalid"]);
	await git(root, ["config", "commit.gpgsign", "false"]);
	await writeFile(join(root, ".gitignore"), GITIGNORE, "utf8");
	await writeTree(root, scenario.base);
	await git(root, ["add", "--all"]);
	await git(root, ["commit", "--quiet", "--message", `base: ${scenario.summary}`]);
	await writeTree(root, scenario.head);
	return root;
};
