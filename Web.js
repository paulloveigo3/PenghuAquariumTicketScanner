(function () {
  const state = {
    currentView: 'dashboard',
  };

  const navButtons = Array.from(document.querySelectorAll('[data-view-target]'));
  const views = Array.from(document.querySelectorAll('.page-view'));

  function setView(viewName, pushHash = true) {
    if (!viewName) return;
    state.currentView = viewName;

    views.forEach((view) => {
      view.classList.toggle('active', view.dataset.view === viewName);
    });

    navButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viewTarget === viewName);
    });

    if (pushHash) {
      history.replaceState(null, '', `#${viewName}`);
    }
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.viewTarget;
      setView(target);
    });
  });

  const hash = (location.hash || '').replace('#', '').trim();
  const validView = views.some((view) => view.dataset.view === hash) ? hash : 'dashboard';
  setView(validView, false);

  window.addEventListener('hashchange', () => {
    const nextHash = (location.hash || '').replace('#', '').trim();
    if (views.some((view) => view.dataset.view === nextHash)) {
      setView(nextHash, false);
    }
  });
})();
