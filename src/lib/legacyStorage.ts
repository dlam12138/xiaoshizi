/**
 * Remove legacy browser state left by the retired school deployment.
 *
 * Values are deleted without being parsed or merged, so no old-school review,
 * points cache or auth token can become a data source for the UPC app.
 */
export function purgeRetiredBrowserState(): void {
  if (typeof window === 'undefined') return;
  try {
    const retiredPrefixes = ['swjtu_', 'sb-qczsdnmwtagwbofpvwle-'];
    const retiredExact = new Set([
      'swjtu_local_reviews',
      'supabase.auth.token',
    ]);
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      const retired = retiredPrefixes.some((prefix) => key.startsWith(prefix)) || retiredExact.has(key);
      if (retired) window.localStorage.removeItem(key);
    }
    // Session storage is scoped to the browser tab; clear only the old prefix.
    const sessionKeys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith('swjtu_') || key?.startsWith('sb-qczsdnmwtagwbofpvwle-')) sessionKeys.push(key);
    }
    for (const key of sessionKeys) window.sessionStorage.removeItem(key);
  } catch (error) {
    console.warn('[storage] 旧校浏览器状态清理失败（不影响 UPC 数据读取）', error);
  }
}
