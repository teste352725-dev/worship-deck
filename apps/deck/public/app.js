const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const dialog = $('#settingsDialog');
const toast = $('#toast');
let toastTimer;
let polling = false;
let obsPolling = false;
let tokenConfigured = false;
let obsPasswordConfigured = false;
let favorites = [];
let favoriteError = '';
let obsState = { connected: false, scenes: [], currentProgramSceneName: null, error: '' };
let previewConfig = { pluginHost: '127.0.0.1', pluginPort: 2026, previewMode: 'widescreen' };
let automationConfig = { enabled: false, songScene: '', verseScene: '', noneScene: '', favoriteSceneMap: {}, state: {} };
let automationEditorDirty = false;
let obsPreviewGeneration = 0;
let currentStatus = { connected: false, presentation: null };
let discoveredAgents = [];
let mobileLayoutDirty = false;
let mobileSettings = {
  theme: 'dark', portraitCols: 2, portraitRows: 3, landscapeCols: 5, landscapeRows: 2,
  defaultView: 'controls', showTabs: true, monitorMode: 'none', youtubeVideoId: '', controlStyles: {}, favoriteStyles: {}, obsStyles: {},
};
let activeProfile = 'Principal';
let onboardingComplete = false;
let currentConfigSnapshot = {};
let wizardStep = 1;
const wizardDialog = $('#wizardDialog');
let mobileAutoSaveTimer = null;
let mobileAutoSaveRevision = 0;
let mobileAutoSaveInFlight = false;
let mobileAutoSaveQueued = false;
let guidedTourRenderRevision = 0;
let mobilePanelTab = localStorage.getItem('worshipDeckMobilePanelTab') || 'status';
let lastDiagnostics = null;
let floatingMonitorVisible = localStorage.getItem('worshipDeckFloatingVisible') === '1';
let floatingMonitorRect = null;

// Primeiro acesso e tours são armazenados no próprio aparelho/navegador.
// Assim cada celular aprende o Deck uma vez e pode receber apenas as novidades
// de versões futuras, sem repetir o tour inteiro a cada atualização.
const DEVICE_ONBOARDING_KEY = 'worshipDeckDeviceOnboardingV2';
const LEGACY_DEVICE_ONBOARDING_KEY = 'worshipDeckDeviceOnboardingV1';
const BASIC_TOUR_KEY = 'worshipDeckGuidedTourBasicV1';
const ADVANCED_TOUR_KEY = 'worshipDeckGuidedTourAdvancedV1';
const FEATURE_TOUR_SEEN_KEY = 'worshipDeckGuidedTourFeaturesV1';

let guidedTour = { active:false, type:'', step:0, steps:[], firstRun:false, origin:null };

function isMobileDeckDevice() {
  return !desktopPreviewEnabled();
}

function deviceOnboardingComplete() {
  return localStorage.getItem(DEVICE_ONBOARDING_KEY) === 'done' || localStorage.getItem(LEGACY_DEVICE_ONBOARDING_KEY) === 'done';
}

function markDeviceOnboardingComplete() {
  localStorage.setItem(DEVICE_ONBOARDING_KEY, 'done');
}

function tourKeyDone(key) { return localStorage.getItem(key) === 'done'; }
function markTourDone(key) { localStorage.setItem(key, 'done'); }
function getSeenFeatureTours() {
  try { return new Set(JSON.parse(localStorage.getItem(FEATURE_TOUR_SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveSeenFeatureTours(set) { localStorage.setItem(FEATURE_TOUR_SEEN_KEY, JSON.stringify([...set])); }


function normalizeDisplayMode(mode) {
  if (mode === 'deck') return 'auto';
  return ['auto','mobile','desktop'].includes(mode) ? mode : 'auto';
}

function applyDisplayMode(mode) {
  const next = normalizeDisplayMode(mode);
  document.documentElement.classList.remove('force-mobile','force-desktop');
  if (next === 'mobile') document.documentElement.classList.add('force-mobile');
  if (next === 'desktop') document.documentElement.classList.add('force-desktop');
  localStorage.setItem('worshipDeckDisplayMode', next);
}

function setDisplayModeAndReload(mode) {
  const next = normalizeDisplayMode(mode);
  applyDisplayMode(next);
  const url = new URL(location.href);
  url.searchParams.set('mode', next === 'auto' ? 'deck' : next);
  location.replace(url.toString());
}

(function initDisplayMode() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('mode');
  const saved = localStorage.getItem('worshipDeckDisplayMode') || 'auto';
  const resolved = fromUrl === 'deck' || fromUrl === 'auto' ? 'auto' : normalizeDisplayMode(fromUrl || saved);
  applyDisplayMode(resolved);

  // A partir da Alpha 3, o antigo ?mode=auto passa a se chamar ?mode=deck.
  if (fromUrl === 'auto') {
    const url = new URL(location.href);
    url.searchParams.set('mode', 'deck');
    history.replaceState(null, '', url.toString());
  }
})();

function styleFor(map, key) {
  return (map && map[String(key)]) || {};
}

function hexToRgba(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '';
  const n = parseInt(m[1], 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}

function extractYoutubeVideoId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{6,32}$/.test(raw)) return raw;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (url.hostname.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] || '';
    if (url.pathname.startsWith('/live/')) return url.pathname.split('/').filter(Boolean)[1] || '';
    if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/').filter(Boolean)[1] || '';
    return url.searchParams.get('v') || '';
  } catch { return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32); }
}

function styleAttr(style) {
  if (!style?.color) return '';
  return ` style="--custom-color:${escapeHtml(style.color)};--custom-color-soft:${escapeHtml(hexToRgba(style.color,.22))}"`;
}

function applyMobileTheme() {
  let theme = mobileSettings.theme || 'dark';
  if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.mobileTheme = theme;
  document.documentElement.classList.toggle('mobile-tabs-hidden', mobileSettings.showTabs === false);
  const mobileThemeSelect = $('#mobileThemeSelect');
  if (mobileThemeSelect) mobileThemeSelect.value = mobileSettings.theme || 'dark';
}

const CONTROL_ITEMS = [
  { command: 'previous', label: 'ANTERIOR', icon: '◀', tone: 'nav' },
  { command: 'next', label: 'PRÓXIMO', icon: '▶', tone: 'nav' },
  { command: 'normal', label: 'NORMAL', icon: '▣', tone: 'success' },
  { command: 'wallpaper', label: 'FUNDO', icon: '▧', tone: 'neutral' },
  { command: 'blank', label: 'VAZIA', icon: '□', tone: 'neutral' },
  { command: 'black', label: 'PRETA', icon: '■', tone: 'dark' },
  { command: 'close', label: 'ENCERRAR', icon: '×', tone: 'danger' },
];

const PREVIEW_MODES = {
  widescreen: { path: '/view/widescreen', label: 'WIDESCREEN' },
  standard: { path: '/view/standard', label: 'STANDARD' },
  text: { path: '/view/text', label: 'TEXT' },
  text2: { path: '/view/text2', label: 'TEXT 2' },
  text3: { path: '/view/text3', label: 'TEXT 3' },
  multiview: { path: '/multiview', label: 'MULTIVIEW' },
};

function desktopPreviewEnabled() {
  return document.documentElement.classList.contains('force-desktop') || !window.matchMedia('(pointer: coarse) and (max-width: 1180px)').matches;
}

function previewUrl() {
  const mode = PREVIEW_MODES[previewConfig.previewMode] || PREVIEW_MODES.widescreen;
  const host = previewConfig.pluginHost || '127.0.0.1';
  return `http://${host}:${previewConfig.pluginPort}${mode.path}`;
}

function updatePreview(force = false) {
  if (!desktopPreviewEnabled()) return;
  const frame = $('#previewFrame');
  if (!frame) return;
  const mode = PREVIEW_MODES[previewConfig.previewMode] || PREVIEW_MODES.widescreen;
  const url = previewUrl();
  $('#previewAddress').textContent = `:${previewConfig.pluginPort} • ${mode.label}`;
  if (force || frame.dataset.previewUrl !== url) {
    frame.dataset.previewUrl = url;
    frame.src = url;
  }
}

function reloadPreview() {
  const frame = $('#previewFrame');
  if (!frame || !desktopPreviewEnabled()) return;
  const url = previewUrl();
  frame.src = 'about:blank';
  setTimeout(() => { frame.dataset.previewUrl = url; frame.src = url; }, 60);
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => toast.className = 'toast', 2600);
}

function typeLabel(type) {
  return ({
    song: 'Música', verse: 'Versículo', text: 'Texto', audio: 'Áudio', image: 'Imagem',
    announcement: 'Anúncio', automatic_presentation: 'Apresentação automática', quick_presentation: 'Apresentação rápida'
  })[type] || type || 'Apresentação';
}

function renderStatus(data) {
  currentStatus = data || { connected: false, presentation: null };
  const pill = $('#connectionPill');
  const mobileDots = $$('.mobile-status-dot');
  if (!data.connected) {
    pill.classList.remove('online');
    pill.classList.add('offline');
    $('#connectionText').textContent = 'Holyrics desconectado';
    $('#presentationName').textContent = 'Holyrics não conectado';
    $('#presentationMeta').textContent = data.error || 'Abra Configurações e informe IP, porta e token.';
    $('#slideCounter').textContent = '—';
    $('#screenState').textContent = 'SEM CONEXÃO';
    $('#lastUpdate').textContent = 'Falha na conexão';
    mobileDots.forEach(dot => dot.classList.remove('online'));
    renderMobileNow();
    renderMobilePanelStatus();
    return;
  }

  pill.classList.add('online');
  pill.classList.remove('offline');
  $('#connectionText').textContent = 'Holyrics conectado';
  mobileDots.forEach(dot => dot.classList.add('online'));

  const p = data.presentation;
  if (p) {
    $('#presentationName').textContent = p.name || typeLabel(p.type);
    $('#presentationMeta').textContent = `${typeLabel(p.type)}${p.slide_type ? ` • ${p.slide_type}` : ''}`;
    $('#slideCounter').textContent = p.type === 'verse'
      ? 'BÍBLIA'
      : ((p.slide_number && p.total_slides) ? `${p.slide_number}/${p.total_slides}` : 'AO VIVO');
  } else {
    $('#presentationName').textContent = 'Nenhuma apresentação';
    $('#presentationMeta').textContent = 'Holyrics conectado e pronto.';
    $('#slideCounter').textContent = '—';
  }

  const state = data.f10 ? 'TELA PRETA' : data.f9 ? 'TELA VAZIA' : data.f8 ? 'SOMENTE FUNDO' : 'TELA NORMAL';
  $('#screenState').textContent = state;
  $('#lastUpdate').textContent = `Atualizado ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}`;

  $$('[data-command]').forEach(btn => btn.classList.remove('state-active'));
  const activeCmd = data.f10 ? 'black' : data.f9 ? 'blank' : data.f8 ? 'wallpaper' : 'normal';
  $$(`[data-command="${activeCmd}"]`).forEach(btn => btn.classList.add('state-active'));
  renderMobileNow();
  renderMobilePanelStatus();
}

async function fetchStatus(silent = true) {
  if (polling) return;
  polling = true;
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const data = await res.json();
    renderStatus(data);
    if (!silent && data.connected) showToast('Conexão com o Holyrics confirmada.');
    if (!silent && !data.connected) showToast(data.error || 'Falha na conexão com o Holyrics.', true);
  } catch (error) {
    renderStatus({ connected: false, error: 'Worship Deck sem comunicação com o servidor local.' });
    if (!silent) showToast(error.message, true);
  } finally {
    polling = false;
  }
}

async function control(command, button) {
  button?.setAttribute('disabled', 'disabled');
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha ao executar comando');
    if (navigator.vibrate) navigator.vibrate(18);
    setTimeout(() => fetchStatus(true), 100);
  } catch (error) {
    showToast(error.message, true);
    fetchStatus(true);
  } finally {
    setTimeout(() => button?.removeAttribute('disabled'), 180);
  }
}

