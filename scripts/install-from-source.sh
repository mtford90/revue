#!/usr/bin/env bash
# Build revue from this checkout and install it over whatever `revue` is on PATH,
# Homebrew-installed or otherwise. With no existing install, it goes to /usr/local/bin.
# Usage: install-from-source.sh [target-directory]
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

command -v bun >/dev/null || { echo "bun is required (https://bun.sh)" >&2; exit 1; }
command -v cargo >/dev/null || { echo "cargo is required for the native highlighter (https://rustup.rs)" >&2; exit 1; }

if [ $# -gt 1 ]; then
	echo "usage: install-from-source.sh [target-directory]" >&2
	exit 2
fi

if [ $# -eq 1 ]; then
	target_dir="$1"
elif existing="$(command -v revue 2>/dev/null)"; then
	target_dir="$(dirname "$existing")"
	echo "replacing existing revue at $existing"
else
	target_dir="/usr/local/bin"
	echo "no revue on PATH; installing to $target_dir"
fi

echo "building revue from $repo"
bun install --frozen-lockfile
bun build --compile packages/tui/src/main.tsx --outfile dist/revue
bash scripts/build-native-highlighter.sh revue dist/revue-highlighter.node

run_in_target() {
	"$@" 2>/dev/null || sudo "$@"
}

[ -d "$target_dir" ] || run_in_target mkdir -p "$target_dir"

# A Homebrew install leaves symlinks into the Cellar; remove them so the copy
# below lands as real files instead of overwriting the Cellar through the link.
for name in revue revue-highlighter.node; do
	if [ -L "$target_dir/$name" ]; then
		run_in_target rm "$target_dir/$name"
	fi
done

run_in_target cp dist/revue dist/revue-highlighter.node "$target_dir/"

installed="$target_dir/revue"
echo "installed $installed ($("$installed" --version))"
resolved="$(command -v revue 2>/dev/null || true)"
if [ -n "$resolved" ] && [ "$resolved" != "$installed" ]; then
	echo "warning: $resolved comes first on PATH and still shadows this install" >&2
fi
if command -v brew >/dev/null && brew list revue >/dev/null 2>&1; then
	echo "note: revue is still installed via Homebrew; a brew upgrade/reinstall will re-link over this build" >&2
fi
