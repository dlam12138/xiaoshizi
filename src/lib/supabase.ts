import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { hasAllowedSupabaseProtocol } from './supabaseUrl.mjs';

// Old-school project coordinates are retained only as a hard deny-list. They must
// never be used as a fallback: a missing or mistyped UPC configuration fails closed.
const RETIRED_SUPABASE_HOSTS = new Set(['qczsdnmwtagwbofpvwle.supabase.co']);

type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export type SupabaseConfiguration = {
  configured: boolean;
  error: string | null;
  url: string | null;
};

const env = import.meta.env as Record<string, string | undefined>;

function validateConfiguration(): { config: SupabaseConfig | null; error: string | null } {
  const rawUrl = (env.VITE_SUPABASE_URL || '').trim();
  const anonKey = (
    env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  if (!rawUrl && !anonKey) {
    return { config: null, error: '未配置 UPC 数据库：请设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY。' };
  }
  if (!rawUrl || !anonKey) {
    return { config: null, error: 'UPC 数据库配置不完整：URL 与匿名密钥必须同时设置，不会回退到旧校项目。' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { config: null, error: 'VITE_SUPABASE_URL 不是合法 URL，已停止连接。' };
  }
  if (!hasAllowedSupabaseProtocol(parsed)) {
    return { config: null, error: 'VITE_SUPABASE_URL 必须使用 https；仅本机回环地址允许 http。已停止连接。' };
  }
  if (RETIRED_SUPABASE_HOSTS.has(parsed.hostname)) {
    return { config: null, error: '检测到旧校 Supabase 项目配置。UPC 环境必须使用独立项目，已拒绝连接。' };
  }

  return { config: { url: parsed.toString().replace(/\/$/, ''), anonKey }, error: null };
}

const validation = validateConfiguration();

export const supabaseConfiguration: SupabaseConfiguration = {
  configured: Boolean(validation.config),
  error: validation.error,
  url: validation.config?.url || null,
};
export const isSupabaseConfigured = supabaseConfiguration.configured;

let supabaseInstance: SupabaseClient | null = null;

if (validation.config) {
  supabaseInstance = createClient(validation.config.url, validation.config.anonKey, {
    global: { headers: { 'x-rating-version': '2' } },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase: SupabaseClient | null = supabaseInstance;

export const getSupabase = (): SupabaseClient | null => supabaseInstance;
