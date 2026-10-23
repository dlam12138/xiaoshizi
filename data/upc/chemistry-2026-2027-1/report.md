# 化学化工学院课表解析与导入报告

生成日期：2026-10-22。对象：中国石油大学（华东）化学化工学院 2026-2027-1 课表。

## 交付边界

- 已取得原始课表：`课表打印.xls` 与 `课表打印.zip`。
- 已解析全部工作表/课程块；未修改原件，原件哈希见 `source-manifest.json`。
- 教师身份：136/143 已通过官方教师列表+个人详情页核实；
  7 人保留待映射，不生成 sourceId。
- 导入文件只包含已核实教师与关系；未核实教师的 13 条开课关系不写入。
- 课表展示、推荐、教务通知继续后置；本轮只建立教师×课程×学期关系。
- 真实目标库验收尚未执行；本报告是本地解析/生成结果。

## 原始文件

| 文件 | SHA-256 | 说明 |
| --- | --- | --- |
| `课表打印.xls` | `64bd913b47aacc0396331aa2b059486af03bc1fb2b7e5de0f7f5fd2da9325ca0` | BIFF8/OLE2，工作表 `Sheet4` |
| `课表打印.zip` | `9485095f6f6130becd7614ab1348b5a0cab77469d9a488a102e6aac2567650b1` | 内含 `化学化工学院.xls`，成员 SHA-256 `43d352023a63ba7bac50a219719ac977261cd3ab7ae72947105acbbe68677c7a` |

原始 XLS 工作表：Sheet4 (9行/256列/715块)。
ZIP 内 XLS 工作表：Sheet1 (9行/256列/715块), Sheet2 (0行/0列/0块), Sheet3 (0行/0列/0块)。
空工作表保留在 `source-manifest.json`，不参与课程块统计。

## 两种导出核对

- 原始导出 715 块；ZIP 内导出 715 块。
- 课程块签名多重集完全一致：`True`。
- 唯一课程块 627；每个导出有 88 次重复出现。
- ZIP 的星期列整体比原始导出提前 1 天
  （例如 ZIP 星期日 = 原始星期一）。表头文字相同但内容错位，属于待核实差异；
  一期不使用星期做展示，教师×课程×学期关系不受影响。
- 一期以原始 `课表打印.xls` 为主来源；ZIP 仅作交叉核对，来源定位同时保留。

## 课程

- 唯一正式课程编码/课程：129。
- 同名不同编码组：16 组（见 `courses.json`）。
- 已调整课程唯一键：有名无编码时才用 `(name, college)`；有正式编码时以编码区分，
  同名不同编码不再被合并。同编码不同名称仍会报冲突。
- 课程开课单位：来源名称 `化学化工学院` → 学院字典
  `化学工程学院` (`upc-03`)，与教师人事归属字段分开。

## 教师

- 候选：143 人。
- 已核实：136 人；稳定 sourceId 取自官方个人详情页文章 ID。
- 待核实：7 人。名单、原因和所缺信息见
  `unresolved-teachers.json`、`teacher-mapping-template.csv`。
- 职称/系室取官方教师列表或详情页；校区未核实，导入时留空。
- 不按姓名哈希合并同名教师，不编造教工号。
- 核实口径为“官方教师列表姓名 + 唯一官方个人详情页标题姓名”；本轮未出现同名多页冲突，
  但跨学院同名教师仍建议后续用教工号复核。

## 导入数据

- 可导入教师：136。
- 可导入课程：129。
- 可导入开课关系：271（唯一教师×课程×学期）。
- 未核实教师导致未导入的关系：13。
- 学期：`2026-2027-1`，从文件标题读取；展示名暂用标题中的编码，待校历确认；
  `isCurrent=false` 由 `config.json` 明确配置，不按当前日期猜测。
- 导入文件：`import.json`；不包含 fixture 标记，不使用旧校数据。

## 异常与重复

- 多教师课程块：3。
- 无地点课程块：100（实验课常见，保留空地点）。
- 解析异常：0 条（无结构异常时为空数组）。
- 重复块：88 组；明细见 `anomalies.json`。
- 同名不同编码：16 组；未改课程名、未删编码、未合并。

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
- `npm run verify:local` 通过：schema → lint → 40 根测试 → build → 18 服务测试。
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
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json --validate-only
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json --dry-run
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json
```

新空库执行 `supabase/upc-init.sql`；已初始化库改为执行
`supabase/upgrades/20261022-course-code-identity.sql`，两条路径择一。
升级文件由 `npm run schema:build` 生成，包含课程约束与最新导入 RPC，
不能只改唯一键而保留旧导入实现。
