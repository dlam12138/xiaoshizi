import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const action = process.argv[2] || 'start';
const windows = process.platform === 'win32';
const linuxRoot = windows
  ? root.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/')
  : root;

function runLocalProcess(shellCommand, args) {
  const command = windows ? 'wsl.exe' : 'sh';
  const prefix = windows ? [
    '-d', process.env.UPC_WSL_DISTRO || 'Ubuntu-24.04', '--exec',
    ...(process.env.UPC_WSL_PROXY ? ['env', `HTTPS_PROXY=${process.env.UPC_WSL_PROXY}`,
      `HTTP_PROXY=${process.env.UPC_WSL_PROXY}`, 'NO_PROXY=localhost,127.0.0.1'] : []),
    'sh',
  ] : [];
  const result = spawnSync(command, [...prefix, '-lc', shellCommand, 'sh', ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // Never include stdout: start/status output contains service keys.
    throw new Error(result.stderr || `Supabase CLI exited with ${result.status}`);
  }
  return result.stdout;
}

export function runLocalCli(args) {
  return runLocalProcess('exec "$HOME/.local/bin/supabase" "$@"', ['--workdir', linuxRoot, ...args]);
}

function currentStackId() {
  try {
    const state = JSON.parse(runLocalCli(['stack', 'list', '--output-format', 'json']));
    const stacks = (state.stacks || []).filter((stack) => stack.project_root === linuxRoot);
    return (stacks.find((stack) => stack.owner === 'reachable') || stacks[0])?.id || null;
  } catch {
    return null;
  }
}

function localState() {
  try {
    const direct = JSON.parse(runLocalCli(['status', '--output-format', 'json']));
    // Some CLI versions return an empty env object for the compatibility
    // status command. The stack status command contains the actual endpoints.
    if (direct.env && Object.keys(direct.env).length) return direct;
  } catch {
    // Fall through to the managed-stack status command.
  }
  const stackId = currentStackId();
  if (!stackId) throw new Error('No managed local Supabase stack was found.');
  return JSON.parse(runLocalCli(['stack', 'status', '--stack-id', stackId, '--output-format', 'json']));
}

export function runLocalSqlFile(file) {
  const state = localState();
  if (state.runtime !== 'native' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(state.env.DB_URL).hostname)) {
    throw new Error('SQL initialization is restricted to the local native stack.');
  }
  // CLI db query uses prepared statements and cannot execute the full transaction.
  // Use the psql shipped with the verified native Postgres distribution.
  return runLocalProcess(
    'for psql_bin in "$HOME"/.supabase/cache/stack/slim-services/postgres/*/linux-*/*/bin/psql; do '
      + 'if [ -x "$psql_bin" ]; then exec "$psql_bin" "$@"; fi; done; exit 1',
    [state.env.DB_URL, '-v', 'ON_ERROR_STOP=1', '--file', `${linuxRoot}/${file}`],
  );
}

function writeConfiguration(state) {
  if (state.runtime !== 'native') throw new Error('Expected the local native Supabase runtime.');
  const env = state.env;
  const url = new URL(env.API_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Refusing to configure a non-loopback project as the local test stack.');
  }
  if (!env.ANON_KEY || !env.SERVICE_ROLE_KEY) throw new Error('Local stack keys are missing.');
  const files = [
    ['.env.local', 'VITE_SUPABASE_URL', {
      VITE_SUPABASE_URL: env.API_URL,
      VITE_SUPABASE_ANON_KEY: env.ANON_KEY,
      VITE_CACHE_API_ENABLED: 'false',
      VITE_API_BASE_URL: '/api',
    }],
    ['.env.import.local', 'SUPABASE_URL', {
      SUPABASE_URL: env.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
    }],
  ];
  // Check both before writing either, preserving any previously configured cloud project.
  for (const [name, urlKey] of files) {
    const target = path.join(root, name);
    if (fs.existsSync(target) && parse(fs.readFileSync(target, 'utf8'))[urlKey] !== env.API_URL) {
      throw new Error(`${name} points elsewhere; it has been preserved.`);
    }
  }
  for (const [name, , values] of files) {
    const contents = '# Generated for the local Supabase test stack. Git ignored.\n'
      + Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
    fs.writeFileSync(path.join(root, name), contents, { mode: 0o600 });
  }
}

function main() {
  if (action === 'start') {
    const stackId = currentStackId();
    const args = stackId
      ? ['stack', 'start', '--stack-id', stackId, '--runtime', 'native', '--eager', '--output-format', 'json']
      : ['start', '--runtime', 'native', '--eager', '--output-format', 'json'];
    const state = JSON.parse(runLocalCli(args));
    writeConfiguration(state);
    console.log(JSON.stringify({
      ok: true, runtime: state.runtime, api: state.env.API_URL,
      studio: state.env.STUDIO_URL, mail: state.env.MAILPIT_URL,
      configuredFiles: ['.env.local', '.env.import.local'],
    }, null, 2));
  } else if (action === 'init') {
    const existing = JSON.parse(runLocalCli(['db', 'query', '--local', '--output-format', 'json',
      "select count(*)::int as existing from information_schema.tables where table_schema='public' and table_name in ('teachers','reviews','courses','import_batches')"]));
    if (existing[0]?.existing !== 0) throw new Error('Application tables already exist; use an upgrade instead of initialization.');
    runLocalSqlFile('supabase/upc-init.sql');
    runLocalCli(['db', 'query', '--local', "NOTIFY pgrst, 'reload schema'"]);
    console.log('Local UPC database initialized.');
  } else if (action === 'stop') {
    const stackId = currentStackId();
    runLocalCli(stackId ? ['stack', 'stop', '--stack-id', stackId] : ['stop']);
    console.log('Local Supabase stopped; database data is preserved.');
  } else if (action === 'status') {
    const state = localState();
    console.log(JSON.stringify({ runtime: state.runtime, api: state.env.API_URL,
      studio: state.env.STUDIO_URL, mail: state.env.MAILPIT_URL }, null, 2));
  } else {
    throw new Error('Usage: node scripts/local-supabase.mjs <start|init|status|stop>');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`[supabase:local] ${error.message}`); process.exit(1); }
}
