(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const params = new URLSearchParams(location.search);
  const explicit = String(params.get('runtime') || '').toLowerCase();

  const MODE_KEY = 'worshipDeckConnectionModeV1';
  const REMOTE_BASE_KEY = 'worshipDeckRemoteBaseUrlV1';
  const LOCAL_BASE_KEY = 'worshipDeckLocalBaseUrlV1';
  const FEATURE_SEEN_KEY = 'worshipDeckFeatureConnectionModeV1';

  function isPrivateHost(hostname) {
    const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
    const m = /^172\.(\d+)\./.exec(h);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true;
    return false;
  }

  function normalizeBase(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.origin + url.pathname.replace(/\/$/, '');
    } catch (_) {
      return '';
    }
  }

  function normalizeMode(value) {
    return ['auto', 'local', 'remote'].includes(String(value || '').toLowerCase())
      ? String(value).toLowerCase()
      : 'auto';
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

  const connection = {
    preference: normalizeMode(localStorage.getItem(MODE_KEY) || 'auto'),
    active: guessedKind === 'local' ? 'local' : 'remote',
    state: 'ready',
    detail: '',
    localBaseUrl: normalizeBase(localStorage.getItem(LOCAL_BASE_KEY) || ''),
    remoteBaseUrl: normalizeBase(localStorage.getItem(REMOTE_BASE_KEY) || ''),
    lastTestAt: 0,
    lastTestOk: null,
  };

  const runtime = {
    kind: guessedKind,
    apiContractVersion: 1,
    apiBase: '',
    capabilities: defaultsFor(guessedKind),
    source: 'detected',
    ready: null,
    nativeFetch,
    connection,
    api(pathname) {
      const path = String(pathname || '');
      if (!path.startsWith('/api/')) return path;
      const base = resolvedApiBase();
      return base ? `${base}${path}` : path;
    },
    setConnectionMode,
    setRemoteBaseUrl,
    setLocalBaseUrl,
    refreshConnection,
    testConnection,
  };

  function endpointFor(target) {
    if (target === 'local') {
      if (runtime.kind === 'local') return '';
      return connection.localBaseUrl;
    }
    if (runtime.kind === 'web') return '';
    return connection.remoteBaseUrl;
  }

  function connectionProblem(target, base) {
    if (target === runtime.kind) return '';
    if (!base) {
      return target === 'local'
        ? 'Endereço local ainda não pareado neste aparelho.'
        : 'Endereço Web ainda não foi carregado da configuração.';
    }
    if (location.protocol === 'https:' && /^http:\/\//i.test(base)) {
      return 'O navegador HTTPS bloqueia acesso HTTP direto à rede local. No APK a descoberta local será nativa.';
    }
    return '';
  }

  function chooseBrowserTarget() {
    if (connection.preference === 'local') return 'local';
    if (connection.preference === 'remote') return 'remote';
    return runtime.kind === 'local' ? 'local' : 'remote';
  }

  async function chooseTarget() {
    if (connection.preference !== 'auto') return chooseBrowserTarget();

    // O APK poderá fornecer um resolvedor nativo sem alterar a interface.
    // Esperado: { target:'local'|'remote', localBaseUrl?, remoteBaseUrl? }
    try {
      const resolver = window.WorshipDeckNativeConnection?.resolve;
      if (typeof resolver === 'function') {
        const result = await resolver({
          currentKind: runtime.kind,
          localBaseUrl: connection.localBaseUrl,
          remoteBaseUrl: connection.remoteBaseUrl,
        });
        if (result && (result.target === 'local' || result.target === 'remote')) {
          if (result.localBaseUrl) setLocalBaseUrl(result.localBaseUrl, false);
          if (result.remoteBaseUrl) setRemoteBaseUrl(result.remoteBaseUrl, false);
          return result.target;
        }
      }
    } catch (_) {}

    return chooseBrowserTarget();
  }

  function resolvedApiBase() {
    const targetBase = endpointFor(connection.active);
    if (targetBase) return targetBase.replace(/\/$/, '');
    if (connection.active === runtime.kind) return String(runtime.apiBase || '').replace(/\/$/, '');
    return '';
  }

  function applyRuntimeMeta() {
    document.documentElement.dataset.runtime = runtime.kind;
    document.documentElement.dataset.apiContract = String(runtime.apiContractVersion || 1);
    document.documentElement.dataset.connectionMode = connection.preference;
    document.documentElement.dataset.connectionActive = connection.active;
    document.documentElement.dataset.connectionState = connection.state;
    updateConnectionModeUI();
    window.dispatchEvent(new CustomEvent('worship-runtime-ready', { detail: runtime }));
    window.dispatchEvent(new CustomEvent('worship-connection-change', { detail: { ...connection } }));
  }

  async function refreshConnection() {
    const target = await chooseTarget();
    const base = endpointFor(target);
    const problem = connectionProblem(target, base);
    connection.active = target;
    connection.state = problem ? 'unavailable' : 'ready';
    connection.detail = problem || (target === 'local'
      ? (runtime.kind === 'local' ? 'Usando o Worship Deck desta rede.' : `Local: ${base}`)
      : (runtime.kind === 'web' ? 'Usando Worship Deck Web.' : `Remoto: ${base}`));
    applyRuntimeMeta();
    return connection;
  }

  function setConnectionMode(mode) {
    connection.preference = normalizeMode(mode);
    localStorage.setItem(MODE_KEY, connection.preference);
    refreshConnection();
  }

  function setRemoteBaseUrl(value, refresh = true) {
    const normalized = normalizeBase(value);
    connection.remoteBaseUrl = normalized;
    if (normalized) localStorage.setItem(REMOTE_BASE_KEY, normalized);
    else localStorage.removeItem(REMOTE_BASE_KEY);
    if (refresh) refreshConnection();
  }

  function setLocalBaseUrl(value, refresh = true) {
    const normalized = normalizeBase(value);
    connection.localBaseUrl = normalized;
    if (normalized) localStorage.setItem(LOCAL_BASE_KEY, normalized);
    else localStorage.removeItem(LOCAL_BASE_KEY);
    if (refresh) refreshConnection();
  }

  async function testConnection() {
    await refreshConnection();
    if (connection.state !== 'ready') {
      connection.lastTestOk = false;
      connection.lastTestAt = Date.now();
      updateConnectionModeUI();
      throw new Error(connection.detail || 'Modo de conexão indisponível.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await nativeFetch(runtime.api('/api/status'), {
        cache: 'no-store',
        signal: controller.signal,
        credentials: runtime.api('/api/status').startsWith('http') ? 'include' : 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      connection.lastTestOk = true;
      connection.lastTestAt = Date.now();
      connection.state = 'ready';
      connection.detail = `${connection.active === 'local' ? 'Local' : 'Remoto'} respondeu corretamente.`;
      applyRuntimeMeta();
      return true;
    } catch (error) {
      connection.lastTestOk = false;
      connection.lastTestAt = Date.now();
      connection.state = 'offline';
      connection.detail = error.name === 'AbortError' ? 'Tempo esgotado ao testar a conexão.' : `Falha: ${error.message}`;
      applyRuntimeMeta();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function capturePublicEndpoints(path, response) {
    if (!response || !response.ok || !String(path || '').startsWith('/api/config')) return;
    try {
      response.clone().json().then(data => {
        const cfg = data?.config && typeof data.config === 'object' ? data.config : data;
        if (cfg && typeof cfg.cloudBaseUrl === 'string' && cfg.cloudBaseUrl.trim()) {
          setRemoteBaseUrl(cfg.cloudBaseUrl, false);
          refreshConnection();
        }
      }).catch(() => {});
    } catch (_) {}
  }

  window.fetch = function worshipRuntimeFetch(input, init) {
    let originalPath = '';
    let mappedInput = input;
    try {
      if (typeof input === 'string' && input.startsWith('/api/') && !input.startsWith('/api/runtime')) {
        originalPath = input;
        const mapped = runtime.api(input);
        mappedInput = mapped;
        if (mapped !== input && /^https?:\/\//i.test(mapped)) {
          init = { ...(init || {}), credentials: init?.credentials || 'include' };
        }
      } else if (input instanceof Request) {
        const url = new URL(input.url, location.href);
        if (url.origin === location.origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/runtime') {
          originalPath = `${url.pathname}${url.search}`;
          const mapped = runtime.api(originalPath);
          if (mapped !== originalPath) mappedInput = new Request(mapped, input);
        }
      }
    } catch (_) {}

    const promise = nativeFetch(mappedInput, init);
    if (originalPath) promise.then(res => capturePublicEndpoints(originalPath, res)).catch(() => {});
    return promise;
  };

  function connectionLabel() {
    const pref = connection.preference === 'auto' ? 'AUTOMÁTICO' : connection.preference === 'local' ? 'LOCAL' : 'REMOTO';
    const active = connection.active === 'local' ? 'LOCAL' : 'REMOTO';
    return connection.preference === 'auto' ? `${pref} → ${active}` : pref;
  }

  function updateConnectionModeUI() {
    const select = document.getElementById('mobileConnectionModeSelect');
    const state = document.getElementById('mobileConnectionModeState');
    const hint = document.getElementById('mobileConnectionModeHint');
    const test = document.getElementById('mobileConnectionModeTest');
    if (select && select.value !== connection.preference) select.value = connection.preference;
    if (state) {
      state.textContent = connectionLabel();
      state.dataset.state = connection.state;
    }
    if (hint) hint.textContent = connection.detail || 'Escolha como este aparelho deve alcançar o Worship Deck.';
    if (test) test.disabled = connection.state === 'unavailable';
  }

  function injectConnectionModeUI() {
    if (document.getElementById('mobileConnectionModeCard')) return;
    const page = document.querySelector('[data-panel-page="connections"]');
    if (!page) return;

    const card = document.createElement('article');
    card.id = 'mobileConnectionModeCard';
    card.className = 'mobile-panel-card';
    card.innerHTML = `
      <small>MODO DE CONEXÃO <span style="opacity:.65">• NOVO</span></small>
      <label>Como este aparelho conecta
        <select id="mobileConnectionModeSelect">
          <option value="auto">Automático — recomendado</option>
          <option value="local">Somente Local</option>
          <option value="remote">Somente Remoto</option>
        </select>
      </label>
      <div class="mobile-inline-actions">
        <span id="mobileConnectionModeState">${connectionLabel()}</span>
        <button id="mobileConnectionModeTest" class="mobile-panel-secondary compact" type="button">TESTAR</button>
      </div>
      <p id="mobileConnectionModeHint" class="mobile-panel-note">${connection.detail || 'Escolha como este aparelho deve alcançar o Worship Deck.'}</p>
      <div id="mobileConnectionModeTour" class="mobile-panel-note" style="display:none;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;margin-top:8px">
        <strong style="display:block;margin-bottom:5px">Novidade da Etapa 3</strong>
        Automático usa a conexão apropriada para o ambiente. Local mantém a operação dentro da igreja; Remoto prepara o acesso pela Web/Bridge. No futuro APK, Automático procurará a igreja na rede antes de usar a internet.
        <button id="mobileConnectionModeTourDone" class="mobile-panel-secondary compact" type="button" style="margin-top:8px">ENTENDI</button>
      </div>`;

    page.insertBefore(card, page.firstElementChild);

    document.getElementById('mobileConnectionModeSelect')?.addEventListener('change', event => {
      setConnectionMode(event.target.value);
    });
    document.getElementById('mobileConnectionModeTest')?.addEventListener('click', async event => {
      const btn = event.currentTarget;
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = 'TESTANDO…';
      try { await testConnection(); }
      catch (_) {}
      finally { btn.textContent = old; updateConnectionModeUI(); }
    });

    const tour = document.getElementById('mobileConnectionModeTour');
    if (tour && localStorage.getItem(FEATURE_SEEN_KEY) !== 'done') tour.style.display = '';
    document.getElementById('mobileConnectionModeTourDone')?.addEventListener('click', () => {
      localStorage.setItem(FEATURE_SEEN_KEY, 'done');
      if (tour) tour.style.display = 'none';
    });

    updateConnectionModeUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectConnectionModeUI, { once: true });
  } else {
    injectConnectionModeUI();
  }

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
    await refreshConnection();
    applyRuntimeMeta();
    return runtime;
  })();

  window.WorshipDeckRuntime = runtime;
  applyRuntimeMeta();
})();
