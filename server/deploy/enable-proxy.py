"""Enable the UPC API proxy include in an existing Nginx site, with validation."""
import os
import pathlib
import re
import shutil
import subprocess

include = pathlib.Path('/www/server/nginx/conf/upc-eval-api.inc')
site = pathlib.Path(os.environ.get(
    'UPC_NGINX_SITE', '/www/server/panel/vhost/nginx/html_temp.com.conf'))
release = pathlib.Path(os.environ.get('UPC_RELEASE_DIR', '/opt/upc-eval/current'))
if not release.is_dir():
    raise RuntimeError('Release directory does not exist')
shutil.copy2(str(release / 'deploy' / 'nginx-cache.conf'), str(include))
original = site.read_text(encoding='utf-8')
directive = f'    include {include};'
if directive not in original:
    changed, count = re.subn(
        r'(?m)^(\s*root\s+[^;]+;\s*\n)',
        lambda match: match.group(1) + directive + '\n',
        original, count=1)
    if count != 1:
        raise RuntimeError('Could not locate the target site root directive')
    site.write_text(changed, encoding='utf-8')
if subprocess.run(['nginx', '-t']).returncode:
    site.write_text(original, encoding='utf-8')
    raise RuntimeError('Nginx validation failed; original site configuration restored')
subprocess.run(['nginx', '-s', 'reload'], check=True)
print(f'API proxy enabled in {site}. Frontend files unchanged.')
