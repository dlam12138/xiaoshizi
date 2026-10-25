# 云端未覆盖 E2E 补齐与邮件本地化

更新：2026-10-25。本轮补齐邀请、邮箱变更、注销重试、moderator 矩阵、重导入保护，
并把 Supabase Auth 邮件改为中文、收回宽泛通配符。**仍是受限预发布，不是正式上线。**

## 1. 扩展 E2E：36 项通过

脚本：`temp/cloud/cloud-e2e-extended.mjs`（Git 忽略）
证据：`temp/cloud/cloud-e2e-extended-report.json`

| 分组 | 覆盖 | 结果 |
| --- | --- | --- |
| 邀请 | 仅有效邀请可建 Gmail；建号即消费邀请；非 Gmail 拒绝；无邀请拒绝且不留 auth 行 | 7/7 |
| 邮箱变更 | 学生不能改到非学生域；拒绝后原邮箱不变且不产生新地址；学生间变更持久化；历史非学生账户不能转入学生域 | 8/8 |
| 注销重试 | 提交→接受→先删 Auth→管理员绑定级联消失→申请保留为 null 主体→按 `--user-id` 语义清理残留 | 6/6 |
| moderator 矩阵 | 可登录、可读审核计数；不能邀请管理员、不能处理治理、不能删任意评价、不能读审计日志 | 6/6 |
| 重导入保护 | dry-run 通过；纠错 pin 可记录；导入插入探针教师；pin 不被静默覆盖；同数据集重复导入幂等；两次批次都留痕 | 6/6 |
| 其他 | 邀请管理员 AAL2、可创建邀请 | 3/3 |

清理：脚本 `finally` 删除全部合成账号/邀请/管理员绑定；运行后被中断的残留
另用 `temp/cloud/cleanup-extended-e2e-sql.mjs` 清掉（3 个 legacy 探针账号 + 2 条申请）。
清理后：`auth_users=1`、`admins=1`、`reviews=0`、`requests=0`、`teachers=1555`、
`batches=0`、`pins=0`。

## 2. 邮件本地化

配置变更前备份：`temp/cloud/auth-config-before-i18n.json`（已排除密码/密钥）
变更后快照：`temp/cloud/auth-config-after-i18n.json`

| 键 | 变更后 |
| --- | --- |
| `site_url` | `https://example.org` |
| `uri_allow_list` | `https://example.org`、`http://localhost:3000`、`http://127.0.0.1:3000` |
| `disable_signup` | `true` |
| `mailer_autoconfirm` | `false` |
| 恢复密码主题 | `【小石子】重置你的登录密码` |
| 确认邮箱主题 | `【小石子】请确认你的学生邮箱` |
| 变更邮箱主题 | `【小石子】请确认你的新邮箱` |
| 管理员邀请主题 | `【小石子】管理员邀请` |

- 模板正文改为中文，含按钮与“本邮件由小石子自动发送”页脚
- **移除了 `https://example.org/**` 通配**：实测 `https://example.org/` 被接受，
  `https://evil.example/x` 被回落到 `https://example.org`
- 恢复链接 redirect 实测为 `https://example.org`

## 3. 发过一封中文恢复邮件

- 端点：`POST /auth/v1/recover`，`redirect_to=https://example.org`，HTTP 200
- 收件人：`operator@example.com`（与之前同一授权收件人）
- 未修改密码、未改 MFA、未打开或保存邮件 token
- **Resend 消息级回读失败**：现有 `RESEND_API_KEY` / `RESEND_SETUP_API_KEY`
  对 `/emails`、`/domains` 均返回 403，说明是 sending-only key。
  因此本轮**无法**用服务商接口复核这封邮件的 `delivered` 状态。

## 4. 邮件认证记录（权威 DNS 实测）

| 记录 | 主机 | 值 | 状态 |
| --- | --- | --- | --- |
| DKIM | `resend._domainkey.auth` | `p=REPLACE_WITH_PROVIDER_DKIM_PUBLIC_KEY…DAQAB` | 存在 |
| SPF | `send.auth` TXT | `v=spf1 include:amazonses.com ~all` | 存在 |
| 退信 MX | `send.auth` | `feedback-smtp.ap-northeast-1.amazonses.com`（10） | 存在 |
| Resend 路由 | `rsend.auth` CNAME | `send.forge.rmta.net` | 存在 |
| DMARC | `_dmarc.auth.example.org` | 无记录 | **缺失** |

结论：发信域有 DKIM + SPF + 退信通道，但**没有 DMARC 策略**。
DMARC 缺失不影响投递，但会削弱伪造防护和部分邮箱的信任评分。

## 5. 仍需你完成

1. **确认真实收件箱**：是否收到中文主题“【小石子】重置你的登录密码”的邮件，
   在收件箱还是垃圾邮件；若能看到“显示原始邮件”，请确认 `SPF=pass`、`DKIM=pass`。
2. **浏览器验收**：`node temp/cloud/walkthrough-browser.mjs`，由你输入密码与 TOTP。
3. **Basic Auth 移除时机**：以上两项完成后我再移除整站门。

我可以在你确认后加 DMARC（建议先 `p=none` 观察）：
`_dmarc.auth.example.org` TXT `v=DMARC1; p=none; rua=mailto:operator@example.com`。
这需要你在阿里云 DNS 添加一条记录，或授权我给出精确值由你添加。