async function runFavorite(id, button) {
  button?.setAttribute('disabled', 'disabled');
  try {
    const res = await fetch('/api/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: favorites.find(f => String(f.id) === String(id))?.name || '' }),
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível executar o favorito');
    if (navigator.vibrate) navigator.vibrate([14, 22, 14]);
    if (data.automation) { automationConfig = data.automation; renderAutomationEditor(); }
    setTimeout(() => fetchStatus(true), 160);
    setTimeout(() => fetchObsState(true), 220);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setTimeout(() => button?.removeAttribute('disabled'), 220);
  }
}

function favoriteSubtitle(fav) {
  if (Array.isArray(fav.folders) && fav.folders.length) return fav.folders.join(' › ');
  return 'Favorito do Holyrics';
}

function renderDesktopFavorites() {
  const holder = $('#desktopFavorites');
  const warning = $('#favoritesError');
  if (favoriteError) {
    holder.innerHTML = '';
    warning.textContent = `Favoritos indisponíveis: ${favoriteError}. No Holyrics, libere GetFavorites e FavoriteAction para o token do Worship Deck.`;
    warning.classList.remove('hidden');
    return;
  }
  warning.classList.add('hidden');
  if (!favorites.length) {
    holder.innerHTML = '<div class="empty-card">Nenhum favorito encontrado no Holyrics.</div>';
    return;
  }
  holder.innerHTML = favorites.map((fav, index) => `
    <button class="favorite-btn" data-favorite-id="${escapeHtml(String(fav.id))}" title="${escapeHtml(fav.name || 'Favorito')}">
      <span class="favorite-number">${String(index + 1).padStart(2, '0')}</span>
      <span class="favorite-name">${escapeHtml(fav.name || 'Favorito')}</span>
      <span class="favorite-folder">${escapeHtml(favoriteSubtitle(fav))}</span>
    </button>`).join('');
  bindFavoriteButtons(holder);
  renderAutomationEditor();
  if (!mobileLayoutDirty) renderMobileStyleEditors();
}

function obsScreenshotUrl(sceneName, kind = 'thumb', force = false) {
  const bucketMs = kind === 'program' ? 1100 : 7500;
  const bucket = force ? Date.now() : Math.floor(Date.now() / bucketMs);
  return `/api/obs/screenshot?kind=${encodeURIComponent(kind)}&sceneName=${encodeURIComponent(sceneName)}&v=${bucket}-${obsPreviewGeneration}`;
}

function updateObsProgramPreview(force = false) {
  if (!desktopPreviewEnabled() || document.hidden) return;
  const img = $('#obsProgramPreview');
  const empty = $('#obsProgramPreviewEmpty');
  const label = $('#obsProgramSceneName');
  if (!img || !empty || !label) return;

  const sceneName = obsState.connected ? String(obsState.currentProgramSceneName || '') : '';
  label.textContent = sceneName || (obsState.connected ? 'Sem cena atual' : 'OBS desconectado');
  if (!sceneName) {
    img.removeAttribute('src');
    img.classList.remove('loaded');
    empty.classList.remove('hidden');
    empty.textContent = obsState.connected ? 'O OBS não informou a cena atual.' : 'A prévia aparece quando o OBS conectar.';
    return;
  }

  const url = obsScreenshotUrl(sceneName, 'program', force);
  if (!force && img.dataset.previewUrl === url) return;
  img.dataset.previewUrl = url;
  img.onload = () => { img.classList.add('loaded'); empty.classList.add('hidden'); };
  img.onerror = () => {
    img.classList.remove('loaded');
    empty.classList.remove('hidden');
    empty.textContent = 'Não foi possível capturar esta cena agora.';
  };
  img.src = url;
}

function bindObsThumbnailImages(root = document) {
  root.querySelectorAll('.obs-scene-thumb').forEach(img => {
    const wrap = img.closest('.obs-scene-thumb-wrap');
    img.addEventListener('load', () => wrap?.classList.add('loaded'), { once: true });
    img.addEventListener('error', () => wrap?.classList.add('failed'), { once: true });
  });
}

function refreshObsPreviews() {
  obsPreviewGeneration += 1;
  renderDesktopObs();
  updateObsProgramPreview(true);
  showToast('Previews do OBS atualizados.');
}

function renderObsState(data) {
  obsState = {
    connected: Boolean(data.connected),
    scenes: Array.isArray(data.scenes) ? data.scenes : [],
    currentProgramSceneName: data.currentProgramSceneName || null,
    obsStudioVersion: data.obsStudioVersion || '',
    obsWebSocketVersion: data.obsWebSocketVersion || '',
    error: data.error || '',
  };

  const pill = $('#obsConnectionPill');
  const text = $('#obsConnectionText');
  const mobileDots = $$('.mobile-obs-dot');
  if (obsState.connected) {
    pill.classList.add('online');
    pill.classList.remove('offline');
    text.textContent = obsState.currentProgramSceneName ? `OBS • ${obsState.currentProgramSceneName}` : 'OBS conectado';
    mobileDots.forEach(dot => dot.classList.add('online'));
  } else {
    pill.classList.remove('online');
    pill.classList.add('offline');
    text.textContent = 'OBS desconectado';
    mobileDots.forEach(dot => dot.classList.remove('online'));
  }
  renderDesktopObs();
  renderMobileObs();
  if (!mobileLayoutDirty) renderMobileStyleEditors();
  renderMobileMonitor();
  renderMobilePanelStatus();
  renderMobilePanelDirector();
  updateObsProgramPreview(true);
}

function renderDesktopObs() {
  if (!desktopPreviewEnabled()) return;
  const holder = $('#desktopObsScenes');
  const warning = $('#obsError');
  const meta = $('#obsMeta');
  if (!obsState.connected) {
    holder.innerHTML = '<div class="empty-card">OBS ainda não conectado.</div>';
    warning.textContent = obsState.error || 'Configure IP, porta e senha do OBS WebSocket.';
    warning.classList.remove('hidden');
    meta.textContent = 'Abra ⚙ Configurações para informar o endereço do OBS.';
    updateObsProgramPreview(true);
    return;
  }

  warning.classList.add('hidden');
  const versionBits = [];
  if (obsState.obsStudioVersion) versionBits.push(`OBS ${obsState.obsStudioVersion}`);
  if (obsState.obsWebSocketVersion) versionBits.push(`WebSocket ${obsState.obsWebSocketVersion}`);
  meta.textContent = `${versionBits.join(' • ') || 'OBS conectado'}${obsState.currentProgramSceneName ? ` • No ar: ${obsState.currentProgramSceneName}` : ''}`;

  if (!obsState.scenes.length) {
    holder.innerHTML = '<div class="empty-card">Nenhuma cena encontrada no OBS.</div>';
    return;
  }

  const thumbBucket = Math.floor(Date.now() / 7500);
  holder.innerHTML = obsState.scenes.map((scene, index) => {
    const active = scene.sceneName === obsState.currentProgramSceneName;
    const thumbUrl = `/api/obs/screenshot?kind=thumb&sceneName=${encodeURIComponent(scene.sceneName)}&v=${thumbBucket}-${obsPreviewGeneration}`;
    return `<button class="obs-scene-btn${active ? ' active' : ''}" data-obs-scene="${escapeHtml(scene.sceneName)}" data-obs-uuid="${escapeHtml(scene.sceneUuid || '')}">
      <span class="obs-scene-thumb-wrap"><img class="obs-scene-thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" /><span class="obs-scene-thumb-fallback">SEM PREVIEW</span></span>
      <span class="obs-scene-info"><span class="obs-scene-number">${String(index + 1).padStart(2, '0')}</span><span class="obs-scene-name">${escapeHtml(scene.sceneName)}</span><span class="obs-scene-state">${active ? '● NO AR' : 'Trocar cena'}</span></span>
    </button>`;
  }).join('');
  bindObsButtons(holder);
  bindObsThumbnailImages(holder);
  updateObsProgramPreview(false);
  renderAutomationEditor();
}

async function fetchObsState(silent = true, reconnect = false) {
  if (obsPolling) return;
  obsPolling = true;
  try {
    let res;
    if (reconnect) {
      res = await fetch('/api/obs/reconnect', { method: 'POST' });
    } else {
      res = await fetch('/api/obs/status', { cache: 'no-store' });
    }
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha ao conectar com OBS');
    renderObsState(data);
    if (!silent && data.connected) showToast(`${data.scenes?.length || 0} cena(s) do OBS carregada(s).`);
    if (!silent && !data.connected) showToast(data.error || 'OBS desconectado.', true);
  } catch (error) {
    renderObsState({ connected: false, error: error.message, scenes: [] });
    if (!silent) showToast(error.message, true);
  } finally {
    obsPolling = false;
  }
}

async function switchObsScene(sceneName, sceneUuid, button) {
  button?.setAttribute('disabled', 'disabled');
  try {
    const res = await fetch('/api/obs/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneName, sceneUuid }),
    });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível trocar a cena do OBS');
    renderObsState(data);
    if (navigator.vibrate) navigator.vibrate(20);
  } catch (error) {
    showToast(error.message, true);
    fetchObsState(true);
  } finally {
    setTimeout(() => button?.removeAttribute('disabled'), 180);
  }
}


function sceneOptions(selected = '') {
  const opts = ['<option value="">Não trocar cena</option>'];
  for (const scene of obsState.scenes || []) {
    const name = scene.sceneName || '';
    opts.push(`<option value="${escapeHtml(name)}"${name === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`);
  }
  return opts.join('');
}

function isAutomationEditorControl(element) {
  return Boolean(element?.matches?.(
    '#automationEnabledInput, #autoSongSceneSelect, #autoVerseSceneSelect, #autoNoneSceneSelect, [data-favorite-auto-id]'
  ));
}

