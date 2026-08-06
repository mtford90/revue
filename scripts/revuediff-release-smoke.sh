#!/usr/bin/env bash
# Exercises the compiled Revuediff stdin and paging-relevant CLI boundary without OpenTUI.
set -euo pipefail

if [ $# -lt 1 ]; then
	echo "usage: revuediff-release-smoke.sh <executable> [expected-version]" >&2
	exit 2
fi

BIN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
EXPECTED_VERSION="${2:-}"

reported="$("$BIN" --version)"
echo "version: $reported"
if [ -n "$EXPECTED_VERSION" ] && [ "$reported" != "revuediff $EXPECTED_VERSION" ]; then
	echo "expected 'revuediff $EXPECTED_VERSION', got '$reported'" >&2
	exit 1
fi

"$BIN" --help | grep -q 'revuediff'
output="$(printf 'diff --git a/a.ts b/a.ts\nindex 1111111..2222222 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n' | "$BIN" --paging=never --width 80 --theme ayu-dark)"
printf '%s' "$output" | grep -q 'a.ts'
printf '%s' "$output" | grep -qF $'\033['
if printf '%s' "$output" | grep -qF $'\033[?1049h' || printf '%s' "$output" | grep -qF $'\033]'; then
	echo "revuediff emitted unsafe terminal control sequences" >&2
	exit 1
fi

passthrough="$(printf '\033[31mnot a diff\033[0m\n' | "$BIN" --paging=never)"
[ "$passthrough" = "not a diff" ]

echo "revuediff smoke test passed"
