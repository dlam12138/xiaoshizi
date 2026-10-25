# 预发布验收与整站门移除记录

更新：2026-10-25。运营者完成真实账号浏览器验收并补 DMARC；本轮据此移除 Basic Auth
整站门。**仍是受限预发布（注册关闭），不是正式上线。**

## 1. 真实账号浏览器验收

运营者本人输入密码与 TOTP，未借用、未保存凭据。随后我方只读核对：

| 检查 | 结果 |
| --- | --- |
| 评价 `walkthrough-review-…` 状态 | `approved`，`is_public=true` |
| 评价 `reviewer_id` | 指向运营者管理员记录 |
| 教师职称写回 | `副教授` → `副教授（已核对）` |
| 纠错台账 `upc_data_corrections` | 存在，`before/after` 正确，来源依据非空 |
| 治理申请状态 | `completed`，`assigned_admin_id` 已记录 |
| 审计 `review_approve` | 存在，`actor_user_id` 为运营者 |
| 审计 `governance_correction_apply` | 存在，target 为教师，`actor_user_id` 为运营者 |
| 两次操作同一操作者 | 一致 |

脚本：`temp/cloud/verify-walkthrough.mjs`（16 项通过）
证据：`temp/cloud/walkthrough-verification.json`

验收后清理：删除合成评价/申请/两个合成学生、还原教师职称为“副教授”、
重算公开评分。证据：`temp/cloud/walkthrough-cleanup.json`

## 2. 清理时发现并修复的残留

`user_profiles.id` 是 TEXT 且没有指向 `auth.users` 的外键，早期 E2E 直接删
`auth.users` 时留下了 **16 条孤儿档案 + 16 条 100 分欢迎流水**。

处理：按时间窗（2026-10-25 01:50–02:10 UTC）删除无对应 Auth 用户的档案与流水，
共 16 + 16 行。清理后：

```
admins 1 · auth_users 1 · profiles 1 · points 0 · reviews 0 · requests 0
corrections 0 · pins 0 · teachers 1555 · batches 0
```

这是**测试清理路径的缺陷**，不是线上业务缺陷；但说明“直接删 auth.users”不是完整的
注销实现，生产注销必须走 `scripts/process-account-deletion.mjs`。

## 3. DMARC 已补

权威 DNS 与 8.8.8.8 均可见：

```
_dmarc.auth.example.org  TXT  "v=DMARC1; p=none; rua=mailto:operator@example.com"
```

配合已有：

- DKIM `resend._domainkey.auth` TXT
- SPF `send.auth` TXT `v=spf1 include:amazonses.com ~all`
- 退信 MX `send.auth` → `feedback-smtp.ap-northeast-1.amazonses.com`

邮件认证三件套现在齐全（DMARC 为观察模式，不拦截）。

## 4. 整站门移除

- 变更前备份：`/root/backups/upc-gate-removal-20261025T0344Z/`
  （nginx 配置、htpasswd、SHA256SUMS）
- 操作：注释 `auth_basic` 与 `auth_basic_user_file` 两行，保留 htpasswd 文件
- `nginx -t` 通过并 reload
- 回退：取消两行注释后 `nginx -t && systemctl reload nginx`

实测：

| 访问 | 移除前 | 移除后 |
| --- | --- | --- |
| `https://example.org/` 未认证 | 401 | **200** |
| `https://example.org/healthz` | 200 | 200 |
| `https://www.example.org/` | 301 | 301 |
| `http://example.org/` | 301 | 301 |
| `POST /auth/v1/signup` | 422 | **422 `signup_disabled`** |

## 5. 移除后浏览器验收：8/8

| 检查 | 结果 |
| --- | --- |
| 匿名 HTTPS 200 | 通过 |
| 预发布横幅 | 通过 |
| 桌面注册 CTA 隐藏 | 通过 |
| 桌面教师库搜索 + 详情 | 通过 |
| 移动预发布横幅 | 通过 |
| 移动注册 CTA 移除 + “注册暂未开放” | 通过 |
| 移动搜索 + 详情 | 通过 |
| 移动无横向溢出 | 通过 |

首屏 `networkidle` 约 5.0 s（跨境到 ap-southeast-2）。证据：
`temp/cloud/post-gate-desktop.json`、`temp/cloud/post-gate-mobile.json`

## 6. 当前状态

- `https://example.org`：公开可读，注册关闭，评价提交需登录
- 公开目录：1,555 教师、1,342 课程、2,946 开课
- 评价：0 条（预发布，尚无真实评价）
- Auth：`site_url=https://example.org`，中文邮件模板，DMARC 观察模式
- example-site：服务 inactive/disabled，数据未删，DB 与备份一致
- 部署版本：`20261025T0120Z`，来自 `d505736`
- Basic Auth：已停用，配置与 htpasswd 保留可回退

## 7. 仍未完成

- 邮件头 SPF/DKIM/DMARC 的**收件箱侧**确认（运营者尚未回报）
- 完整云端 E2E 仍有重叠缺口
- 云端免费计划无 PITR/自动备份
- 正式开放注册、真实用户评价、正式上线均未执行
- 本记录与部署脚本变更尚未提交
