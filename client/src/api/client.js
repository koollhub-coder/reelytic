export async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`/api${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (!window.location.pathname.includes('/login')) {
      const suffix = data.code === 'REVOKED' ? '?reason=revoked' : '';
      window.location.href = `/login${suffix}`;
      throw new Error(data.error || 'Session expired');
    }
    throw new Error(data.error || 'Unauthorized');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `HTTP error ${res.status}`);
    err.code = data.code;
    err.data = data;
    throw err;
  }

  if (res.status === 204) {
    return null;
  }

  return await res.json();
}
