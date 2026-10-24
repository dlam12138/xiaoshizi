# UPC 一期验收记录

更新：2026-10-24。严格区分三层状态：

- **本机真实 Supabase 旧功能基线**：WSL native Supabase 上的真实数据、会话、RLS、页面闭环；
  **已通过**。该库已于 2026-10-24 应用五份安全补丁，数据计数保持不变；旧管理员已停用，账户/角色/MFA 保留但不再有管理员权限。
- **隔离新策略验收**：独立 native Supabase 栈完成 79 项管理员/邮箱变更/注销/失败恢复/纠错写回、
  26 项 SEC-G0 补充和 23 项 MFA 恢复演练；真实连接并发 12 项、桌面/移动浏览器 17 项；
  **已通过**。不是现有库、云端或生产。
- **WSL 目标库升级验收**：`0499...`（54321/54322）已执行五补丁并通过 post-check；
  专用账号会话失效验收 10/10；新 Gmail 管理员已建 Auth 账户，已激活并绑定 1 个 verified TOTP。
- **云端托管项目**：`your-project-ref`（ap-southeast-2，Postgres 17.11）已完成
  schema/正式业务数据迁移、Auth Hook/TOTP/URL 配置和云端管理员激活；会话/角色/
  评价/浏览器/核心生命周期/纠错专项检查通过。**外部 SMTP、完整 79 项 E2E、正式域名/TLS、
  服务器部署未执行**。
- **正式上线**：生产域名、TLS、备份、发布与回滚演练；**未执行**。

本机环境不是云端项目，Mailpit 不代表外部 SMTP 投递，也不代表生产上线。

