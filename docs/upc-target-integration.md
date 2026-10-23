# UPC 独立测试 Supabase 联调手册

本文件用于**云端独立测试项目**的联调。**本机 native Supabase 已初始化、导入并完成
真实 Auth/RLS/页面验收**；本机入口与复现命令见 `docs/upc-local-supabase.md`。

云端独立项目、外部 SMTP 和生产部署仍未执行；不要把本机键当作云端验收。

## 1. 范围

- 使用 `data/upc/chemistry-2026-2027-1/import.json` 和多单位
  `data/upc/timetables-2026-2027-1/units/*/import.json` 和同名课表身份增量
  `timetable-identities/import.json`：全局 1,555 个教师身份、1,342 门课程、
  2,946 条开课关系；其中官方 profile 1,382 + `tt-` 课表身份 173；化学基线
  136/129/271 不变，化学扩展 7/12/13。
- 教师身份未解决 0；3 条课程关系已按研究方向暂定（inferred）、6 条文法 `OTH` 冲突关系排除；
  不按姓名合并、不编造教工号；训练中心使用独立教学单位
  `upc-17`。`tt-` 身份只表示课表来源学院+规范姓名，不代表官方人事归属。
- `campus` 全部为 `null`，不根据学院/教室猜填；一期不提供校区筛选。
- 学期固定为 `2026-2027-1`、`isCurrent=false`，需要页面手动选择该学期。
- 不包含其他学院、课表展示、推荐、通知、AI、正式品牌和生产部署。

## 2. 云端项目配置

本机 `.env.local` / `.env.import.local` 已由本机包装器生成，指向
`127.0.0.1:54321`；不要用它们冒充云端。做云端验收时，从模板复制并替换为云端项目，
真实值只放本地忽略文件：

| 文件 | 变量 | 要求 |
| --- | --- | --- |
| `.env.local` | `VITE_SUPABASE_URL` | 与导入 URL 同一个独立测试项目 |
| `.env.local` | `VITE_SUPABASE_ANON_KEY` 或 `VITE_SUPABASE_PUBLISHABLE_KEY` | 二选一，公开 key |
| `.env.local` | `VITE_CACHE_API_ENABLED=false` | 本机直连，不启用缓存 API |
| `.env.import.local` | `SUPABASE_URL` | 与前端同一个项目 |
| `.env.import.local` | `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端导入；不得进入前端 |

检查：

```powershell
npm run check:supabase
```

脚本只打印项目域名和检查结果，不打印 key。配置一致后再做远程只读检查：

```powershell
npm run check:supabase:remote
```

导入并确认数据后用严格检查：

```powershell
npm run check:supabase:remote -- --strict
```

严格检查读取 `data/upc/timetables-2026-2027-1/manifest.json` 的全局 expected，
并保留化学子集 136 教师、129 课程、271 关系、16 组同名不同编码、`is_current=false`、
全库教师 campus 为空和至少 1 条导入批次。当前本机全局为 1,555 教师身份 / 1,342 课程 /
2,946 关系；云端按同一清单核对，不硬编码化学单学院总量。

## 3. 云端初始化或升级数据库（二选一）

本机数据库已经初始化并导入，**不要再次 init**；本节只用于云端项目。先运行：

```powershell
npm run schema:build
```

新空库：在独立测试项目的 SQL Editor 整份执行 `supabase/upc-init.sql`（包含
16 个教学院部和独立教学单位 `upc-17` 种子）。

已初始化的 UPC 测试库：执行完整升级文件
`supabase/upgrades/20261022-course-code-identity.sql`，并执行
`supabase/seed/upc-colleges.sql` 以补 `upc-17`；两者不能替代为只删旧唯一键。
执行前记录基线并备份：

```sql
select count(*) as teachers from public.teachers;
select count(*) as courses from public.courses;
select count(*) as offerings from public.course_offerings;
select id, dataset, imported_at from public.import_batches order by imported_at desc limit 10;
```

已有数据不得重置。升级失败时事务整体回滚；先保留错误和备份，不手工删业务数据。

## 4. 云端导入真实批次

本机已完成同一批次的 validate-only / dry-run / 正式导入 / 重复导入；以下命令用于
云端项目：

```powershell
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --validate-only
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --dry-run
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json
Get-ChildItem .\data\upc\timetables-2026-2027-1\units\*\import.json |
  Sort-Object DirectoryName |
  ForEach-Object { npm run import:upc -- $_.FullName --validate-only }
