#!/bin/sh
# Run from any directory; this demo always uses the checkout's TypeScript entrypoint.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
fixtures="$root/examples/revuediff"
revuediff() {
	bun run "$root/packages/revuediff/src/main.ts" "$@"
}

mode=${1:-all}
case "$mode" in
	basic)
		printf '%s\n' '== Normal multi-file Git diff (stacked) =='
		revuediff --paging=never --width=72 --theme=ayu-dark < "$fixtures/feature.patch"
		;;
	split)
		printf '%s\n' '== Normal multi-file Git diff (split at 80 columns) =='
		revuediff --paging=never --width=120 --theme=ayu-dark < "$fixtures/feature.patch"
		;;
	narrow)
		printf '%s\n' '== Narrow wrapped layout =='
		revuediff --paging=never --width=48 --theme=ayu-dark < "$fixtures/feature.patch"
		;;
	chrome)
		for flags in '' '--line-numbers' '--change-markers' '--line-numbers --change-markers'; do
			printf '\n== Chrome: %s ==\n' "${flags:-both off (default)}"
			# Intentional word splitting exercises the four independent flag combinations.
			# shellcheck disable=SC2086
			revuediff --paging=never --width=48 $flags < "$fixtures/plain.patch"
		done
		;;
	themes)
		for theme in ayu-dark github-light dracula; do
			printf '\n== Theme: %s ==\n' "$theme"
			revuediff --paging=never --width=72 --theme="$theme" < "$fixtures/feature.patch"
		done
		;;
	passthrough)
		printf '%s\n' '== Unsupported input is sanitised and passed through =='
		revuediff --paging=never < "$fixtures/unsupported-input.txt"
		;;
	paging)
		printf '%s\n' '== Downstream paging =='
		if [ -t 1 ]; then
			printf '%s\n' 'Using the safe explicit pager: cat - (replace it with less -RFK interactively).'
			revuediff --paging=always --pager 'cat -' --width=72 < "$fixtures/feature.patch"
		else
			printf '%s\n' "stdout is not a terminal, so Revuediff correctly bypasses paging; run this mode in a terminal to exercise --pager 'cat -'."
			revuediff --paging=never --width=72 < "$fixtures/plain.patch"
		fi
		;;
	all)
		for selected in basic split narrow chrome themes passthrough paging; do
			"$0" "$selected"
		done
		;;
	-h|--help|help)
		cat <<'USAGE'
Usage: ./examples/revuediff/demo.sh <mode>

Modes: basic, split, narrow, chrome, themes, passthrough, paging, all
USAGE
		;;
	*)
		printf 'Unknown mode: %s\n' "$mode" >&2
		"$0" --help >&2
		exit 1
		;;
esac
