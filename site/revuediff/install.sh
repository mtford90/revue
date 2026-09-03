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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Resolve the tag via the unauthenticated releases/latest redirect first (no rate limit);
# only fall back to the paged API (which is rate-limited) if that yields no usable tag.
resolve_latest_tag_via_redirect() {
	url="https://github.com/$repo/releases/latest"
	location="$(curl -sSL -o /dev/null -w '%{url_effective}' "$url")" || return 1
	tag="${location##*/releases/tag/}"
	case "$tag" in
	revuediff-v[0-9]*.[0-9]*.[0-9]*) printf '%s\n' "$tag" ;;
	*) return 1 ;;
	esac
}

resolve_latest_tag_via_api() {
	page=1
	while :; do
		url="https://api.github.com/repos/$repo/releases?per_page=100&page=$page"
		if [ -n "${GITHUB_TOKEN:-}" ]; then
			status="$(curl -sSL -o "$tmp/api-page.json" -w '%{http_code}' -H 'Accept: application/vnd.github+json' -H "Authorization: Bearer $GITHUB_TOKEN" "$url")"
		else
			status="$(curl -sSL -o "$tmp/api-page.json" -w '%{http_code}' -H 'Accept: application/vnd.github+json' "$url")"
		fi
		case "$status" in
		2??) ;;
		403) fail "GitHub API rate limit exceeded fetching $url (HTTP 403) — try again later or set GITHUB_TOKEN" ;;
		*) fail "failed to fetch $url (HTTP $status)" ;;
		esac
		body="$(cat "$tmp/api-page.json")"
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

tag="$(resolve_latest_tag_via_redirect)" || tag="$(resolve_latest_tag_via_api)" || fail "could not determine the latest stable Revuediff release"
case "$tag" in
revuediff-v[0-9]*.[0-9]*.[0-9]*) ;;
*) fail "could not determine the latest stable Revuediff release" ;;
esac

archive="$tag-$target.tar.gz"
base="https://github.com/$repo/releases/download/$tag"

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
install -m 755 "$tmp/extract/revuediff-highlighter.node" "$install_dir/revuediff-highlighter.node"

echo "installed $("$install_dir/revuediff" --version) to $install_dir/revuediff"
case ":$PATH:" in
*":$install_dir:"*) ;;
*) echo "note: $install_dir is not on your PATH" ;;
esac

echo
echo "configure Git with:"
echo "  git config --global pager.diff revuediff"
