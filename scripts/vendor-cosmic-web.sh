#!/usr/bin/env bash
# Vendor the Cosmic Web Explorer fork (github.com/dforero0896/cosmic_web_explorer)
# into ./cosmic-web-explorer so it can be served from this site as a static page.
#
#   ./scripts/vendor-cosmic-web.sh [path-to-clone]
#
# The upstream project has no build step: index.html loads the plain scripts in
# src/ directly, so the clone can be copied as-is. The post-copy patch below is
# applied to a *fresh* copy every time, so a refresh can never silently drop the
# fork notice, the license/attribution or the back-link to the site.
#
# The fork is a derivative of github.com/nicosmo/cosmic_web_explorer by Nico
# Schuster and Simon Bouchard, licensed AGPL-3.0. Keep the LICENSE file and the
# attribution intact when re-vendoring.
set -euo pipefail

SRC="${1:-/tmp/cwe}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/cosmic-web-explorer"

[ -f "$SRC/index.html" ] || { echo "no source at $SRC/index.html" >&2; exit 1; }
[ -f "$SRC/styles.css" ] || { echo "no stylesheet at $SRC/styles.css" >&2; exit 1; }
[ -f "$SRC/LICENSE" ] || { echo "no LICENSE at $SRC/LICENSE" >&2; exit 1; }
[ -d "$SRC/src" ] || { echo "no src/ directory at $SRC/src" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC/index.html" "$SRC/styles.css" "$SRC/LICENSE" "$DEST/"
cp -R "$SRC/src" "$SRC/workers" "$SRC/favicons" "$DEST/"

# A durable attribution note next to the vendored copy (AGPL section 5).
cat > "$DEST/NOTICE.md" <<'MD'
# Cosmic Web Explorer — unofficial fork

This directory is a static copy of
<https://github.com/dforero0896/cosmic_web_explorer>, an unofficial fork of
[Cosmic Web Explorer](https://github.com/nicosmo/cosmic_web_explorer).

- **Original work:** Copyright (c) 2026 Nico Schuster, with initial concept by
  Simon Bouchard and Nico Schuster. Licensed under the GNU AGPLv3 — see
  [LICENSE](LICENSE).
- **Changes in this fork:** reversed colour palettes and a 2D cosmic-web
  classification overlay.
- **Maintainer of this copy:** Daniel Forero-Sánchez. This is not the original
  project and is not affiliated with or endorsed by the original authors.

The app is served here unchanged apart from the added fork notice/back-link and
the removal of the original author's GoatCounter analytics snippet.
MD

python3 - "$DEST/index.html" <<'PY'
import sys

path = sys.argv[1]
html = open(path, encoding="utf-8").read()

def sub(old, new):
    global html
    assert old in html, "anchor not found: " + old[:70]
    html = html.replace(old, new, 1)

# 1. Title and metadata for the host site. The "(unofficial fork)" suffix makes
#    the provenance visible in the browser tab.
sub(
    "<title>Cosmic Web Explorer</title>",
    '<title>Cosmic Web Explorer (unofficial fork)</title>\n'
    '    <meta name="description" content="Unofficial fork of Cosmic Web Explorer, a real-time 2LPT/WebGPU simulation of the cosmic web. Original by Nico Schuster and Simon Bouchard (AGPL-3.0)." />\n'
    '    <meta name="theme-color" content="#06070d" />',
)

# 2. Drop the original author's GoatCounter analytics: this is a copy on a
#    different site, so it should not report visitors to his dashboard.
goatcounter = (
    '    <script data-goatcounter="https://nicosmo.goatcounter.com/count"\n'
    '        async src="//gc.zgo.at/count.js"></script>\n'
)
sub(goatcounter, "")

# 3. Fork notice + back-link. Kept as small fixed pills in the bottom-right
#    (the sidebar owns the left edge, the redshift readout the top-right).
sub(
    "</head>",
    """    <style>
      /* Attribution + back-link added when vendoring this fork. */
      .cwe-fork-ui {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        font: 400 11px/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif;
        letter-spacing: 0.01em;
        text-align: right;
      }
      .cwe-fork-ui a {
        color: #a9a59c;
        text-decoration: none;
      }
      .cwe-fork-ui a:hover {
        color: #ece9e3;
      }
      .cwe-back,
      .cwe-credits summary {
        display: inline-block;
        padding: 0.32rem 0.7rem;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        background: rgba(6, 7, 13, 0.72);
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
        color: #8c8c92;
        cursor: pointer;
        white-space: nowrap;
        transition: color 0.2s, border-color 0.2s;
      }
      .cwe-back:hover,
      .cwe-credits summary:hover,
      .cwe-credits[open] summary {
        color: #ece9e3;
        border-color: rgba(226, 178, 116, 0.6);
      }
      .cwe-credits {
        position: relative;
      }
      .cwe-credits summary {
        list-style: none;
      }
      .cwe-credits summary::-webkit-details-marker {
        display: none;
      }
      .cwe-credits-panel {
        position: absolute;
        right: 0;
        bottom: calc(100% + 6px);
        width: 320px;
        max-width: calc(100vw - 24px);
        padding: 0.85rem 0.95rem;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 6px;
        background: rgba(6, 7, 13, 0.94);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
        color: #a9a59c;
        text-align: left;
        white-space: normal;
      }
      .cwe-credits-panel p {
        margin: 0 0 0.5rem;
      }
      .cwe-credits-panel p:last-child {
        margin-bottom: 0;
      }
      .cwe-credits-panel strong {
        color: #ece9e3;
        font-weight: 500;
      }
      .cwe-credits-panel .cwe-accent {
        color: #e2b274;
      }
    </style>
  </head>""",
)

sub(
    "</body>",
    """    <div class="cwe-fork-ui">
      <details class="cwe-credits">
        <summary>&#9432; unofficial fork</summary>
        <div class="cwe-credits-panel">
          <p><strong>This is an unofficial fork</strong> hosted by Daniel Forero-S&aacute;nchez,
             not the original project and not affiliated with its authors.</p>
          <p>Original <em>Cosmic Web Explorer</em> by
             <a href="https://github.com/nicosmo/cosmic_web_explorer" target="_blank" rel="noopener noreferrer">Nico Schuster &amp; Simon Bouchard</a>,
             licensed <a href="LICENSE">AGPL-3.0</a>.</p>
          <p><span class="cwe-accent">Added in this fork:</span> reversed colour palettes and a 2D cosmic-web classification overlay.</p>
          <p><a href="https://github.com/nicosmo/cosmic_web_explorer" target="_blank" rel="noopener noreferrer">Original source</a>
             &middot; <a href="https://github.com/dforero0896/cosmic_web_explorer" target="_blank" rel="noopener noreferrer">Fork source</a>
             &middot; <a href="NOTICE.md">Fork notice</a></p>
        </div>
      </details>
      <a class="cwe-back" href="../" title="Back to Daniel Forero-S&aacute;nchez">&#8592; my site</a>
    </div>
  </body>""",
)

open(path, "w", encoding="utf-8").write(html)
print("patched", path)
PY

echo "vendored -> $DEST"
ls -1 "$DEST" "$DEST/src"
