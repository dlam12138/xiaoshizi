# 历史脱敏、依赖修复与 Turnstile 人机验证

更新：2026-10-25。本文保留历史执行记录；其中早先的“残留 0 处”只对应当时扫描范围，
不包含提交作者元数据，也不代表之后的提交没有重新引入信息。最新复核见[公开准备审计](upc-publication-audit.md)。

## 1. 历史重写脱敏

| 项 | 结果 |
| --- | --- |
| 工具 | `git filter-repo 2.47.0` |
| 替换 | [redacted operator email] → `operator@example.com`；[redacted local user path] → `%USERPROFILE%` |
| 提交数 | 50 个全部重写 |
| 历史残留 | 邮箱 0 处、本机路径 0 处、私钥标记 0 处 |
| 主分支 | `98594c8`（重写后） |
| 标签 | `v1.0.0-upc-preview` → `de64941` |
| 推送 | `main` 与标签均强推 |
| 备份 | `release/pre-rewrite-20261025.bundle`（3.2 MB，Git 忽略） |

说明：

- 强推后旧 SHA 不可达；GitHub 可能短期保留不可达对象
- 三个附属 worktree 的提交同时被重写，SHA 已变化
- 私有仓库，未匿名暴露

## 2. 依赖告警

| 项目 | 前 | 后 |
| --- | --- | --- |
| 根项目 | 3 high（vite / source-map-js / body-parser） | 0 |
| server | 1 high（body-parser） | 0 |

`vite 6.4.5`、`body-parser 1.20.9+`；`tsc`、根 60/60、服务 18/18、`build:cloud` 均通过。
提交 `fc50a4b`（重写后 SHA 变化）。

## 3. Turnstile 启用

| 项 | 值 |
| --- | --- |
| Provider | Cloudflare Turnstile |
| Site Key | `REPLACE_WITH_TURNSTILE_SITE_KEY`（可公开，随前端构建） |
| Secret | 只存 `temp/cloud/turnstile.secret` 与 Supabase Auth 配置，未入库 |
| 覆盖 | 注册、登录、找回密码 |
| Supabase | `security_captcha_enabled=true`、`security_captcha_provider=turnstile` |

前端：`TurnstileWidget` 显式渲染，token 单次使用，失败后强制刷新；
未配置 site key 时完全不渲染，本地开发不受影响。

部署：`/var/www/upc/releases/20261025T0452Z`

## 4. 验证

无 token 直接调用（服务端强制）：

| 端点 | 结果 |
| --- | --- |
| `POST /auth/v1/signup` | `400 captcha_failed`（no captcha_token found） |
| `POST /auth/v1/token?grant_type=password` | `400 captcha_failed`（no captcha_token found） |

带 token 的真实浏览器（有头 Edge，托管挑战自动通过）：

| 检查 | 结果 |
| --- | --- |
| Turnstile iframe 渲染 | 通过 |
| 无 token 时客户端拦截提交 | 通过 |
| 带 token 注册成功 | 通过（账号未确认、欢迎积分已建） |
| 测试账号清理 | 通过（auth/profile/积分全删） |
| 带 token 登录 | 通过（错误密码返回“邮箱或密码错误”，非 captcha_failed） |

证据：`temp/cloud/captcha-live-check.json`、`temp/cloud/captcha-login-check.json`

## 5. 风险

- Turnstile 依赖 `challenges.cloudflare.com`，境内可达性不稳定；
  加载失败时前端会提示“人机验证加载失败”，当前**没有降级通道**
- 未实现“验证码失败降级为邮件确认 + 限流”
- DMARC 仍为 `p=none`
- 免费计划无 PITR/自动备份

## 6. 回退

- 关闭验证码：Supabase 设 `security_captcha_enabled=false`
- 关闭前端 widget：构建时不提供 `VITE_TURNSTILE_SITE_KEY`
- 恢复历史：`git bundle` 备份可克隆回旧历史（仅本地）
