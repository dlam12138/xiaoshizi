# UPC 课表解析

本目录包含可重复运行的 `.xls` 课表网格解析器、化学化工学院 2026-2027-1 数据生成器，
以及 14 个新增学院 + 石油工业训练中心的多学院生成器。原件只读，解析不修改
`课表/` 下任何文件。

## 安装

```powershell
python -m pip install -r scripts/upc-timetable/requirements.txt
```

只依赖 `xlrd`（BIFF8 `.xls`）。不需要 Java、LibreOffice 或网络。

## 运行

```powershell
# 生成 data/upc/chemistry-2026-2027-1/ 下全部交付文件
python scripts/upc-timetable/build_chemistry_dataset.py

# 从官方 profile 索引生成按来源单位逐条证据的教师身份 map
python scripts/upc-timetable/build_teacher_map.py
# 或 npm run data:teacher-map

# 生成 14 个新增学院 + 训练中心批次与全局 manifest
python scripts/upc-timetable/build_all_colleges.py
# 或 npm run data:all-colleges

# 只做原始文件解析与两种导出对比，输出诊断 JSON
python scripts/upc-timetable/parse_timetable.py `
  --xls "课表/化学化工学院/课表打印.xls" `
  --zip "课表/化学化工学院/课表打印.zip" `
  --output data/upc/chemistry-2026-2027-1/raw-parse.json

