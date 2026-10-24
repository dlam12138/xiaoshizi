# UPC 上线前安全与治理实施记录

更新：2026-10-24。分支：`feat/launch-security-governance`。基线：`cded096`。
本文件记录本轮**本地实施与验证**结果，不表示云端测试项目或生产环境已上线。

> **2026-10-24 收尾状态（优先阅读第 8–13 节）**
> - 管理员策略已纠正为“仅运营者手动指定的 Gmail 私有邀请”，源代码和增量补丁已就绪。
> - **2026-10-24 18:xx 已对 WSL 原库 `0499...`（54321/54322）执行五份补丁；**
>   备份和恢复核对见第 11 节；数据计数保持不变；旧 `example.test` 管理员已停用，账户/角色/MFA 保留但不再有权限。
> - **已通过 Gmail 私有邀请创建 `operator@example.com` Auth 账户并授予 `super_admin`；**
>   MFA 已绑定 1 个 verified TOTP；一次性密码设置链接已使用并删除，未输出 token。旧管理员已停用，迁移不得恢复其权限。
> - **托管项目 `your-project-ref`（ap-southeast-2，Postgres 17.11）已完成 schema/正式数据/Auth Hook/TOTP/URL 迁移，并创建云端 `operator` super_admin；**
>   云端专项会话/角色/评价/浏览器检查通过；云端 operator 已绑定 1 个 verified TOTP，SMTP/正式域名/完整 79 E2E/服务器部署未完成。
> - 第 4 节旧的“30 项真实数据库检查”含已废止的员工域邀请，**不能作为新策略证据**。
> - 教师评分申诉已移除：前端入口、服务方法、申请类型、代录 RPC 和历史“必做”文案已清理；
>   历史申请和审计保留，不再作为上线阻塞项。
> - 资料纠错闭环已完成：AAL2 受控写回、前后差异/来源依据/关联申请、重导入保护、
>   引用冲突拒绝均有代码和隔离验证；不是只改申请状态。
> - 新策略在独立 native Supabase 栈完成 **79 项** Auth/RLS/纠错/邮箱变更/注销/失败恢复 E2E、
>   **26 项 SEC-G0 补充**、**23 项 MFA 恢复演练**；真实独立连接并发 **12 项**、
>   桌面/移动浏览器 **17 项**；根测试 **53/53**、服务测试 **18/18**、构建通过。
> - SEC-G0 已按有限清单在隔离环境通过，见 `docs/upc-sec-g0-acceptance.md`；不再以
>   “历史全套页面未重跑”无限阻塞，但不等于云端或生产通过；WSL 目标库已另行升级。
> - 隔离克隆曾按五份补丁顺序执行两遍；**WSL 原库也已于本轮执行一次并通过 post-check**。
>   数据量保持 1,555/1,342/2,946/1。目标库管理员会话失效验收 10/10 通过。
> - P1-02 运营信息已由运营者冻结，本轮不修改、不再追问；仍不是已发布政策。

## 1. 结论

| 工作包 | 状态 | 本地证据 |
| --- | --- | --- |
| SEC-01 只读盘点 | 已完成 | `temp/supabase-local/security-audit/` 脱敏摘要与敏感明细；备份哈希见下 |
| SEC-P0-01 学生邮箱准入 | WSL 目标库与隔离库均已应用 | 独立 Auth Hook、Gmail 无邀请拒绝、学校邀请拒绝、邮箱变更确认落地 |
| SEC-P0-02 唯一性/限频/风控/奖励 | WSL 目标库与隔离库均已应用 | 唯一索引、原子限频、异常标记、业务键奖励；withdrawn 键释放 |
| SEC-P0-03 匿名/身份/删除申请 | WSL 目标库已应用；隔离完成实际注销演练 | 公开投影、管理员投影、审计、删除申请、失败恢复 |
| SEC-P0-04 纠错/举报/撤回 | WSL 目标库与隔离库均已应用；资料纠正闭环已验收 | 私有申请表、RLS、历史评价撤回、桌面/移动入口、AAL2 实际写回 |
| SEC-G0 集成验证 | 隔离通过（有限清单）；WSL 目标库已升级并通过会话失效验收 | 79 E2E + 12 并发 + 17 浏览器 + 26 补充 + 23 MFA + 目标库 10 会话检查；云端/生产未验 |
| SEC-P1-01 5 人门槛/学期统计 | 已通过代码与 PGlite | 数据库遮蔽、`offering_rating_stats`、教师详情页 |
| SEC-P1-02 隐私与运营说明 | 运营信息冻结，未完成 | 运营者明确本轮不修改、不追问；仍不能作为已发布政策 |
| SEC-P1-03 管理员最小权限/MFA | WSL 目标库已应用；隔离完成恢复演练 | Gmail 私有邀请、稳定 Auth 主体、审计、TOTP AAL2、会话绑定、普通管理员/AAL1 拒绝 |

## 2. SEC-01 只读盘点摘要

本机 native Supabase，只读统计：

| 项目 | 计数 |
| --- | ---: |
| Auth 账户 | 6 |
| 已确认账户 | 6 |
| `@s.upc.edu.cn` 学生域账户 | 0 |
| 非学生域账户 | 6 |
| 未确认账户 | 0 |
| 管理员行 | 1 |
| 管理员未匹配 Auth 主体 | 0 |
| 普通评价 | 1 |
| 重复业务组合（用户×教师×课程×学期） | 0 |
| 非空文字评价 | 0 |
| 自定义公开昵称 | 1 |
| 评价关联缺失 | 0 |
| 评价奖励流水 | 7 |
| 评价关联已丢失的奖励流水 | 6 |

结论：

- 现有 6 个账户均为历史非学生域账户。迁移后仍可登录、查看本人资料和发起删除申请，
  但不能新增评价；不自动删除、改号或合并账户。
- 现有评价没有重复业务组合，唯一索引可非破坏性建立。
- 6 条奖励流水的评价关联已丢失。迁移将其标记为 `needs_verification`，受影响账户后续奖励
  不自动补发；没有把“找不到原关联”解释成“从未奖励”。
- 公开 Auth 设置：Email 开启；Phone、匿名登录关闭；未发现第三方 provider。
- 敏感明细仅保存在 Git 忽略的 `temp/supabase-local/security-audit/audit-detail.json`。
  该文件每次运行都会更新时间戳和 SHA-256；仓库只保留计数、问题类型与处理方案。

## 3. 数据库迁移与执行顺序

### 3.1 迁移文件

- `supabase/security-schema.sql`：增量表/列、唯一索引预检、限频表、奖励业务键、治理表、审计表。
- `supabase/security.sql`：公开投影、RLS、管理员投影、审核/奖励/审计 RPC、敏感身份调查。
- `supabase/governance.sql`：纠错/举报/撤回/注销队列 RPC 与管理员视图。
- `supabase/fresh-hooks.sql`：Before User Created Hook、`auth.users` 邮箱变更守卫、评价资格、
  服务端时间、评论关闭、原子限频、评分重算与 5 人遮蔽。
