# UPC 阿里云服务器只读核查与发布准备

更新：2026-10-24。**本轮不发布服务器、不改 Nginx/DNS/域名/example-site。**

## 1. 实际可达性核查

目标：`203.0.113.10`（阿里云东京，运营者描述 2C/2G Ubuntu）。

只读事实：

- TCP 22：开放；
- TCP 80：开放，返回 `nginx/1.24.0 (Ubuntu)`；
- TCP 443：**关闭**；
- `http://203.0.113.10/`、`http://example.org/`、`http://www.example.org/` 均返回
  **nginx 默认 “Welcome to nginx!”**，不是 example-site 页面；
- `https://example.org`、`https://www.example.org` SSL 连接失败（443 未监听）；
- DNS：`example.org` A `203.0.113.10`，`www.example.org` A `203.0.113.10`，
  NS 为阿里云 `dns9/dns10.hichina.com`；
- 未观察到 example-site 当前对外页面；不能据此认定 example-site 数据不存在或被删除。

## 2. SSH 接入

本机已有：

- `%USERPROFILE%\.ssh\id_rsa`（公钥注释 `operator@example.com`）；
- `known_hosts` 已有 `203.0.113.10` 的 ED25519/RSA/ECDSA 主机记录；
- 无 SSH config 指定用户/端口。

尝试 `root@203.0.113.10` 和 `ubuntu@203.0.113.10` 的 BatchMode 公钥登录，均返回
`Permission denied (publickey,password)`。因此**没有可用的服务器 shell 权限**，无法读取
内存、磁盘、进程、监听端口、Nginx 站点配置、证书或 example-site 服务状态。

需要运营者提供/完成（不要发密码到聊天）：

1. SSH 用户名、端口（默认 22）；
2. 把本机公钥加入服务器 `authorized_keys`，或提供受控私钥/跳板方式；
3. 安全的 sudo 权限；
4. 安全组放行来源（不要把 22 开到全网，建议限制运营者出口 IP）；
5. 若使用密码登录，改为密钥并保存到 `~/.ssh/config` 或受控文件。

公钥（可公开）：

```text
%USERPROFILE%\.ssh\id_rsa.pub
```

## 3. 查看 example-site 现状（拿到 SSH 后，只读）

```bash
hostname; uname -a; free -h; df -h; uptime
ss -lntup
systemctl --no-pager --type=service --state=running | head -80
nginx -T 2>/dev/null | sed -n '1,240p'
ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d
ls -la /var/www
certbot certificates 2>/dev/null
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null
pm2 list 2>/dev/null
```

不执行 stop/restart/reload、不编辑站点、不删文件、不动 DNS。

## 4. 两种域名方案

### 方案 A：新子域名部署（建议）

例如 `upc.example.org`（最终名称待运营者确认；不要与发信子域
`auth.example.org` 混用）：

1. 阿里云 DNS 新增 `upc` A `203.0.113.10`（只加子域，不动根域/www A）；
2. 新 Nginx server block，root 指向独立目录（如 `/var/www/upc/releases/<sha>`）；
3. 单独申请 TLS（certbot/阿里云证书），先 HTTP 验证或 DNS-01；
4. 配 Supabase Site URL/redirect 到 `https://upc.example.org`；
5. 根域/www/example-site 完全不动；回退只需删除新 server block/子域记录。

优点：不影响旧站，回退边界清楚；缺点：需新增 DNS 和证书。

### 方案 B：替换根域/www

保留现有 A `203.0.113.10`，将 `example.org` / `www.example.org` 的 Nginx 站点切到 UPC：

1. 先通过 SSH 确认 example-site 是否还有服务/数据/其他端口；
2. 备份 `/var/www`、Nginx 配置、证书、数据库（若 example-site 有）；
3. 新站点放独立 release 目录，Nginx `server_name example.org www.example.org`；
4. 证书覆盖两个名字；先 `nginx -t`，再 reload；
5. 回退：恢复原 root/symlink 和 Nginx 配置，reload。

