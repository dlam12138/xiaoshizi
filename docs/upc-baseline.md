# UPC 迁移基线记录（P0）

记录时间：2026-10-22。执行目录：`<repo>`，分支 `main`，提交 `9c08ac3`。

## 工作区现状

开始时 `git status --short` 只有三个未跟踪文件，均予保留：

- `LOCAL_DEPLOYMENT.md`（既有本地部署记录）
- `docs/upc-migration-plan.md`（本次执行依据）
- `start-upc.cmd`（既有本地预览脚本）

没有已跟踪文件的未提交修改。迁移过程中只改当前仓库，不操作旧站运行环境。

## 基线命令与结果

| 检查 | 命令 | 结果 | 说明 |
| --- | --- | --- | --- |
| 类型检查 | `npm run lint` | 通过（exit 0） | `tsc --noEmit` |
| 前端生产构建 | `npm run build` | 通过（exit 0） | Vite 6.4.3，生成旧品牌代码块 |
| 根目录测试 | `npm test` | 65/66 通过，1 失败 | 失败为既有数据文件缺失，见下 |
| Node API 测试 | `cd server && npm test` | 25/25 通过 | 缓存、审核、通知、课表用例 |

既有失败：

```
tests/timetable-encoding-repair.test.mjs
ENOENT: no such file or directory
schule2026-2027-1/supabase-web-import/00-create-upload-table.sql
```

该文件不在仓库中（`schule2026-2027-1/` 只有说明文档），属于迁移前已存在的数据缺失，不是
本次改造引入。处置方式：该用例依赖的旧校课表编码/上传表属于 P3 且不在 UPC 一期范围，
随旧课表代码、脚本和数据目录一起移除，避免把旧校样例带入 UPC；P3 恢复时用 UPC 样例重新
编写，不通过删除断言或放宽权限制造通过。

迁移后最终基线：

- `npm run schema:build`：安全治理上线后生成 7 段 SQL（基础表、学院种子、安全增量、权限、
  治理、触发器、导入 RPC）。
- `npm run lint`：通过。
- `npm test`：基线当时 40/40；治理边界收尾后 48/48（分页、Schema/导入、服务、真实批次、
  邮箱、Gmail 邀请、历史评价治理、withdrawn 键与门槛回填）。
- `npm run build`：通过；产物无 AI/通知/课表 chunk。
- `npm run test:server`：18/18 通过。
- 未配置首屏在 Edge headless 下渲染为“环境配置检查”，无旧校/mock 文本。

构建基线产物（迁移前）：`dist/assets/index-HcsA31o3.js`、`AgentNoticeModal-*.js`、
`AiAssistantModal` 相关代码按需加载。迁移后这些 AI 入口和组件必须消失。

## 旧环境默认连接（已确认）

迁移前 `src/lib/supabase.ts` 在前端硬编码：

- URL：`https://qczsdnmwtagwbofpvwle.supabase.co`（仅作为拒绝目标记录）
- publishable key：已从源码移除；旧值不再作为连接凭据，本文不复述完整 key
- 浏览器存储前缀：`swjtu_`
- Redis 默认前缀：`swjtu:prod:cache:v1:`
- `server/deploy/provision.py` 还把上述 URL、key 和旧 Redis 账号/路径写入部署脚本。

迁移后改为：只读取 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（或
`VITE_SUPABASE_PUBLISHABLE_KEY`），缺配置或配置非法时明确报错并停止连接；旧项目 host 和
旧 host 被硬拒绝，旧 key 已从源码移除，不再作为兜底。浏览器旧 `swjtu_*` 键只删除、不读取。

## 环境隔离方案

- 目标：新的独立 Supabase 项目承载 UPC 业务；开发、测试、正式各用一套项目与密钥。
- 本地开发：`.env.local` 填 UPC 项目 URL 与匿名 key；缺失时页面显示配置缺口，不加载 mock
  或旧校数据。
- 测试：目标环境验收必须使用独立测试项目；本地自动化使用 PGlite 夹具，不替代真实项目鉴权。
- 正式：独立正式项目；不得把开发/测试项目密钥用于正式发布。
- 缓存：可选；一期默认 `VITE_CACHE_API_ENABLED=false`，直连 Supabase。启用时缓存前缀必须为
  `upc:` 命名空间，服务端缺凭据时启动失败而不是连接旧 Redis。

## 品牌与一期边界决定

- 产品名统一为 `小石子`，页面副标题使用
  `中国石油大学（华东）课堂反馈`。
- 校名写法：`中国石油大学（华东）`；简称 `石大`。
- Logo：未取得官方授权资产，使用中性几何图标，不复制学校校徽。
- 主色：暂沿用现有靛蓝体系，品牌定稿后再统一；不因迁移开展整站重设计。
- 域名：未定，部署配置使用占位符 `eval.example.edu.cn`，不得作为正式域名上线。

一期只保留课堂反馈业务。课表推荐、教务通知、经验攻略、历史迁移说明和 AI 问答全部不进入
导航、首页、服务页或个人中心；没有真实 UPC 数据前不展示“全校完整库”等表述。

## 阶段门 G0 结论

范围、环境和隔离方案已明确，基线已记录，可进入本地改造。真实教师/课程/学期数据和新
Supabase 凭据尚未取得；这些缺口不阻塞 P1 与 P2 的代码、SQL 和本地测试，但阻塞 P2-9 的
真实项目鉴权和 P4-3 的目标环境验收。
