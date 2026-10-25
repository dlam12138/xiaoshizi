# 开放正式注册记录

更新：2026-10-25。运营者授权合并主线、推送 GitHub 后开放正式注册。本文记录实际执行、
验收证据与剩余风险。**站点已公开且注册开放，但仍有未完成项，不宣称“正式上线完成”。**

## 1. 代码合并与推送

远端发生改名：`dlam12138/UPC` → `dlam12138/xiaoshizi`，本地 `origin` 已更新为新地址。

| 提交 | 说明 |
| --- | --- |
| `d505736` | 封板提交，标签 `v1.0.0-upc-preview` |
| `55fdca0` | 根域预发布部署配置与记录 |
| `e09049b` | 扩展 E2E 与邮件本地化 |
| `03f4133` | 验收、DMARC、整站门移除 |
| `bcf498c` | 开放注册模式的注册门单测 |
| `60b3e38` | 开放注册时恢复注册入口与积分文案 |

- `main` 快进到 `60b3e38` 并推送
- 标签 `v1.0.0-upc-preview` 已推送（指向 `d505736`）
- 未改写历史，未强制推送
- GitHub 提示默认分支存在 8 个依赖告警（4 high / 3 moderate / 1 low），未处理

## 2. 开放注册的配置变更

变更前备份：`temp/cloud/auth-config-before-open.json`

| 键 | 变更前 | 变更后 |
| --- | --- | --- |
| `disable_signup` | `true` | **`false`** |
| `rate_limit_email_sent` | `2` | **`30`**（每小时，否则无法支撑注册确认邮件） |
| `mailer_autoconfirm` | `false` | 不变（必须邮箱确认） |
| `security_captcha_enabled` | `false` | 不变（**未启用人机验证**） |

保留：`site_url=https://example.org`、中文邮件模板、学生域 Hook、DMARC `p=none`。

## 3. 前端构建与部署

- 构建开关：`VITE_REGISTRATION_OPEN=true`、`VITE_PRE_RELEASE=false`
- 预发布横幅移除；桌面/移动注册入口恢复
- 部署 release：`/var/www/upc/releases/20261025T0405Z`
- 首次 `20261025T0355Z` 构建仍带“注册暂未开放”硬编码文案，已修复后重建覆盖

修复内容：

- `DesktopQuarkHome`：按开关切换“注册参与课堂反馈 / 登录参与课堂反馈”
- `DesktopUserProfile`：按开关切换“立即注册 (赠送 100 积分) / 登录账号”
- `MobileUserProfile`：按开关切换“注册 / 登录”与积分文案

## 4. 验收

浏览器（匿名，无 Basic Auth）：

| 检查 | 结果 |
| --- | --- |
| `https://example.org/` 200 | 通过 |
| 预发布横幅已移除 | 通过 |
| 桌面头部注册 CTA | 通过 |
| 登录弹窗注册 tab | 通过 |
| 注册福利与提交按钮 | 通过 |
| 移动注册入口 | 通过 |
| 移动无“注册暂未开放” | 通过 |

证据：`temp/cloud/launch-desktop.json`、`temp/cloud/launch-mobile.json`（9/9）

公共注册接口：

| 检查 | 结果 |
| --- | --- |
| `@s.upc.edu.cn` 注册 | 接受，创建未确认用户 |
| 邮箱确认状态 | 仍需确认（`email_confirmed_at=null`） |
| 欢迎档案与 100 积分 | 已创建 |
| `@gmail.com` 注册 | 拒绝，未留 auth 行 |
| 测试账号清理 | 已删除 auth/profile/积分 |

证据：`temp/cloud/launch-signup-report.json`（6/6）

说明：该次注册 API 返回前出现一次连接重置（`ECONNRESET`），但数据库行证明创建成功；
已按实际行状态补完断言。测试地址不存在，确认邮件会产生一次退信。

## 5. 当前线上状态

- `https://example.org`：公开访问，注册开放，邮箱确认后可用
- 注册限制：仅 `@s.upc.edu.cn`，需邮件确认
- 目录：1,555 教师 / 1,342 课程 / 2,946 开课
- 评价：0 条，公开评分尚未产生
- 管理员：1 人（`operator@example.com`，super_admin，TOTP 已绑定）
- example-site：服务停用，数据未删
- 部署版本：`20261025T0405Z`，对应提交内容 `60b3e38`

## 6. 剩余风险与未完成

- **未启用人机验证**，公开注册可能被脚本刷号（有学生域 Hook 与邮件限流兜底）
- `rate_limit_email_sent=30/h`，高峰期确认邮件可能延迟
- Supabase free 计划无 PITR/自动备份
- DMARC 为 `p=none` 观察模式
- 邮件头收件箱侧确认仍未回报
- 完整云端 E2E 仍有重叠缺口
- 8 个依赖告警未处理
- 审计日志 29 行（含 16 条合成测试），不可删除

## 7. 回退

关闭注册：

1. `PATCH /config/auth` `disable_signup=true`
2. 用 `node temp/cloud/write-frontend-env.mjs`（不带 `--open-registration`）重建
3. 部署新 release 并切换 `current`

恢复整站门：

1. 取消 `/etc/nginx/sites-available/upc-preview.conf` 中 `auth_basic` 两行注释
2. `nginx -t && systemctl reload nginx`

回退部署：`bash deploy/cloud/rollback-preview.sh`（改域名后需 `UPC_HOST`）。
