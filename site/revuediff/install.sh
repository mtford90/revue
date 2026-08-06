#!/bin/sh
# Installs the latest Revuediff release for this platform.
#   curl -fsSL https://revue.mtford.co.uk/revuediff/install.sh | sh
# Set REVUEDIFF_INSTALL to change the install directory (default: ~/.local/bin).
set -eu

repo="mtford90/revue"
install_dir="${REVUEDIFF_INSTALL:-$HOME/.local/bin}"

fail() {
	echo "revuediff install.sh: $1" >&2
	exit 1
}

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
Darwin-arm64) target="darwin-arm64" ;;
Darwin-x86_64) target="darwin-x64" ;;
Linux-x86_64) target="linux-x64" ;;
*) fail "no prebuilt executable for $os/$arch — see https://github.com/$repo#install-revuediff" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required"

resolve_latest_tag() {
	page=1
	while :; do
		body="$(
			curl -fsSL -H 'Accept: application/vnd.github+json' \
				"https://api.github.com/repos/$repo/releases?per_page=100&page=$page"
		)"
		tag="$(
			printf '%s\n' "$body" | awk '
				/^  \{/ { tag = ""; stable = 0; draft = 0 }
				/^    "tag_name":/ {
					tag = $0
					sub(/^[^:]*:[[:space:]]*"/, "", tag)
					sub(/"[,]?$/, "", tag)
				}
				/^    "draft": false/ { draft = 1 }
				/^    "prerelease": false/ { stable = 1 }
				/^  }[,]?$/ {
					if (draft && stable && tag ~ /^revuediff-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/) {
						print tag
						exit
					}
				}
			'
		)"
		[ -z "$tag" ] || { printf '%s\n' "$tag"; return; }
		printf '%s\n' "$body" | grep -q '^  {' || return 1
		page=$((page + 1))
	done
}

tag="$(resolve_latest_tag)" || fail "could not determine the latest stable Revuediff release"
case "$tag" in
revuediff-v[0-9]*.[0-9]*.[0-9]*) ;;
*) fail "could not determine the latest stable Revuediff release" ;;
esac

archive="$tag-$target.tar.gz"
base="https://github.com/$repo/releases/download/$tag"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "downloading $tag ($target)…"
curl -fsSL -o "$tmp/$archive" "$base/$archive"
curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"

expected="$(grep " $archive\$" "$tmp/checksums.txt" | cut -d' ' -f1)"
[ -n "$expected" ] || fail "no checksum for $archive in checksums.txt"
if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "$tmp/$archive" | cut -d' ' -f1)"
else
	actual="$(shasum -a 256 "$tmp/$archive" | cut -d' ' -f1)"
fi
[ "$actual" = "$expected" ] || fail "checksum mismatch for $archive"

mkdir -p "$tmp/extract" "$install_dir"
tar -xzf "$tmp/$archive" -C "$tmp/extract"
install -m 755 "$tmp/extract/revuediff" "$install_dir/revuediff"

echo "installed $("$install_dir/revuediff" --version) to $install_dir/revuediff"
case ":$PATH:" in
*":$install_dir:"*) ;;
*) echo "note: $install_dir is not on your PATH" ;;
esac

echo
echo "configure Git with:"
echo "  git config --global pager.diff revuediff"