- `supabase/upgrades/20261024-security-governance.sql`：以上四部分生成的可审查增量迁移。
- `supabase/upgrades/20261024-owner-admin-policy.sql`：Gmail-only 管理员邀请、角色 RPC 和部分唯一索引冲突修复。
- `supabase/upgrades/20261024-governance-boundary.sql`：排除 withdrawn 的业务唯一索引、历史评价治理触发器修复。
- `supabase/upgrades/20261024-remove-teacher-appeal.sql`：移除代录 RPC、阻止新建教师申诉，保留历史行。
- `supabase/upgrades/20261024-governance-correction-closure.sql`：纠错台账/保护钉、AAL2 写回 RPC 和重导入保护。
- `supabase/upc-init.sql` / `supabase_schema.sql`：由 `npm run schema:build` 重新生成的空库初始化产物；
  **不得**对已初始化本机库执行完整 init。

### 3.2 已初始化数据库顺序

1. 先备份，记录 SHA-256，不改动现有库。
2. 在隔离或已备份的目标库按第 9.3 节顺序执行五份补丁：

```powershell
psql -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-security-governance.sql
psql -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-owner-admin-policy.sql
psql -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-governance-boundary.sql
psql -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-remove-teacher-appeal.sql
psql -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-governance-correction-closure.sql
```

3. 更新 `supabase/config.toml` 的 Auth Hook/MFA 配置，停止并重新启动 GoTrue，使配置生效；
   仅改 SQL 文件不会让 Auth 调用 Hook。
4. 管理员首次进入后台完成 TOTP 绑定；`require_admin_aal2` 默认 `true`。
5. 新空库才执行 `supabase/upc-init.sql`；已有库禁止重跑完整 init。

补充：`governance-boundary` 会先检查非 withdrawn 的重复业务组，再替换唯一索引；它不会删除、
改写或合并任何评价。索引替换需短暂表锁，应放在维护窗口。

迁移前置检查：只统计 `status <> 'withdrawn'` 的重复业务组；有活动重复时按组计数并抛错，
不自动保留/合并/删除任一行。`withdrawn` 行保留历史但不占业务键。奖励业务键冲突、历史无主
奖励、重复邮箱管理员均以计数/状态显式处理。

现有本机库执行结果（旧 `security-governance`，尚不含本轮两个补丁）：

- 迁移前备份：`temp/security-backups/upc-before-security-20261023T144848Z.dump`
  （Git 忽略，SHA-256 `508f88a47caa933a3c057227c59dca6985a7e3243ce494837b39b73e118f310c`）。
- 迁移成功；再次执行同一迁移成功（幂等重跑）。
- 迁移前后真实业务数据保持：1,555 教师身份 / 1,342 课程 / 2,946 开课关系 / 1 条评价。
- 未执行 reset、清空、覆盖恢复或完整 init。

## 4. 自动化与真实验证

| 验证 | 结果（历史轮次，最新见第 9 节） | 证据 |
| --- | --- | --- |
| 类型检查 | 通过 | `npm run lint` |
| 根测试 | **48/48** | `npm test`（含历史评价治理、withdrawn 键、补丁一致性） |
| 服务测试 | 18/18 | `npm run test:server` |
| 生产构建 | 通过 | `npm run build` |
| 隔离 E2E（新策略） | **55/55** | `temp/isolated-supabase/e2e-report.md` |
| 桌面/移动安全页面 | 8/8 | 上一轮 `temp/supabase-local/security-ui-report.md`；本轮未改 UI |
| 管理员 AAL2 页面门 | 3/3 | 上一轮 `temp/supabase-local/security-admin-ui-report.json` |
| 旧真实 Auth | 14/14（旧策略） | 仅历史；不包含 Gmail 策略 |
| 旧真实数据库/并发 | 30/30（已废止） | 含员工域邀请，**不得作为新策略证据** |

真实 Auth 覆盖：

- 公开 key 直接请求真实 GoTrue；非学生域、`upc.edu.cn`、伪装后缀均被 Hook 以 400 拒绝且不建号。
- 精确 `s.upc.edu.cn` 可注册，仍需邮箱确认。
- 已确认学生可登录。
- 直接 `auth.updateUser({ email })` 改到非学生域被数据库更新守卫拒绝，原邮箱不变。
- 学生内部别名变更被接受但保持待确认，当前邮箱不被直接替换。
- 未确认登录仍被拒绝。

真实数据库/并发覆盖：

- 两条真实独立连接并发插入同一业务组合，只保留一条。
- 修改评价撞入已有组合被拒绝。
- 60 秒窗口下两条真实独立连接并发提交，只接受一条。
- 五名独立账户达到门槛前，公开投影为 0、教师分数为 NULL；达到 5 人后公开 5 条。
- 第 5 名集中提交被标记 `offering_burst`。
- 删除并重提同一业务组合，不重复发 20 分。
- AAL1 管理员调用敏感 RPC 被拒绝；TOTP 升级到 AAL2 后成功。
- （已废止）旧员工域邀请测试不再作为新策略证据；新策略 Gmail 隔离 E2E 见第 8.5 节。
- 注销申请仅本人和 AAL2 管理员可见；处理状态可回读。
- 直接写非空 comment 被拒绝；公开投影不含 comment/exact timestamp。

页面覆盖：

- 学生真实登录；
- 评分弹窗无文字评论、无公开昵称，六维提交成功；
- 数据库行为 pending / comment-free / 固定匿名；
- 个人中心可见待审核状态和纠错/举报/撤回/注销入口；
- 桌面与移动均无横向溢出；
- 管理员 AAL1 看到 AAL2 门，TOTP 后进入审核台。

未做或未完成：

- **未在实际云端项目、外部 SMTP、生产域名/TLS/备份恢复环境复验**。
- 邮箱变更只验证到“待确认”请求，未点击确认邮件完成最终落地；目标环境仍需补这一步。
- 真实管理员 MFA 恢复未执行；合成演练 23/23 通过。
- 真实账户删除只做队列和 dry-run 脚本，未在本机真实账户上执行删除。
- 旧功能页面（教师检索、评价审核、点赞、桌面/移动）未整套重新跑历史 7 份页面报告；
  本轮页面只覆盖安全治理关键链路。
- 隐私政策/用户协议/运营主体信息未完成，不能发布带占位符的版本。

## 5. 修改文件清单

本轮收尾的主要修改原因：

| 文件组 | 原因 |
| --- | --- |
| `security.sql` / `fresh-hooks.sql` | Gmail-only 邀请、角色 RPC 部分索引冲突、历史评价治理不误伤、作者改分仍受限 |
| `security-schema.sql` / `build-schema.mjs` | withdrawn 不占业务键、预检只统计活动记录、生成两个新补丁 |
| `20261024-owner-admin-policy.sql` | 已初始化库补管理员策略，不创建/删除/改权账户 |
| `20261024-governance-boundary.sql` | 已初始化库替换唯一索引并更新评价写入触发器，不删除/改分历史 |
| `process-account-deletion.mjs` | Auth 先失效、后置计数、失败恢复、作者评价上的点赞核对 |
| `tests/upc-schema.test.mjs` | 历史非学生审核/撤回、作者改分拒绝、withdrawn 键、补丁一致性 |
| `docs/upc-auth-setup.md` / runbook / 验收 | 明确 Gmail 手动授权、WSL 目标库已升级、失败恢复和状态分层 |

