# UPC 数据库说明

## 生成入口

- 源文件：`supabase/base-schema.sql`、`security.sql`、`fresh-hooks.sql`、`import-upc.sql`、
  `seed/upc-colleges.sql`（由 `data/upc/colleges.json` 生成）。
- 生成命令：`npm run schema:build`。
- 产物：`supabase/upc-init.sql` 与根目录 `supabase_schema.sql`，两者内容相同。
- 只改生成文件不会进入源文件；必须先改源文件再重新生成。

## 初始化顺序

1. 基础表、约束、索引和三条积分规则；
2. 16 个教学院部 + 独立教学单位石油工业训练中心（`upc-17`）种子；
3. RLS、公开评价视图、审核/签到/积分 RPC；
4. 注册建档、评分重算、评分 v2 守卫、点赞触发器；
5. 原子导入 RPC。

整份 `supabase/upc-init.sql` 在空库执行；不要拆开在已有业务库上重复执行普通建表 SQL。
本仓库没有旧校数据库的增量迁移路径，也不提供历史分数转换。

## 核心表

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `colleges` | 学院字典 | `code` 唯一；名称唯一；保留别名 |
| `teachers` | 教师主数据 | `id` 文本稳定键；`source_id` 唯一；职称/校区/评分可空；`rating_version=2` |
| `courses` | 课程 | `code` 唯一；有 code 时同名不同 code 允许；仅无 code 时 `(name, college_id)` 部分唯一 |
| `terms` | 学期 | `code` 与展示名唯一；部分唯一索引保证最多一个当前学期 |
| `course_offerings` | 教师 × 课程 × 学期 | 三元组唯一 |
| `reviews` | 评价 | 必须关联教师、课程、学期；`status` pending/approved/rejected；历史六维可空且 1–5；新提交六项必填、4.0–5.0、最多一位小数，DB trigger 拒绝 4.15 等未舍入值 |
| `review_likes` | 点赞明细 | 每用户每评价一条；触发器维护计数 |
| `point_rules` | 积分规则 | 仅注册 100、签到 5、评价通过 20；无 AI/推荐/攻略消费规则 |
| `point_transactions` | 积分流水 | 金额与余额；评价奖励通过 `related_review_id` 防重 |
| `admin_users` | 审核员 | 邮箱与 `auth.users.email` 匹配；角色 super_admin/admin/moderator |
| `user_profiles` | 积分账户 | 注册触发器建档；余额非负 |
| `review_feed` | 公开评价视图 | 仅 approved 且不含 `user_id`/`reviewer_id`/`reject_reason`/`reviewed_at` |
| `import_batches` | 导入批次 | service_role only；记录来源、校验值和摘要 |

## 权限模型

- 匿名和登录用户可读学院、教师、课程、学期、开课关系、积分规则。
- 公开评价通过 `review_feed` 读取；基表 `reviews` 只允许作者本人和有效审核员读取。
- 评价提交只能写 `status='pending'`、`rating_version=2`、`user_id=auth.uid()`；作者只能改
  自己的 pending/rejected 评价并重置为 pending。
- 审核通过/驳回只能走 `approve_review`/`reject_review`，函数内校验管理员角色。
- 积分只能通过注册触发器、签到 RPC、审核发奖和（若未来启用）规则化消费 RPC 变更；
  客户端没有直接改余额/流水的权限。
- `import_upc_dataset` 仅授予 `service_role`，不向 anon/authenticated 开放。

## 评分 v2

- 新库所有评分列默认 NULL，不再使用 4.5/3/4 等示例默认值。
- 新评价必须带 `rating_version=2` 和 `x-rating-version: 2` 请求头，否则触发器拒绝。
- 六维任意缺失时保持 NULL；`review_feed` 与教师详情显示“暂无数据”。
- 最后一条 approved 评价删除后，触发器把教师六个维度和总分清空，不保留旧缓存分数。
- 本仓库**不做**任何 v1 → v2 历史转换；UPC 数据从 v2 开始。

## 导入 RPC

`public.import_upc_dataset(p_payload jsonb, p_checksum text, p_dry_run boolean)`：

