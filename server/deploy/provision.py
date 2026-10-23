"""Provision the UPC cache API. Never upload or replace the frontend web root.

Required environment:
  SUPABASE_URL, SUPABASE_ANON_KEY  - the UPC project, not the retired school project
  REDIS_PASSWORD                  - existing Redis server password

The script refuses the retired SWJTU host and cache prefix. It writes the API
environment file with mode 0600 and keeps a timestamped backup of touched files.
"""
import datetime
import os
import pathlib
import pwd
import secrets
import shlex
import shutil
import subprocess
import sys

RELEASE_ROOT = pathlib.Path('/opt/upc-eval/releases')
SERVICE_NAME = 'upc-eval-api'
SERVICE_USER = 'upc-cache'
CACHE_PREFIX = 'upc:cache:v1:'
RETIRED_HOST = 'qczsdnmwtagwbofpvwle.supabase.co'

release = pathlib.Path(sys.argv[1]).resolve()
if release.parent != RELEASE_ROOT:
    raise RuntimeError(f'Release must be under {RELEASE_ROOT}')
if not release.is_dir():
    raise RuntimeError('Release directory does not exist')

supabase_url = os.environ.get('SUPABASE_URL', '').strip()
anon_key = os.environ.get('SUPABASE_ANON_KEY', '').strip()
redis_password = os.environ.get('REDIS_PASSWORD', '')
if not supabase_url or not anon_key:
    raise RuntimeError('SUPABASE_URL and SUPABASE_ANON_KEY are required')
if RETIRED_HOST in supabase_url:
    raise RuntimeError('Refusing the retired SWJTU Supabase project')
if not supabase_url.startswith('https://'):
    raise RuntimeError('SUPABASE_URL must use https')
if not redis_password:
    raise RuntimeError('REDIS_PASSWORD is required')

stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = pathlib.Path('/www/backup') / f'upc-eval-{stamp}'
backup.mkdir(parents=True, exist_ok=False)
config = pathlib.Path('/www/server/redis/redis.conf')
env_file = pathlib.Path(f'/etc/{SERVICE_NAME}.env')
unit_file = pathlib.Path(f'/etc/systemd/system/{SERVICE_NAME}.service')
for path in [config, env_file, unit_file]:
    if path.exists():
        shutil.copy2(str(path), str(backup / path.name))
        (backup / path.name).chmod(0o600)
backup.chmod(0o700)

app_password = secrets.token_urlsafe(32)
permissions = [f'~{CACHE_PREFIX}*', '-@all', '+ping', '+info', '+client|setinfo',
               '+client|setname', '+quit', '+select', '+hgetall', '+hget', '+hset',
               '+hdel', '+hexists', '+del', '+expire', '+rename', '+scan', '+eval']
replacement = {'maxmemory': 'maxmemory 256mb',
               'maxmemory-policy': 'maxmemory-policy allkeys-lru'}
lines = []
for line in config.read_text().splitlines():
    parts = shlex.split(line, comments=True)
    if parts and parts[0] in replacement:
        continue
    if len(parts) > 1 and parts[:2] == ['user', SERVICE_USER]:
        continue
    lines.append(line)
lines.extend(replacement.values())
lines.append(f'user {SERVICE_USER} on >{app_password} ' + ' '.join(permissions))
config.write_text('\n'.join(lines) + '\n')
config.chmod(0o640)

cli = '/www/server/redis/src/redis-cli'
redis_env = dict(os.environ, REDISCLI_AUTH=redis_password)


def redis_command(*arguments):
    encoded = [str(arg).encode() for arg in arguments]
    wire = (f'*{len(encoded)}\r\n').encode()
    for arg in encoded:
        wire += (f'${len(arg)}\r\n').encode() + arg + b'\r\n'
    result = subprocess.run([cli, '--pipe'], input=wire, env=redis_env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode or b'errors: 0' not in result.stdout:
        raise RuntimeError(f'Redis configuration command failed: {arguments[0]}')


redis_command('CONFIG', 'SET', 'maxmemory', '268435456',
              'maxmemory-policy', 'allkeys-lru')
redis_command('ACL', 'SETUSER', SERVICE_USER, 'reset', 'on',
              '>' + app_password, *permissions)

try:
    pwd.getpwnam(SERVICE_USER)
except KeyError:
    subprocess.run(['useradd', '--system', '--no-create-home',
                    '--home-dir', '/nonexistent', '--shell', '/sbin/nologin',
                    SERVICE_USER], check=True)

env_file.write_text('\n'.join([
    'NODE_ENV=production',
    'HOST=127.0.0.1',
    'PORT=3001',
    f'SUPABASE_URL={supabase_url}',
    f'SUPABASE_ANON_KEY={anon_key}',
    'REDIS_HOST=127.0.0.1',
    'REDIS_PORT=6379',
    f'REDIS_USERNAME={SERVICE_USER}',
    f'REDIS_PASSWORD={app_password}',
    f'CACHE_PREFIX={CACHE_PREFIX}',
    'CACHE_TTL_SECONDS=604800',
    'CACHE_SYNC_SECONDS=3600',
    '',
]))
env_file.chmod(0o600)

current = pathlib.Path('/opt/upc-eval/current')
if current.is_symlink():
    (backup / 'previous-release.txt').write_text(os.readlink(str(current)))
    current.unlink()
elif current.exists():
    raise RuntimeError('Existing current path is not a managed symlink')
current.parent.mkdir(parents=True, exist_ok=True)
current.symlink_to(release, target_is_directory=True)

shutil.copy2(str(release / 'deploy' / f'{SERVICE_NAME}.service'), str(unit_file))
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', SERVICE_NAME], check=True)
subprocess.run(['systemctl', 'restart', SERVICE_NAME], check=True)
print(f'API service configured. Backup: {backup}')
print('Frontend web root was not modified. Enable the Nginx include after API verification.')
