(() => {
  'use strict';

  const DEVICE_ID_KEY = 'worshipDeckDeviceIdV1';
  const DEVICE_NAME_KEY = 'worshipDeckDeviceNameV1';
  const DEVICE_TOKEN_KEY = 'worshipDeckDeviceTokenV1';
  const SESSION_TOKEN_KEY = 'worshipDeckAdminSessionV1';
  const FEATURE_KEY = 'worshipDeckFeatureDevicePairingV1';
  const ROLE_RANK = { guest:0, operator:1, advanced:2, admin:3 };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((b,i) => `${[4,6,8,10].includes(i) ? '-' : ''}${b.toString(16).padStart(2,'0')}`).join('');
  }

  function guessedName() {
    const mobile = window.matchMedia?.('(pointer: coarse)').matches;
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    return `${mobile ? 'Celular / Tablet' : 'Navegador PC'}${platform ? ` • ${platform}` : ''}`.slice(0,80);
  }

  let deviceId = localStorage.getItem(DEVICE_ID_KEY) || uuid();
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  let deviceName = localStorage.getItem(DEVICE_NAME_KEY) || guessedName();
  localStorage.setItem(DEVICE_NAME_KEY, deviceName);
  let deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY) || '';
  let sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || '';
  let securityState = null;
  let statusTimer = null;
  let adminTimer = null;
  let mutationTimer = null;
  let featureShown = localStorage.getItem(FEATURE_KEY) === 'done';

  const baseFetch = window.fetch.bind(window);

  function activeIsLocal() {
    const rt = window.WorshipDeckRuntime;
    if (rt?.connection?.active) return rt.connection.active === 'local';
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(h);
  }

  function isApiInput(input) {
    try {
      if (typeof input === 'string') return input.startsWith('/api/') || /\/api\//.test(new URL(input, location.href).pathname);
      if (input instanceof Request) return new URL(input.url, location.href).pathname.startsWith('/api/');
    } catch (_) {}
    return false;
  }

  function withSecurityHeaders(input, init) {
    if (!activeIsLocal() || !isApiInput(input)) return [input, init];
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Worship-Device-Id', deviceId);
    headers.set('X-Worship-Device-Name', deviceName);
    if (deviceToken) headers.set('X-Worship-Device-Token', deviceToken);
    if (sessionToken) headers.set('X-Worship-Session', sessionToken);
    if (input instanceof Request) return [new Request(input, { headers }), init];
    return [input, { ...(init || {}), headers }];
  }

  window.fetch = function worshipSecurityFetch(input, init) {
    const [nextInput, nextInit] = withSecurityHeaders(input, init);
    return baseFetch(nextInput, nextInit);
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function roleLabel(role) { return ({guest:'NÃO AUTORIZADO',operator:'OPERADOR',advanced:'AVANÇADO',admin:'ADMIN'})[role] || 'NÃO AUTORIZADO'; }
  function roleRank(role) { return ROLE_RANK[role] || 0; }

  async function api(path, options) {
    const res = await fetch(path, { cache:'no-store', ...(options || {}) });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || data.status === 'error') throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function saveClaim(data) {
    if (!data?.claimToken) return false;
    deviceToken = data.claimToken;
    localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
    return true;
  }

  async function refreshSecurity(silent = true) {
    if (!activeIsLocal()) return null;
    try {
      const data = await api('/api/security/status');
      if (saveClaim(data)) securityState = await api('/api/security/status');
      else securityState = data;
      renderSecurity();
      return securityState;
    } catch (error) {
      if (!silent) showSecurityMessage(error.message, true);
      return null;
    }
  }

  function injectStyles() {
    if (document.getElementById('worshipSecurityStyles')) return;
    const style = document.createElement('style');
    style.id = 'worshipSecurityStyles';
    style.textContent = `
      .worship-security-card{border:1px solid rgba(255,255,255,.13);border-radius:14px;padding:14px;display:grid;gap:10px;background:rgba(255,255,255,.035)}
      .worship-security-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .worship-security-badge{font-size:11px;font-weight:800;letter-spacing:.08em;border-radius:999px;padding:6px 9px;background:rgba(255,255,255,.1)}
      .worship-security-badge[data-role="operator"]{background:rgba(34,197,94,.16)}
      .worship-security-badge[data-role="advanced"]{background:rgba(59,130,246,.18)}
      .worship-security-badge[data-role="admin"]{background:rgba(168,85,247,.18)}
      .worship-security-note{font-size:12px;opacity:.75;line-height:1.4}
      .worship-security-actions{display:flex;gap:8px;flex-wrap:wrap}.worship-security-actions button{min-height:38px}
      .worship-security-lock{position:fixed;right:12px;bottom:calc(74px + env(safe-area-inset-bottom));z-index:3300;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:9px 12px;background:rgba(10,12,18,.94);color:inherit;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      .worship-security-lock[data-ok="1"]{display:none}
      .worship-device-list{display:grid;gap:8px}.worship-device-item{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;display:grid;gap:8px}
      .worship-device-meta{font-size:11px;opacity:.7}.worship-online-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#666;margin-right:5px}.worship-online-dot.on{background:#32d583}
      .worship-pair-code{font:800 24px/1.1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em}
      .worship-security-hidden{display:none!important}
      .worship-security-message{font-size:12px;min-height:16px}.worship-security-message.error{color:#ff8b8b}
      @media(min-width:1181px){.worship-security-lock{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function injectMobileCard() {
    const page = document.querySelector('[data-panel-page="connections"]');
    if (!page || document.getElementById('worshipSecurityMobileCard')) return;
    const card = document.createElement('article');
    card.id = 'worshipSecurityMobileCard';
    card.className = 'mobile-panel-card worship-security-card';
    card.innerHTML = `
      <div class="worship-security-row"><div><small>ACESSO DESTE APARELHO</small><strong id="worshipSecurityDeviceName"></strong></div><span id="worshipSecurityRole" class="worship-security-badge">—</span></div>
      <p id="worshipSecurityHint" class="worship-security-note">Verificando autorização…</p>
      <label>Nome deste aparelho<input id="worshipSecurityNameInput" autocomplete="off" maxlength="80"></label>
      <div id="worshipSecurityPasswordArea"><label>Senha administrativa<input id="worshipSecurityPassword" type="password" autocomplete="current-password" placeholder="Senha do Worship Deck"></label><button id="worshipSecurityUnlock" class="mobile-panel-primary" type="button">DESBLOQUEAR</button></div>
      <div id="worshipSecurityPairArea"><label>Código de pareamento<input id="worshipSecurityPairCode" autocomplete="one-time-code" maxlength="12" placeholder="Código mostrado no PC"></label><button id="worshipSecurityRedeem" class="mobile-panel-secondary" type="button">PAREAR</button></div>
      <div id="worshipSecurityMessage" class="worship-security-message"></div>`;
    page.insertBefore(card, page.firstElementChild);
    card.querySelector('#worshipSecurityNameInput').value = deviceName;
    card.querySelector('#worshipSecurityNameInput').addEventListener('change', e => {
      const value = String(e.target.value || '').trim().slice(0,80);
      if (!value) return;
      deviceName = value; localStorage.setItem(DEVICE_NAME_KEY, deviceName); refreshSecurity(false);
    });
    card.querySelector('#worshipSecurityUnlock').addEventListener('click', unlockWithPassword);
    card.querySelector('#worshipSecurityRedeem').addEventListener('click', () => redeemPair(card.querySelector('#worshipSecurityPairCode').value));
  }

  function injectLockButton() {
    if (document.getElementById('worshipSecurityLockButton')) return;
    const btn = document.createElement('button');
    btn.id = 'worshipSecurityLockButton'; btn.className = 'worship-security-lock'; btn.type = 'button'; btn.textContent = '🔒 AUTORIZAR APARELHO';
    btn.addEventListener('click', () => document.querySelector('[data-mobile-panel="connections"]')?.click());
    document.body.appendChild(btn);
  }

  function injectDesktopAdmin() {
    const section = document.getElementById('systemSection');
    if (!section || document.getElementById('worshipSecurityAdminPanel')) return;
    const panel = document.createElement('section');
    panel.id = 'worshipSecurityAdminPanel'; panel.className = 'worship-security-card';
    panel.innerHTML = `
      <div class="worship-security-row"><div><div class="section-kicker">ETAPA 4 • SEGURANÇA</div><h3 style="margin:3px 0">Dispositivos e permissões</h3></div><span id="worshipAdminInstallId" class="worship-security-note"></span></div>
      <div class="worship-security-row"><label style="flex:1;min-width:220px">Senha administrativa<input id="worshipAdminPassword" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres"></label><button id="worshipAdminPasswordSave" class="primary small" type="button">CRIAR / TROCAR SENHA</button></div>
      <p class="worship-security-note">A senha não é salva em texto. O servidor guarda apenas um hash. Dispositivos aprovados recebem uma credencial própria que pode ser revogada.</p>
      <div class="settings-divider"><span>ADICIONAR DISPOSITIVO</span></div>
      <div class="worship-security-row"><label>Permissão<select id="worshipPairRole"><option value="operator">Operador</option><option value="advanced">Avançado</option><option value="admin">Admin</option></select></label><button id="worshipCreatePair" class="secondary small" type="button">GERAR PAREAMENTO</button></div>
      <div id="worshipPairOutput" class="worship-security-note">Gere um pareamento para obter um código temporário de 2 minutos.</div>
      <div class="settings-divider"><span>DISPOSITIVOS VISTOS NA REDE</span></div>
      <div id="worshipDeviceList" class="worship-device-list"><div class="worship-security-note">Carregando…</div></div>
      <div id="worshipAdminMessage" class="worship-security-message"></div>`;
    section.appendChild(panel);
    panel.querySelector('#worshipAdminPasswordSave').addEventListener('click', setupAdminPassword);
    panel.querySelector('#worshipCreatePair').addEventListener('click', createPair);
    panel.querySelector('#worshipDeviceList').addEventListener('click', handleDeviceAction);
    panel.querySelector('#worshipDeviceList').addEventListener('change', handleDeviceRoleChange);
  }

  function showSecurityMessage(message, error = false) {
    for (const id of ['worshipSecurityMessage','worshipAdminMessage']) {
      const el = document.getElementById(id); if (!el) continue; el.textContent = message || ''; el.classList.toggle('error', Boolean(error));
    }
  }

  async function unlockWithPassword() {
    const input = document.getElementById('worshipSecurityPassword'); const password = input?.value || '';
    if (!password) return showSecurityMessage('Digite a senha administrativa.', true);
    try {
      const data = await api('/api/security/unlock', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password}) });
      sessionToken = data.sessionToken || ''; if (sessionToken) sessionStorage.setItem(SESSION_TOKEN_KEY, sessionToken); if (input) input.value = '';
      showSecurityMessage('Acesso administrativo liberado neste navegador por algumas horas.'); await refreshSecurity(false);
    } catch (error) { showSecurityMessage(error.message, true); }
  }

  async function redeemPair(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase(); if (!code) return showSecurityMessage('Informe o código de pareamento.', true);
    try {
      const data = await api('/api/security/pair/redeem', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code}) });
      if (data.deviceToken) { deviceToken = data.deviceToken; localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken); }
      showSecurityMessage(`Pareado como ${roleLabel(data.device?.role)}.`);
      const url = new URL(location.href); url.searchParams.delete('pair'); history.replaceState(null,'',url); await refreshSecurity(false);
    } catch (error) { showSecurityMessage(error.message, true); }
  }

  async function setupAdminPassword() {
    const input = document.getElementById('worshipAdminPassword'); const password = input?.value || '';
    if (password.length < 6) return showSecurityMessage('Use pelo menos 6 caracteres.', true);
    try {
      await api('/api/security/admin/setup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password}) });
      if (input) input.value = ''; showSecurityMessage('Senha administrativa atualizada.'); await refreshSecurity(false);
    } catch (error) { showSecurityMessage(error.message, true); }
  }

  async function createPair() {
    const role = document.getElementById('worshipPairRole')?.value || 'operator';
    try {
      const data = await api('/api/security/pair/create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({role}) });
      const out = document.getElementById('worshipPairOutput');
      if (out) out.innerHTML = `<div class="worship-pair-code">${esc(data.code)}</div><div>Expira em 2 minutos • ${esc(roleLabel(role))}</div>${data.urls?.[0] ? `<div style="word-break:break-all;margin-top:5px">${esc(data.urls[0])}</div>` : ''}<div style="margin-top:5px">O QR gráfico será ligado a este mesmo código; nenhuma senha fica dentro dele.</div>`;
    } catch (error) { showSecurityMessage(error.message, true); }
  }

  async function refreshAdminDevices() {
    if (!securityState || roleRank(securityState.identity?.role) < 3 || !activeIsLocal()) return;
    try {
      const data = await api('/api/security/devices'); const holder = document.getElementById('worshipDeviceList'); if (!holder) return;
      if (!data.devices?.length) { holder.innerHTML = '<div class="worship-security-note">Nenhum celular apareceu ainda. Abra o Worship Deck em um aparelho da mesma rede.</div>'; return; }
      holder.innerHTML = data.devices.map(d => `
        <article class="worship-device-item" data-device-id="${esc(d.id)}"><div class="worship-security-row"><strong>${esc(d.name)}</strong><span class="worship-security-badge" data-role="${esc(d.role)}">${esc(roleLabel(d.role))}</span></div>
        <div class="worship-device-meta"><span class="worship-online-dot ${d.online?'on':''}"></span>${d.online?'Conectado agora':'Offline'} • ${esc(d.ip || 'IP desconhecido')}</div>
        <div class="worship-security-row"><select data-device-role="${esc(d.id)}"><option value="operator" ${d.role==='operator'?'selected':''}>Operador</option><option value="advanced" ${d.role==='advanced'?'selected':''}>Avançado</option><option value="admin" ${d.role==='admin'?'selected':''}>Admin</option></select><div class="worship-security-actions">${d.trusted ? `<button class="secondary small" data-security-action="revoke" data-device="${esc(d.id)}">REVOGAR</button>` : `<button class="primary small" data-security-action="approve" data-device="${esc(d.id)}">APROVAR</button>`}</div></div></article>`).join('');
    } catch (_) {}
  }

  async function handleDeviceAction(event) {
    const btn = event.target.closest('[data-security-action]'); if (!btn) return;
    const id = btn.dataset.device; const action = btn.dataset.securityAction; const role = document.querySelector(`[data-device-role="${CSS.escape(id)}"]`)?.value || 'operator';
    btn.disabled = true;
    try {
      await api(`/api/security/devices/${action === 'approve' ? 'approve' : 'revoke'}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({deviceId:id, role}) });
      showSecurityMessage(action === 'approve' ? 'Dispositivo aprovado. Ele receberá a credencial automaticamente.' : 'Acesso revogado.'); await refreshAdminDevices();
    } catch (error) { showSecurityMessage(error.message, true); } finally { btn.disabled = false; }
  }

  async function handleDeviceRoleChange(event) {
    const select = event.target.closest('[data-device-role]'); if (!select) return;
    const item = select.closest('.worship-device-item'); const badge = item?.querySelector('.worship-security-badge'); if (!item || !badge || badge.dataset.role === 'guest') return;
    try { await api('/api/security/devices/role', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({deviceId:select.dataset.deviceRole, role:select.value}) }); await refreshAdminDevices(); }
    catch (error) { showSecurityMessage(error.message, true); }
  }

  function applyPermissions() {
    if (!securityState) return;
    const role = securityState.identity?.role || 'guest'; const rank = roleRank(role); const canOperate = rank >= 1; const canAdvanced = rank >= 2; const canAdmin = rank >= 3;
    document.querySelectorAll('[data-mobile-panel="director"]').forEach(el => el.classList.toggle('worship-security-hidden', !canAdvanced));
    document.querySelectorAll('[data-mobile-panel="system"]').forEach(el => el.classList.toggle('worship-security-hidden', !canAdmin));
    document.querySelectorAll('[data-mobile-panel="visual"]').forEach(el => el.classList.toggle('worship-security-hidden', rank < 2));
    const connectionPage = document.querySelector('[data-panel-page="connections"]');
    if (connectionPage) [...connectionPage.children].forEach(child => { if (child.id !== 'worshipSecurityMobileCard') child.classList.toggle('worship-security-hidden', !canAdmin); });
    document.querySelectorAll('[data-command], [data-favorite-id], [data-obs-scene]').forEach(el => {
      if (!canOperate) { if (!el.disabled) el.dataset.securityDisabled = '1'; el.disabled = true; }
      else if (el.dataset.securityDisabled === '1') { el.disabled = false; delete el.dataset.securityDisabled; }
    });
    const lock = document.getElementById('worshipSecurityLockButton'); if (lock) lock.dataset.ok = canOperate ? '1' : '0';
  }

  function renderSecurity() {
    if (!securityState) return;
    const identity = securityState.identity || {}; const role = identity.role || 'guest';
    const nameEl = document.getElementById('worshipSecurityDeviceName'); const roleEl = document.getElementById('worshipSecurityRole'); const hint = document.getElementById('worshipSecurityHint');
    const passArea = document.getElementById('worshipSecurityPasswordArea'); const pairArea = document.getElementById('worshipSecurityPairArea');
    if (nameEl) nameEl.textContent = identity.name || deviceName;
    if (roleEl) { roleEl.textContent = roleLabel(role); roleEl.dataset.role = role; }
    if (hint) hint.textContent = identity.loopback ? 'Este navegador está no próprio PC do Worship Deck e tem acesso administrativo local.' : identity.trusted ? `Este aparelho é confiável e entra automaticamente como ${roleLabel(role)}.` : role === 'admin' ? 'Acesso administrativo temporário liberado por senha.' : securityState.adminPasswordConfigured ? 'Aguardando aprovação no PC, senha administrativa ou código de pareamento.' : 'Aguardando o PC criar a primeira senha administrativa ou aprovar este aparelho.';
    if (passArea) passArea.classList.toggle('worship-security-hidden', identity.trusted || identity.loopback || !securityState.adminPasswordConfigured);
    if (pairArea) pairArea.classList.toggle('worship-security-hidden', identity.trusted || identity.loopback);
    const install = document.getElementById('worshipAdminInstallId'); if (install) install.textContent = `Instalação ${String(securityState.installationId || '').slice(0,8)}`;
    const saveBtn = document.getElementById('worshipAdminPasswordSave'); if (saveBtn) saveBtn.textContent = securityState.adminPasswordConfigured ? 'TROCAR SENHA' : 'CRIAR SENHA';
    applyPermissions(); if (roleRank(role) >= 3) refreshAdminDevices();
  }

  function schedulePermissionRefresh() { clearTimeout(mutationTimer); mutationTimer = setTimeout(applyPermissions, 80); }
  function showFeatureOnce() {
    if (featureShown || !securityState || securityState.identity?.loopback) return;
    featureShown = true; localStorage.setItem(FEATURE_KEY, 'done');
    if ((securityState.identity?.role || 'guest') === 'guest') showSecurityMessage('Novo: este aparelho agora pode ser aprovado pelo PC e guardar sua própria permissão.');
  }
  async function redeemPairFromUrl() { const code = new URL(location.href).searchParams.get('pair'); if (code) await redeemPair(code); }

  async function boot() {
    injectStyles(); injectMobileCard(); injectLockButton(); injectDesktopAdmin(); await refreshSecurity(true); await redeemPairFromUrl(); showFeatureOnce();
    clearInterval(statusTimer); statusTimer = setInterval(() => refreshSecurity(true), 5000);
    clearInterval(adminTimer); adminTimer = setInterval(() => refreshAdminDevices(), 5000);
    new MutationObserver(schedulePermissionRefresh).observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();

  window.WorshipDeckSecurity = {
    get deviceId(){ return deviceId; }, get state(){ return securityState; }, refresh:refreshSecurity,
    clearTrustedDevice(){ deviceToken=''; localStorage.removeItem(DEVICE_TOKEN_KEY); refreshSecurity(false); },
  };
})();
