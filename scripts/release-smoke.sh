#!/usr/bin/env bash
# Smoke-tests a compiled revue executable before it is released. The PTY stage is the
# important one: it proves the OpenTUI native layer was actually embedded for this
# platform, which `--check` alone never exercises.
set -euo pipefail

if [ $# -lt 1 ]; then
	echo "usage: release-smoke.sh <executable> [expected-version]" >&2
	exit 2
fi

BIN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
EXPECTED_VERSION="${2:-}"

reported="$("$BIN" --version)"
echo "version: $reported"
if [ -n "$EXPECTED_VERSION" ] && [ "$reported" != "revue $EXPECTED_VERSION" ]; then
	echo "expected 'revue $EXPECTED_VERSION', got '$reported'" >&2
	exit 1
fi

"$BIN" skill print | head -1 | grep -q -- '---'
"$BIN" show examples/sample-run --check | grep -q "run is valid"

transcript="$(mktemp -d)/typescript"
export TERM=xterm-256color
if [ "$(uname)" = "Linux" ]; then
	(sleep 2; printf q) | script -q -e -c "$BIN show examples/sample-run" "$transcript" >/dev/null
else
	(sleep 2; printf q) | script -q "$transcript" "$BIN" show examples/sample-run >/dev/null
fi

# The TUI must have entered and cleanly left the alternate screen (mode 1049).
enable=$'\033[?1049h'
disable=$'\033[?1049l'
grep -aqF "$enable" "$transcript"
grep -aqF "$disable" "$transcript"

echo "smoke test passed"
