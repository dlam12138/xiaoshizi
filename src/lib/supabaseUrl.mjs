// Native/Docker development stacks use HTTP on the local machine.
// Remote projects must still use HTTPS.
export function hasAllowedSupabaseProtocol(url) {
  return url.protocol === 'https:' || (
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  );
}
