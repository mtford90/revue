#!/usr/bin/env bash
# Build the shared N-API addon beside a product executable. The addon is never Bun-embedded.
set -euo pipefail

if [ $# -ne 2 ]; then
	echo "usage: build-native-highlighter.sh <revue|revuediff> <output-path>" >&2
	exit 2
fi

product="$1"
output="$2"
case "$product" in
	revue) name="revue-highlighter.node" ;;
	revuediff) name="revuediff-highlighter.node" ;;
	*) echo "unknown product: $product" >&2; exit 2 ;;
esac

cargo build --manifest-path packages/diff/native/Cargo.toml --release
case "$(uname)" in
	Darwin) library="packages/diff/native/target/release/librevue_highlighter.dylib" ;;
	Linux) library="packages/diff/native/target/release/librevue_highlighter.so" ;;
	*) echo "unsupported native build platform: $(uname)" >&2; exit 1 ;;
esac
mkdir -p "$(dirname "$output")"
cp "$library" "$output"
echo "built $name at $output"
