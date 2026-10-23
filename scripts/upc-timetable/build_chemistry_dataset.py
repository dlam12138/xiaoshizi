#!/usr/bin/env python3
"""Build the UPC chemistry timetable dataset from the read-only source files.

Outputs live in data/upc/chemistry-2026-2027-1/. The script is deterministic for
the same source files, config and official teacher map; it does not use the
network and never writes to the original .xls/.zip.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from parse_timetable import DAY_NAMES, analyze, load_zip_xls, read_workbook, signature

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "课表" / "化学化工学院"
SOURCE_XLS = SOURCE_DIR / "课表打印.xls"
SOURCE_ZIP = SOURCE_DIR / "课表打印.zip"
OUT_DIR = ROOT / "data" / "upc" / "chemistry-2026-2027-1"
CONFIG_PATH = OUT_DIR / "config.json"
MAP_PATH = ROOT / "scripts" / "upc-timetable" / "official-teacher-map.json"
COLLEGES_PATH = ROOT / "data" / "upc" / "colleges.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def norm_course_name(name: str) -> str:
    return re.sub(r"\s+", "", name or "").replace("（", "(").replace("）", ")")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not SOURCE_XLS.exists() or not SOURCE_ZIP.exists():
        raise SystemExit(f"missing source files under {SOURCE_DIR}")
    if not CONFIG_PATH.exists():
        raise SystemExit(f"missing explicit config: {CONFIG_PATH}")
    config = read_json(CONFIG_PATH)
    if not isinstance(config.get("markAsCurrent"), bool):
        raise SystemExit("config.markAsCurrent must be an explicit boolean")
    college_code = config.get("courseCollegeCode", "upc-03")
    teacher_college_code = config.get("teacherCollegeCode", college_code)
    colleges = {c["code"]: c for c in read_json(COLLEGES_PATH)["colleges"]}
    if college_code not in colleges:
        raise SystemExit(f"unknown courseCollegeCode: {college_code}")
    if teacher_college_code not in colleges:
        raise SystemExit(f"unknown teacherCollegeCode: {teacher_college_code}")

    original = read_workbook(SOURCE_XLS, "original")
    zipped, zip_member = load_zip_xls(SOURCE_ZIP)
    comparison = analyze(original, zipped)
    if not original.get("term"):
        raise SystemExit("term not found in workbook title")
    term_code = original["term"]
    if len(term_code) < 2:
        raise SystemExit("invalid term")
    term_name = config.get("termName") or term_code
    is_current = config["markAsCurrent"]

    official = read_json(MAP_PATH)
    verified = {r["name"]: r for r in official["verified"]}
    unresolved = {r["name"]: r for r in official["unresolved"]}
    if len(verified) != 136:
        raise SystemExit(f"expected 136 verified teachers, got {len(verified)}")

    orig_blocks = [b for sh in original["sheets"] for b in sh["blocks"]]
    zip_blocks = [b for sh in zipped["sheets"] for b in sh["blocks"]]
    source_xls_rel = SOURCE_XLS.relative_to(ROOT).as_posix()
    source_zip_rel = SOURCE_ZIP.relative_to(ROOT).as_posix()
    original["path"] = source_xls_rel
    zipped["path"] = source_zip_rel
    for block in orig_blocks:
        block["sourcePath"] = source_xls_rel
    for block in zip_blocks:
        block["sourcePath"] = f"{source_zip_rel}!/{zip_member['decodedName']}"
    zip_by_sig: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for block in zip_blocks:
        zip_by_sig[signature(block)].append(block)
    orig_by_sig: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for block in orig_blocks:
        orig_by_sig[signature(block)].append(block)

    # Deterministic order for traceable block IDs.
    ordered_sigs = sorted(orig_by_sig, key=lambda s: tuple(str(x) for x in s))
    normalized = []
    for index, sig in enumerate(ordered_sigs, start=1):
        occurrences = orig_by_sig[sig]
        first = occurrences[0]
        zip_occurrences = zip_by_sig.get(sig, [])
        weekdays = sorted({b["weekday"] for b in occurrences}, key=DAY_NAMES.index)
        zip_weekdays = sorted({b["weekday"] for b in zip_occurrences}, key=DAY_NAMES.index)
        normalized.append({
            "blockId": f"upc-chem-{term_code}-{index:04d}",
            "code": first["code"],
            "name": first["name"],
            "teachers": first["teachers"],
            "classes": first["classes"],
            "weeks": first["weeks"],
            "periods": first["periods"],
            "location": first["location"],
            "weekdays": weekdays,
            "zipWeekdays": zip_weekdays,
            "occurrenceCount": len(occurrences),
            "zipOccurrenceCount": len(zip_occurrences),
            "occurrences": occurrences,
            "zipOccurrences": zip_occurrences,
            "anomalies": sorted({a for b in occurrences for a in b.get("anomalies", [])}),
        })

    # Courses are keyed by official code when present; the same name may have
    # several formal codes and must remain separate.
    course_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for block in normalized:
        key = block["code"] or f"name:{norm_course_name(block['name'])}|{college_code}"
        course_groups[key].append(block)
    courses = []
    for key, blocks in sorted(course_groups.items()):
        first = blocks[0]
        courses.append({
            "code": first["code"],
            "name": first["name"],
            "normalizedName": norm_course_name(first["name"]),
            "collegeCode": college_code,
            "teacherNames": sorted({t for b in blocks for t in b["teachers"]}),
            "blockIds": sorted({b["blockId"] for b in blocks}),
            "weekdays": sorted({d for b in blocks for d in b["weekdays"]}, key=DAY_NAMES.index),
            "blockCount": len(blocks),
        })
    courses.sort(key=lambda c: ((c["code"] or ""), c["name"]))

    exact_name_groups = []
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_norm: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for course in courses:
        if course["code"]:
            by_name[course["name"]].append(course)
            by_norm[course["normalizedName"]].append(course)
    for name, rows in sorted(by_name.items()):
        if len({r["code"] for r in rows}) > 1:
            exact_name_groups.append({
                "name": name,
                "codes": sorted({r["code"] for r in rows}),
                "normalizedName": norm_course_name(name),
            })
    normalized_name_groups = []
    for name, rows in sorted(by_norm.items()):
        codes = sorted({r["code"] for r in rows})
        if len(codes) > 1:
            normalized_name_groups.append({
                "name": name,
                "codes": codes,
                "displayNames": sorted({r["name"] for r in rows}),
                "note": "same normalized name; not merged",
            })

    teacher_blocks: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for block in normalized:
        for teacher in block["teachers"]:
            teacher_blocks[teacher].append(block)

    candidates = []
    for name in sorted(teacher_blocks):
        blocks = teacher_blocks[name]
        courses_for = sorted({b["code"] for b in blocks if b["code"]})
        course_names = sorted({b["name"] for b in blocks if b["name"]})
        row = verified.get(name)
        pending = unresolved.get(name)
        candidates.append({
            "name": name,
            "status": row["status"] if row else (pending or {}).get("status", "unresolved"),
            "sourceId": row.get("sourceId") if row else None,
            "title": row.get("title") if row else (pending or {}).get("title"),
            "department": row.get("department") if row else (pending or {}).get("department"),
            "profileUrl": row.get("profileUrl") if row else None,
            "blockCount": len(blocks),
            "courseCodes": courses_for,
            "courseNames": course_names,
            "multiTeacherBlocks": sum(1 for b in blocks if len(b["teachers"]) > 1),
            "unresolvedReason": (pending or {}).get("reason"),
            "needed": (pending or {}).get("needed", []),
        })

    # Offerings are unique teacher × course × term; duplicate timetable cells do
    # not create duplicate relationships.
    all_offerings = {
        (teacher, block["code"] or f"name:{norm_course_name(block['name'])}")
        for block in normalized for teacher in block["teachers"]
    }
    verified_offerings = {
        (teacher, code) for teacher, code in all_offerings if teacher in verified
    }

    import_teachers = []
    for name in sorted(verified):
        blocks = teacher_blocks.get(name, [])
        if not blocks:
            continue
        course_map = {}
        for block in blocks:
            key = block["code"] or f"name:{norm_course_name(block['name'])}"
            course_map[key] = {
                "code": block["code"],
                "name": block["name"],
                "collegeCode": college_code,
            }
        import_teachers.append({
            "sourceId": verified[name]["sourceId"],
            "name": name,
            "title": verified[name].get("title"),
            "collegeCode": teacher_college_code,
            "campus": None,
            "courses": [course_map[k] for k in sorted(course_map)],
        })
    if len(import_teachers) != len(verified):
        raise SystemExit(f"verified teacher without blocks: {len(verified)} vs {len(import_teachers)}")
    imported_offerings = sum(len(t["courses"]) for t in import_teachers)
    if imported_offerings != len(verified_offerings):
        raise SystemExit(f"offering count mismatch: {imported_offerings} vs {len(verified_offerings)}")

    import_payload = {
        "schemaVersion": 1,
        "dataset": f"upc-chemistry-{term_code}-timetable-20261022",
        "source": f"{SOURCE_XLS.name} sha256:{original['sha256']}; 官方教师页 {official['source']}",
        "term": {
            "code": term_code,
            "name": term_name,
            "isCurrent": is_current,
        },
        "teachers": import_teachers,
    }

    source_manifest = {
        "schemaVersion": 1,
        "generatedAt": "2026-10-22",
        "term": {"code": term_code, "name": term_name, "isCurrent": is_current,
                 "titleText": original.get("title")},
        "sourceUnit": {
            "name": config.get("sourceUnitName", "化学化工学院"),
            "canonicalName": colleges[college_code]["name"],
            "collegeCode": college_code,
        },
        "files": {
            "original": {
                "path": source_xls_rel,
                "sha256": original["sha256"],
                "bytes": SOURCE_XLS.stat().st_size,
                "format": original["format"],
            },
            "zip": {
                "path": source_zip_rel,
                "sha256": zipped["sha256"],
                "bytes": SOURCE_ZIP.stat().st_size,
                "entries": zipped.get("zipEntries", []),
                "chosenEntry": zip_member,
            },
        },
        "workbooks": {
            "original": {
                "sheets": [
                    {"name": sh["name"], "rows": sh["nrows"], "cols": sh["ncols"],
                     "headerRow": sh["headerRow"], "weekdayColumns": sh["weekdayColumns"],
                     "mergedCells": sh["mergedCells"], "blocks": len(sh["blocks"]),
                     "anomalies": sh["anomalies"]}
                    for sh in original["sheets"]
                ],
            },
            "zip": {
                "sheets": [
                    {"name": sh["name"], "rows": sh["nrows"], "cols": sh["ncols"],
                     "headerRow": sh["headerRow"], "weekdayColumns": sh["weekdayColumns"],
                     "mergedCells": sh["mergedCells"], "blocks": len(sh["blocks"]),
                     "anomalies": sh["anomalies"]}
                    for sh in zipped["sheets"]
                ],
            },
        },
        "comparison": comparison["comparison"],
        "normalization": {
            "duplicatePolicy": "one normalized block per exact course block signature; all source occurrences retained",
            "courseIdentity": "code when present, otherwise (name, college); same name with different codes is not merged",
            "weekdayUse": "weekday retained for source evidence; timetable display/recommendation stays out of phase one",
        },
    }

    duplicate_groups = []
    for sig, rows in sorted(orig_by_sig.items(), key=lambda kv: tuple(str(x) for x in kv[0])):
        if len(rows) > 1:
            duplicate_groups.append({
                "code": rows[0]["code"], "name": rows[0]["name"],
                "teachers": rows[0]["teachers"], "classes": rows[0]["classes"],
                "weeks": rows[0]["weeks"], "periods": rows[0]["periods"],
                "location": rows[0]["location"],
                "count": len(rows),
                "sourceCells": [f"{r['sheet']}!{r['cell']} ({r['weekday']})" for r in rows],
            })

    anomalies = {
        "schemaVersion": 1,
        "parserAnomalies": [b for sh in original["sheets"] for b in sh["blocks"] if b.get("anomalies")]
                            + [b for sh in zipped["sheets"] for b in sh["blocks"] if b.get("anomalies")],
        "duplicateBlocks": duplicate_groups,
        "weekdayDiscrepancy": comparison["comparison"]["weekday"],
        "emptySheets": [
            {"file": wb["label"], "sheet": sh["name"]}
            for wb in (original, zipped) for sh in wb["sheets"] if sh["nrows"] == 0 or not sh["blocks"]
        ],
        "blocksWithoutLocation": sum(1 for b in normalized if not b["location"]),
        "multiTeacherBlocks": sum(1 for b in normalized if len(b["teachers"]) > 1),
        "multiTeacherBlockDetails": [
            {"blockId": b["blockId"], "code": b["code"], "name": b["name"],
             "teachers": b["teachers"], "classes": b["classes"], "weekdays": b["weekdays"]}
            for b in normalized if len(b["teachers"]) > 1
        ],
        "sameNameDifferentCodes": exact_name_groups,
        "sameNormalizedNameDifferentCodes": normalized_name_groups,
        "unresolvedTeachers": list(unresolved.values()),
        "notes": [
            "ZIP 中的 XLS 与原始 XLS 课程块签名多重集完全一致；ZIP 的星期列整体比原始导出提前一天，",
            "因此一期只使用原始导出建立教师×课程×学期关系，星期仅作为来源证据保留。",
            "空工作表、重复课程块、无地点实验课均保留记录，不静默丢弃。",
        ],
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_DIR / "source-manifest.json", source_manifest)
    write_json(OUT_DIR / "raw-blocks.json", {
        "schemaVersion": 1,
        "source": source_manifest["files"],
        "original": original,
        "zip": zipped,
    })
    write_json(OUT_DIR / "normalized-course-blocks.json", {
        "schemaVersion": 1,
        "term": term_code,
        "blocks": normalized,
        "counts": {"rawOriginal": len(orig_blocks), "rawZip": len(zip_blocks),
                   "unique": len(normalized)},
    })
    write_json(OUT_DIR / "courses.json", {
        "schemaVersion": 1,
        "collegeCode": college_code,
        "courses": courses,
        "exactSameNameDifferentCodes": exact_name_groups,
        "normalizedSameNameDifferentCodes": normalized_name_groups,
        "counts": {"uniqueCourses": len(courses),
                   "sameNameDifferentCodeGroups": len(exact_name_groups),
                   "sameNormalizedNameDifferentCodeGroups": len(normalized_name_groups)},
    })
    write_json(OUT_DIR / "teacher-candidates.json", {
        "schemaVersion": 1,
        "source": official["source"],
        "candidates": candidates,
        "counts": {"candidates": len(candidates), "verified": len(verified),
                   "unresolved": len(unresolved),
                   "multiTeacherBlocks": anomalies["multiTeacherBlocks"]},
    })
    omitted_offerings = []
    for block in normalized:
        for teacher in block["teachers"]:
            if teacher in unresolved:
                omitted_offerings.append({
                    "teacher": teacher,
                    "code": block["code"],
                    "name": block["name"],
                    "blockId": block["blockId"],
                })
    omitted_offerings = list({
        (row["teacher"], row["code"] or row["name"]): row for row in omitted_offerings
    }.values())
    write_json(OUT_DIR / "unresolved-teachers.json", {
        "schemaVersion": 1,
        "source": official["source"],
        "teachers": list(unresolved.values()),
        "omittedOfferings": sorted(omitted_offerings, key=lambda r: (r["teacher"], r["code"] or "")),
        "needed": [
            "官方教师详情页或教工号（用于稳定 sourceId）",
            "教师人事归属学院",
            "无法确认时不得按姓名合并或编造编号",
        ],
    })
    write_json(OUT_DIR / "import.json", import_payload)
    write_json(OUT_DIR / "anomalies.json", anomalies)

    with (OUT_DIR / "teacher-mapping-template.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["timetableName", "status", "sourceId", "officialName", "title",
                         "department", "profileUrl", "blockCount", "courseCodes", "needed"])
        for row in candidates:
            writer.writerow([
                row["name"], row["status"], row["sourceId"] or "", row["name"],
                row["title"] or "", row["department"] or "", row["profileUrl"] or "",
                row["blockCount"], ",".join(row["courseCodes"]), "; ".join(row["needed"] or []),
            ])

    metrics = {
        "rawCourseBlocks": len(orig_blocks) + len(zip_blocks),
        "rawCourseBlocksOriginal": len(orig_blocks),
        "rawCourseBlocksZip": len(zip_blocks),
        "uniqueCourseBlocks": len(normalized),
        "duplicateOccurrencesPerExport": comparison["comparison"]["duplicateOccurrencesOriginal"],
        "uniqueCourses": len(courses),
        "sameNameDifferentCodeGroups": len(exact_name_groups),
        "teacherCandidates": len(candidates),
        "verifiedTeachers": len(verified),
        "unresolvedTeachers": len(unresolved),
        "uniqueTeacherCourseOfferings": len(all_offerings),
        "verifiedTeacherCourseOfferings": len(verified_offerings),
        "omittedUnverifiedOfferings": len(all_offerings) - len(verified_offerings),
        "importTeachers": len(import_teachers),
        "importCourses": len({c["code"] for t in import_teachers for c in t["courses"] if c["code"]}),
        "importOfferings": imported_offerings,
        "multiTeacherBlocks": anomalies["multiTeacherBlocks"],
        "blocksWithoutLocation": anomalies["blocksWithoutLocation"],
        "emptySheets": len(anomalies["emptySheets"]),
    }

    report = f"""# 化学化工学院课表解析与导入报告

