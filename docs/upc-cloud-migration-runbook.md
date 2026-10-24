# UPC 托管 Supabase 迁移操作单（数据库已迁移，部署未执行）

更新：2026-10-24。目标：把当前 WSL `0499...`（54321/54322）的正式业务数据和全部安全
定义迁移到新建的托管 Supabase 项目；**不覆盖云端平台 schema，不迁移测试账号/评价/积分**。

**2026-10-24 20:xx 已实际执行**：项目 `your-project-ref`（ap-southeast-2，
Postgres 17.11.0.003），public/auth 迁移前为空；已应用 cloud schema、加载正式业务数据、
配置 Auth Hook/TOTP/URL，并创建 `operator@example.com` 云端 super_admin。尚未配置
外部 SMTP、正式域名/TLS，未部署服务器，未完成云端完整 79 项 E2E。操作记录见第 9 节。

## 1. 固定决策

- 前端静态页面和 Nginx 在现有阿里云东京 2C/2G 服务器；数据库/Auth/MFA 用托管 Supabase。
- 正式管理员：`operator@example.com`，云端角色 `super_admin`。
- `example.test` 测试超管**不迁移、不恢复权限**；WSL 上已停用/保留仅为历史。
- SMTP 尚未配置：真实邮件投递、真实 Gmail 收信和邮件链接点击**未验收**，不得写成通过。
- P1-02 运营信息继续冻结，本轮不修改、不追问。
- 不覆盖 example-site、不修改正式域名入口、不发布到服务器。

## 2. 需要运营者提供的云端接入信息

不要把密码、service_role key 或 access token 粘贴到聊天。放在本机 Git 忽略文件：

`temp/cloud/cloud.env`（从 `temp/cloud/cloud.env.example` 复制）：

| 变量 | 用途 | 获取位置 |
| --- | --- | --- |
| `SUPABASE_PROJECT_REF` | 项目标识 | Dashboard > Project Settings > General |
| `SUPABASE_URL` | 项目 URL，如 `https://<ref>.supabase.co` | Project Settings > API |
| `SUPABASE_ANON_KEY` | 浏览器公开客户端 key | Project Settings > API（publishable/anon） |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端创建管理员/验收；不得进前端 | Project Settings > API（secret/service_role） |
| `SUPABASE_DB_URL` | 直连 Postgres，执行 DDL/数据加载；密码需 URL 编码 | Project Settings > Database > Connection string |
| `SUPABASE_ACCESS_TOKEN` | 可选；CLI/Management API | Account > Access Tokens |
| `CLOUD_SITE_URL` | 当前联调 `http://localhost:3000` | Dashboard > Authentication > URL Configuration |

填好后运行 `npm run check:cloud`；只打印存在性和 host，不打印 key。

**最低可执行组合**：项目 ref + access token（`supabase login` 或写入上面文件）可走
`supabase db query --linked`；但 1.5 MB 数据包和 DDL 更建议同时给 `SUPABASE_DB_URL`。
如果只有 URL/anon key，无法执行数据库迁移，只能准备前端。

2026-10-24 20:14 运营者完成 WSL `supabase login`；已列出唯一项目
`your-project-ref`，并将公开/服务端 key 与 access token 写入 Git 忽略的
`temp/cloud/cloud.env`。云端只读核对见第 9 节。

## 3. 云端只读核对（已执行，保留复现步骤）

```bash
# 登录（交互，token 存本机，不经过聊天）
supabase login
supabase projects list
```

记录：项目 ref、名称、区域、创建时间、状态。然后只读查询：

```bash
supabase db query --linked --file supabase/cloud/cloud-preflight.sql
```