# 解析器回归测试（含真实原件的结构与双导出对比）
python -m unittest discover -s scripts/upc-timetable -p 'test_*.py' -v
```

## 解析规则

- 读取全部工作表，包括空表；空表写入来源清单。
- 以“星期日…星期六”表头定位星期列；每个单元格按空行拆成多个课程块。
- 课程块首行支持三类正式编码：`3–4 位字母 + 9 位数字`（如 `GEO211721030`）、
  `2 位数字 + 3 位字母 + 9 位数字`（如 `99CST226711030`）、`7 位数字`
  （如 `2092199`），后面可跟中英文课程名。无法识别编码的块进入异常清单，
  不会被误当成“无编码课程”。
- 第二行按中英文逗号/顿号拆教师；保留多人授课。
- 后续行保留班级、周次、节次、地点原文；没有地点不视为异常（实验课常见）。
- 同一课程块签名（编码、名称、教师集合、班级、周次、节次、地点）只计一次关
  系，但所有原始出现位置都保留在 `normalized-course-blocks.json`。
- 原始导出与 ZIP 导出签名多重集必须一致；ZIP 的星期列存在整体错位时只记录，
  不据此改课程关系。

## 数据/身份

- `official-teacher-map.json`：化学官方教师列表 + 个人详情页核实的 136 名教师，
  以及 7 名待映射教师；保持既有 sourceId 不变。
- `official-profiles-index.json`：官方教师列表/个人页/CV 的 canonical 索引
  （1,747 条记录），保留 `listedUnits` 证据和镜像 URL；不执行网络请求。
- `official-teacher-map-all.json`：按“来源单位 + 姓名”逐条判定的结果。官方身份只有
  本单位官方列表/个人页有唯一 profile（或同一 profile 被来源单位官方列表交叉列出）
  才通过；**全局唯一同名不自动通过**。全局 1,382 个官方 profile sourceId、1,355 个
  官方核实唯一姓名、173 个 `tt-` 课表学院身份（总 1,555；其中化学扩展 7 个）；
  1,553 个来源条目、1,510 个唯一候选姓名、0 个未解决教师身份。
  每条 `unitMatches` 保留 sourceUnit、reason、evidence 和 courseCodes。
- `timetable-source-identities.json`：用于无个人 profile/集体页条目及跨院同名条目
  的稳定追加 `tt-<collegeCode>-<sequence>` 稳定 ID；保存来源学院、规范姓名、原始姓名、
  来源 XLS 和哈希。它是独立的课表来源身份命名空间，不是官方个人 ID/教工号，
  不借用其他学院 profile，也不猜职称/campus。
- `foreign-language-evidence.json`：外国语教师队伍页/系部个人 profile 的 89 个
  sourceId，以及 9 个仅有教师队伍页、2 个无官方教师队伍证据的条目（均已按课表身份保留）。
- `chemistry-timetable-evidence.json`：化学 136/129/271 基线之外的 2 个特殊同名课表
  扩展（孙道峰、张卫东）；记录两人在化学无本地 profile、在其他学院各有唯一同名
  profile（不借用），以及原 sourceId/批次不变的边界。其余 5 名化学无 profile 教师
  在 `timetable-identities/import.json` 中保留为 `tt-upc-03-003..007`。
- `same-name-reconciliation.json`：5 组页面别名（含 HTTP 410 退休链接）和 5 组真实
  同名的逐条证据、canonical sourceId、主讲课程分配与 inferred 可纠正依据。
- `unassigned-course-assignments.json`：3 条无法从官方明确主讲课程匹配到具体身份
  的课程关系，保留课程级歧义。
- `units.json`：16 个学院 + 独立教学单位训练中心 `upc-17` 的映射；
  外国语学院已有 `课表打印.xls` 并纳入。`training-center-evidence.json` 保存中心
  官方页面、8 名可验证教师证据和 5 名未解决原因；`foreign-language-evidence.json`
  保存外国语 89 个个人 profile 和 11 个未解决原因。
- 不保存邮箱、电话等个人联系方式。
- `data/upc/chemistry-2026-2027-1/config.json` 的 `markAsCurrent` 必须显式设置，
  当前为 `false`；所有批次学期编码取自文件标题，不按当前日期猜测。

## 输出

| 文件 | 内容 |
| --- | --- |
| `source-manifest.json` | 文件哈希、ZIP 成员、工作表/合并单元格、双导出对比 |
| `raw-blocks.json` | 两个导出的全部原始课程块及单元格定位 |
| `normalized-course-blocks.json` | 去重后的 627 个课程块及全部出现位置 |
| `courses.json` | 129 门课程、同名不同编码组 |
| `teacher-candidates.json` | 143 名教师候选、课程和核实状态 |
| `teacher-mapping-template.csv` | 教师映射模板/待核实名单 |
| `unresolved-teachers.json` | 7 名待映射教师及所缺信息 |
| `anomalies.json` | 解析异常、重复、星期错位、无地点等 |
| `import.json` | 仅含已核实教师和关系的导入文件 |
| `report.md` | 汇总报告 |

统计口径：`sourceUnitEntries` 不是唯一姓名；`verifiedPersons` 是 sourceId 人数；
`verifiedNames` 是姓名字符串数；`unresolvedSourceEntries` 是来源条目数。不能相加算覆盖率。

多学院输出在 `data/upc/timetables-2026-2027-1/`：

| 文件 | 内容 |
| --- | --- |
| `units/<slug>/import.json` | 逐单位导入批次 |
| `units/<slug>/teacher-candidates.json` | 候选、核实 evidence、未解决原因 |
| `units/<slug>/courses.json` | 课程组及排除/保留原因 |
| `cross-unit-audit.json` | 跨院逐条证据、拒绝/接受、修正量 |
| `import-results.json` | 批次摘要、训练中心/定向修正、最终计数 |
| `existing-data-protection.json` | 备份内容哈希一致性（布尔/计数） |
| `import-all.json` | 去重审计合并视图 |
| `manifest.json` | 逐单位候选/核实/导入量与全局 expected、化学基线 |
| `source-manifest.json` | 原始 XLS 哈希、工作表、学期、块数 |
| `conflicts.json` | 同编码不同名称/开课单位、排除关系数 |
| `unresolved-teachers.json` | 未核实教师、原因、受影响关系数 |
| `report.md` | 逐单位文件→候选→核实→导入→缺口 |