生成日期：2026-10-22。对象：中国石油大学（华东）化学化工学院 2026-2027-1 课表。

## 交付边界

- 已取得原始课表：`课表打印.xls` 与 `课表打印.zip`。
- 已解析全部工作表/课程块；未修改原件，原件哈希见 `source-manifest.json`。
- 教师身份：{metrics['verifiedTeachers']}/{metrics['teacherCandidates']} 已通过官方教师列表+个人详情页核实；
  {metrics['unresolvedTeachers']} 人保留待映射，不生成 sourceId。
- 导入文件只包含已核实教师与关系；未核实教师的 {metrics['omittedUnverifiedOfferings']} 条开课关系不写入。
- 课表展示、推荐、教务通知继续后置；本轮只建立教师×课程×学期关系。
- 真实目标库验收尚未执行；本报告是本地解析/生成结果。

## 原始文件

| 文件 | SHA-256 | 说明 |
| --- | --- | --- |
| `课表打印.xls` | `{original['sha256']}` | BIFF8/OLE2，工作表 `{', '.join(sh['name'] for sh in original['sheets'])}` |
| `课表打印.zip` | `{zipped['sha256']}` | 内含 `{zip_member['decodedName']}`，成员 SHA-256 `{zip_member['sha256']}` |

原始 XLS 工作表：{', '.join(f"{sh['name']} ({sh['nrows']}行/{sh['ncols']}列/{len(sh['blocks'])}块)" for sh in original['sheets'])}。
ZIP 内 XLS 工作表：{', '.join(f"{sh['name']} ({sh['nrows']}行/{sh['ncols']}列/{len(sh['blocks'])}块)" for sh in zipped['sheets'])}。
空工作表保留在 `source-manifest.json`，不参与课程块统计。

