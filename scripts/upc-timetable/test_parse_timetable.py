import unittest
from pathlib import Path

from parse_timetable import (
    analyze,
    load_zip_xls,
    parse_course_block,
    read_workbook,
    signature,
    split_course_blocks,
    weekday_shift,
)

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "课表" / "化学化工学院"


def block(raw, weekday="星期一", teachers=None):
    parsed = parse_course_block(
        raw,
        file_label="test",
        source_path="test.xls",
        sheet="Sheet1",
        row=3,
        col=2,
        weekday=weekday,
        section="第一大节",
    )
    if teachers is not None:
        parsed["teachers"] = teachers
    return parsed


class ParserUnitTest(unittest.TestCase):
    def test_split_multiple_blocks_and_duplicate_export(self):
        text = (
            "CHM121711035化学工程基础\n史德青,刘相\n化学[2401-2402]班\n1周[01-02节]\n卓越B205\n\n"
            "SCC812212101物理化学(2-1)\n王创业\n本研化工2501班\n1-9周[01-02节]\n卓越A114"
        )
        blocks = split_course_blocks(text)
        self.assertEqual(len(blocks), 2)
        first = block(blocks[0])
        second = block(blocks[1])
        self.assertEqual(first["code"], "CHM121711035")
        self.assertEqual(first["teachers"], ["史德青", "刘相"])
        self.assertEqual(first["weeks"], "1周")
        self.assertEqual(first["periods"], "01-02节")
        self.assertEqual(second["code"], "SCC812212101")
        self.assertEqual(signature(first), signature(block(blocks[0])))
        self.assertNotEqual(signature(first), signature(second))

    def test_multi_teacher_and_blank_location_are_retained(self):
        parsed = block(
            "SCC811512100无机化学实验(2-1)\n王淑涛,王瑞\n应化2605班\n7-15周[10-11-12节]",
            weekday="星期四",
        )
        self.assertEqual(parsed["teachers"], ["王淑涛", "王瑞"])
        self.assertIsNone(parsed["location"])
        self.assertEqual(parsed["anomalies"], [])

    def test_missing_code_goes_to_anomaly_report(self):
        parsed = block("未编码课程\n张老师\n临班1\n1周[01-02节]\n卓越A101")
        self.assertIsNone(parsed["code"])
        self.assertEqual(parsed["name"], "未编码课程")
        self.assertIn("missing_or_unrecognized_course_code", parsed["anomalies"])

    def test_multicollege_course_code_formats(self):
        cases = [
            ("2092199初级汉语精读2-1\n齐卫华\n软工2601班\n2-18周[01-02节]", "2092199", "初级汉语精读2-1"),
            ("99CST226711030操作系统\n张晓东\n软工2601班\n1-9周[01-02节]", "99CST226711030", "操作系统"),
            ("GEO211721030Python程序设计\n张三\n地质2601班\n1-9周[01-02节]", "GEO211721030", "Python程序设计"),
            ("TRN022911040工程综合训练与创新（A）\n马建民\n材控2501班\n3周[01-02节]", "TRN022911040", "工程综合训练与创新（A）"),
        ]
        for raw, code, name in cases:
            parsed = block(raw)
            self.assertEqual(parsed["code"], code)
            self.assertEqual(parsed["name"], name)
            self.assertEqual(parsed["anomalies"], [])

    def test_weekday_shift_is_detected_without_loss(self):
        original = [block("CHM999999999课程\n张三\n临班1\n1周[01-02节]\nA101", "星期一")]
        zipped = [block("CHM999999999课程\n张三\n临班1\n1周[01-02节]\nA101", "星期日")]
        result = weekday_shift(original, zipped)
        self.assertEqual(result["zipShiftSignedDays"], -1)
        self.assertEqual(result["zipShiftDescription"], "提前 1 天")

    def test_dry_run_style_duplicate_signature_is_stable(self):
        a = block("CHM999999999课程\n张三\n临班1\n1周[01-02节]\nA101", "星期一")
        b = block("CHM999999999课程\n张三\n临班1\n1周[01-02节]\nA101", "星期三")
        self.assertEqual(signature(a), signature(b))


@unittest.skipUnless((SOURCE / "课表打印.xls").exists() and (SOURCE / "课表打印.zip").exists(),
                     "source timetable files are not present")
class SourceIntegrationTest(unittest.TestCase):
    def test_real_source_shape_and_export_comparison(self):
        original = read_workbook(SOURCE / "课表打印.xls", "original")
        zipped, member = load_zip_xls(SOURCE / "课表打印.zip")
        result = analyze(original, zipped)
        self.assertEqual(original["term"], "2026-2027-1")
        self.assertEqual(result["comparison"]["originalBlocks"], 715)
        self.assertEqual(result["comparison"]["zipBlocks"], 715)
        self.assertEqual(result["comparison"]["uniqueSignatures"], 627)
        self.assertTrue(result["comparison"]["sameSignatureMultiset"])
        self.assertEqual(result["comparison"]["weekday"]["zipShiftSignedDays"], -1)
        self.assertEqual(member["decodedName"], "化学化工学院.xls")
        self.assertEqual([sh["name"] for sh in original["sheets"]], ["Sheet4"])
        self.assertEqual([sh["name"] for sh in zipped["sheets"]], ["Sheet1", "Sheet2", "Sheet3"])


if __name__ == "__main__":
    unittest.main()
