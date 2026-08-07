#!/usr/bin/env bash
# Emits the Homebrew formula for mtford90/homebrew-tap on stdout.
# Usage: generate-tap-formula.sh <version> <checksums-file>
set -euo pipefail

version="$1"
checksums="$2"

sha_for() {
	awk -v target="$1" '$2 ~ target { print $1 }' "$checksums" | head -1
}

darwin_arm64="$(sha_for darwin-arm64)"
darwin_x64="$(sha_for darwin-x64)"
linux_x64="$(sha_for linux-x64)"

for sha in "$darwin_arm64" "$darwin_x64" "$linux_x64"; do
	[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || { echo "missing or malformed sha256 in $checksums" >&2; exit 1; }
done

base="https://github.com/mtford90/revue/releases/download/v${version}"

cat <<EOF
class Revue < Formula
  desc "Narrative code review in your terminal"
  homepage "https://github.com/mtford90/revue"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${base}/revue-v${version}-darwin-arm64.tar.gz"
      sha256 "${darwin_arm64}"
    end
    on_intel do
      url "${base}/revue-v${version}-darwin-x64.tar.gz"
      sha256 "${darwin_x64}"
    end
  end

  on_linux do
    on_intel do
      url "${base}/revue-v${version}-linux-x64.tar.gz"
      sha256 "${linux_x64}"
    end
  end

  depends_on "git"

  def install
    bin.install "revue", "revue-highlighter.node"
    doc.install Dir["*.md"]
  end

  def caveats
    <<~EOS
      The optional Semantic diff view uses difftastic:
        brew install difftastic

      Install the bundled revue-chapters agent skill with:
        revue skill install

      Run \`revue doctor\` to check dependencies and skill state.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/revue --version")
  end
end
EOF
