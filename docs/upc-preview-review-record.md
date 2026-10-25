# 预发布审核完成记录

更新：2026-10-25。运营者已用真实管理员账号完成一次审核，并执行了清理。

## 审核证据

- 管理员：`operator@example.com`，`super_admin`、active、1 个 verified TOTP
- 审核记录：`private.upc_admin_audit_log` id=18
  - action `review_approve`
  - target `preview-review-1792891361529-2f4882`
  - time `2026-10-25 01:38:39 UTC`
- 这是**真实管理员**产生的可复核审计，不是合成管理员或自动化调用
- 未重置密码/MFA，未借用运营者凭证

## 清理结果

- 评价：0（fixture 评价已删）
- `offering_rating_stats`：0
- 教师 `review_count` 总和：0，`rating_public`：0
- 教师目录摘要：`180eaac4afc0e1fc3b6e755c4d3044b3`（与迁移时一致）
- Auth 用户：1（仅 `operator@example.com`）
- profile 1、积分流水 0、管理员 1
- 合成学生 `preview-review-...@s.upc.edu.cn` 的 Auth 账号已在复核后补删
  （首次清理时 `deleteUser` 错误未被检查，已修复脚本并删除残留）

证据：

- `temp/cloud/preview-review-cleaned.json`
- `temp/cloud/preview-review-user-deleted.json`

## 审计日志保留说明

`private.upc_admin_audit_log` 由 `upc_admin_audit_immutable` 触发器保护，禁止
UPDATE/DELETE。当前共 **18 行**：

- 1 行 `admin_bootstrap`（云端首个管理员引导）
- 16 行 `cloud-e2e` 合成测试
- 1 行 `preview-review` 真实审核（本次）

这些是审计/测试日志，不是业务数据。没有绕过不可篡改控制删除。
如需清空，只能由运营者在维护窗口决定重建项目或执行受控 DDL，属于破坏性操作，
本轮不做。

## 当前预发布状态

- `https://example.org`：未认证 401，Basic Auth 后 200
- `https://www.example.org`：301 → 根域
- `/healthz`：200
- 注册：前端关闭 + Auth `disable_signup=true`（实测 422）
- example-site：服务 inactive/disabled，DB 与备份一致，数据未删除
- release：`/var/www/upc/releases/20261025T0120Z`

## 仍待运营者决定

1. 阿里云安全组 80/443 来源策略
2. Auth localhost 回调是否现在移除
3. 部署配置变更是否单独提交为 `deploy:` 提交
4. 是否继续补齐云端未覆盖 E2E 后再谈正式开放
