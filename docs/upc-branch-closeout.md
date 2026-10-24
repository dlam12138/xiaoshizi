# 安全治理与云端迁移分支收尾范围

更新：2026-10-24。工作区 `/path/to/xiaoshizi`，分支 `feat/launch-security-governance`。
本文定义代码交付范围、版本记录和下一阶段事项，不表示已经推送、合并或正式上线。

## 本分支交付范围

- 安全治理代码、旧库升级路径、管理员会话绑定和 MFA 恢复修复。
- 隔离 SEC-G0 验收；WSL 目标库升级、备份恢复核对和会话专项验收。
- 托管项目 schema/正式数据迁移，显式 grants 修复与派生评分重算。
- 云端管理员启用和 TOTP 绑定；旧测试管理员不进入云端。
- 云端业务闭环（评价/审核/公开门槛/积分幂等/点赞/撤回/纠错）与覆盖对照。
- Resend 域名验证、托管 SMTP、单封真实恢复邮件投递（服务商 `delivered`）。
- 预发布限制注册：前端 `VITE_REGISTRATION_OPEN/VITE_PRE_RELEASE` 门、注册入口收敛、
  单测；`upc.example.org` 部署与回退方案。
- 部署/回退准备、服务器只读核查记录、DNS 清单、证据索引。

## 不在本分支完成的事项

- 正式服务器发布、Nginx/TLS 实际配置、正式域名切换。
- 云端完整 79 项 E2E（当前仅 26 + 核心 25 + 纠错 4，类别有重叠）。
- 邮箱变更、邀请接受、账号注销/失败恢复、moderator 全矩阵、重导入保护。
- 云端付费备份/PITR 与真实恢复演练。
- P1-02 运营信息继续冻结，不能记作已完成。
- 真实管理员人工审核的可复核审计。

## 版本记录

| 项目 | 值 |
| --- | --- |
| 分支 | `feat/launch-security-governance` |
| 基线提交 | `cded096` release: 小石子本机验收封版与脱敏目录 |
| 应用版本 | `1.0.0`（`package.json`） |
| 服务版本 | `1.0.0`（`server/package.json`） |
| 云端项目 | `your-project-ref`（ap-southeast-2，Postgres 17.11） |
| 发信域 | `auth.example.org`（Resend，verified，click/open tracking off） |
| 预发布域名 | `upc.example.org`（方案已备，未解析/未部署） |
| 静态包 | `release/upc-cloud-static-20261024-2026.tar.gz`（Git 忽略） |
| 封板标签 | `v1.0.0-upc-preview`（指向本提交，避免 SHA 自引用） |

最终提交 SHA 由 `v1.0.0-upc-preview` 标签指向，并在交付报告中列出；工作树在提交后保持干净。

## 封板条件与当前状态

1. 代码、SQL、运维脚本和文档纳入版本控制；凭据、一次性链接、dump、临时验收数据排除。
2. 根测试、服务测试、类型检查、构建通过，结果与提交 SHA 一并记录。
3. 代码收尾审阅完成，未覆盖项和上线阻塞已列明。
4. 分支交付通过与生产上线放行是两个独立结论；本分支只证明前者。

本轮不推送、不合并、不发布服务器。真实邮件只完成 1 封服务商侧 `delivered`，
收件箱位置、SPF/DKIM/DMARC 明细和链接点击仍待验收。

## 下一步发布任务

- 按 `docs/upc-preview-deployment.md` 完成 SSH、DNS、Nginx、TLS、Auth 回调和预发布验收。
- 按 `docs/upc-email-resend.md` 完成邮件头与链接验收。
- 按 `docs/upc-cloud-e2e-coverage.md` 补齐未覆盖云端流程后再讨论正式上线。
