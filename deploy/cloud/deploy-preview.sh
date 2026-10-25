#!/usr/bin/env bash
# 发布 UPC 受限预发布静态包到 example.org（www 301 到根域）。
# 前提：SSH 可用、Nginx 站点已安装、证书已签发、Basic Auth 已配置。
# 只切换 /var/www/upc/current，不改 example-site 数据/服务，不改 DNS。
set -euo pipefail

HOST="${UPC_HOST:?set UPC_HOST, e.g. root@203.0.113.10}"
REMOTE_ROOT="${UPC_REMOTE_ROOT:-/var/www/upc}"
RELEASE_ID="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
PACKAGE="${2:-release/upc-preview.tar.gz}"
SUMS="${PACKAGE}.sha256"

[[ -f "$PACKAGE" ]] || { echo "missing package: $PACKAGE" >&2; exit 1; }
[[ -f "$SUMS" ]] || { echo "missing checksum: $SUMS" >&2; exit 1; }

echo "== local checksum =="
sha256sum -c "$SUMS"

echo "== upload =="
ssh "$HOST" "sudo mkdir -p '$REMOTE_ROOT/releases/$RELEASE_ID' '$REMOTE_ROOT/incoming'"
scp "$PACKAGE" "$HOST:$REMOTE_ROOT/incoming/$RELEASE_ID.tar.gz"
scp "$SUMS" "$HOST:$REMOTE_ROOT/incoming/$RELEASE_ID.tar.gz.sha256"

echo "== extract and switch =="
ssh "$HOST" "bash -s" <<EOF
set -euo pipefail
cd '$REMOTE_ROOT/incoming'
sed -i 's#  .*#  $RELEASE_ID.tar.gz#' '$RELEASE_ID.tar.gz.sha256'
sha256sum -c '$RELEASE_ID.tar.gz.sha256'
sudo tar -xzf '$RELEASE_ID.tar.gz' -C '$REMOTE_ROOT/releases/$RELEASE_ID'
sudo chown -R root:www-data '$REMOTE_ROOT/releases/$RELEASE_ID'
sudo chmod -R a+rX '$REMOTE_ROOT/releases/$RELEASE_ID'
sudo ln -sfn '$REMOTE_ROOT/releases/$RELEASE_ID' '$REMOTE_ROOT/current'
sudo nginx -t
sudo systemctl reload nginx
curl -fsS -o /dev/null -w 'loopback healthz %{http_code}\n' --resolve example.org:443:127.0.0.1 -k https://example.org/healthz
EOF

echo "== public check =="
curl -fsS -o /dev/null -w 'https unauth %{http_code}\n' https://example.org/ || true
echo "deployed release $RELEASE_ID (Basic Auth still required)"