function renderAutomationStatus() {
  const pill = $('#automationStatePill');
  if (!pill) return;
  const state = automationConfig.state || {};
  const override = state.specialOverride;
  if (!automationConfig.enabled) {
    pill.className = 'automation-pill off';
    pill.textContent = 'AUTO DESLIGADO';
  } else if (override) {
    pill.className = 'automation-pill hold';
    pill.textContent = `ESPECIAL • ${override.favoriteName || 'FAVORITO'}`;
  } else {
    pill.className = 'automation-pill on';
    pill.textContent = 'AUTO ATIVO';
  }
  $('#automationLastAction').textContent = state.lastAction || 'Aguardando mudança no Holyrics.';
  const warning = $('#automationError');
  if (state.lastError) {
    warning.textContent = state.lastError;
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
}

function renderAutomationEditor() {
  const enabled = $('#automationEnabledInput');
  if (!enabled) return;

  // O OBS e a automação são consultados periodicamente. Enquanto o operador
  // estiver editando (ou houver alterações ainda não salvas), não recriamos
  // os <select>, pois isso fecha a lista e apaga a seleção em andamento.
  if (automationEditorDirty || isAutomationEditorControl(document.activeElement)) {
    renderAutomationStatus();
    return;
  }

  enabled.checked = Boolean(automationConfig.enabled);
  $('#autoSongSceneSelect').innerHTML = sceneOptions(automationConfig.songScene || '');
  $('#autoVerseSceneSelect').innerHTML = sceneOptions(automationConfig.verseScene || '');
  $('#autoNoneSceneSelect').innerHTML = sceneOptions(automationConfig.noneScene || '');

  const holder = $('#favoriteAutomationMap');
  if (!favorites.length) {
    holder.innerHTML = '<div class="empty-card">Nenhum favorito disponível para mapear.</div>';
  } else {
    holder.innerHTML = favorites.map(fav => {
      const selected = (automationConfig.favoriteSceneMap || {})[String(fav.id)] || '';
      return `<div class="favorite-map-row"><div><strong>${escapeHtml(fav.name || 'Favorito')}</strong><small>${escapeHtml(favoriteSubtitle(fav))}</small></div><select data-favorite-auto-id="${escapeHtml(String(fav.id))}">${sceneOptions(selected)}</select></div>`;
    }).join('');
  }

  renderAutomationStatus();
}

async function fetchAutomation(silent = true) {
  try {
    const res = await fetch('/api/automation', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha ao ler automação');
    automationConfig = data;
    renderAutomationEditor();
    renderMobilePanelDirector();
  } catch (error) {
    if (!silent) showToast(error.message, true);
  }
}

async function saveAutomation() {
  const map = {};
  $$('[data-favorite-auto-id]').forEach(select => {
    if (select.value) map[select.dataset.favoriteAutoId] = select.value;
  });
  const payload = {
    enabled: $('#automationEnabledInput').checked,
    songScene: $('#autoSongSceneSelect').value,
    verseScene: $('#autoVerseSceneSelect').value,
    noneScene: $('#autoNoneSceneSelect').value,
    favoriteSceneMap: map,
  };
  const res = await fetch('/api/automation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível salvar a automação');
  automationConfig = data;
  automationEditorDirty = false;
  renderAutomationEditor();
  renderMobilePanelDirector(true);
  showToast(payload.enabled ? 'Diretor automático ativado.' : 'Diretor automático salvo desligado.');
}

async function resumeAutomation() {
  const res = await fetch('/api/automation/resume', { method: 'POST' });
  const data = await res.json();
  if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível retomar a automação');
  automationConfig = data;
  renderAutomationEditor();
  renderMobilePanelDirector(true);
  showToast('Automação retomada.');
  setTimeout(() => fetchObsState(true), 250);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length ? out : [[]];
}

function customizedItems(items, map, keyGetter) {
  return items.map((item, index) => {
    const key = keyGetter(item);
    const custom = styleFor(map, key);
    return { ...item, _custom: custom, _key: key, _index: index };
  }).filter(item => !item._custom.hidden)
    .sort((a,b) => (Number(a._custom.order ?? a._index) - Number(b._custom.order ?? b._index)) || (a._index - b._index));
}

function makeMobileControlButton(item) {
  const custom = item._custom || styleFor(mobileSettings.controlStyles, item.command);
  const label = custom.label || item.label;
  const icon = custom.icon || item.icon;
  return `<button class="mobile-deck-btn ${item.tone}${custom.color ? ' custom-color' : ''}" data-command="${item.command}"${styleAttr(custom)}><span class="mobile-deck-icon">${escapeHtml(icon)}</span><span class="mobile-deck-label">${escapeHtml(label)}</span></button>`;
}

function makeMobileFavoriteButton(fav) {
  const custom = fav._custom || styleFor(mobileSettings.favoriteStyles, fav.id);
  const label = custom.label || fav.name || 'Favorito';
  const icon = custom.icon || '★';
  return `<button class="mobile-deck-btn favorite${custom.color ? ' custom-color' : ''}" data-favorite-id="${escapeHtml(String(fav.id))}"${styleAttr(custom)}><span class="mobile-deck-icon">${escapeHtml(icon)}</span><span class="mobile-deck-label">${escapeHtml(label)}</span></button>`;
}

function makeMobileObsButton(scene) {
  const active = scene.sceneName === obsState.currentProgramSceneName;
  const custom = scene._custom || styleFor(mobileSettings.obsStyles, scene.sceneName);
  const label = custom.label || scene.sceneName;
  const icon = custom.icon || (active ? '●' : '◉');
  return `<button class="mobile-deck-btn obs${active ? ' state-active' : ''}${custom.color ? ' custom-color' : ''}" data-obs-scene="${escapeHtml(scene.sceneName)}" data-obs-uuid="${escapeHtml(scene.sceneUuid || '')}"${styleAttr(custom)}><span class="mobile-deck-icon">${escapeHtml(icon)}</span><span class="mobile-deck-label">${escapeHtml(label)}</span></button>`;
}

function renderPager(container, dots, pages, itemRenderer) {
  const previousPage = Math.round(container.scrollLeft / Math.max(container.clientWidth, 1));
  const targetPage = Math.min(previousPage, Math.max(pages.length - 1, 0));
  const dims = mobileGridDimensions();
  container.style.setProperty('--mobile-cols', dims.cols);
  container.style.setProperty('--mobile-rows', dims.rows);
  container.innerHTML = pages.map((page, pageIndex) => `<div class="mobile-deck-page" data-page="${pageIndex}">${page.map(itemRenderer).join('')}</div>`).join('');
  dots.innerHTML = pages.map((_, i) => `<span class="pager-dot${i === targetPage ? ' active' : ''}"></span>`).join('');
  bindControlButtons(container);
  bindFavoriteButtons(container);
  bindObsButtons(container);
  const updateDots = () => {
    const page = Math.round(container.scrollLeft / Math.max(container.clientWidth, 1));
    [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === page));
  };
  container.onscroll = updateDots;
  requestAnimationFrame(() => { container.scrollLeft = targetPage * container.clientWidth; updateDots(); });
}

function mobileGridDimensions() {
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  return landscape
    ? { cols: Number(mobileSettings.landscapeCols || 5), rows: Number(mobileSettings.landscapeRows || 2) }
    : { cols: Number(mobileSettings.portraitCols || 2), rows: Number(mobileSettings.portraitRows || 3) };
}

function mobilePageSize() {
  const { cols, rows } = mobileGridDimensions();
  return Math.max(1, cols * rows);
}

function renderMobileCore() {
  applyMobileTheme();
  const pageSize = mobilePageSize();
  const controls = customizedItems(CONTROL_ITEMS, mobileSettings.controlStyles, item => item.command);
  renderPager($('#mobileControlsPager'), $('#mobileControlsDots'), chunk(controls, pageSize), makeMobileControlButton);

  if (favoriteError) {
    const fallback = [{ id: '__error__', name: 'LIBERE FAVORITOS NO TOKEN', error: true }];
    renderPager($('#mobileFavoritesPager'), $('#mobileFavoritesDots'), [fallback], (fav) => `<button class="mobile-deck-btn favorite disabled-card" disabled><span class="mobile-deck-icon">!</span><span class="mobile-deck-label">${fav.name}</span></button>`);
  } else if (!favorites.length) {
    const empty = [{ id: '__empty__', name: 'SEM FAVORITOS' }];
    renderPager($('#mobileFavoritesPager'), $('#mobileFavoritesDots'), [empty], (fav) => `<button class="mobile-deck-btn favorite disabled-card" disabled><span class="mobile-deck-icon">☆</span><span class="mobile-deck-label">${fav.name}</span></button>`);
  } else {
    const items = customizedItems(favorites, mobileSettings.favoriteStyles, fav => String(fav.id));
    renderPager($('#mobileFavoritesPager'), $('#mobileFavoritesDots'), chunk(items, pageSize), makeMobileFavoriteButton);
  }
  renderMobileObs();
  renderMobileMonitor();
}

function renderMobileObs() {
  const pageSize = mobilePageSize();
  if (!obsState.connected) {
    const item = [{ sceneName: obsState.error ? 'OBS DESCONECTADO' : 'CONFIGURE O OBS' }];
    renderPager($('#mobileObsPager'), $('#mobileObsDots'), [item], (scene) => `<button class="mobile-deck-btn obs disabled-card" disabled><span class="mobile-deck-icon">!</span><span class="mobile-deck-label">${escapeHtml(scene.sceneName)}</span></button>`);
    return;
  }
  if (!obsState.scenes.length) {
    const item = [{ sceneName: 'SEM CENAS' }];
    renderPager($('#mobileObsPager'), $('#mobileObsDots'), [item], (scene) => `<button class="mobile-deck-btn obs disabled-card" disabled><span class="mobile-deck-icon">○</span><span class="mobile-deck-label">${escapeHtml(scene.sceneName)}</span></button>`);
    return;
  }
  const scenes = customizedItems(obsState.scenes, mobileSettings.obsStyles, scene => scene.sceneName);
  renderPager($('#mobileObsPager'), $('#mobileObsDots'), chunk(scenes, pageSize), makeMobileObsButton);
}

function slideText(slide) {
  if (!slide) return '';
  if (typeof slide === 'string') return slide;
  return String(slide.text || slide.lyrics || slide.reference || slide.name || slide.title || '').trim();
}

function presentationTexts(p) {
  if (!p) return { current: 'Nenhuma apresentação', next: '—', after: '—' };
  const slides = Array.isArray(p.slides) ? p.slides : [];
  if (!slides.length) return { current: p.text || p.reference || p.name || typeLabel(p.type), next: '—', after: '—' };

  // Holyrics usa slide_number (base 1). Os aliases abaixo tornam a leitura
  // tolerante a respostas de versões/integrações diferentes sem alterar o
  // comportamento normal da API oficial.
  const rawNumber = p.slide_number ?? p.slideNumber ?? p.current_slide ?? p.currentSlide ?? 1;
  let index = Math.max(0, Number(rawNumber || 1) - 1);
  if (!Number.isFinite(index)) index = 0;
  if (index >= slides.length) index = Math.max(0, slides.length - 1);

  return {
    current: slideText(slides[index]) || p.text || p.reference || p.name || typeLabel(p.type),
    next: slideText(slides[index + 1]) || '—',
    after: slideText(slides[index + 2]) || '—',
  };
}

function renderMobileNow() {
  const p = currentStatus?.presentation || null;
  const texts = presentationTexts(p);
  const c = $('#mobileCurrentText'), n = $('#mobileNextText'), a = $('#mobileAfterText');
  if (c) c.textContent = texts.current;
  if (n) n.textContent = texts.next;
  if (a) a.textContent = texts.after;
  renderMobileMonitor();
}

function mobileHolyricsPreviewUrl() {
  const mode = PREVIEW_MODES[previewConfig.previewMode] || PREVIEW_MODES.widescreen;
  const configured = previewConfig.pluginHost || '127.0.0.1';
  const host = ['127.0.0.1','localhost','::1'].includes(configured) ? location.hostname : configured;
  return `http://${host}:${previewConfig.pluginPort}${mode.path}`;
}

function monitorMarkup(force = false, floating = false) {
  const mode = mobileSettings.monitorMode || 'none';
  let key = mode;
  let html = '';
  if (mode === 'obs') {
    const scene = obsState.currentProgramSceneName || '';
    key += `:${scene}:${Math.floor(Date.now()/1600)}`;
    html = scene
      ? `<img class="mobile-monitor-img" src="${escapeHtml(obsScreenshotUrl(scene,'program',force))}" alt="Programa OBS" />`
      : '<div class="mobile-monitor-empty">OBS sem cena no ar.</div>';
  } else if (mode === 'holyrics') {
    const url = mobileHolyricsPreviewUrl();
    key += `:${url}`;
    html = `<iframe class="mobile-monitor-frame" src="${escapeHtml(url)}" title="Preview Holyrics" allow="autoplay"></iframe>`;
  } else if (mode === 'youtube') {
    const id = extractYoutubeVideoId(mobileSettings.youtubeVideoId || '');
    key += `:${id}`;
    html = id
      ? `<iframe class="mobile-monitor-frame" src="https://www.youtube.com/embed/${escapeHtml(id)}?autoplay=1&mute=1&playsinline=1" title="Live YouTube" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : '<div class="mobile-monitor-empty">Configure o ID ou link da live do YouTube.</div>';
  } else {
    html = '<div class="mobile-monitor-empty">Monitor desativado. Escolha Holyrics, OBS ou YouTube no menu.</div>';
  }
  if (floating) key += ':floating';
  return { key, html };
}

function renderFloatingMonitor(force = false) {
  const wrap = $('#floatingMonitor');
  const body = $('#floatingMonitorBody');
  if (!wrap || !body) return;
  wrap.classList.toggle('hidden', !floatingMonitorVisible);
  if (!floatingMonitorVisible) return;
  const { key, html } = monitorMarkup(force, true);
  if (force || body.dataset.monitorKey !== key) {
    body.dataset.monitorKey = key;
    body.innerHTML = html;
  }
}

function renderMobileMonitor(force = false) {
  const card = $('#mobileMonitorCard');
  const modeSelect = $('#mobileMonitorSelect');
  if (modeSelect) modeSelect.value = mobileSettings.monitorMode || 'none';
  const panelMonitor = $('#mobilePanelMonitor');
  if (panelMonitor) panelMonitor.value = mobileSettings.monitorMode || 'none';
  if (card) {
    const { key, html } = monitorMarkup(force, false);
    if (force || card.dataset.monitorKey !== key) {
      card.dataset.monitorKey = key;
      card.innerHTML = html;
    }
  }
  renderFloatingMonitor(force);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function bindControlButtons(root = document) {
  root.querySelectorAll('[data-command]').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => control(btn.dataset.command, btn));
  });
}

function bindFavoriteButtons(root = document) {
  root.querySelectorAll('[data-favorite-id]').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => runFavorite(btn.dataset.favoriteId, btn));
  });
}

function bindObsButtons(root = document) {
  root.querySelectorAll('[data-obs-scene]').forEach(btn => {
    if (btn.dataset.obsBound === '1') return;
    btn.dataset.obsBound = '1';
    btn.addEventListener('click', () => switchObsScene(btn.dataset.obsScene, btn.dataset.obsUuid, btn));
  });
}

async function fetchFavorites(silent = true) {
  try {
    const res = await fetch('/api/favorites', { cache: 'no-store' });
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.error || 'Permissão negada');
    favorites = Array.isArray(data.data) ? data.data : [];
    favoriteError = '';
    renderDesktopFavorites();
    renderMobileCore();
    if (!silent) showToast(`${favorites.length} favorito(s) carregado(s).`);
  } catch (error) {
    favorites = [];
    favoriteError = error.message;
    renderDesktopFavorites();
    renderMobileCore();
    if (!silent) showToast('Não foi possível carregar os favoritos.', true);
  }
}

async function loadConfig() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  const cfg = await res.json();
  currentConfigSnapshot = cfg || {};
  activeProfile = cfg.activeProfile || 'Principal';
  onboardingComplete = Boolean(cfg.onboardingComplete);
  $('#hostInput').value = cfg.holyricsHost || '127.0.0.1';
  $('#portInput').value = cfg.holyricsPort || 8091;
  $('#pluginHostInput').value = cfg.pluginHost || '127.0.0.1';
  $('#pluginPortInput').value = cfg.pluginPort || 2026;
  $('#previewModeInput').value = cfg.previewMode || 'widescreen';
  $('#obsHostInput').value = cfg.obsHost || '127.0.0.1';
  $('#obsPortInput').value = cfg.obsPort || 4455;
  $('#cloudEnabledInput').checked = Boolean(cfg.cloudEnabled);
  $('#cloudBaseUrlInput').value = cfg.cloudBaseUrl || '';
  $('#obsAutoDiscoverInput').checked = Boolean(cfg.obsAutoDiscover);
  mobileSettings = {
    theme: cfg.mobileTheme || 'dark',
    portraitCols: Number(cfg.mobilePortraitCols || 2), portraitRows: Number(cfg.mobilePortraitRows || 3),
    landscapeCols: Number(cfg.mobileLandscapeCols || 5), landscapeRows: Number(cfg.mobileLandscapeRows || 2),
    defaultView: cfg.mobileDefaultView || 'controls', showTabs: cfg.mobileShowTabs !== false, monitorMode: cfg.mobileMonitorMode || 'none', youtubeVideoId: cfg.youtubeVideoId || '',
    controlStyles: cfg.mobileControlStyles || {}, favoriteStyles: cfg.mobileFavoriteStyles || {}, obsStyles: cfg.mobileObsStyles || {},
  };
  fillMobileSettingsInputs();
  applyMobileTheme();
  renderMobileCore();
  await fetchAgents(false, cfg.obsAgentId || '');
  previewConfig = { pluginHost: cfg.pluginHost || '127.0.0.1', pluginPort: Number(cfg.pluginPort || 2026), previewMode: cfg.previewMode || 'widescreen' };
  updatePreview();

  $('#tokenInput').value = '';
  tokenConfigured = Boolean(cfg.tokenConfigured);
  $('#tokenInput').placeholder = tokenConfigured ? 'Token já salvo — deixe vazio para manter' : 'Cole o token criado no Holyrics';

  $('#obsPasswordInput').value = '';
  obsPasswordConfigured = Boolean(cfg.obsPasswordConfigured);
  $('#obsPasswordInput').placeholder = obsPasswordConfigured ? 'Senha já salva — deixe vazio para manter' : 'Senha configurada no OBS';
  $('#cloudBridgeSecretInput').value = '';
  $('#cloudBridgeSecretInput').placeholder = cfg.cloudBridgeSecretConfigured ? 'Segredo já salvo — deixe vazio para manter' : 'Cole o BRIDGE_SECRET da Web';
  syncMobileConnectionInputs(cfg);
  return cfg;
}

function setInputIfIdle(selector, value) {
  const el = $(selector);
  if (el && document.activeElement !== el) el.value = value ?? '';
}

function syncMobileConnectionInputs(cfg = currentConfigSnapshot || {}) {
  setInputIfIdle('#mobileCfgHolyricsHost', cfg.holyricsHost || '127.0.0.1');
  setInputIfIdle('#mobileCfgHolyricsPort', cfg.holyricsPort || 8091);
  setInputIfIdle('#mobileCfgPluginHost', cfg.pluginHost || '127.0.0.1');
  setInputIfIdle('#mobileCfgPluginPort', cfg.pluginPort || 2026);
  setInputIfIdle('#mobileCfgPreviewMode', cfg.previewMode || 'widescreen');
  setInputIfIdle('#mobileCfgObsHost', cfg.obsHost || '127.0.0.1');
  setInputIfIdle('#mobileCfgObsPort', cfg.obsPort || 4455);
  setInputIfIdle('#mobileCfgCloudBaseUrl', cfg.cloudBaseUrl || '');
  if ($('#mobileCfgObsAutoDiscover') && document.activeElement !== $('#mobileCfgObsAutoDiscover')) $('#mobileCfgObsAutoDiscover').checked = Boolean(cfg.obsAutoDiscover);
  if ($('#mobileCfgCloudEnabled') && document.activeElement !== $('#mobileCfgCloudEnabled')) $('#mobileCfgCloudEnabled').checked = Boolean(cfg.cloudEnabled);
  if ($('#mobileCfgHolyricsToken')) {
    $('#mobileCfgHolyricsToken').value = '';
    $('#mobileCfgHolyricsToken').placeholder = cfg.tokenConfigured ? 'Token já salvo — deixe vazio para manter' : 'Cole o token do Holyrics';
  }
  if ($('#mobileCfgObsPassword')) {
    $('#mobileCfgObsPassword').value = '';
    $('#mobileCfgObsPassword').placeholder = cfg.obsPasswordConfigured ? 'Senha já salva — deixe vazio para manter' : 'Senha do WebSocket';
  }
  if ($('#mobileCfgCloudSecret')) {
    $('#mobileCfgCloudSecret').value = '';
    $('#mobileCfgCloudSecret').placeholder = cfg.cloudBridgeSecretConfigured ? 'Segredo já salvo — deixe vazio para manter' : 'Cole o BRIDGE_SECRET';
  }
}

async function saveMobileConnections({ showMessage = true } = {}) {
  const payload = {
    holyricsHost: $('#mobileCfgHolyricsHost')?.value.trim() || '127.0.0.1',
    holyricsPort: Number($('#mobileCfgHolyricsPort')?.value || 8091),
    pluginHost: $('#mobileCfgPluginHost')?.value.trim() || '127.0.0.1',
    pluginPort: Number($('#mobileCfgPluginPort')?.value || 2026),
    previewMode: $('#mobileCfgPreviewMode')?.value || 'widescreen',
    obsHost: $('#mobileCfgObsHost')?.value.trim() || '127.0.0.1',
    obsPort: Number($('#mobileCfgObsPort')?.value || 4455),
    obsAutoDiscover: Boolean($('#mobileCfgObsAutoDiscover')?.checked),
    obsAgentId: $('#mobileCfgObsAgent')?.value || '',
    cloudEnabled: Boolean($('#mobileCfgCloudEnabled')?.checked),
    cloudBaseUrl: ($('#mobileCfgCloudBaseUrl')?.value || '').trim().replace(/\/$/, ''),
  };
  const token = $('#mobileCfgHolyricsToken')?.value.trim(); if (token) payload.token = token;
  const obsPassword = $('#mobileCfgObsPassword')?.value || ''; if (obsPassword) payload.obsPassword = obsPassword;
  const cloudBridgeSecret = $('#mobileCfgCloudSecret')?.value || ''; if (cloudBridgeSecret) payload.cloudBridgeSecret = cloudBridgeSecret;

  const res = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível salvar as conexões');
  currentConfigSnapshot = data || {};
  tokenConfigured = Boolean(data.tokenConfigured);
  obsPasswordConfigured = Boolean(data.obsPasswordConfigured);
  previewConfig = { pluginHost:data.pluginHost || payload.pluginHost, pluginPort:Number(data.pluginPort || payload.pluginPort), previewMode:data.previewMode || payload.previewMode };
  syncMobileConnectionInputs(data);

  // Mantém o editor desktop em sincronia sem duplicar configuração.
  setInputIfIdle('#hostInput', data.holyricsHost || payload.holyricsHost);
  setInputIfIdle('#portInput', data.holyricsPort || payload.holyricsPort);
  setInputIfIdle('#pluginHostInput', data.pluginHost || payload.pluginHost);
  setInputIfIdle('#pluginPortInput', data.pluginPort || payload.pluginPort);
  setInputIfIdle('#previewModeInput', data.previewMode || payload.previewMode);
  setInputIfIdle('#obsHostInput', data.obsHost || payload.obsHost);
  setInputIfIdle('#obsPortInput', data.obsPort || payload.obsPort);
  setInputIfIdle('#cloudBaseUrlInput', data.cloudBaseUrl || payload.cloudBaseUrl);
  if ($('#obsAutoDiscoverInput')) $('#obsAutoDiscoverInput').checked = Boolean(data.obsAutoDiscover);
  if ($('#cloudEnabledInput')) $('#cloudEnabledInput').checked = Boolean(data.cloudEnabled);

  await fetchAgents(false, data.obsAgentId || payload.obsAgentId || '');
  updatePreview(true);
  await Promise.all([fetchStatus(true), fetchObsState(true, true), fetchAutomation(true)]);
  if (showMessage) showToast('Conexões salvas.');
  return data;
}

async function saveConfig(closeAfter = true) {
  const payload = {
    holyricsHost: $('#hostInput').value.trim(),
    holyricsPort: Number($('#portInput').value || 8091),
    pluginHost: $('#pluginHostInput').value.trim() || '127.0.0.1',
    pluginPort: Number($('#pluginPortInput').value || 2026),
    previewMode: $('#previewModeInput').value || 'widescreen',
    obsHost: $('#obsHostInput').value.trim() || '127.0.0.1',
    obsPort: Number($('#obsPortInput').value || 4455),
    obsAutoDiscover: Boolean($('#obsAutoDiscoverInput').checked),
    obsAgentId: $('#obsAgentSelect').value || '',
    cloudEnabled: Boolean($('#cloudEnabledInput').checked),
    cloudBaseUrl: $('#cloudBaseUrlInput').value.trim().replace(/\/$/, ''),
  };
  const token = $('#tokenInput').value.trim();
  if (token) payload.token = token;
  const obsPassword = $('#obsPasswordInput').value;
  if (obsPassword) payload.obsPassword = obsPassword;
  const cloudBridgeSecret = $('#cloudBridgeSecretInput').value;
  if (cloudBridgeSecret) payload.cloudBridgeSecret = cloudBridgeSecret;

  const res = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível salvar');
  currentConfigSnapshot = data || {};
  tokenConfigured = data.tokenConfigured;
  obsPasswordConfigured = data.obsPasswordConfigured;
  syncMobileConnectionInputs(data);
  previewConfig = { pluginHost: data.pluginHost || payload.pluginHost || '127.0.0.1', pluginPort: Number(data.pluginPort || payload.pluginPort || 2026), previewMode: data.previewMode || payload.previewMode || 'widescreen' };
  await fetchAgents(false, data.obsAgentId || payload.obsAgentId || '');
  updatePreview(true);
  $('#tokenInput').value = '';
  $('#tokenInput').placeholder = tokenConfigured ? 'Token já salvo — deixe vazio para manter' : 'Cole o token criado no Holyrics';
  $('#obsPasswordInput').value = '';
  $('#obsPasswordInput').placeholder = obsPasswordConfigured ? 'Senha já salva — deixe vazio para manter' : 'Senha configurada no OBS';
  $('#cloudBridgeSecretInput').value = '';
  $('#cloudBridgeSecretInput').placeholder = data.cloudBridgeSecretConfigured ? 'Segredo já salvo — deixe vazio para manter' : 'Cole o BRIDGE_SECRET da Web';
  if (closeAfter) dialog.close();
}


function fillMobileSettingsInputs() {
  syncMobileVisualInputs();
  renderMobileStyleEditors();
}

function editorRow({ key, name, defaults, custom, type }) {
  const id = escapeHtml(String(key));
  const color = custom.color || '';
  return `<div class="mobile-style-row" data-mobile-style-type="${type}" data-mobile-style-key="${id}">
    <div class="mobile-style-name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(defaults.icon || '')} • ${escapeHtml(defaults.label || name)}</small></div>
    <label>Ícone<input data-field="icon" value="${escapeHtml(custom.icon || '')}" placeholder="${escapeHtml(defaults.icon || '★')}" /></label>
    <label>Nome<input data-field="label" value="${escapeHtml(custom.label || '')}" placeholder="${escapeHtml(defaults.label || name)}" /></label>
    <label>Cor<input data-field="color" type="color" value="${escapeHtml(color || '#334155')}" data-empty-color="${color ? '0' : '1'}" /></label>
    <label>Ordem<input data-field="order" type="number" value="${escapeHtml(String(custom.order ?? ''))}" placeholder="auto" /></label>
    <label class="style-visible"><input data-field="hidden" type="checkbox" ${custom.hidden ? '' : 'checked'} /><span>Mostrar</span></label>
  </div>`;
}

function styleMapForType(type) {
  if (type === 'control') return mobileSettings.controlStyles || (mobileSettings.controlStyles = {});
  if (type === 'favorite') return mobileSettings.favoriteStyles || (mobileSettings.favoriteStyles = {});
  return mobileSettings.obsStyles || (mobileSettings.obsStyles = {});
}

function updateStyleFromRow(row) {
  if (!row) return;
  const type = row.dataset.mobileStyleType;
  const key = row.dataset.mobileStyleKey;
  if (!type || !key) return;
  const get = field => row.querySelector(`[data-field="${field}"]`);
  const entry = {};
  const icon = get('icon')?.value.trim(); if (icon) entry.icon = icon;
  const label = get('label')?.value.trim(); if (label) entry.label = label;
  const colorEl = get('color'); if (colorEl && colorEl.dataset.emptyColor !== '1') entry.color = colorEl.value;
  const order = get('order')?.value; if (order !== '') entry.order = Number(order);
  entry.hidden = !(get('hidden')?.checked ?? true);
  styleMapForType(type)[key] = entry;
}

function renderMobileStyleEditors() {
  const renderGroup = (selector, html) => { const holder = $(selector); if (holder) holder.innerHTML = html; };
  const controlsHtml = CONTROL_ITEMS.map(item => editorRow({ key:item.command, name:item.label, defaults:item, custom:styleFor(mobileSettings.controlStyles,item.command), type:'control' })).join('');
  const favoritesHtml = favorites.length
    ? favorites.map(f => editorRow({ key:String(f.id), name:f.name || 'Favorito', defaults:{icon:'★',label:f.name || 'Favorito'}, custom:styleFor(mobileSettings.favoriteStyles,String(f.id)), type:'favorite' })).join('')
    : '<div class="empty-card">Nenhum favorito carregado.</div>';
  const obsHtml = obsState.scenes?.length
    ? obsState.scenes.map(scene => editorRow({ key:scene.sceneName, name:scene.sceneName, defaults:{icon:'◉',label:scene.sceneName}, custom:styleFor(mobileSettings.obsStyles,scene.sceneName), type:'obs' })).join('')
    : '<div class="empty-card">Conecte ao OBS para personalizar as cenas.</div>';

  renderGroup('#mobileControlEditor', controlsHtml);
  renderGroup('#mobileFavoriteEditor', favoritesHtml);
  renderGroup('#mobileObsEditor', obsHtml);
  renderGroup('#mobilePanelControlEditor', controlsHtml);
  renderGroup('#mobilePanelFavoriteEditor', favoritesHtml);
  renderGroup('#mobilePanelObsEditor', obsHtml);

  $$('.mobile-style-row input').forEach(el => {
    el.addEventListener('input', () => {
      if (el.dataset.field === 'color') el.dataset.emptyColor = '0';
      updateStyleFromRow(el.closest('.mobile-style-row'));
      queueMobileAutoSave();
    });
    el.addEventListener('change', () => {
      updateStyleFromRow(el.closest('.mobile-style-row'));
      queueMobileAutoSave(260);
    });
  });
}

function collectStyleMap(type) {
  const out = {};
  $$(`[data-mobile-style-type="${type}"]`).forEach(row => {
    const get = field => row.querySelector(`[data-field="${field}"]`);
    const entry = {};
    const icon = get('icon')?.value.trim(); if (icon) entry.icon = icon;
    const label = get('label')?.value.trim(); if (label) entry.label = label;
    const colorEl = get('color'); if (colorEl && colorEl.dataset.emptyColor !== '1') entry.color = colorEl.value;
    const order = get('order')?.value; if (order !== '') entry.order = Number(order);
    entry.hidden = !(get('hidden')?.checked ?? true);
    out[row.dataset.mobileStyleKey] = entry;
  });
  return out;
}

function setMobileAutoSaveState(text, state = 'saved') {
  const desktop = $('#mobileAutoSaveStatus');
  const mobile = $('#mobilePanelSaveState');
  if (desktop) { desktop.textContent = String(text || ''); desktop.dataset.state = state; }
  if (mobile) mobile.textContent = String(text || '');
}

function syncMobileVisualInputs() {
  const setVal = (id, value) => { const el = $(id); if (el && document.activeElement !== el) el.value = value; };
  setVal('#mobileThemeInput', mobileSettings.theme || 'dark');
  setVal('#mobileDefaultViewInput', mobileSettings.defaultView || 'controls');
  if ($('#mobileShowTabsInput') && document.activeElement !== $('#mobileShowTabsInput')) $('#mobileShowTabsInput').checked = mobileSettings.showTabs !== false;
  setVal('#mobileMonitorModeInput', mobileSettings.monitorMode || 'none');
  setVal('#youtubeVideoIdInput', mobileSettings.youtubeVideoId || '');
  setVal('#mobilePortraitColsInput', mobileSettings.portraitCols || 2);
  setVal('#mobilePortraitRowsInput', mobileSettings.portraitRows || 3);
  setVal('#mobileLandscapeColsInput', mobileSettings.landscapeCols || 5);
  setVal('#mobileLandscapeRowsInput', mobileSettings.landscapeRows || 2);

  setVal('#mobilePanelTheme', mobileSettings.theme || 'dark');
  setVal('#mobilePanelDefaultView', mobileSettings.defaultView || 'controls');
  setVal('#mobilePanelMonitor', mobileSettings.monitorMode || 'none');
  setVal('#mobilePanelYoutube', mobileSettings.youtubeVideoId || '');
  if ($('#mobilePanelShowTabs') && document.activeElement !== $('#mobilePanelShowTabs')) $('#mobilePanelShowTabs').checked = mobileSettings.showTabs !== false;
  setVal('#mobilePanelPortraitCols', mobileSettings.portraitCols || 2);
  setVal('#mobilePanelPortraitRows', mobileSettings.portraitRows || 3);
  setVal('#mobilePanelLandscapeCols', mobileSettings.landscapeCols || 5);
  setVal('#mobilePanelLandscapeRows', mobileSettings.landscapeRows || 2);

  setVal('#mobileMonitorSelect', mobileSettings.monitorMode || 'none');
  setVal('#mobileThemeSelect', mobileSettings.theme || 'dark');
}

function updateMobileSettingsFromDesktop() {
  mobileSettings.theme = $('#mobileThemeInput')?.value || mobileSettings.theme || 'dark';
  mobileSettings.defaultView = $('#mobileDefaultViewInput')?.value || mobileSettings.defaultView || 'controls';
  mobileSettings.showTabs = $('#mobileShowTabsInput')?.checked !== false;
  mobileSettings.monitorMode = $('#mobileMonitorModeInput')?.value || mobileSettings.monitorMode || 'none';
  mobileSettings.youtubeVideoId = $('#youtubeVideoIdInput')?.value || mobileSettings.youtubeVideoId || '';
  mobileSettings.portraitCols = Number($('#mobilePortraitColsInput')?.value || mobileSettings.portraitCols || 2);
  mobileSettings.portraitRows = Number($('#mobilePortraitRowsInput')?.value || mobileSettings.portraitRows || 3);
  mobileSettings.landscapeCols = Number($('#mobileLandscapeColsInput')?.value || mobileSettings.landscapeCols || 5);
  mobileSettings.landscapeRows = Number($('#mobileLandscapeRowsInput')?.value || mobileSettings.landscapeRows || 2);
  syncMobileVisualInputs();
  applyMobileTheme();
  renderMobileCore();
}

function updateMobileSettingsFromPanel() {
  mobileSettings.theme = $('#mobilePanelTheme')?.value || mobileSettings.theme || 'dark';
  mobileSettings.defaultView = $('#mobilePanelDefaultView')?.value || mobileSettings.defaultView || 'controls';
  mobileSettings.monitorMode = $('#mobilePanelMonitor')?.value || mobileSettings.monitorMode || 'none';
  mobileSettings.youtubeVideoId = $('#mobilePanelYoutube')?.value || mobileSettings.youtubeVideoId || '';
  mobileSettings.showTabs = $('#mobilePanelShowTabs')?.checked !== false;
  mobileSettings.portraitCols = Number($('#mobilePanelPortraitCols')?.value || mobileSettings.portraitCols || 2);
  mobileSettings.portraitRows = Number($('#mobilePanelPortraitRows')?.value || mobileSettings.portraitRows || 3);
  mobileSettings.landscapeCols = Number($('#mobilePanelLandscapeCols')?.value || mobileSettings.landscapeCols || 5);
  mobileSettings.landscapeRows = Number($('#mobilePanelLandscapeRows')?.value || mobileSettings.landscapeRows || 2);
  syncMobileVisualInputs();
  applyMobileTheme();
  renderMobileCore();
}

function mobileLayoutPayload() {
  return {
    mobileTheme: mobileSettings.theme || 'dark',
    mobileDefaultView: mobileSettings.defaultView || 'controls',
    mobileShowTabs: mobileSettings.showTabs !== false,
    mobileMonitorMode: mobileSettings.monitorMode || 'none',
    youtubeVideoId: extractYoutubeVideoId(mobileSettings.youtubeVideoId || ''),
    mobilePortraitCols: Number(mobileSettings.portraitCols || 2),
    mobilePortraitRows: Number(mobileSettings.portraitRows || 3),
    mobileLandscapeCols: Number(mobileSettings.landscapeCols || 5),
    mobileLandscapeRows: Number(mobileSettings.landscapeRows || 2),
    mobileControlStyles: mobileSettings.controlStyles || {},
    mobileFavoriteStyles: mobileSettings.favoriteStyles || {},
    mobileObsStyles: mobileSettings.obsStyles || {},
  };
}

async function saveMobileLayout({ silent = true, revision = mobileAutoSaveRevision } = {}) {
  // Evita duas gravações concorrentes. Em celular é comum trocar vários campos
  // rapidamente; respostas fora de ordem podiam fazer uma configuração antiga
  // reaparecer na tela depois de uma alteração mais nova.
  if (mobileAutoSaveInFlight) {
    mobileAutoSaveQueued = true;
    return;
  }

  mobileAutoSaveInFlight = true;
  const payload = mobileLayoutPayload();
  const saveRevision = revision;
  setMobileAutoSaveState('Salvando…', 'saving');

  try {
    const res = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha ao salvar visual mobile');

    // Só aplica a resposta ao estado local se nenhuma edição mais recente ocorreu
    // enquanto esta requisição estava viajando pela rede.
    if (saveRevision === mobileAutoSaveRevision) {
      mobileSettings = {
        theme:data.mobileTheme, portraitCols:data.mobilePortraitCols, portraitRows:data.mobilePortraitRows,
        landscapeCols:data.mobileLandscapeCols, landscapeRows:data.mobileLandscapeRows, defaultView:data.mobileDefaultView, showTabs:data.mobileShowTabs !== false,
        monitorMode:data.mobileMonitorMode, youtubeVideoId:data.youtubeVideoId, controlStyles:data.mobileControlStyles || {},
        favoriteStyles:data.mobileFavoriteStyles || {}, obsStyles:data.mobileObsStyles || {},
      };
      mobileLayoutDirty = false;
      syncMobileVisualInputs();
      applyMobileTheme();
      renderMobileCore();
      renderMobilePanelStatus();
      setMobileAutoSaveState('Salvo automaticamente', 'saved');
      if (!silent) showToast('Visual mobile salvo.');
    }
  } finally {
    mobileAutoSaveInFlight = false;
    if (mobileAutoSaveQueued || saveRevision !== mobileAutoSaveRevision) {
      mobileAutoSaveQueued = false;
      clearTimeout(mobileAutoSaveTimer);
      mobileAutoSaveTimer = setTimeout(() => {
        saveMobileLayout({ silent:true, revision:mobileAutoSaveRevision }).catch(error => {
          setMobileAutoSaveState('Falha ao salvar', 'error');
          showToast(error.message, true);
        });
      }, 90);
    }
  }
}

function queueMobileAutoSave(delay = 520) {
  mobileLayoutDirty = true;
  mobileAutoSaveRevision += 1;
  setMobileAutoSaveState('Alteração pendente…', 'pending');
  clearTimeout(mobileAutoSaveTimer);
  const revision = mobileAutoSaveRevision;
  mobileAutoSaveTimer = setTimeout(() => {
    saveMobileLayout({ silent:true, revision }).catch(error => {
      setMobileAutoSaveState('Falha ao salvar', 'error');
      showToast(error.message, true);
    });
  }, delay);
}

function flushMobileAutoSave() {
  if (!mobileLayoutDirty) return;
  clearTimeout(mobileAutoSaveTimer);
  const body = JSON.stringify(mobileLayoutPayload());
  // keepalive permite terminar a gravação mesmo quando o usuário aperta F5,
  // fecha a aba ou troca de aplicativo logo depois de editar uma opção.
  try {
    fetch('/api/config', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body,
      keepalive:true,
    }).catch(() => {});
  } catch {}
}

async function fetchAgents(showMessage = false, preferredId = null) {
  const select = $('#obsAgentSelect');
  const mobileSelect = $('#mobileCfgObsAgent');
  const status = $('#obsAgentStatus');
  const mobileStatus = $('#mobileCfgAgentStatus');
  try {
    const res = await fetch('/api/agents', { cache:'no-store' });
    const data = await res.json();
    discoveredAgents = Array.isArray(data.agents) ? data.agents : [];
    const current = preferredId ?? select?.value ?? mobileSelect?.value ?? data.selectedAgentId ?? '';
    const options = '<option value="">Automático — primeiro Agent disponível</option>' + discoveredAgents.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} • ${escapeHtml(a.address)}:${a.obsPort}</option>`).join('');
    [select, mobileSelect].filter(Boolean).forEach(el => {
      if (document.activeElement === el) return;
      el.innerHTML = options;
      if ([...el.options].some(o => o.value === current)) el.value = current;
    });
    const text = discoveredAgents.length
      ? `${discoveredAgents.length} Agent(s) encontrado(s)${data.effective?.agentId ? ` • usando ${data.effective.host}:${data.effective.port}` : ''}`
      : 'Nenhum Worship Agent detectado. O IP manual continua valendo.';
    if (status) status.textContent = text;
    if (mobileStatus) mobileStatus.textContent = text;
    if (showMessage) showToast(discoveredAgents.length ? `${discoveredAgents.length} Agent(s) encontrado(s).` : 'Nenhum Agent encontrado agora.');
  } catch (error) {
    if (status) status.textContent = 'Falha ao procurar Worship Agent.';
    if (mobileStatus) mobileStatus.textContent = 'Falha ao procurar Worship Agent.';
    if (showMessage) showToast(error.message, true);
  }
}

