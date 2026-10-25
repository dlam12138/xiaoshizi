# UPC 预发布部署记录（example.org）

更新：2026-10-25。**这是受限预发布，不是正式上线。** 注册关闭、整站 Basic Auth。

## 1. 实际部署版本

| 项目 | 值 |
| --- | --- |
| 分支 | `feat/launch-security-governance` |
| 封板提交 | `d50573661f5262cde33386441f537eb22f0a0f2a` |
| 标签 | `v1.0.0-upc-preview` |
| release | `/var/www/upc/releases/20261025T0120Z` |
| current 链接 | `/var/www/upc/current -> 20261025T0120Z` |
| 包 SHA-256 | `875344bcd9f4d805e043fbe52157bff44f5fa5791573cf90f087b7945f7dd59e` |
| 站点 | `https://example.org` |
| www | 301 → `https://example.org` |
| 发信域 | `auth.example.org`（仅 Resend，未改） |
| 云端项目 | `your-project-ref`（ap-southeast-2） |

部署配置变更（未改封板提交/标签）：

- `deploy/cloud/example-site-preview.nginx.conf`：新增，根域 + www 跳转 + Basic Auth
- `deploy/cloud/deploy-preview.sh`、`rollback-preview.sh`：目标域名从
  `upc.example.org` 改为 `example.org`，删除未使用的 `http2 on`（nginx 1.24 不支持），
  改为 `listen 443 ssl http2`
- 前端构建仍来自封板提交；仅 `.env.cloud.local` 公开配置不同（不进 Git）

## 2. 服务器只读核查结果

- Ubuntu 24.04.2 LTS，kernel 6.8，2 vCPU，1.6 GiB RAM，40 GiB 磁盘（用 9%）
- 无 swap；负载 0.04
- 监听：22、80、443（部署后）；无 Docker
- Nginx 1.24.0；部署前只有 Debian default 站点（`/var/www/html`）
- example-site：`example-site-web.service` **disabled + inactive**（运营者已停用）
  - `/opt/example-site` 129M，`/var/lib/example-site` 76M（DB 35.8M）
  - 旧 vhost `/etc/nginx/sites-available/example-site.conf` 反代 `127.0.0.1:8000`
- 证书：Let's Encrypt `example.org`，SAN `example.org`、`www.example.org`，
  有效期 2026-10-24 → 2027-01-22；`certbot renew --dry-run` 成功
- 防火墙：`ufw` inactive，iptables 全 ACCEPT（依赖阿里云安全组）

## 3. 备份

位置：`/root/backups/example-site-predeploy-20261025T0111Z/`

| 文件 | 内容 | SHA-256 |
| --- | --- | --- |
| `opt-example-site.tar.gz` | `/opt/example-site` 全量 | `e706b19e...4c06` |
| `var-lib-example-site.tar.gz` | `/var/lib/example-site`（DB、备份、secrets） | `c8bed808...5d50` |
| `etc-example-site.tar.gz` | `/etc/example-site` + env | `5da26263...333b` |
| `example-site.env.bak` | 单独 env 备份（0600） | — |
| `letsencrypt.tar.gz` | `/etc/letsencrypt` | `f445c0b5...da01` |
| `example-site.conf` | 旧 Nginx vhost | `b86bfd42...7c07` |
| `default` | Debian default vhost | — |
| `example-site-web.service` | systemd unit | `aa0da0fa...1f72` |
| `listening.txt` | 部署前端口快照 | — |
| `example-site-status.txt` | 服务状态 | — |

恢复方法：

```bash
# 代码
sudo tar -xzf opt-example-site.tar.gz -C /opt
# 数据（先停服务）
sudo systemctl stop example-site-web
sudo tar -xzf var-lib-example-site.tar.gz -C /var/lib
# 配置/证书/unit
sudo tar -xzf etc-example-site.tar.gz -C /etc
sudo tar -xzf letsencrypt.tar.gz -C /etc
sudo cp example-site-web.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo cp example-site.conf /etc/nginx/sites-available/ && sudo ln -sfn /etc/nginx/sites-available/example-site.conf /etc/nginx/sites-enabled/
sudo ln -sfn /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable --now example-site-web
```

**example-site 数据未被删除或修改**：部署后 `real-pilot.sqlite3` 与备份内副本
`cmp` 完全一致（SHA-256 `e04ce130...bd1`），服务仍 inactive。

## 4. Nginx / TLS / Basic Auth

- 站点：`/etc/nginx/sites-available/upc-preview.conf`，
  启用 `/etc/nginx/sites-enabled/upc-preview.conf`