代码与服务：

- `package.json`
- `server/data.mjs`
- `server/test/data.test.mjs`
- `src/App.tsx`
- `src/types.ts`
- `src/lib/studentEmail.ts`
- `src/services/supabaseService.ts`
- `src/components/AuthModal.tsx`
- `src/components/ReviewModal.tsx`
- `src/components/TeacherDetailModal.tsx`
- `src/components/AdminAuditModal.tsx`
- `src/components/GovernanceModal.tsx`
- `src/components/desktop/DesktopUserProfile.tsx`
- `src/components/mobile/MobileUserProfile.tsx`

数据库：

- `supabase/base-schema.sql`（未改）
- `supabase/security-schema.sql`
- `supabase/security.sql`
- `supabase/governance.sql`
- `supabase/fresh-hooks.sql`
- `supabase/config.toml`
- `supabase/upgrades/20261024-security-governance.sql`
- `supabase/upgrades/20261024-owner-admin-policy.sql`
- `supabase/upgrades/20261024-governance-boundary.sql`
- `supabase/upc-init.sql`
- `supabase_schema.sql`
- `scripts/build-schema.mjs`

审计/验证/运维脚本：

- `scripts/security-audit.mjs`
- `scripts/verify-auth-security.mjs`
- `scripts/verify-security-db.mjs`
- `scripts/mfa-test-helpers.mjs`
- `scripts/process-account-deletion.mjs`
- `scripts/local-supabase.mjs`（同项目分支栈的 status/start/stop 兼容）
- `scripts/verify-local-supabase.mjs`（旧 8 组 runner 标记弃用，不再由 npm script 调用）

测试：

- `tests/upc-schema.test.mjs`
- `tests/upc-service.test.mjs`
- `tests/upc-student-email.test.mjs`

文档：

- `README.md`
- `docs/upc-launch-security-plan.md`
- `docs/upc-migration-plan.md`
- `docs/upc-acceptance.md`
- `docs/upc-auth-setup.md`
- `docs/upc-baseline.md`
- `docs/upc-local-supabase.md`
- `docs/upc-security-audit.md`
- `docs/upc-security-delivery.md`（本文件）
- `docs/upc-account-deletion-runbook.md`
- `docs/upc-privacy-operations.md`（草案，未发布）

用户开始任务前已有的 5 份计划文档改动均保留；其中 `docs/upc-feedback-audit.md`
的既有改动未被覆盖。

## 6. 未解决风险与手动配置

### 6.1 Supabase / Auth

- 在目标项目执行增量迁移，并确认 `before_user_created_hook` 在 Auth 配置中实际启用。
- 在 Dashboard/CLI 确认 Site URL、Redirect URLs、Email provider、关闭 Phone/匿名/未使用 OAuth。
- 管理员先用目标环境账号完成邮箱验证，再绑定 TOTP；确认所有管理员 RPC 在 AAL1 下被拒绝。
- Gmail 管理员必须使用精确地址、私有、限期 `upc_admin_invites` 邀请；学生自助注册不等于管理员。
  首个 `super_admin` 按 `docs/upc-auth-setup.md` 的受控 SQL 引导，之后用 AAL2 RPC 管理。
  隔离环境已验证该路径；WSL 目标库已应用补丁，新管理员已激活并绑定 1 个 verified TOTP。
- 云端 GoTrue 版本必须支持 `pg-functions://` Hook；本机验证版本为 GoTrue v2.197.0。
- 目标环境需复验邮箱变更确认链接、旧 token 失效、recovery 与新密码路径。

### 6.2 邮件与域名

- 外部 SMTP 尚未配置/验收；本机 Mailpit 只证明本机链路。
- 发信域名、SPF/DKIM/DMARC、退信处理、发信限额、隐私政策中的服务商信息待运营确认。
- 正式域名、TLS、备案/运营手续、学校名称/标识授权待确认。

### 6.3 运营与合规

- 运营主体、联系渠道、申请响应时限、日志/备份保存期限、删除执行时限未确认。
- 隐私政策、用户协议、评分规则、举报与撤回说明、独立学生项目声明需按真实信息编写并发布。

### 6.4 删除与保留

- `scripts/process-account-deletion.mjs` 默认 dry-run；只有 `--execute --confirm` 才执行。
- 执行前必须核对请求状态、备份、影响范围和授权；本机未执行真实删号。
- 审计日志与最小奖励防滥用标记为保留项，需在隐私政策中说明期限与依据。
- 缓存（若启用）需显式失效；本机 `VITE_CACHE_API_ENABLED=false`，未验证 Redis 旁路。

## 7. 复现命令

```powershell
npm run schema:build
npm run lint
npm test
npm run test:server
npm run build
npm run security:audit
npm run security:verify-auth
npm run security:verify-db
```

浏览器脚本位于 Git 忽略的 `temp/upc-browser/`；它们使用本机合成账户并在结束时清理。


## 8. 2026-10-24 管理员策略纠正与治理边界收尾

### 8.1 管理员规则（已落地到代码，并已应用到 WSL 目标库）

- 管理员只能由运营者手动指定，使用 `@gmail.com`；`@upc.edu.cn` 不开放普通注册，也不再是邀请目标。
- Gmail 不能自助注册；仅精确地址、未过期、未使用的私有邀请允许创建账号。
- 邀请只创建 Auth 账户，不自动写入 `admin_users`；确认邮箱后仍须按稳定 `user_id` 单独授权。
- 邀请与角色 RPC 仅限 AAL2 `super_admin`；普通用户、普通管理员、AAL1 超级管理员均拒绝。
- 管理员邮箱变更被数据库触发器拒绝；学校域历史邀请即使存在，也会被新的
  `private.upc_admin_invite_ok` 拒绝。
- 审计时现有真实本机库仍有 1 个旧 `example.test` 管理员绑定，已绑定 Auth `user_id` 且
  active。**当时只报告，未撤权、未改邮箱、未改角色；后于 2026-10-24 由运营者停用，
  账户/角色/MFA 保留，迁移不得恢复权限。**

### 8.2 `set_admin_role` 冲突修复

源 SQL、生成的 `owner-admin-policy.sql` 和隔离测试均使用：

```sql
ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE
```

以匹配 `admin_users_user_id_uidx` 部分唯一索引。隔离环境已验证新增授权、重复授权、角色更新、
审计写入，以及学校域目标拒绝；没有创建真实管理员。

### 8.3 历史账户治理边界

原触发器在管理员审核/驳回/撤回历史非学生评价时，会按 `NEW.user_id` 校验学生邮箱并阻断治理。
现在：

- 新评价 INSERT 仍校验提交账户；
- 作者本人更新评价仍校验；
- 管理员/服务角色治理更新不再按历史评价者邮箱阻断；
- 历史非学生作者直接改评分仍被 RLS/触发器拒绝。

PGlite 已覆盖管理员通过/驳回/治理撤回历史评价，以及历史作者改分被拒；隔离环境验证了真实审核
与治理链路。

