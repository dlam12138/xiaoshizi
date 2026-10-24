# SEC-01 运行态只读审计摘要

更新：2026-10-24。环境：本机 native Supabase。仅本机；不代表云端或生产。

## 结果

| 项目 | 计数 |
| --- | ---: |
| Auth 账户 | 6 |
| 已确认 | 6 |
| `@s.upc.edu.cn` | 0 |
| 非学生域 | 6 |
| 未确认 | 0 |
| 管理员行 | 1 |
| 管理员未匹配 Auth 主体 | 0 |
| 普通评价 | 1 |
| 重复用户×教师×课程×学期组 | 0 |
| 非空文字评价 | 0 |
| 自定义公开署名 | 1 |
| 评价关联缺失 | 0 |
| 评价奖励流水 | 7 |
| 评价关联已丢失的奖励流水 | 6 |

公开 Auth 设置：Email 开启；Phone 关闭；匿名关闭；未发现第三方 provider。

## 处理

- 现有账户均为历史非学生域。保留登录、本人资料读取和删除申请；禁止新增评价和邮箱换号。
  不自动删除、改号或合并。
- 现有评价无重复业务组，唯一索引可建立。
- 6 条无主奖励流水标记为 `needs_verification`；受影响的后续奖励不自动发放，
  不把缺失关联解释为“从未奖励”。
- 管理员 1 行已绑定 Auth `user_id`，邮箱不再是授权键；该既有绑定域为 `example.test`，
  不符合新的 Gmail-only 规则。**审计当时只报告；后于 2026-10-24 由运营者停用，账户/角色/MFA 保留，未改邮箱。**
- 本审计是升级前的只读盘点。2026-10-24 18:xx 已对 WSL 原库应用
  `security-governance`、`owner-admin-policy`、`governance-boundary`、
  `remove-teacher-appeal` 和纠错闭环补丁；升级后备份/恢复核对和 post-check 见
  `docs/upc-security-delivery.md` 第 11 节。本审计的旧绑定仍保留但已停用；迁移不得恢复其权限。

## 明细

敏感明细仅在 Git 忽略目录：

- `temp/supabase-local/security-audit/audit-detail.json`
- `temp/supabase-local/security-audit/summary.json`
- `temp/supabase-local/security-audit/SUMMARY.md`

仓库不保存邮箱、账户 ID、评价 ID 或奖励明细。

## 复现

```powershell
npm run security:audit
```

脚本只读 Auth Admin API、评价、管理员、积分流水和 `/auth/v1/settings`；不删除、不改号。