若使用直连：

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/cloud/cloud-preflight.sql
```

`cloud-preflight.sql` 只读检查：

- 当前数据库版本、`current_database()`、`current_user`；
- `public` 下已有表及行数；
- `auth.users`/`auth.identities`/`auth.mfa_factors` 是否已有数据；
- 现有 `public` 对象是否为空。

**停止条件**：`public` 已有任何业务表或非本项目数据、`auth.users` 已有正式用户、项目不是
本次新建目标。停止后不改写、不 reset、不 drop；先报告冲突。

## 4. 迁移包与本地预演（已完成）

生成：

```bash
npm run schema:build
npm run schema:cloud
```

产物：

- `supabase/cloud/upc-cloud-schema.sql`（144,334 字节，SHA-256 `4489b76c...9f34`；含 hosted grants）：base schema + security schema +
  authorization/RLS + governance/correction/MFA + Auth/review triggers + import RPC；
  **不含 seed colleges**，不创建/修改平台 auth/storage 结构。
- `temp/cloud/upc-cloud-data.sql`（Git 忽略，约 1.5 MB，5,872 条 INSERT）：
  - `colleges` 17
  - `terms` 1
  - `point_rules` 3
  - `private.upc_security_settings` 8
  - `teachers` 1,555
  - `courses` 1,342
  - `course_offerings` 2,946
  - **不含** auth users、user_profiles、reviews、review_likes、point_transactions、
    governance_requests、admin_users、import_batches、offering_rating_stats。
- 数据文件 SHA-256：`f7220534b64526b6b3f8bf697f716849f9be48fef4e4a0771d3bc860c36927a8`。

本地预演（已通过）：

- 在空库 `upc_cloud_bundle_verify_20261024` 应用 cloud schema，再应用 cloud data；
- 结果 `17/1/1555/1342/2946/0/0/8`（colleges/terms/teachers/courses/offerings/reviews/admins/settings）；
- 外键缺失 0、课程学院缺失 0；
- 与 WSL 源库逐表内容摘要完全一致：
  teachers `62d8c080...`、courses `f0e381ff...`、offerings `4f7c5dd2...`、
  colleges `4285801a...`、terms `a00af5ce...`、point_rules `3bdecf14...`；
- postcheck 的 RPC/session guard/旧申诉 RPC 状态正确。

## 5. 云端执行顺序

### 5.1 备份

- WSL 源库已有备份：
  `temp/security-backups/wsl-source-pre-cloud-20261024T1149UTC.dump`
  SHA-256 `4a9ea81d...b450d1`。
- 云端项目如已有任何数据，先在 Dashboard 创建备份/快照；不执行 reset。
- 记录云端当前 `auth.users`/`public` 表和行数。

### 5.2 应用 schema（空 public）

在 SQL Editor 或：

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/cloud/upc-cloud-schema.sql
# 或
supabase db query --linked --file supabase/cloud/upc-cloud-schema.sql
```

- 文件自带 `BEGIN/COMMIT`；失败必须整体回滚并停止。
- 不执行 `upc-init.sql`（含 colleges seed，会用新 UUID），不执行 `db reset`。
- 若 `auth.users` trigger 权限被平台拒绝，停止并报告；不要改 auth schema owner 或强删对象。
- 应用后检查函数、RLS、公开投影、纠错表和 session guard。

### 5.3 加载正式数据

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f temp/cloud/upc-cloud-data.sql
```

- 只加载 colleges/terms/point_rules/security_settings/teachers/courses/offerings。
- 不加载测试评价、测试账号、积分、治理申请、admin_users。
- 校验数量、稳定 ID、外键和内容摘要（同第 4 节）。
- 若目标已有同 ID 行，使用 `ON CONFLICT DO NOTHING` 只允许幂等重跑；出现内容不一致先停止。

### 5.4 Auth/MFA/URL 配置（控制台，不能只迁 SQL）

在 Dashboard 配置：

1. Authentication > URL Configuration：
   - Site URL：当前联调 `http://localhost:3000`；正式域名确定后再改；
   - Redirect URLs：`http://localhost:3000`（以及实际端口），不加未确认域名。
2. Authentication > Hooks > Before User Created（官方说明：https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook）：
   - 选择 Postgres function；
   - schema `public`，function `before_user_created_hook`；
   - 确认启用；函数只允许 `supabase_auth_admin` 执行。
3. Authentication > Providers/Email：启用 Email；Confirm email 按上线策略；
4. Authentication > MFA：启用 TOTP；不把 secret 写入仓库或聊天；
5. JWT expiry 保持短值（默认 3600 秒）；会话撤销由 `upc_session_is_current` 兜底。
6. 外部 SMTP 未配置前，**不声明真实邮件验收**；注册确认/恢复链接只能等 SMTP 后验证。

### 5.5 云端管理员

**不迁移 `auth.users`、密码 hash、MFA factor 或旧 `admin_users`。** 官方知识库说明可以迁移
auth schema（含 users/hashed passwords），见
https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects；
本轮仍选择重新创建正式管理员，避免测试账号、MFA secret 和跨项目 JWT/加密兼容风险。

原因：本机账号含测试用户；MFA secret 不应复制；官方 Auth 迁移主要覆盖 users/hashed
passwords，跨项目 JWT/加密与 MFA 兼容需单独核对。正式管理员在云端重新创建：

1. 在 `private.upc_admin_invites` 插入 `operator@example.com` 的一次性邀请；
2. 用 service_role 通过 Auth Admin API 创建/邀请该邮箱；生成一次性邀请或 recovery 链接；
3. 用返回的云端 `user_id` 插入 `admin_users`，角色 `super_admin`，active；
4. 不复制旧 `example.test` 管理员，不恢复其权限；
5. 运营者设置密码并绑定 TOTP；不输出密码/token/secret；
6. 首个管理员完成一次实际审核后再算管理员验收通过。

