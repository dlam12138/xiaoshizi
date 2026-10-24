/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_CACHE_API_ENABLED?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_REGISTRATION_OPEN?: string;
  readonly VITE_PRE_RELEASE?: string;
  readonly [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
