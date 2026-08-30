(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const params = new URLSearchParams(location.search);
  const explicit = String(params.get('runtime') || '').toLowerCase();

  function isPrivateHost(hostname) {
    const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
    const m = /^172\.(\d+)\./.exec(h);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true;
    return false;
  }

  function defaultsFor(kind) {
    if (kind === 'web') {
      return {
        holyrics: true, favorites: true, obs: true, automation: true, bridge: true, youtube: true,
        localPreview: false, agents: false, profiles: false, backup: false, localAdmin: false,
      };
    }
    return {
      holyrics: true, favorites: true, obs: true, automation: true, bridge: true, youtube: true,
      localPreview: true, agents: true, profiles: true, backup: true, localAdmin: true,
    };
  }

  const guessedKind = explicit === 'web' || explicit === 'local'
    ? explicit
    : (isPrivateHost(location.hostname) ? 'local' : 'web');

  const runtime = {
    kind: guessedKind,
    apiContractVersion: 1,
    apiBase: '',
    capabilities: defaultsFor(guessedKind),
    source: 'detected',
    ready: null,
    nativeFetch,
    api(pathname) {
      const path = String(pathname || '');
      if (!path.startsWith('/api/')) return path;
      const base = String(runtime.apiBase || '').replace(/\/$/, '');
      return base ? `${base}${path}` : path;
    },
  };

  function applyRuntimeMeta() {
    document.documentElement.dataset.runtime = runtime.kind;
    document.documentElement.dataset.apiContract = String(runtime.apiContractVersion || 1);
    window.dispatchEvent(new CustomEvent('worship-runtime-ready', { detail: runtime }));
  }

  window.fetch = function worshipRuntimeFetch(input, init) {
    try {
      if (typeof input === 'string' && input.startsWith('/api/') && !input.startsWith('/api/runtime')) {
        return nativeFetch(runtime.api(input), init);
      }
      if (input instanceof Request) {
        const url = new URL(input.url, location.href);
        if (url.origin === location.origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/runtime') {
          const original = `${url.pathname}${url.search}`;
          const mapped = runtime.api(original);
          if (mapped !== original) return nativeFetch(new Request(mapped, input), init);
        }
      }
    } catch (_) {}
    return nativeFetch(input, init);
  };

  runtime.ready = (async () => {
    try {
      const res = await nativeFetch('/api/runtime', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          if (data.kind === 'local' || data.kind === 'web') runtime.kind = data.kind;
          if (typeof data.apiBase === 'string') runtime.apiBase = data.apiBase;
          if (Number.isFinite(Number(data.apiContractVersion))) runtime.apiContractVersion = Number(data.apiContractVersion);
          if (data.capabilities && typeof data.capabilities === 'object') runtime.capabilities = { ...runtime.capabilities, ...data.capabilities };
          runtime.source = 'server';
        }
      }
    } catch (_) {}
    applyRuntimeMeta();
    return runtime;
  })();

  window.WorshipDeckRuntime = runtime;
  applyRuntimeMeta();
})();
