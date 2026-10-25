<div align="center">

<img src="public/favicon.svg" alt="小石子" width="80" height="80" />

# 小石子

**让每一份课堂体验，都成为后来者的参考。**

面向中国石油大学（华东）的课堂反馈平台 · 独立社区项目，非学校官方服务

[![Verify UPC](https://github.com/dlam12138/xiaoshizi/actions/workflows/verify.yml/badge.svg)](https://github.com/dlam12138/xiaoshizi/actions/workflows/verify.yml)
![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ecf8e?logo=supabase&logoColor=white)

[功能介绍](#功能介绍) · [快速开始](#快速开始) · [数据与来源](#数据与来源) · [部署与维护](#部署与维护) · [参与贡献](#参与贡献)

</div>

---

> **项目状态：准备开源，欢迎接力。**
> 受个人时间和运行资源限制，作者目前无法承诺持续托管在线服务或持续维护。
> 仓库保留应用代码、数据库结构、公开业务目录与验收记录，供自行部署、学习和继续开发。
> 本机与部分云端流程已有验收记录，完整生产部署尚未验收；不提供长期在线演示承诺。

公开前的隐私复核结果见[代码与历史审计](docs/upc-publication-audit.md)：当前运营信息已脱敏，Git 历史中的邮箱等信息仍待处理。

## 为什么做小石子

选课前，我们常常想知道一门课的作业量、课堂要求，以及老师的授课风格。
小石子希望把分散的课堂体验整理成有结构、可参考的反馈：通过教师与课程检索，
找到对应的课堂，再查看或提交经过审核的六维评价。

## 功能介绍

| 模块 | 已实现的能力 |
| --- | --- |
| 教师与课程 | 按学院检索教师、查看教师详情与开课关系 |
| 六维课堂反馈 | 考勤宽松度、给分宽松度、努力回报、作业轻松度、师生亲和力、教学质量 |
| 评价生命周期 | 提交、审核、驳回、修改、重新提交、作者撤回/删除 |
| 社区互动 | 评价点赞、每日签到与积分记录 |
| 账号与权限 | 学生邮箱准入、邮箱验证、数据库行级安全策略（RLS） |
| 管理与治理 | 受控管理员邀请、TOTP/AAL2、资料纠错和治理队列 |
| 访问保护 | 可选 Cloudflare Turnstile、预发布注册开关 |

公开展示设有至少 5 位评价者的门槛。公开投影限制身份字段，匿名展示不代表系统不保存账号关联。
课表推荐、教务通知、经验攻略入口当前关闭，AI 问答与模型服务已移除。

## 技术栈

- **前端**：React 19、TypeScript、Vite、Tailwind CSS 4、Motion、Lucide。
- **后端**：Supabase Auth、PostgreSQL、RLS、数据库函数（RPC）。
- **可选服务**：`server/` 提供 Express + Redis 缓存 API，默认关闭。
- **数据工具**：Node.js 导入/校验脚本，Python 课表解析器。

默认架构为浏览器直连 Supabase，无需常驻 Node.js 应用服务器。数据库、认证和邮件服务仍需要运行资源。

## 快速开始

需要 **Node.js 22+**、npm，以及一个由你控制的 Supabase 项目。以下命令适用于新克隆仓库，
不会自动连接作者的数据库，也不会自动导入教师数据。

### 1. 获取代码

```bash
git clone https://github.com/dlam12138/xiaoshizi.git
cd xiaoshizi
npm ci
```

### 2. 初始化自己的数据库

在**新建、空的 Supabase 项目**的 SQL Editor 中，依次整份执行：

1. [`supabase/upc-init.sql`](supabase/upc-init.sql)：应用表、17 个教学单位种子、权限策略、治理函数和导入函数。
2. [`supabase/cloud/grants.sql`](supabase/cloud/grants.sql)：托管 Supabase 的应用角色授权。

已有业务数据的库应使用升级流程，避免重复执行初始化。仅创建表还不足以开放注册：
还需配置 Auth 的邮箱确认、回调 URL、`before_user_created_hook`、邮件投递和管理员 MFA。
具体步骤见[托管迁移操作单](docs/upc-cloud-migration-runbook.md)。
该文档包含原作者的迁移记录，项目地址、账号和域名均需替换为自己的配置。

### 3. 配置前端并启动

复制 [`.env.example`](.env.example) 为 `.env.local`（PowerShell 用 `Copy-Item .env.example .env.local`），填写：

```dotenv
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-public-key"
VITE_CACHE_API_ENABLED="false"
```

```bash
npm run dev
```

打开 <http://localhost:3000>。缺少配置时页面会提示配置缺口，不会回退到其他项目或展示模拟教师。
`VITE_*` 会进入浏览器构建，只能填写公开客户端配置；`service_role`、数据库密码和邮件密钥只放服务端。

<details>
<summary><strong>可选：导入仓库中的教师与课程数据</strong></summary>

复制 [`.env.import.example`](.env.import.example) 为 `.env.import.local`，
填写自己的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，然后先校验、再试运行、最后导入：

```bash
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --validate-only
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --dry-run
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json
```

以上仅导入化学基线批次。多学院及身份补充批次的顺序、来源、稳定键和冲突处理见
[数据导入说明](docs/upc-data-import.md)。导入脚本一次接收一个 JSON 文件，不会自动展开通配符。
[`data/upc/release/`](data/upc/release/) 是公开目录快照，不能直接作为导入脚本的输入。
配置好前端和导入两份环境变量后，可运行 `npm run check:supabase` 检查项目与密钥配置是否一致。

</details>

<details>
<summary><strong>可选：使用本地 Supabase</strong></summary>

仓库保留了原作者使用的 WSL/native 测试栈脚本，详见[本机环境记录](docs/upc-local-supabase.md)。
它依赖特定的 CLI 安装路径与运行环境，不是跨平台的一键安装器。
文档中“本机已初始化”的描述只针对原作者环境，新克隆仓库不带已有数据库、账号或环境变量。

课表解析还需要 Python 及 `scripts/upc-timetable/requirements.txt` 中的依赖。
原始 XLS/ZIP 不随仓库发布；使用已有的解析后 JSON 导入不需要重新解析原件。

</details>

## 数据与来源

仓库包含学期 `2026-2027-1` 的公开业务目录快照：

| 教学单位 | 教师身份 | 课程 | 开课关系 |
| :---: | :---: | :---: | :---: |
| **17** | **1,555** | **1,342** | **2,946** |

其中 1,382 个身份经公开官方 profile 核实，173 个为 `tt-` 前缀的课表来源身份。
这些数字不代表全校完整师资，也不能全部称为官方已核实教师；课表来源单位不等同于人事归属。
学期未标记为当前学期，数据也不会自动更新。

公开目录不包含用户账号、评价、积分、点赞、管理员凭据或数据库备份。
文件校验和与排除范围见[目录发布说明](data/upc/release/README.md)及[清单](data/upc/release/manifest.json)。
学校与学院信息的来源链接保留在[学院字典](data/upc/colleges.json)，课表与身份核对过程见[数据报告](data/upc/timetables-2026-2027-1/report.md)。

公开来源数据和学校相关标识不因代码公开而自动获得额外授权。复用时请保留来源、核对时效，
并单独确认数据和标识的使用权限。资料有误可通过 Issue 提供公开来源链接，请勿提交私人联系方式或学生身份信息。

## 部署与维护

```bash
npm run build
npm run preview
```

`dist/` 是静态构建产物，可部署到支持单页应用路由回退的静态托管或 Nginx。
`npm run preview` 用于本地检查构建结果。生产运行还需自行管理 Supabase、邮件投递、备份、
审核与纠错；即使前端使用静态托管，持续运营也需要有人维护。

仓库提供了 [Docker 配置](docker-compose.yml)和[云端部署准备文档](deploy/cloud/README.md)。
Docker 配置只构建和托管前端，不会一起启动 Supabase；部署文档中的原有服务器、域名和路径不是公共服务承诺。
外部 SMTP、完整云端端到端测试、生产域名/TLS 及发布回滚演练仍需由部署者自行完成验收。

## 开发与验证

```bash
npm --prefix server ci
npm run verify:local
```

该命令生成 SQL 并执行类型检查、根测试、前端构建及可选 API 的测试。
Python 解析器测试单独运行 `npm run test:parser`。
真实 Auth/RLS、邮件投递与部署环境的验收需要连接自己的 Supabase，不包含在上述离线检查中。

## 项目导航

| 路径 | 内容 |
| --- | --- |
| [`src/`](src/) | 前端页面、组件、配置与 Supabase 服务层 |
| [`supabase/`](supabase/) | 数据库结构、RLS、RPC、种子与升级脚本 |
| [`data/upc/`](data/upc/) | 学院字典、解析后的导入批次与来源报告 |
| [`scripts/`](scripts/) | 数据导入、SQL 生成、环境检查与验证工具 |
| [`server/`](server/) | 默认关闭的缓存 API |
| [`docs/`](docs/) | 安全治理、数据、部署与验收文档 |
| [`docs/project-history.md`](docs/project-history.md) | 原 README 的阶段记录与详细验收索引 |

## 参与贡献

欢迎通过 [Issues](https://github.com/dlam12138/xiaoshizi/issues) 报告问题、讨论接手维护或提出改进，
也欢迎提交 Pull Request。建议先说明具体场景、复现步骤和预期行为；涉及数据库变更时，请一并提供迁移与验证说明。

优先欢迎部署文档完善、跨平台启动支持、无障碍体验和公开数据纠错。
作者无法承诺固定响应时间；如果你愿意继续运营，可以 Fork 后独立维护，并清楚标明自己的服务与数据责任。

## 许可

代码许可证待作者确认。当前仓库公开准备不代表已授予开源许可；公开来源数据与第三方资源的使用权限需单独确认。
