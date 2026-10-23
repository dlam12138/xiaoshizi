# UPC 数据导入

## 前置条件

1. 新的空库执行 `supabase/upc-init.sql`；已初始化过的项目执行
   `supabase/upgrades/20261022-course-code-identity.sql`，两条路径择一。
2. 升级脚本在同一事务中更新课程唯一键和导入 RPC，不能只手工删除旧唯一键。
   该脚本由 `npm run schema:build` 使用 DDL 源文件与 `supabase/import-upc.sql`
   生成，失败时整体回滚。
3. 服务端环境有 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，放在
   `.env.import.local` 或进程环境中。**不要**把 service_role key 写进 `VITE_*`
   变量、前端构建或 Git。
4. 学院字典已由初始化脚本写入 16 个教学院部；如学校调整，先更新
   `data/upc/colleges.json` 并执行 `npm run schema:build`。

## 格式

```json
{
  "schemaVersion": 1,
  "dataset": "upc-chemistry-2026-2027-1-timetable-20261022",
  "source": "课表原始文件哈希 + 官方教师页 URL",
  "term": {
    "code": "2026-2027-1",
    "name": "2026-2027-1",
    "isCurrent": false
  },
  "teachers": [
    {
      "sourceId": "官方教师详情页文章 ID",
      "name": "教师姓名",
      "title": "教授",
      "collegeCode": "upc-03",
      "campus": null,
      "courses": [
        { "code": "CHM121711035", "name": "化学工程基础", "collegeCode": "upc-03" }
      ]
    }
  ]
}
```

### 稳定键

| 实体 | 稳定键 | 说明 |
| --- | --- | --- |
| 教师 | `sourceId` → `upc:<sourceId>` | 同名教师不合并；不同 sourceId 即不同人；sourceId 不能含斜杠/反斜杠 |
| 课程 | `code`；无编码时 `(name, college)` | 同一名称可有多个正式编码；同编码不同名称报冲突；无编码与同名有编码记录并存时报歧义 |
| 教师人事归属 | `teachers.collegeCode` | 来自官方教师归属；不能与开课单位混用 |
| 开课单位 | `courses[].collegeCode` | 可选；缺省取教师学院，但真实课表应显式提供来源开课单位 |
| 学期 | `code` | `year_term` 为展示名；`isCurrent` 最多一个；无校历确认时保持 false |
| 开课关系 | `(teacher, course, term)` | 重复导入不产生重复行 |

### 校验与失败行为

- 整批在数据库一个事务中执行；任何一行失败都会回滚，不会留下半批数据。
- 未知学院编码、非法校区、空姓名、重复 sourceId、有课程却无 term 都会直接报错。
- 同一课程编码已存在不同名称、或同一学院同名课程同时有无编码/有编码记录时，
  整批报冲突；不会改课程名、删编码或合并课程。
- 同名不同编码是合法数据，会保存为不同课程；不得为绕过约束而改课程名。
- `source` 必须填写，导入批次记录在 `public.import_batches`。
- 标题、校区无法核实时请留空；不要填“讲师”“唐岛湾校区”等猜测值。
- `dataset` 以 `fixture-` 开头视为测试夹具，必须显式加 `--allow-fixture`。
- `--validate-only` 只校验 JSON/学院/课程/term，不连接数据库，可先做本地检查。

## 命令

```powershell
# 只校验文件结构和字典，不连接数据库
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json --validate-only

# 在子事务中执行与正式导入相同的写入，然后回滚；不留下数据，批内冲突同样会失败
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json --dry-run

# 正式导入
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json
```

`tests/fixtures/upc-import-sample.json` 只供自动化测试使用，不建议导入任何真实项目。
`--allow-fixture` 仅用于专门的测试环境；正式数据必须使用正式 dataset 名称和可核对来源。

输出摘要包含 term/teachers/courses/offerings 的 `inserted`、`updated`、`skipped`。
课程摘要按“教师-课程行”计数，同一门课被多个教师引用时会重复计数。

## 化学化工学院批次

来源：

- `课表/化学化工学院/课表打印.xls`（BIFF8/OLE2，SHA-256
  `64bd913b47aacc0396331aa2b059486af03bc1fb2b7e5de0f7f5fd2da9325ca0`）
- `课表/化学化工学院/课表打印.zip`（内含 GBK 文件名 `化学化工学院.xls`，成员
  SHA-256 `43d352023a63ba7bac50a219719ac977261cd3ab7ae72947105acbbe68677c7a`）
- 官方教师页：<https://cce.upc.edu.cn/2568/listm.htm>

