import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

interface InstallerCase {
	name: string;
	script: string;
	prefix: string;
	version: string;
	archive: (tag: string, target: string) => string;
	installEnvironment: string;
	addon: string;
}

const cases: InstallerCase[] = [
	{
		name: "Revue",
		script: "site/install.sh",
		prefix: "v",
		version: "1.2.3",
		archive: (tag, target) => `revue-${tag}-${target}.tar.gz`,
		installEnvironment: "REVUE_INSTALL",
		addon: "revue-highlighter.node",
	},
	{
		name: "Revuediff",
		script: "site/revuediff/install.sh",
		prefix: "revuediff-v",
		version: "2.3.4",
		archive: (tag, target) => `${tag}-${target}.tar.gz`,
		installEnvironment: "REVUEDIFF_INSTALL",
		addon: "revuediff-highlighter.node",
	},
];

function releases(tags: Array<{ tag: string; prerelease?: boolean }>): string {
	return `${JSON.stringify(
		tags.map(({ tag, prerelease = false }) => ({
			tag_name: tag,
			draft: false,
			prerelease,
		})),
		null,
		2,
	)}\n`;
}

describe.each(cases)("$name installer release resolution", (installer) => {
	test("paginates until the latest product-specific stable exact-semver release", async () => {
		const root = await mkdtemp(`${tmpdir()}/revue-installer-`);
		temporaryDirectories.push(root);
		const bin = `${root}/bin`;
		const install = `${root}/install`;
		const payload = `${root}/payload`;
		await Promise.all([mkdir(bin), mkdir(install), mkdir(payload)]);

		const tag = `${installer.prefix}${installer.version}`;
		const target = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
		const executableName = installer.name.toLowerCase();
		await writeFile(
			`${payload}/${executableName}`,
			`#!/bin/sh\necho '${executableName} ${installer.version}'\n`,
		);
		await chmod(`${payload}/${executableName}`, 0o755);
		await writeFile(`${payload}/${installer.addon}`, "native addon fixture");
		const archiveName = installer.archive(tag, target);
		const archivePath = `${root}/${archiveName}`;
		const tar = Bun.spawnSync(["tar", "-czf", archivePath, "-C", payload, "."]);
		expect(tar.exitCode).toBe(0);
		const sha = new Bun.CryptoHasher("sha256")
			.update(await Bun.file(archivePath).arrayBuffer())
			.digest("hex");

		const wrongPrefix = installer.name === "Revue" ? "revuediff-v" : "v";
		await writeFile(
			`${root}/page-1.json`,
			releases([
				{ tag: `${installer.prefix}99.0.0-rc.1` },
				{ tag: `${installer.prefix}98.0.0`, prerelease: true },
				{ tag: `${installer.prefix}01.2.3` },
				...Array.from({ length: 97 }, (_, index) => ({ tag: `${wrongPrefix}9.0.${index}` })),
			]),
		);
		await writeFile(`${root}/page-2.json`, releases([{ tag }]));

		await writeFile(
			`${bin}/curl`,
			`#!/bin/sh
set -eu
url=""
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$MOCK_CURL_LOG"
case "$url" in
  *api.github.com*releases*page=1) cat "$MOCK_ROOT/page-1.json" ;;
  *api.github.com*releases*page=2) cat "$MOCK_ROOT/page-2.json" ;;
  *api.github.com*releases*) printf '[]\\n' ;;
  */checksums.txt) printf '${sha}  ${archiveName}\\n' > "$out" ;;
  */${archiveName}) cp "$MOCK_ROOT/${archiveName}" "$out" ;;
  *) echo "unexpected URL: $url" >&2; exit 1 ;;
esac
`,
		);
		await chmod(`${bin}/curl`, 0o755);

		const child = Bun.spawn({
			cmd: ["sh", installer.script],
			cwd: `${import.meta.dir}/..`,
			env: {
				...Bun.env,
				PATH: `${bin}:${Bun.env.PATH}`,
				MOCK_ROOT: root,
				MOCK_CURL_LOG: `${root}/curl.log`,
				[installer.installEnvironment]: install,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(stdout).toContain(`installed ${executableName} ${installer.version}`);
		expect(await Bun.file(`${install}/${installer.addon}`).text()).toBe("native addon fixture");
		expect(await Bun.file(`${root}/curl.log`).text()).toContain("per_page=100&page=2");
	});
});
