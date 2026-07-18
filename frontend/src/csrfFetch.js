import { getCsrfToken } from './api';

// The legacy UI contains direct fetch calls. This adapter protects all
// same-origin mutations until those calls are progressively moved to api.js.
export function installCsrfFetchProtection() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input.url;
    const isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
    if (isSameOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      const csrfToken = getCsrfToken();
      if (csrfToken && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrfToken);
      return nativeFetch(input, { ...init, headers });
    }
    return nativeFetch(input, init);
  };
}
