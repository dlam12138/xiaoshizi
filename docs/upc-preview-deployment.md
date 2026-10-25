# 预发布部署方案：upc.example.org（未部署）

更新：2026-10-24。目标：把当前分支构建的静态站发布为**限制访问的预发布站**，
保留 `example.org` / `www.example.org` 现有站点，不开放注册。**本轮没有服务器写权限，
因此以下内容尚未执行，只是可审阅方案。**

## 1. 现状事实

- 服务器：`203.0.113.10`（阿里云东京；运营者描述 2C/2G Ubuntu）
- SSH：22 开放，`OpenSSH_9.6p1 Ubuntu-3ubuntu13.20`
- 已试用户 `root`、`ubuntu`、`ecs-user`、`admin`、`operator`、`operator`：
  全部 `Permission denied (publickey,password)`
- 因此无法读取内存/磁盘/进程/监听端口/Nginx 配置/证书/example-site 进程
- HTTP 80 开放，返回 Nginx 1.24 默认页；**443 未监听**
- DNS：根域/www A 均为 `203.0.113.10`；`upc.example.org` NXDOMAIN
- 本机无阿里云 CLI/API 凭据，无法远程核查 ECS 或改 DNS

## 2. 预发布访问控制

两层，缺一不可：

1. **应用层**：前端 `VITE_REGISTRATION_OPEN=false`、`VITE_PRE_RELEASE=true`
   - 隐藏注册入口、把注册/宣传 CTA 改为登录
   - 登录弹窗显示“注册暂未开放”
   - 顶部横幅标明“预发布站点”
2. **Auth 层**：托管项目 `disable_signup=true`
   - 即使有人直接调用 `/auth/v1/signup` 也会被拒绝
   - 只允许已有/受邀账号登录
   - 恢复密码仍可用，不依赖注册

可选第三层（推荐）：

3. **Nginx Basic Auth 或 IP 白名单**：整站再加一道门。
   - 需要运营者提供允许的出口 IP 或一组测试账号
   - Basic Auth 密码只存服务器，不写前端/仓库

> 仅隐藏按钮不算限制访问；必须启用 `disable_signup`。若还要整站封闭，再加 Nginx 层。

## 3. 服务器接入（必须先完成）

在阿里云控制台：

1. 进入 **ECS → 实例 → 该实例 → 远程连接**
2. 用 **Workbench / VNC** 登录（浏览器内，不需要本地 SSH）
3. 确认登录用户（Ubuntu 镜像通常是 `root` 或 `ubuntu`）
4. 把本机公钥追加到目标用户：
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-rsa AAA...' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
   本机公钥内容：
   `%USERPROFILE%\.ssh\id_rsa.pub`
  <在此粘贴你的 SSH 公钥>
5. 确认 `/etc/ssh/sshd_config` 含：
   ```
   PubkeyAuthentication yes
   PasswordAuthentication no   # 建议
   PermitRootLogin prohibit-password
   ```
   修改后 `sudo systemctl reload ssh`
6. **安全组**：22 端口来源限制为运营者出口 IP，不要 `0.0.0.0/0`
7. 80/443 对公网开放（443 目前未监听，需要后续 Nginx+TLS）

如果不想用 Workbench，也可以在控制台 **重置实例密码** 后用密码 SSH；
但这会把密码暴露在运维流程中，建议仅临时使用并尽快改回密钥。

完成后告诉我，我会先只读核查再部署。

## 4. DNS

只新增子域，不动根域/www：

| 类型 | 主机记录 | 值 | TTL |
| --- | --- | --- | --- |
| A | `upc` | `203.0.113.10` | 600 |

- 在阿里云 **云解析 DNS → example.org → 解析设置 → 添加记录**
- 记录类型 A，主机记录 `upc`，记录值 `203.0.113.10`
- 不要改 `@` 和 `www` 的 A 记录
- 不要改 NS
- `auth.example.org` 已用于 Resend 发信，不要复用为站点

验证：

