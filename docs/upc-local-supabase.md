# 本机真实 Supabase 验收环境

本文件描述 `<repo>` 的本机 native Supabase 测试栈。它是**本机真实验收环境**，
不是云端独立测试项目，也不是生产环境。

## 入口与端口

| 服务 | 地址 |
| --- | --- |
| 前端 | <http://localhost:3000> |
| Supabase API | <http://127.0.0.1:54321> |
| Postgres | `127.0.0.1:54322` |
| Studio | <http://127.0.0.1:54323> |
| Mailpit | <http://127.0.0.1:54324> |

运行方式：WSL Ubuntu-24.04 内的官方 Supabase CLI v2.121.0 native runtime，
不需要 Docker。持久数据在 WSL `~/.supabase/stacks/`。

## 本机配置

真实配置只在本机忽略文件中：

- `.env.local`：前端 URL、公开 anon/publishable key、`VITE_CACHE_API_ENABLED=false`
- `.env.import.local`：同一项目 URL、仅服务端 service_role key
- `.env.test.local`：本机测试账号和密码

这些文件已被 `.gitignore` 的 `.env*` 忽略。不要把 key、密码或 session token
写入文档、日志、截图或版本控制。

`scripts/local-supabase.mjs` 启动时会写入两个 env 文件，并拒绝覆盖指向其他
endpoint 的配置；已有云端项目配置不会被本机启动覆盖。

## 启停与检查

```powershell
# 查看 native 栈是否健康（只输出 runtime/api/studio/mail）
npm run supabase:status

# 已停止时启动现有持久栈；不会重置数据
npm run supabase:start

# 检查前端/导入 env 是否指向同一个本机项目
npm run check:supabase

# 只读核对本机真实数据：清单 expected 总量 + 化学子集 136/129/271
npm run check:supabase:remote -- --strict

# 本机前端（若 3000 未启动）
npm run dev
```

**不要再次执行 `npm run supabase:init`。** 本机数据库已经初始化并导入真实批次；
初始化脚本会拒绝覆盖已有应用表。不要 reset 数据库。

停止栈但保留数据：

```powershell
npm run supabase:stop
```

## 当前真实数据

- 化学既有批次：`data/upc/chemistry-2026-2027-1/import.json`
  - 136 名已核实教师 / 129 门课程 / 271 条关系；
  - 16 组化学同名不同编码；化学 5 名无个人资料教师已按课表身份保留。
- 新增 15 个学院批次（含外国语）+ 独立教学单位石油工业训练中心 `upc-17`：
  `data/upc/timetables-2026-2027-1/units/*/import.json`
  - 同院同名官方增量：12 个官方身份、18 条课程关联（6 门实际新课程；3 条 inferred）；
  - 课表身份增量：173 个 `tt-` 身份，本轮新增 153 教师/52 新课程/267 关系；
  - 全局 1,555 教师身份 / 1,342 课程 / 2,946 关系（官方 profile 1,382 + 课表身份 173）；
  - 同名不同编码组全局 133；
  - 教师身份未解决 0；3 条课程关系已按研究方向暂定（inferred），6 条文法 `OTH` 冲突关系排除；
  - `OTH921331020 沟通与写作`：新增 23 条冲突关系排除，化学既有 1 条保留；
  - 外国语 100 候选（官方 89 + 课表 11），导入 100/88/207；
  - 训练中心官方 8 + 课表 5，共 13 教师/6 门课程/25 条关系。
- 学期 `2026-2027-1`，所有批次 `isCurrent=false`。
- 所有已导入教师 campus 为 `null`。
- `manifest.json` 保存全局 expected、化学子集、分口径候选统计和逐单位说明；
  strict 检查使用该清单，不再硬编码化学单学院总量。

