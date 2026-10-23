#!/usr/bin/env python3
"""Build the official teacher map with per-unit evidence.

A teacher is accepted for a timetable unit only when the official profile index
lists that person under that same unit (including an official cross-listed
profile).  A globally unique name is not sufficient for a cross-unit course;
such candidates remain unresolved for that unit.

Chemistry's existing 136 verified sourceIds are preserved unchanged.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from parse_timetable import read_workbook

ROOT = Path(__file__).resolve().parents[2]
UNITS = ROOT / "scripts" / "upc-timetable" / "units.json"
INDEX = ROOT / "scripts" / "upc-timetable" / "official-profiles-index.json"
CHEM_MAP = ROOT / "scripts" / "upc-timetable" / "official-teacher-map.json"
OUT = ROOT / "scripts" / "upc-timetable" / "official-teacher-map-all.json"
TT_MAP = ROOT / "scripts" / "upc-timetable" / "timetable-source-identities.json"
SOURCE_ROOT = ROOT / "课表"
NAME_RE = re.compile(r"^[\u4e00-\u9fff·]{2,8}$")
TERM = "2026-2027-1"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def norm_name(value: str) -> str:
    value = (value or "").replace("\u3000", " ").replace(" ", "").strip()
    return re.sub(r"[（(](?:兼职|外院|院士)[）)]$", "", value)


def course_key(code: str | None, name: str, college: str) -> str:
    return code or f"name:{re.sub(r'\s+', '', name)}|{college}"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    config = load(UNITS)
    colleges = {c["code"]: c for c in load(ROOT / "data" / "upc" / "colleges.json")["colleges"]}
    index = load(INDEX)["profiles"]
    chem = load(CHEM_MAP)
    center_evidence = load(ROOT / "scripts" / "upc-timetable" / "training-center-evidence.json")
    center_pages = center_evidence.get("centerPages", {})
    center_no_evidence = set(center_evidence.get("noEvidence", []))
    foreign_evidence = load(ROOT / "scripts" / "upc-timetable" / "foreign-language-evidence.json")
    foreign_gaps = {x["name"]: x for x in foreign_evidence.get("unresolved", [])}
    same_name = load(ROOT / "scripts" / "upc-timetable" / "same-name-reconciliation.json")
    source_unit_meta = {u["sourceDir"]: u for u in config["units"]}
    unit_meta = {u["sourceUnitName"]: u for u in config["units"]}

    # Profile pages can be aliases of one person (republished pages, old/new
    # titles, dead links).  Only the canonical record participates in identity
    # matching; alias URLs are retained on the canonical record.
    canonical_index = [dict(p) for p in index if not p.get("isAlias")]
    alias_pages = sum(1 for p in index if p.get("isAlias"))
    profiles_by_name: dict[str, list[dict]] = defaultdict(list)
    for p in canonical_index:
        p.setdefault("aliases", [])
        p["aliases"] = [{"sourceId": sid, "url": url}
                        for sid, url in zip(p.get("aliasSourceIds", []), p.get("aliasUrls", []))]
        profiles_by_name[p["name"]].append(p)
    for rows in profiles_by_name.values():
        rows.sort(key=lambda p: p["sourceId"])

    profile_by_id = {p["sourceId"]: p for p in canonical_index}
    manual_by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    unassigned_courses: list[dict] = []
    for group in same_name.get("distinctGroups", []):
        key = (group["sourceUnit"], group["name"])
        combined_assignments = list(group.get("assigned", []))
        for assignment in group.get("inferredAssignments", []):
            combined_assignments.append(assignment)
        for assignment in combined_assignments:
            source_id = assignment["sourceId"]
            profile = profile_by_id.get(source_id)
            if not profile:
                raise SystemExit(f"missing distinct-person profile: {source_id}")
            entries = manual_by_key[key]
            entry = next((x for x in entries if x["sourceId"] == source_id), None)
            if entry is None:
                entry = {
                    "sourceId": source_id,
                    "name": group["name"],
                    "title": profile.get("title"),
                    "collegeCode": profile.get("unit"),
                    "profileUrl": profile.get("profileUrl"),
                    "profileKind": "official_profile",
                    "identityType": "official_profile",
                    "assignedCourseCodes": [],
                    "sameNameEvidence": {
                        "relation": group.get("relation"),
                        "profiles": group.get("profiles"),
                        "decision": group.get("decision"),
                    },
                    "courseProvenance": [],
                }
                entries.append(entry)
            entry["assignedCourseCodes"] = sorted(set(entry["assignedCourseCodes"])
                                                      | set(assignment.get("courseCodes", [])))
            entry["courseProvenance"].append({
                "courseCodes": sorted(assignment.get("courseCodes", [])),
                "method": assignment.get("method", "official_main_course"),
                "confidence": assignment.get("confidence", "high"),
                "officialConfirmation": assignment.get("officialConfirmation", True),
                "correctable": assignment.get("correctable", False),
                "basis": assignment.get("basis", []),
                "evidence": assignment.get("evidence"),
                "alternativeSourceId": assignment.get("alternativeSourceId"),
            })
        for item in group.get("unassigned", []):
            unassigned_courses.append({
                "sourceUnit": group["sourceUnit"],
                "name": group["name"],
                "code": item["code"],
                "courseName": item["name"],
                "reason": item["reason"],
            })

    candidates: dict[str, list[str]] = {}
    teacher_relations: dict[tuple[str, str], set[str]] = defaultdict(set)
    raw_names: dict[tuple[str, str], set[str]] = defaultdict(set)
    source_meta: dict[str, dict] = {}
    for unit in config["units"]:
        slug, source_dir = unit["slug"], unit["sourceDir"]
        names: set[str] = set()
        if unit.get("xls"):
            xls = SOURCE_ROOT / source_dir / unit["xls"]
            if xls.exists():
                source_meta[source_dir] = {
                    "path": xls.relative_to(ROOT).as_posix(),
                    "sha256": hashlib.sha256(xls.read_bytes()).hexdigest(),
                }
                wb = read_workbook(xls, "original")
                if wb.get("term") != TERM:
                    raise SystemExit(f"term mismatch for {source_dir}: {wb.get('term')}")
                for sh in wb["sheets"]:
                    for block in sh["blocks"]:
                        code, cname = block.get("code"), (block.get("name") or "").strip()
                        for raw in block.get("teachers", []):
                            n = norm_name(raw)
                            if not NAME_RE.fullmatch(n):
                                continue
                            names.add(n)
                            raw_names[(source_dir, n)].add(raw.strip())
                            if code or cname:
                                teacher_relations[(source_dir, n)].add(course_key(code, cname, unit.get("collegeCode") or ""))
        candidates[source_dir] = sorted(names)

    people: dict[str, dict] = {}
    unresolved: list[dict] = []
    rejected_cross: list[dict] = []
    accepted_matches = 0

    def add_unresolved(source_dir: str, name: str, reason: str, candidate_profiles=()):
        unit = source_unit_meta[source_dir]
        unresolved.append({
            "sourceUnit": source_dir,
            "sourceUnitName": unit["sourceUnitName"],
            "name": name,
            "reason": reason,
            "candidateProfiles": list(candidate_profiles),
            "courseCodes": sorted({r.split("|")[0] if not r.startswith("name:") else r.split("|")[0][5:]
                                   for r in teacher_relations.get((source_dir, name), set())}),
            "relationCount": len(teacher_relations.get((source_dir, name), set())),
        })
        if candidate_profiles and source_dir != "外国语学院":
            rejected_cross.append({
                "sourceUnit": source_dir, "sourceUnitName": unit["sourceUnitName"],
                "name": name, "reason": reason, "candidateProfiles": list(candidate_profiles),
                "courseCodes": sorted({r for r in teacher_relations.get((source_dir, name), set())}),
            })

    # Chemistry is authoritative; do not re-derive its existing identities.
    for rec in chem["verified"]:
        name = norm_name(rec["name"])
        p = people.setdefault(rec["sourceId"], {
            "name": name, "title": rec.get("title"), "sourceId": rec["sourceId"],
            "collegeCode": rec.get("collegeCode") or "upc-03",
            "profileUrl": rec.get("profileUrl"), "profileKind": rec.get("profileKind"),
            "status": "verified_official_profile", "unitMatches": [],
        })
        p["unitMatches"].append({
            "sourceUnit": "化学化工学院", "sourceUnitName": "化学化工学院",
            "accepted": True, "reason": "existing_chemistry_verified_map",
            "evidence": {"profileUrl": rec.get("profileUrl"), "source": "official-teacher-map.json"},
            "courseCodes": sorted(teacher_relations.get(("化学化工学院", name), set())),
        })
        accepted_matches += 1
    for rec in chem["unresolved"]:
        add_unresolved("化学化工学院", norm_name(rec["name"]), rec.get("reason") or "existing_chemistry_unresolved")

    for source_dir, names in candidates.items():
        if source_dir == "化学化工学院":
            continue
        unit = source_unit_meta[source_dir]
        for name in names:
            manual = manual_by_key.get((source_dir, name))
            if manual:
                for matched in manual:
                    person = people.setdefault(matched["sourceId"], {
                        "name": name, "title": matched.get("title"), "sourceId": matched["sourceId"],
                        "collegeCode": unit["collegeCode"], "profileUrl": matched.get("profileUrl"),
                        "profileKind": matched.get("profileKind"),
                        "status": "verified_official_profile", "unitMatches": [],
                    })
                    person["unitMatches"].append({
                        "sourceUnit": source_dir, "sourceUnitName": unit["sourceUnitName"],
                        "accepted": True, "reason": "official_same_unit_course_assignment",
                        "evidence": {
                            "profileUrl": matched.get("profileUrl"),
                            "sourceId": matched["sourceId"],
                            "sameNameEvidence": matched.get("sameNameEvidence"),
                            "courseProvenance": matched.get("courseProvenance"),
                        },
                        "courseCodes": matched.get("assignedCourseCodes", []),
                    })
                    accepted_matches += 1
                continue
            local = [p for p in profiles_by_name.get(name, []) if source_dir in p["listedUnits"]]
            all_named = profiles_by_name.get(name, [])
            if len(local) == 1:
                p = local[0]
                pcode = (source_unit_meta.get(p["unit"]) or unit_meta.get(p["unit"]) or {}).get("collegeCode")
                if not pcode:
                    add_unresolved(source_dir, name, "official_profile_has_no_college_mapping",
                                   [{"sourceId": p["sourceId"], "profileUrl": p["profileUrl"], "unit": p["unit"]}])
                    continue
                person = people.setdefault(p["sourceId"], {
                    "name": name, "title": p.get("title"), "sourceId": p["sourceId"],
                    "collegeCode": pcode, "profileUrl": p["profileUrl"], "profileKind": p.get("profileKind"),
                    "status": "verified_official_profile", "unitMatches": [],
                })
                if person["name"] != name:
                    raise SystemExit(f"sourceId/name conflict {p['sourceId']}")
                if p.get("profileKind") == "official_center_page":
                    reason = "official_center_page_teacher_evidence"
                elif p.get("aliasSourceIds"):
                    reason = "official_profile_alias_merged"
                else:
                    reason = ("official_same_unit_profile" if p["unit"] == source_dir
                              else "official_profile_cross_listed_same_identity")
                if p.get("aliasSourceIds"):
                    person["aliasSourceIds"] = p.get("aliasSourceIds")
                    person["aliasUrls"] = p.get("aliasUrls")
                person["unitMatches"].append({
                    "sourceUnit": source_dir, "sourceUnitName": unit["sourceUnitName"],
                    "accepted": True, "reason": reason,
                    "evidence": {"profileUrl": p["profileUrl"], "listUrl": p.get("listUrl"),
                                 "listedUnits": p["listedUnits"], "sourceId": p["sourceId"],
                                 "aliasSourceIds": p.get("aliasSourceIds", []),
                                 "aliasUrls": p.get("aliasUrls", [])},
                    "courseCodes": sorted(teacher_relations.get((source_dir, name), set())),
                })
                accepted_matches += 1
            elif len(local) > 1:
                add_unresolved(source_dir, name, "multiple_official_profiles_in_source_unit",
                               [{"sourceId": p["sourceId"], "profileUrl": p["profileUrl"], "unit": p["unit"]}
                                for p in local])
            else:
                if len(all_named) == 1:
                    reason = "cross_unit_name_only_not_accepted"
                elif len(all_named) > 1:
                    reason = "multiple_global_official_profiles"
                else:
                    reason = "no_official_profile_found"
                candidate_profiles = [
                    {"sourceId": p["sourceId"], "profileUrl": p["profileUrl"],
                     "unit": p["unit"], "listedUnits": p["listedUnits"]} for p in all_named
                ]
                # The foreign-language roster is local official evidence even when
                # no individual profile URL exists; never borrow a same-name
                # profile from another unit.
                if source_dir == "外国语学院" and name in foreign_gaps:
                    gap = foreign_gaps[name]
                    reason = gap["reason"]
                    candidate_profiles = [{
                        "sourceId": None, "profileUrl": gap.get("rosterUrl"),
                        "stableIndividualId": False, "unit": "外国语学院",
                        "department": gap.get("department"), "title": gap.get("title"),
                    }]
                if source_dir == "石油工业训练中心" and not candidate_profiles:
                    if name in center_pages:
                        reason = "official_center_page_mentions_name_but_no_stable_individual_source_id"
                        candidate_profiles = [{"sourceId": None, "profileUrl": center_pages[name],
                                               "stableIndividualId": False, "unit": "石油工业训练中心"}]
                    elif name in center_no_evidence:
                        reason = "no_official_center_evidence_found"
                if source_dir == "外国语学院" and not candidate_profiles:
                    gap = foreign_gaps.get(name)
                    if gap:
                        reason = gap["reason"]
                        candidate_profiles = [{
                            "sourceId": None, "profileUrl": gap.get("rosterUrl"),
                            "stableIndividualId": False, "unit": "外国语学院",
                            "department": gap.get("department"), "title": gap.get("title"),
                        }]
                add_unresolved(source_dir, name, reason, candidate_profiles)

    verified = sorted(people.values(), key=lambda p: p["sourceId"])
    for p in verified:
        p["unitMatches"].sort(key=lambda m: m["sourceUnit"])
    unresolved.sort(key=lambda x: (x["sourceUnit"], x["name"]))
    official_names = {p["name"] for p in verified}

    # Students identify a teacher by the timetable's course and source unit.
    # Once the 10 same-name groups have been reconciled above, every remaining
    # unresolved name is retained as an independent timetable-source identity.
    targets = list(unresolved)

    tt_path = TT_MAP
    tt = load(tt_path) if tt_path.exists() else {"schemaVersion": 1, "entries": []}
    tt_entries = { (e["sourceUnit"], e["name"]): e for e in tt.get("entries", []) }
    seqs = defaultdict(int)
    for e in tt.get("entries", []):
        m = re.fullmatch(r"tt-(upc-\d+)-(\d+)", e["sourceId"])
        if m:
            seqs[m.group(1)] = max(seqs[m.group(1)], int(m.group(2)))
    timetable_people = []
    for r in sorted(targets, key=lambda x: (source_unit_meta[x["sourceUnit"]].get("collegeCode") or "", x["name"])):
        source_dir, name = r["sourceUnit"], r["name"]
        unit = source_unit_meta[source_dir]
        college_code = unit.get("collegeCode")
        if not college_code:
            continue
        key = (source_dir, name)
        rec = tt_entries.get(key)
        if rec is None:
            seqs[college_code] += 1
            sid = f"tt-{college_code}-{seqs[college_code]:03d}"
            rec = {
                "sourceId": sid, "sourceUnit": source_dir, "sourceUnitName": unit["sourceUnitName"],
                "collegeCode": college_code, "name": name,
                "rawNames": sorted(raw_names.get(key, {name})),
                "sourceFile": source_meta.get(source_dir, {}).get("path"),
                "sourceSha256": source_meta.get(source_dir, {}).get("sha256"),
                "identityType": "timetable_unit_name",
            }
            tt_entries[key] = rec
            tt.setdefault("entries", []).append(rec)
        if rec["sourceId"] in {p["sourceId"] for p in verified} | {p["sourceId"] for p in timetable_people}:
            raise SystemExit(f"timetable sourceId collision: {rec['sourceId']}")
        person = {
            "name": name, "title": None, "sourceId": rec["sourceId"],
            "collegeCode": college_code, "profileUrl": None, "profileKind": "timetable_unit_name",
            "status": "timetable_unit_identity", "identityType": "timetable_unit_name",
            "unitMatches": [{
                "sourceUnit": source_dir, "sourceUnitName": unit["sourceUnitName"],
                "accepted": True, "reason": "timetable_unit_name_same_name_preserved",
                "evidence": {
                    "timetableUnit": source_dir, "sourceFile": rec.get("sourceFile"),
                    "sourceSha256": rec.get("sourceSha256"), "rawNames": rec.get("rawNames"),
                    "identityType": "timetable_unit_name",
                },
                "courseCodes": r.get("courseCodes", []),
            }],
        }
        timetable_people.append(person)
        for audit in rejected_cross:
            if audit["sourceUnit"] == source_dir and audit["name"] == name:
                audit["resolution"] = "timetable_unit_identity"
                audit["sourceId"] = rec["sourceId"]
        unresolved.remove(r)
    tt["entries"].sort(key=lambda e: (e.get("collegeCode"), e["name"]))
    tt_path.write_text(json.dumps(tt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    timetable_names = {p["name"] for p in timetable_people}
    unresolved_names = {r["name"] for r in unresolved}
    ambiguous = [r for r in unresolved if r["reason"] == "multiple_official_profiles_in_source_unit"]
    source_entries = sum(len(v) for v in candidates.values())
    unique_candidates = len({n for v in candidates.values() for n in v})
    stats = {
        "sourceUnitEntries": source_entries,
        "uniqueCandidateNames": unique_candidates,
        "verifiedPersons": len(verified),
        "verifiedNames": len(official_names),
        "officialVerifiedPersons": len(verified),
        "officialVerifiedNames": len(official_names),
        "timetableUnitPersons": len(timetable_people),
        "timetableUnitNames": len(timetable_names),
        "timetableUnitSourceEntries": len(timetable_people),
        "totalTeacherIdentities": len(verified) + len(timetable_people),
        "totalTeacherNames": len(official_names | timetable_names),
        "acceptedSourceUnitMatches": accepted_matches + len(timetable_people),
        "unresolvedSourceEntries": len(unresolved),
        "unresolvedUniqueNames": len(unresolved_names),
        "nameOverlapVerifiedUnresolved": len(official_names & unresolved_names),
        "nameOverlapTimetableUnresolved": len(timetable_names & unresolved_names),
        "ambiguousSameUnitEntries": len(ambiguous),
        "ambiguousSameUnitNames": len({r["name"] for r in ambiguous}),
        "candidateNameUnion": len(official_names | timetable_names | unresolved_names),
        "crossUnitNameOnlyRejected": sum(1 for r in rejected_cross if r["reason"] == "cross_unit_name_only_not_accepted"),
        "centerEvidenceOnlyUnresolved": sum(1 for r in rejected_cross if r["sourceUnit"] == "石油工业训练中心"),
        "profileAliasGroups": len(same_name.get("aliasGroups", [])),
        "profileAliasPages": alias_pages,
        "distinctSameNameGroups": len(same_name.get("distinctGroups", [])),
        "unassignedCourseRelations": len(unassigned_courses),
        "inferredCourseRelations": sum(
            len(a.get("courseCodes", []))
            for group in same_name.get("distinctGroups", [])
            for a in group.get("inferredAssignments", [])
            if not a.get("officialConfirmation", False)
        ),
    }
    out = {
        "schemaVersion": 2,
        "generatedAt": "2026-10-23",
        "term": TERM,
        "method": "official per-source-unit evidence for official profiles; same-name timetable-unit identities use the tt- namespace and never borrow an official profile",
        "stats": stats,
        "identityStats": {
            "officialProfilePersons": len(verified),
            "timetableUnitPersons": len(timetable_people),
            "ambiguousSameUnitEntries": len(ambiguous),
            "unresolvedOtherEntries": len(unresolved) - len(ambiguous),
            "totalTeacherIdentities": len(verified) + len(timetable_people),
            "profileAliasGroups": len(same_name.get("aliasGroups", [])),
            "profileAliasPages": alias_pages,
            "distinctSameNameGroups": len(same_name.get("distinctGroups", [])),
            "unassignedCourseRelations": len(unassigned_courses),
            "inferredCourseRelations": sum(
                len(a.get("courseCodes", []))
                for group in same_name.get("distinctGroups", [])
                for a in group.get("inferredAssignments", [])
                if not a.get("officialConfirmation", False)
            ),
        },
        "sameNameReconciliation": "scripts/upc-timetable/same-name-reconciliation.json",
        "unassignedCourses": unassigned_courses,
        "foreignLanguage": {
            "rosterNames": foreign_evidence.get("rosterNames"),
            "candidateNames": foreign_evidence.get("candidateNames"),
            "profilePagesVerified": foreign_evidence.get("profilePagesVerified"),
            "unresolved": len(foreign_evidence.get("unresolved", [])),
            "rosterOnly": sum(1 for x in foreign_evidence.get("unresolved", [])
                              if x.get("reason") == "official_roster_name_but_no_stable_profile_url"),
            "noOfficialProfile": sum(1 for x in foreign_evidence.get("unresolved", [])
                                     if x.get("reason") == "no_official_foreign_profile"),
            "source": foreign_evidence.get("rosterUrl"),
            "xlsSha256": foreign_evidence.get("xlsSha256"),
        },
        "crossUnitAudit": {
            "acceptedMultiUnitPersons": [
                {"name": p["name"], "sourceId": p["sourceId"],
                 "units": [m["sourceUnit"] for m in p["unitMatches"] if m["accepted"]],
                 "reasons": [m["reason"] for m in p["unitMatches"] if m["accepted"]]}
                for p in verified if len([m for m in p["unitMatches"] if m["accepted"]]) > 1
            ],
            "timetableUnitConversions": [
                {"name": p["name"], "sourceId": p["sourceId"],
                 "sourceUnit": p["unitMatches"][0]["sourceUnit"],
                 "reason": p["unitMatches"][0]["reason"]}
                for p in timetable_people
            ],
            "rejected": rejected_cross,
        },
        "verified": verified,
        "timetableIdentities": timetable_people,
        "unresolved": unresolved,
        "chemistryPreserved": {
            "sourceIds": [r["sourceId"] for r in chem["verified"]],
            "count": len(chem["verified"]),
        },
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "data" / "upc" / "timetables-2026-2027-1" / "unassigned-course-assignments.json").write_text(
        json.dumps({
            "schemaVersion": 1,
            "generatedAt": "2026-10-23",
            "reason": "same-name official profiles exist, but no reliable explicit main-course match",
            "entries": unassigned_courses,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    inferred_entries = []
    for group in same_name.get("distinctGroups", []):
        for assignment in group.get("inferredAssignments", []):
            inferred_entries.append({
                "sourceUnit": group["sourceUnit"],
                "name": group["name"],
                "sourceId": assignment["sourceId"],
                "courseCodes": assignment.get("courseCodes", []),
                "method": assignment.get("method"),
                "confidence": assignment.get("confidence"),
                "officialConfirmation": assignment.get("officialConfirmation", False),
                "correctable": assignment.get("correctable", True),
                "basis": assignment.get("basis", []),
                "evidence": assignment.get("evidence"),
                "alternativeSourceId": assignment.get("alternativeSourceId"),
            })
    (ROOT / "data" / "upc" / "timetables-2026-2027-1" / "inferred-course-assignments.json").write_text(
        json.dumps({
            "schemaVersion": 1,
            "generatedAt": "2026-10-23",
            "policy": same_name.get("inferencePolicy"),
            "entries": inferred_entries,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print("rejected cross-unit:", ", ".join(f"{r['sourceUnitName']}/{r['name']}" for r in rejected_cross))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