### 8.4 withdrawn 与重复业务键

`reviews_business_key_uidx` 现在只约束 `status <> 'withdrawn'` 的活动记录：

```sql
WHERE user_id IS NOT NULL AND status <> 'withdrawn'
```

- 撤回保留原评价行，不删除历史；
- 撤回后同一业务键可重新提交，不产生两条活动记录；
- 预检只统计非 withdrawn 的重复组；有活动重复时整笔迁移失败并输出组数；
- 预检不再声称“withdraw 即可消除重复”；运营者必须保留全部行并决定保留/归档映射，
  不自动删除、合并或改分；
- `governance-boundary.sql` 会先预检，再替换旧索引；任何失败回滚，旧索引恢复。

### 8.5 隔离 E2E（55 项通过，历史轮次；最新 79 项见第 9 节）

环境：独立 native Supabase，端口 54421/54422/54424，独立 `project_id`；只执行
`supabase/upc-init.sql` 和合成数据。未连接现有本机库或云端；未向真实 Gmail 发信。
运行产物在 Git 忽略的 `temp/isolated-supabase/`，合成账号不进入 Git。
E2E 后又在同一隔离库按顺序应用 `20261024-owner-admin-policy.sql` 和
`20261024-governance-boundary.sql`，两者均成功；当时尚未应用到现有库，实际执行见第 11 节。

覆盖：

- 学生公开注册、未确认、Mailpit 确认链接、确认后登录；
- Gmail 无邀请拒绝；学校域邀请/历史学校邀请拒绝；
- 私有 Gmail 邀请创建账号；无自动管理员；
- AAL1 超管不能邀请/配置角色；TOTP 后 AAL2 可邀请；
- 普通学生、普通 AAL2 管理员不能邀请/配置角色；
- 新增授权、重复授权、角色更新、审计、学校域目标拒绝；
- Gmail 管理员邮箱变更被拒；
- 学生邮箱变更：请求、旧/新确认链接、最终邮箱落地、非学生域拒绝；
- 合成账户注销：Auth 先失效、评价/点赞/积分/治理/资料/统计清理、旧会话写入失败、
  奖励标记保留、审计保留；
- 强制评价删除失败后：Auth 已失效、残留数据明确报告为 `failed`；修复后用
  `--user-id` 续跑，最终 `completed` 且后置计数全 0。

报告：`temp/isolated-supabase/e2e-report.md`（历史轮次 55 项；最新 79 项见第 9 节）。
该报告是隔离测试证据，不是目标库或生产验收；目标库另有第 11 节证据。

### 8.6 当前状态分层

| 层级 | 状态 |
| --- | --- |
| 代码完成 | 是：源 SQL、生成 SQL、补丁、UI/服务、脚本已更新 |
| 隔离验证通过 | 是：本轮 52 根测试、18 服务测试、构建、79 项隔离 E2E、12 项并发、17 项浏览器（第 9 节） |
| 现有本机库已生效 | **当时否**；后 WSL 已应用全部补丁，云端也已迁移（见第 11/13 节） |
| 云端/生产已验收 | **否**：当时未部署；后云端 DB/Auth 已迁移，但生产部署/SMTP/域名仍未验收 |

### 8.7 补丁顺序

1. `20261024-security-governance.sql`
2. `20261024-owner-admin-policy.sql`
3. `20261024-governance-boundary.sql`
4. `20261024-remove-teacher-appeal.sql`
5. `20261024-governance-correction-closure.sql`
6. 重启 GoTrue 使 Hook 生效；管理员绑定 TOTP
7. 新空库才执行完整 init；已有库禁止重跑完整 init

### 8.8 仍未完成

- P1-02 运营主体、联系方式、响应时限、保存期限、合规结论。
- 现有本机库补丁应用、旧管理员复核/迁移、真实云端 Auth 与外部 SMTP。
- 真实管理员 MFA 丢失设备恢复未执行；合成演练 23/23 通过。
- 实际生产备份/恢复、缓存/Realtime 旁路未验收。


## 2026-10-24 范围调整：删除教师评分申诉

按运营者要求移除教师评分申诉，不再要求外部教师申诉渠道或后台代录。
保留教师资料纠错、课程/授课关系纠错、评价举报、作者撤回和账号删除申请。
创建入口、服务方法、申请类型和代录 RPC 已移除；历史申请和审计记录保留，不自动删除。
已有库在其余安全补丁之后执行 `supabase/upgrades/20261024-remove-teacher-appeal.sql`。
该迁移已应用到 WSL 目标库；云端/生产尚未应用。上文历史申诉实现描述不再代表当前功能范围。

本次移除验证：根测试 49/49、服务测试 18/18、TypeScript 和生产构建通过。新增隔离数据库用例验证代录 RPC 不存在、新建被拒、历史记录保留且补丁可重复执行。

## 9. 2026-10-24 申诉删除复核与资料纠错闭环

### 9.1 范围结论

- 教师评分申诉不再属于当前产品或上线范围：不恢复入口、申请类型、代录 RPC 和外部申诉渠道。
- 保留教师资料纠错、课程/授课关系纠错、评价举报、作者撤回和注销申请。
- 历史 `teacher_appeal` 申请和审计记录保留；应用删除补丁不会删除或改写历史行。
- 历史申请仍可能保留旧 `request_type` CHECK 值，但新的类型守卫会拒绝任何新建/改写为
  `teacher_appeal` 的写入；历史记录只读保留。
- P1-02 的运营主体、联系方式、响应时限、保存期限和合规结论仍未确认，未写入占位信息。

### 9.2 实际纠错行为与权限

新增 `public.apply_governance_correction(p_request_id, p_patch, p_source_basis)`：

1. 必须是 `admin_users` 中 active 的 `admin`/`super_admin`，并且当前会话为 **AAL2**；
   普通学生、普通 moderator、AAL1 管理员均拒绝。
2. 申请必须是 `teacher_profile_correction` 或 `course_offering_correction`，状态为
   `submitted`/`triaged`/`in_review`/`accepted`；`rejected`/`withdrawn`/`completed` 拒绝。
3. 只允许白名单字段：
   - 教师：`name`、`title`、`collegeCode`、`campus`；
   - 课程：`name`、`code`、`collegeCode`；
   - 授课关系：`add`/`remove`，以及 teacher/course/term/source 标识。
4. 无实际差异时整笔拒绝，不允许“只改申请状态”宣称完成。
5. 写回、申请完成、治理事件、管理员审计在同一事务内完成；任何校验失败全部回滚。
6. `private.upc_data_corrections` 保存 `before_data`、`after_data`、来源依据、关联申请、
   操作管理员与目标；`private.upc_correction_pins` 保存受保护字段。
7. 删除授课关系前统计同教师×课程×学期的评价和公开统计引用；有引用时整笔拒绝并报告数量，
   不删除、不转移评价，也不修改统计。
8. 新增授课关系校验教师/课程/学期存在、组合唯一，并清除同一组合的“已删除”保护标记。
9. `process_governance_request` 对纠错类型禁止直接设置 `accepted`/`completed`；
   只能用于 triaged/in_review/rejected 等状态，完成必须走实际写回 RPC。