- 整批一个事务；异常即回滚。
- 教师按 `sourceId` 派生 `upc:<sourceId>`，同名不合并。
- 教师人事归属 `teachers.college_id` 与课程开课单位 `courses.college_id` 分开；
  `courses[].collegeCode` 可选，缺省才回退教师学院。
- 课程有 code 时以 code 为身份：同名不同 code 可以并存；同 code 不同名称报冲突；
  无 code 时仅匹配无编码的 `(name, college)`，若已有同编码记录则报歧义。
- 有课程必须有 term；`isCurrent` 由数据库唯一索引保证唯一。
- `p_dry_run=true` 在子事务中执行与正式导入完全相同的写入，随后抛出内部哨兵异常并回滚；
  因此批内课程代码冲突、唯一键冲突等会在预检阶段暴露，不留下教师/课程/学期/导入批次。
- 返回各类 `inserted/updated/skipped` 摘要；课程计数按教师-课程行统计。

## 已有真实课表数据

`data/upc/chemistry-2026-2027-1/import.json` 已按本格式生成：136 名已核实教师、
129 门课程、271 条开课关系。同名不同编码的 16 组课程按不同 code 保存，未改课程名、
未删编码、未合并。化学原 7 名待映射中 2 名按跨院同名追加，5 名无个人资料者按课表身份保留。

已初始化过的数据库执行非破坏性升级：

```sql
\i supabase/upgrades/20261022-course-code-identity.sql
```

脚本先检查旧的无编码同名重复和非法编码；成功后删除旧的 `(name, college_id)`
唯一约束，新增 `WHERE code IS NULL` 部分唯一索引，验证 `code` 长度约束，
并替换导入 RPC 及其授权。全部操作在同一事务中执行，失败时整体回滚。
仅修改唯一键会留下仍拒绝同名不同编码的旧 RPC，必须执行完整升级文件。

升级文件由 `npm run schema:build` 从
`supabase/upgrade-parts/course-code-identity.sql` 与 `supabase/import-upc.sql`
生成。PGlite 已验证旧唯一键和旧导入实现经完整升级后，可以导入真实批次，
dry-run 不留数据，重跑及重复升级不丢失原有课程和开课关系。

## 已知边界

- 本机已导入化学 + 15 个新增学院（含外国语）+ 训练中心 `upc-17`，以及 173 个
  `tt-` 课表学院身份（含化学扩展 7 个）：1,555 教师身份 / 1,342 课程 / 2,946 关系。
  其中官方 profile 1,382 人、课表身份 173 人；1,553 个来源单位候选条目、1,510 个
  唯一姓名；1,355 个官方核实唯一姓名；未解决教师身份 0 条。
- 化学原批次 136 教师/129 课程/271 关系及 `cce-` sourceId 保持不变；化学扩展
  7 教师/12 个已有课程关联/0 新课程/13 关系独立计数，见 `chemistry-timetable-evidence.json`。
- `tt-<collegeCode>-<sequence>` 是独立 sourceId 命名空间，只表示课表来源学院 +
  规范姓名，不是官方个人 ID/教工号/人事归属；职称和 campus 均为 null。
- 5 组同院页面别名归并为 5 个官方身份；5 组真同名拆为 6 个官方身份（王艳 2 个）；
  3 条课程关系已按研究方向暂定（inferred），依据记录在 `inferred-course-assignments.json`。
- 新增 23 条同编码冲突关系排除；其中 6 条文法 `OTH921331020` 关系；化学既有 1 条保留。
  2 名无任何已接受单位的教师及 3 门孤立课程已精确移除。外国语官方 89 + 课表 11，
  训练中心官方 8 + 课表 5。
- 没有旧校数据迁移、兼容字段或历史分数转换。
- 旧校 SQL 文件已从当前初始化路径删除，只保留在 Git 历史和 `docs/legacy/` 文档中。
- 本机 native Supabase 的 RLS、Auth 和真实数据已验收；云端独立测试项目的 RLS、外部邮件
  和 Auth 流程尚未实际验收。PGlite 仍用于可重复的 SQL 回归测试。