### 5.6 前端独立构建

复制公开配置到 `temp/cloud/`，不要使用 `.env.local`：

```bash
# 仅公开值
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_CACHE_API_ENABLED=false
```

构建时只注入 `VITE_*`；`SUPABASE_SERVICE_ROLE_KEY` 和 `SUPABASE_DB_URL` 不得进入 Vite：

```bash
npm run build
# 检查 dist 中不含 service_role/DB URL/JWT secret
```

产物先放 `release/` 或临时目录，不发布服务器、不改 Nginx/域名。

## 6. 云端验收

1. 只读：表/函数/RLS/公开字段/邀请边界/纠错表存在，业务计数一致。
2. 专用合成管理员：登录、TOTP、AAL2；撤销 session 后旧 AAL2 token 调审核/邀请/身份查询
   全部拒绝；重新登录+TOTP 恢复；测试账号和 welcome 数据清理。
3. 角色矩阵：anon/普通用户/作者/moderator/admin/super_admin/AAL1/AAL2。
4. E2E：搜索/筛选/分页/详情/提交/审核/纠错/举报/撤回（按当前规则，不含教师申诉/文字评论）。
5. 浏览器桌面/移动；不把本机 Mailpit 当外部 SMTP。

## 7. 部署包与回退

- 只准备：静态 `dist`、Nginx SPA 配置、环境变量清单、发布/回退步骤；
- 不改服务器、不切域名、不覆盖 example-site；
- 云端回退优先用项目备份/快照；新项目未上线前可删除项目重建，但必须先确认无正式数据；
- 若已写入正式数据，不执行 `db reset`/drop；恢复到迁移前快照并保留源 WSL 备份。

## 8. 当前缺什么

1. ~~托管项目 ref/URL/key/DB 凭据~~ 已完成并写入 `temp/cloud/cloud.env`；
2. ~~云端只读核对~~ 已完成：迁移前 public/auth 为空；
3. ~~Auth Hook/MFA/URL 配置~~ 已完成；
4. 外部 SMTP、正式域名/TLS/最终回调白名单；
5. 云端管理员密码/TOTP 已完成；真实 operator 管理员的一次可复核审核仍待；
6. 云端备份/恢复/回滚演练与部署窗口；
7. 云端完整 79 项 E2E；当前已有 Hook/会话/角色/评价/浏览器 26 项 + 核心生命周期 25 项 + 纠错 4 项（类别有重叠，不是 79 全集）。

云端数据库/Auth 已迁移；仍不能声称真实邮件、完整 E2E 或生产上线已通过。

## 9. 实际执行记录（2026-10-24 20:xx）

### 9.1 项目与迁移前状态

- 项目：`your-project-ref`，名称 `dlam12138's Project`；
- 区域 `ap-southeast-2`；数据库版本 `17.11.0.003`；状态 `ACTIVE_HEALTHY`；
- 迁移前只读检查：`public` 关系 0、`auth.users=0`、`auth.identities=0`、
  `mfa_factors=0`、`auth.sessions=0`；无 `private` schema、无纠错 RPC。
- 目标为空，因此没有清空/覆盖/reset 任何现有业务数据；WSL 源库备份见第 4 节。

### 9.2 Schema 与数据

- 应用 `supabase/cloud/upc-cloud-schema.sql` 成功；
- 应用 `temp/cloud/upc-cloud-data.sql` 成功；
- 云端结果：
  - colleges 17、terms 1、teachers 1,555、courses 1,342、course_offerings 2,946；
  - reviews 0、admin_users 1（operator）、point_rules 3、security_settings 8；
  - auth users 1、profiles 1、point_transactions 0；
  - 外键缺失 0、课程学院缺失 0；
- 与 WSL 源库摘要一致（教师使用去除派生评分/`updated_at` 的目录摘要）：
  teachers `180eaac4...`、courses `f0e381ff...`、offerings `4f7c5dd2...`、
  colleges `4285801a...`、terms `a00af5ce...`、point_rules `3bdecf14...`；
- 源库唯一的测试评价未迁移；其教师 `review_count` 从 1 重置为 0，
  `private.upc_rebuild_public_ratings()` 已回读确认当前无残留评分/公开统计；
- 旧 `example.test` 未迁移；测试评价/点赞/积分/治理/导入批次未迁移。

### 9.3 Auth/Auth Hook/MFA

- `before_user_created` Hook 已启用：
  `pg-functions://postgres/public/before_user_created_hook`；