function renderMobilePanelStatus() {
  const hCard = $('#mobilePanelHolyrics');
  const oCard = $('#mobilePanelObs');
  hCard?.classList.toggle('online', Boolean(currentStatus?.connected));
  oCard?.classList.toggle('online', Boolean(obsState?.connected));
  const hText = $('#mobilePanelHolyricsText'); if (hText) hText.textContent = currentStatus?.connected ? 'Conectado' : 'Desconectado';
  const oText = $('#mobilePanelObsText'); if (oText) oText.textContent = obsState?.connected ? 'Conectado' : 'Desconectado';
  const p = currentStatus?.presentation || null;
  const pName = $('#mobilePanelPresentation'); if (pName) pName.textContent = p?.name || (currentStatus?.connected ? 'Nenhuma apresentação' : 'Holyrics desconectado');
  const pMeta = $('#mobilePanelPresentationMeta'); if (pMeta) pMeta.textContent = p ? `${typeLabel(p.type)}${p.slide_number && p.total_slides ? ` • ${p.slide_number}/${p.total_slides}` : ''}` : '—';
  const scene = $('#mobilePanelScene'); if (scene) scene.textContent = obsState?.currentProgramSceneName || '—';
  const state = $('#mobilePanelScreenState');
  if (state) state.textContent = currentStatus?.f10 ? 'TELA PRETA' : currentStatus?.f9 ? 'TELA VAZIA' : currentStatus?.f8 ? 'SOMENTE FUNDO' : 'TELA NORMAL';
}