10. 注销流程删除申请人的治理申请时，纠错台账和保护钉的 `request_id` 通过
   `ON DELETE SET NULL` 脱钩而不是阻止删除，也不撤销已确认的目录纠正；台账只保留
   目标、前后值、来源依据和管理员操作，不含申请人语句。

前端：

- 教师详情新增“资料纠错”入口，带入 `teacherId`；“主讲课程”和“按课程 × 学期”每行新增
  “纠错”入口，带入 `teacherId + courseId`；
- 个人中心已公示评价新增“申请撤回”，带入 `reviewId`；举报仍从评价卡片进入；
- 通用治理弹窗只办理注销申请，并提示纠错/举报/撤回的专用入口，避免提交无目标申请；
- 管理后台治理页签新增教师/课程/授课关系编辑面板和“写回并完成”按钮；
- 管理员必须在 AAL2 强验证后进入；普通用户只能提交申请，不能直接改教师、课程或开课表；
- 仍不在公开页面展示申请说明和来源依据。

重导入保护：

- `import_upc_dataset` 对教师 `name/title/college_id/campus`、课程 `name/code/college_id`
  读取纠正钉；来源批次即使仍带旧值，只更新未受保护字段，并在摘要中报告
  `protectedFields`。
- 已确认删除的授课关系以 `teacher|course|term` 复合键记录；重导入不会重新创建，
  摘要报告 `protectedRelations`。
- 课程编码已被纠正固定、而来源仍使用旧编码时，导入失败并提示人工核对，避免静默生成重复课程。
- 历史数据、评价、积分、点赞、审计行均不因重导入或纠错被删除。

### 9.3 数据库与升级路径

> 以下是 2026-10-24 较早时段的隔离升级记录；WSL 原库的实际执行、备份哈希和
> 管理员配置见第 11 节。历史段落中的“未改真实库”只描述当时状态。

新增源码/生成物：

- `supabase/security-schema.sql`：纠正台账、保护钉；
- `supabase/security.sql`：管理员会话有效性校验（`upc_session_is_current`）；
- `supabase/governance.sql`：队列投影字段、写回 RPC、状态完成限制；
- `supabase/import-upc.sql`：受保护字段与删除关系保护；
- `supabase/upgrades/20261024-governance-correction-closure.sql`：已初始化库的增量补丁；
- `supabase/upc-init.sql`、`supabase_schema.sql`：重新生成的完整初始化；
- `scripts/build-schema.mjs`：生成上述补丁，避免源文件与生成物漂移。

已初始化库顺序（本轮复核）：

1. `20261024-security-governance.sql`（新版，可覆盖旧版同文件）
2. `20261024-owner-admin-policy.sql`
3. `20261024-governance-boundary.sql`
4. `20261024-remove-teacher-appeal.sql`
5. `20261024-governance-correction-closure.sql`

**现有本机库升级证据（执行前，未改真实库；实际执行见第 11 节）**：

- 先对现有本机库做只读 `pg_dump`，完整库
  `temp/security-backups/upc-local-current-20261024T1130Z.dump`（SHA-256
  `788a36ef184ec3d5163d161947adcdcf3e8abe8e7abe66e13bc8a39c5ab47e71`）；
  仅 public/private/auth schema 的副本
  `temp/security-backups/upc-local-current-schemas-20261024T1130Z.dump`（SHA-256
  `ac1292eb11e70ac677190b1468ba8f6aec2d7cdac34ebff6d7d7cda0cdf2e587`）。
- 副本还原到独立 native Postgres 数据库，升级前确认：旧 `create_proxy_teacher_appeal`
  存在、旧非 withdrawn 唯一索引、无纠正表，6 用户 / 1,555 教师 / 1,342 课程 /
  2,946 开课关系 / 1 条评价 / 0 申请。
- 按上述 5 个文件顺序执行，再完整执行第二遍；两次均成功。升级后数据量与升级前一致，
  `appeal_rpc=none`，纠正表/保护钉存在，类型守卫 1 个，业务唯一索引带
  `status <> 'withdrawn'` 条件。
- 另在全新数据库执行 `upc-init.sql`，再执行上述 5 个补丁两遍，均成功；17 个学院，
  无历史业务数据。

### 9.4 隔离运行验证（最新版本）

| 验证 | 结果 | 说明 |
| --- | --- | --- |
| 根测试 `npm test` | **53/53** | 新增纠错写回、重复处理、越权、引用冲突、重导入保护、注销后证据脱钩、MFA 恢复 RPC、管理员会话绑定 |
| 服务测试 `npm run test:server` | **18/18** | 公开投影、缓存、权限回归 |
| 类型检查 `npm run lint` | 通过 | 含新增管理面板和教师详情入口 |
| 生产构建 `npm run build` | 通过 | Vite 构建 |
| 隔离 native Supabase E2E | **79/79** | Gmail 邀请、AAL2、学生邮箱、纠错写回、重导入、注销/恢复 |
| SEC-G0 补充回归 | **26/26** | 目录筛选/分页/空/失败、评价改审/举报、moderator、退出/找回、移动目录 |
| MFA 恢复演练 | **23/23** | service-role-only、撤会话、审计、重绑 AAL2、拒绝越权 |
| 真实独立连接并发 | **12/12** | 唯一键、60 秒限频、并发审核奖励、撤回重提不重复、4/5 人门槛、撤回降门槛 |
| 桌面/移动浏览器 | **17/17** | 注册确认、登录、搜索/详情、签到、评分、审核积分、点赞、纠错 UI、移动流程 |

隔离 E2E 中的纠错用例覆盖：

- 学生提交申请后，AAL1、学生本人均不能写回；
- AAL2 管理员写回教师姓名/职称/校区，实际行变化、申请 completed、台账有 before/after；
- 重复写回被拒绝；
- 旧名称重导入保留纠正值并报告 `protectedFields`；
- 课程重命名后旧名称重导入保留纠正值；
- 有评价引用时删除授课关系被拒绝；清除引用后可删除，重导入不会复活；
- 新增缺失授课关系成功；
- 驳回不改变基础数据。

并发脚本另验证：同一业务键两条独立连接只成功一条；同一账户两条连接在 60 秒窗口只成功一条；
并发审核只发一次 20 分；撤回后换新 ID 重提不重复发奖；4 人隐藏、5 人公开、撤回后重新隐藏。

浏览器脚本使用隔离栈合成账号；真实 Gmail 未收信，管理员通过私有邀请创建；未使用真实账户或
真实管理员权限。

### 9.5 现有库应用补丁前的影响、备份与回退

> 以下是执行前的影响/回退方案；实际执行结果见第 11 节。真实库已在维护窗口内升级，
> 备份与恢复核对已完成。

**影响**：

- `security-governance` 会创建/替换安全表、RLS、公开投影、审核/奖励/审计 RPC、
  治理表和 Hook 函数；`governance-boundary` 会短暂锁 `reviews` 替换唯一索引；
- `remove-teacher-appeal` 删除旧代录函数并安装类型守卫，不删除历史申请；
- `governance-correction-closure` 新增两张私有表、替换治理队列视图/状态 RPC/导入 RPC，
  不删除业务行；
