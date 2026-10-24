# 账户注销与个人数据删除 Runbook

更新：2026-10-24。**现有真实本机库的 6 个账户未删除，也未执行新补丁。**
本文是受控后台执行前的核对单；不得把“申请已接受”当作已经删除。
独立 native 栈已用合成账户完成注销全过程和强制失败/续跑验证。

## 影响范围

执行删除会：

- **先删除 Auth 用户**，使登录和旧 token 立即失效；
- 删除该账户的评价；触发器重算公开统计并撤销小样本/公开投影；
- 删除其资料、积分流水、全部治理申请和私有处理事件；
- 删除其对他人的点赞；评价删除会级联删除他人对该评价的点赞；
- 保留：
  - 不可变管理员审计日志（不含评价正文、邮箱或学号）；
  - 已确认资料纠错的前后值、来源依据和保护钉；删除申请时 `request_id` 置空，
    不撤销已生效的教师/课程纠正；
  - 最小奖励防滥用业务标记（业务键，不含正文）；
  - 备份中按到期策略保留的数据（恢复后需再次执行删除）。

缓存若启用，还必须在执行后失效该教师/评价相关缓存。

## 前置条件

1. 请求类型为 `account_deletion`，状态为 `accepted`。
2. 已有可验证备份和恢复方案。
3. 运营者已按隐私政策确认保留项、期限和删除时限。
4. 双人复核请求和身份；不要把邮箱、学号写入工单正文。
5. 先运行 dry-run，核对 `reviews`、`likesByUser`、`likesOnAuthoredReviews`、
   `pointTransactions`、`governanceRequests` 和 Auth 存在状态。

## 连接目标

默认读取 `.env.import.local`。只允许 loopback URL。对隔离栈显式指定：

```powershell
$env:UPC_ENV_FILE = 'temp/isolated-supabase/.env.isolated'
```

不要把真实密钥写入 Git。

## Dry-run

```powershell
node scripts/process-account-deletion.mjs <request-id>
```

输出只含计数和影响范围，写入 Git 忽略的 `temp/security-backups/`。

## 执行

```powershell
node scripts/process-account-deletion.mjs <request-id> --execute --confirm
```

`--execute` 与 `--confirm` 必须同时提供；否则脚本拒绝执行。

## 执行顺序与失败恢复

1. 先删除 Auth 用户。若失败，脚本在删除任何业务数据前退出，数据保持原样。
2. 删除评价、资料、积分和治理申请。
3. 逐项查询后置计数；任一残留则报告 `status: "incomplete"` 并以非零退出。
4. 若 Auth 已删除但业务清理失败，报告 `status: "failed"`，保留请求和数据。
   修复根因后，用同一请求和明确的用户 ID 续跑：

```powershell
node scripts/process-account-deletion.mjs <request-id> --user-id <uuid> --execute --confirm
```

5. 续跑仍会重新检查 Auth 是否已不存在、评价/资料/点赞/积分/请求是否已清理；
   不得把“没有报错”当作完成，必须看到 `status: "completed"` 且 `remaining` 全为零。

## 执行后核对

- Auth 用户不存在，旧会话的读取和写入均失败；
- 资料、评价、写入方点赞、评价上的点赞、积分流水、治理申请均已清除；
- 教师 `review_count`/公开分数与 `offering_rating_stats`、`review_feed` 已重算；
- 审计日志保留但不含个人明细；
- 已确认资料纠错台账保留，但关联申请为 NULL；教师/课程纠正和保护钉仍生效；
- 最小奖励业务标记保留（按政策说明期限）；
- 备份到期策略和再次删除流程已记录。

## 验证状态

- 隔离 E2E 已完成（79 项）：合成账户的评价、他人点赞、积分、治理申请、公开统计、旧会话写入、
  奖励标记保留。
- 隔离 E2E 已完成强制评价删除失败：Auth 先失效，报告 `failed`，残留评价/资料可核对；
  移除故障后 `--user-id` 续跑，最终 `completed`。
- 纠错证据脱钩已由根测试覆盖：删除申请后台账/保护钉保留、`request_id` 为 NULL、
  已纠正目录值不撤销。
- **未删除现有真实本机账户，未在生产执行。**
