import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNITS = ROOT / "scripts" / "upc-timetable" / "units.json"
TEACHERS = ROOT / "scripts" / "upc-timetable" / "official-teacher-map-all.json"
OUT = ROOT / "data" / "upc" / "timetables-2026-2027-1"


class MultiCollegeMapTest(unittest.TestCase):
    def test_units_map_to_dictionary_and_missing_inputs_are_explicit(self):
        config = json.loads(UNITS.read_text(encoding="utf-8"))
        colleges = json.loads((ROOT / "data" / "upc" / "colleges.json").read_text(encoding="utf-8"))["colleges"]
        codes = {c["code"] for c in colleges}
        units = {u["slug"]: u for u in config["units"]}
        self.assertEqual(len(units), 17)
        self.assertEqual(units["foreign-languages"]["xls"], "课表打印.xls")
        self.assertNotIn("status", units["foreign-languages"])
        self.assertEqual(units["engineering-training"]["collegeCode"], "upc-17")
        self.assertEqual({c["code"] for c in colleges if c["code"] == "upc-17"}, {"upc-17"})
        for unit in config["units"]:
            if unit.get("collegeCode") is not None:
                self.assertIn(unit["collegeCode"], codes)
        self.assertEqual({u["collegeCode"] for u in config["units"] if u.get("collegeCode")}, codes)

    def test_chemistry_ids_and_global_ids_are_unique(self):
        mapping = json.loads(TEACHERS.read_text(encoding="utf-8"))
        verified = mapping["verified"]
        ids = [r["sourceId"] for r in verified]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(mapping["chemistryPreserved"]["sourceIds"]), 136)
        self.assertEqual(set(mapping["chemistryPreserved"]["sourceIds"]), {
            r["sourceId"] for r in verified if r["sourceId"].startswith("cce-")
        })
        for row in verified:
            self.assertNotIn("/", row["sourceId"])
            self.assertLessEqual(len(row["sourceId"]), 120)
            self.assertIn(row["collegeCode"], {u["collegeCode"] for u in json.loads(UNITS.read_text(encoding="utf-8"))["units"] if u.get("collegeCode")})
            self.assertRegex(row["name"], r"^[\u4e00-\u9fff·]{2,8}$")
        self.assertEqual(mapping["unresolved"], [])
        self.assertEqual(len(mapping["unassignedCourses"]), 0)
        self.assertEqual(mapping["stats"]["inferredCourseRelations"], 3)

    def test_cross_unit_name_only_is_not_accepted(self):
        mapping = json.loads(TEACHERS.read_text(encoding="utf-8"))
        people = {p["sourceId"]: p for p in mapping["verified"]}
        unresolved = {(r["sourceUnit"], r["name"]): r for r in mapping["unresolved"]}
        tt = {(p["unitMatches"][0]["sourceUnit"], p["name"]): p for p in mapping["timetableIdentities"]}
        # Same unit official-list evidence remains accepted.
        self.assertIn("机电工程学院", [m["sourceUnit"] for m in people["cmee-c21433-a424321"]["unitMatches"]])
        # A cross-unit same-name candidate gets an independent timetable-unit ID,
        # never an official unit match on the other person's profile.
        for unit, sid in [("控制科学与工程学院", "cmee-c21433-a424321"),
                          ("石油工程学院", "sci-c6862-a96149"),
                          ("机电工程学院", "cj-c19292-a371002"),
                          ("文法学院", "cmee-c21434-a424781")]:
            name = people[sid]["name"]
            self.assertNotIn(unit, [m["sourceUnit"] for m in people[sid]["unitMatches"]])
            self.assertIn((unit, name), tt)
            self.assertTrue(tt[(unit, name)]["sourceId"].startswith("tt-"))
            self.assertIsNone(tt[(unit, name)]["profileUrl"])
            self.assertEqual(tt[(unit, name)]["identityType"], "timetable_unit_name")
        # An official profile cross-listed by two source units is accepted only
        # where the timetable actually has the candidate.
        self.assertIn("石油工程学院", [m["sourceUnit"] for m in
                      people["geori-c20541-a397076"]["unitMatches"]])
        self.assertEqual(mapping["stats"]["crossUnitNameOnlyRejected"], 15)
        self.assertEqual(mapping["stats"]["centerEvidenceOnlyUnresolved"], 4)
        center = [p for p in mapping["verified"] if p["collegeCode"] == "upc-17"]
        self.assertEqual(len(center), 8)
        self.assertEqual(len([p for p in mapping["timetableIdentities"]
                              if p["collegeCode"] == "upc-17"]), 5)
        self.assertEqual(mapping["unresolved"], [])
        self.assertEqual(mapping["foreignLanguage"]["candidateNames"], 100)
        self.assertEqual(mapping["foreignLanguage"]["profilePagesVerified"], 89)
        self.assertEqual(mapping["foreignLanguage"]["unresolved"], 11)
        self.assertEqual(mapping["foreignLanguage"]["rosterOnly"], 9)
        self.assertEqual(mapping["foreignLanguage"]["noOfficialProfile"], 2)
        foreign_tt = {(p["name"], p["unitMatches"][0]["sourceUnit"]) for p in mapping["timetableIdentities"]
                      if p["unitMatches"][0]["sourceUnit"] == "外国语学院"}
        self.assertEqual(len(foreign_tt), 11)
        self.assertIn(("张亮", "外国语学院"), foreign_tt)
        self.assertIn(("梅琳", "外国语学院"), foreign_tt)
        self.assertFalse(any(p["name"] == "梅琳" for p in mapping["verified"]))
        self.assertTrue(any(p["name"] == "马金芳" for p in mapping["verified"]))

    def test_same_name_timetable_identities_and_profile_alias_reconciliation(self):
        mapping = json.loads(TEACHERS.read_text(encoding="utf-8"))
        tt = mapping["timetableIdentities"]
        by_name = {(p["name"], p["unitMatches"][0]["sourceUnit"]): p for p in tt}
        self.assertEqual(len(tt), 173)
        # Existing IDs are fixed; adding 153 identities must not renumber them.
        self.assertEqual(by_name[("王静", "石油工程学院")]["sourceId"], "tt-upc-02-001")
        self.assertEqual(by_name[("赵学进", "控制科学与工程学院")]["sourceId"], "tt-upc-09-003")
        self.assertEqual(by_name[("孙道峰", "化学化工学院")]["sourceId"], "tt-upc-03-001")
        self.assertEqual(by_name[("张卫东", "化学化工学院")]["sourceId"], "tt-upc-03-002")
        self.assertEqual(by_name[("路帅", "化学化工学院")]["sourceId"], "tt-upc-03-007")
        self.assertIn(("刘相", "化学化工学院"), by_name)
        # Same name, different timetable units: independent IDs, no borrowed
        # official profile.
        wang = by_name[("王静", "石油工程学院")]
        self.assertTrue(wang["sourceId"].startswith("tt-upc-02-"))
        self.assertEqual(wang["identityType"], "timetable_unit_name")
        self.assertIsNone(wang["profileUrl"])
        self.assertTrue(any(p["name"] == "王静" and p["sourceId"].startswith("sci-")
                            for p in mapping["verified"]))
        self.assertNotEqual(wang["sourceId"],
                            next(p["sourceId"] for p in mapping["verified"] if p["name"] == "王静"))
        chem = json.loads((ROOT / "scripts" / "upc-timetable" / "chemistry-timetable-evidence.json").read_text(encoding="utf-8"))
        self.assertEqual(len(chem["entries"]), 2)
        self.assertTrue(all(e["localAmbiguity"] is False for e in chem["entries"]))
        self.assertEqual(mapping["chemistryPreserved"]["count"], 136)
        # Five alias groups are one official identity each; 7 pages (including
        # the HTTP 410 retired page) are retained as aliases, not teacher rows.
        verified = {p["sourceId"]: p for p in mapping["verified"]}
        self.assertEqual(verified["computer-c20895-a408817"]["aliasSourceIds"],
                         ["computer-c6287-a103926"])
        self.assertEqual(verified["ne-c15053-a345743"]["aliasSourceIds"],
                         ["ne-c15053-a213973"])
        self.assertEqual(verified["ne-c15052-a324969"]["aliasSourceIds"],
                         ["ne-c15052-a220424"])
        self.assertEqual(verified["ocean-c15434-a448604"]["aliasSourceIds"],
                         ["ocean-c15434-a224909"])
        self.assertEqual(verified["sci-c6755-a461574"]["aliasSourceIds"],
                         ["sci-c6944-a442865", "geori-c14558-a206193"])
        self.assertNotIn("computer-c6287-a103926", verified)
        self.assertNotIn("sci-c6944-a130742", verified)
        self.assertEqual(mapping["stats"]["profileAliasGroups"], 5)
        self.assertEqual(mapping["stats"]["profileAliasPages"], 7)
        # True same-name people are separate identities; only explicitly listed
        # main courses are attached.
        self.assertIn("geori-c10380-a151996", verified)
        self.assertNotIn("geori-c10378-a151863", verified)
        self.assertIn("cj-c19285-a370914", verified)
        self.assertNotIn("cj-c19287-a453350", verified)
        self.assertIn("cj-c19287-a370951", verified)
        self.assertNotIn("cj-c19284-a370895", verified)
        self.assertIn("ocean-c15435-a225012", verified)
        self.assertIn("ocean-c15436-a224962", verified)
        self.assertIn("sci-c6909-a96262", verified)
        self.assertIn("sci-c6933-a96030", verified)
        wang_yan = [p for p in mapping["verified"] if p["name"] == "王艳"]
        self.assertEqual({p["sourceId"] for p in wang_yan},
                         {"sci-c6909-a96262", "sci-c6933-a96030"})
        self.assertEqual(len(mapping["unassignedCourses"]), 0)
        self.assertEqual(mapping["stats"]["inferredCourseRelations"], 3)
        self.assertEqual(mapping["unresolved"], [])
        self.assertEqual(mapping["stats"]["profileAliasGroups"], 5)
        self.assertEqual(mapping["stats"]["distinctSameNameGroups"], 5)
        self.assertEqual(mapping["stats"]["unassignedCourseRelations"], 0)
        self.assertEqual(mapping["stats"]["inferredCourseRelations"], 3)
        # Existing accepted official mapping is not duplicated by the new rule.
        self.assertTrue(any(p["sourceId"] == "cmee-c21433-a424321" for p in mapping["verified"]))
        self.assertFalse(any(p["sourceId"] == "cmee-c21433-a424321" for p in tt))

    def test_manifest_and_every_unit_payload_are_consistent(self):
        manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["chemistry"]["teachers"], 136)
        self.assertEqual(manifest["chemistry"]["courses"], 129)
        self.assertEqual(manifest["chemistry"]["offerings"], 271)
        teacher_ids = set()
        course_keys = set()
        offering_keys = set()
        for unit in manifest["units"]:
            if not unit.get("importFile") or unit.get("status") != "active":
                continue
            payload = json.loads((OUT / "units" / unit["slug"] / "import.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["term"]["isCurrent"], False)
            ids = [t["sourceId"] for t in payload["teachers"]]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertEqual(len(payload["teachers"]), unit["payloadTeachers"])
            self.assertEqual(sum(len(t["courses"]) for t in payload["teachers"]), unit["payloadOfferings"])
            for teacher in payload["teachers"]:
                teacher_ids.add(teacher["sourceId"])
                for course in teacher["courses"]:
                    key = course.get("code") or f"name:{course['name']}|{course['collegeCode']}"
                    course_keys.add(key)
                    offering_keys.add((teacher["sourceId"], key))
        # The same-name increment is a separate explicit payload. Chemistry
        # extension courses already belong to the original chemistry baseline,
        # so they increase offerings but not the global "new course" count.
        tt_payload = json.loads((OUT / "timetable-identities" / "import.json").read_text(encoding="utf-8"))
        chem_payload = json.loads((ROOT / "data" / "upc" / "chemistry-2026-2027-1" / "import.json").read_text(encoding="utf-8"))
        chem_codes = {c.get("code") for t in chem_payload["teachers"] for c in t["courses"] if c.get("code")}
        for teacher in tt_payload["teachers"]:
            teacher_ids.add(teacher["sourceId"])
            for course in teacher["courses"]:
                key = course.get("code") or f"name:{course['name']}|{course['collegeCode']}"
                if course.get("code") not in chem_codes:
                    course_keys.add(key)
                offering_keys.add((teacher["sourceId"], key))
        self.assertEqual(len(teacher_ids), manifest["new"]["teachers"])
        self.assertEqual(len(course_keys), manifest["new"]["courses"])
        self.assertEqual(len(offering_keys), manifest["new"]["offerings"])
        self.assertEqual(manifest["expected"]["teachers"], 1555)
        self.assertEqual(manifest["expected"]["courses"], 1342)
        self.assertEqual(manifest["expected"]["offerings"], 2946)
        self.assertEqual(manifest["expected"]["sameNameDifferentCodeGroups"], 133)
        self.assertEqual(manifest["candidateStats"]["sourceUnitEntries"], 1553)
        self.assertEqual(manifest["candidateStats"]["uniqueCandidateNames"], 1510)
        self.assertEqual(manifest["candidateStats"]["verifiedPersons"], 1382)
        self.assertEqual(manifest["candidateStats"]["verifiedNames"], 1355)
        self.assertEqual(manifest["candidateStats"]["officialVerifiedPersons"], 1382)
        self.assertEqual(manifest["candidateStats"]["timetableUnitPersons"], 173)
        self.assertEqual(manifest["candidateStats"]["unresolvedSourceEntries"], 0)
        self.assertEqual(manifest["candidateStats"]["ambiguousSameUnitEntries"], 0)
        self.assertEqual(manifest["candidateStats"]["candidateNameUnion"], 1510)
        self.assertEqual(manifest["candidateStats"]["profileAliasGroups"], 5)
        self.assertEqual(manifest["candidateStats"]["distinctSameNameGroups"], 5)
        self.assertEqual(manifest["candidateStats"]["unassignedCourseRelations"], 0)
        self.assertEqual(manifest["candidateStats"]["inferredCourseRelations"], 3)
        self.assertEqual(manifest["chemistry"]["teachers"], 136)
        self.assertEqual(manifest["chemistry"]["courses"], 129)
        self.assertEqual(manifest["chemistry"]["offerings"], 271)
        self.assertEqual(manifest["chemistryExtension"]["teachers"], 7)
        self.assertEqual(manifest["chemistryExtension"]["coursesTouched"], 12)
        self.assertEqual(manifest["chemistryExtension"]["newCourses"], 0)
        self.assertEqual(manifest["chemistryExtension"]["offerings"], 13)
        self.assertEqual(manifest["sameNameOfficialIdentities"]["teachers"], 12)
        self.assertEqual(manifest["sameNameOfficialIdentities"]["courses"], 18)
        self.assertEqual(manifest["sameNameOfficialIdentities"]["offerings"], 18)
        foreign = [u for u in manifest["units"] if u["slug"] == "foreign-languages"][0]
        self.assertEqual((foreign["candidates"], foreign["officialVerified"],
                          foreign["timetableVerified"], foreign["unresolved"]), (100, 89, 11, 0))
        self.assertEqual((foreign["courses"], foreign["offerings"]), (88, 207))
        self.assertEqual(manifest["candidateStats"]["nameOverlapVerifiedUnresolved"], 0)


if __name__ == "__main__":
    unittest.main()
