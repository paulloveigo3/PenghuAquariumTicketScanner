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
      // 極致效率：不再自動收起面板，依賴 body 全局鎖定狀態
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

  /* =========================================
     修改：全局設定模式觸發與分頁切換邏輯
  ========================================= */

  // 1. 點擊齒輪圖示，切換「全局設定模式 (Settings Locked)」
  const settingTriggers = document.querySelectorAll('.setting-trigger');
  settingTriggers.forEach(btn => {
    btn.addEventListener('click', () => {
      // 在 body 上切換 class，完全鎖定設定狀態
      document.body.classList.toggle('settings-locked');
    });
  });

  // 2. 設定面板內部的左側選單切換
  const settingTabs = document.querySelectorAll('.settings-tab');
  settingTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const panel = e.target.closest('.page-settings-panel');
      if (!panel) return;

      const targetSetting = tab.dataset.settingTarget;

      // 移除該面板內所有 tab 與 section 的 active 狀態
      panel.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.setting-section').forEach(s => s.classList.remove('active'));

      // 加上 active 給當前點擊項目
      tab.classList.add('active');
      const targetSection = panel.querySelector(`.setting-section[data-setting="${targetSetting}"]`);
      if (targetSection) {
        targetSection.classList.add('active');
      }
    });
  });

})();
