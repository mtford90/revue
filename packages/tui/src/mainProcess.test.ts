import { expect, test } from "bun:test";
import { resolve } from "node:path";

const mainPath = resolve(import.meta.dir, "main.tsx");

const run = async (args: string[]) => {
	const child = Bun.spawn([process.execPath, mainPath, ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
};

test("narrative Revue no longer exposes the pager command", async () => {
	const help = await run(["--help"]);
	expect(help).toMatchObject({ exitCode: 0, stderr: "" });
	expect(help.stdout).not.toContain("revue pager");

	const pager = await run(["pager"]);
	expect(pager).toMatchObject({ exitCode: 1, stdout: "" });
	expect(pager.stderr).toContain("unknown command: pager");
});

test("narrative Revue no longer exposes the export command", async () => {
	const help = await run(["--help"]);
	expect(help).toMatchObject({ exitCode: 0, stderr: "" });
	expect(help.stdout).not.toContain("revue export");

	const exported = await run(["export"]);
	expect(exported).toMatchObject({ exitCode: 1, stdout: "" });
	expect(exported.stderr).toContain("unknown command: export");
});
