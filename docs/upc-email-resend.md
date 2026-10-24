# UPC Resend 域名发信（已配置，待邮件头/链接验收）

更新：2026-10-24。目标发信子域 `auth.example.org`，拟定发件人
`noreply@auth.example.org`。**当前已有 Resend 域名、SMTP 和单封投递证据；
本文不编造 DKIM/SPF/MX 值，也不代表邮件已验收。**

## 1. 凭据核查（历史：最初缺失）

- Windows 用户/系统环境变量、WSL 环境变量：未发现 `RESEND_API_KEY`；
- 仓库和 `.env*`：未发现 Resend 凭据；
- 因此无法确认是否已有 Resend 账号/域名；需要运营者提供或登录 Resend。
- 凭据只放 Git 忽略的 `temp/cloud/cloud.env` 或服务器密钥管理，不写前端、报告、聊天。

## 2. 当前 DNS 事实（只读）

DNS 托管在阿里云：

- NS：`dns9.hichina.com`、`dns10.hichina.com`
- `example.org` A `203.0.113.10`（TTL 600）
- `www.example.org` A `203.0.113.10`（TTL 600）
- `example.org` 当前未发现 MX/TXT
- `auth.example.org` 当前 **NXDOMAIN**，没有现成记录可冲突
- **不得改动上述根域/www A 记录，也不得改根域 NS。**

## 3. 需要运营者在 Resend 完成的步骤

1. 登录/创建 Resend 账号；
2. Domains → Add Domain，填写 `auth.example.org`（不要填根域）；
3. 选择实际区域并创建；
4. 复制 Resend 面板给出的**全部原样记录**，不要根据本文猜值；
5. 在阿里云 DNS 为 `auth.example.org` 添加这些记录；
6. 等 Resend 显示 Verified；
7. 在 Resend 域名设置中关闭 click tracking；
8. 创建只用于该域名的 API key（Sending access），保存到受控文件；
9. 记录 Resend 的 SMTP 凭据/限额；不要把 API key 发到聊天。

实际 Resend 项目记录（项目 region `ap-northeast-1`，域名 `verified`）：

| 用途 | 类型 | 主机记录（阿里云） | 值 | 优先级 | 状态 |
| --- | --- | --- | --- | --- | --- |
| DKIM | TXT | `resend._domainkey.auth` | `p=REPLACE_WITH_PROVIDER_DKIM_PUBLIC_KEY` | — | 已验证 |
| SPF 退信 | MX | `send.auth` | `feedback-smtp.ap-northeast-1.amazonses.com` | 10 | 已验证 |
| SPF | TXT | `send.auth` | `v=spf1 include:amazonses.com ~all` | — | 已验证 |
| Resend 路由 | CNAME | `rsend.auth` | `send.forge.rmta.net` | — | 已验证 |

- 这些记录只作用于 `auth.example.org` 子域，不改根域 `@` / `www` 的 A。
- 根域/www A 仍为 `203.0.113.10`；根域没有新增 MX/TXT。
- `auth.example.org` 本身没有 A 记录，仅用于发信，不作为网站入口。
- 权威 DNS 实测四条记录均存在；CNAME 目标解析出
  `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all`。
- 机读清单：`docs/upc-resend-dns-checklist.csv`。
- 若未来重建 Resend 域名，记录值可能变化，必须重新从面板复制，不得沿用本文旧值。


## 4. 添加后只读核对

```powershell
Resolve-DnsName auth.example.org -Type TXT
Resolve-DnsName auth.example.org -Type MX
Resolve-DnsName auth.example.org -Type CNAME
Resolve-DnsName example.org -Type A
Resolve-DnsName www.example.org -Type A
```

要求：

- Resend 面板显示 Verified；
- 根域/www A 仍为 `203.0.113.10`；
- 不新增/覆盖根域 MX 或根域 SPF，除非 Resend 明确要求且运营者确认；
- 记录实际 TTL 和 Resend 验证时间。

## 5. Supabase 自定义 SMTP

域名验证和 API key 就绪后再配置，字段：

- Host：Resend 面板给出的 SMTP host（通常 `smtp.resend.com`，以面板为准）
- Port：465（TLS）或 587（STARTTLS），以 Resend 支持为准
- Username：Resend SMTP 用户名（通常 `resend`，以面板为准）
- Password：Resend API key（只存受控环境）
- Sender email：`noreply@auth.example.org`
- Sender name：`小石子`
- Admin email：运营者确认的收件地址