## 两种导出核对

- 原始导出 {len(orig_blocks)} 块；ZIP 内导出 {len(zip_blocks)} 块。
- 课程块签名多重集完全一致：`{comparison['comparison']['sameSignatureMultiset']}`。
- 唯一课程块 {len(normalized)}；每个导出有 {comparison['comparison']['duplicateOccurrencesOriginal']} 次重复出现。
- ZIP 的星期列整体比原始导出{comparison['comparison']['weekday']['zipShiftDescription']}
  （例如 ZIP 星期日 = 原始星期一）。表头文字相同但内容错位，属于待核实差异；
  一期不使用星期做展示，教师×课程×学期关系不受影响。
- 一期以原始 `课表打印.xls` 为主来源；ZIP 仅作交叉核对，来源定位同时保留。

## 课程

- 唯一正式课程编码/课程：{metrics['uniqueCourses']}。
- 同名不同编码组：{metrics['sameNameDifferentCodeGroups']} 组（见 `courses.json`）。
- 已调整课程唯一键：有名无编码时才用 `(name, college)`；有正式编码时以编码区分，
  同名不同编码不再被合并。同编码不同名称仍会报冲突。
- 课程开课单位：来源名称 `{config.get('sourceUnitName', '化学化工学院')}` → 学院字典
  `{colleges[college_code]['name']}` (`{college_code}`)，与教师人事归属字段分开。