批次数据：715 块/导出、627 个去重课程块、129 门课程、143 名教师候选、
136 名已核实教师、271 条基线关系；化学原 7 名待映射中 2 名按跨院同名追加，5 名无个人资料者按课表身份保留。
学期 `2026-2027-1` 来自文件标题；`isCurrent=false` 由 `config.json` 明确配置。
完整证据见 `data/upc/chemistry-2026-2027-1/report.md`。

## 多单位批次（2026-10-23）

生成：

```powershell
npm run data:all-colleges
npm run test:parser
```

输出在 `data/upc/timetables-2026-2027-1/`：

- `units/<slug>/import.json`：逐单位批次；
- `import-all.json`：去重后的审计合并视图；
- `manifest.json`：逐单位候选/核实/导入量、全局 expected、化学基线；
- `source-manifest.json`：原始 XLS 哈希、工作表、学期、块数；
- `conflicts.json`、`unresolved-teachers.json`、`report.md`。

本机实际导入顺序为 15 个 active 学院（含外国语）+ 独立教学单位石油工业训练中心，
最后单独导入同名课表身份增量（化学已有批次不再 init/导入）：

```powershell
Get-ChildItem .\data\upc\timetables-2026-2027-1\units\*\import.json |
  Sort-Object DirectoryName |
  ForEach-Object { npm run import:upc -- $_.FullName --validate-only }
npm run import:upc -- data/upc/timetables-2026-2027-1/timetable-identities/import.json --validate-only
# 每批先 --dry-run，再正式导入；随后重复执行一次正式导入检查幂等
```

实际结果：本机新增 1,234 名教师 / 1,150 门课程 / 2,363 条关系；
同院同名官方 +12 教师 / 18 课程关联（6 门新课程；3 条 inferred）/18 关系；课表身份 +173 教师 / 57 新课程 / 294 关系；全局 1,555 教师身份 / 1,342 课程 /
2,946 关系（官方 profile 1,382 + `tt-` 173；含化学 136/129/271）。
其中化学扩展为 7 教师/12 个已有课程关联/0 新课程/13 关系；原化学批次和 sourceId 不变。
重复导入所有批次新增 0。
`OTH921331020 沟通与写作` 冲突涉及 8 个课程变体；新增实际排除 7 门/23 条关系，
化学既有 1 门/1 条保留；外国语该冲突课程不导入、不覆盖既有记录。
3 条按研究方向暂定的关系以 inferred 依据导入，不冒充官方确认。跨院修正精确删除 20 条关系/3 门孤立课程/2 名无接受单位的教师，
未删评价、未回滚整库。详见 `data/upc/timetables-2026-2027-1/report.md` 与
`cross-unit-audit.json` / `foreign-language-evidence.json`。

`check:supabase:remote -- --strict` 现在读取 `manifest.json` 的 expected 总量，
同时保留化学子集 136/129/271、学期、campus 和同名不同编码组校验，不关闭断言。

## 首个管理员

1. 在 Supabase Authentication 创建或注册管理员邮箱，并完成邮箱验证。
2. 在 SQL Editor 执行：

```sql
INSERT INTO public.admin_users (email, role, nickname)
VALUES ('admin@example.edu.cn', 'super_admin', '反馈审核员')
ON CONFLICT (email) DO UPDATE SET role='super_admin', is_active=true;
```

3. 用该邮箱登录，页面顶部出现“管理审核”即表示 RPC 鉴权生效。
4. 不要把管理员权限写入用户可编辑的 `user_metadata`；服务端只认
   `auth.users.email` 与 `admin_users` 的匹配。

## 最小真实输入与当前覆盖

本机 native Supabase 已完成化学批次、15 个新增学院（含外国语）、
训练中心 `upc-17`、`same-name-official-identities/import.json` 和 `timetable-identities/import.json` 的 dry-run、正式导入和
重复导入；全局 1,555 教师身份 / 1,342 课程 / 2,946 关系，重复导入新增 0。
证据见 `docs/upc-local-supabase.md` 和 `data/upc/timetables-2026-2027-1/report.md`。

仍未解决：

- 教师身份未解决 0 条；153 个无个人 profile/集体页条目已用 `tt-` 身份保留；
  仍有 3 条课程关系已按研究方向暂定（inferred），6 条文法 `OTH` 冲突关系按规则排除；
- 外国语官方 89 + 课表 11；训练中心官方 8 + 课表 5；均不再缺教师身份；
- 教务处正式校历/当前学期确认（所有批次保持 `isCurrent=false`）；
- 云端独立 UPC Supabase 项目、外部 SMTP 与生产服务器凭据。

因此当前数据不是全校完整教师库；应用只展示已核实并有课表证据的单位，
不显示示例教师或默认评分。本机验收不等于云端/生产验收。
