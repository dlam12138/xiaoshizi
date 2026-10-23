# UPC 一期部署与运维

状态：**部署配置已准备，未在目标环境执行**。当前没有 UPC Supabase 项目凭据、域名或服务器
访问权限；以下命令需在目标测试环境由有权限的人员执行并记录结果。

## 组件

- 前端：Vite 构建的静态 SPA，Nginx 托管 `dist/`。
- 数据：独立 UPC Supabase 项目（Auth + Postgres + PostgREST）。
- 可选：`server/` Node 缓存 API + Redis；一期默认不启用，前端直连 Supabase。
- 不使用旧校数据库、旧 Redis 前缀或旧通知抓取任务。

## 环境变量

前端 `.env.local`（构建时注入）：

```
VITE_SUPABASE_URL=https://<upc-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<upc-anon-key>
VITE_CACHE_API_ENABLED=false
VITE_API_BASE_URL=/api
```

服务端（仅启用缓存时）`server/.env`：

```
HOST=127.0.0.1
PORT=3001
SUPABASE_URL=https://<upc-project>.supabase.co
SUPABASE_ANON_KEY=<upc-anon-key>
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=upc-cache
REDIS_PASSWORD=<server-only-secret>
CACHE_PREFIX=upc:cache:v1:
CACHE_TTL_SECONDS=604800
CACHE_SYNC_SECONDS=3600
```

导入用的 service_role key 只放 `.env.import.local` 或一次性环境变量，绝不进入前端构建。

已初始化过的 UPC 库（旧 `(name, college_id)` 课程唯一键）先执行非破坏性升级：

```bash
psql "$DATABASE_URL" -f supabase/upgrades/20261022-course-code-identity.sql
```

新库直接使用最新的 `supabase/upc-init.sql`，其中已包含同名不同编码课程的部分唯一索引。
化学化工学院批次导入：

```bash
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --validate-only
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json --dry-run
npm run import:upc -- data/upc/chemistry-2026-2027-1/import.json
```

## 静态前端部署

```bash
npm ci
npm run schema:build
npm run lint
npm test
npm run build
```

将 `dist/` 上传到目标目录，例如 `/var/www/upc-eval/current`。Nginx：

```nginx
server {
    listen 443 ssl http2;
    server_name eval.example.edu.cn;

    root /var/www/upc-eval/current;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, no-transform";
    }

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;
}
```

`nginx.conf` 是仓库内的静态示例，域名和 TLS 需按目标环境替换。回调地址：

```
https://eval.example.edu.cn
```

在 Supabase Auth 的 Site URL / Redirect URLs 中加入同一地址；邮件模板和 SMTP 由目标项目配置。

## 可选缓存 API

```bash
cd server
npm ci
node --env-file=.env index.mjs
```

- `GET /health`：返回 `{ok, cache, lastSync, timetable:"disabled"}`。
- 公开读取：`/api/teachers`、`/api/teachers/:id`、`/api/teachers/:id/reviews`。
- 审核/点赞/编辑/删除：需要 Supabase Bearer token，服务端再次校验数据库授权。
- 不提供 `/api/notices` 和 `/api/timetable/recommendations`；一期页面也不显示入口。
- Redis 缺失或不可用时缓存降级为直连数据库；不会读取旧 `swjtu:` 键。
- Nginx 代理示例：`server/deploy/nginx-cache.conf`。
- systemd 模板：`server/deploy/upc-eval-api.service`。
- 首次配置可参考 `server/deploy/provision.py`，它要求显式提供 UPC 项目环境变量，并拒绝旧项目
  host 和旧缓存前缀。

## 发布前检查

```bash
# 目标测试环境
curl -fsS https://<test-host>/health
curl -fsS https://<test-host>/api/teachers | head
```

- 页面首屏无旧校品牌、无 AI/课表/通知/攻略入口。
- 未配置时显示配置缺口，不连接旧项目。
- 空库显示“教师数据尚未导入”，不是 4.5 分或示例教师。
- 登录、注册邮件、找回密码、回调地址在目标项目可用。
- 普通用户不能审核、改积分或读取他人评价/积分。
- 公开评价响应不含 `user_id`、`reviewer_id`、`reject_reason`、`reviewed_at`。

## 发布、备份与回滚

发布前必须：

1. 记录当前前端产物目录/提交号；
2. 备份目标 Supabase 数据库（项目备份或 `pg_dump`）；
3. 记录本次执行的 SQL 与导入批次（`import_batches`）；
4. 记录环境变量版本（不把密钥写入仓库）。

回滚分层：

| 层 | 操作 | 状态 |
| --- | --- | --- |
| 静态资源 | 将 `current` 指回上一版 `dist`，reload Nginx | 未在目标环境演练 |
| 缓存 API | 将 systemd `current` 指回上一 release，重启服务 | 未在目标环境演练 |
| 数据库 | 使用发布前备份恢复；不要用导入脚本反向删除 | 未在目标环境演练 |

“30 分钟内回滚”不是已演练承诺。实际耗时需在测试环境记录后再对外说明。

## 当前阻塞

- 本机 native Supabase 已配置并通过真实验收；**云端独立测试项目**仍无 URL/key 和
  SQL 执行权限。
- 无目标服务器、域名、TLS 证书和 Nginx 站点访问权限。
- 本机已导入化学 + 15 个学院（含外国语）+ 训练中心 + 173 个课表身份
  （1,555 教师身份 / 1,342 课程 / 2,946 关系）；教师身份未解决 0，但 3 条课程关系为 inferred/可纠正、6 条文法 OTH 冲突关系和当前学期确认仍缺，
  无法完成全校数据闭环。
- 无官方 Logo/域名定稿，当前为中性图标和占位域名。

以上缺口不影响本机构建/本机真实 Supabase 验收，但阻止云端独立项目验收与正式上线。