function renderMobilePanelDirector(force = false) {
  const page = $('[data-panel-page="director"]');
  if (!page) return;
  if (!force && page.contains(document.activeElement)) return;
  const enabled = $('#mobileAutomationEnabled');
  if (enabled) enabled.checked = Boolean(automationConfig.enabled);
  const state = automationConfig.state || {};
  const label = $('#mobilePanelAutoState');
  if (label) label.textContent = !automationConfig.enabled ? 'Desligado' : state.specialOverride ? `Especial • ${state.specialOverride.favoriteName || 'Favorito'}` : 'Ativo';
  const fill = (id, selected) => { const el = $(id); if (el) el.innerHTML = sceneOptions(selected || ''); };
  fill('#mobileAutoSongScene', automationConfig.songScene);
  fill('#mobileAutoVerseScene', automationConfig.verseScene);
  fill('#mobileAutoNoneScene', automationConfig.noneScene);

  const holder = $('#mobileFavoriteAutomationMap');
  if (holder) {
    if (!favorites.length) holder.innerHTML = '<div class="mobile-empty">Nenhum favorito disponível.</div>';
    else holder.innerHTML = favorites.map(fav => {
      const selected = (automationConfig.favoriteSceneMap || {})[String(fav.id)] || '';
      return `<label class="mobile-favorite-auto-row"><span>${escapeHtml(fav.name || 'Favorito')}</span><select data-mobile-favorite-auto-id="${escapeHtml(String(fav.id))}">${sceneOptions(selected)}</select></label>`;
    }).join('');
  }
}

async function saveMobileDirector() {
  const payload = {
    enabled: Boolean($('#mobileAutomationEnabled')?.checked),
    songScene: $('#mobileAutoSongScene')?.value || '',
    verseScene: $('#mobileAutoVerseScene')?.value || '',
    noneScene: $('#mobileAutoNoneScene')?.value || '',
    favoriteSceneMap: automationConfig.favoriteSceneMap || {},
  };
  const res = await fetch('/api/automation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível salvar o Diretor');
  automationConfig = data;
  automationEditorDirty = false;
  renderAutomationEditor();
  renderMobilePanelDirector(true);
}

async function saveMobileFavoriteAutomation() {
  const map = {};
  $$('[data-mobile-favorite-auto-id]').forEach(select => { if (select.value) map[select.dataset.mobileFavoriteAutoId] = select.value; });
  const payload = {
    enabled: Boolean($('#mobileAutomationEnabled')?.checked),
    songScene: $('#mobileAutoSongScene')?.value || '',
    verseScene: $('#mobileAutoVerseScene')?.value || '',
    noneScene: $('#mobileAutoNoneScene')?.value || '',
    favoriteSceneMap: map,
  };
  const res = await fetch('/api/automation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível salvar os mapeamentos');
  automationConfig = data;
  automationEditorDirty = false;
  renderAutomationEditor();
  renderMobilePanelDirector(true);
  showToast('Mapeamentos especiais salvos.');
}

function syncMobilePanelVisual() { syncMobileVisualInputs(); }

function showMobilePanelTab(tab = 'status') {
  const valid = ['status','director','connections','system','visual'];
  mobilePanelTab = valid.includes(tab) ? tab : 'status';
  localStorage.setItem('worshipDeckMobilePanelTab', mobilePanelTab);
  const titles = { status:'Status', director:'Diretor automático', connections:'Conexões', system:'Sistema', visual:'Visual' };
  const title = $('#mobilePanelTitle'); if (title) title.textContent = titles[mobilePanelTab] || 'Painel';
  $$('.mobile-panel-page').forEach(page => page.classList.toggle('active', page.dataset.panelPage === mobilePanelTab));
  if (mobilePanelTab === 'status') renderMobilePanelStatus();
  if (mobilePanelTab === 'director') renderMobilePanelDirector(true);
  if (mobilePanelTab === 'visual') { syncMobilePanelVisual(); renderMobileStyleEditors(); }
  if (mobilePanelTab === 'connections') { syncMobileConnectionInputs(currentConfigSnapshot); fetchAgents(false); loadNetworkAddresses(false); }
}

function showMobileView(target, persist = true) {
  const valid = ['controls','favorites','obs','now','panel'];
  if (!valid.includes(target)) target = 'controls';
  $$('.mobile-view').forEach(view => view.classList.remove('active'));
  $('.mobile-shell')?.classList.toggle('panel-mode', target === 'panel');
  const map = { controls:'#mobileControlsView', favorites:'#mobileFavoritesView', obs:'#mobileObsView', now:'#mobileNowView', panel:'#mobilePanelView' };
  $(map[target])?.classList.add('active');
  $$('.mobile-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mobileTab === target));
  if (persist) localStorage.setItem('worshipDeckMobileView', target);
  if (target === 'now') renderMobileNow();
  if (target === 'panel') showMobilePanelTab(mobilePanelTab);
  closeMobileDrawer();
}

function openMobileDrawer() {
  $('#mobileDrawer')?.classList.add('open');
  $('#mobileDrawerBackdrop')?.classList.add('open');
}
function closeMobileDrawer() {
  $('#mobileDrawer')?.classList.remove('open');
  $('#mobileDrawerBackdrop')?.classList.remove('open');
}


function clampFloatingRect(rect) {
  const vw = Math.max(220, window.innerWidth || 360);
  const vh = Math.max(320, window.innerHeight || 640);
  const minW = Math.min(180, vw - 16);
  const maxW = Math.max(minW, vw - 16);
  const w = Math.max(minW, Math.min(maxW, Number(rect?.w || Math.min(340, maxW))));
  const h = Math.round(w * 9 / 16 + 38);
  const maxX = Math.max(8, vw - w - 8);
  const maxY = Math.max(8, vh - h - 8);
  const x = Math.max(8, Math.min(maxX, Number(rect?.x ?? Math.max(8, vw - w - 16))));
  const y = Math.max(8, Math.min(maxY, Number(rect?.y ?? 92)));
  return { x, y, w, h };
}

function loadFloatingRect() {
  try { floatingMonitorRect = clampFloatingRect(JSON.parse(localStorage.getItem('worshipDeckFloatingRect') || 'null') || {}); }
  catch { floatingMonitorRect = clampFloatingRect({}); }
  return floatingMonitorRect;
}

function applyFloatingRect(rect = floatingMonitorRect || loadFloatingRect()) {
  const el = $('#floatingMonitor');
  if (!el) return;
  floatingMonitorRect = clampFloatingRect(rect || {});
  el.style.left = `${floatingMonitorRect.x}px`;
  el.style.top = `${floatingMonitorRect.y}px`;
  el.style.width = `${floatingMonitorRect.w}px`;
  el.style.height = `${floatingMonitorRect.h}px`;
}

function saveFloatingRect() {
  if (!floatingMonitorRect) return;
  localStorage.setItem('worshipDeckFloatingRect', JSON.stringify(floatingMonitorRect));
}

function openFloatingMonitor() {
  floatingMonitorVisible = true;
  localStorage.setItem('worshipDeckFloatingVisible', '1');
  applyFloatingRect(floatingMonitorRect || loadFloatingRect());
  renderFloatingMonitor(true);
  closeMobileDrawer();
}

function closeFloatingMonitor() {
  floatingMonitorVisible = false;
  localStorage.setItem('worshipDeckFloatingVisible', '0');
  $('#floatingMonitor')?.classList.add('hidden');
}

function resetFloatingMonitor() {
  localStorage.removeItem('worshipDeckFloatingRect');
  floatingMonitorRect = clampFloatingRect({});
  applyFloatingRect(floatingMonitorRect);
  saveFloatingRect();
}

function bindFloatingMonitorGestures() {
  const el = $('#floatingMonitor');
  const head = $('#floatingMonitorHead');
  const grip = $('#floatingMonitorResize');
  if (!el || !head || !grip) return;

  let drag = null;
  head.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    const rect = el.getBoundingClientRect();
    drag = { id:event.pointerId, dx:event.clientX-rect.left, dy:event.clientY-rect.top, w:rect.width };
    head.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  head.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    applyFloatingRect({ x:event.clientX-drag.dx, y:event.clientY-drag.dy, w:drag.w });
  });
  const endDrag = event => {
    if (!drag || (event.pointerId != null && drag.id !== event.pointerId)) return;
    drag = null; saveFloatingRect();
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  let resize = null;
  grip.addEventListener('pointerdown', event => {
    const rect = el.getBoundingClientRect();
    resize = { id:event.pointerId, startX:event.clientX, startW:rect.width, x:rect.left, y:rect.top };
    grip.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  grip.addEventListener('pointermove', event => {
    if (!resize || resize.id !== event.pointerId) return;
    applyFloatingRect({ x:resize.x, y:resize.y, w:resize.startW + (event.clientX-resize.startX) });
  });
  const endResize = event => { if (!resize || (event.pointerId != null && resize.id !== event.pointerId)) return; resize=null; saveFloatingRect(); };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);

  let pinch = null;
  const distance = touches => Math.hypot(touches[0].clientX-touches[1].clientX, touches[0].clientY-touches[1].clientY);
  el.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
      const rect = el.getBoundingClientRect();
      pinch = { d:distance(event.touches), w:rect.width, x:rect.left, y:rect.top };
      event.preventDefault();
    }
  }, { passive:false });
  el.addEventListener('touchmove', event => {
    if (!pinch || event.touches.length !== 2) return;
    const d = distance(event.touches);
    if (pinch.d > 0) applyFloatingRect({ x:pinch.x, y:pinch.y, w:pinch.w * (d/pinch.d) });
    event.preventDefault();
  }, { passive:false });
  el.addEventListener('touchend', event => {
    if (pinch && event.touches.length < 2) { pinch=null; saveFloatingRect(); }
  });
}

