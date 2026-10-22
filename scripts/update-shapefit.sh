#!/usr/bin/env bash
# Fetch the ShapeFit visualizer from GitHub, build it, and vendor the result
# into ./shapefit so the site serves an up-to-date copy.
#
#   ./scripts/update-shapefit.sh [work-dir]
#
# Used by .github/workflows/update-shapefit.yml, but runs fine locally: it only
# needs git, node/npm and python3. The work directory defaults to a temp dir and
# is removed afterwards; pass one explicitly to inspect the build.
#
# The build uses --base ./, which turns the emitted asset URLs into relative
# paths: the app is served from /shapefit/, not from the domain root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_URL="${SHAPEFIT_REPO:-https://github.com/dforero0896/shapefit-visualizer.git}"
WORK="${1:-}"

if [ -z "$WORK" ]; then
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
else
  mkdir -p "$WORK"
  rm -rf "$WORK/sfviz"
fi

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v node >/dev/null || { echo "node is required" >&2; exit 1; }

echo "==> cloning $REPO_URL"
git clone --depth 1 --quiet "$REPO_URL" "$WORK/sfviz"

echo "==> patching upstream sources"
python3 "$ROOT/scripts/shapefit-src-patches.py" "$WORK/sfviz"

echo "==> installing dependencies"
( cd "$WORK/sfviz" && npm ci --no-audit --no-fund --loglevel=error )

echo "==> building"
( cd "$WORK/sfviz" && ./node_modules/.bin/vite build --base ./ --logLevel warn )

echo "==> vendoring into $ROOT/shapefit"
"$ROOT/scripts/vendor-shapefit.sh" "$WORK/sfviz/dist"

echo "==> done"
ls -1 "$ROOT/shapefit" "$ROOT/shapefit/assets"