风险：直接覆盖旧站入口；当前无法确认旧站是否只是停用，不能把“默认 nginx 页”当成
可以覆盖的依据。**在 SSH 只读核查和运营者确认前不执行。**

## 5. 静态发布包

- 云端构建：`npm run build:cloud`；
- 产物：`dist/`；
- 包：`release/upc-cloud-static-20261024-2026.tar.gz`；
- 清单：`release/MANIFEST.json`、`release/SHA256SUMS`；
- SHA-256：`4a00c8ae43d92e1e3533ad0761c99dc1350d7f975b27ac3fc823d1dd7c5df791`；
- 已检查：`dist` 仅含 anon JWT，无 service_role key、DB URL、SMTP 密钥；
- Nginx 示例：`deploy/cloud/nginx.conf.example`；
- 环境模板：`deploy/cloud/env.example`；
- 发布前应重新构建并生成包含文件清单/哈希的 manifest（本轮包可复核，未部署）。

建议目录：

```text
/var/www/upc/releases/<git-sha>/
/var/www/upc/current -> releases/<git-sha>
```

## 6. 发布与回退（未执行）

发布：

```bash
# 仅示意，需 SSH 后进行
sha256sum -c SHA256SUMS
sudo mkdir -p /var/www/upc/releases/<sha>
sudo tar -xzf upc-static.tar.gz -C /var/www/upc/releases/<sha>
sudo ln -sfn /var/www/upc/releases/<sha> /var/www/upc/current
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://<domain>/ | head
```

回退：

```bash
sudo ln -sfn /var/www/upc/releases/<previous> /var/www/upc/current
sudo nginx -t && sudo systemctl reload nginx
```

数据库不随静态包回退；不执行 `supabase db reset` 或删除云端表。若前端配置错误，回退
release symlink + 恢复上一版 `.env` 构建产物即可。

## 7. 云端备份能力（实际查询）

- 组织 `upc-production` 当前计划：**free**；
- `walg_enabled: true`；
- `pitr_enabled: false`；
- `/database/backups` 返回 `backups: []`，`physical_backup_data: {}`；
- 因此**不能声称已有可恢复的云端备份**；free 计划不提供可依赖的 PITR/备份恢复。
- 迁移前云端为空，未创建目标快照；源 WSL 有备份：
  `temp/security-backups/wsl-source-pre-cloud-20261024T1149UTC.dump`
  SHA-256 `4a9ea81...b450d1`。
- 恢复演练：完整源 dump 直接 `pg_restore` 到 vanilla 本地库会因平台 schema/函数失败；
  改用 cloud schema + 正式数据在隔离库 `upc_cloud_restore_drill_20261024` 恢复，
  计数 17/1/1555/1342/2946、外键缺失 0、课程学院缺失 0；
- 这不等于云端 PITR，也不能替代正式备份；本轮不重置当前云端项目。

## 8. 浏览器直连延迟（实际样本）

从当前本机直连托管 API `/rest/v1/colleges`，6 次：

- 2666 ms（首包/冷连接）
- 373 ms
- 726 ms
- 717 ms
- 362 ms
- 988 ms
- 失败 0；中位数约 726 ms，最大值 2666 ms。

浏览器直连（本地 `http://127.0.0.1:3000`，Edge headless）：

- 首屏 `networkidle` 约 4.4 s；
- Supabase REST 资源 4 次，2.0–3.3 s，失败 0；
- `transferSize` 因跨域 timing 限制为 0，不能当实际字节数。

该结果来自当前网络出口，不代表阿里云东京服务器或所有用户；部署后还需从服务器和
真实浏览器复测。前端不能仅凭 ap-southeast-2 区域推断低延迟。

## 9. 当前阻塞

1. 无 SSH shell 权限，无法完成内存/磁盘/Nginx/证书/example-site 只读核查；
2. 无正式域名选择（新子域 vs 根域）；
3. 无 TLS 证书/443 监听；
4. 无云端付费备份/PITR，恢复演练能力有限；
5. 未获正式发布授权；本轮明确不发布。
