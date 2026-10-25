import { useEffect, useRef } from 'react';
import { isTurnstileEnabled, loadTurnstile, TURNSTILE_SITE_KEY } from '../lib/turnstile';

type TurnstileWidgetProps = {
  action: string;
  onToken: (token: string | null) => void;
  resetKey?: number;
};

// Renders an explicit Turnstile widget. The callback receives a single-use
// token; a new token is required after every auth attempt.
export default function TurnstileWidget({ action, onToken, resetKey = 0 }: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!isTurnstileEnabled || !container.current) return;
    let cancelled = false;
    onToken(null);

    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: 'light',
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      })
      .catch(() => onToken(null));

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          // Widget already detached with the modal.
        }
      }
      widgetId.current = null;
    };
  }, [action, onToken, resetKey]);

  if (!isTurnstileEnabled) return null;
  return <div ref={container} className="flex justify-center py-1" />;
}