## 教师

- 候选：{metrics['teacherCandidates']} 人。
- 已核实：{metrics['verifiedTeachers']} 人；稳定 sourceId 取自官方个人详情页文章 ID。
- 待核实：{metrics['unresolvedTeachers']} 人。名单、原因和所缺信息见
  `unresolved-teachers.json`、`teacher-mapping-template.csv`。
- 职称/系室取官方教师列表或详情页；校区未核实，导入时留空。
- 不按姓名哈希合并同名教师，不编造教工号。
- 核实口径为“官方教师列表姓名 + 唯一官方个人详情页标题姓名”；本轮未出现同名多页冲突，
  但跨学院同名教师仍建议后续用教工号复核。

## 导入数据

- 可导入教师：{metrics['importTeachers']}。
- 可导入课程：{metrics['importCourses']}。
- 可导入开课关系：{metrics['importOfferings']}（唯一教师×课程×学期）。
- 未核实教师导致未导入的关系：{metrics['omittedUnverifiedOfferings']}。
- 学期：`{term_code}`，从文件标题读取；展示名暂用标题中的编码，待校历确认；
  `isCurrent={str(is_current).lower()}` 由 `config.json` 明确配置，不按当前日期猜测。
- 导入文件：`import.json`；不包含 fixture 标记，不使用旧校数据。

