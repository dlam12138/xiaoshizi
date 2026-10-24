# UPC 鉴权与首个管理员配置

目标：在独立 UPC Supabase 项目启用邮箱注册、验证、登录和找回密码，并让审核员真正具备审核权限。

**本机真实 Supabase native 栈已执行并通过**：真实 Before User Created Hook、学生域注册、
非学生域/伪装后缀拒绝、邮箱变更请求拦截、未确认登录拒绝、Mailpit 确认链接、recovery 改密、
旧密码失败/新密码成功和 URL token 清理。证据见 `temp/supabase-local/auth-security-report.md`、
`ui-auth-report.json`（历史）与 `security-admin-ui-report.json`（管理员 AAL2）。

**云端数据库/Auth 已迁移；外部 SMTP、正式域名和完整云端 E2E 尚未执行**。本文件后半部分同时是云端操作清单；
Mailpit 只验证本机邮件链路，不代表外部 SMTP 投递。

本机启停和入口见 `docs/upc-local-supabase.md`。

## 1. Auth 基础配置

在 Supabase Dashboard → Authentication：

1. **Providers → Email** 启用邮箱密码登录。
2. **Confirm email** 开启；首次注册必须完成邮箱验证。
3. **Site URL**：本地联调填 `http://localhost:3000`；正式域名确定后再切换，不等待生产域名。
4. **Redirect URLs** 加入 `http://localhost:3000`（及实际本地端口）；找回密码邮件会回到该地址。
5. 配置 SMTP（或使用项目自带邮件服务做测试）；记录发信限额和失败日志。
6. 前端只放公开 anon/publishable key；service_role 只放 `.env.import.local`。
   可用 `npm run check:supabase` 检查两个本地文件指向同一项目、缓存开关为 false。
7. 测试：
   - 新邮箱注册 → 收到验证邮件 → 验证后登录；
   - 未验证邮箱登录被拒绝，页面提示可重发；
   - 忘记密码 → 收到重置邮件 → 打开链接后应用识别 `PASSWORD_RECOVERY`/`type=recovery`，
     显示“设置新密码”而不是普通登录页 → 保存后退出并要求用新密码登录；
   - 旧密码登录失败、新密码登录成功；保存成功后 URL 中的 recovery token/fragment 被清理；
   - 重复注册提示已注册，不泄露敏感信息。

实现位置：`src/App.tsx` 的 auth listener 接收 `PASSWORD_RECOVERY` 并打开恢复模式；
`src/components/AuthModal.tsx` 校验两次新密码并调用
`supabaseService.updatePassword()`；服务层使用 `auth.updateUser({ password })`。
保存成功或用户放弃恢复模式时都会退出恢复会话，避免留下已认证的临时会话。
目标项目验收时必须实际点击邮件链接，不能只验证“邮件已发送”。

## 2. 首个管理员（受控引导）

普通 `@upc.edu.cn` 教职工邮箱不能自助注册；`s.upc.edu.cn` 学生邮箱可注册，但“学生账户”不等于
“管理员”。管理员仅使用运营者手动指定的 `@gmail.com` 账户，必须先创建私有、限期邀请，再按不可变 Auth `user_id` 手动授权。学校域名不授予管理员资格。示例地址必须替换为你的实际邮箱，不将实际邮箱提交到 Git。

### 2.1 引导首个 `super_admin`

1. 在 SQL Editor 为管理员邮箱创建一次性邀请（1 小时有效）：

```sql
INSERT INTO private.upc_admin_invites (email, expires_at)
VALUES (lower('REPLACE_WITH_OWNER@gmail.com'), now() + interval '1 hour')
ON CONFLICT (email) DO UPDATE
SET expires_at = EXCLUDED.expires_at, used_at = NULL;
```

2. 用 Supabase Dashboard 的 Add user 或受控 Auth Admin 调用创建该账号并确认邮箱。
   Hook 仅在精确 Gmail 地址已有有效且未使用的私有邀请时放行；Gmail 域名本身不授予注册或管理权限。

3. 用稳定 `user_id` 写入管理员（不要只写邮箱）：

```sql
INSERT INTO public.admin_users (user_id, email, role, nickname, is_active)
SELECT id, email, 'super_admin', '反馈审核员', true
FROM auth.users
WHERE lower(email) = lower('REPLACE_WITH_OWNER@gmail.com')
ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE
SET role = 'super_admin', is_active = true, nickname = EXCLUDED.nickname;
```

4. 用该账号登录，先完成 TOTP 绑定；`require_admin_aal2` 默认开启。AAL1 会话不能读取审核队列
   或执行审核。确认：
   - 顶部出现“管理审核”；
   - AAL1 只看到 AAL2 门，验证码通过后才进入；
   - 可读取 pending 评价并通过/驳回；
   - 普通学生账号看不到审核入口，直接调用 `approve_review` 会被拒绝。

5. 后续管理员：由 `super_admin` 在 AAL2 下调用 `create_admin_invite` 创建邀请，账号创建并确认后
   调用 `set_admin_role(user_id, ...)`；停用调用 `set_admin_active`。不得用 `user_metadata` 授权。
   不要临时关闭全局 Hook。
6. 管理员邮箱变更由 `auth.users` 守卫拒绝；不能通过换邮箱把普通账户变成管理员，也不能
   绕过 `admin_users.user_id` 的单独授权。邀请与角色 RPC 仅 AAL2 `super_admin` 可调用。

