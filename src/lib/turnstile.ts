// Cloudflare Turnstile loader. The widget is rendered only when a site key is
// configured, so local development and any deployment without captcha keep
// working unchanged.
export const TURNSTILE_SITE_KEY = String(
  import.meta.env.VITE_TURNSTILE_SITE_KEY || '',
).trim();

export const isTurnstileEnabled = TURNSTILE_SITE_KEY.length > 0;

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<void> | null = null;

export function loadTurnstile(): Promise<void> {
  if (!isTurnstileEnabled) return Promise.resolve();
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loader = null;
        reject(new Error('人机验证加载失败，请刷新页面后重试'));
      };
      document.head.appendChild(script);
    });
  }
  return loader;
}