同时核对：

- Site URL / Redirect allow-list 与最终前端域名一致；
- 确认邮件、邀请、恢复邮件模板；
- 发信限流（Supabase Auth rate limit + Resend 限额）；
- **关闭 click tracking**；
- 不在前端或 Git 中出现 SMTP 密码。

当前云端 Auth 只读值：`mailer_autoconfirm=false`、OTP 8 位/3600 秒、
`rate_limit_email_sent=2`、`rate_limit_otp=30`、`rate_limit_verify=30`、
`rate_limit_token_refresh=150`；Site URL/allow-list 仍为 localhost；
模板当前是默认英文内容，需运营者确认是否改中文品牌文案。

## 6. 真实投递验收（需单独授权）

建议测试：

- 收件人：待运营者确认的邮箱；
- 用途：仅验证 `noreply@auth.example.org` 的 SPF/DKIM/DMARC 对齐、确认/恢复邮件链接；
- 不向真实学生群发，不导入真实收件人列表。

**在运营者明确回复“授权发送到某邮箱”前，不发送测试邮件。**

验收记录：Resend Message ID、SMTP 响应、收件时间、SPF/DKIM/DMARC 结果、链接点击/
过期行为、失败重试。当前这些均为未执行。

## 7. 当前状态

- Resend 账号/域名：已创建并 verified；
- DNS 记录：已添加并 verified；
- Supabase SMTP：已配置（smtp.resend.com:465，verified 域）；
- 真实邮件：已发送 1 封（服务商 delivered），收件箱/邮件头/链接未验收；
- 代码/文档不包含任何 Resend 密钥。

## 8. 可执行接入步骤（2026-10-24 补充）

接入脚本：`scripts/setup-resend.mjs`。从项目根目录执行，密钥仅从环境变量或
Git 忽略的 `temp/cloud/cloud.env` 读取。脚本不发送邮件、不修改 DNS，不改 Site URL
或 redirect allow-list。托管项目固定为 `your-project-ref`，发信子域固定为
`auth.example.org`。

1. 在 Resend 登录/创建账号，创建本次配置使用的 Full access Key，保存为
   `RESEND_SETUP_API_KEY`。它用于管理域名，不作为长期 SMTP 凭据。
2. 执行 `node scripts/setup-resend.mjs plan`，仅检查凭据是否存在，不输出值。
3. 执行 `node scripts/setup-resend.mjs domain`：查找已有域名，缺失时在东京区域
   创建，关闭打开/点击追踪，并发起验证。实际 DNS 记录写入
   `temp/cloud/resend-dns-records.csv`；域名状态写入 `temp/cloud/resend-domain.json`。
4. 按实际 Resend 页面和导出记录，在阿里云添加 DNS。CSV 的 `aliyun_host` 为
   去除根域后的主机记录；添加时核对阿里云是否自动追加 `example.org`，不得重复追加域名。
   不更改根域/www A 记录和 NS。脚本没有 DNS 平台凭据，不能自动完成此步。
5. 再次执行 domain 命令核对状态。在 Resend 创建仅限该域名的 Sending access Key，
   保存为 `RESEND_API_KEY`。两个 Key 分开，配置脚本拒绝将 setup Key 用作 SMTP。
6. 域名 Verified 后，执行 `node scripts/setup-resend.mjs smtp`。它先保存原 SMTP
   字段，再配置 `smtp.resend.com:465`、用户名 `resend`、发件人
   `小石子 <noreply@auth.example.org>`，并回读公开字段。
   原字段位于 `temp/cloud/resend-smtp-before.json`，可能含服务端敏感信息，不能分享。
   API 可能掩码旧密码；有旧服务时应另行保存原凭据，不能认为快照必然可完整恢复。
7. 配置核对写入 `temp/cloud/resend-smtp-configured.json`。这只证明配置已应用，
   不等于已收到邮件或链接验收通过。真实投递仍按第 6 节的收件人授权执行。
8. 配置结束后，撤销不再需要的临时 setup Key；SMTP 继续使用受限发信 Key。

本轮实际核查：Resend setup/sending Key 均缺失，云端 SMTP host 为空，Site URL
仍为 localhost。脚本通过语法和 plan 检查，缺凭据会在网络写入前停止；尚未执行真实域名
创建或 SMTP 配置。核查证据：`temp/cloud/resend-current-auth-state.json`。

