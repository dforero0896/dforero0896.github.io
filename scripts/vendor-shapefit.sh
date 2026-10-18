#!/usr/bin/env bash
# Vendor the ShapeFit Power Spectrum Explorer (github.com/dforero0896/shapefit-visualizer)
# into ./shapefit so it can be served from this site as a plain static page.
#
#   ./scripts/vendor-shapefit.sh [path-to-built-dist]
#
# Default dist path is /tmp/sfviz/dist. Rebuild it first:
#   cd /tmp/sfviz && npm install && ./node_modules/.bin/vite build
#
# The post-build patch below is applied to a *fresh* copy every time, so a
# rebuild can never silently drop the dark theme or the back-link to the site.
set -euo pipefail

SRC="${1:-/tmp/sfviz/dist}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/shapefit"

[ -f "$SRC/index.html" ] || { echo "no build at $SRC/index.html" >&2; exit 1; }

rm -rf "$DEST"
cp -R "$SRC" "$DEST"

python3 - "$DEST/index.html" <<'PY'
import sys

path = sys.argv[1]
html = open(path, encoding="utf-8").read()

def sub(old, new):
    global html
    assert old in html, "anchor not found: " + old[:60]
    html = html.replace(old, new, 1)

# 1. Metadata for the host site.
sub(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
    '    <meta name="description" content="Interactive explorer for the linear power spectrum: the ShapeFit template, cosmological parameters and DESI DR1 measurements." />\n'
    '    <meta name="theme-color" content="#06070d" />',
)

# 2. Match the site palette (deep ink background, warm paper text).
sub(
    '        background-color: #1a1a1a !important;\n        color: #ffffff;',
    '        background-color: #06070d !important;\n        color: #ece9e3;',
)

# 3. Standalone page opens dark; keeps the iframe theme handshake untouched.
sub(
    '          // 非 iframe 环境，使用默认 light 主题\n          applyThemeToDOM("light");',
    '          // Standalone: default to dark theme, matching the host site.\n          applyThemeToDOM("dark");',
)

# 4. Back-link to the main site, styled to fit the host page.
sub(
    '    </style>',
    '''      /* Back-link to the home site (added when vendoring this build). */
      .sf-back {
        position: fixed;
        left: 1rem;
        bottom: 1rem;
        z-index: 9999;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        background: rgba(6, 7, 13, 0.72);
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
        color: #8c8c92;
        font: 400 12px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
        letter-spacing: 0.02em;
        text-decoration: none;
        transition: color 0.2s, border-color 0.2s;
      }
      .sf-back:hover {
        color: #ece9e3;
        border-color: rgba(226, 178, 116, 0.6);
      }
      /* On phones a floating pill would sit on top of the controls. */
      @media (max-width: 700px) {
        .sf-back {
          position: static;
          margin: 0.75rem 0.75rem 0;
        }
      }
    </style>''',
)

# 5. The link itself.
sub(
    '<body>\n    <div id="root"></div>',
    '<body>\n    <a class="sf-back" href="../" title="Back to Daniel Forero-S&aacute;nchez">&#8592; back to my site</a>\n    <div id="root"></div>',
)

open(path, "w", encoding="utf-8").write(html)
print("patched", path)
PY

echo "vendored -> $DEST"
