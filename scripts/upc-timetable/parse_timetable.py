#!/usr/bin/env python3
"""Parse the UPC chemistry timetable grid without modifying the source files.

The source is a BIFF8 .xls workbook exported from a timetable system. Each
weekday cell may contain several course blocks separated by blank lines. This
module extracts every block, keeps the source cell/text, and compares the two
exports shipped in the source directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import xlrd

# Course codes are not limited to the chemistry format. The 15 other
# colleges use numeric codes (e.g. 2092199), numeric+letter codes
# (e.g. 99CST226711030) and three/four-letter codes (e.g. GEO211721030).
# Keep the code alternatives explicit: a broad alphanumeric prefix would
# consume the first letters of English course names such as "Python".
CODE_RE = re.compile(
    r"^((?:[A-Z]{2,4}\d{9})|(?:\d{2}[A-Z]{3}\d{9})|(?:\d{7}))\s*(\S.*)$"
)
WEEK_RE = re.compile(r"^(.+?周)\s*\[([^\]]+)\]$")
TERM_RE = re.compile(r"学年学期\s*[:：]\s*([0-9]{4}-[0-9]{4}-[1-3])")
TEACHER_RE = re.compile(r"^[\u4e00-\u9fff·]{2,8}$")
DAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    return text.strip()


def cell_ref(row: int, col: int) -> str:
    """Return an Excel-style cell reference for zero-based coordinates."""
    name = ""
    n = col + 1
    while n:
        n, rem = divmod(n - 1, 26)
        name = chr(65 + rem) + name
    return f"{name}{row + 1}"


def split_course_blocks(cell_text: str) -> list[str]:
    text = normalize_text(cell_text)
    if not text:
        return []
    pieces = [p.strip("\n") for p in re.split(r"\n\s*\n", text) if p.strip()]
    # Some exports omit one blank line between blocks. Split before a later
    # course-code line only when the first piece contains at least two codes.
    if len(pieces) == 1:
        lines = text.split("\n")
        starts = [i for i, line in enumerate(lines) if CODE_RE.match(line.strip())]
        if len(starts) > 1:
            pieces = ["\n".join(lines[a:b]).strip("\n") for a, b in zip(starts, starts[1:] + [len(lines)])]
    return pieces


def parse_course_block(
    raw: str,
    *,
    file_label: str,
    source_path: str,
    sheet: str,
    row: int,
    col: int,
    weekday: str,
    section: str,
) -> dict[str, Any]:
    lines = [line.strip() for line in normalize_text(raw).split("\n") if line.strip()]
    anomalies: list[str] = []
    code = None
    name = None
    if not lines:
        lines = []
        anomalies.append("empty_block")
    else:
        match = CODE_RE.match(lines[0])
        if match:
            code, name = match.group(1), match.group(2).strip()
        else:
            name = lines[0]
            anomalies.append("missing_or_unrecognized_course_code")

    teachers: list[str] = []
    if len(lines) >= 2:
        teachers = [t.strip() for t in re.split(r"[,，、;；]", lines[1]) if t.strip()]
    if not teachers:
        anomalies.append("missing_teacher")
    bad_teachers = [t for t in teachers if not TEACHER_RE.fullmatch(t)]
    if bad_teachers:
        anomalies.append("unexpected_teacher_token")

    classes = lines[2] if len(lines) >= 3 else None
    if not classes:
        anomalies.append("missing_class")

    weeks = None
    periods = None
    if len(lines) >= 4:
        match = WEEK_RE.match(lines[3])
        if match:
            weeks, periods = match.group(1), match.group(2)
        else:
            anomalies.append("week_period_format")
            weeks = lines[3]
    else:
        anomalies.append("missing_week_period")

    location = "\n".join(lines[4:]).strip() if len(lines) >= 5 else None
    return {
        "file": file_label,
        "sourcePath": source_path,
        "sheet": sheet,
        "row": row + 1,
        "col": col + 1,
        "cell": cell_ref(row, col),
        "weekday": weekday,
        "section": section,
        "raw": normalize_text(raw),
        "code": code,
        "name": name,
        "teachers": teachers,
        "classes": classes,
        "weeks": weeks,
        "periods": periods,
        "location": location,
        "anomalies": anomalies,
    }


def find_header(sheet: xlrd.sheet.Sheet) -> tuple[int | None, dict[int, str]]:
    for r in range(min(sheet.nrows, 30)):
        columns: dict[int, str] = {}
        for c in range(min(sheet.ncols, 64)):
            value = normalize_text(sheet.cell_value(r, c))
            if value in DAY_NAMES:
                columns[c] = value
        if len(columns) >= 3:
            return r, columns
    return None, {}


def read_workbook(path: Path, label: str) -> dict[str, Any]:
    workbook = xlrd.open_workbook(str(path), formatting_info=True)
    result: dict[str, Any] = {
        "label": label,
        "path": str(path),
        "sha256": sha256_file(path),
        "format": "BIFF8/OLE2" if path.read_bytes()[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" else "unknown",
        "sheets": [],
        "term": None,
        "title": None,
        "anomalies": [],
    }
    for sheet in workbook.sheets():
        header_row, header = find_header(sheet)
        sheet_info: dict[str, Any] = {
            "name": sheet.name,
            "nrows": sheet.nrows,
            "ncols": sheet.ncols,
            "visibility": sheet.visibility,
            "mergedCells": [list(x) for x in sheet.merged_cells],
            "headerRow": (header_row + 1) if header_row is not None else None,
            "weekdayColumns": {cell_ref(header_row, c) if header_row is not None else str(c): name for c, name in header.items()},
            "blocks": [],
            "anomalies": [],
        }
        if header_row is None:
            sheet_info["anomalies"].append("no_weekday_header")
            result["sheets"].append(sheet_info)
            continue

        # Title/term are read from the first non-empty rows, never inferred from today's date.
        for r in range(0, header_row):
            for c in range(min(sheet.ncols, 32)):
                text = normalize_text(sheet.cell_value(r, c))
                if not text:
                    continue
                if result["title"] is None and ("课表" in text or "学年学期" in text):
                    result["title"] = text
                match = TERM_RE.search(text)
                if match and result["term"] is None:
                    result["term"] = match.group(1)

        for r in range(header_row + 1, sheet.nrows):
            section = normalize_text(sheet.cell_value(r, min(header) - 1)) if min(header) > 0 else ""
            if not section and header:
                section = normalize_text(sheet.cell_value(r, 0))
            for c, weekday in sorted(header.items()):
                cell = sheet.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_EMPTY:
                    continue
                text = normalize_text(cell.value)
                if not text:
                    continue
                for raw in split_course_blocks(text):
                    block = parse_course_block(
                        raw,
                        file_label=label,
                        source_path=str(path),
                        sheet=sheet.name,
                        row=r,
                        col=c,
                        weekday=weekday,
                        section=section,
                    )
                    sheet_info["blocks"].append(block)
        result["sheets"].append(sheet_info)
    return result


def signature(block: dict[str, Any]) -> tuple[Any, ...]:
    return (
        block.get("code") or "",
        block.get("name") or "",
        tuple(sorted({t for t in block.get("teachers", []) if t})),
        block.get("classes") or "",
        block.get("weeks") or "",
        block.get("periods") or "",
        re.sub(r"\s+", "", block.get("location") or ""),
    )


def weekday_shift(original: list[dict[str, Any]], zipped: list[dict[str, Any]]) -> dict[str, Any]:
    """Find the day offset of ZIP relative to the original, if uniform."""
    orig_days: dict[tuple[Any, ...], Counter[str]] = defaultdict(Counter)
    zip_days: dict[tuple[Any, ...], Counter[str]] = defaultdict(Counter)
    for block in original:
        orig_days[signature(block)][block["weekday"]] += 1
    for block in zipped:
        zip_days[signature(block)][block["weekday"]] += 1
    candidates = []
    for shift in range(7):
        ok = True
        for sig, counts in orig_days.items():
            expected = Counter()
            for day, n in counts.items():
                expected[(DAY_NAMES.index(day) + shift) % 7] += n
            actual = Counter({DAY_NAMES.index(day): n for day, n in zip_days.get(sig, {}).items()})
            if expected != actual:
                ok = False
                break
        if ok:
            candidates.append(shift)
    counts = {
        "original": {day: sum(1 for b in original if b["weekday"] == day) for day in DAY_NAMES},
        "zip": {day: sum(1 for b in zipped if b["weekday"] == day) for day in DAY_NAMES},
    }
    shift = candidates[0] if len(candidates) == 1 else None
    signed = None if shift is None else (shift if shift <= 3 else shift - 7)
    if signed is None:
        description = "no single uniform shift"
    elif signed == 0:
        description = "same weekday columns"
    elif signed < 0:
        description = f"提前 {abs(signed)} 天"
    else:
        description = f"推后 {signed} 天"
    return {
        "zipShiftDays": shift,
        "zipShiftSignedDays": signed,
        "zipShiftDescription": description,
        "candidateShifts": candidates,
        "dayCounts": counts,
        "mappingNote": (
            f"ZIP weekday = original weekday shifted by {shift} day(s) in the "
            f"Sunday-first sequence ({description})"
            if shift is not None else "no single uniform shift"
        ),
    }


def analyze(original: dict[str, Any], zipped: dict[str, Any]) -> dict[str, Any]:
    original_blocks = [b for sheet in original["sheets"] for b in sheet["blocks"]]
    zip_blocks = [b for sheet in zipped["sheets"] for b in sheet["blocks"]]
    orig_sigs = Counter(signature(b) for b in original_blocks)
    zip_sigs = Counter(signature(b) for b in zip_blocks)
    return {
        "original": original,
        "zip": zipped,
        "comparison": {
            "sameSignatureMultiset": orig_sigs == zip_sigs,
            "originalOnlySignatures": len(orig_sigs - zip_sigs),
            "zipOnlySignatures": len(zip_sigs - orig_sigs),
            "originalBlocks": len(original_blocks),
            "zipBlocks": len(zip_blocks),
            "uniqueSignatures": len(orig_sigs),
            "duplicateOccurrencesOriginal": sum(n - 1 for n in orig_sigs.values()),
            "duplicateOccurrencesZip": sum(n - 1 for n in zip_sigs.values()),
            "weekday": weekday_shift(original_blocks, zip_blocks),
        },
        "source": {
            "originalPath": original["path"],
            "originalSha256": original["sha256"],
            "zipPath": zipped["path"],
            "zipSha256": zipped["sha256"],
            "term": original.get("term"),
            "title": original.get("title"),
        },
    }


def load_zip_xls(zip_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    with zipfile.ZipFile(zip_path) as archive:
        entries = archive.infolist()
        if not entries:
            raise ValueError("ZIP 中没有文件")
        infos = []
        chosen = None
        for info in entries:
            raw = info.orig_filename
            try:
                decoded = raw.encode("cp437").decode("gbk")
            except (UnicodeEncodeError, UnicodeDecodeError):
                decoded = raw
            infos.append({"rawName": raw, "decodedName": decoded, "size": info.file_size,
                          "sha256": hashlib.sha256(archive.read(info)).hexdigest()})
            if decoded.lower().endswith(".xls") and chosen is None:
                chosen = info
        if chosen is None:
            raise ValueError("ZIP 中没有 .xls")
        with tempfile.NamedTemporaryFile(suffix=".xls", delete=False) as tmp:
            tmp.write(archive.read(chosen))
            temp_path = Path(tmp.name)
    try:
        parsed = read_workbook(temp_path, "zip")
        parsed["path"] = str(zip_path)
        # `read_workbook` hashes the extracted member; the archive itself needs
        # its own digest so the manifest can distinguish the two artifacts.
        parsed["sha256"] = sha256_file(zip_path)
        parsed["zipEntries"] = infos
        # The temp extraction is deleted after parsing; retain the archive member
        # identity in every source reference instead of the transient path.
        member = next(x for x in infos if x["rawName"] == chosen.orig_filename)
        for sheet in parsed["sheets"]:
            for block in sheet["blocks"]:
                block["sourcePath"] = f"{zip_path}!/{member['decodedName']}"
        return parsed, member
    finally:
        temp_path.unlink(missing_ok=True)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xls", required=True, type=Path)
    parser.add_argument("--zip", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    original = read_workbook(args.xls, "original")
    zipped, _ = load_zip_xls(args.zip)
    result = analyze(original, zipped)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "term": result["source"]["term"],
        "originalBlocks": result["comparison"]["originalBlocks"],
        "zipBlocks": result["comparison"]["zipBlocks"],
        "uniqueSignatures": result["comparison"]["uniqueSignatures"],
        "sameSignatureMultiset": result["comparison"]["sameSignatureMultiset"],
        "weekday": result["comparison"]["weekday"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