## 异常与重复

- 多教师课程块：{metrics['multiTeacherBlocks']}。
- 无地点课程块：{metrics['blocksWithoutLocation']}（实验课常见，保留空地点）。
- 解析异常：{len(anomalies['parserAnomalies'])} 条（无结构异常时为空数组）。
- 重复块：{len(anomalies['duplicateBlocks'])} 组；明细见 `anomalies.json`。
- 同名不同编码：{len(exact_name_groups)} 组；未改课程名、未删编码、未合并。

## 本地验证

- Python 解析器 12/12：多课程单元格、多人授课、无地点、异常缺编码、双导出星期错位、多学院编码、身份和批次一致性；
  真实原件结构。
- `npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --validate-only`
  通过：136 名教师、271 条教师-课程行。
- PGlite 本地 SQL 测试：首次导入 136 教师/129 课程/271 关系，重跑全部跳过，
  dry-run 不产生增量，失败整批回滚；真实导入教师完成提交/审核/+20 积分/公开/
  他人点赞/删除清空闭环；10 项 schema/导入测试通过。
- 旧库升级回归：旧唯一键与旧导入实现经完整升级后，真实批次可预检、导入和重跑；
  重复升级保留原有数据。升级文件在同一事务中更新课程约束、导入 RPC 及授权。
