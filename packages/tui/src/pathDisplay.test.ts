import { expect, test } from "bun:test";
import {
	abbreviatePath,
	buildPathTree,
	commonDirPrefix,
	formatDisplayPath,
	nextPathDisplayMode,
} from "./pathDisplay.ts";

test("path display modes cycle smart → tree → full → smart", () => {
	expect(nextPathDisplayMode("smart")).toBe("tree");
	expect(nextPathDisplayMode("tree")).toBe("full");
	expect(nextPathDisplayMode("full")).toBe("smart");
});

test("common prefix is the shared directory chain, never a partial segment", () => {
	expect(
		commonDirPrefix([
			"packages/website/src/env/secret.test.ts",
			"packages/website/src/identifiers/identifier.test.ts",
		]),
	).toBe("packages/website/src/");
	expect(commonDirPrefix(["packages/website/src/a.ts", "packages/webhooks/src/b.ts"])).toBe(
		"packages/",
	);
});

test("paths in different roots share no prefix", () => {
	expect(commonDirPrefix(["docs/adr/README.md", "packages/website/src/a.ts"])).toBe("");
	expect(commonDirPrefix([])).toBe("");
});

test("a lone file hoists its whole directory chain", () => {
	expect(commonDirPrefix(["docs/adr/README.md"])).toBe("docs/adr/");
	expect(commonDirPrefix(["README.md"])).toBe("");
});

test("abbreviation leaves fitting paths alone", () => {
	expect(abbreviatePath({ path: "packages/website/src/env/secret.test.ts", width: 80 })).toBe(
		"packages/website/src/env/secret.test.ts",
	);
});

test("abbreviation shortens outermost directories first", () => {
	expect(
		abbreviatePath({ path: "packages/website/src/patient-appointments/dob.test.ts", width: 44 }),
	).toBe("p/w/src/patient-appointments/dob.test.ts");
});

test("abbreviation keeps the filename intact until every directory is a letter", () => {
	expect(
		abbreviatePath({ path: "packages/website/src/patient-appointments/dob.test.ts", width: 22 }),
	).toBe("p/w/s/p/dob.test.ts");
});

test("a width smaller than the filename cuts the tail with an ellipsis", () => {
	expect(
		abbreviatePath({ path: "packages/website/src/sessionCookieWriters.guard.test.ts", width: 14 }),
	).toBe("p/w/s/session…");
	expect(abbreviatePath({ path: "abcdef", width: 1 })).toBe("…");
	expect(abbreviatePath({ path: "abcdef", width: 0 })).toBe("");
});

test("dotfile directories keep two characters", () => {
	expect(abbreviatePath({ path: ".github/workflows/ci.yml", width: 16 })).toBe(".g/w/ci.yml");
});

test("single-segment paths abbreviate to an ellipsis cut only", () => {
	expect(abbreviatePath({ path: "CHANGELOG.md", width: 8 })).toBe("CHANGEL…");
});

test("rename pairs abbreviate each side and keep the arrow", () => {
	const path = "packages/website/src/old/name.ts -> packages/website/src/new/name.ts";
	const formatted = formatDisplayPath({ path, width: 40 });
	expect(formatted).toContain(" -> ");
	expect(formatted.length).toBeLessThanOrEqual(40);
	expect(formatted.endsWith("name.ts")).toBe(true);
});

test("tree rows collapse single-child directory chains", () => {
	expect(
		buildPathTree([
			"docs/adr/0024.md",
			"docs/adr/README.md",
			"packages/website/src/patient-appointments/dob.test.ts",
			"packages/website/src/patient-appointments/session.test.ts",
			"packages/website/src/env/secret.test.ts",
		]),
	).toEqual([
		{ kind: "dir", depth: 0, label: "docs/adr/" },
		{ kind: "file", depth: 1, label: "0024.md", path: "docs/adr/0024.md" },
		{ kind: "file", depth: 1, label: "README.md", path: "docs/adr/README.md" },
		{ kind: "dir", depth: 0, label: "packages/website/src/" },
		{ kind: "dir", depth: 1, label: "patient-appointments/" },
		{
			kind: "file",
			depth: 2,
			label: "dob.test.ts",
			path: "packages/website/src/patient-appointments/dob.test.ts",
		},
		{
			kind: "file",
			depth: 2,
			label: "session.test.ts",
			path: "packages/website/src/patient-appointments/session.test.ts",
		},
		{ kind: "dir", depth: 1, label: "env/" },
		{
			kind: "file",
			depth: 2,
			label: "secret.test.ts",
			path: "packages/website/src/env/secret.test.ts",
		},
	]);
});

test("root-level files sit at depth zero after the directories", () => {
	expect(buildPathTree(["README.md", "src/a.ts"])).toEqual([
		{ kind: "dir", depth: 0, label: "src/" },
		{ kind: "file", depth: 1, label: "a.ts", path: "src/a.ts" },
		{ kind: "file", depth: 0, label: "README.md", path: "README.md" },
	]);
});
