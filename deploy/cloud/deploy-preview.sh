#!/usr/bin/env bash
# 发布 UPC 预发布静态包到 upc.example.org。
# 前提：已能 SSH 登录、DNS 已解析、Nginx 站点已存在、证书已签发。
# 只切换 /var/www/upc/current 符号链接，不改 example.org/www。
set -euo pipefail

HOST="${UPC_HOST:?set UPC_HOST, e.g. root@203.0.113.10}"
REMOTE_ROOT="${UPC_REMOTE_ROOT:-/var/www/upc}"
RELEASE_ID="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
PACKAGE="${2:-release/upc-preview.tar.gz}"
SUMS="${PACKAGE}.sha256"

if [[ ! -f "$PACKAGE" ]]; then
  echo "missing package: $PACKAGE" >&2
  exit 1
fi
if [[ ! -f "$SUMS" ]]; then
  echo "missing checksum: $SUMS" >&2
  exit 1
fi

echo "== local checksum =="
sha256sum -c "$SUMS"

echo "== upload to $HOST:$REMOTE_ROOT/releases =="
ssh "$HOST" "sudo mkdir -p '$REMOTE_ROOT/releases/$RELEASE_ID' '$REMOTE_ROOT/incoming' && sudo chown -R \$(id -un):\$(id -gn) '$REMOTE_ROOT/incoming'"
scp "$PACKAGE" "$HOST:$REMOTE_ROOT/incoming/$RELEASE_ID.tar.gz"
scp "$SUMS" "$HOST:$REMOTE_ROOT/incoming/$RELEASE_ID.tar.gz.sha256"

echo "== extract and switch =="
ssh "$HOST" "set -euo pipefail
  cd '$REMOTE_ROOT/incoming'
  sha256sum -c '$RELEASE_ID.tar.gz.sha256'
  sudo tar -xzf '$RELEASE_ID.tar.gz' -C '$REMOTE_ROOT/releases/$RELEASE_ID'
  sudo ln -sfn '$REMOTE_ROOT/releases/$RELEASE_ID' '$REMOTE_ROOT/current'
  sudo nginx -t
  sudo systemctl reload nginx
  curl -fsS -o /dev/null -w 'local status %{http_code}\n' -H 'Host: upc.example.org' http://127.0.0.1/healthz
"

echo "== public check =="
curl -fsS -o /dev/null -w 'https status %{http_code}\n' "https://upc.example.org/" || {
  echo "public HTTPS check failed; inspect nginx/certbot before announcing" >&2
  exit 1
}
echo "deployed release $RELEASE_ID"