- 无邀请 Gmail 注册返回 400，未创建用户；
- TOTP enroll/verify 已启用；JWT expiry 3600 秒；
- Site URL `http://localhost:3000`，redirect allow-list `localhost:3000` /
  `127.0.0.1:3000`；
- SMTP 仍为空：真实邮件未配置、未验收。

### 9.4 管理员

- 云端 `operator@example.com`：Auth 已确认、`super_admin`、active；
- 已完成密码设置和 TOTP 绑定：1 个 verified factor、1 个登录 session；
- 一次性密码设置链接使用后已删除，不在仓库/报告保留 token；
- 未迁移旧 `example.test`，未恢复其权限；云端当前 active 管理员 1 个；
  回读证据 `temp/cloud/cloud-admin-binding-final.json`。

### 9.5 云端验收

- 公开目录：匿名可读，返回真实教师/学院；
- Hook：无邀请 Gmail 400；
- 专用合成管理员会话：**10/10**（AAL2、撤会话、旧 token 拒绝、重登+MFA 恢复）；
- 角色矩阵：**6/6**（anon 读公开、anon 不能读评价、学生不能读 admin、
  学生不能审核/邀请）；
- 提交评价：**4/4**（学生六维 pending、匿名不可见、public feed 不含 pending、
  学生不能自审）；
- 浏览器 smoke：**5/5**（桌面搜索/详情、无 textarea、移动搜索/详情、无横向溢出）；
- 核心生命周期：**25/25**（6 学生、1 驳回、5 通过、公开门槛、积分幂等、点赞、
  撤回回落）；教师纠错：**4/4**（写回/持久化/重复拒绝）；
- 修复 hosted 表权限缺失：`supabase/cloud/grants.sql` 已纳入 bundle；
- 合成账号、测试评价、welcome 积分/profile 已清理；当前仅保留 operator；
- 审计日志不可篡改，保留 16 条 `cloud-e2e` 测试日志（不是业务数据）。

### 9.6 前端构建

- `npm run build:cloud` 使用托管项目公开 URL/anon key；
- `dist` 中仅发现 anon JWT，没有 service_role key、DB URL 或 secret；
- 静态包 `release/upc-cloud-static-20261024-2026.tar.gz`，SHA-256
  `4a00c8ae43d92e1e3533ad0761c99dc1350d7f975b27ac3fc823d1dd7c5df791`；
- 仅准备，未发布服务器、未改域名、未覆盖 example-site。

### 9.7 仍未完成

- operator 设置云端密码、绑定 TOTP（当前 factor 0）；
- 外部 SMTP、真实邮件投递与链接点击；
- 正式域名/TLS、Auth redirect 最终白名单；
- 云端完整 79 项 E2E、升级后角色全矩阵；
- 服务器 Nginx/静态发布、发布回退、云端备份/恢复演练。

### 9.8 云端业务闭环补齐与权限修复

首次云端 E2E 暴露了一个迁移差异：托管项目由 `postgres` 通过 Management API 建表，
**没有继承本地库对 `anon/authenticated/service_role` 的默认表权限**，学生插入评价时返回
`42501 permission denied for table reviews`。

处理：

- 新增 `supabase/cloud/grants.sql`，并纳入 cloud bundle；
- 复刻本地最小权限：公开目录/评价 feed 对 anon/authenticated 可读；authenticated 仅对
  reviews 有窄列写权限，RPC-only 表不直接写；service_role 全量；
- 托管 PostgREST 对 reviews 的写入需要表级 INSERT/UPDATE，因此保留表级授权；
  文字评论仍由 `reviews_guard_business` 触发器拒绝，RLS 继续限制行；
- 云端重新执行 grants 后，E2E 可写入。

云端业务闭环结果：

- 6 个合成学生登录；合成管理员 AAL1 拒绝、AAL2 通过；
- 6 条 pending 评价提交；匿名不可读；
- 1 条驳回，5 条通过；5 人门槛触发公开 feed 和教师分数；
- 重复审核不重复加 20 分；点赞/取消点赞生效；
- 撤回后 review 隐藏，feed 与教师分数回落到门槛以下；
- 教师资料纠错写回、重复写回拒绝；
- **核心生命周期 25/25 + 纠错 4/4 通过**；
- 业务合成数据/账号/评价/请求/教师已清理；当前仅 operator 管理员，profiles 1、points 0；
- 审计日志不可篡改，保留 16 条 `cloud-e2e` 合成审计记录（不是业务数据）；
  这是测试日志保留，不是未清理业务数据。

仍未在云端覆盖：邀请/邮箱变更、账号注销/失败恢复、moderator 全矩阵、完整 79 项 E2E。