async function testCloudConnection() {
  try {
    await saveConfig(false);
    const res = await fetch('/api/cloud/test', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível conectar');
    showToast('Worship Deck Web conectado.');
  } catch (error) { showToast(error.message || 'Falha ao testar a Web.', true); }
}

async function loadNetworkAddresses(showMessage = false) {
  const holders = [$('#networkAddresses'), $('#mobileNetworkAddresses')].filter(Boolean);
  if (!holders.length) return;
  try {
    const res = await fetch('/api/network', { cache: 'no-store' });
    const data = await res.json();
    const addresses = Array.isArray(data.addresses) ? data.addresses : [];
    if (!addresses.length) {
      holders.forEach(holder => holder.innerHTML = '<span class="network-empty">Nenhum IPv4 de rede encontrado. Verifique o Wi‑Fi/cabo.</span>');
      return;
    }
    const html = addresses.map(item => `
      <button type="button" class="network-url" data-copy-url="${escapeHtml(item.url)}" title="Copiar endereço">
        <span>${escapeHtml(item.url)}</span><small>${escapeHtml(item.name || 'rede')}</small>
      </button>`).join('');
    holders.forEach(holder => {
      holder.innerHTML = html;
      holder.querySelectorAll('[data-copy-url]').forEach(btn => btn.addEventListener('click', async () => {
        const value = btn.dataset.copyUrl;
        try { await navigator.clipboard.writeText(value); showToast('Endereço copiado.'); }
        catch { showToast(value); }
      }));
    });
    if (showMessage) showToast('IP da rede atualizado.');
  } catch (error) {
    holders.forEach(holder => holder.textContent = 'Não foi possível detectar o IP agora.');
    if (showMessage) showToast(error.message, true);
  }
}


function serviceStatusLabel(status) {
  return ({ online:'ONLINE', offline:'FALHA', warning:'ATENÇÃO', disabled:'DESATIVADO', pending:'AGUARDANDO' })[status] || String(status || '').toUpperCase();
}

function renderDiagnostics(data) {
  lastDiagnostics = data || null;
  const holder = $('#diagnosticsGrid');
  const meta = $('#diagnosticsMeta');
  const services = Array.isArray(data?.services) ? data.services : [];
  if (holder) holder.innerHTML = services.length ? services.map(item => `
    <div class="diagnostic-card ${escapeHtml(item.status || 'pending')}">
      <span class="diagnostic-dot"></span>
      <div><strong>${escapeHtml(item.label || item.id || 'Serviço')} • ${escapeHtml(serviceStatusLabel(item.status))}</strong><small>${escapeHtml(item.detail || '—')}${item.latencyMs ? ` • ${item.latencyMs} ms` : ''}</small></div>
    </div>`).join('') : '<div class="diagnostic-card offline"><span class="diagnostic-dot"></span><div><strong>Diagnóstico indisponível</strong><small>Nenhum resultado retornado.</small></div></div>';
  if (meta) {
    const sys = data?.system || {};
    const addresses = Array.isArray(sys.addresses) ? sys.addresses.join(' • ') : '';
    meta.textContent = `${sys.hostname || 'PC'} • Node ${sys.node || '—'} • Perfil ${sys.activeProfile || activeProfile}${addresses ? ` • ${addresses}` : ''}`;
  }
  const mobile = $('#mobileDiagnosticsGrid');
  if (mobile) mobile.innerHTML = services.length ? services.map(item => `
    <article class="mobile-panel-card mobile-diagnostic ${escapeHtml(item.status || 'pending')}"><span class="status-light"></span><div><small>${escapeHtml(item.label || item.id || 'Serviço')}</small><strong>${escapeHtml(serviceStatusLabel(item.status))}</strong><span>${escapeHtml(item.detail || '—')}</span></div></article>`).join('') : '<article class="mobile-panel-card"><small>DIAGNÓSTICO</small><strong>Sem resultados</strong></article>';
}

async function runDiagnostics(showMessage = true) {
  const btn = $('#runDiagnosticsBtn');
  const mobileBtn = $('#mobileRunDiagnosticsBtn');
  btn?.setAttribute('disabled','disabled');
  mobileBtn?.setAttribute('disabled','disabled');
  if ($('#diagnosticsMeta')) $('#diagnosticsMeta').textContent = 'Testando conexões…';
  try {
    const res = await fetch('/api/diagnostics', { cache:'no-store' });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha no diagnóstico');
    renderDiagnostics(data);
    const failed = (data.services || []).filter(item => item.status === 'offline').length;
    if (showMessage) showToast(failed ? `Diagnóstico concluído: ${failed} item(ns) com falha.` : 'Diagnóstico concluído: tudo certo.', Boolean(failed));
  } catch (error) {
    if ($('#diagnosticsMeta')) $('#diagnosticsMeta').textContent = error.message;
    if (showMessage) showToast(error.message, true);
  } finally { btn?.removeAttribute('disabled'); mobileBtn?.removeAttribute('disabled'); }
}

async function loadProfiles() {
  const selects = [$('#profileSelect'), $('#mobileProfileSelect')].filter(Boolean);
  const statuses = [$('#profileStatus'), $('#mobileProfileStatus')].filter(Boolean);
  try {
    const res = await fetch('/api/profiles', { cache:'no-store' });
    const data = await res.json();
    activeProfile = data.activeProfile || activeProfile || 'Principal';
    const profiles = Array.isArray(data.profiles) ? data.profiles : [];
    const html = profiles.length
      ? profiles.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('')
      : `<option value="${escapeHtml(activeProfile)}">${escapeHtml(activeProfile)} (ainda não salvo)</option>`;
    selects.forEach(select => {
      const previous = select.value;
      select.innerHTML = html;
      if ([...select.options].some(o => o.value === activeProfile)) select.value = activeProfile;
      else if ([...select.options].some(o => o.value === previous)) select.value = previous;
    });
    const text = `Perfil ativo: ${activeProfile}${profiles.length ? ` • ${profiles.length} salvo(s)` : ' • salve o atual para criar o primeiro snapshot'}`;
    statuses.forEach(status => status.textContent = text);
  } catch (error) {
    statuses.forEach(status => status.textContent = `Perfis: ${error.message}`);
  }
}

function selectedProfileName() {
  if ($('[data-panel-page="system"]')?.classList.contains('active') && $('#mobileProfileSelect')?.value) return $('#mobileProfileSelect').value;
  return $('#profileSelect')?.value || $('#mobileProfileSelect')?.value || activeProfile || 'Principal';
}

async function profileAction(action, name) {
  const res = await fetch('/api/profiles', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, name }),
  });
  const data = await res.json();
  if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha ao alterar perfil');
  activeProfile = data.activeProfile || activeProfile;
  await loadProfiles();
  return data;
}

async function createProfile() {
  const name = prompt('Nome do novo perfil:', activeProfile === 'Principal' ? 'Igreja' : activeProfile);
  if (!name) return;
  try { await profileAction('create', name); showToast(`Perfil ${name} salvo.`); }
  catch (error) { showToast(error.message, true); }
}

async function saveCurrentProfile() {
  const name = selectedProfileName();
  try { await profileAction('save', name); showToast(`Perfil ${name} atualizado.`); }
  catch (error) { showToast(error.message, true); }
}

async function switchProfile() {
  const name = selectedProfileName();
  if (!name) return showToast('Escolha um perfil.', true);
  if (!confirm(`Carregar o perfil "${name}"? A configuração atual será substituída pelos dados salvos nesse perfil.`)) return;
  try {
    await profileAction('switch', name);
    await loadConfig();
    await Promise.all([fetchStatus(true), fetchFavorites(true), fetchObsState(true, true), fetchAutomation(true)]);
    showToast(`Perfil ${name} carregado.`);
  } catch (error) { showToast(error.message, true); }
}

async function deleteProfile() {
  const name = selectedProfileName();
  if (!name) return;
  if (!confirm(`Excluir o perfil salvo "${name}"?`)) return;
  try { await profileAction('delete', name); showToast(`Perfil ${name} excluído.`); }
  catch (error) { showToast(error.message, true); }
}

async function exportBackup() {
  const includeSecrets = Boolean($('#backupIncludeSecretsInput')?.checked || $('#mobileBackupIncludeSecrets')?.checked);
  if (includeSecrets && !confirm('Este backup incluirá token do Holyrics, senha do OBS e segredo do Bridge. Guarde o arquivo em local seguro. Continuar?')) return;
  try {
    const res = await fetch('/api/backup/export', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ includeSecrets }) });
    if (!res.ok) {
      let data = {}; try { data = await res.json(); } catch {}
      throw new Error(data.error || 'Falha ao exportar backup');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] || 'worship-deck-backup.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(includeSecrets ? 'Backup completo exportado.' : 'Backup sem segredos exportado.');
  } catch (error) { showToast(error.message, true); }
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!confirm('Importar este backup? As configurações presentes no arquivo substituirão as atuais.')) return;
    const res = await fetch('/api/backup/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha ao importar backup');
    await loadConfig();
    await loadProfiles();
    await Promise.all([fetchStatus(true), fetchFavorites(true), fetchObsState(true, true), fetchAutomation(true)]);
    showToast('Backup importado com sucesso.');
  } catch (error) { showToast(`Backup inválido: ${error.message}`, true); }
  finally { if ($('#backupFileInput')) $('#backupFileInput').value = ''; if ($('#mobileBackupFileInput')) $('#mobileBackupFileInput').value = ''; }
}


// ---------------------------------------------------------------------------
// Tour guiado por dispositivo
// ---------------------------------------------------------------------------
// Para cada recurso novo que mereça apresentação, basta adicionar um item com
// um ID NOVO em FEATURE_TOUR_DEFINITIONS. O aparelho guarda os IDs já vistos e
// só apresenta as novidades. Não é necessário aumentar a versão do tour básico.
const FEATURE_TOUR_DEFINITIONS = [
  {
    id: 'alpha3.2-guided-tours',
    title: 'Novo: ajuda guiada por aparelho',
    text: 'Agora o Deck pode apresentar funções novas sem repetir todo o primeiro acesso. Tours básicos e avançados também podem ser refeitos em Sistema.',
    setup: () => { showMobileView('panel', false); showMobilePanelTab('system'); closeMobileDrawer(); },
    target: '#mobileTourTools'
  }
];

const BASIC_TOUR_STEPS = [
  {
    title: 'Bem-vindo ao Worship Deck',
    text: 'Este celular vai receber um tour rápido das funções de operação. O tour apenas apresenta a interface: ele não altera cenas, senhas nem configurações.',
    target: null,
    setup: () => { showMobileView('controls', false); closeMobileDrawer(); }
  },
  {
    title: 'Quick Deck',
    text: 'Aqui ficam os botões grandes para operação rápida: anterior, próximo, normal, fundo, vazia, preta e os controles que você personalizar.',
    target: '#mobileControlsPager',
    setup: () => { showMobileView('controls', false); closeMobileDrawer(); }
  },
  {
    title: 'Atalhos rápidos',
    text: 'DECK, FAV e OBS são atalhos para as áreas usadas o tempo todo. O tour destaca primeiro o botão e depois mostra a página, para você aprender também o caminho.',
    target: '.mobile-tabs',
    setup: () => { showMobileView('controls', false); closeMobileDrawer(); }
  },
  {
    title: 'Onde ficam os Favoritos',
    text: 'Toque em FAV no topo quando quiser abrir os Favoritos do Holyrics.',
    target: '[data-mobile-tab="favorites"]',
    setup: () => { showMobileView('controls', false); closeMobileDrawer(); }
  },
  {
    title: 'Favoritos',
    text: 'Os Favoritos vêm do Holyrics e podem ser acionados diretamente pelo celular. Ícone, nome, cor, ordem e visibilidade podem ser personalizados.',
    target: '#mobileFavoritesPager',
    setup: () => { showMobileView('favorites', false); closeMobileDrawer(); }
  },
  {
    title: 'Onde fica o OBS',
    text: 'Toque em OBS no topo para abrir as cenas da transmissão.',
    target: '[data-mobile-tab="obs"]',
    setup: () => { showMobileView('favorites', false); closeMobileDrawer(); }
  },
  {
    title: 'Cenas do OBS',
    text: 'Aqui você troca as cenas do OBS. O Worship Agent pode localizar automaticamente o PC da live mesmo quando o endereço IP mudar.',
    target: '#mobileObsPager',
    setup: () => { showMobileView('obs', false); closeMobileDrawer(); }
  },
  {
    title: 'Menu principal',
    text: 'Este botão abre a barra lateral. É por ela que você chega ao Agora / Letras e a todas as funções avançadas.',
    target: '#mobileMenuBtn',
    setup: () => { showMobileView('controls', false); closeMobileDrawer(); }
  },
  {
    title: 'Onde fica Agora / Letras',
    text: 'Na barra lateral, este é o botão para acompanhar o que está sendo apresentado, as próximas letras e o monitor escolhido.',
    target: '[data-mobile-nav="now"]',
    setup: () => { showMobileView('controls', false); openMobileDrawer(); }
  },
  {
    title: 'Agora / Letras / Monitor',
    text: 'Esta tela reúne o conteúdo atual, próximo e seguinte quando o Holyrics fornece os slides, além do monitor escolhido: Holyrics, OBS ou YouTube.',
    target: '#mobileNowView',
    setup: () => { showMobileView('now', false); closeMobileDrawer(); }
  },
  {
    title: 'Central do Deck',
    text: 'Ao abrir novamente o menu, você encontra Status, Diretor, Conexões, Sistema e Visual. O tour avançado mostra o caminho de cada uma dessas áreas.',
    target: '.mobile-drawer-mini-grid-wide',
    setup: () => { showMobileView('controls', false); openMobileDrawer(); }
  },
  {
    title: 'Tour básico concluído',
    text: 'Você já conhece o necessário para operar. Se quiser, continue para um tour das opções avançadas; caso contrário, entre direto no Quick Deck.',
    target: null,
    setup: () => { closeMobileDrawer(); showMobileView('controls', false); }
  }
];

const ADVANCED_TOUR_STEPS = [
  {
    title: 'Funções avançadas',
    text: 'Agora vamos percorrer a Central. Primeiro o Deck abre a barra lateral e destaca o botão que leva à função; no passo seguinte ele abre a página e explica o conteúdo.',
    target: null,
    setup: () => { showMobileView('controls', false); closeMobileDrawer(); }
  },
  {
    title: 'Onde fica Status',
    text: 'Na Central, toque em Status para conferir rapidamente o estado do culto e das conexões principais.',
    target: '[data-mobile-panel="status"]',
    setup: () => { showMobileView('controls', false); openMobileDrawer(); }
  },
  {
    title: 'Status',
    text: 'Mostra rapidamente se Holyrics e OBS estão conectados, qual apresentação está ativa e qual cena está no ar.',
    target: '[data-panel-page="status"] .mobile-panel-status-grid',
    setup: () => { showMobileView('panel', false); showMobilePanelTab('status'); closeMobileDrawer(); }
  },
  {
    title: 'Onde fica o Diretor',
    text: 'Abra a Central e toque em Diretor para configurar as trocas automáticas entre Holyrics e OBS.',
    target: '[data-mobile-panel="director"]',
    setup: () => { showMobileView('controls', false); openMobileDrawer(); }
  },
  {
    title: 'Diretor automático',
    text: 'Aqui você define quais cenas o OBS usa para Música, Bíblia, ausência de apresentação e Favoritos especiais.',
    target: '[data-panel-page="director"] .mobile-panel-card',
    setup: () => { showMobileView('panel', false); showMobilePanelTab('director'); closeMobileDrawer(); }
  },
  {
    title: 'Onde ficam as Conexões',
    text: 'Abra a Central e toque em Conexões quando precisar instalar, testar ou corrigir Holyrics, OBS, Agent ou Web/Bridge.',
    target: '[data-mobile-panel="connections"]',
    setup: () => { showMobileView('controls', false); openMobileDrawer(); }
  },
  {
    title: 'Conexões',
    text: 'Reúne Holyrics, Plugin, OBS, Worship Agent, Web/Bridge e rede local. É a área técnica para instalar ou corrigir uma conexão.',
    target: '[data-panel-page="connections"] .mobile-panel-card',
    setup: () => { showMobileView('panel', false); showMobilePanelTab('connections'); closeMobileDrawer(); }
  },
  {
    title: 'Onde fica Sistema',
    text: 'Abra a Central e toque em Sistema para acessar diagnóstico, perfis, backup, assistentes e os próprios tours.',
    target: '[data-mobile-panel="system"]',
    setup: () => { showMobileView('controls', false); openMobileDrawer(); }
  },
  {
    title: 'Sistema',
    text: 'Diagnóstico, Perfis, Backup e os assistentes ficam aqui. É a área indicada antes de trocar ou formatar um computador.',
    target: '[data-panel-page="system"]',
    setup: () => { showMobileView('panel', false); showMobilePanelTab('system'); closeMobileDrawer(); }
  },
  {
    title: 'Onde fica Visual',
    text: 'Abra a Central e toque em Visual para mudar tema, grade, monitor e aparência dos botões.',
    target: '[data-mobile-panel="visual"]',
    setup: () => { showMobileView('controls', false); openMobileDrawer(); }
  },
  {
    title: 'Visual',
    text: 'Tema, grade, tela inicial, monitor e aparência de controles, favoritos e cenas podem ser personalizados. As alterações visuais são salvas automaticamente.',
    target: '[data-panel-page="visual"] .mobile-visual-card',
    setup: () => { showMobileView('panel', false); showMobilePanelTab('visual'); closeMobileDrawer(); }
  },
  {
    title: 'Monitor flutuante',
    text: 'Dentro de Visual você pode abrir uma mini tela sobre o Deck, arrastar com um dedo e redimensionar. Ela pode exibir Holyrics, OBS ou YouTube.',
    target: '#mobilePanelFloatingBtn',
    setup: () => { showMobileView('panel', false); showMobilePanelTab('visual'); closeMobileDrawer(); }
  },
  {
    title: 'Pronto',
    text: 'Agora você conhece toda a estrutura e também sabe onde cada função fica no menu. O tour pode ser reaberto em Central → Sistema → Ajuda e tours.',
    target: null,
    setup: () => { showMobileView('controls', false); closeMobileDrawer(); }
  }
];

