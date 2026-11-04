#!/usr/bin/env bash
# Fetch the Cosmic Web Explorer fork from GitHub and vendor it into
# ./cosmic-web-explorer so the site serves an up-to-date copy.
#
#   ./scripts/update-cosmic-web.sh [work-dir]
#
# Used by .github/workflows/update-cosmic-web.yml, but runs fine locally: it only
# needs git and python3 (there is no build step). The work directory defaults to
# a temp dir and is removed afterwards; pass one explicitly to inspect the clone.
#
# It deliberately clones the *fork* (not the original upstream), because the
# fork carries the features this site is linking to: reversed colour palettes
# and the 2D cosmic-web classification overlay.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_URL="${COSMIC_WEB_REPO:-https://github.com/dforero0896/cosmic_web_explorer.git}"
WORK="${1:-}"

if [ -z "$WORK" ]; then
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
else
  mkdir -p "$WORK"
  rm -rf "$WORK/cwe"
fi

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

echo "==> cloning $REPO_URL"
git clone --depth 1 --quiet "$REPO_URL" "$WORK/cwe"

echo "==> vendoring into $ROOT/cosmic-web-explorer"
"$ROOT/scripts/vendor-cosmic-web.sh" "$WORK/cwe"

echo "==> done"