## 3. 角色与边界

| 角色 | 权限 |
| --- | --- |
| anon | 读公开目录、已公开且达到 5 人门槛的 `review_feed`；不能读基表评价、积分、管理员表 |
| authenticated | 读公开目录；读自己的评价/积分/点赞；提交 pending 评价；改自己的 pending/rejected |
| moderator/admin | 通过受控 `admin_review_queue` 审核；AAL2 后才能读取/处理；不能管理管理员 |
| super_admin | 额外管理管理员、邀请和敏感身份调查；仍需 AAL2 |
| service_role | 仅服务端导入/受控运维；不进前端 |
| 私有治理队列 | 申请人仅本人；AAL2 管理员按状态流转；不公开申请文字 |

## 4. 校区与注册

- 注册页的校区为可选项，选项文案为“暂不填写”；campus 为空时不写入用户元数据。
- 教师/个人资料的校区为空时省略该段展示，不显示“校区待核实/待补充”。
- 一期不提供校区筛选；不要根据学院或教室推断校区。
- 注册仍要求选择学院，学院用于普通用户资料展示，不作为教师人事归属依据。

## 5. 管理员 MFA 丢失恢复（受控后台）

这不是公开自助入口，也没有面向普通用户或管理员的前端恢复按钮。恢复只允许受控后台在
线下身份核验后执行：

1. 运营者核验管理员身份、变更单和原因；不得由管理员本人在页面上自行“重置 MFA”。
2. 受控后台用 service role 运行 `scripts/recover-admin-mfa.mjs` 的只读预检；
3. 确认目标确为 `admin_users` 中的管理员、factor 数量和角色；
4. 加 `--execute --confirm` 执行：通过 Auth Admin API 删除全部 factor，调用
   `public.record_admin_mfa_recovery` 撤销该账户全部 Auth 会话并写入
   `admin_mfa_recovery` 审计；
5. 管理员用原密码重新登录，此时只有 AAL1；重新绑定 TOTP 并验证 AAL2；
6. 复查审计记录（操作人、原因、factor 标识、撤销会话数、角色/active）。

命令示例（不要把真实 user_id/邮箱写入 Git）：

```powershell
$env:UPC_ENV_FILE = '.env.import.local'
node scripts/recover-admin-mfa.mjs --user-id <admin-uuid> --operator <label> `
  --reason '<线下身份核验结论，至少 20 字>'
node scripts/recover-admin-mfa.mjs --user-id <admin-uuid> --operator <label> `
  --reason '<线下身份核验结论，至少 20 字>' --execute --confirm
```

边界：

- `record_admin_mfa_recovery` 只授予 `service_role`；`anon`、`authenticated` 和 AAL2
  管理员都不能调用；
- 恢复不修改密码、角色、active，不创建公开后门；
- 管理员校验已绑定 `auth.sessions`：会话删除后旧 AAL2 access token 直接调用审核、邀请、
  身份查询和管理投影会被拒绝；普通用户接口仍可能接受未过期的签名 JWT，高风险场景可缩短
  JWT TTL；
- 远程库需显式 `UPC_ALLOW_REMOTE_MFA_RECOVERY=1` 和变更单；
- 隔离演练 23/23 通过，见 `docs/upc-sec-g0-acceptance.md`；真实管理员未操作。

## 6. 本机复现

```powershell
npm run supabase:status
npm run check:supabase
npm run test:supabase:local   # 真实 Auth + DB/并发
```

页面 Auth 使用本机 Mailpit（<http://127.0.0.1:54324>）查看验证/重置邮件。测试账号
只在 `.env.test.local`，不输出、不提交。页面证据见
`temp/supabase-local/auth-security-report.md`、`security-ui-report.md` 与
`security-admin-ui-report.json`；旧 `ui-auth-report.json` 仅作历史。

## 7. 未完成验收

- **WSL 目标库已应用五份补丁**；旧 `example.test` 管理员已停用，账户/角色/MFA 保留但不再有管理员权限；
  新 `operator@example.com` 已建 Auth 账户和 `super_admin` 行，并已完成密码设置和 TOTP 绑定；
- Gmail 新策略、邮箱变更确认落地、合成注销、失败恢复、资料纠错写回和 MFA 恢复已在独立
  native 栈验证（79 E2E、12 并发、17 浏览器、26 SEC-G0、23 MFA）；WSL 目标库另行完成
  10 项会话失效/恢复验收；
- 云端托管项目 `your-project-ref` 已完成 schema/正式数据/Auth Hook/TOTP/URL 迁移；云端 `operator` 已设置密码并绑定 1 个 verified TOTP；完整云端 E2E 未执行；
- 外部 SMTP 投递、真实邮件域名和发信限额未验收；
- 生产域名、TLS、备份/回滚未执行；
- 真实管理员 MFA 恢复未执行；只完成合成演练，仍需运营者身份核验/变更单/授权。

完成标准不是“建了一张 `admin_users` 表”，而是管理员能在目标项目实际登录并完成一次
审核，普通用户不能越权；邮件验收必须实际打开邮件链接。WSL 目标库已登录并完成 TOTP，
但尚无独立可复核的审核审计；云端仍需按 [SEC-G0 矩阵](upc-sec-g0-acceptance.md) 与
[云端迁移操作单](upc-cloud-migration-runbook.md) 完成管理员激活和复验。