新增 [上线前安全与治理工作包](upc-launch-security-plan.md)：Gmail-only 管理员策略、治理边界、
教师申诉移除、资料纠错闭环和管理员 MFA 受控恢复已在代码及隔离环境完成，见
[实施记录第 8–13 节](upc-security-delivery.md#8-2026-10-24-管理员策略纠正与治理边界收尾)
与 [SEC-G0 矩阵](upc-sec-g0-acceptance.md)。
WSL 目标库已升级；P1-02 运营信息已冻结，云端项目、外部 SMTP、生产发布仍未完成；
原功能基线不自动涵盖这些新增验收。

## 本机验收证据

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| 本机栈健康 | `npm run supabase:status` | native；API 54321、Studio 54323、Mailpit 54324 |
| 配置一致性 | `npm run check:supabase` | 通过；同一本机项目、缓存关闭、service_role 未进入前端 |
| 真实数据只读核对 | `npm run check:supabase:remote -- --strict` | 通过：全局 1,555 教师身份、1,342 课程、2,946 关系、133 组同名不同编码；其中官方 profile 1,382 + `tt-` 课表身份 173（含化学扩展 7）；化学基线子集 136/129/271/16，化学扩展独立 7/12/13；`is_current=false`；campus 全空 |
| API/Auth/RLS（旧策略，本轮未重跑） | 旧 `npm run test:supabase:local` | 14 项旧 Auth + 30 项旧 DB/并发；**含已废止员工邀请，不能作为 Gmail 新策略证据** |
| 页面 Auth | 本机 runner | 可空校区注册、未确认邮件拒绝、Mailpit 验证、recovery 改密、旧密码拒绝、session 退出、URL token 清理；`ui-auth-report.json` |
| 页面评价闭环 | 本机 runner | 桌面 1440×1000、移动 390×844；搜索丁雪→详情→真实课程/学期→六维评价→管理员审核→+20→匿名公开→他人点赞/取消→管理员删除→评分清空；`ui-review-report.json` |
| 当前界面 smoke | `temp/upc-browser/visual-smoke.mjs` | 等待 Framer Motion 面板 opacity=1、transform 连续 13 帧稳定；真实 panel/关闭/底部按钮均在视口内；`ui-visual-smoke.json` |
| 截图完整性 | 5 张闭环截图 + 2 张稳定详情图 | 旧 `upc-local-*-detail.png` 是入场动画帧，不作为最终视觉证据；稳定详情见 `temp/supabase-local/current-*-detail.png` |
| 根测试/构建 | `npm run verify:local` | 通过（schema → lint → 48 根测试 → build → 18 服务测试） |
| 解析/身份测试 | `npm run test:parser` | 12/12 通过（含课程编码、跨院证据、中心单位和批次一致性） |
| 化学导入 JSON | `npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --validate-only` | 136 教师 / 271 教师-课程行 |
| 多单位导入 JSON | 16 个 `timetables-2026-2027-1/units/*/import.json`（15 学院 + 训练中心） | 全部 validate-only、dry-run、正式导入、重复导入通过；新增 1,234/1,150/2,363 |
| 同院同名官方增量 | `timetables-2026-2027-1/same-name-official-identities/import.json` | 12 个官方身份、18 条课程关联（6 门实际新课程；3 条 inferred）；5 组别名合并且 5 组真名拆分为 7 个身份（李莉 2 个、王艳 2 个；3 条 inferred）；重复导入 0/0/0 |
| 课表学院身份增量 | `timetables-2026-2027-1/timetable-identities/import.json` | 173 个 `tt-` 课表身份（本轮新增 153）；本轮 52 门新课程/267 关系；累计 57 门/294 关系；重复导入 0/0/0 |
| 新增学院页面 smoke | `temp/upc-browser/new-college-smoke.mjs` | 孙永鹏（石工）、王文东（地科教师/石工课程）桌面+移动详情通过；周鹏 2 个同名、李静 4 个同名结果；无运行时错误；`new-college-ui-smoke.json` |
| 外国语页面 smoke | `temp/upc-browser/foreign-language-smoke.mjs` | 程璐璐桌面/移动详情：搜索 1 个结果、外国语学院、课程“孤独症儿童语言干预策略”；面板/字体/动画稳定后截图 `current-foreign-desktop-detail.png` / `current-foreign-mobile-detail.png`，无横向溢出、无运行时错误；`foreign-language-ui-smoke.json` |
| 同名课表身份 smoke | `temp/upc-browser/timetable-identity-smoke.mjs` | 王静桌面/移动搜索 2 个结果；打开 `tt-upc-02-001` 显示“课表来源身份/课表单位：石油工程学院/心理健康与职业发展”，未冒充官方 profile，无横向溢出/运行时错误；`current-timetable-*-detail.png`、`timetable-identity-ui-smoke.json` |
| 无资料/真同名 smoke | `temp/upc-browser/same-name-153-smoke.mjs` | 桌面/移动：刘相无个人资料仍显示课表身份/化学工程学院/化学工程基础，无“职称待核实”；课程搜索打开王艳，数学分析/常微分方程随真实课程区分；4 张截图、无运行时错误；`same-name-153-ui-smoke.json` |
| 现有数据保护 | 导入前备份 + 隔离库规范化内容哈希 | 原 136 教师、129 化学课程、271 化学关系、profiles/积分 ledger/reviews/likes/admin/auth 和原 16 学院行均 `equal=true`；仅输出布尔/计数；`existing-data-protection.json` |
| 品牌统一 | `src/config/upc.ts` + 页面回归 | 小石子；首页、导航、登录、个人中心、管理台、标题/描述无“石大评教/教师评价”；`feedback-10-23-ui-report.json` |
| 4.0–5.0 评分输入 | 前端/服务/DB 测试 + 本机直连 SQL | 六项空输入、逐项错误、4/5 失焦格式化、4.0/4.1/4.9/5.0 接受；空值/3.9/5.1/4.15 拒绝；DB 列 NUMERIC 无 typmod，4.15 不被静默舍入；旧 1–5 可读；当前根测试 53/53、服务 18/18 |
| 无文字提交闭环 | `temp/upc-browser/feedback-10-23-qa.mjs` | 无 textarea；空文字提交→管理员审核→六维聚合→+20 积分仅一次；删除临时评价后评分清空；`feedback-10-23-ui-report.json` |
| 取消评分排序 | `server/data.mjs` + 桌面/移动搜索 | UI 无排序控件；查询层按 name + id；首页/缓存/部署核对不按评分；两页 20+20 无重复，重复请求稳定；`feedback-10-23-layout-report.json` |
| 评分/雷达截图 | 1440×1000、390×844 | 首页、搜索、评分弹窗、雷达（空/有数据）共 10 张，字体/动画稳定，无横向溢出；`output/playwright/feedback-10-23-*.png` |
| 评分数据库升级 | `supabase/upgrades/20261023-four-point-rating.sql` | 已在备份后本机应用；不重建/不清空历史；4.15 直连拒绝、4.1 成功、1.0 历史成功；`existing-data-protection.json` |
| 首页文案精简 | 桌面/移动首页回归 | 删除数据来源 docs 路径句、主标题下副标题和导航品牌下重复小字；无空占位；`release-home-desktop.png` / `release-home-mobile.png` |
| 公开目录发布包 | `data/upc/release/` | 17 学院/1 学期/1555 教师/1342 课程/2946 关系/44 批次；文件 SHA-256；不含 auth/user/review/points/imported_by/dump/联系方式，`upc-release.test.mjs` 通过 |
| 空白检查 | `git diff --check` | 通过 |
| SEC 隔离 E2E（Gmail 新策略） | `temp/isolated-supabase/e2e.mjs` | 79/79；Gmail 邀请/拒绝、AAL1/普通管理员隔离、邮箱变更确认落地、纠错写回、重导入保护、合成注销全链路、失败恢复；`e2e-report.md` |
| SEC-G0 补充回归 | `temp/isolated-supabase/sec-g0.mjs` | 26/26；目录筛选/分页/空态/请求失败、评价改审/驳回/重提、举报、moderator、退出/找回、移动目录；`sec-g0-report.md` |
| MFA 丢失恢复演练 | `temp/isolated-supabase/mfa-recovery-drill.mjs` | 23/23；service-role-only、撤会话、审计、重绑 AAL2、拒绝越权；`mfa-recovery-report.json` |
| 旧库升级预检 | `supabase/upgrades/20261024-preflight.sql` | 旧克隆/升级前目标库：旧申诉 RPC 存在、纠错 RPC/表不存在、重复组 0、6/1555/1342/2946/1/0；只读 |
| 现有库升级操作单 | `docs/upc-existing-db-upgrade-runbook.md` | **WSL 目标库已执行**；备份/恢复核对、post-check、计数不变 |
| WSL 目标库会话验收 | `temp/isolated-supabase/target-session-drill.mjs` | **10/10**；专用账号撤会话后旧 AAL2 token 拒绝，重新登录+MFA 恢复；`wsl-target-session-report.json` |
| SEC 页面桌面/移动 | `temp/upc-browser/security-ui-qa.mjs` | 8/8；上一轮；本轮未改 UI |
| 管理员 AAL2 页面门 | `temp/upc-browser/admin-mfa-ui.mjs` | 3/3；上一轮；管理员策略以隔离 E2E 为准 |
| SEC 旧策略证据 | `supabase/upgrades/20261024-security-governance.sql` | 备份哈希 `508f88...310c`；旧迁移/重跑成功；WSL 已应用新版五补丁 |

详情截图 QA 使用 Playwright 连续帧稳定性、真实 panel bounds、OCR 和图像非空/尺寸统计完成。
旧 `output/playwright/upc-local-desktop-detail.png`、`upc-local-mobile-detail.png` 拍在
Framer Motion 入场动画期间，面板半透明，**不是最终视觉证据**；最终证据是
`temp/supabase-local/current-desktop-detail.png` 与 `current-mobile-detail.png`，
指标见 `ui-visual-smoke.json`。没有把未看到的细节声称为人工目视通过。

## 本机多学院数据批次

| 指标 | 全局 | 化学基线 | 新增 |
| --- | ---: | ---: | ---: |
| 教师身份 | 1,555 | 136 | 1,419 |
| 其中官方 profile 核实 | 1,382 | 136 | 1,245 |
| 其中 `tt-` 课表学院身份 | 173 | 0（基线）+ 7（扩展） | 173 |
| 课程 | 1,342 | 129 | 1,213 |
| 教师×课程×学期关系 | 2,946 | 271（基线）+ 13（扩展） | 2,675 |
| 同名不同编码组 | 133 | 16 | 117 |

化学扩展单独计数：**7 教师 / 12 个已有课程关联 / 0 新课程 / 13 关系**；原化学批次
**136 教师 / 129 课程 / 271 关系**和全部 `cce-` sourceId 不变。严格检查分开验证
“化学基线 136/129/271”和“化学扩展 7/12/13”。

16 个来源单位原始课表均已只读盘点：15 个新增学院批次（含外国语）和独立教学单位
石油工业训练中心（`upc-17`）已导入。中心有 81 块、13 名候选；8 名有官方中心页面/
课程团队证据，导入官方 8 + 课表 5，共 13 教师/6 课程/25 关系；无个人 URL 的 5 名已保留。

外国语有 665 块、100 个候选；89 名可从官方教师队伍/系部 profile 页核实，
导入官方 89 + 课表 11，共 100 教师/88 课程/207 关系；9 名只有教师队伍页、
2 名未出现在官方教师队伍页的候选已按课表身份保留。665 块中 31 块未生成关系（7 个班级名单/
无课程身份，24 个课程块无可用教师姓名）；其 `OTH921331020` 冲突课程不导入。

修正前后：上一轮 1,281 教师 / 1,193 课程 / 2,441 关系 + 外国语 89/86/193
→ 1,370 教师 / 1,279 课程 / 2,634 关系；此前同名课表身份 +20/5/27 → 1,390/1,284/2,661；
本轮同院同名官方 +12/6/18、课表身份 +153/52/267 → 1,555 教师身份 / 1,342 课程 /
2,946 关系；中心官方 8 + 课表 5，化学基线仍为 136/129/271。

统计口径：1,553 个来源单位候选条目、1,510 个唯一候选姓名、1,382 个官方 profile
核实 sourceId 人数、1,355 个官方核实唯一姓名、173 个课表学院身份、1,555 个总教师
身份、0 个未解决教师身份；姓名并集 1,510。**这些不是同一口径，不能相加算覆盖率**。
仍有 3 条课程关系已按研究方向暂定（inferred）、6 条文法 `OTH921331020` 冲突关系按规则排除。

同院同名专项：5 组页面的邮箱/电话/履历/专利一致，7 个页面合并为 5 个官方身份
（宋允全的 1 个旧 URL 为 HTTP 410 退休链接，不算人）；另 5 组是真同名，按官方
明确主讲课程/研究方向拆为 7 个官方身份（李莉 2 个、王艳 2 个）。3 条按研究方向
暂定的课程关系记录在 `inferred-course-assignments.json`，没有按学院+姓名合并。
跨院审计当前 21 个来源条目全部转为课表身份；历史 31 条中 13 个曾导入，精确移除
20 条关系/3 门孤立课程/2 名无接受单位的教师；未覆盖旧评价/积分。
`OTH921331020 沟通与写作` 冲突涉及 8 个课程变体；新增实际排除 7 门/23 条关系，
化学既有 1 门/1 条关系保留。逐条证据见
`data/upc/timetables-2026-2027-1/cross-unit-audit.json` 和
`timetables-2026-2027-1/timetable-identities/import.json`。

真实原始文件只读；化学批次 sourceId 和既有记录保持不变。新增批次逐批执行
validate-only → dry-run → 正式导入 → 重复导入；重复导入业务行新增 0。导入前备份
`upc-pre-multicollege-2026-10-23T04-11-04-725Z.dump`（哈希 `9cf469...f4a34`），
定向修正前备份 `upc-before-cross-unit-correction-2026-10-23T05-07-35Z.dump`
（哈希 `f481db...8e94a6`），外国语导入前备份
`upc-before-foreign-2026-10-23T06-03-12Z.dump`（哈希 `3dd303...1075c`），
课表身份导入前备份 `upc-before-timetable-identities-2026-10-23T06-50-16Z.dump`
（哈希 `638ac9...4cea9`）；化学扩展前备份
`upc-before-chemistry-extension-2026-10-23T07-34-08Z.dump`（哈希 `8785cc...4edf7`）；
同院同名/153 扩展前备份
`upc-before-same-name-153-2026-10-23T08-38-41Z.dump`（哈希 `2777cc...e5c81`）；最终备份
`upc-post-same-name-153-2026-10-23T08-40-18Z.dump`（哈希 `dc5aa1...7e4f34`）；
研究方向暂定前备份 `upc-before-inferred-3-2026-10-23T09-32-28Z.dump`
（哈希 `752597...101fa8`）；最终备份 `upc-post-inferred-3-2026-10-23T09-33-16Z.dump`
（哈希 `918101...aa4d9b`）；评分规则升级前备份
`upc-before-rating-4-5-2026-10-23T11-36-02Z.dump`（哈希 `b66ed5...d2fbba`）；
升级后备份 `upc-post-rating-4-5-2026-10-23T11-59-40Z.dump`（哈希 `679268...7b14`）。

## 化学批次（保留基线）

| 指标 | 数值 |
| --- | ---: |
| 原始导出课程块 | 715 |
| ZIP 内导出课程块 | 715 |
| 去重课程块 | 627 |
| 唯一课程 | 129 |
| 同名不同编码组 | 16 |
| 教师候选 | 143 |
| 官方详情页核实教师 | 136 |
| 待映射教师 | 7 |
| 唯一教师×课程×学期关系 | 284 |
| 已导入关系 | 271 |
| 未导入（教师未核实） | 13 |
| 学期 | `2026-2027-1`，`is_current=false` |
| 教师 campus | 136 人全部 null |

真实 `import.json` 已在本机执行 validate-only、dry-run、正式导入和重复导入：

- dry-run 不留下业务数据或导入批次；
- 正式导入后 136 教师 / 129 课程 / 271 关系；
- 重复导入业务记录全部 skipped，只新增导入批次；
- 16 组同名不同编码保持独立；
- `import_batches` 现有 44 条：化学 2 条，15 个新增学院批次各首次+幂等复跑 2 条，
  训练中心首次+幂等复跑 2 条，课表身份增量 4 条（18 个身份、化学扩展、153 个身份），
  同院同名官方增量 2 条（首次/复跑）；dry-run 不产生批次。

## 本机 RLS/Auth 覆盖

`temp/supabase-local/acceptance.json` 的 8 组通过项：

1. 三个已确认账号使用公开 key 和真实用户 session 登录；
2. 匿名访问私有表、用户自提管理员、修改积分、跨用户资料均被拒绝；
3. pending 评价仅作者可见；另一用户不能编辑/审核；无匹配开课关系被拒绝；
4. 管理员通过后进入安全公开视图，作者恰好 +20，重复审核不重复发奖；
5. 另一用户点赞、重复点赞、取消点赞，计数稳定且不改作者积分；
6. 驳回后作者修改、重提、再审核通过；
7. 删除最后一条 approved 后教师六维与总分清空；
8. 签到 RPC 幂等。

页面 Auth 还验证了：注册时校区可空、未确认邮箱不能登录、Mailpit 注册确认链接、
recovery 邮件设置新密码、旧密码失败、新密码成功、退出恢复 session、URL token 清理。
页面评价在桌面和移动两个视口均完成。

## 云端托管项目（数据库已迁移，部署未执行）

2026-10-24 已对新建项目 `your-project-ref`（ap-southeast-2，Postgres 17.11）执行：

1. 只读确认 public/auth 为空；
2. 应用 `supabase/cloud/upc-cloud-schema.sql`，不执行含 seed 的 `upc-init.sql`；
3. 加载正式业务数据：17 学院 / 1 学期 / 1,555 教师 / 1,342 课程 / 2,946 关系；
   不加载测试评价、测试账号、积分、治理申请、旧管理员；
4. 配置 Before User Created Hook、TOTP、Site URL/redirect；
5. 创建 `operator@example.com` 云端 `super_admin`；已完成密码、1 个 verified TOTP；
   未迁移 `example.test`；
6. 修复 hosted 表权限缺失（`cloud/grants.sql`）；
7. 云端 Hook 1、会话 10/10、角色 6/6、评价提交 4/4、浏览器 5/5、核心生命周期
   25/25、纠错 4/4；
8. 清理合成账号/评价/welcome 数据；当前 Auth 1、管理员 1、评价 0、积分 0；
   不可篡改审计保留 16 条测试日志。

未完成：外部 SMTP/真实邮件、正式域名/TLS、云端完整 79 项 E2E、
服务器 Nginx/静态发布、云端备份/恢复/回滚演练。详见
`docs/upc-cloud-migration-runbook.md` 第 9 节和
[`upc-cloud-e2e-coverage.md`](upc-cloud-e2e-coverage.md)。

## 逐项状态

| 任务 | 本机真实 Supabase | 云端/生产 | 说明 |
| --- | --- | --- | --- |
| P0 基线/隔离 | 完成 | — | 旧默认连接、缓存、任务已切断 |
| P0-2 数据资产 | 16 来源单位完成 | 云端待扩展 | 逐单位原始课表/哈希/块数已记录；含外国语 665 块 |
| P1 品牌/去 AI | 完成 | — | AI/通知/攻略入口和依赖已移除 |
| P2-1 初始化 | 本机通过 | 云端已完成 | 使用 cloud bundle，不执行含 seed 的 upc-init；public 迁移前为空 |
| P2-2 学院字典 | 完成 | 云端已完成 | 16 个教学院部 + 独立教学单位 `upc-17` |
| P2-3 教师主数据 | 本机通过 | 云端已完成 | 1,382 官方 profile + 173 `tt-` 课表身份；教师身份未解决 0；3 条课程关系为 inferred/可纠正 |
| P2-4 课程/开课 | 本机通过 | 云端已完成 | 1,342 课程、2,946 关系；新增 23 条冲突关系排除，保留化学 1 条 |
| P2-5 学期 | 本机通过 | 云端已完成 | `2026-2027-1`，`is_current=false` |
| P2-6 导入 | 本机通过 | 数据已直接迁移；导入 RPC 流程未跑 | 原子、幂等、dry-run、摘要已验证 |
| P2-7 冷启动 | 本机通过 | 云端 public smoke 5/5 | 真实本机数据，无 mock/默认分 |
| P2-8 鉴权/管理员 | 本机通过 | 云端管理员 MFA 1/verified；SMTP 未配 | Auth + Mailpit + 管理员审核已通过 |
| P2-9 真实闭环 | 本机通过 | 云端评价提交 4/4；审核闭环未跑 | API/RLS + 桌面/移动页面均通过 |
| P2-10 扩量 | 15 学院 + 训练中心 + 173 课表身份已导入 | 未开始全校 | 外国语官方 89 + 课表 11；训练中心 8 + 5 |
| P3 课表/通知 | 一期隐藏 | 未开始 | 旧代码/入口已移除 |
| P4-1 部署配置 | 本机可运行 | 云端前端包已生成；生产未部署 | Nginx/systemd/健康检查模板已备 |
| P4-2 构建/数据路径 | 本机通过 | 云端 DB/前端构建通过；生产未验 | 托管项目静态包已生成 |
| P4-3 端到端 | 本机页面通过 | 云端 26 项 + 核心 25 + 纠错 4；完整 79 未跑 | 桌面/移动真实页面证据 |
| P4-4 权限边界 | 本机 RLS 通过 | 云端角色 6/6、会话 10/10 | 完整角色矩阵未跑 |
| P4-5 发布回滚 | 未演练 | 未演练 | 无生产备份/回滚实测 |
| X-1 测试同步 | 完成 | — | 旧测试移除，新增本机真实 Supabase 验收 |
| X-2 文档同步 | 完成 | — | 本机/云端/生产分层记录 |
| X-3 数据记录 | 完成 | — | 来源/覆盖/缺口；无密钥入库 |
| X-4 可观察性 | 完成 | — | `/health`、导入摘要、错误定位 |
| X-5 进度记录 | 完成 | — | 本文件与迁移清单 |

## SEC-G0 与隔离新策略状态

- **SEC-G0 隔离通过**：79 E2E + 12 并发 + 17 浏览器 + 26 补充 + 23 MFA 恢复；
  逐项见 [`upc-sec-g0-acceptance.md`](upc-sec-g0-acceptance.md)。
- **WSL 目标库已升级**：五份补丁已执行，post-check 通过，计数不变；专用账号会话验收
  10/10。新 `operator@example.com` 已建 Auth 账户和 `super_admin`，已激活并绑定 1 个 verified TOTP。
- **云端数据库/Auth 已迁移**：hook、会话、角色、评价提交和浏览器专项通过；完整 79 E2E/真实邮件/部署未完成。
- **P1-02 运营信息冻结**：本轮不修改、不再追问；仍不是已发布政策。
- 教师评分申诉不在当前范围，不恢复入口、类型、代录 RPC 或外部渠道。

## 明确未完成

- 云端托管项目 `your-project-ref` 已迁移数据库/Auth；完整 79 项 E2E、服务器部署和云端回滚未执行，不能等同于生产。
- 外部 SMTP 投递、真实邮件域名和云端 Auth 回调未验收；Mailpit 只是本机邮件链路。
- 教师身份未解决 0；3 条课程关系已按研究方向暂定（inferred）、6 条文法 `OTH` 冲突关系排除；
  不能把当前 1,555 个教师身份都称为官方已核实
  人数，也不能称为全校教师库。
- 173 个课表学院身份已保留，不冒用官方个人 profile；其中 153 个为本轮无个人资料/
  集体页条目；5 组页面别名和 5 组真同名已单独处理，3 条课程关系为 inferred/可纠正。
- 外国语官方 89 + 课表 11；训练中心官方 8 + 课表 5，均不再缺教师身份。
- 生产部署、备份恢复和回滚演练未执行。
- 正式品牌/Logo/域名未定稿。
- 没有全校教师数、全校榜单或正式上线声明。

本机启停、入口、复现命令见 `docs/upc-local-supabase.md`；云端步骤见
`docs/upc-target-integration.md`。