本机 `import_batches` 现有 44 条：化学 2 条 + 15 个新增学院各首次/幂等 2 条 +
训练中心首次/幂等 2 条 + 课表身份增量 4 条（18 身份首次/复跑、化学扩展首次/复跑）+
同院同名官方增量 2 条（首次/复跑）+ 153 身份扩展 2 条（首次/复跑）+
研究方向暂定 2 条（首次/复跑）；
dry-run 不留下业务数据或批次。
重复正式导入新增业务行 0。
跨院修正精确删除 20 条关系/3 门孤立课程/2 名无任何已接受单位的教师（评价 0 条），
再导入训练中心和外国语；未整库回滚。导入前备份
`upc-pre-multicollege-2026-10-23T04-11-04-725Z.dump`（SHA-256 `9cf469...f4a34`），
修正前备份 `upc-before-cross-unit-correction-2026-10-23T05-07-35Z.dump`
（SHA-256 `f481db...8e94a6`），外国语导入前备份
`upc-before-foreign-2026-10-23T06-03-12Z.dump`（SHA-256 `3dd303...1075c`）；
课表身份导入前备份 `upc-before-timetable-identities-2026-10-23T06-50-16Z.dump`
（SHA-256 `638ac9...4cea9`）；化学扩展前备份
`upc-before-chemistry-extension-2026-10-23T07-34-08Z.dump`（SHA-256 `8785cc...4edf7`）；
同院同名/153 扩展前备份
`upc-before-same-name-153-2026-10-23T08-38-41Z.dump`（哈希 `2777cc...e5c81`）；最终备份
`upc-post-same-name-153-2026-10-23T08-40-18Z.dump`（哈希 `dc5aa1...7e4f34`）；
研究方向暂定前备份 `upc-before-inferred-3-2026-10-23T09-32-28Z.dump`
（哈希 `752597...101fa8`）；最终备份 `upc-post-inferred-3-2026-10-23T09-33-16Z.dump`
（哈希 `918101...aa4d9b`）；评分规则升级前备份
`upc-before-rating-4-5-2026-10-23T11-36-02Z.dump`（哈希 `b66ed5...d2fbba`）；
升级后备份 `upc-post-rating-4-5-2026-10-23T11-59-40Z.dump`（哈希 `679268...7b14`）。

内容一致性：把导入前备份恢复到隔离临时库，规范化行内容哈希与原 136 教师、129 化学
课程、271 化学关系、profiles/积分 ledger/reviews/likes/admin/auth 和原 16 学院行比较，
全部 `equal=true`；仅输出一致性与数量，未输出个人内容/密钥。

## 本机 Auth 与验收

- 邮箱注册/确认、登录、recovery 邮件由本机 GoTrue + Mailpit 验证。
- Mailpit 只证明本机邮件链路，**不代表外部 SMTP 投递验收**。
- 三测试账号和页面测试账号只在 `.env.test.local`，不得输出或提交。
- 本机验收覆盖：
  - 三账号真实登录；
  - 匿名私有表隔离；
  - 资料/积分/管理员越权拒绝；
  - pending 评价隔离和开课关系约束；
  - 审核公开、+20 积分和重复审核幂等；
  - 点赞/重复/取消；
  - 驳回、作者修改、重提、再审核；
  - 删除最后一条 approved 后评分清空；
  - 签到幂等；
  - 桌面/移动页面完整闭环。

证据：

- `temp/supabase-local/acceptance.json`
- `temp/supabase-local/ui-auth-report.json`
- `temp/supabase-local/ui-review-report.json`
- `temp/supabase-local/ui-visual-smoke.json`
- `temp/supabase-local/new-college-ui-smoke.json`
- `data/upc/timetables-2026-2027-1/manifest.json`
- `data/upc/timetables-2026-2027-1/import-results.json`
- `data/upc/timetables-2026-2027-1/report.md`
- `data/upc/timetables-2026-2027-1/existing-data-protection.json`
- `temp/supabase-local/current-desktop-detail.png`（稳定帧）
- `temp/supabase-local/current-mobile-detail.png`（稳定帧）
- `temp/supabase-local/new-college-*.png`（孙永鹏/王文东桌面+移动）
- `output/playwright/upc-local-*.png`（闭环截图；其中 `*-detail.png` 为旧入场动画帧，
  不作为最终视觉证据）

稳定详情截图等待 `#teacher-detail-content` opacity 接近 1、transform/位置连续 13 帧稳定、
背景遮罩稳定并完成 `document.fonts.ready`；实际 panel bounds、按钮边界和视口包含关系见
`ui-visual-smoke.json`。这些测试产物已被 `temp/`、`output/playwright/` 忽略，不进入版本控制。

## 复现命令

```powershell
npm run check:supabase
npm run check:supabase:remote -- --strict
npm run test:supabase:local
npm run data:all-colleges
npm run test:parser
npm run verify:local
```

页面验收可用现有本机前端；测试账号从 `.env.test.local` 读取，不在命令或文档中
展开。Mailpit 页面用于人工查看验证/重置邮件。

## 与云端/生产的关系

- **本机真实 Supabase 验收：已通过**。
- **云端独立测试项目：尚未验收**。需要云端项目 URL、anon key、service_role key
  和 SQL 执行权限；本机键不能当作云端验收。
- **生产上线：尚未执行**，没有生产写入、部署、备份恢复或回滚演练。

本机 native 栈只用于开发与验收；没有公网暴露、TLS、外部 SMTP 或生产备份承诺。