```powershell
Resolve-DnsName upc.example.org -Type A
Resolve-DnsName example.org -Type A
Resolve-DnsName www.example.org -Type A
```

## 5. Nginx 站点（新 server block，不动旧站）

```nginx
# /etc/nginx/sites-available/upc-preview
server {
    listen 80;
    server_name upc.example.org;

    root /var/www/upc/current;
    index index.html;

    # 预发布整站门（可选但推荐）；htpasswd 文件放 /etc/nginx/upc-preview.htpasswd
    # auth_basic "UPC Preview";
    # auth_basic_user_file /etc/nginx/upc-preview.htpasswd;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|webp|svg|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options DENY always;
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/upc-preview /etc/nginx/sites-enabled/upc-preview
sudo nginx -t
sudo systemctl reload nginx
```

**不要修改现有 `example.org`/`www` 的 server block，不要 disable 旧站点。**

## 6. HTTPS

证书只覆盖新子域：

```bash
sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d upc.example.org
sudo certbot renew --dry-run
```

- 若 80 验证失败，改用 DNS-01（阿里云手动加 TXT）
- 证书申请前确认 `upc.example.org` 已解析到本机
- 不改根域/www 证书

## 7. Auth 回调

托管项目 Auth 配置改为：

- Site URL：`https://upc.example.org`
- Redirect allow-list：
  - `https://upc.example.org`
  - `https://upc.example.org/**`（若 Supabase 版本要求通配）
  - 保留 `http://localhost:3000` 仅在本机联调期；正式预发布可移除
- `disable_signup=true`
- `mailer_autoconfirm=false`（保持邮箱确认）
- 邮件模板链接域名应为 `upc.example.org`

注意：Resend 发信域是 `auth.example.org`，与站点域不同，这是正常的；
不要为了发信把站点放到 `auth` 子域。

## 8. 发布步骤

```bash
# 本机
npm run build:cloud
tar -czf upc-preview.tar.gz -C dist .
sha256sum upc-preview.tar.gz

# 服务器（拿到 SSH 后）
sudo mkdir -p /var/www/upc/releases/<sha>
sudo tar -xzf upc-preview.tar.gz -C /var/www/upc/releases/<sha>
sudo ln -sfn /var/www/upc/releases/<sha> /var/www/upc/current
sudo nginx -t && sudo systemctl reload nginx
curl -I https://upc.example.org/
```

发布前检查：

- `dist` 仅含 anon JWT
- 无 service_role/DB URL/SMTP key
- Auth `disable_signup=true`
- 注册入口在前端已隐藏

## 9. 回退

```bash
sudo ln -sfn /var/www/upc/releases/<previous> /var/www/upc/current
sudo nginx -t && sudo systemctl reload nginx
```

- 删除新子域 server block 只影响 `upc.example.org`
- 根域/www 和 example-site 不受影响
- 不动 Supabase 项目、不清库

紧急回退还可直接停用新站点：

```bash
sudo rm /etc/nginx/sites-enabled/upc-preview
sudo nginx -t && sudo systemctl reload nginx
```

## 10. 预发布验收清单

- `https://upc.example.org/` 200，证书有效
- 页面顶部显示预发布横幅
- 登录弹窗无注册 tab，显示“注册暂未开放”
- 直接 `POST /auth/v1/signup` 返回 400/403（disable_signup）
- 受邀/现有账号可登录；管理员 AAL2 可用
- 公开目录可读；评价/审核按既有 RLS
- 根域/www 仍返回原站点，未被改动
- `auth.example.org` 仍只用于发信
- 回退演练：切回上一 release，站点恢复

## 11. 当前阻塞

1. 没有 SSH shell → 无法核查/部署
2. `upc.example.org` 未解析
3. 443 未监听、无证书
4. Auth Site URL/allow-list 仍是 localhost
5. `disable_signup` 已启用（实测 422 `signup_disabled`）；仍需把 Site URL/回调切到 `upc.example.org`
6. 未获正式发布授权（本轮只准备，不发布）