- 现有 6 个历史非学生账户仍可登录和查看本人资料，但不能新增评价；旧 `example.test`
  管理员绑定不会被自动撤销或改权，需运营者单独决定；
- 6 条无主奖励关联继续保持 `needs_verification`，不补发、不追溯扣分。

**备份**：

1. 维护窗口前对现有本机库执行 `pg_dump --format=custom`，保存到 Git 忽略目录，
   记录 SHA-256 和恢复命令；本轮只读备份已生成，但不作为执行授权。
2. 同时导出 `pg_dump --schema-only` 或保存迁移前对象清单，便于比对。
3. 应用前记录教师/课程/开课/评价/积分/治理申请计数和备份哈希。

**回退**：

- 迁移文件均为单事务；失败自动回滚，保留旧对象。
- 成功后如需回退，优先恢复迁移前备份到独立库核对，再按维护窗口恢复；
  不通过重新执行旧 `20261023-four-point-rating.sql` 回退，因为它会重建旧 `review_feed`
  并重新公开身份/精确时间。
- 回退不得重新开放非学生注册、公开身份、文字评论或低于门槛的分数；必要时关闭写入/
  公开评分，保留目录检索。
- 本节是执行前方案；实际执行和验证见第 11 节，当前无需回退。

### 9.6 本轮修改文件（增量）

- `supabase/security-schema.sql`、`supabase/governance.sql`、`supabase/import-upc.sql`
- `supabase/upgrades/20261024-governance-correction-closure.sql`
- `supabase/upgrades/20261024-security-governance.sql`、`supabase/upgrades/20261022-course-code-identity.sql`
  （由生成器同步包含新的治理/导入逻辑）
- `supabase/upc-init.sql`、`supabase_schema.sql`、`scripts/build-schema.mjs`
- `src/types.ts`、`src/services/supabaseService.ts`
- `src/components/AdminAuditModal.tsx`、`src/components/TeacherDetailModal.tsx`
- `src/components/GovernanceModal.tsx`、`src/components/ReviewModal.tsx`
- `src/components/desktop/DesktopUserProfile.tsx`、`src/components/mobile/MobileUserProfile.tsx`
- `src/App.tsx`
- `tests/upc-schema.test.mjs`
- 文档：本文件、专项计划、迁移总计划、鉴权说明、注销 runbook、隐私草案

### 9.7 仍需运营者提供的最小信息

- P1-02：运营主体、联系渠道、申请响应时限、日志/备份/删除期限、合规结论；填写表见 `docs/upc-p1-02-operations-form.md`；
- 目标 Supabase 项目、外部 SMTP/发信域名、正式域名/TLS/回调白名单；
- 现有 `example.test` 管理员是撤销还是重建；真实 Gmail 管理员地址由运营者私下提供；
- 现有本机库补丁执行授权、维护窗口和备份恢复演练时间。



## 10. 2026-10-24 SEC-G0 收尾、MFA 恢复与现有库升级操作单

### 10.1 SEC-G0 有限验收

不再以“历史全套页面未重跑”作为无限阻塞，而是按当前产品规则定义有限清单：
学生/Gmail 管理员/Auth、目录检索筛选分页空态失败、六维评分与审核、纠错/重导入、
举报/撤回/注销、5 人门槛、角色/AAL 边界、旧库升级路径。逐项矩阵和证据见
`docs/upc-sec-g0-acceptance.md`。

结果：

- **隔离通过**：79 E2E + 12 并发 + 17 浏览器 + 26 SEC-G0 补充 + 23 MFA 恢复；
  根测试 53/53、服务测试 18/18、lint/build 通过。
- **WSL 目标库已生效**：五份补丁已执行，post-check 通过，业务计数不变；仅新增管理员使 Auth/管理员计数变化；目标库会话验收 10/10。
- **云端数据库/Auth 已迁移**：托管项目 schema/正式数据/Auth Hook/TOTP/URL 和专项检查通过；
  外部 SMTP、完整 79 E2E、域名/TLS、发布回滚仍属后续。
- **P1-02 运营信息冻结**：本轮不修改、不再追问；仍不是已发布政策。

### 10.2 本轮新增/修复

- 新增 `public.record_admin_mfa_recovery(uuid,text,text,text[])`：仅 service role 可执行，
  写入管理员审计并撤销目标账户全部 Auth 会话；不修改密码、角色或 active。
- 新增 `private.upc_session_is_current()`：管理员校验把 JWT 的 `session_id` 绑定到
  `auth.sessions`；`upc_admin_record`、管理员队列/目录/计数、`get_my_admin_status` 和
  所有敏感 RPC 都经过该检查。会话删除后旧 AAL2 access token 立即失去管理员权限，
  不再只依赖 refresh 失效或 JWT 过期。
- 新增 `scripts/recover-admin-mfa.mjs`：只读预检/显式执行/确认；通过 Auth Admin API
  删除 factor，再调用审计 RPC；远程库需显式环境变量和变更单。
- 根测试新增“撤销 AAL2 会话后审核/邀请/身份查询/队列拒绝、新会话恢复”用例；MFA 演练
  保留恢复前 access token，恢复后直接调用以上入口均被拒绝，新登录重绑后恢复。
- 新增 `supabase/upgrades/20261024-preflight.sql`、`20261024-postcheck.sql`：
  只读目标校验、旧状态/计数/索引/公开投影检查和升级后验收。
- 新增 `docs/upc-existing-db-upgrade-runbook.md`：备份、锁、逐文件执行、失败回滚与
  成功后恢复、Gmail 管理员引导、旧管理员去留、MFA 恢复。
- 新增 `docs/upc-sec-g0-acceptance.md`、`docs/upc-p1-02-operations-form.md`。
- 未放宽评分、样本门槛、注册域或管理员权限；教师申诉未恢复。

### 10.3 MFA 恢复隔离演练

对合成 `super_admin` 执行：

1. 先以旧 TOTP 达到 AAL2，确认可邀请管理员；
2. 只读预检列出 1 个 verified TOTP factor；
3. 未加 `--confirm` 时脚本拒绝执行；
4. 加 `--execute --confirm` 后删除 factor、撤销 1 个会话、写入
   `admin_mfa_recovery` 审计（操作人、原因、factor 标识、会话数、角色/active）；
5. 角色仍为 `super_admin`、active 仍为 true；
6. 恢复后旧 AAL2 access token 直接调用审核、邀请、身份查询和管理投影全部被拒；
7. 原密码重新登录只得到 AAL1，敏感邀请 RPC 被拒绝；
8. 重新绑定新 TOTP 后达到 AAL2，邀请恢复；
9. 普通用户和 AAL2 管理员均不能调用恢复审计 RPC；只有 service role 可以。

结果 **23/23**，报告在 `temp/isolated-supabase/mfa-recovery-report.json`（Git 忽略）。
真实管理员未操作；真实恢复仍需运营者身份核验、变更单和授权。