# 然后逐批 dry-run、正式导入；每批再正式导入一次检查幂等
```

验收：

- dry-run 后业务表数量与基线一致，`import_batches` 不增加；
- 化学子集 136 教师、129 课程、271 开课关系；多单位全局 1,555 / 1,342 / 2,946；
- 16 组化学同名不同编码及全局 133 组保持独立，不合并、不改名；
- 每批再正式导入一次，教师/课程/关系全部 skipped，允许新增批次日志；
- 原有数据、原有批次仍完整；3 条 inferred 关系按可纠正依据导入、新增 23 条同编码冲突关系不导入
  （化学既有 1 条保留）；训练中心 8 人/6 课程按 `upc-17` 导入；外国语 89 人/
  88 课程导入（官方 89 + 课表 11）；173 个课表身份使用 `tt-` 独立 ID，未借用官方 profile，
  同院同名 5 组别名归并、5 组真名拆分，3 条课程关系为 inferred/可纠正；
- 学期 `2026-2027-1` 存在且 `is_current=false`；所有教师 campus 为空；
- 教师 `campus` 全部为空。

## 5. 页面闭环（桌面端和移动端）

使用独立测试项目的真实 anon key 与普通用户会话，不能用 service_role 代替。

1. 匿名打开首页，确认只显示已导入的化学化工学院教师/课程，无 mock/旧校数据。
2. 搜索教师 → 打开详情 → 确认姓名、职称、学院、课程；校区为空时不显示“校区待核实”。
3. 注册普通用户 → 完成邮箱验证（若邮件条件具备）→ 登录。
4. 在评价弹窗手动选择 `2026-2027-1` 与真实课程（不依赖“当前学期”自动选择）。
5. 提交六维评价，确认状态为 pending，匿名公开列表不可见。
6. 用管理员账号审核通过；作者积分增加 20；公开列表出现评价。
7. 另一普通用户点赞/取消点赞；计数和作者积分不被错误修改。
8. 管理员驳回一条评价；作者修改后重新提交，状态回到 pending，再审核通过。
9. 删除最后一条 approved 评价；教师六维和总分恢复为空，显示“暂无评价/暂无数据”。
10. 无评价教师保持未评分；不得出现默认 4.5 分。
11. 重复签到、重复审核检查不重复发奖。
12. 分别用桌面浏览器和移动视口/真机重复 1–9 的关键路径；校区为空不阻塞。

## 6. Auth 与邮件

在 Supabase Authentication 设置：

- Site URL：本地验收用 `http://localhost:3000`；
- Redirect URLs：加入 `http://localhost:3000`（以及实际本地端口）；
- Email provider 开启，Confirm email 开启；有 SMTP 时记录发信限额。

实际完成：

1. 新邮箱注册 → 打开验证邮件 → 登录成功；
2. 未验证邮箱不能登录；
3. 忘记密码 → 打开恢复邮件 → 设置新密码 → 退出恢复会话；
4. 旧密码登录失败，新密码登录成功；
5. 保存后 URL 中 recovery token/fragment 已清理。

邮件服务缺失时，将本项单独标记为“待验收”，不能用“邮件已发送”代替点击链接。

## 7. RLS/权限矩阵

至少四个会话：匿名、评价作者、另一普通用户、管理员。

| 检查 | 期望 |
| --- | --- |
| 匿名读取公开目录/公开评价 | 允许 |
| 匿名读取 `reviews` 基表、积分、管理员表 | 拒绝或空结果，不泄露私有字段 |
| 普通用户读取他人 pending/rejected | 拒绝 |
| 普通用户调用审核 RPC、改分、改他人评价 | 拒绝 |
| 作者修改自己的 pending/rejected | 允许，并重置为 pending |
| 无匹配 teacher×course×term 的评价 | 数据库拒绝 |
| 公开评价响应 | 不含 user_id/reviewer_id/reject_reason/reviewed_at 等内部字段 |
| 管理员审核/驳回 | 允许；普通用户不能成为管理员 |

## 8. 证据与状态

记录：测试项目 host、执行日期、SQL 路径（新库/升级）、备份位置、导入批次 ID、
各表计数、页面截图/录屏、Auth 邮件结果、RLS 结果、发现的问题和修复。

状态必须分开写：

- 本机真实 Supabase 验收通过（已完成，见 `docs/upc-local-supabase.md`）；
- 云端独立测试项目验收通过（未执行）；
- 正式上线（未执行）。

云端仍需的输入（当前本机 env 已配置好，不要用本机键冒充云端）：

1. 云端项目的 `VITE_SUPABASE_URL`、公开 anon/publishable key，以及
   `VITE_CACHE_API_ENABLED=false`；
2. 同一云端项目的 `SUPABASE_URL`、仅服务端 `SUPABASE_SERVICE_ROLE_KEY`；
3. 云端项目 SQL 执行权限或数据库连接；
4. 云端测试用户/管理员邮箱与外部 SMTP 配置；
5. 云端 Auth Site URL / Redirect URLs，本机联调用 `http://localhost:3000`。

没有第 1–3 项时不能执行云端数据库导入；没有第 4 项时外部邮件投递只能待验收。
本机 Mailpit 验证只代表本机邮件链路。
