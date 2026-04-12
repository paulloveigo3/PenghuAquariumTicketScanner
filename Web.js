
(function () {
  const state = {
    currentView: 'dashboard',
    bootstrap: null,
    agencyFilter: 'all',
    searchText: '',
    expandedAgency: null,
    toastTimer: null,
  };

  const navButtons = Array.from(document.querySelectorAll('[data-view-target]'));
  const views = Array.from(document.querySelectorAll('.page-view'));
  const tableBody = document.getElementById('agency-table-body');
  const toastEl = document.getElementById('toast');
  const actionTemplate = document.getElementById('agency-action-template');

  const inputs = {
    travelAgencyDbId: document.getElementById('setting-travelAgencyDbId'),
    issueTicketDbId: document.getElementById('setting-issueTicketDbId'),
    aesKey: document.getElementById('setting-aesKey'),
    aesIv: document.getElementById('setting-aesIv'),
    search: document.getElementById('agency-search-input'),
  };

  const labels = {
    settingsStatus: document.getElementById('settings-status-text'),
    agencyLastUpdated: document.getElementById('agency-last-updated'),
    dashboardDbState: document.getElementById('dashboard-db-state'),
    sumAgencies: document.getElementById('sum-agencies'),
    sumIssued: document.getElementById('sum-issued'),
    sumToday: document.getElementById('sum-today'),
    sumRemaining: document.getElementById('sum-remaining'),
  };

  function setView(viewName, pushHash = true) {
    if (!viewName) return;
    state.currentView = viewName;

    views.forEach((view) => {
      view.classList.toggle('active', view.dataset.view === viewName);
    });

    navButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viewTarget === viewName);
    });

    if (pushHash) history.replaceState(null, '', `#${viewName}`);
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.viewTarget));
  });

  const hash = (location.hash || '').replace('#', '').trim();
  setView(views.some(v => v.dataset.view === hash) ? hash : 'dashboard', false);

  window.addEventListener('hashchange', () => {
    const nextHash = (location.hash || '').replace('#', '').trim();
    if (views.some(v => v.dataset.view === nextHash)) setView(nextHash, false);
  });

  document.querySelectorAll('.setting-trigger').forEach(btn => {
    btn.addEventListener('click', () => document.body.classList.toggle('settings-locked'));
  });

  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const panel = e.target.closest('.page-settings-panel');
      if (!panel) return;
      const target = tab.dataset.settingTarget;
      panel.querySelectorAll('.settings-tab').forEach(x => x.classList.remove('active'));
      panel.querySelectorAll('.setting-section').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      const section = panel.querySelector(`.setting-section[data-setting="${target}"]`);
      if (section) section.classList.add('active');
    });
  });

  document.querySelectorAll('[data-agency-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-agency-filter]').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      state.agencyFilter = btn.dataset.agencyFilter || 'all';
      renderAgencyTable();
    });
  });

  inputs.search?.addEventListener('input', () => {
    state.searchText = String(inputs.search.value || '').trim().toLowerCase();
    renderAgencyTable();
  });

  document.getElementById('btn-save-settings-main')?.addEventListener('click', saveSettings);
  document.getElementById('btn-save-settings-top')?.addEventListener('click', saveSettings);
  document.getElementById('btn-reload-bootstrap')?.addEventListener('click', loadBootstrap);
  document.getElementById('btn-reload-agencies')?.addEventListener('click', loadBootstrap);
  document.getElementById('btn-refresh-dashboard')?.addEventListener('click', loadBootstrap);

  tableBody?.addEventListener('click', async (event) => {
    const toggleBtn = event.target.closest('.action-toggle-btn');
    if (toggleBtn) {
      const agencyName = toggleBtn.dataset.agencyName;
      state.expandedAgency = state.expandedAgency === agencyName ? null : agencyName;
      renderAgencyTable();
      return;
    }

    const detailPanel = event.target.closest('.agency-detail-panel');
    if (!detailPanel) return;

    const agencyName = detailPanel.dataset.agencyName;
    const row = findAgencyRow(agencyName);
    if (!row) return;

    if (event.target.closest('.action-save-contact')) {
      await saveContact(detailPanel, row);
      return;
    }
    if (event.target.closest('.action-create-issue')) {
      await createIssue(detailPanel, row);
      return;
    }
    if (event.target.closest('.action-download-history')) {
      await downloadHistory(detailPanel, row);
    }
  });

  function showToast(message, isError = false) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.style.borderColor = isError ? 'rgba(255,109,138,.32)' : 'rgba(124,140,255,.32)';
    toastEl.classList.add('show');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  async function api(action, payload) {
    if (window.google && google.script && google.script.run) {
      return new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .agencyAdminDispatch(action, payload || {});
      });
    }

    const baseUrl = window.AGENCY_ADMIN_API_URL || location.href;
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload: payload || {} }),
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.message || 'API 發生錯誤');
    return json;
  }

  function num(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function fmt(value) {
    return num(value).toLocaleString('zh-TW');
  }

  function safeText(value) {
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  function getBootstrapPayload(resp) {
    if (!resp) return null;
    if (resp.bootstrap) return resp.bootstrap;
    if (resp.data && resp.data.bootstrap) return resp.data.bootstrap;
    return resp;
  }

  async function loadBootstrap() {
    try {
      labels.settingsStatus.textContent = '讀取中...';
      labels.dashboardDbState.textContent = '讀取中';
      const resp = await api('getAgencyAdminBootstrap', {});
      const bootstrap = getBootstrapPayload(resp);
      state.bootstrap = bootstrap;
      applySettingsToInputs(bootstrap.settings || {});
      renderDashboardSummary();
      renderAgencyTable();
      labels.settingsStatus.textContent = bootstrap.sourceStatus?.message || '已讀取設定與預載資料';
      labels.agencyLastUpdated.textContent = bootstrap.sourceStatus?.loadedAt ? ('最後載入：' + bootstrap.sourceStatus.loadedAt) : '已載入';
      labels.dashboardDbState.textContent = bootstrap.sourceStatus?.ok ? '連線正常' : '尚未完整設定';
      labels.dashboardDbState.className = 'tag ' + (bootstrap.sourceStatus?.ok ? 'ok' : 'warn');
      showToast('資料已重新載入');
    } catch (error) {
      console.error(error);
      labels.settingsStatus.textContent = error.message || '讀取失敗';
      labels.dashboardDbState.textContent = '讀取失敗';
      labels.dashboardDbState.className = 'tag danger';
      renderDashboardSummary();
      renderAgencyTable([], error.message || '讀取失敗');
      showToast(error.message || '讀取失敗', true);
    }
  }

  function applySettingsToInputs(settings) {
    inputs.travelAgencyDbId.value = settings.travelAgencyDbId || '';
    inputs.issueTicketDbId.value = settings.issueTicketDbId || '';
    inputs.aesKey.value = settings.aesKey || '';
    inputs.aesIv.value = settings.aesIv || '';
  }

  async function saveSettings() {
    try {
      const payload = {
        travelAgencyDbId: String(inputs.travelAgencyDbId.value || '').trim(),
        issueTicketDbId: String(inputs.issueTicketDbId.value || '').trim(),
        aesKey: String(inputs.aesKey.value || '').trim(),
        aesIv: String(inputs.aesIv.value || '').trim(),
      };
      labels.settingsStatus.textContent = '儲存中...';
      const resp = await api('saveAgencyAdminSettings', payload);
      const bootstrap = getBootstrapPayload(resp);
      state.bootstrap = bootstrap;
      applySettingsToInputs(bootstrap.settings || payload);
      renderDashboardSummary();
      renderAgencyTable();
      labels.settingsStatus.textContent = '已儲存，並完成預載';
      labels.agencyLastUpdated.textContent = bootstrap.sourceStatus?.loadedAt ? ('最後載入：' + bootstrap.sourceStatus.loadedAt) : '已載入';
      showToast('設定已儲存並完成預載');
    } catch (error) {
      console.error(error);
      labels.settingsStatus.textContent = error.message || '儲存失敗';
      showToast(error.message || '儲存失敗', true);
    }
  }

  function getAgencyRows() {
    return Array.isArray(state.bootstrap?.overview) ? state.bootstrap.overview : [];
  }

  function findAgencyRow(agencyName) {
    return getAgencyRows().find(x => x.agencyName === agencyName) || null;
  }

  function renderDashboardSummary() {
    const summary = state.bootstrap?.summary || {};
    labels.sumAgencies.textContent = summary.agencyCount !== undefined ? fmt(summary.agencyCount) : '--';
    labels.sumIssued.textContent = summary.totalIssued !== undefined ? fmt(summary.totalIssued) : '--';
    labels.sumToday.textContent = summary.totalTodayEntries !== undefined ? fmt(summary.totalTodayEntries) : '--';
    labels.sumRemaining.textContent = summary.totalRemaining !== undefined ? fmt(summary.totalRemaining) : '--';
  }

  function shouldShowRow(row) {
    const text = state.searchText;
    const haystack = [
      row.agencyName,
      row.contactDisplay,
      row.remark,
      row.connector1,
      row.connector2,
      row.connector3,
      row.contactPerson,
      row.phone,
      row.email,
    ].join(' ').toLowerCase();
    if (text && !haystack.includes(text)) return false;

    if (state.agencyFilter === 'warn') return row.statusTag !== 'ok';
    if (state.agencyFilter === 'missing') return row.statusTag === 'danger';
    return true;
  }

  function renderAgencyTable() {
    const rows = getAgencyRows();
    if (!tableBody) return;

    if (!rows.length) {
      tableBody.innerHTML = '<tr><td colspan="8" class="empty-cell">尚未讀取到旅行社資料</td></tr>';
      return;
    }

    const filtered = rows.filter(shouldShowRow);
    if (!filtered.length) {
      tableBody.innerHTML = '<tr><td colspan="8" class="empty-cell">沒有符合條件的旅行社</td></tr>';
      return;
    }

    const html = [];
    filtered.forEach((row) => {
      html.push(`
        <tr>
          <td>${escapeHtml(row.agencyName)}</td>
          <td>${fmt(row.todayEntryCount)}</td>
          <td>${fmt(row.totalIssued)}</td>
          <td>${fmt(row.remainingCount)}</td>
          <td>${escapeHtml(row.contactDisplay || '—')}</td>
          <td>${escapeHtml(row.remark || '—')}</td>
          <td><span class="tag ${escapeHtml(row.statusTag || 'warn')}">${escapeHtml(row.statusText || '待確認')}</span></td>
          <td><button class="action-toggle-btn" data-agency-name="${escapeAttr(row.agencyName)}">${state.expandedAgency === row.agencyName ? '收合' : '展開'}</button></td>
        </tr>
      `);
      if (state.expandedAgency === row.agencyName) {
        html.push(buildExpandedRow(row));
      }
    });

    tableBody.innerHTML = html.join('');

    if (state.expandedAgency) {
      const panel = tableBody.querySelector('.agency-detail-panel');
      if (panel) hydrateExpandedPanel(panel, findAgencyRow(state.expandedAgency));
    }
  }

  function buildExpandedRow(row) {
    const node = actionTemplate.content.firstElementChild.cloneNode(true);
    const panel = node.querySelector('.agency-detail-panel');
    panel.dataset.agencyName = row.agencyName;
    return node.outerHTML;
  }

  function hydrateExpandedPanel(panel, row) {
    if (!panel || !row) return;
    panel.dataset.agencyName = row.agencyName;
    panel.querySelector('.contact-input').value = row.contactDisplay || '';
    panel.querySelector('.remark-input').value = row.remark || '';
    panel.querySelector('.connector1-input').value = row.connector1 || '';
    panel.querySelector('.connector2-input').value = row.connector2 || '';
    panel.querySelector('.connector3-input').value = row.connector3 || '';
    panel.querySelector('.contact-person-input').value = row.contactPerson || '';
    panel.querySelector('.contact-phone-input').value = row.phone || '';
    panel.querySelector('.contact-email-input').value = row.email || '';
    panel.querySelector('.enabled-input').value = row.enabled || '啟用';

    const connectorBox = panel.querySelector('.action-connector-box');
    connectorBox.innerHTML = [
      ['串接欄1', row.connector1 || '—'],
      ['串接欄2', row.connector2 || '—'],
      ['串接欄3', row.connector3 || '—'],
      ['IssueTicketDB', row.issueDbStatus || '未讀取'],
    ].map(([k, v]) => `<div class="mini-kv-item"><strong>${escapeHtml(k)}</strong><span>${escapeHtml(v)}</span></div>`).join('');

    const encryptBox = panel.querySelector('.action-encrypt-box');
    const aesInfo = state.bootstrap?.settings || {};
    encryptBox.innerHTML = [
      ['AES Key', aesInfo.aesKey ? maskSecret(aesInfo.aesKey) : '未設定'],
      ['AES IV', aesInfo.aesIv ? maskSecret(aesInfo.aesIv) : '未設定'],
      ['最近切票時間', row.lastIssueTime || '—'],
      ['今日入場', fmt(row.todayEntryCount)],
    ].map(([k, v]) => `<div class="mini-kv-item"><strong>${escapeHtml(k)}</strong><span>${escapeHtml(String(v))}</span></div>`).join('');
  }

  function maskSecret(value) {
    const s = String(value || '');
    if (!s) return '';
    if (s.length <= 8) return '*'.repeat(s.length);
    return s.slice(0, 4) + '****' + s.slice(-4);
  }

  async function saveContact(panel, row) {
    try {
      const payload = {
        agencyName: row.agencyName,
        contactDisplay: panel.querySelector('.contact-input').value,
        remark: panel.querySelector('.remark-input').value,
        connector1: panel.querySelector('.connector1-input').value,
        connector2: panel.querySelector('.connector2-input').value,
        connector3: panel.querySelector('.connector3-input').value,
        contactPerson: panel.querySelector('.contact-person-input').value,
        phone: panel.querySelector('.contact-phone-input').value,
        email: panel.querySelector('.contact-email-input').value,
        enabled: panel.querySelector('.enabled-input').value,
      };
      const resp = await api('saveAgencyContactData', payload);
      state.bootstrap = getBootstrapPayload(resp);
      renderDashboardSummary();
      renderAgencyTable();
      showToast('聯絡與備註已儲存');
    } catch (error) {
      console.error(error);
      showToast(error.message || '儲存失敗', true);
    }
  }

  async function createIssue(panel, row) {
    try {
      const payload = {
        agencyName: row.agencyName,
        issueTime: panel.querySelector('.issue-time-input').value,
        startTicketNo: panel.querySelector('.issue-start-input').value,
        qty: panel.querySelector('.issue-qty-input').value,
        endTicketNo: panel.querySelector('.issue-end-input').value,
      };
      const resp = await api('createAgencyIssueRecord', payload);
      state.bootstrap = getBootstrapPayload(resp);
      renderDashboardSummary();
      state.expandedAgency = row.agencyName;
      renderAgencyTable();
      showToast('新增切票完成');
    } catch (error) {
      console.error(error);
      showToast(error.message || '新增切票失敗', true);
    }
  }

  async function downloadHistory(panel, row) {
    try {
      const payload = {
        agencyName: row.agencyName,
        fromDate: panel.querySelector('.history-from-input').value,
        toDate: panel.querySelector('.history-to-input').value,
      };
      const resp = await api('downloadAgencyHistoryCsv', payload);
      const data = resp.data || resp;
      const blob = new Blob([data.csvContent || ''], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.fileName || (row.agencyName + '_歷史表單.csv');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('歷史表單已下載');
    } catch (error) {
      console.error(error);
      showToast(error.message || '下載失敗', true);
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  loadBootstrap();
})();
