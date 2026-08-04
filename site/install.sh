#!/bin/sh
# Installs the latest revue release for this platform.
#   curl -fsSL https://revue.mtford.co.uk/install.sh | sh
# Set REVUE_INSTALL to change the install directory (default: ~/.local/bin).
set -eu

repo="mtford90/revue"
install_dir="${REVUE_INSTALL:-$HOME/.local/bin}"

fail() {
	echo "install.sh: $1" >&2
	exit 1
}

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
Darwin-arm64) target="darwin-arm64" ;;
Darwin-x86_64) target="darwin-x64" ;;
Linux-x86_64) target="linux-x64" ;;
*) fail "no prebuilt executable for $os/$arch — see https://github.com/$repo#install for running from a checkout" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required"

latest_url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")"
tag="${latest_url##*/}"
case "$tag" in
v*) ;;
*) fail "could not determine the latest release from $latest_url" ;;
esac

archive="revue-$tag-$target.tar.gz"
base="https://github.com/$repo/releases/download/$tag"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "downloading revue $tag ($target)…"
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
install -m 755 "$tmp/extract/revue" "$install_dir/revue"

echo "installed $("$install_dir/revue" --version) to $install_dir/revue"
case ":$PATH:" in
*":$install_dir:"*) ;;
*) echo "note: $install_dir is not on your PATH" ;;
esac

echo
echo "next steps:"
echo "  revue skill install   # give your coding agent the revue skill"
echo "  revue doctor          # check dependencies and skill state"