- 旧 `example-site.conf` 未启用（未删除，备份在 `/root/backups/...`）
- 根域 `example.org`：TLS + Basic Auth + SPA `try_files`
- `www.example.org`：301 → `https://example.org`
- `http`：301 → `https`
- `/healthz`：不走 Basic Auth，返回 `ok`
- Basic Auth 文件：`/etc/nginx/upc-preview.htpasswd`（`root:www-data`，0640，apr1）
- 凭据文件（本机 Git 忽略）：
  - `/path/to/xiaoshizi\temp\cloud\preview-basic-auth.txt`（含用户名/密码/站点）
  - `/path/to/xiaoshizi\temp\cloud\preview-basic-auth.pass`（仅密码）
- 密码 24 字符随机，未在聊天或报告中输出

## 5. Auth 配置

变更前备份：`temp/cloud/auth-config-before-domain.json`（已排除密码/密钥）

| 键 | 变更前 | 变更后 |
| --- | --- | --- |
| `site_url` | `http://localhost:3000` | `https://example.org` |
| `uri_allow_list` | localhost 两项 | `https://example.org`、`https://example.org/**`、localhost 两项 |
| `disable_signup` | `true` | `true`（保持） |
| `mailer_autoconfirm` | `false` | `false`（保持） |
| SMTP | Resend 已配置 | 未改 |

- 没有使用 `*` 通配；`/**` 只覆盖根域路径，用于 recovery 等带路径的回调
- 本机 localhost 回调保留，便于本地联调；正式开放前应移除
- 已用 service role 生成 recovery 链接验证 `redirect_to=https://example.org` 被接受
- 直接 `POST /auth/v1/signup` 返回 422 `signup_disabled`

## 6. 验收结果

| 检查 | 结果 |
| --- | --- |
| 未认证访问 `https://example.org/` | 401 |
| Basic Auth 后访问 | 200 |
| 未认证访问 `/healthz` | 200 `ok` |
| `http://example.org/` | 301 → https |
| `https://www.example.org/` | 301 → `https://example.org/` |
| 证书 | 有效，SAN 覆盖根域/www |
| `certbot renew --dry-run` | 成功 |
| 注册接口 | 422 `signup_disabled` |
| 桌面：横幅/搜索/详情/无 textarea/注册关闭 | 通过 |
| 移动：横幅/个人页注册关闭/搜索/详情/无横向溢出 | 通过 |
| 回退演练 | 切到探针 release 再切回 `20261025T0120Z`，站点 200 |
| 部署后配置备份 | `/root/backups/upc-preview-20261025T0133Z/`（nginx/htpasswd/release，含 SHA256SUMS） |
| example-site 恢复说明 | `/root/backups/example-site-predeploy-20261025T0111Z/RESTORE.md` |
| example-site DB 完整性 | 与备份 `cmp` 一致 |
| example-site 服务 | 仍 inactive，未启动 |

证据：

- `temp/cloud/preview-acceptance-desktop.json`
- `temp/cloud/preview-acceptance-mobile.json`
- `temp/cloud/auth-config-before-domain.json`
- `temp/cloud/preview-review-fixture.json`（审核测试记录）

浏览器加载：桌面首屏 `networkidle` 约 2–4 s（跨境到 ap-southeast-2）。

## 7. 审核测试记录

已创建一条 pending 合成评价，等待运营者本人用真实管理员账号审核：

- review id：`preview-review-1792891361529-2f4882`
- 教师：李芳琴；课程：影视鉴赏；学期 2026-2027-1
- 操作指引：`temp/cloud/preview-review-instructions.md`
- 清理：`node temp/cloud/cleanup-preview-review.mjs`

没有重置管理员密码/MFA，没有借用管理员凭证自动审核。

## 8. 回退

```bash
UPC_HOST=root@203.0.113.10 bash deploy/cloud/rollback-preview.sh
```

只切 `/var/www/upc/current` 并 reload；不改 example-site、不删数据、不改 DNS。

完全撤回预发布（恢复 example-site 站点）需运营者确认后再执行：

```bash
sudo rm /etc/nginx/sites-enabled/upc-preview.conf
sudo ln -sfn /etc/nginx/sites-available/example-site.conf /etc/nginx/sites-enabled/example-site.conf
sudo systemctl enable --now example-site-web
sudo nginx -t && sudo systemctl reload nginx
```

## 9. 剩余事项

- 运营者用真实账号完成一次审核，然后执行清理脚本
- Auth localhost 回调在正式开放前移除
- 邮件头 SPF/DKIM/DMARC、收件箱位置、中文模板未验收
- 完整 79 项云端 E2E 未跑
- 后端免费计划无 PITR/备份
- 正式开放注册、公开访问、正式上线均未执行
- 代码变更（Nginx/部署脚本/本记录）尚未提交；封板提交 `d505736` 和标签 `v1.0.0-upc-preview` 未改动
- 阿里云安全组未在服务器内核查（ufw inactive），需运营者确认 80/443 来源策略
