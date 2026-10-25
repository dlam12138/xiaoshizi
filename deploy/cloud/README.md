# UPC 云端前端部署包（准备稿）

> 本目录的域名与 IP 均为示例占位符，必须替换为自己的部署配置，不能用于访问原作者服务器。

本轮不发布服务器、不修改正式域名或 example-site。目标：`upc.example.org` 限制访问预发布站。
完整方案见 `docs/upc-preview-deployment.md`。

## 构建

1. `deploy/cloud/env.example` 仅模板；真实公开配置在 Git 忽略的 `.env.cloud.local`，
   **不要**放 `SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_DB_URL` 或 SMTP 密钥。
2. `node temp/cloud/write-frontend-env.mjs`（写公开值 + 预发布门），或手工复制模板。
3. `npm run build:cloud`，产物在 `dist/`。
4. 检查服务端密钥泄漏：
   `Get-ChildItem dist -Recurse -File | Select-String -Pattern "sb_secret_|SUPABASE_SERVICE|postgresql://"`
   并解码所有 `eyJ...` JWT，确认只有 anon role。
5. `tar -czf release/upc-preview.tar.gz -C dist . && sha256sum release/upc-preview.tar.gz > release/upc-preview.tar.gz.sha256`

## 发布

```bash
UPC_HOST=root@203.0.113.10 bash deploy/cloud/deploy-preview.sh 20261024T<hhmm>SSZ release/upc-preview.tar.gz
```

脚本只做：上传 → 校验 → 解包到 `/var/www/upc/releases/<id>` → 切 `current` →
`nginx -t` → `reload` → 本地/公网健康检查。**不触碰 example.org/www 的站点。**

## 回退

```bash
UPC_HOST=root@203.0.113.10 bash deploy/cloud/rollback-preview.sh
```

切回上一 release 并 reload。数据库不随静态包回退。

## Nginx / TLS

- `deploy/cloud/upc-preview.nginx.conf`：新 server block，`server_name upc.example.org`
- 安装后 `ln -s` 到 sites-enabled，`nginx -t` 再 reload
- `certbot --nginx -d upc.example.org`；不影响现有域名
- 可选整站门：`sudo htpasswd -c /etc/nginx/upc-preview.htpasswd preview`
  再取消 nginx 配置里 `auth_basic` 两行注释

## Auth 预发布配置

- 前端 `VITE_REGISTRATION_OPEN=false`、`VITE_PRE_RELEASE=true`（已实现并有单测）
- Supabase `disable_signup=true`（必须，前端隐藏不算控制）
- Site URL `https://upc.example.org`，redirect allow-list 同步
- 保持 `mailer_autoconfirm=false`；发信域仍是 `auth.example.org`

当前未执行：无 SSH shell、无 `upc` DNS、无 443/证书、无发布授权。
