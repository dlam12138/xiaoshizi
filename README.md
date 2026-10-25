# 小石子 · 中国石油大学（华东）课堂反馈

面向中国石油大学（华东）的课堂反馈 Web 应用。复用现有 React + Supabase 架构，保留教师检索、
六维评价、审核、点赞、签到与积分体系；**不包含 AI 问答、模型服务或维护公告**。

> 文档中的 `operator@example.com` 是占位符：真实运营者邮箱、SSH 公钥与证书材料
> 不写入仓库，只在受控本机/服务器保存。

## 一期范围

| 功能 | 状态 |
| --- | --- |
| 学院字典、教师搜索、教师详情、六维评价 | 保留 |
| 注册登录、个人中心、签到、评价审核、积分 | 保留 |
| 评价点赞、作者修改/删除 | 保留 |
| 课表推荐 | 一期隐藏；后端和入口均不启用 |
| 教务通知 | 一期隐藏；旧校抓取、通知表和入口已移除 |
| 经验攻略、历史迁移说明 | 一期隐藏；不展示、不扣分 |
| AI 问答、Agent、模型服务 | 已完整移除 |

当前已完成**本机真实 Supabase native 验收**：16 个来源单位课表已只读盘点，
15 个新增学院（含外国语学院 `upc-13`）和独立教学单位石油工业训练中心（`upc-17`）
已导入，加上化学批次后本机为 **1,555 个教师身份 / 1,342 门课程 / 2,946 条关系**：
其中 **1,382 个官方 profile 核实身份 + 173 个 `tt-` 课表学院身份**；
化学原批次 **136/129/271** 不变，另有独立化学扩展 **7 教师/12 课程关联/13 关系**。
真实 Auth/RLS/审核/积分/点赞闭环和桌面/移动页面均已通过。

## 本机验收封版

2026-10-23 的 `main` 是本机验收封版，**不是云端或生产上线**。公开业务目录发布包位于
`data/upc/release/`：17 个教学单位、1 个学期、1555 个公开教师身份、1342 门课程、
2946 条开课关系、44 个导入批次摘要，带文件 SHA-256 与重建说明。

发布包不包含认证用户、管理员账号、评价正文、积分/点赞、`imported_by`、数据库 dump、
浏览器状态、本地日志或个人联系方式。导出命令：

```powershell
node --env-file=.env.import.local scripts/export-upc-release.mjs
```

详见 `data/upc/release/README.md`。云端独立测试项目、外部 SMTP、生产域名、TLS、
发布与回滚演练仍未验收。

