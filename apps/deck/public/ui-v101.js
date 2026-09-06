(() => {
  'use strict';

  const navButtons = [...document.querySelectorAll('[data-desktop-nav]')];
  const pages = [...document.querySelectorAll('[data-desktop-page]')];
  const sectionTitles = {
    home: ['Visão geral', 'Acompanhe o que está acontecendo agora'],
    deck: ['Apresentação', 'Controle rápido do Holyrics'],
    favorites: ['Favoritos', 'Acesse conteúdos com um clique'],
    obs: ['OBS Studio', 'Monitore e altere a cena no ar'],
    director: ['Diretor automático', 'Sincronize Holyrics e OBS'],
    devices: ['Dispositivos', 'Aprove e gerencie aparelhos confiáveis'],
    system: ['Sistema', 'Diagnóstico, perfis e segurança'],
    appearance: ['Aparência', 'Personalize a experiência de operação'],
  };

  function showDesktopPage(name, remember = true) {
    const target = pages.find(page => page.dataset.desktopPage === name);
    if (!target) return;
    pages.forEach(page => page.classList.toggle('active', page === target));
    navButtons.forEach(button => button.classList.toggle('active', button.dataset.desktopNav === name));
    const [title, subtitle] = sectionTitles[name] || sectionTitles.home;
    const titleEl = document.querySelector('.topbar h1');
    const eyebrow = document.querySelector('.topbar .eyebrow');
    if (titleEl) titleEl.textContent = title;
    if (eyebrow) eyebrow.textContent = subtitle;
    if (remember) localStorage.setItem('worshipDeckDesktopPageV101', name);
    document.querySelector('.desktop-workspace')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function moveSecurityPanel() {
    const panel = document.getElementById('worshipSecurityAdminPanel');
    const page = document.querySelector('[data-desktop-page="devices"]');
    if (!panel || !page || panel.parentElement === page) return;
    page.appendChild(panel);
  }

  function createDevicePage() {
    if (document.querySelector('[data-desktop-page="devices"]')) return;
    const page = document.createElement('section');
    page.className = 'desktop-section desktop-page devices-page';
    page.dataset.desktopPage = 'devices';
    page.innerHTML = '<div class="section-head"><div><div class="section-kicker">ACESSO E SEGURANÇA</div><h3>Dispositivos confiáveis</h3><p class="section-note compact-note">Aprove, altere o perfil ou revogue aparelhos conectados à rede da igreja.</p></div></div>';
    document.querySelector('.desktop-workspace footer')?.before(page);
    pages.push(page);
    moveSecurityPanel();
  }

  function syncConnectionDots() {
    document.querySelector('.sidebar-dot.holyrics')?.classList.toggle('online', document.getElementById('connectionPill')?.classList.contains('online'));
    document.querySelector('.sidebar-dot.obs')?.classList.toggle('online', document.getElementById('obsConnectionPill')?.classList.contains('online'));
  }

  createDevicePage();
  navButtons.forEach(button => button.addEventListener('click', () => showDesktopPage(button.dataset.desktopNav)));
  showDesktopPage(localStorage.getItem('worshipDeckDesktopPageV101') || 'home', false);
  new MutationObserver(() => { moveSecurityPanel(); syncConnectionDots(); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  setInterval(syncConnectionDots, 1500);
})();