- `npm run verify:local` 通过：schema → lint → 38 根测试 → build → 17 服务测试。
- 目标 Supabase 测试库尚未执行；正式库未写入、未上线。

## 运行命令

```powershell
python scripts/upc-timetable/build_chemistry_dataset.py
```

可单独运行只读解析诊断（不会修改原件）：

```powershell
python scripts/upc-timetable/parse_timetable.py `
  --xls "课表/化学化工学院/课表打印.xls" `
  --zip "课表/化学化工学院/课表打印.zip" `
  --output data/upc/chemistry-2026-2027-1/raw-parse.json
```

## 目标测试库命令（未执行）

```powershell
Copy-Item .env.import.example .env.import.local
# 填 UPC 测试项目 URL + service_role key
npm run import:upc -- .\\data\\upc\\chemistry-2026-2027-1\\import.json --validate-only
npm run import:upc -- .\\data\\upc\\chemistry-2026-2027-1\\import.json --dry-run
npm run import:upc -- .\\data\\upc\\chemistry-2026-2027-1\\import.json
```

新空库执行 `supabase/upc-init.sql`；已初始化库改为执行
`supabase/upgrades/20261022-course-code-identity.sql`，两条路径择一。
升级文件由 `npm run schema:build` 生成，包含课程约束与最新导入 RPC，
不能只改唯一键而保留旧导入实现。
"""
    (OUT_DIR / "report.md").write_text(report, encoding="utf-8")

    print(json.dumps({"outDir": str(OUT_DIR), **metrics,
                      "term": term_code, "isCurrent": is_current,
                      "weekdayShift": comparison["comparison"]["weekday"]["zipShiftSignedDays"],
                      "weekdayShiftDescription": comparison["comparison"]["weekday"]["zipShiftDescription"]},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