新增 [上线前安全与治理计划](docs/upc-launch-security-plan.md)：管理员改为运营者手动指定的
Gmail 私有邀请，学生邮箱、匿名、唯一性、限频、资料纠错写回、治理边界、5 人门槛、TOTP/AAL2
和 MFA 受控恢复已在独立 Supabase 栈完成 79 项 E2E、12 项真实连接并发、17 项桌面/移动浏览器、
26 项 SEC-G0 和 23 项 MFA 演练；根测试 53/53。SEC-G0 已按有限清单在隔离环境通过，
见 [SEC-G0 矩阵](docs/upc-sec-g0-acceptance.md)。教师评分申诉已移除，历史记录保留；
**WSL 原库已于 2026-10-24 应用五份安全补丁并通过 post-check，数据计数不变**；
旧管理员已停用，新 `operator@example.com` 已建 Auth 账户和 `super_admin`，已激活并绑定 1 个 verified TOTP。
详见 [实施记录第 8–13 节](docs/upc-security-delivery.md#8-2026-10-24-管理员策略纠正与治理边界收尾)
和 [托管迁移操作单](docs/upc-cloud-migration-runbook.md)。
托管项目 `your-project-ref` 已完成 schema/正式数据/Auth 迁移和专项检查；
云端 `operator` 已完成密码和 TOTP；核心评价/审核/积分/点赞/撤回/纠错已在云端通过。
外部 SMTP、完整 79 项云端 E2E 和生产部署未完成。详见
[云端覆盖对照](docs/upc-cloud-e2e-coverage.md)、
[Resend 准备](docs/upc-email-resend.md)、
[服务器发布准备](docs/upc-server-deployment-prep.md)。
隔离/WSL 验收不代表云端生产上线已通过。

缺个人资料不再阻塞展示：183 个原未解决来源条目中，153 个无 profile/名单无 URL/
集体页条目已按“课表来源学院+规范姓名”保留为 `tt-`，加上此前 20 个共 **173 个**；
当前教师身份未解决 **0 条**。其中 5 组同院页面经邮箱/电话/履历核实为同一人，
7 个页面合并为 5 个官方身份（含 1 个 HTTP 410 退休链接）；另 5 组是真同名，
按官方明确主讲课程/研究方向拆为 7 个官方身份（李莉 2 个、王艳 2 个），不能分配给任何一人的 **3 条**
课程关系保留为课程级歧义。外国语 11 人、训练中心 5 人已用课表身份保留。
`tt-` 身份不冒充官方个人 ID、不猜职称/campus，也不代表官方人事归属；不能把
1,555 个教师身份都称为官方已核实人数。云端独立测试项目、外部 SMTP 和正式上线
仍未验收。
详见 `docs/upc-local-supabase.md`、
`data/upc/timetables-2026-2027-1/report.md`、`data/upc/chemistry-2026-2027-1/report.md`
与 `docs/upc-acceptance.md`。

## 快速开始

要求 Node.js 22+（建议 24）。

本机 native 测试栈已经初始化并导入，不要再次初始化：

```powershell
npm ci
npm run supabase:status
npm run check:supabase
npm run dev
```

多学院数据可从只读原始课表重建：

```powershell
npm run data:all-colleges
npm run test:parser
```

前端打开 <http://localhost:3000>；本机 Supabase API 为
<http://127.0.0.1:54321>，Studio 为 <http://127.0.0.1:54323>，
Mailpit 为 <http://127.0.0.1:54324>。本机启停、数据与验收命令见
`docs/upc-local-supabase.md`。真实密钥只在本机忽略 env 文件中，不提交。

缺少配置时页面会显示配置缺口并停止连接；不会回退到旧校项目，也不会显示 mock 教师。

### 初始化新库

仅新空库需要；本机已初始化的数据库禁止再次执行。在 Supabase 项目的 SQL Editor 中
**整份执行** `supabase/upc-init.sql`（与根目录 `supabase_schema.sql` 内容相同）。
它按以下顺序创建：

1. `supabase/base-schema.sql`：基础表、约束、索引、三条积分规则；
2. `supabase/seed/upc-colleges.sql`：16 个教学院部 + 学校直属教学单位石油工业训练中心
   （`upc-17`，由 `data/upc/colleges.json` 生成）；
3. `supabase/security.sql`：RLS、公开评价视图、审核/签到/积分 RPC；
4. `supabase/fresh-hooks.sql`：注册建档、评分重算、评分 v2 守卫、点赞；
5. `supabase/import-upc.sql`：原子数据导入 RPC。

不要执行旧版 `swjtu` 迁移文件；它们已从当前初始化路径移除。

### 导入真实数据

```powershell
Copy-Item .env.import.example .env.import.local
# 填写 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY（仅服务端）
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json --validate-only
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json --dry-run
npm run import:upc -- .\data\upc\chemistry-2026-2027-1\import.json
```

15 个新增学院批次 + 训练中心 + 同名课表身份增量按
`data/upc/timetables-2026-2027-1/units/*/import.json` 和
`data/upc/timetables-2026-2027-1/timetable-identities/import.json` 分批执行
validate-only → dry-run → 正式导入 → 重复导入；本机已执行为全局
1,555 教师身份 / 1,342 课程 / 2,946 关系。不要重复 init 已初始化的本机库。

导入格式、稳定键和错误处理见 `docs/upc-data-import.md`。已初始化过的数据库先执行
`supabase/upgrades/20261022-course-code-identity.sql` 和
`supabase/seed/upc-colleges.sql`（补独立教学单位 `upc-17`），以允许同名不同编码课程并存。
`tests/fixtures/upc-import-sample.json` 是合成测试夹具，默认会被导入脚本拒绝。

### 重新生成化学/多学院数据

```powershell
python -m pip install -r scripts/upc-timetable/requirements.txt
npm run data:chemistry
npm run data:teacher-map
npm run data:all-colleges
npm run test:parser
```

解析器只读原始 `.xls`/`.zip`，不修改原件；多学院报告见
`data/upc/timetables-2026-2027-1/report.md`，化学专项见
`data/upc/chemistry-2026-2027-1/report.md`，命令与格式见
`scripts/upc-timetable/README.md`。

## 验证

```powershell
npm run lint
npm test
npm run build
npm run test:server
python -m unittest discover -s scripts/upc-timetable -p 'test_*.py'
```

一次性执行：

```powershell
npm run verify:local
```

`verify:local` 覆盖代码、SQL、构建和自动化测试；本机真实 Supabase 的 Auth、RLS、
导入和页面闭环另有独立证据。本机验收不代表云端独立测试项目、外部 SMTP 投递或生产
上线通过。

## 目录

- `src/`：React 前端；`src/config/upc.ts` 为品牌/校区/学院临时口径。
- `server/`：可选缓存 API；一期默认不启用，直连 Supabase。
- `supabase/`：SQL 源文件、学院种子、生成的完整初始化文件。
- `data/upc/`：可核对的学院/校区数据与导入格式说明；不含真实个人数据。
- `docs/upc-local-supabase.md`：本机 native Supabase 的启停、入口、真实数据与验收证据。
- `docs/upc-launch-security-plan.md`：上线前安全与治理差距审计、P0/P1 实施顺序、迁移和验收要求。
- `docs/`：迁移基线、数据缺口、品牌口径、部署与验收记录；`docs/legacy/` 为旧校历史资料。
- `scripts/build-schema.mjs`：生成 `supabase/upc-init.sql` 和根目录 `supabase_schema.sql`。
- `scripts/import-upc-data.mjs`：调用原子导入 RPC。

## 学校事实来源

- 学院/教学部：<https://jwc.upc.edu.cn/611/list.htm>
- 校名、简称、校区：<https://upc.edu.cn/xygk/sdzc1.htm>

品牌与域名仍为临时方案，正式上线前需确认产品名、图标授权和域名。
