# UPC 鉴权与首个管理员配置

目标：在独立 UPC Supabase 项目启用邮箱注册、验证、登录和找回密码，并让审核员真正具备审核权限。

**本机真实 Supabase native 栈已执行并通过**：三测试账号登录、未确认邮箱拒绝、
Mailpit 注册确认链接、recovery 改密、旧密码失败/新密码成功、recovery session 退出和
URL token 清理。证据见 `temp/supabase-local/ui-auth-report.json` 与
`temp/supabase-local/acceptance.json`。

**云端独立测试项目和外部 SMTP 尚未执行**。本文件后半部分同时是云端操作清单；
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

## 2. 首个管理员

1. 用管理员邮箱完成注册和邮箱验证。
2. 在 SQL Editor 执行：

```sql
INSERT INTO public.admin_users (email, role, nickname)
VALUES ('admin@example.edu.cn', 'super_admin', '反馈审核员')
ON CONFLICT (email) DO UPDATE
SET role = 'super_admin', is_active = true, nickname = EXCLUDED.nickname;
```

3. 用该账号登录，确认：
   - 顶部出现“管理审核”；
   - 可读取 pending 评价；
   - 可通过/驳回；
   - 普通学生账号看不到审核入口，直接调用 `approve_review` 会被拒绝。
4. 管理员邮箱必须与 `auth.users.email` 一致且已验证；不要用 `user_metadata` 授予权限。

## 3. 角色与边界

| 角色 | 权限 |
| --- | --- |
| anon | 读公开目录和 `review_feed`；不能读基表评价、积分、管理员表 |
| authenticated | 读公开目录；读自己的评价/积分/点赞；提交 pending 评价；改自己的 pending/rejected |
| moderator/admin | 读所有评价、审核通过/驳回；不能管理管理员 |
| super_admin | 额外管理 `admin_users` |
| service_role | 仅服务端导入；不进前端 |

## 4. 校区与注册

- 注册页的校区为可选项，选项文案为“暂不填写”；campus 为空时不写入用户元数据。
- 教师/个人资料的校区为空时省略该段展示，不显示“校区待核实/待补充”。
- 一期不提供校区筛选；不要根据学院或教室推断校区。
- 注册仍要求选择学院，学院用于普通用户资料展示，不作为教师人事归属依据。

## 5. 本机复现

```powershell
npm run supabase:status
npm run check:supabase
npm run test:supabase:local
```

页面 Auth 使用本机 Mailpit（<http://127.0.0.1:54324>）查看验证/重置邮件。测试账号
只在 `.env.test.local`，不输出、不提交。完整页面证据见
`temp/supabase-local/ui-auth-report.json`。

## 6. 未完成验收

- 云端独立 Supabase 项目和云端 Auth 回调未执行；
- 外部 SMTP 投递、真实邮件域名和发信限额未验收；
- 生产域名、TLS、备份/回滚未执行。

完成标准不是“建了一张 `admin_users` 表”，而是管理员能在目标项目实际登录并完成一次
审核，普通用户不能越权；邮件验收必须实际打开邮件链接。本机已满足这些条件，云端仍需
按 `docs/upc-target-integration.md` 复验。