官方接口依据：
- https://resend.com/docs/api-reference/domains/create-domain
- https://resend.com/docs/api-reference/domains/update-domain
- https://resend.com/docs/send-with-supabase-smtp
- https://supabase.com/docs/guides/auth/auth-smtp

## 9. Resend 域名已创建，等待 DNS（2026-10-24 实际执行）

本节更新前文“账号凭据缺失/域名未创建”的历史状态。

- 已使用运营者提供的 Full access setup Key 创建 `auth.example.org`。
- 域名 ID：`REPLACE_WITH_PROVIDER_RECORD_ID`，区域东京 `ap-northeast-1`。
- `click_tracking=false`、`open_tracking=false`，已发起域名验证。
- 实际获得 4 条 DNS 记录：DKIM TXT、SPF TXT、退信 MX、服务要求的 CNAME。
  完整值及阿里云主机记录已写入 `docs/upc-resend-dns-checklist.csv`，不再是占位清单。
- 当前没有阿里云 DNS 接入凭据，未修改任何 DNS，域名尚未验证通过。
- 先前提供的发送专用 Key 已保存为 `RESEND_API_KEY`；长期使用前需核对其域名范围。
- （历史）SMTP 当时尚未应用；后续第 10/11 节已配置并发送 1 封。
- 本次 Node fetch 连接失败后，使用 Python HTTPS 客户端完成同一官方 API 调用。
- 执行证据：`temp/cloud/resend-domain.json`、`temp/cloud/resend-setup-status.json`。

## 10. 域名验证与托管 SMTP 已配置（2026-10-24）

本节更新前文等待 DNS、SMTP 未配置的历史状态。

- 运营者添加 DNS 后，Resend 回读为 `verified`，四条记录均 `verified`。
- `click_tracking=false`、`open_tracking=false`。
- 使用发送专用 Key 完成 SMTP AUTH，返回 `235`；此操作没有发送邮件。
- 托管项目 `your-project-ref` 已应用 SMTP：`smtp.resend.com:465`，
  用户名 `resend`，发件地址 `noreply@auth.example.org`，显示名 `小石子`。
- API 要求 `smtp_port` 为字符串，脚本已同步；发件人显示名已按 Unicode 回读核对。
- 回读确认上述配置成功。原配置备份位于 Git 忽略的
  `temp/cloud/resend-smtp-before.json`；不得公开其中可能存在的凭据。
- Site URL 仍是 `http://localhost:3000`，redirect allow-list 仍为两个本机地址。
  未修改正式域名入口、Auth 回调策略、确认邮件要求或其他认证配置。
- （历史）当时真实邮件尚未发送；后续第 11 节已完成 1 封服务商 delivered。
  已向运营者请求单封测试邮件授权，收件人为 `operator@example.com`。
- 发送专用 Key 仅发送权限已由 Resend API 错误类别确认；域名限制范围尚未由控制台核实，
  不将其写成“已证明仅允许本域名”。临时 setup Key 待收尾时撤销。
- 证据：`temp/cloud/resend-smtp-configured.json`、`temp/cloud/resend-domain.json`。

MX 优先级首次权威 DNS 读取为 1，曾建议运营者按面板改为 10；Resend 随后已验证通过。
此差异不再作为当前域名验证阻塞，配置收尾时仍应与服务面板保持一致。

## 11. 单封真实认证邮件已投递（2026-10-24）

- 运营者明确授权后，向 `operator@example.com` 发起一次成功的密码恢复邮件请求。
- 本机初始连接出现 TLS/连接失败；核对 Resend 无邮件后，经本机代理重试成功。
  最终 Supabase `/auth/v1/recover` 返回 HTTP 200，Resend 中仅出现 1 封对应邮件。
- 发件人：`小石子 <noreply@auth.example.org>`；主题仍为默认英文 `Reset your password`。
- Resend Message ID：`REPLACE_WITH_PROVIDER_RECORD_ID`，回读事件 `delivered`。
  这证明收件邮件服务器已接受，不证明进入主收件箱，也不代替邮件头或链接验收。
- 没有修改管理员密码、MFA 或会话；未打开、输出或保存邮件内的恢复 token。
- 恢复链接 redirect 仍为 `http://localhost:3000`；正式域名回调、中文模板、收件箱确认、
  SPF/DKIM/DMARC 邮件头核对及链接流程仍待验收。
- 证据：`temp/cloud/resend-delivery-test.json`。此次授权仅覆盖上述单封测试邮件，
  不扩展为向其他用户发信或继续发送更多测试邮件的授权。