边界：管理员入口已绑定 `auth.sessions`，所以旧 AAL2 token 不再能执行审核/邀请/身份查询；
普通用户接口仍可能接受未过期的签名 JWT。高风险场景可缩短 JWT TTL，但不需要用全局轮换
签名密钥来解决单个管理员恢复。

### 10.4 现有库升级操作单与执行

- 升级前现有库是旧 `security-governance`：旧代录 RPC 存在、纠错 RPC/表不存在、旧非
  withdrawn 唯一索引；数据 6 用户/1,555 教师/1,342 课程/2,946 关系/1 评价/0 申请。
- 2026-10-24 已对现有库执行只读 `20261024-preflight.sql`（`BEGIN READ ONLY`，exit 0）：
  旧申诉 RPC 存在、纠错 RPC/表不存在、重复组 0、计数
  6/1555/1342/2946/1/0/14/0/1。
- 精确顺序：`security-governance` → `owner-admin-policy` → `governance-boundary` →
  `remove-teacher-appeal` → `governance-correction-closure`。
- **2026-10-24 18:xx 已按顺序对 WSL 原库执行一次，全部 COMMIT；备份哈希、恢复核对、
  post-check 和数据计数见第 11 节。**
- 旧库克隆曾按序执行两遍，数据不变；空库 init + 五补丁两遍成功；post-check 确认管理员
  session guard 存在且 authenticated 不可直接调用。
- 操作单包含：目标校验、只读 preflight、维护窗口/锁、备份+哈希+隔离恢复核对、
  逐文件失败即停、post-check、失败/成功分开的回退、Gmail 管理员引导、旧管理员去留、
  MFA 恢复。旧管理员未自动撤权。
- 新管理员 `operator@example.com` 已建 Auth 账户和 `super_admin` 行；已完成密码设置和 TOTP 绑定。
- P1-02 运营信息已冻结，本轮不修改、不再追问；仍不是已发布政策。

### 10.5 仍需决定/后续输入

- P1-02：运营信息已冻结，本轮不修改、不再追问；仍不是已发布政策。
- 目标 Supabase 项目、外部 SMTP/发信域名、正式域名/TLS/回调白名单。
- 现有 `example.test` 管理员保留/停用/重建决定；新 Gmail 管理员需完成密码/TOTP。
- 云端/生产迁移、备份恢复演练时间。
- 真实管理员 MFA 恢复的线下身份核验方式、审批人和变更单流程。


## 11. 2026-10-24 WSL 目标库实际升级与管理配置

### 11.1 目标库身份

- 本轮实际升级的是 WSL **原有** native 栈：
  - stack id `0499baa1a3c04d3f312a1c84794df9e7952806d02ea380c8491db7e6cd0c62ba`；
  - project `/path/to/xiaoshizi`，name `default`，runtime native；
  - API `127.0.0.1:54321`，DB `127.0.0.1:54322`。
- 隔离验收栈是另一个库：
  - stack id `d5bce50f...`，project `/path/to/xiaoshizi/temp/isolated-supabase`；
  - API/DB 端口 `54421/54422`；
  - 79 E2E、26 SEC-G0、23 MFA、12 并发、17 浏览器均在这个隔离栈运行，不是目标库。
- 报告中的“现有真实库未升级”指上述 `0499...` 原库；该结论在本轮执行前成立，执行后已更新。

### 11.2 升级前状态与备份

- 升级前只读 preflight（exit 0）：
  - 旧 `create_proxy_teacher_appeal` 存在；
  - 无 `apply_governance_correction`、无纠错台账/保护钉；
  - 重复业务组 0；
  - 6 用户 / 1,555 教师 / 1,342 课程 / 2,946 开课关系 / 1 评价 / 0 申请 /
    14 积分流水 / 0 点赞 / 1 管理员（`example.test`，super_admin，active）。
- 备份（Git 忽略）：
  - `temp/security-backups/wsl-target-20261024T1010UTC.dump`
    SHA-256 `adb427ec3bd45d60d98f0c3753a2f8c88c6c1bfeece309c4fa8f459cd19d0b2a`；
  - `temp/security-backups/wsl-target-schema-20261024T1010UTC.dump`
    SHA-256 `a88d7ae783832dd686679136bc87e1c6ef904daee01010c83c554e6fb6c451eb`。
- 备份已恢复到独立库 `upc_wsl_pre_upgrade_verify_20261024` 并核对计数：
  `6/1555/1342/2946/1/0/14/1`。恢复仅出现 realtime/vault 扩展内部权限告警，
  应用表、Auth 用户、教师/课程/评价/积分/管理员计数一致。

### 11.3 实际执行

按操作单顺序逐文件执行，全部 `COMMIT`：

1. `20261024-security-governance.sql`
2. `20261024-owner-admin-policy.sql`
3. `20261024-governance-boundary.sql`
4. `20261024-remove-teacher-appeal.sql`
5. `20261024-governance-correction-closure.sql`

执行后 post-check：

- `apply_governance_correction`、`record_admin_mfa_recovery`、`upc_session_is_current`
  均存在；
- 纠错台账/保护钉存在；旧申诉 RPC 不存在；review guard trigger 存在；
- `reviews_business_key_uidx` 带 `status <> 'withdrawn'`；
- `anon` 不能写回/恢复 MFA，`authenticated` 不能直接调用 session guard；
- 五补丁执行后、管理员配置前，数据计数与升级前完全一致：`6/1555/1342/2946/1/0/14/0/1`；
  随后仅新增 Gmail 管理员，`admin_users` 变为 2，其他业务计数不变；
- 旧管理员当时仍为 `example.test | super_admin | active`；后于第 13 节由运营者停用，账户/角色/MFA 保留。

随后停止并重新启动目标栈，让 GoTrue 读取当前 `config.toml` 的 Auth Hook/MFA 配置；
数据库数据保留。目标栈仍为 `127.0.0.1:54321/54322`。

### 11.4 管理员配置

- 已创建 `operator@example.com` 的一次性私有邀请，并受控确认账户：
  - Auth 用户存在；
  - `admin_users` 行存在，角色 `super_admin`，active=true；
  - 当前 MFA factor 数 1，status=verified；
  - 未设置/输出密码，未替运营者完成 MFA。
- 本机没有外部 SMTP，未向 Gmail 发信；账户已确认并完成密码/TOTP 激活。
  一次性密码设置链接使用后已删除，不在仓库或报告中保留 token。
- 现有旧管理员 `example.test` 已停用；账户/角色/MFA 保留，未删除/未重置 MFA，迁移不得恢复权限。
- 目标库当前管理员：旧 `example.test` 1 个（已停用）+ 新 `gmail.com` 1 个（active），共 2 行、active 1 个。
- 最终计数：Auth 用户 7（6 原有 + 新管理员）、管理员 2、profile 7（含新管理员 0 分 profile）、
  积分流水 15（含新管理员 1 次 5 分签到）；教师 1,555、课程 1,342、开课关系 2,946、
  评价 1、治理申请 0 均未变。

### 11.5 目标库会话失效验收

使用专用合成管理员（验证后已删除；不是 `operator@example.com`）：

