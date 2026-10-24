# UPC 云端 E2E 覆盖对照（2026-10-24）

隔离栈 79 项是原始安全闭环基线；本表说明哪些在托管项目重跑、哪些仍只有隔离证据。
云端当前数字不是“79 项全通过”。

| 能力 | 隔离 79 项 | 云端实际 | 结论 |
| --- | --- | --- | --- |
| Gmail 私有邀请、AAL1/AAL2、角色提升 | 有 | 合成管理员 AAL1/AAL2、AAL1 拒绝 | 部分 |
| 无邀请 Gmail/学校域拒绝 | 有 | 云端 Hook 无邀请 Gmail 400 | 部分 |
| 管理员 session 撤销、旧 AAL2 拒绝、重登恢复 | 有 | 10/10 | 云端通过 |
| 邮箱变更双重确认 | 有 | 未跑（无真实邮件） | 仅隔离 |
| 评价提交 pending、匿名不可见 | 有 | 6 条合成提交 + 匿名读取拒绝 | 云端通过 |
| 审核通过/驳回、理由、审核权限 | 有 | 5 通过 + 1 驳回 + 学生拒绝 | 云端通过 |
| 公开 feed/教师分数 5 人门槛 | 有 | 5 人触发；撤回后回落 | 云端通过 |
| 积分 +20、重复审核幂等 | 有 | 120 分、仅 1 条奖励流水 | 云端通过 |
| 点赞/取消 | 有 | 持久化并反转 | 云端通过 |
| 撤回报备/隐藏 | 有 | accepted withdrawal，feed 回落 | 云端通过 |
| 教师资料纠错写回、重复写回拒绝 | 有 | 4/4 | 云端通过 |
| 课程/开课纠错、重导入保护 | 有 | 未跑云端 | 仅隔离 |
| 账号注销、失败恢复、残留重试 | 有 | 未跑云端 | 仅隔离 |
| moderator 审核/治理边界全矩阵 | 有 | 未跑云端 | 仅隔离 |
| 浏览器桌面/移动完整流程 | 17 项 | 公开目录/详情/移动 5 项 | 部分 |
| 真实邮件注册/恢复 | 79 项内 | 未跑（无 SMTP） | 仅隔离 Mailpit |

云端合计：早期 26 项（Hook/会话/角色/评价提交/浏览器）+ 核心生命周期 25 项 +
纠错 4 项；类别有重叠，**不是 79 项全集**。

## 证据

- `temp/cloud/cloud-session-report.json`（10）
- `temp/cloud/cloud-role-report.json`（6）
- `temp/cloud/cloud-review-report.json`（4）
- `temp/cloud/cloud-ui-smoke-report.json`（5）
- `temp/cloud/cloud-e2e-core-report.json`（25 + 纠错引用）
- `temp/cloud/cloud-correction-report.json`（4）
- `temp/cloud/cloud-migration-report.json`
- `temp/cloud/cloud-evidence-index.json`（报告 SHA-256/清理后状态）

## 清理/审计

- 合成用户、管理员、教师、课程、开课、评价、点赞、积分、治理请求已清理；
- 当前云端 Auth 1、admin 1、profiles 1、points 0、reviews 0；
- 审计日志表由不可篡改触发器保护，保留 16 条 `cloud-e2e` 测试审计记录；
  未绕过该安全控制删除，作为测试日志保留并在此披露。
