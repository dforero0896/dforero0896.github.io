#!/usr/bin/env python3
"""Fix known problems in the upstream ShapeFit visualizer *before* building it.

Called by scripts/update-shapefit.sh on a fresh clone. Every patch is applied
idempotently: if the upstream repo has already fixed something, the patch is
skipped with a note instead of failing. If an anchor disappears completely
(an upstream refactor) the script exits non-zero, so a broken build is never
silently vendored onto the site.

Usage: shapefit-src-patches.py <clone-dir>
"""

import re
import sys
from pathlib import Path

problems = []


def read(path):
    return path.read_text(encoding="utf-8")


def write(path, text):
    path.write_text(text, encoding="utf-8")


def patch_index_html(path):
    html = read(path)
    before = html

    # 1. The entry point is referenced as /src/main.jsx but the file is main.tsx.
    #    Vite happens to resolve it today, but it is a typo and a landmine.
    if "/src/main.jsx" in html:
        if not (path.parent / "src" / "main.tsx").is_file():
            problems.append("index.html points at /src/main.jsx but src/main.tsx is missing")
        html = html.replace("/src/main.jsx", "/src/main.tsx")
        print("  index.html: entry /src/main.jsx -> /src/main.tsx")
    else:
        print("  index.html: entry already correct")

    # 2. The page ships with lang="zh-CN" although its content is English.
    if 'lang="zh-CN"' in html:
        html = html.replace('lang="zh-CN"', 'lang="en"', 1)
        print("  index.html: lang zh-CN -> en")
    else:
        print("  index.html: lang already correct")

    if html != before:
        write(path, html)


def patch_app_tsx(path):
    src = read(path)
    before = src

    # 3. Recharts reserves the space *outside* the plot for the axis label and
    #    the legend, which in the default layout both land at the bottom: the
    #    "k [h/Mpc]" label is drawn on top of the legend. Push the legend to the
    #    top and give the bottom margin room for both.
    if 'verticalAlign="top"' in src:
        print("  App.tsx: legend already moved to the top")
    else:
        legend = "<Legend wrapperStyle={{ fontSize: 12 }} />"
        if legend in src:
            src = src.replace(
                legend,
                '<Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />',
            )
            print("  App.tsx: legend moved to the top")
        else:
            problems.append("App.tsx: could not find the Legend to move to the top")

    # The chart that owns the legend also needs room *above* the plot, otherwise
    # the top-aligned legend is drawn over the highest y-axis tick.
    main_chart = re.compile(
        r"(<LineChart data=\{chartData\}[^>]*?top:\s*)10(?=[,\s]*right)"
    )
    if main_chart.search(src):
        src = main_chart.sub(r"\g<1>40", src)
        print("  App.tsx: top margin 10 -> 40 on the legend-bearing chart")
    else:
        print("  App.tsx: top margin already widened")

    # Bottom margin for every LineChart: 20 -> 44 (room for ticks + label).
    margins = re.findall(r"<LineChart[^>]*?bottom:\s*20", src)
    if margins:
        src = re.sub(r"(<LineChart[^>]*?bottom:\s*)20", r"\g<1>44", src)
        print(f"  App.tsx: bottom margin 20 -> 44 on {len(margins)} LineChart(s)")
    else:
        print("  App.tsx: bottom margins already widened")

    # X axis title sits below the tick labels instead of beside them.
    label = "value: 'k [h/Mpc]', position: 'bottom', offset: 0"
    if label in src:
        n = src.count(label)
        src = src.replace(
            label, "value: 'k [h/Mpc]', position: 'bottom', offset: 24"
        )
        print(f"  App.tsx: x-axis label offset 0 -> 24 on {n} chart(s)")
    elif "value: 'k [h/Mpc]', position: 'bottom', offset: 24" in src:
        print("  App.tsx: x-axis label offset already fixed")
    else:
        problems.append("App.tsx: could not find the 'k [h/Mpc]' axis label")

    if src != before:
        write(path, src)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1])
    index, app = root / "index.html", root / "src" / "App.tsx"
    for p in (index, app):
        if not p.is_file():
            sys.exit(f"missing {p}")

    print("patching upstream sources in", root)
    patch_index_html(index)
    patch_app_tsx(app)

    if problems:
        print("\nFAILED:", file=sys.stderr)
        for p in problems:
            print("  -", p, file=sys.stderr)
        sys.exit(1)
    print("sources patched")


if __name__ == "__main__":
    main()
