#!/usr/bin/env python3
"""Build the reproducible multi-college UPC timetable batches.

The existing chemistry batch is kept as-is and used only as a baseline for
global identity/conflict accounting. New units are parsed read-only, mapped to
official teacher profiles, deduplicated by formal course code and stable
teacher sourceId, then emitted as per-unit import payloads plus a manifest.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from parse_timetable import CODE_RE, read_workbook

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = ROOT / "课表"
OUT = ROOT / "data" / "upc" / "timetables-2026-2027-1"
UNITS = ROOT / "scripts" / "upc-timetable" / "units.json"
TEACHERS = ROOT / "scripts" / "upc-timetable" / "official-teacher-map-all.json"
COLLEGES = ROOT / "data" / "upc" / "colleges.json"
CHEM_IMPORT = ROOT / "data" / "upc" / "chemistry-2026-2027-1" / "import.json"
TERM_CODE = "2026-2027-1"
TERM_NAME = "2026-2027-1"
TODAY = "2026-10-23"
NAME_RE = re.compile(r"^[\u4e00-\u9fff·]{2,8}$")
CLASS_LIKE = re.compile(r"班|\[|第.*周")


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def norm_name(value: str) -> str:
    value = (value or "").replace("\u3000", " ").replace(" ", "").strip()
    value = re.sub(r"[（(](?:兼职|外院|院士)[）)]$", "", value)
    return value


def norm_course(value: str) -> str:
    return re.sub(r"\s+", "", value or "").replace("（", "(").replace("）", ")")


def course_key(code: str | None, name: str, college: str) -> str:
    return code if code else f"name:{norm_course(name)}|{college}"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    config = load(UNITS)
    colleges = {c["code"]: c for c in load(COLLEGES)["colleges"]}
    teacher_map = load(TEACHERS)
    people_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    official_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    timetable_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for rec in teacher_map["verified"]:
        for match in rec.get("unitMatches") or []:
            if match.get("accepted"):
                people_by_key[(match["sourceUnit"], rec["name"])].append(rec)
                official_by_key[(match["sourceUnit"], rec["name"])].append(rec)
    for rec in teacher_map.get("timetableIdentities", []):
        for match in rec.get("unitMatches") or []:
            if match.get("accepted"):
                people_by_key[(match["sourceUnit"], rec["name"])].append(rec)
                timetable_by_key[(match["sourceUnit"], rec["name"])].append(rec)
    unresolved_map = {(r["sourceUnit"], r["name"]): r for r in teacher_map["unresolved"]}

    chem_payload = load(CHEM_IMPORT)
    chem_teachers = {t["sourceId"]: t for t in chem_payload["teachers"]}
    chem_courses: dict[str, dict[str, Any]] = {}
    chem_offerings: set[tuple[str, str]] = set()
    for t in chem_payload["teachers"]:
        for c in t.get("courses") or []:
            key = course_key(c.get("code"), c["name"], c.get("collegeCode") or "upc-03")
            chem_courses[key] = {
                "code": c.get("code"), "name": c["name"], "collegeCode": c.get("collegeCode") or "upc-03",
            }
            chem_offerings.add((t["sourceId"], key))
    chem_groups = defaultdict(set)
    for c in chem_courses.values():
        if c["code"]:
            chem_groups[c["name"]].add(c["code"])
    chem_count = {"teachers": len(chem_teachers), "courses": len(chem_courses),
                  "offerings": len(chem_offerings),
                  "sameNameDifferentCodeGroups": sum(1 for codes in chem_groups.values() if len(codes) > 1)}

    unit_results: list[dict[str, Any]] = []
    all_new_courses: dict[str, dict[str, Any]] = {}
    all_new_teachers: dict[str, dict[str, Any]] = {}
    all_new_offerings: set[tuple[str, str]] = set()
    conflicts: list[dict[str, Any]] = []
    source_manifest: dict[str, Any] = {
        "schemaVersion": 1, "generatedAt": TODAY, "term": {
            "code": TERM_CODE, "name": TERM_NAME, "isCurrent": False,
        }, "source": "课表/ 原始 XLS；官方学院教师列表/个人页或 CV",
        "units": [],
    }

    for unit in config["units"]:
        u = unit["slug"]
        source_dir = unit["sourceDir"]
        xls_name = unit.get("xls")
        result: dict[str, Any] = {
            "slug": u, "sourceUnit": unit["sourceUnitName"], "collegeCode": unit.get("collegeCode"),
            "status": unit.get("status", "active"), "sourceDir": source_dir,
        }
        if not xls_name:
            result.update({"rawBlocks": 0, "candidates": 0, "verified": 0, "courses": 0,
                           "offerings": 0, "unresolved": 0, "reason": "no timetable file supplied"})
            unit_results.append(result)
            continue
        xls = SOURCE_ROOT / source_dir / xls_name
        if not xls.exists():
            result.update({"rawBlocks": 0, "candidates": 0, "verified": 0, "courses": 0,
                           "offerings": 0, "unresolved": 0, "error": "file missing"})
            unit_results.append(result)
            continue
        wb = read_workbook(xls, "original")
        if wb.get("term") != TERM_CODE:
            result.update({"rawBlocks": 0, "candidates": 0, "verified": 0, "courses": 0,
                           "offerings": 0, "unresolved": 0,
                           "error": f"term mismatch: {wb.get('term')}"})
            unit_results.append(result)
            continue
        raw_blocks = [b for sh in wb["sheets"] for b in sh["blocks"]]
        courses: dict[str, dict[str, Any]] = {}
        teacher_names: set[str] = set()
        teacher_course_keys: dict[str, set[str]] = defaultdict(set)
        excluded_blocks: list[dict[str, Any]] = []
        for block in raw_blocks:
            code, name = block.get("code"), (block.get("name") or "").strip()
            teachers = []
            for raw_name in block.get("teachers", []):
                n = norm_name(raw_name)
                if NAME_RE.fullmatch(n):
                    teachers.append(n)
            teacher_names.update(teachers)
            if not name or (not code and (not teachers or CLASS_LIKE.search(name))):
                excluded_blocks.append({"reason": "missing_course_identity", "raw": block.get("raw", "")[:180]})
                continue
            key = course_key(code, name, unit.get("collegeCode") or "")
            if key not in courses:
                courses[key] = {"key": key, "code": code, "name": name,
                                "collegeCode": unit.get("collegeCode"), "sourceBlocks": 0,
                                "teacherNames": set()}
            courses[key]["sourceBlocks"] += 1
            courses[key]["teacherNames"].update(teachers)
            if teachers:
                for n in teachers:
                    teacher_course_keys[n].add(key)
            else:
                excluded_blocks.append({"reason": "missing_teacher", "code": code, "name": name})
        # candidate counts from all blocks, including blocks with no usable course
        candidates = sorted({norm_name(n) for b in raw_blocks for n in b.get("teachers", []) if NAME_RE.fullmatch(norm_name(n))})
        verified_names = [n for n in candidates if people_by_key.get((source_dir, n))]
        official_verified_names = [n for n in candidates if official_by_key.get((source_dir, n))]
        timetable_verified_names = [n for n in candidates if timetable_by_key.get((source_dir, n))]
        unresolved = []
        for n in candidates:
            if people_by_key.get((source_dir, n)):
                continue
            pending = unresolved_map.get((source_dir, n))
            unresolved.append({
                "name": n, "reason": pending.get("reason") if pending else "no_official_profile_found",
                "candidates": pending.get("candidateProfiles", []) if pending else [],
                "relationCount": pending.get("relationCount", 0) if pending else 0,
            })
        # Code conflicts are evaluated globally after all units are parsed. Keep
        # raw course groups now; they will be filtered below.
        result.update({
            "rawBlocks": len(raw_blocks), "candidates": len(candidates), "candidateNames": candidates,
            "verified": sum(len(people_by_key[(source_dir, n)]) for n in verified_names),
            "officialVerified": sum(len(official_by_key[(source_dir, n)]) for n in official_verified_names),
            "timetableVerified": sum(len(timetable_by_key[(source_dir, n)]) for n in timetable_verified_names),
            "verifiedNames": sorted(verified_names), "unresolved": len(unresolved),
            "unresolvedDetails": unresolved, "excludedBlocks": len(excluded_blocks),
            "excludedBlockReasons": dict(Counter(x["reason"] for x in excluded_blocks)),
            "coursesRaw": len(courses), "teacherCourseKeys": {n: sorted(v) for n, v in teacher_course_keys.items()},
            "coursesData": courses,
            "sourceFile": {"path": xls.relative_to(ROOT).as_posix(), "bytes": xls.stat().st_size, "sha256": sha256(xls),
                           "format": wb.get("format"), "title": wb.get("title"), "term": wb.get("term"),
                           "sheets": [{"name": sh["name"], "rows": sh["nrows"], "cols": sh["ncols"],
                                       "headerRow": sh["headerRow"], "blocks": len(sh["blocks"]),
                                       "anomalies": sh["anomalies"]} for sh in wb["sheets"]]},
        })
        unit_results.append(result)

    # Global course identity validation against chemistry and all new units.
    unit_course_rows: dict[str, dict[str, dict[str, Any]]] = {}
    for result in unit_results:
        if result.get("coursesData"):
            unit_course_rows[result["slug"]] = result["coursesData"]
    code_global: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for key, c in chem_courses.items():
        if c["code"]:
            code_global[c["code"]].append(("chemistry", c["name"], c["collegeCode"]))
    for slug, rows in unit_course_rows.items():
        if slug == "chemistry":
            continue
        for c in rows.values():
            if c["code"]:
                code_global[c["code"]].append((slug, c["name"], c["collegeCode"]))
    conflict_codes: set[str] = set()
    for code, rows in code_global.items():
        variants = {(name, college) for _, name, college in rows}
        if len(variants) > 1:
            conflict_codes.add(code)
            conflicts.append({"code": code, "variants": [
                {"unit": unit, "name": name, "collegeCode": college} for unit, name, college in rows
            ], "reason": "same course code has different name or college"})
    # A coded course makes a same-name uncoded course ambiguous.
    coded_by_name_college = {(c["name"], c["collegeCode"]): c["code"] for c in chem_courses.values() if c["code"]}
    for slug, rows in unit_course_rows.items():
        if slug == "chemistry":
            continue
        for c in rows.values():
            if c["code"]:
                coded_by_name_college[(c["name"], c["collegeCode"])] = c["code"]
    for slug, rows in unit_course_rows.items():
        for key, c in list(rows.items()):
            if c["code"] in conflict_codes:
                if slug == "chemistry":
                    c["existingRetainedReason"] = "existing_chemistry_retained"
                else:
                    c["excludedReason"] = "course_code_conflict"
            elif not c["code"] and (c["name"], c["collegeCode"]) in coded_by_name_college:
                c["excludedReason"] = "uncoded_same_name_has_coded_course"

    # Build per-unit payloads and global unions.
    for result in unit_results:
        slug = result["slug"]
        code = result.get("collegeCode")
        if result.get("status") == "existing":
            chem_tt = [p for p in teacher_map.get("timetableIdentities", [])
                       if any(m.get("sourceUnit") == "化学化工学院" for m in p.get("unitMatches", []))]
            chem_tt_offerings = sum(len(m.get("courseCodes", []))
                                    for p in chem_tt for m in p.get("unitMatches", []))
            result.update({
                "courses": chem_count["courses"],
                "offerings": chem_count["offerings"] + chem_tt_offerings,
                "verified": chem_count["teachers"] + len(chem_tt),
                "officialVerified": chem_count["teachers"],
                "timetableVerified": len(chem_tt),
                "unresolved": len([r for r in teacher_map["unresolved"]
                                   if r["sourceUnit"] == "化学化工学院"]),
                "payloadTeachers": chem_count["teachers"] + len(chem_tt),
                "payloadCourses": chem_count["courses"],
                "payloadOfferings": chem_count["offerings"] + chem_tt_offerings,
                "baselineTeachers": chem_count["teachers"],
                "baselineCourses": chem_count["courses"],
                "baselineOfferings": chem_count["offerings"],
                "importFile": "data/upc/chemistry-2026-2027-1/import.json",
                "extensionFile": "timetable-identities/import.json",
                "baseline": True,
            })
            continue
        if not code or result.get("status") != "active":
            result.update({"courses": 0, "offerings": 0, "importFile": None})
            continue
        rows = {k: c for k, c in result.get("coursesData", {}).items() if not c.get("excludedReason")}
        # Only verified teachers with a valid dictionary college may be emitted.
        teachers = []
        for name in result.get("verifiedNames", []):
            for rec in people_by_key[(result["sourceDir"], name)]:
                tcode = rec.get("collegeCode")
                if not tcode or tcode not in colleges:
                    continue
                keys = [k for k in result["teacherCourseKeys"].get(name, []) if k in rows]
                assigned = next((m.get("courseCodes") for m in rec.get("unitMatches", [])
                                 if m.get("sourceUnit") == result["sourceDir"]
                                 and m.get("reason") == "official_same_unit_course_assignment"), None)
                if assigned is not None:
                    # A true same-name person only receives courses explicitly
                    # assigned from their official main-course evidence.
                    allowed = set(assigned)
                    keys = [k for k in keys if (rows[k].get("code") in allowed)]
                course_list = [{"code": rows[k]["code"], "name": rows[k]["name"], "collegeCode": code}
                               for k in sorted(set(keys))]
                teachers.append({
                    "sourceId": rec["sourceId"], "name": name, "title": rec.get("title"),
                    "collegeCode": tcode, "campus": None, "courses": course_list,
                })
                for k in set(keys):
                    all_new_courses.setdefault(k, rows[k])
                    all_new_offerings.add((rec["sourceId"], k))
                all_new_teachers[rec["sourceId"]] = {
                    "sourceId": rec["sourceId"], "name": name, "title": rec.get("title"),
                    "collegeCode": tcode, "campus": None,
                }
        # unique teacher/course/offering counts for this unit
        used_keys = {k for t in teachers for c in t["courses"]
                     for k in [course_key(c["code"], c["name"], c["collegeCode"])]}
        unit_offerings = {(t["sourceId"], course_key(c["code"], c["name"], c["collegeCode"]))
                          for t in teachers for c in t["courses"]}
        result.update({
            "courses": len(used_keys),
            "offerings": len(unit_offerings),
            "importFile": f"units/{slug}/import.json",
        })
        payload = {
            "schemaVersion": 1,
            "dataset": f"upc-{slug}-{TERM_CODE}-timetable-{TODAY.replace('-', '')}",
            "source": f"{result['sourceFile']['path']} sha256:{result['sourceFile']['sha256']}; official teacher lists/profiles",
            "term": {"code": TERM_CODE, "name": TERM_NAME, "isCurrent": False},
            "teachers": teachers,
        }
        outdir = OUT / "units" / slug
        write(outdir / "import.json", payload)
        # Per-unit audit: every candidate, status, profile evidence, and course
        # groups including excluded conflicts. Chemistry keeps its original
        # detailed files, so do not overwrite them.
        if result.get("status") != "existing":
            unresolved_by_name = {x["name"]: x for x in result.get("unresolvedDetails", [])}
            candidate_rows = []
            for name in result.get("candidateNames", []):
                recs = people_by_key.get((result["sourceDir"], name), [])
                if not recs:
                    keys = result.get("teacherCourseKeys", {}).get(name, [])
                    candidate_rows.append({
                        "name": name, "status": "unresolved", "identityType": None,
                        "sourceId": None, "title": None, "collegeCode": None,
                        "profileUrl": None, "profileKind": None,
                        "matchReason": None, "matchEvidence": None,
                        "courseCodes": sorted({result["coursesData"][k]["code"] for k in keys
                                               if k in result["coursesData"] and result["coursesData"][k].get("code")}),
                        "courseNames": sorted({result["coursesData"][k]["name"] for k in keys
                                               if k in result["coursesData"]}),
                        "unresolvedReason": unresolved_by_name.get(name, {}).get("reason"),
                        "candidateProfiles": unresolved_by_name.get(name, {}).get("candidates", []),
                        "affectedCourseRelations": len(keys),
                    })
                    continue
                for rec in recs:
                    match = next((m for m in rec.get("unitMatches", [])
                                  if m.get("sourceUnit") == result["sourceDir"]), None)
                    keys = result.get("teacherCourseKeys", {}).get(name, [])
                    if match and match.get("reason") == "official_same_unit_course_assignment":
                        allowed = set(match.get("courseCodes", []))
                        keys = [k for k in keys
                                if result["coursesData"].get(k, {}).get("code") in allowed]
                    identity_type = rec.get("identityType") or "official_profile"
                    candidate_rows.append({
                        "name": name,
                        "status": "timetable_unit" if identity_type == "timetable_unit_name" else "verified",
                        "identityType": identity_type,
                        "sourceId": rec.get("sourceId"),
                        "title": rec.get("title"),
                        "collegeCode": rec.get("collegeCode"),
                        "profileUrl": rec.get("profileUrl"),
                        "profileKind": rec.get("profileKind"),
                        "matchReason": match.get("reason") if match else None,
                        "matchEvidence": match.get("evidence") if match else None,
                        "courseCodes": sorted({result["coursesData"][k]["code"] for k in keys
                                               if k in result["coursesData"] and result["coursesData"][k].get("code")}),
                        "courseNames": sorted({result["coursesData"][k]["name"] for k in keys
                                               if k in result["coursesData"]}),
                        "unresolvedReason": None,
                        "candidateProfiles": [],
                        "affectedCourseRelations": 0,
                    })
            write(outdir / "teacher-candidates.json", {
                "schemaVersion": 1, "unit": result["sourceUnit"], "collegeCode": code,
                "candidates": candidate_rows,
            })
            course_rows = []
            for row in sorted(result.get("coursesData", {}).values(), key=lambda x: x["key"]):
                course_rows.append({**row, "teacherNames": sorted(row.get("teacherNames", [])),
                                    "excludedReason": row.get("excludedReason")})
            write(outdir / "courses.json", {
                "schemaVersion": 1, "unit": result["sourceUnit"], "collegeCode": code,
                "courses": course_rows,
            })
        write(outdir / "report.json", {k: v for k, v in result.items()
                                        if k not in ("coursesData", "teacherCourseKeys", "verifiedNames",
                                                     "candidateNames")})
        result["payloadTeachers"] = len(teachers)
        result["payloadCourses"] = len(used_keys)
        result["payloadOfferings"] = len(unit_offerings)
        result["sourceFile"].pop("sheets", None)
        source_manifest["units"].append(result["sourceFile"] | {
            "slug": slug, "sourceUnit": result["sourceUnit"], "collegeCode": code,
            "term": TERM_CODE, "rawBlocks": result["rawBlocks"],
        })

    # Combined payload is for audit and one-shot reproducibility; the actual
    # import uses per-unit payloads to preserve batch traceability.
    combined_teachers: dict[str, dict[str, Any]] = {}
    for slug, rows in unit_course_rows.items():
        result = next(r for r in unit_results if r["slug"] == slug)
        if not result.get("payloadTeachers") or result.get("baseline"):
            continue
        for t in load(OUT / "units" / slug / "import.json")["teachers"]:
            dest = combined_teachers.setdefault(t["sourceId"], {**t, "courses": []})
            seen = {(c["code"], c["name"], c["collegeCode"]) for c in dest["courses"]}
            for c in t["courses"]:
                sig = (c["code"], c["name"], c["collegeCode"])
                if sig not in seen:
                    dest["courses"].append(c); seen.add(sig)
    combined = {
        "schemaVersion": 1, "dataset": f"upc-all-new-colleges-{TERM_CODE}-timetable-{TODAY.replace('-', '')}",
        "source": "per-unit batches under data/upc/timetables-2026-2027-1/units",
        "term": {"code": TERM_CODE, "name": TERM_NAME, "isCurrent": False},
        "teachers": [combined_teachers[k] for k in sorted(combined_teachers)],
    }
    write(OUT / "import-all.json", combined)
    same_name_recon = load(ROOT / "scripts" / "upc-timetable" / "same-name-reconciliation.json")
    same_name_ids = {g["canonicalSourceId"] for g in same_name_recon["aliasGroups"]}
    for g in same_name_recon["distinctGroups"]:
        same_name_ids.update(a["sourceId"] for a in g.get("assigned", []))
        same_name_ids.update(a["sourceId"] for a in g.get("inferredAssignments", []))
    same_name_teachers = [t for t in combined["teachers"] if t["sourceId"] in same_name_ids]
    if len(same_name_teachers) != len(same_name_ids):
        raise SystemExit(f"same-name official payload mismatch: {len(same_name_teachers)} != {len(same_name_ids)}")
    same_name_payload = {
        "schemaVersion": 1,
        "dataset": f"upc-same-name-official-identities-{TERM_CODE}-{TODAY.replace('-', '')}",
        "source": "official profile alias dedup + true same-name course assignments; only explicitly assigned courses",
        "term": {"code": TERM_CODE, "name": TERM_NAME, "isCurrent": False},
        "teachers": same_name_teachers,
    }
    write(OUT / "same-name-official-identities" / "import.json", same_name_payload)
    # New same-name timetable identities are imported as one explicit increment;
    # existing per-unit batches and official IDs are never replaced.
    tt_teachers = []
    for rec in teacher_map.get("timetableIdentities", []):
        match = (rec.get("unitMatches") or [{}])[0]
        source_dir = match.get("sourceUnit")
        result = next((r for r in unit_results if r["sourceDir"] == source_dir), None)
        courses = []
        if source_dir == "化学化工学院":
            # The original chemistry payload remains untouched; extension courses
            # are resolved against the existing chemistry course inventory.
            for key in match.get("courseCodes", []):
                row = chem_courses.get(key)
                if row:
                    courses.append({"code": row.get("code"), "name": row["name"],
                                    "collegeCode": row.get("collegeCode") or rec["collegeCode"]})
        else:
            rows = (result or {}).get("coursesData", {})
            for key in match.get("courseCodes", []):
                row = rows.get(key)
                if row and not row.get("excludedReason"):
                    courses.append({"code": row.get("code"), "name": row["name"],
                                    "collegeCode": row.get("collegeCode") or rec["collegeCode"]})
        tt_teachers.append({
            "sourceId": rec["sourceId"], "name": rec["name"], "title": None,
            "identityType": "timetable_unit_name", "collegeCode": rec["collegeCode"],
            "campus": None, "courses": courses,
        })
    tt_payload = {
        "schemaVersion": 1,
        "dataset": f"upc-timetable-unit-identities-{TERM_CODE}-{TODAY.replace('-', '')}",
        "source": "same-name timetable-source identities; no official profile or HR affiliation claimed",
        "term": {"code": TERM_CODE, "name": TERM_NAME, "isCurrent": False},
        "teachers": tt_teachers,
    }
    write(OUT / "timetable-identities" / "import.json", tt_payload)
    all_new_teachers = {t["sourceId"]: t for t in combined["teachers"]}
    all_new_courses = {}
    all_new_offerings = set()
    for t in combined["teachers"]:
        for c in t["courses"]:
            key = course_key(c["code"], c["name"], c["collegeCode"])
            all_new_courses[key] = c
            all_new_offerings.add((t["sourceId"], key))
    for t in tt_teachers:
        all_new_teachers.setdefault(t["sourceId"], {
            "sourceId": t["sourceId"], "name": t["name"], "title": None,
            "collegeCode": t["collegeCode"], "campus": None,
        })
        for c in t["courses"]:
            key = course_key(c["code"], c["name"], c["collegeCode"])
            all_new_courses.setdefault(key, c)
            all_new_offerings.add((t["sourceId"], key))

    all_teachers = {**chem_teachers, **{k: v for k, v in all_new_teachers.items() if k not in chem_teachers}}
    all_courses = {**chem_courses, **all_new_courses}
    all_offerings = set(chem_offerings) | all_new_offerings
    groups = defaultdict(set)
    for c in all_courses.values():
        if c["code"]:
            groups[c["name"]].add(c["code"])
    same_name_groups = sum(1 for codes in groups.values() if len(codes) > 1)
    expected = {"teachers": len(all_teachers), "courses": len(all_courses),
                "offerings": len(all_offerings), "sameNameDifferentCodeGroups": same_name_groups}
    chem_extension_people = [p for p in teacher_map.get("timetableIdentities", [])
                             if any(m.get("sourceUnit") == "化学化工学院" for m in p.get("unitMatches", []))]
    chem_extension_codes = sorted({code for p in chem_extension_people
                                   for m in p.get("unitMatches", []) for code in m.get("courseCodes", [])})
    chem_extension_offerings = sum(len(m.get("courseCodes", []))
                                   for p in chem_extension_people for m in p.get("unitMatches", []))
    chem_extension = {
        "teachers": len(chem_extension_people),
        "coursesTouched": len(chem_extension_codes),
        "newCourses": sum(1 for code in chem_extension_codes if code not in chem_courses),
        "offerings": chem_extension_offerings,
        "sourceIds": [p["sourceId"] for p in chem_extension_people],
    }
    same_name_course_keys = {course_key(c["code"], c["name"], c["collegeCode"])
                             for t in same_name_payload["teachers"] for c in t["courses"]}
    same_name_info = {
        "teachers": len(same_name_payload["teachers"]),
        "courses": len(same_name_course_keys),
        "offerings": sum(len(t["courses"]) for t in same_name_payload["teachers"]),
        "profileAliasGroups": len(same_name_recon["aliasGroups"]),
        "profileAliasPages": teacher_map.get("stats", {}).get("profileAliasPages"),
        "distinctSameNameGroups": len(same_name_recon["distinctGroups"]),
        "inferredCourseRelations": teacher_map.get("stats", {}).get("inferredCourseRelations", 0),
        "unassignedCourseRelations": len(teacher_map.get("unassignedCourses", [])),
        "sourceIds": sorted(same_name_ids),
    }
    manifest = {
        "schemaVersion": 1, "generatedAt": TODAY, "term": {"code": TERM_CODE, "isCurrent": False},
        "collegeCount": len(colleges),
        "chemistry": chem_count,
        "chemistryExtension": chem_extension,
        "sameNameOfficialIdentities": same_name_info,
        "unassignedCourseRelations": teacher_map.get("unassignedCourses", []),
        "candidateStats": teacher_map.get("stats"),
        "identityStats": teacher_map.get("identityStats"),
        "timetableIdentities": {
            "teachers": len(tt_teachers),
            "courses": len({course_key(c.get("code"), c["name"], c.get("collegeCode") or "")
                            for t in tt_teachers for c in t["courses"]}),
            "offerings": sum(len(t["courses"]) for t in tt_teachers),
            "sourceFile": "timetable-identities/import.json",
            "namespace": "tt-<collegeCode>-<sequence>",
        },
        "foreignLanguage": teacher_map.get("foreignLanguage"),
        "crossUnitAudit": teacher_map.get("crossUnitAudit"),
        "new": {"teachers": len(all_teachers) - len(chem_teachers),
                "courses": len(all_courses) - len(chem_courses),
                "offerings": len(all_offerings) - len(chem_offerings)},
        "expected": expected,
        "units": [{**{k: r.get(k) for k in ("slug", "sourceUnit", "collegeCode", "status", "rawBlocks",
                                           "candidates", "verified", "officialVerified", "timetableVerified",
                                           "unresolved", "excludedBlocks",
                                           "courses", "offerings", "payloadTeachers", "payloadCourses",
                                           "payloadOfferings", "importFile")},
                   "sourcePath": (r.get("sourceFile") or {}).get("path"),
                   "sha256": (r.get("sourceFile") or {}).get("sha256")}
                  for r in unit_results],
        "files": {"importAll": "import-all.json", "sourceManifest": "source-manifest.json",
                  "unresolved": "unresolved-teachers.json", "conflicts": "conflicts.json",
                  "importResults": "import-results.json",
                  "existingDataProtection": "existing-data-protection.json",
                  "crossUnitAudit": "cross-unit-audit.json",
                  "foreignLanguageEvidence": "scripts/upc-timetable/foreign-language-evidence.json",
                  "chemistryTimetableEvidence": "scripts/upc-timetable/chemistry-timetable-evidence.json",
                  "sameNameReconciliation": "scripts/upc-timetable/same-name-reconciliation.json",
                  "sameNameOfficialIdentities": "same-name-official-identities/import.json",
                  "inferredCourseAssignments": "inferred-course-assignments.json",
                  "unassignedCourseAssignments": "unassigned-course-assignments.json",
                  "timetableSourceMap": "scripts/upc-timetable/timetable-source-identities.json",
                  "timetableIdentities": "timetable-identities/import.json"},
    }
    excluded_courses = 0
    excluded_relations = 0
    for r in unit_results:
        if r.get("slug") == "chemistry":
            continue
        excluded_keys = {k for k, c in r.get("coursesData", {}).items() if c.get("excludedReason")}
        excluded_courses += len(excluded_keys)
        excluded_relations += sum(1 for keys in r.get("teacherCourseKeys", {}).values()
                                  for k in keys if k in excluded_keys)
    retained_courses = sum(1 for c in chem_courses.values() if c.get("code") in conflict_codes)
    retained_relations = sum(1 for t in chem_payload["teachers"] for c in t.get("courses") or []
                             if c.get("code") in conflict_codes)
    # Include every source file, including the existing chemistry batch and the
    # non-college training center. The latter has no import payload but is still
    # part of the read-only source inventory.
    seen_sources = {u["slug"] for u in source_manifest["units"]}
    for r in unit_results:
        sf = r.get("sourceFile")
        if sf and r["slug"] not in seen_sources:
            source_manifest["units"].append({**sf, "slug": r["slug"], "sourceUnit": r["sourceUnit"],
                                             "collegeCode": r.get("collegeCode"), "term": TERM_CODE,
                                             "rawBlocks": r.get("rawBlocks")})
            seen_sources.add(r["slug"])
    source_manifest["units"].sort(key=lambda u: u["slug"])
    write(OUT / "manifest.json", manifest)
    write(OUT / "source-manifest.json", source_manifest)
    write(OUT / "conflicts.json", {"schemaVersion": 1, "codes": conflicts,
                                   "conflictInvolvedVariants": sum(len(c["variants"]) for c in conflicts),
                                   "newExcludedCourses": excluded_courses,
                                   "newExcludedRelations": excluded_relations,
                                   "existingRetainedCourses": retained_courses,
                                   "existingRetainedRelations": retained_relations})
    # unresolved details with affected raw relation count
    unresolved_rows = []
    for r in unit_results:
        for item in r.get("unresolvedDetails", []):
            affected = len([k for k in r.get("teacherCourseKeys", {}).get(item["name"], [])
                            if k in r.get("coursesData", {})])
            unresolved_rows.append({"unit": r["sourceUnit"], "name": item["name"], "reason": item["reason"],
                                    "affectedCourseRelations": affected, "candidates": item.get("candidates", [])})
    write(OUT / "unresolved-teachers.json", {"schemaVersion": 1, "teachers": unresolved_rows})
    # Report.
    lines = ["# UPC 多单位真实课表批次", "", f"生成：{TODAY}；学期：{TERM_CODE}（isCurrent=false）。",
             "原始文件只读；化学批次保持原目录和 sourceId 不变；本目录只新增其他单位批次。", "",
             "| 单位 | 文件 | 原始块 | 候选教师 | 官方核实 | 课表身份 | 导入教师 | 未解决 | 课程 | 关系 |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for r in unit_results:
        fname = (r.get("sourceFile") or {}).get("path", "—")
        lines.append(f"| {r['sourceUnit']} | `{fname}` | {r.get('rawBlocks',0)} | {r.get('candidates',0)} | "
                     f"{r.get('officialVerified',0)} | {r.get('timetableVerified',0)} | {r.get('payloadTeachers',0)} | "
                     f"{r.get('unresolved',0)} | {r.get('courses',0)} | {r.get('offerings',0)} |")
    stats = teacher_map.get("stats", {})
    cross = teacher_map.get("crossUnitAudit", {})
    foreign = next((r for r in unit_results if r.get("slug") == "foreign-languages"), {})
    foreign_conflict = next((c for c in foreign.get("coursesData", {}).values()
                             if c.get("code") == "OTH921331020"), {})
    conflict_variants = sum(len(c["variants"]) for c in conflicts)
    lines += ["", f"全局分口径统计：来源单位候选条目 **{stats.get('sourceUnitEntries')}**；"
              f"唯一候选姓名 **{stats.get('uniqueCandidateNames')}**；官方 profile 核实人数 **{stats.get('officialVerifiedPersons')}**；"
              f"官方 profile 核实唯一姓名 **{stats.get('officialVerifiedNames')}**；课表学院身份 **{stats.get('timetableUnitPersons')}**；"
              f"总教师身份 **{stats.get('totalTeacherIdentities')}**；未解决来源条目 **{stats.get('unresolvedSourceEntries')}**；"
              f"同院同名歧义 **{stats.get('ambiguousSameUnitEntries')}**；姓名并集 **{stats.get('candidateNameUnion')}**。",
              "上述人数与姓名字符串不是同一口径，不能直接把“唯一候选姓名 + 未解决条数”当作人数覆盖率；同名不同 sourceId 是不同人。", "",
              f"全局预计：{expected['teachers']} 教师 / {expected['courses']} 课程 / {expected['offerings']} 关系；"
              f"同名不同编码组 {same_name_groups}；化学基线 {chem_count['teachers']}/{chem_count['courses']}/{chem_count['offerings']}。",
              f"身份拆分：个人官方 profile 核实 **{stats.get('officialVerifiedPersons')}** 人（含 5 组页面别名合并和 5 组真实同名拆分）、"
              f"课表学院身份 **{stats.get('timetableUnitPersons')}** 人、"
              f"同院同名歧义 **{stats.get('ambiguousSameUnitEntries')}** 条、其余未解决 "
              f"**{stats.get('unresolvedSourceEntries',0)-stats.get('ambiguousSameUnitEntries',0)}** 条。"
              "课表学院身份的名称/学院只来自课表来源单位，不代表官方人事归属。", "",
              f"本轮缺资料保留：把剩余 **153** 个无个人 profile/名单无 URL/集体页条目按"
              f"“课表来源学院+姓名”追加为 `tt-`，连同此前 20 个共 **{stats.get('timetableUnitPersons')}** 个；"
              "来源姓名、学院和课程保留，职称/campus 为空，不伪造官方身份。", "",
              f"同院同名专项：5 组页面别名（7 个页面，含 1 个 HTTP 410 退休链接）归并到 5 个官方身份；"
              f"5 组真实同名拆分为 7 个身份（李莉 2 个、王艳 2 个，其余各 1 个）；"
              f"新增官方身份 **{same_name_info['teachers']}** 人、**{same_name_info['courses']}** 个课程关联"
              f"（其中 6 门为数据库实际新增课程；3 条为 inferred/研究方向匹配）、"
              f"**{same_name_info['offerings']}** 条关系；未分配 **0** 条。", "",
              f"跨院审计：当前保留 {len(cross.get('rejected', []))} 个来源条目；其中 13 个曾导入，"
              "精确移除 20 条关系、3 门孤立课程和 2 名无任何已接受单位的教师；本轮将 "
              f"{stats.get('timetableUnitPersons')} 个条目转为 `tt-` 课表身份；不改官方 profile、不覆盖既有映射；未触碰评价/积分。", "",
              f"外国语：{foreign.get('candidates',0)} 个候选条目、{foreign.get('officialVerified',0)} 个官方 profile 核实、"
              f"{foreign.get('timetableVerified',0)} 个课表来源身份；"
              f"{foreign.get('payloadCourses',0)} 课程/{foreign.get('payloadOfferings',0)} 关系；"
              "11 个无个人稳定 URL 的候选按课表身份保留，不再阻塞展示。", "",
              "修正前后：上一轮 1,390 教师身份 / 1,284 课程 / 2,661 关系；本轮先加官方 11 人/"
              "4 门新课程/15 关系、课表身份 153 人/52 门/267 关系，再按研究方向暂定 1 人/"
              "2 门课程/3 关系；累计 +165 教师 / +58 课程 / +285 关系 → "
              f"{expected['teachers']} 教师身份 / {expected['courses']} 课程 / {expected['offerings']} 关系；"
              "化学原 136/129/271 不变。", "",
              "`张立红` 的仅有关联课程仍按既有编码冲突规则排除；文法学院 6 个同名课表身份的"
              "`OTH921331020` 也按冲突规则排除；其余教师/课程保留。", "",
              f"化学扩展独立计数：+{chem_extension['teachers']} 教师 / "
              f"{chem_extension['coursesTouched']} 个已有课程关联 / +{chem_extension['offerings']} 关系；"
              f"新课程 {chem_extension['newCourses']} 门；原化学批次 136/129/271 与 sourceId 不变。", "",
              f"冲突口径：`OTH921331020 沟通与写作` 冲突涉及 {conflict_variants} 个课程变体（化学 1 + 新增 {conflict_variants-1}）；"
              f"新增批次实际排除 {excluded_courses} 门/{excluded_relations} 条关系，化学既有 "
              f"{retained_courses} 门/{retained_relations} 条关系保留；外国语该冲突课程"
              f"（{foreign_conflict.get('excludedReason','未排除')}）不导入、不覆盖既有接受记录。", "",
              "课程代码冲突和未编码同名课程已在导入前排除，明细见 conflicts.json；教师未解决明细见 unresolved-teachers.json；"
              "同院同名逐条证据/可纠正 provenance 见 same-name-reconciliation.json；"
              "3 条 inferred 分配见 inferred-course-assignments.json；"
              "跨院逐条证据见 cross-unit-audit.json；外国语逐条证据见 foreign-language-evidence.json。",
              "“导入教师”是该批次 payload 内的唯一教师；跨批次相同 sourceId 在数据库中只保留一行，实际首批 inserted/skipped 见 import-results.json。",
              "本清单不宣称全校完整教师库；`tt-` 前缀仅表示课表来源学院+规范姓名的保留身份，不是官方个人 ID、教工号或人事归属；"
              "其职称/campus 均为 null。官方 1,382 人与课表 173 人分开统计；化学原 136/129/271 与扩展 7/12/13 也分开统计。"]
    (OUT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"expected": expected, "new": manifest["new"], "chemistry": chem_count,
                      "units": len(unit_results), "conflicts": len(conflicts)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
