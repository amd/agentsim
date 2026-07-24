#!/usr/bin/env python3
# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""Add the AMD license header to source files.

Idempotent: files that already contain the copyright line are skipped.
Preserves a leading shebang line and the file's existing newline style.

Usage:
    python scripts/add_license_header.py [ROOT ...] [--dry-run]

By default this rewrites files in place. Pass --dry-run to preview only.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HEADER_LINES = [
    "Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.",
    "",
    "See LICENSE for license information.",
]

# Marker used to detect an already-present header (idempotency check).
MARKER = "Advanced Micro Devices"

# Comment style per extension: ("line", prefix) or ("wrap", open, close).
STYLES = {
    ".ts": ("line", "//"),
    ".rs": ("line", "//"),
    ".py": ("line", "#"),
    ".ps1": ("line", "#"),
    ".bat": ("line", "REM"),
    ".css": ("wrap", "/*", "*/"),
    ".html": ("wrap", "<!--", "-->"),
}

IGNORE_DIRS = {
    "node_modules", "target", "dist", "build", ".git",
    "__pycache__", ".venv", "venv", ".idea",
}


def render_header(style: tuple) -> list[str]:
    kind = style[0]
    out = []
    if kind == "line":
        prefix = style[1]
        for text in HEADER_LINES:
            out.append(f"{prefix} {text}".rstrip() if text else prefix)
    else:  # wrap
        _, opn, cls = style
        for text in HEADER_LINES:
            out.append(f"{opn} {text} {cls}" if text else f"{opn} {cls}")
    out.append("")  # trailing blank line separating header from code
    return out


def starts_with_shebang(lines: list[str]) -> bool:
    return bool(lines) and lines[0].startswith("#!")


def process(path: Path, apply: bool) -> str:
    raw = path.read_bytes()

    bom = b""
    if raw.startswith(b"\xef\xbb\xbf"):
        bom, raw = raw[:3], raw[3:]

    text = raw.decode("utf-8")

    if MARKER in text[:500]:
        return "skip (already has header)"

    newline = "\r\n" if "\r\n" in text else "\n"
    # Split preserving nothing about endings; we rejoin with detected newline.
    body_lines = text.split(newline)

    style = STYLES[path.suffix.lower()]
    header = render_header(style)

    insert_at = 1 if starts_with_shebang(body_lines) else 0
    new_lines = body_lines[:insert_at] + header + body_lines[insert_at:]

    new_text = newline.join(new_lines)
    new_bytes = bom + new_text.encode("utf-8")

    if apply:
        path.write_bytes(new_bytes)
    return "updated"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("roots", nargs="*", default=["."], help="directories to scan")
    ap.add_argument("--dry-run", action="store_true", help="preview without writing")
    args = ap.parse_args()

    apply = not args.dry_run
    updated = skipped = 0

    for root in args.roots:
        for path in sorted(Path(root).rglob("*")):
            if not path.is_file():
                continue
            if any(part in IGNORE_DIRS for part in path.parts):
                continue
            if path.suffix.lower() not in STYLES:
                continue
            result = process(path, apply)
            if result == "updated":
                updated += 1
                print(f"[{'DRY' if args.dry_run else 'OK '}] {path}")
            else:
                skipped += 1

    verb = "would update" if args.dry_run else "updated"
    print(f"\n{verb}: {updated}   skipped: {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
