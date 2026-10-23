# 小石子公开业务目录封版

本目录是 **本机验收封版** 的可重建、脱敏业务目录，不是云端或生产环境证明。

## 内容

| 文件 | 内容 |
| --- | --- |
| `colleges.json` | 17 个教学单位（16 个学院/教学部 + 石油工业训练中心） |
| `terms.json` | 已导入学期字典 |
| `teachers.json` | 1555 个公开教师身份：姓名、公开职称/单位、公开身份来源 ID、标签；不包含评分或个人联系方式 |
| `courses.json` | 1342 门课程 |
| `course-offerings.json` | 2946 条教师—课程—学期关系 |
| `import-batches.json` | 44 个导入批次的公开数据集名、校验和、时间与计数；不包含 `imported_by` |
| `manifest.json` | 计数、文件 SHA-256、来源与排除范围 |

教师身份包括 1382 个公开官方 profile 身份和 173 个 `tt-` 课表来源身份；不代表全校完整教师库。
所有批次 `is_current=false`，因为尚未取得正式校历确认。

## 脱敏与排除

以下内容**不进入**发布目录，也不进入 GitHub：

- `auth.users`、登录会话、密码、管理员账号、`service_role` key
- `user_profiles`、积分余额与流水、评价正文、评价状态、点赞
- `imported_by` 用户 UID
- 数据库 dump、浏览器 storage state、`.env.local`、`.env.import.local`、测试账号凭据
- 机器绝对路径、私有运行日志、截图和 `node_modules`
- 个人电话、邮箱、微信等非必要联系方式；本案发布数据中未发现需保留的联系方式字段

公开教师姓名、公开职称、学院归属、官方/profile 来源 ID 和课程关系属于重建业务目录所必需，保留。
公开抓取证据仅保留公开 URL、来源 ID、比较结论和哈希；不携带原始联系方式。

## 重建

数据库结构和种子：

```powershell
npm run schema:build
```

导入公开业务目录（按批次顺序）：

```powershell
npm run data:import -- data/upc/chemistry-2026-2027-1/import.json
npm run data:import -- data/upc/timetables-2026-2027-1/units/*/import.json
```

完整来源、原始课表哈希、解析/映射/缺口见：

- `data/upc/README.md`
- `data/upc/timetables-2026-2027-1/source-manifest.json`
- `data/upc/timetables-2026-2027-1/manifest.json`
- `scripts/upc-timetable/README.md`
- `docs/upc-data-import.md`

原始 `课表/` XLS 二进制仅保留在当前本机，不随仓库发布；其哈希在
`source-manifest.json` 中，发布目录可用上述解析后的 import JSON 重建。

## 边界

- 仅本机 native Supabase 验收；云端、外部 SMTP、生产域名、TLS、发布与回滚演练均未验收。
- 公开目录数据不等于全校完整教师库，也不包含用户评价或积分数据。
- 原始数据库 dump 不作为发布数据；本目录不是整库快照。