function currentFeatureTourSteps() {
  const seen = getSeenFeatureTours();
  return FEATURE_TOUR_DEFINITIONS.filter(item => !seen.has(item.id)).map(item => ({ ...item, featureId:item.id }));
}

function markCurrentFeaturesSeen(steps = FEATURE_TOUR_DEFINITIONS) {
  const seen = getSeenFeatureTours();
  steps.forEach(item => { if (item.featureId || item.id) seen.add(item.featureId || item.id); });
  saveSeenFeatureTours(seen);
}

function setTourUiVisible(visible) {
  const blocker = $('#guidedTourBlocker');
  const spotlight = $('#guidedTourSpotlight');
  const card = $('#guidedTourCard');
  blocker?.classList.toggle('hidden', !visible);
  spotlight?.classList.toggle('hidden', !visible);
  card?.classList.toggle('hidden', !visible);
  if (blocker) {
    blocker.style.pointerEvents = visible ? 'auto' : 'none';
    blocker.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }
  if (spotlight) spotlight.setAttribute('aria-hidden', visible ? 'false' : 'true');
  document.documentElement.classList.toggle('guided-tour-active', visible);
}

function releaseGuidedTourNavigation() {
  guidedTourRenderRevision += 1; // invalida qualquer spotlight ainda aguardando animação
  // Limpeza defensiva: nenhum overlay do tour ou backdrop do menu pode continuar
  // capturando toques depois de SAIR, CONCLUIR ou trocar para o tour avançado.
  setTourUiVisible(false);
  clearTourSpotlight();
  closeMobileDrawer();
  $('#mobileDrawerBackdrop')?.classList.remove('open');
  document.documentElement.classList.remove('guided-tour-active');
  const blocker = $('#guidedTourBlocker');
  if (blocker) blocker.style.pointerEvents = 'none';
  setTimeout(() => {
    $('#guidedTourBlocker')?.classList.add('hidden');
    $('#guidedTourSpotlight')?.classList.add('hidden');
    $('#guidedTourCard')?.classList.add('hidden');
    $('#mobileDrawerBackdrop')?.classList.remove('open');
  }, 60);
}

function clearTourSpotlight() {
  const spot = $('#guidedTourSpotlight');
  if (!spot) return;
  spot.classList.add('no-target');
  spot.style.left = '50%'; spot.style.top = '50%'; spot.style.width = '0'; spot.style.height = '0';
}

function getActiveMobileViewKey() {
  const active = $('.mobile-view.active');
  const map = {
    mobileControlsView:'controls',
    mobileFavoritesView:'favorites',
    mobileObsView:'obs',
    mobileNowView:'now',
    mobilePanelView:'panel',
  };
  return map[active?.id] || 'controls';
}

function captureGuidedTourOrigin() {
  const scrollables = [
    ...$$('.mobile-pager'),
    ...$$('.mobile-panel-view'),
    ...$$('.mobile-now-view'),
    ...$$('.mobile-drawer'),
  ];
  return {
    view:getActiveMobileViewKey(),
    panelTab:mobilePanelTab,
    drawerOpen:Boolean($('#mobileDrawer')?.classList.contains('open')),
    windowX:window.scrollX || 0,
    windowY:window.scrollY || 0,
    scrolls:scrollables.map(el => ({ el, top:el.scrollTop || 0, left:el.scrollLeft || 0 })),
  };
}

function restoreGuidedTourOrigin(origin) {
  if (!origin) {
    window.scrollTo({ left:0, top:0, behavior:'auto' });
    return;
  }
  showMobileView(origin.view || 'controls', false);
  if ((origin.view || 'controls') === 'panel') showMobilePanelTab(origin.panelTab || 'status');
  if (origin.drawerOpen) openMobileDrawer();
  else closeMobileDrawer();

  // O tour pode precisar rolar painéis para destacar itens. Essa rolagem é
  // apenas didática e nunca deve virar a nova posição permanente da página.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    (origin.scrolls || []).forEach(item => {
      if (!item?.el?.isConnected) return;
      item.el.scrollTo({ top:item.top || 0, left:item.left || 0, behavior:'auto' });
    });
    window.scrollTo({ left:origin.windowX || 0, top:origin.windowY || 0, behavior:'auto' });
  }));
}

function findTourScrollContainer(target) {
  let node = target?.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const yScrollable = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
    const xScrollable = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2;
    if (yScrollable || xScrollable) return node;
    node = node.parentElement;
  }
  return null;
}

async function bringTourTargetIntoView(target) {
  const container = findTourScrollContainer(target);
  if (!container) return;
  const cr = container.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  let nextTop = container.scrollTop;
  let nextLeft = container.scrollLeft;

  if (container.scrollHeight > container.clientHeight + 2) {
    const targetCenter = tr.top + tr.height / 2;
    const containerCenter = cr.top + cr.height / 2;
    nextTop += targetCenter - containerCenter;
  }
  if (container.scrollWidth > container.clientWidth + 2) {
    const targetCenter = tr.left + tr.width / 2;
    const containerCenter = cr.left + cr.width / 2;
    nextLeft += targetCenter - containerCenter;
  }

  container.scrollTo({ top:Math.max(0,nextTop), left:Math.max(0,nextLeft), behavior:'smooth' });
  await new Promise(resolve => setTimeout(resolve, 240));
}

function positionTourCardForRect(rect) {
  const card = $('#guidedTourCard');
  if (!card) return;
  card.classList.remove('tour-card-top','tour-card-bottom');
  if (rect && rect.top > (window.innerHeight || 700) * .52) card.classList.add('tour-card-top');
  else card.classList.add('tour-card-bottom');
}

async function spotlightTourTarget(selector) {
  if (!selector) { clearTourSpotlight(); positionTourCardForRect(null); return; }
  let target = $(selector);
  if (!target) { clearTourSpotlight(); positionTourCardForRect(null); return; }
  await bringTourTargetIntoView(target);
  target = $(selector);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const pad = 6;
  const left = Math.max(6, r.left - pad);
  const top = Math.max(6, r.top - pad);
  const width = Math.max(28, Math.min((window.innerWidth || 360) - left - 6, r.width + pad*2));
  const height = Math.max(28, Math.min((window.innerHeight || 700) - top - 6, r.height + pad*2));
  const spot = $('#guidedTourSpotlight');
  if (spot) {
    spot.classList.remove('no-target');
    spot.style.left = `${left}px`; spot.style.top = `${top}px`; spot.style.width = `${width}px`; spot.style.height = `${height}px`;
  }
  positionTourCardForRect({ top, height });
}

async function renderGuidedTourStep() {
  if (!guidedTour.active || !guidedTour.steps.length) return;
  const renderRevision = ++guidedTourRenderRevision;
  const step = guidedTour.steps[guidedTour.step];
  if (!step) return;
  if (typeof step.setup === 'function') await step.setup();
  if (!guidedTour.active || renderRevision !== guidedTourRenderRevision) return;
  const kicker = $('#guidedTourKicker');
  const title = $('#guidedTourTitle');
  const text = $('#guidedTourText');
  const counter = $('#guidedTourCounter');
  if (kicker) kicker.textContent = guidedTour.type === 'basic' ? 'TOUR BÁSICO' : guidedTour.type === 'advanced' ? 'TOUR AVANÇADO' : 'NOVIDADE';
  if (title) title.textContent = step.title || 'Worship Deck';
  if (text) text.textContent = step.text || '';
  if (counter) counter.textContent = `${guidedTour.step + 1} / ${guidedTour.steps.length}`;
  $('#guidedTourBackBtn')?.classList.toggle('hidden', guidedTour.step === 0);
  const isLast = guidedTour.step === guidedTour.steps.length - 1;
  const next = $('#guidedTourNextBtn');
  if (next) next.textContent = isLast ? (guidedTour.type === 'basic' ? 'CONCLUIR BÁSICO' : 'CONCLUIR') : 'PRÓXIMO';
  $('#guidedTourChoice')?.classList.add('hidden');
  $('#guidedTourActions')?.classList.remove('hidden');
  setTourUiVisible(true);
  await spotlightTourTarget(step.target);
  if (!guidedTour.active || renderRevision !== guidedTourRenderRevision) return;
}

function startGuidedTour(type = 'basic', options = {}) {
  if (!isMobileDeckDevice()) return;
  const steps = type === 'advanced' ? ADVANCED_TOUR_STEPS : type === 'features' ? (options.steps || currentFeatureTourSteps()) : BASIC_TOUR_STEPS;
  if (!steps.length) { showToast('Nenhuma novidade de interface pendente neste aparelho.'); return; }
  const origin = options.origin || captureGuidedTourOrigin();
  guidedTour = { active:true, type, step:0, steps, firstRun:Boolean(options.firstRun), origin };
  closeMobileDrawer();
  renderGuidedTourStep();
}

function finishGuidedTour(closeOnly = false) {
  const completedType = guidedTour.type;
  const completedSteps = guidedTour.steps;
  const wasFirstRun = guidedTour.firstRun;
  const origin = guidedTour.origin;
  if (!closeOnly) {
    if (completedType === 'basic') {
      markTourDone(BASIC_TOUR_KEY);
      markDeviceOnboardingComplete();
      // Um aparelho novo não precisa receber logo depois avisos de recursos que
      // já foram apresentados no tour inicial.
      markCurrentFeaturesSeen(FEATURE_TOUR_DEFINITIONS);
    } else if (completedType === 'advanced') {
      markTourDone(ADVANCED_TOUR_KEY);
    } else if (completedType === 'features') {
      markCurrentFeaturesSeen(completedSteps);
    }
  } else {
    // "Sair" não vira um lembrete infinito: em primeiro acesso significa
    // pular o tour neste aparelho; em novidades significa dispensar a novidade.
    if (completedType === 'basic' && wasFirstRun) {
      markTourDone(BASIC_TOUR_KEY);
      markDeviceOnboardingComplete();
      markCurrentFeaturesSeen(FEATURE_TOUR_DEFINITIONS);
    } else if (completedType === 'features') {
      markCurrentFeaturesSeen(completedSteps);
    }
  }
  guidedTour = { active:false, type:'', step:0, steps:[], firstRun:false, origin:null };
  releaseGuidedTourNavigation();
  restoreGuidedTourOrigin(origin);
  if (closeOnly) showToast('Tour fechado. A navegação e a posição da página foram restauradas.');
}

function showBasicTourCompletionChoice() {
  markTourDone(BASIC_TOUR_KEY);
  markDeviceOnboardingComplete();
  markCurrentFeaturesSeen(FEATURE_TOUR_DEFINITIONS);
  $('#guidedTourActions')?.classList.add('hidden');
  $('#guidedTourChoice')?.classList.remove('hidden');
  clearTourSpotlight();
  positionTourCardForRect(null);
}

function nextGuidedTourStep() {
  if (!guidedTour.active) return;
  if (guidedTour.step < guidedTour.steps.length - 1) {
    guidedTour.step += 1;
    renderGuidedTourStep();
    return;
  }
  if (guidedTour.type === 'basic') showBasicTourCompletionChoice();
  else finishGuidedTour(false);
}

function previousGuidedTourStep() {
  if (!guidedTour.active || guidedTour.step <= 0) return;
  guidedTour.step -= 1;
  renderGuidedTourStep();
}

function maybeStartNewFeatureTour() {
  if (!isMobileDeckDevice() || guidedTour.active || !deviceOnboardingComplete()) return;
  const steps = currentFeatureTourSteps();
  if (steps.length) startGuidedTour('features', { steps });
}

function renderWizardStep() {
  $$('.wizard-step').forEach(el => el.classList.toggle('active', Number(el.dataset.wizardStep) === wizardStep));
  $$('[data-wizard-progress]').forEach(el => el.classList.toggle('active', Number(el.dataset.wizardProgress) <= wizardStep));
  $('#wizardBackBtn')?.classList.toggle('hidden', wizardStep === 1);
  $('#wizardNextBtn')?.classList.toggle('hidden', wizardStep === 4);
  $('#wizardFinishBtn')?.classList.toggle('hidden', wizardStep !== 4);
}

async function openWizard() {
  try {
    const cfg = await loadConfig();
    await fetchAgents(false, cfg.obsAgentId || '');
    const set = (id, value) => { const el = $(id); if (el) el.value = value ?? ''; };
    set('#wizardHolyricsHost', cfg.holyricsHost || '127.0.0.1');
    set('#wizardHolyricsPort', cfg.holyricsPort || 8091);
    set('#wizardPluginHost', cfg.pluginHost || '127.0.0.1');
    set('#wizardPluginPort', cfg.pluginPort || 2026);
    set('#wizardObsHost', cfg.obsHost || '127.0.0.1');
    set('#wizardObsPort', cfg.obsPort || 4455);
    if ($('#wizardObsAutoDiscover')) $('#wizardObsAutoDiscover').checked = Boolean(cfg.obsAutoDiscover);
    set('#wizardMobileTheme', cfg.mobileTheme || 'dark');
    set('#wizardMobileDefaultView', cfg.mobileDefaultView || 'controls');
    set('#wizardLandscapeCols', cfg.mobileLandscapeCols || 5);
    set('#wizardLandscapeRows', cfg.mobileLandscapeRows || 2);
    if ($('#wizardShowTabs')) $('#wizardShowTabs').checked = cfg.mobileShowTabs !== false;
    $('#wizardHolyricsToken').value = '';
    $('#wizardObsPassword').value = '';
    $('#wizardHolyricsToken').placeholder = cfg.tokenConfigured ? 'Token já salvo — deixe vazio para manter' : 'Cole o token criado no Holyrics';
    $('#wizardObsPassword').placeholder = cfg.obsPasswordConfigured ? 'Senha já salva — deixe vazio para manter' : 'Senha configurada no OBS';
    const hint = $('#wizardAgentHint');
    if (hint) hint.textContent = discoveredAgents.length
      ? `${discoveredAgents.length} Worship Agent(s) encontrado(s): ${discoveredAgents.map(a => `${a.name} (${a.address}:${a.obsPort})`).join(', ')}`
      : 'Nenhum Agent detectado agora. Você ainda pode usar o IP manual e ativar a descoberta depois.';
    wizardStep = 1;
    renderWizardStep();
    wizardDialog?.showModal();
  } catch (error) { showToast(error.message, true); }
}

