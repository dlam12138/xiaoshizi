# UPC 本地部署

- 仓库：`https://github.com/dlam12138/UPC`
- 安装目录：`<repo>`
- 前端：<http://localhost:3000>
- Supabase API：<http://127.0.0.1:54321>
- Studio：<http://127.0.0.1:54323>
- Mailpit：<http://127.0.0.1:54324>

## 启动前端

推荐开发模式：

```powershell
npm run dev
```

或构建后双击 `start-upc.cmd`（使用 `npm run preview`）。如果 3000 端口已被前端
占用，无需重复启动。更新代码后执行 `npm ci`、`npm run build`，再重启 preview。

## 本机 Supabase

本机使用 WSL Ubuntu-24.04 内的官方 Supabase CLI native runtime，不需要 Docker，
持久数据在 WSL `~/.supabase/stacks/`。当前数据库**已经初始化并导入真实批次**，
不要再次执行 `supabase:init`，不要 reset。

```powershell
# 查看本机栈是否健康
npm run supabase:status

# 已停止时启动现有持久栈（不会重置数据）
npm run supabase:start

# 检查前端/导入 env 是否指向同一个本机项目
npm run check:supabase

# 停止服务但保留数据
npm run supabase:stop
```

本机配置由启动包装器生成到已忽略的 `.env.local`、`.env.import.local`：

- 前端：`VITE_SUPABASE_URL`、公开 anon/publishable key、`VITE_CACHE_API_ENABLED=false`
- 导入：同一项目的 `SUPABASE_URL`、仅服务端 `SUPABASE_SERVICE_ROLE_KEY`

真实密钥、测试账号密码和 session token 不得出现在终端输出、文档、截图或 Git。
测试账号只在 `.env.test.local`。

## 数据与验收

本机已导入 1,555 个教师身份、1,342 门课程、2,946 条开课关系：官方 profile 核实
1,382 + `tt-` 课表学院身份 173；化学基线 136/129/271 不变，另有扩展 7 教师/
12 个已有课程关联/13 关系。153 个无个人 profile/集体页条目已按课表身份保留，
当前教师身份未解决 0 条；3 条课程关系已按研究方向暂定（inferred/可纠正）。
全局 133 组同名不同编码，学期 `2026-2027-1` 且所有批次 `isCurrent=false`，
教师 campus 全为 null。外国语官方 89 + 课表 11，训练中心官方 8 + 课表 5。

```powershell
npm run check:supabase:remote -- --strict
npm run test:supabase:local
```

本机 Auth 使用 GoTrue + Mailpit；Mailpit 验证不代表外部 SMTP 投递验收。完整证据、
截图和与云端/生产的区别见 `docs/upc-local-supabase.md`。

## 云端测试项目

云端独立测试项目仍需单独提供 URL、anon key、service_role key 和 SQL 执行权限；
本机 key 不能当作云端验收。步骤见 `docs/upc-target-integration.md`。可选的 Redis
缓存 API 一期默认未启用，前端直接连接 Supabase。本部署未设置开机自启、公网服务
或生产备份。
