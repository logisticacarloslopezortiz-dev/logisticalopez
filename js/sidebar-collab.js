(function(){
  'use strict';

  function qs(id){ return document.getElementById(id); }

  function createSafeFocus(target){
    try { target && typeof target.focus === 'function' && target.focus(); } catch(_){}
  }

  function isDesktop(){ return window.innerWidth >= 768; }

  // Optimiza la actualización de iconos para evitar sobrecarga
  let __lucideTimer = null;
  function updateLucide(root){
    try {
      if (!window.lucide || typeof lucide.createIcons !== 'function') return;
      if (__lucideTimer) clearTimeout(__lucideTimer);
      __lucideTimer = setTimeout(() => {
        const target = root || qs('collabSidebar') || document;
        try { lucide.createIcons(undefined, target); } catch(_) { lucide.createIcons(); }
      }, 60);
    } catch(_){}
  }

  function setAria(btn, expanded){
    try { if (btn) btn.setAttribute('aria-expanded', expanded ? 'true' : 'false'); } catch(_){ }
  }

  function initCollabSidebar(opts){
    const cfg = Object.assign({
      sidebarId: 'collabSidebar',
      overlayId: 'sidebarOverlay',
      mobileBtnId: 'mobileMenuBtn',
      collapseBtnId: 'sidebarCollapseBtn',
      desktopOpenBtnId: 'desktopMenuBtn',
      hoverHandleId: 'sidebarHoverHandle',
      mainContentId: 'mainContent',
      storageKey: 'collabSidebarDesktopClosed'
    }, opts || {});

    const body = document.body;
    const sidebar = qs(cfg.sidebarId);
    const overlay = qs(cfg.overlayId);
    const mobileBtn = qs(cfg.mobileBtnId);
    const collapseBtn = qs(cfg.collapseBtnId);
    const desktopOpenBtn = qs(cfg.desktopOpenBtnId);
    const hoverHandle = qs(cfg.hoverHandleId);

    // Guard: evita re-inicializar sobre el mismo sidebar (previene listeners duplicados)
    if (sidebar && sidebar.dataset.initialized === 'true') {
      updateLucide(sidebar);
      return;
    }

    let lastFocused = null;

    function update(){
      // A11Y
      setAria(mobileBtn, body.classList.contains('sidebar-mobile-open'));
      setAria(collapseBtn, body.classList.contains('sidebar-desktop-open'));
      updateLucide();
    }

    function initDesktop(){
      if (isDesktop()){
        if (overlay) overlay.style.display = 'none';
        // Estado por defecto desde storage
        if (!body.classList.contains('sidebar-desktop-open') && !body.classList.contains('sidebar-desktop-closed')){
          const savedClosed = localStorage.getItem(cfg.storageKey) === 'true';
          body.classList.add(savedClosed ? 'sidebar-desktop-closed' : 'sidebar-desktop-open');
        }
        // Siempre limpiar estados móviles al entrar a escritorio
        body.classList.remove('sidebar-mobile-open');
      } else {
        // Al entrar a móvil, limpiar estados de escritorio y resetear transform para evitar glitches
        if (sidebar) sidebar.style.transform = '';
        if (overlay) overlay.style.display = '';
        body.classList.remove('sidebar-desktop-open','sidebar-desktop-closed','sidebar-desktop-hover-open');
      }
      update();
    }

    // Eventos móviles
    if (mobileBtn){
      mobileBtn.setAttribute('aria-controls', cfg.sidebarId);
      mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !body.classList.contains('sidebar-mobile-open');
        body.classList.toggle('sidebar-mobile-open');
        if (willOpen){
          lastFocused = document.activeElement;
          const firstLink = sidebar && sidebar.querySelector('nav a');
          createSafeFocus(firstLink || collapseBtn || desktopOpenBtn || mobileBtn);
        }
        update();
      });
    }

    if (overlay){
      overlay.addEventListener('click', () => {
        body.classList.remove('sidebar-mobile-open');
        createSafeFocus(lastFocused || mobileBtn);
        update();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && body.classList.contains('sidebar-mobile-open')){
        body.classList.remove('sidebar-mobile-open');
        createSafeFocus(lastFocused || mobileBtn);
        update();
      }
    });

    // Eventos escritorio
    if (collapseBtn){
      collapseBtn.setAttribute('aria-controls', cfg.sidebarId);
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isDesktop()){
          body.classList.remove('sidebar-desktop-open');
          body.classList.add('sidebar-desktop-closed');
          localStorage.setItem(cfg.storageKey, 'true');
        } else {
          body.classList.remove('sidebar-mobile-open');
          if (sidebar) sidebar.style.transform = '';
        }
        update();
      });
    }

    if (desktopOpenBtn){
      desktopOpenBtn.setAttribute('aria-controls', cfg.sidebarId);
      desktopOpenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        body.classList.remove('sidebar-desktop-closed');
        body.classList.add('sidebar-desktop-open');
        localStorage.setItem(cfg.storageKey, 'false');
        update();
      });
    }

    if (hoverHandle){
      hoverHandle.addEventListener('mouseenter', () => {
        if (isDesktop() && body.classList.contains('sidebar-desktop-closed')){
          body.classList.add('sidebar-desktop-hover-open');
        }
      });
      hoverHandle.addEventListener('mouseleave', () => {
        if (isDesktop()){
          body.classList.remove('sidebar-desktop-hover-open');
        }
      });
    }

    if (sidebar){
      sidebar.addEventListener('mouseenter', () => {
        if (isDesktop() && body.classList.contains('sidebar-desktop-closed')){
          body.classList.add('sidebar-desktop-hover-open');
        }
      });
      sidebar.addEventListener('mouseleave', () => {
        if (isDesktop()){
          body.classList.remove('sidebar-desktop-hover-open');
        }
      });
    }

    // Init + resize
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(initDesktop, 160);
    });

    initDesktop();
    if (sidebar) { sidebar.dataset.initialized = 'true'; }
  }

  // Auto-init si detecta el sidebar por defecto en la página
  document.addEventListener('DOMContentLoaded', function(){
    if (qs('collabSidebar')){
      try { initCollabSidebar(); } catch(e){ console.warn('sidebar-collab init error', e); }
    }
  });

  // Export global opcional
  window.initCollabSidebar = initCollabSidebar;
})();
