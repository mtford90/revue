#!/usr/bin/env bash
# Emits Formula/revuediff.rb for mtford90/homebrew-tap on stdout.
# Usage: generate-revuediff-tap-formula.sh <version> <checksums-file>
set -euo pipefail

version="$1"
checksums="$2"

sha_for() {
	awk -v target="revuediff-v${version}-$1.tar.gz" '$2 ~ target { print $1 }' "$checksums" | head -1
}

darwin_arm64="$(sha_for darwin-arm64)"
darwin_x64="$(sha_for darwin-x64)"
linux_x64="$(sha_for linux-x64)"

for sha in "$darwin_arm64" "$darwin_x64" "$linux_x64"; do
	[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || { echo "missing or malformed sha256 in $checksums" >&2; exit 1; }
done

base="https://github.com/mtford90/revue/releases/download/revuediff-v${version}"

cat <<EOF
class Revuediff < Formula
  desc "ANSI diff formatter and pager for Git and Lazygit"
  homepage "https://github.com/mtford90/revue"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/revuediff-v${version}-darwin-arm64.tar.gz"
      sha256 "${darwin_arm64}"
    end
    on_intel do
      url "${base}/revuediff-v${version}-darwin-x64.tar.gz"
      sha256 "${darwin_x64}"
    end
  end

  on_linux do
    on_intel do
      url "${base}/revuediff-v${version}-linux-x64.tar.gz"
      sha256 "${linux_x64}"
    end
  end

  def install
    bin.install "revuediff", "revuediff-highlighter.node"
    doc.install Dir["*.md"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/revuediff --version")
  end
end
EOF