async function finishWizard() {
  const payload = {
    holyricsHost: $('#wizardHolyricsHost').value.trim() || '127.0.0.1',
    holyricsPort: Number($('#wizardHolyricsPort').value || 8091),
    pluginHost: $('#wizardPluginHost').value.trim() || '127.0.0.1',
    pluginPort: Number($('#wizardPluginPort').value || 2026),
    obsHost: $('#wizardObsHost').value.trim() || '127.0.0.1',
    obsPort: Number($('#wizardObsPort').value || 4455),
    obsAutoDiscover: Boolean($('#wizardObsAutoDiscover').checked),
    mobileTheme: $('#wizardMobileTheme').value || 'dark',
    mobileDefaultView: $('#wizardMobileDefaultView').value || 'controls',
    mobileLandscapeCols: Number($('#wizardLandscapeCols').value || 5),
    mobileLandscapeRows: Number($('#wizardLandscapeRows').value || 2),
    mobileShowTabs: Boolean($('#wizardShowTabs').checked),
    onboardingComplete: true,
  };
  const token = $('#wizardHolyricsToken').value.trim(); if (token) payload.token = token;
  const obsPassword = $('#wizardObsPassword').value; if (obsPassword) payload.obsPassword = obsPassword;
  try {
    const res = await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Falha ao concluir assistente');
    onboardingComplete = true;
    wizardDialog?.close();
    await loadConfig();
    await Promise.all([fetchStatus(true), fetchFavorites(true), fetchObsState(true, true), fetchAutomation(true)]);
    await loadProfiles();
    showToast('Primeiro acesso concluído. Worship Deck pronto.');
    setTimeout(() => runDiagnostics(false), 250);
  } catch (error) { showToast(error.message, true); }
}

document.addEventListener('focusin', (event) => {
  // O foco impede o polling de reconstruir um seletor enquanto a lista está aberta.
  if (isAutomationEditorControl(event.target)) renderAutomationStatus();
});

document.addEventListener('input', (event) => {
  if (isAutomationEditorControl(event.target)) automationEditorDirty = true;
});

document.addEventListener('change', (event) => {
  if (isAutomationEditorControl(event.target)) automationEditorDirty = true;
});

bindControlButtons();
renderMobileCore();

$('#settingsBtn').addEventListener('click', async () => {
  await loadConfig();
  await loadNetworkAddresses(false);
  dialog.showModal();
});

$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await saveConfig(true);
    showToast('Configurações salvas.');
    fetchStatus(true);
    fetchFavorites(true);
    fetchObsState(true, true);
  } catch (error) { showToast(error.message, true); }
});

$('#testBtn').addEventListener('click', async () => {
  try {
    await saveConfig(false);
    await fetchStatus(false);
    await fetchFavorites(true);
  } catch (error) { showToast(error.message, true); }
});

$('#testObsBtn').addEventListener('click', async () => {
  try {
    await saveConfig(false);
    await fetchObsState(false, true);
  } catch (error) { showToast(error.message, true); }
});

$('#refreshFavoritesBtn').addEventListener('click', () => fetchFavorites(false));
$('#refreshObsBtn').addEventListener('click', () => fetchObsState(false, true));
$('#refreshObsPreviewsBtn')?.addEventListener('click', refreshObsPreviews);
$('#refreshPreviewBtn').addEventListener('click', () => { reloadPreview(); showToast('Preview recarregado.'); });
$('#refreshNetworkBtn')?.addEventListener('click', () => loadNetworkAddresses(true));
$('#refreshAgentsBtn')?.addEventListener('click', () => fetchAgents(true));
$('#saveAutomationBtn')?.addEventListener('click', () => saveAutomation().catch(error => showToast(error.message, true)));
$('#resumeAutomationBtn')?.addEventListener('click', () => resumeAutomation().catch(error => showToast(error.message, true)));

let lastMobilePageSize = mobilePageSize();
window.addEventListener('resize', () => {
  updatePreview();
  updateObsProgramPreview(false);
  if (floatingMonitorVisible) { applyFloatingRect(floatingMonitorRect || loadFloatingRect()); saveFloatingRect(); }
  const nextSize = mobilePageSize();
  if (nextSize !== lastMobilePageSize) {
    lastMobilePageSize = nextSize;
    renderMobileCore();
  }
  if (guidedTour.active) setTimeout(() => spotlightTourTarget(guidedTour.steps[guidedTour.step]?.target), 80);
});

$$('[data-mobile-tab]').forEach(btn => btn.addEventListener('click', () => showMobileView(btn.dataset.mobileTab)));
$$('[data-mobile-nav]').forEach(btn => btn.addEventListener('click', () => showMobileView(btn.dataset.mobileNav)));
$$('[data-mobile-panel]').forEach(btn => btn.addEventListener('click', () => { showMobileView('panel'); showMobilePanelTab(btn.dataset.mobilePanel); }));
$('#mobileMenuBtn')?.addEventListener('click', openMobileDrawer);
$('#mobilePanelMenuBtn')?.addEventListener('click', openMobileDrawer);
$('#mobileDrawerBackdrop')?.addEventListener('click', closeMobileDrawer);
$$('[data-display-mode]').forEach(btn => btn.addEventListener('click', () => { closeMobileDrawer(); setDisplayModeAndReload(btn.dataset.displayMode); }));
$('#returnToMobileBtn')?.addEventListener('click', () => setDisplayModeAndReload('auto'));
$('#mobileMonitorSelect')?.addEventListener('change', event => { mobileSettings.monitorMode = event.target.value; syncMobileVisualInputs(); renderMobileMonitor(true); queueMobileAutoSave(220); });
$('#mobileThemeSelect')?.addEventListener('change', event => { mobileSettings.theme = event.target.value; syncMobileVisualInputs(); applyMobileTheme(); queueMobileAutoSave(220); });
$('#openFloatingMonitorBtn')?.addEventListener('click', openFloatingMonitor);
$('#mobilePanelFloatingBtn')?.addEventListener('click', openFloatingMonitor);
$('#floatingMonitorCloseBtn')?.addEventListener('click', closeFloatingMonitor);
$('#floatingMonitorResetBtn')?.addEventListener('click', resetFloatingMonitor);
$('#mobileOpenNowBtn')?.addEventListener('click', () => showMobileView('now'));
$('#mobileRunDiagnosticsBtn')?.addEventListener('click', () => runDiagnostics(true));
$('#runDiagnosticsBtn')?.addEventListener('click', () => runDiagnostics(true));
$('#mobileForceAutoBtn')?.addEventListener('click', () => resumeAutomation().catch(error => showToast(error.message, true)));
$('#mobileSaveFavoriteAutomationBtn')?.addEventListener('click', () => saveMobileFavoriteAutomation().catch(error => showToast(error.message, true)));

$('#mobileSaveConnectionsBtn')?.addEventListener('click', () => saveMobileConnections().catch(error => showToast(error.message, true)));
$('#mobileCfgRefreshAgents')?.addEventListener('click', () => fetchAgents(true));
$('#mobileRefreshNetworkBtn')?.addEventListener('click', () => loadNetworkAddresses(true));
$('#mobileTestHolyricsBtn')?.addEventListener('click', async () => {
  try { await saveMobileConnections({ showMessage:false }); await fetchStatus(false); await fetchFavorites(true); showToast('Holyrics conectado.'); }
  catch (error) { showToast(error.message, true); }
});
$('#mobileTestObsBtn')?.addEventListener('click', async () => {
  try { await saveMobileConnections({ showMessage:false }); await fetchObsState(false, true); }
  catch (error) { showToast(error.message, true); }
});
$('#mobileTestWebBtn')?.addEventListener('click', async () => {
  try {
    await saveMobileConnections({ showMessage:false });
    const res = await fetch('/api/cloud/test', { method:'POST' });
    const data = await res.json();
    if (!res.ok || data.status === 'error') throw new Error(data.error || 'Não foi possível conectar à Web');
    showToast('Worship Deck Web conectado.');
  } catch (error) { showToast(error.message, true); }
});
['#mobileAutomationEnabled','#mobileAutoSongScene','#mobileAutoVerseScene','#mobileAutoNoneScene'].forEach(sel => {
  $(sel)?.addEventListener('change', () => saveMobileDirector().catch(error => showToast(error.message, true)));
});
$('#createProfileBtn')?.addEventListener('click', createProfile);
$('#saveProfileBtn')?.addEventListener('click', saveCurrentProfile);
$('#switchProfileBtn')?.addEventListener('click', switchProfile);
$('#deleteProfileBtn')?.addEventListener('click', deleteProfile);
$('#exportBackupBtn')?.addEventListener('click', exportBackup);
$('#importBackupBtn')?.addEventListener('click', () => $('#backupFileInput')?.click());
$('#backupFileInput')?.addEventListener('change', event => importBackupFile(event.target.files?.[0]));
$('#openWizardBtn')?.addEventListener('click', openWizard);
$('#mobileCreateProfileBtn')?.addEventListener('click', createProfile);
$('#mobileSaveProfileBtn')?.addEventListener('click', saveCurrentProfile);
$('#mobileSwitchProfileBtn')?.addEventListener('click', switchProfile);
$('#mobileDeleteProfileBtn')?.addEventListener('click', deleteProfile);
$('#mobileExportBackupBtn')?.addEventListener('click', exportBackup);
$('#mobileImportBackupBtn')?.addEventListener('click', () => $('#mobileBackupFileInput')?.click());
$('#mobileBackupFileInput')?.addEventListener('change', event => importBackupFile(event.target.files?.[0]));
$('#mobileOpenWizardBtn')?.addEventListener('click', openWizard);
$('#closeWizardBtn')?.addEventListener('click', () => wizardDialog?.close());
$('#wizardBackBtn')?.addEventListener('click', () => { wizardStep = Math.max(1, wizardStep - 1); renderWizardStep(); });
$('#wizardNextBtn')?.addEventListener('click', () => { wizardStep = Math.min(4, wizardStep + 1); renderWizardStep(); });
$('#wizardFinishBtn')?.addEventListener('click', finishWizard);


$('#mobileStartBasicTourBtn')?.addEventListener('click', () => startGuidedTour('basic'));
$('#mobileStartAdvancedTourBtn')?.addEventListener('click', () => startGuidedTour('advanced'));
$('#mobileStartWhatsNewTourBtn')?.addEventListener('click', () => startGuidedTour('features'));
$('#guidedTourBackBtn')?.addEventListener('click', previousGuidedTourStep);
$('#guidedTourNextBtn')?.addEventListener('click', nextGuidedTourStep);
$('#guidedTourSkipBtn')?.addEventListener('click', () => finishGuidedTour(true));
$('#guidedTourStartAdvancedBtn')?.addEventListener('click', () => {
  const origin = guidedTour.origin || captureGuidedTourOrigin();
  guidedTour = { active:false, type:'', step:0, steps:[], firstRun:false, origin:null };
  releaseGuidedTourNavigation();
  setTimeout(() => startGuidedTour('advanced', { origin }), 90);
});
$('#guidedTourGoDeckBtn')?.addEventListener('click', () => {
  const origin = guidedTour.origin;
  guidedTour = { active:false, type:'', step:0, steps:[], firstRun:false, origin:null };
  releaseGuidedTourNavigation();
  // O botão diz "ir para o Deck", então abre o Quick Deck já no topo e
  // elimina qualquer deslocamento visual usado apenas pelo tour.
  showMobileView('controls', false);
  $$('.mobile-pager').forEach(el => el.scrollTo({ top:0, left:0, behavior:'auto' }));
  window.scrollTo({ left:0, top:0, behavior:'auto' });
  if (origin?.drawerOpen) closeMobileDrawer();
  showToast('Tour básico concluído.');
});

// Persistência e estabilidade do Modo Deck.
// Uma edição não deve se perder só porque o operador recarregou a página rápido.
window.addEventListener('pagehide', flushMobileAutoSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushMobileAutoSave();
});

// Se o tema estiver em "Seguir aparelho", acompanha a mudança do Android/iOS
// imediatamente, sem exigir recarregar o Deck.
const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: light)');
systemThemeMedia?.addEventListener?.('change', () => {
  if (mobileSettings.theme === 'system') applyMobileTheme();
});

window.addEventListener('pageshow', event => {
  if (event.persisted && !guidedTour.active) releaseGuidedTourNavigation();
  if (floatingMonitorVisible) applyFloatingRect(floatingMonitorRect || loadFloatingRect());
});

window.addEventListener('keydown', (event) => {
  if (dialog.open || wizardDialog?.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (event.key === 'ArrowRight') control('next');
  if (event.key === 'ArrowLeft') control('previous');
  if (event.key.toLowerCase() === 'b') control('blank');
  if (event.key.toLowerCase() === 'k') control('black');
  if (event.key.toLowerCase() === 'n') control('normal');
});

// Limpa estados visuais transitórios antes de restaurar a sessão. Isso também
// protege contra o back/forward cache de navegadores mobile restaurando um
// overlay antigo do tour.
releaseGuidedTourNavigation();

loadConfig().finally(async () => {
  await Promise.all([fetchStatus(true), fetchFavorites(true), fetchObsState(true), fetchAutomation(true), loadProfiles()]);
  const savedMobileView = localStorage.getItem('worshipDeckMobileView');
  showMobileView(['controls','favorites','obs','now','panel'].includes(savedMobileView) ? savedMobileView : (mobileSettings.defaultView || 'controls'), false);
  showMobilePanelTab(mobilePanelTab);
  renderMobileStyleEditors();
  loadFloatingRect();
  applyFloatingRect(floatingMonitorRect);
  renderFloatingMonitor(true);
  bindFloatingMonitorGestures();
  // No PC, o assistente de CONFIGURAÇÃO continua obedecendo ao estado global.
  // No celular/tablet, um aparelho novo recebe primeiro o TOUR DE OPERAÇÃO.
  // O estado fica somente no localStorage daquele navegador.
  if (isMobileDeckDevice() && !deviceOnboardingComplete()) {
    setTimeout(() => startGuidedTour('basic', { firstRun:true }), 550);
  } else if (isMobileDeckDevice()) {
    // Migra silenciosamente o primeiro acesso antigo e mostra apenas recursos
    // realmente novos que este aparelho ainda não viu.
    if (localStorage.getItem(LEGACY_DEVICE_ONBOARDING_KEY) === 'done') markDeviceOnboardingComplete();
    setTimeout(() => maybeStartNewFeatureTour(), 850);
  } else if (!onboardingComplete && !tokenConfigured && desktopPreviewEnabled()) {
    setTimeout(() => openWizard(), 450);
  }
});

setInterval(() => fetchStatus(true), 1800);
setInterval(() => fetchObsState(true), 2200);
setInterval(() => updateObsProgramPreview(false), 1200);
setInterval(() => fetchFavorites(true), 30000);
setInterval(() => fetchAutomation(true), 2400);
setInterval(() => renderMobileMonitor(false), 1500);
setInterval(() => fetchAgents(false), 5000);

$('#testCloudBtn')?.addEventListener('click', testCloudConnection);

['#mobileThemeInput','#mobileDefaultViewInput','#mobileShowTabsInput','#mobileMonitorModeInput','#youtubeVideoIdInput','#mobilePortraitColsInput','#mobilePortraitRowsInput','#mobileLandscapeColsInput','#mobileLandscapeRowsInput'].forEach(sel => {
  $(sel)?.addEventListener('input', () => { updateMobileSettingsFromDesktop(); queueMobileAutoSave(); });
  $(sel)?.addEventListener('change', () => { updateMobileSettingsFromDesktop(); queueMobileAutoSave(260); });
});

['#mobilePanelTheme','#mobilePanelDefaultView','#mobilePanelMonitor','#mobilePanelYoutube','#mobilePanelShowTabs','#mobilePanelPortraitCols','#mobilePanelPortraitRows','#mobilePanelLandscapeCols','#mobilePanelLandscapeRows'].forEach(sel => {
  $(sel)?.addEventListener('input', () => { updateMobileSettingsFromPanel(); queueMobileAutoSave(); });
  $(sel)?.addEventListener('change', () => { updateMobileSettingsFromPanel(); queueMobileAutoSave(260); });
});