- 目标库真实登录并完成 TOTP AAL2；
- 删除该用户全部 `auth.sessions` 后：
  - 旧 refresh token 失效；
  - 旧 AAL2 access token 调 `get_my_admin_status` 返回 `is_admin=false`；
  - 调 `approve_review` 返回 `无审核权限`；
  - 调 `create_admin_invite` 返回 `无审核权限`；
- 重新登录只有 AAL1；用原 TOTP 再验证后恢复 AAL2，审核授权路径恢复；
- 结果 **10/10**，报告 `temp/isolated-supabase/wsl-target-session-report.json`。
- 目标库 Auth Hook 另行验证：无邀请 Gmail 注册返回 400、未创建用户；
  日志 `temp/isolated-supabase/target-auth-hook-check.log`。
- 专用账号和引导账号创建时触发的新用户 welcome 积分/profile 共 4 条，已按 id 清理；
  积分流水曾恢复 14；删除 3 个合成 profile，保留新管理员 profile；随后新管理员签到 +5，当前 15。业务评价/教师/课程计数未变。

这次验收直接证明：不需要全局轮换签名密钥，单个管理员恢复后旧 AAL2 token 也无法执行
管理员操作。

### 11.6 当前边界

- 目标 WSL 库已应用全部五份安全补丁；隔离证据仍独立保留。
- 托管项目 `your-project-ref`（ap-southeast-2，Postgres 17.11）已完成 schema 和
  正式业务数据迁移；Auth Hook/TOTP/URL 已配置；云端 `operator` 已完成密码、1 个 verified
  TOTP 和登录 session。
- 云端验收：Hook 1、会话 10/10、角色 6/6、评价提交 4/4、浏览器 5/5、核心生命周期
  25/25、纠错 4/4；已修复 hosted 表权限缺失并纳入 `cloud/grants.sql`。
  合成业务数据已清理；审计不可篡改，保留 16 条 cloud-e2e 测试日志。
  **云端完整 79 项 E2E、真实邮件、正式域名/TLS、服务器部署未完成。**
  逐项对照见 `docs/upc-cloud-e2e-coverage.md`；邮件见 `docs/upc-email-resend.md`；
  服务器/域名见 `docs/upc-server-deployment-prep.md`。
- P1-02 运营信息已冻结，本轮不修改、不再追问；仍不是已发布政策。
- WSL 管理员已激活并绑定 TOTP；旧 WSL 管理员已停用；云端 `operator` 已完成密码和
  1 个 verified TOTP。旧 `example.test` 未迁移。

## 12. P1-02 / SEC-G1 / P4 逐项状态（2026-10-24）

### 12.1 P1-02 运营信息

运营者已明确冻结：本轮不修改、不再追问。仍为**未完成**，缺以下输入，不以占位符代替：

- 运营主体全称、统一社会信用/学校授权；
- 隐私/安全联系人和公开联系方式；
- 举报/删除申请响应时限、账号与数据删除时限；
- 评价、日志、备份、审计记录的保存期限；
- 合规结论及学校名称/标识使用授权。

### 12.2 SEC-G1 上线前复验与交付

| 项目 | 状态 | 缺什么 |
| --- | --- | --- |
| WSL 目标库五补丁 | 已完成 | 备份、恢复核对、post-check；业务计数不变，Auth/管理员仅新增引导账号 |
| WSL 目标库管理员会话失效 | 已完成 | 专用账号 10/10；旧 AAL2 token 拒绝、重登+MFA 恢复 |
| WSL 新 Gmail 管理员 | 已完成 | Auth 账户、密码、1 个 verified TOTP、`super_admin`、active 均已确认 |
| 旧管理员去留 | 已完成 | 已停用；账户/角色/MFA 保留；迁移不得恢复权限 |
| 云端 Supabase 项目 | 已完成数据库/Auth迁移 | `your-project-ref`，ap-southeast-2，Postgres 17.11；迁移前 public/auth 为空 |
| 云端迁移包 | 已应用 | schema + 正式数据；摘要与 WSL 一致；无测试评价/账号 |
| 云端迁移执行 | 已完成 | 17/1/1555/1342/2946；FK 缺失 0；Auth Hook/TOTP/URL 已配置 |
| 云端管理员 | 已完成 | `operator@example.com` super_admin/active/confirmed；1 个 verified TOTP、1 个 session |
| 云端专项验收 | 部分 | Hook 1、会话 10、角色 6、评价 4、浏览器 5、核心 25、纠错 4；完整 79 E2E 未跑 |
| 外部 SMTP/真实邮件 | 未执行 | 发信域名、DNS、限额、真实投递与链接打开 |
| 域名/TLS/回调白名单 | 未执行 | 正式域名、证书、Auth redirect allow-list |
| 云端备份/恢复/回滚 | 未执行 | free 计划 PITR=false、backups=[]；只有隔离逻辑恢复演练 |
| WSL 目标管理员首次登录+审核 | 部分 | 已登录并完成 TOTP；尚无独立可复核的审核审计证据 |
| P1-02 | 冻结/未完成 | 运营信息未提供 |

### 12.3 P4 一期部署与验收

| 项目 | 状态 | 实际覆盖/缺什么 |
| --- | --- | --- |
| P4-1 新环境与部署配置 | 部分 | WSL native 栈可启动；云端前端包/Nginx 示例已备；无服务器发布、域名/TLS 验收 |
| P4-2 构建与数据访问 | 部分 | 根测试 53/53、服务 18/18、lint/build 通过；云端 DB 已迁移、cloud 前端构建通过；未在服务器部署验证 |
| P4-3 端到端验收 | 部分 | 隔离 79 E2E + 17 浏览器通过；WSL 10 项会话；云端 26 项 + 核心 25 + 纠错 4；未跑完整 79 项 |
| P4-4 权限与数据边界 | 部分 | WSL post-check/10 项会话；云端 6 项角色 + 10 项会话；未跑完整角色矩阵 |
| P4-5 发布、备份与回滚 | 部分 | WSL 升级前备份+恢复核对；云端静态包已生成；无服务器发布、云端备份/回滚演练 |

结论：WSL 覆盖计入实际验收，但 P4 的“独立目标环境部署 + 发布/回滚”仍未完成；
不能把 WSL 结果写成云端或生产通过。


## 13. 2026-10-24 管理员启用与测试超管停用补充

本节更新前文中新管理员待启用、旧管理员去留待定的历史状态。

- 运营者在对话中确认：密码设置、登录并绑定 TOTP、管理队列访问及审核操作均可用。人工验收依据为运营者反馈，本轮未代替运营者重做审核。
- 按运营者明确指令，已将唯一 `example.test` 测试超级管理员的 `is_active` 设为 false；保留账户、角色和 MFA，未删除账户、未重置 MFA。
- 数据库回读确认：`operator@example.com` 仍为 active 的 `super_admin`，已验证 MFA factor 为 1；当前 active 管理员共 1 个。
- 执行证据：`temp/admin-invites/test-super-admin-disabled.json`（Git 忽略）。
- 本次仅停用测试管理员授权；未新增目标环境完整 E2E、角色矩阵、真实邮件或生产部署验收证据。
- P1-02 运营信息继续冻结。其余未完成项仍按第 12 节实际证据核定。
