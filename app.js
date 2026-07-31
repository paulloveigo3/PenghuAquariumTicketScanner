const CONFIG = {
  apiBaseUrl: 'https://script.google.com/macros/s/AKfycbzU4lGBVhd-sQFVQ32Lb49K_Cr4E222HyUASn7oFKcPvjVbGRu-cBYysveIZ11Z81XROg/exec',
  storagePrefix: 'ticketScanner_v3',
  defaultAutoSyncMinutes: 10,
  timezone: 'Asia/Taipei',

  // 後台 GAS Web App 入口（登入成功後直接跳轉）
  adminExecUrl: 'https://script.google.com/macros/s/AKfycbwvYjKf8SwCQnNttjig9BGGmQvdyX2lA2ArEUhejiFHoCLv-qABk32Nll4DEiVNgySx/exec',

  gujiRedeem: {
    enabled: true,
    signaturesJsonUrl: './guji_signatures.json',
    signaturePositions0Based: [0, 1, 28, 29, 30, 31],
    ticketPrefix: 'B',
    startNo: 270001,
    endNo: 280000,
  },

  agencyAes: {
    enabled: true,
    bootstrapAction: 'getAgencyAesBootstrap',
    startNo: 280001,
    endNo: 1000000,
  },
};


const state = {
  deleteMode: false,
  wakeLock: null,
  html5Qrcode: null,
  isConnected: false,
  localHistory: [],
  uploadQueue: [],
  localValidationDB: {},
  localWhiteListRules: [],
  localSoundRules: {},
  systemSettings: { autoSyncMinutes: CONFIG.defaultAutoSyncMinutes },
  autoSyncTimer: null,
  scanBuffer: '',
  scanTimeout: null,
  uiReady: false,
  todayVisitorCount: 0,
  todayTicketSummary: [],
  ticketSummaryOpen: false,
  ticketSummaryLoading: false,
  themeMode: 'dark',

  // camera
  scannerModalEl: null,
  scannerReaderEl: null,
  scannerCloseBtnEl: null,
  scannerStatusEl: null,
  scannerRunning: false,
  cameraLocked: false,

  accessGranted: false,
  entryMode: '',
  desktopUser: null,

  rangeModeArmed: false,
  rangeAnchor: null,
  lastArmableTicket: null,

  gujiRedeem: {
    ready: false,
    loading: false,
    loadError: '',
    signatureToTicket: {},
    count: 0,
  },

  agencyAes: {
    ready: false,
    loading: false,
    loadError: '',
    aesKey: '',
    aesIv: '',
    sheetUpdatedAt: '',
    issueTicketFileId: '',
    travelAgencyDbId: '',
    totalAgencies: 0,
    totalRecords: 0,
    agencyNames: [],
    ranges: [],
    bitmapReady: false,
    bitmapUpdatedAt: '',
    bitmapStart: 1,
    bitmapEnd: 1000000,
    bitmapBits: '',
    optimisticUsed: {},
  },
};

const els = {};

window.addEventListener('DOMContentLoaded', init);

function init() {
  cacheDom();
  applySavedThemeMode();
  ensureScannerModal();
  bindEvents();
  loadFromStorage();
  state.todayVisitorCount = getLocalSuccessCount();
  renderLogList();
  renderTodayVisitorCount();
  applyAutoSyncInterval(state.systemSettings.autoSyncMinutes);
  updateSyncStatus('待機中');
  hideUserInfo();
  setDisplay('READY', 'waiting');
  addSystemLog('前端已啟動');
  state.uiReady = true;

  closeKeyboardModal();
  openEntrySelection();

  loadGujiRedeemData();
  loadAgencyAesBootstrap(true, true);
  performSystemCheck();
  fetchSystemSettings();
  fetchTodayStats();

  forceSync({ silent: true });
}

function cacheDom() {
  els.body = document.body;
  els.headerBar = document.getElementById('headerBar');
  els.themeToggleBtn = document.getElementById('themeToggleBtn');
  els.themeToggleIcon = document.getElementById('themeToggleIcon');
  els.btStatusBtn = document.getElementById('btStatusBtn');
  els.btText = document.getElementById('btText');
  els.cameraBtn = document.getElementById('cameraBtn');
  els.displayCard = document.getElementById('displayCard');
  els.displayValue = document.getElementById('displayValue');
  els.userInfoBox = document.getElementById('userInfoBox');
  els.userInfoLine1 = document.getElementById('userInfoLine1');
  els.userInfoLine2 = document.getElementById('userInfoLine2');
  els.logList = document.getElementById('logList');
  els.syncDot = document.getElementById('syncDot');
  els.syncText = document.getElementById('syncText');
  els.clearLogsBtn = document.getElementById('clearLogsBtn');
  els.historyBtn = document.getElementById('historyBtn');
  els.syncBtn = document.getElementById('syncBtn');
  els.reloadBtn = document.getElementById('reloadBtn');
  els.scanInputTrap = document.getElementById('scanInputTrap');
  els.qrFileInput = document.getElementById('qr-file-input');
  els.pairingModal = document.getElementById('pairing-modal');
  els.manualConnectBtn = document.getElementById('manualConnectBtn');
  els.closePairingBtn = document.getElementById('closePairingBtn');
  els.keyboardModal = document.getElementById('keyboard-modal');
  els.confirmKeyboardBtn = document.getElementById('confirmKeyboardBtn');
  els.keyboardTestInput = document.getElementById('keyboardTestInput');

  els.entryModal = document.getElementById('entry-modal');
  els.entrySelectPage = document.getElementById('entrySelectPage');
  els.entryDesktopPage = document.getElementById('entryDesktopPage');
  els.enterMobileBtn = document.getElementById('enterMobileBtn');
  els.enterDesktopBtn = document.getElementById('enterDesktopBtn');
  els.entryBackBtn = document.getElementById('entryBackBtn');
  els.desktopLoginBtn = document.getElementById('desktopLoginBtn');
  els.desktopAccountInput = document.getElementById('desktopAccountInput');
  els.desktopPasswordInput = document.getElementById('desktopPasswordInput');
  els.entryMessage = document.getElementById('entryMessage');
  els.todayVisitorCount = document.getElementById('todayVisitorCount');
  els.todayVisitorChip = document.getElementById('todayVisitorChip');
  els.ticketSummaryModal = document.getElementById('ticketSummaryModal');
  els.ticketSummaryCloseBtn = document.getElementById('ticketSummaryCloseBtn');
  els.ticketSummaryBody = document.getElementById('ticketSummaryBody');
  els.ticketSummarySubtitle = document.getElementById('ticketSummarySubtitle');
}

function ensureScannerModal() {
  let modal = document.getElementById('scanner-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'scanner-modal';
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="pairing-box" style="background:#111;color:#fff;width:min(100%,460px);padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
          <div style="font-size:1rem;font-weight:700;">即時掃描 QR Code</div>
          <button id="scanner-close-btn" type="button" class="icon-btn" style="flex:0 0 auto;">
            <span class="material-icons-round">close</span>
          </button>
        </div>
        <div id="scanner-reader" style="width:100%;min-height:280px;background:#000;border-radius:12px;overflow:hidden;"></div>
        <div id="scanner-status" style="margin-top:10px;font-size:.88rem;color:#aaa;text-align:center;">
          啟動鏡頭中...
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  state.scannerModalEl = modal;
  state.scannerReaderEl = modal.querySelector('#qr-reader') || modal.querySelector('#scanner-reader');
  state.scannerCloseBtnEl = modal.querySelector('#closeScannerBtn') || modal.querySelector('#scanner-close-btn');
  state.scannerStatusEl = modal.querySelector('#scanner-status') || modal.querySelector('.scanner-hint');
}

function bindEvents() {
  els.headerBar?.addEventListener('click', toggleHistoryView);

  els.themeToggleBtn?.addEventListener('click', toggleThemeMode);
  els.themeToggleBtn?.addEventListener('keydown', handleThemeToggleKeydown);

  els.todayVisitorChip?.addEventListener('click', toggleTicketSummaryPanel);
  els.todayVisitorChip?.addEventListener('keydown', handleTodayVisitorChipKeydown);
  els.ticketSummaryCloseBtn?.addEventListener('click', closeTicketSummaryPanel);
  els.ticketSummaryModal?.addEventListener('click', handleTicketSummaryBackdropClick);

  els.btStatusBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleBluetooth();
  });

  els.cameraBtn?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await openCamera();
  });

  els.clearLogsBtn?.addEventListener('click', clearLogs);
  els.displayCard?.addEventListener('click', handleDisplayCardRangeClick);
  els.historyBtn?.addEventListener('click', toggleHistoryView);
  els.syncBtn?.addEventListener('click', forceSync);
  els.reloadBtn?.addEventListener('click', () => window.location.reload());
  els.manualConnectBtn?.addEventListener('click', manualConnect);
  els.closePairingBtn?.addEventListener('click', closePairing);
  els.confirmKeyboardBtn?.addEventListener('click', confirmKeyboard);
  els.qrFileInput?.addEventListener('change', handleImageScan);

  els.enterMobileBtn?.addEventListener('click', continueAsMobile);
  els.enterDesktopBtn?.addEventListener('click', showDesktopLoginForm);
  els.entryBackBtn?.addEventListener('click', backToEntrySelection);
  els.desktopLoginBtn?.addEventListener('click', submitDesktopLogin);
  els.desktopAccountInput?.addEventListener('keydown', handleDesktopLoginEnter);
  els.desktopPasswordInput?.addEventListener('keydown', handleDesktopLoginEnter);

  state.scannerCloseBtnEl?.addEventListener('click', closeCameraScanner);

  document.addEventListener('keydown', handleScannerKeydown);
  document.addEventListener('click', handleDocumentClick, true);

  window.addEventListener('error', (event) => {
    reportClientError(
      `[全域錯誤] ${event.message} (行: ${event.lineno}, 列: ${event.colno})`,
      event.error && event.error.stack ? event.error.stack : ''
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = typeof reason === 'string' ? reason : String(reason);
    const stack = reason && reason.stack ? reason.stack : '';
    reportClientError(`[Promise 錯誤] ${message}`, stack);
  });

  document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.isConnected) {
    await requestWakeLock();
    await forceSync({ silent: true });
    if (!state.scannerRunning) focusTrap();
  } else if (document.visibilityState === 'hidden' && state.scannerRunning) {
    await closeCameraScanner(false);
  }
});
}

function handleDocumentClick(event) {
  if (els.entryModal?.classList.contains('active')) return;
  if (els.keyboardModal?.classList.contains('active')) return;
  if (els.pairingModal?.classList.contains('active')) return;
  if (els.ticketSummaryModal?.classList.contains('active')) return;
  if (state.scannerModalEl?.classList.contains('active')) return;
  if (event.target === els.keyboardTestInput) return;
  focusTrap();
}

function storageKey(name) {
  return `${CONFIG.storagePrefix}:${name}`;
}

function getTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function loadFromStorage() {
  try {
    const todayKey = getTodayKey();
    const lastRunDate = localStorage.getItem(storageKey('lastRunDate'));

    const soundRules = localStorage.getItem(storageKey('localSoundRules'));
    if (soundRules) state.localSoundRules = JSON.parse(soundRules);

    const settings = localStorage.getItem(storageKey('systemSettings'));
    if (settings) {
      state.systemSettings = Object.assign({}, state.systemSettings, JSON.parse(settings));
    }

    if (lastRunDate !== todayKey) {
      state.localHistory = [];
      state.uploadQueue = [];
      localStorage.setItem(storageKey('localHistory'), JSON.stringify([]));
      localStorage.setItem(storageKey('uploadQueue'), JSON.stringify([]));
      localStorage.setItem(storageKey('lastRunDate'), todayKey);
    } else {
      state.localHistory = safeJsonParse(localStorage.getItem(storageKey('localHistory')), []);
      state.uploadQueue = safeJsonParse(localStorage.getItem(storageKey('uploadQueue')), []);
    }

    state.localValidationDB = safeJsonParse(localStorage.getItem(storageKey('localValidationDB')), {});
    state.localWhiteListRules = safeJsonParse(localStorage.getItem(storageKey('localWhiteListRules')), []);
    hydrateAgencyAesBootstrapFromStorage_();
  } catch (error) {
    console.error('Storage Error', error);
    addSystemLog('本機快取讀取失敗', 'st-exp');
  }
}

function saveToStorage() {
  localStorage.setItem(storageKey('localHistory'), JSON.stringify(state.localHistory));
  localStorage.setItem(storageKey('uploadQueue'), JSON.stringify(state.uploadQueue));
  localStorage.setItem(storageKey('localValidationDB'), JSON.stringify(state.localValidationDB));
  localStorage.setItem(storageKey('localWhiteListRules'), JSON.stringify(state.localWhiteListRules));
  localStorage.setItem(storageKey('localSoundRules'), JSON.stringify(state.localSoundRules));
  localStorage.setItem(storageKey('systemSettings'), JSON.stringify(state.systemSettings));
  localStorage.setItem(storageKey('lastRunDate'), getTodayKey());
}

function safeJsonParse(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}


function hydrateAgencyAesBootstrapFromStorage_() {
  const cached = safeJsonParse(localStorage.getItem(storageKey('agencyAesBootstrap')), null);
  if (cached) {
    applyAgencyAesBootstrap_(cached);
  }
  const optimisticUsed = safeJsonParse(localStorage.getItem(storageKey('agencyAesOptimisticUsed')), {});
  state.agencyAes.optimisticUsed = optimisticUsed && typeof optimisticUsed === 'object' ? optimisticUsed : {};
}

function persistAgencyAesBootstrap_() {
  const payload = {
    aes: {
      key: state.agencyAes.aesKey,
      iv: state.agencyAes.aesIv,
      updatedAt: state.agencyAes.sheetUpdatedAt,
      travelAgencyDbId: state.agencyAes.travelAgencyDbId,
      issueTicketDbId: state.agencyAes.issueTicketFileId,
    },
    issueTicket: {
      totalAgencies: state.agencyAes.totalAgencies,
      totalRecords: state.agencyAes.totalRecords,
      agencyNames: state.agencyAes.agencyNames,
      ranges: state.agencyAes.ranges,
    },
    bitmap: {
      updatedAt: state.agencyAes.bitmapUpdatedAt,
      start: state.agencyAes.bitmapStart,
      end: state.agencyAes.bitmapEnd,
      bits: state.agencyAes.bitmapBits,
    },
  };

  localStorage.setItem(storageKey('agencyAesBootstrap'), JSON.stringify(payload));
  persistAgencyAesOptimisticUsed_();
}

function persistAgencyAesOptimisticUsed_() {
  localStorage.setItem(storageKey('agencyAesOptimisticUsed'), JSON.stringify(state.agencyAes.optimisticUsed || {}));
}

function applyAgencyAesBootstrap_(payload) {
  const aes = payload && payload.aes ? payload.aes : {};
  const issueTicket = payload && payload.issueTicket ? payload.issueTicket : {};
  const bitmap = payload && payload.bitmap ? payload.bitmap : {};

  state.agencyAes.aesKey = String(aes.key || '').trim();
  state.agencyAes.aesIv = String(aes.iv || '').trim();
  state.agencyAes.sheetUpdatedAt = String(aes.updatedAt || '').trim();
  state.agencyAes.travelAgencyDbId = String(aes.travelAgencyDbId || '').trim();
  state.agencyAes.issueTicketFileId = String(aes.issueTicketDbId || issueTicket.fileId || '').trim();
  state.agencyAes.totalAgencies = Number(issueTicket.totalAgencies || 0);
  state.agencyAes.totalRecords = Number(issueTicket.totalRecords || 0);
  state.agencyAes.agencyNames = Array.isArray(issueTicket.agencyNames) ? issueTicket.agencyNames : [];
  state.agencyAes.ranges = Array.isArray(issueTicket.ranges) ? issueTicket.ranges : [];

  state.agencyAes.bitmapUpdatedAt = String(bitmap.updatedAt || '').trim();
  state.agencyAes.bitmapStart = Number(bitmap.start || 1);
  state.agencyAes.bitmapEnd = Number(bitmap.end || 1000000);
  if (typeof bitmap.bits === 'string' && bitmap.bits) {
    state.agencyAes.bitmapBits = bitmap.bits;
  }
  state.agencyAes.bitmapReady = typeof state.agencyAes.bitmapBits === 'string' && state.agencyAes.bitmapBits.length > 0;

  state.agencyAes.ready = Boolean(state.agencyAes.aesKey && state.agencyAes.aesIv && state.agencyAes.ranges.length);
}

function sanitizeAutoSyncMinutes(value) {
  const num = parseInt(value, 10);
  if (Number.isNaN(num)) return CONFIG.defaultAutoSyncMinutes;
  return Math.min(Math.max(num, 1), 1440);
}

function applyAutoSyncInterval(minutes) {
  const safeMinutes = sanitizeAutoSyncMinutes(minutes);
  state.systemSettings.autoSyncMinutes = safeMinutes;

  if (state.autoSyncTimer) clearInterval(state.autoSyncTimer);
  state.autoSyncTimer = window.setInterval(autoSync, safeMinutes * 60 * 1000);
}

function updateSyncStatus(text, isBlinking = false) {
  if (els.syncText) els.syncText.innerText = text;
  if (els.syncDot) els.syncDot.classList.toggle('syncing', Boolean(isBlinking));
}

function applySavedThemeMode() {
  let savedMode = 'dark';
  try {
    savedMode = localStorage.getItem(storageKey('themeMode')) || 'dark';
  } catch (error) {
    savedMode = 'dark';
  }
  applyThemeMode(savedMode);
}

function persistThemeMode() {
  try {
    localStorage.setItem(storageKey('themeMode'), state.themeMode);
  } catch (error) {
    console.warn('主題儲存失敗', error);
  }
}

function applyThemeMode(mode) {
  const resolvedMode = mode === 'light' ? 'light' : 'dark';
  state.themeMode = resolvedMode;

  els.body?.classList.toggle('theme-light', resolvedMode === 'light');
  els.body?.classList.toggle('theme-dark', resolvedMode === 'dark');

  if (els.themeToggleBtn) {
    const modeText = resolvedMode === 'light' ? '日色模式' : '夜色模式';
    const nextModeText = resolvedMode === 'light' ? '夜色模式' : '日色模式';
    els.themeToggleBtn.setAttribute('aria-label', `目前${modeText}，點擊切換為${nextModeText}`);
    els.themeToggleBtn.setAttribute('title', `目前${modeText}，點擊切換為${nextModeText}`);
  }

  if (els.themeToggleIcon) {
    els.themeToggleIcon.textContent = resolvedMode === 'light' ? 'light_mode' : 'bedtime';
  els.themeToggleBtn?.setAttribute('data-theme-state', resolvedMode);
  }
}

function handleThemeToggleKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleThemeMode(event);
}

function toggleThemeMode(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const nextMode = state.themeMode === 'light' ? 'dark' : 'light';
  applyThemeMode(nextMode);
  persistThemeMode();
}

function handleTodayVisitorChipKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleTicketSummaryPanel(event);
}

function handleTicketSummaryBackdropClick(event) {
  if (event.target === els.ticketSummaryModal) {
    closeTicketSummaryPanel();
  }
}

async function toggleTicketSummaryPanel(event) {
  event?.stopPropagation?.();

  if (!state.accessGranted && els.entryModal?.classList.contains('active')) {
    return;
  }
  if (state.scannerRunning) return;

  if (state.ticketSummaryOpen) {
    closeTicketSummaryPanel();
    return;
  }

  openTicketSummaryPanel();
  await fetchTodayTicketSummary(true);
}

function openTicketSummaryPanel() {
  if (!els.ticketSummaryModal) return;
  state.ticketSummaryOpen = true;
  els.ticketSummaryModal.classList.add('active');
  els.ticketSummaryModal.setAttribute('aria-hidden', 'false');
  renderTicketSummaryLoading();
}

function closeTicketSummaryPanel() {
  if (!els.ticketSummaryModal) return;
  state.ticketSummaryOpen = false;
  els.ticketSummaryModal.classList.remove('active');
  els.ticketSummaryModal.setAttribute('aria-hidden', 'true');
  focusTrap();
}

function renderTicketSummaryLoading() {
  if (!els.ticketSummaryBody) return;
  els.ticketSummaryBody.innerHTML = '<div class="stats-loading">讀取當日票種統計中...</div>';
  updateTicketSummarySubtitle();
}

function updateTicketSummarySubtitle() {
  if (!els.ticketSummarySubtitle) return;
  const total = Number(state.todayVisitorCount || 0);
  els.ticketSummarySubtitle.textContent = '當日累計 ' + total + ' 人｜隔日自動歸零';
}

function renderTicketSummaryRows(summary) {
  if (!els.ticketSummaryBody) return;

  const rows = Array.isArray(summary) ? summary : [];
  updateTicketSummarySubtitle();

  if (!rows.length) {
    els.ticketSummaryBody.innerHTML = '<div class="stats-empty">目前沒有可顯示的票種統計</div>';
    return;
  }

  const html = rows.map(function (item) {
    const name = escapeHtml(item.name || '');
    const code = escapeHtml(item.code || '');
    const count = Number(item.count || 0);
    return ''
      + '<div class="stats-table-row">'
      +   '<div class="stats-ticket-name">' + name + '</div>'
      +   '<div class="stats-ticket-code">' + code + '</div>'
      +   '<div class="stats-ticket-count">' + count + '</div>'
      + '</div>';
  }).join('');

  els.ticketSummaryBody.innerHTML = html;
}

async function fetchTodayTicketSummary(forceRefresh) {
  if (state.ticketSummaryLoading) return;
  if (!forceRefresh && state.todayTicketSummary.length) {
    renderTicketSummaryRows(state.todayTicketSummary);
    return;
  }

  state.ticketSummaryLoading = true;
  renderTicketSummaryLoading();

  try {
    const res = await apiRequest('getTodayStats', {}, 'GET');
    if (typeof res.todayVisitorCount !== 'undefined') {
      renderTodayVisitorCount(res.todayVisitorCount);
    }
    state.todayTicketSummary = Array.isArray(res.todayTicketSummary) ? res.todayTicketSummary : [];
    renderTicketSummaryRows(state.todayTicketSummary);
  } catch (error) {
    if (els.ticketSummaryBody) {
      els.ticketSummaryBody.innerHTML =
        '<div class="stats-empty">讀取失敗：' + escapeHtml(error.message || '未知錯誤') + '</div>';
    }
    updateTicketSummarySubtitle();
  } finally {
    state.ticketSummaryLoading = false;
  }
}

function getLocalSuccessCount() {
  return state.localHistory.filter((item) => item && item.status === 'ok').length;
}

function renderTodayVisitorCount(count) {
  const resolvedCount = Number.isFinite(Number(count))
    ? Math.max(0, Number(count))
    : Math.max(Number(state.todayVisitorCount || 0), getLocalSuccessCount());

  state.todayVisitorCount = resolvedCount;

  if (els.todayVisitorCount) {
    els.todayVisitorCount.textContent = String(resolvedCount);
  }
}

function setDisplay(text, status = 'waiting') {
  if (!els.displayValue || !els.displayCard) return;

  const safeText = text == null ? '' : String(text);
  els.displayValue.innerHTML = '';
  els.displayValue.classList.remove('has-subline');

  const main = document.createElement('div');
  main.className = 'display-main-text';
  main.textContent = safeText;
  els.displayValue.appendChild(main);

    applyDisplayCardState(status);
}

function setDisplayWithSubline(primaryText, secondaryText, status = 'waiting') {
  if (!els.displayValue || !els.displayCard) return;

  const safePrimary = primaryText == null ? '' : String(primaryText);
  const safeSecondary = secondaryText == null ? '' : String(secondaryText);

  els.displayValue.innerHTML = '';
  els.displayValue.classList.toggle('has-subline', Boolean(safeSecondary));

  const main = document.createElement('div');
  main.className = 'display-main-text';
  main.textContent = safePrimary;
  els.displayValue.appendChild(main);

  if (safeSecondary) {
    const sub = document.createElement('div');
    sub.className = 'display-sub-text';
    sub.textContent = safeSecondary;
    els.displayValue.appendChild(sub);
  }

   applyDisplayCardState(status);
}

function applyDisplayCardState(status = 'waiting') {
  if (!els.displayCard) return;
  els.displayCard.className = `display-card ${status}`;
  if (state.rangeModeArmed) {
    els.displayCard.classList.add('range-mode-armed');
  }
}

function clearLastArmableTicket() {
  state.lastArmableTicket = null;
}

function parseSequentialCode(code) {
  const match = String(code || '').trim().match(/^([A-Za-z]+)(\d+)(.*)$/);
  if (!match) return null;

  const number = Number(match[2]);
  if (!Number.isFinite(number)) return null;

  return {
    prefix: String(match[1] || '').toUpperCase(),
    numberText: String(match[2] || ''),
    width: String(match[2] || '').length,
    number,
    suffix: String(match[3] || ''),
  };
}

function parseTicketRaw(rawInput) {
  const parts = String(rawInput || '').split(',').map((part) => part.trim());
  const code = parts[0] || '';

  return {
    rawInput: String(rawInput || ''),
    parts,
    code,
    datePart: parts[1] || '',
    tailParts: parts.slice(1),
    tailSignature: parts.slice(1).join(','),
    sequence: parseSequentialCode(code),
  };
}

function buildRawFromParsedTicket(anchorParsed, number) {
  const seq = anchorParsed.sequence;
  const code =
    `${seq.prefix}${String(number).padStart(seq.width, '0')}${seq.suffix}`;

  return {
    code,
    raw: [code, ...anchorParsed.tailParts].join(','),
  };
}

function removeRangeAnchorFromState(anchor) {
  if (!anchor || !anchor.record) return;

  const historyIndex = state.localHistory.findIndex((item) =>
    item.code === anchor.record.code &&
    item.time === anchor.record.time &&
    item.fullTime === anchor.record.fullTime
  );

  if (historyIndex !== -1) {
    state.localHistory.splice(historyIndex, 1);
  }

  const queueIndex = state.uploadQueue.findIndex((item) =>
    item.content === anchor.record.code &&
    item.time === anchor.record.fullTime &&
    String(item.raw || item.content) === String(anchor.originalRaw || anchor.record.code)
  );

  if (queueIndex !== -1) {
    state.uploadQueue.splice(queueIndex, 1);
  }

  saveToStorage();
  renderLogList();
}

function restoreRangeAnchorIfNeeded() {
  const anchor = state.rangeAnchor;
  if (!anchor || !anchor.record) return;

  pushRecord(anchor.record, anchor.originalRaw);
  if (anchor.ticketTypeName) {
    setDisplayWithSubline(anchor.parsed.code, anchor.ticketTypeName, 'success');
    showUserInfo(anchor.ticketTypeName, '驗證通過');
  } else {
    setDisplay(anchor.parsed.code, 'success');
    showUserInfo(anchor.parsed.sequence?.prefix || '', '驗證通過');
  }
}

function exitRangeMode(options = {}) {
  const restoreAnchor = Boolean(options.restoreAnchor);
  if (restoreAnchor) {
    restoreRangeAnchorIfNeeded();
  }

  state.rangeModeArmed = false;
  state.rangeAnchor = null;
  applyDisplayCardState(els.displayCard?.classList.contains('success')
    ? 'success'
    : els.displayCard?.classList.contains('warning')
      ? 'warning'
      : els.displayCard?.classList.contains('error')
        ? 'error'
        : 'waiting'
  );
}

function handleDisplayCardRangeClick() {
  if (!state.accessGranted) return;
  if (els.entryModal?.classList.contains('active')) return;
  if (els.keyboardModal?.classList.contains('active')) return;
  if (els.pairingModal?.classList.contains('active')) return;
  if (state.scannerRunning) return;

  if (state.rangeModeArmed) {
    exitRangeMode({ restoreAnchor: true });
    addSystemLog('連號模式已取消');
    focusTrap();
    return;
  }

  if (!state.lastArmableTicket) return;

  state.rangeAnchor = {
    parsed: state.lastArmableTicket.parsed,
    originalRaw: state.lastArmableTicket.originalRaw,
    record: state.lastArmableTicket.record,
    ticketTypeName: state.lastArmableTicket.ticketTypeName || '',
  };
  state.rangeModeArmed = true;

  removeRangeAnchorFromState(state.rangeAnchor);

  setDisplayWithSubline(
    state.rangeAnchor.parsed.code,
    '連號模式已啟用，請直接掃最後一張',
    'success'
  );
 showUserInfo(' ', '等待最後一張');
  addSystemLog(`連號模式啟用：${state.rangeAnchor.parsed.code}`);
  focusTrap();
}

function pushBatchRecords(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  for (let i = items.length - 1; i >= 0; i -= 1) {
    state.localHistory.unshift(items[i].record);
  }

  items.forEach((item) => {
    state.uploadQueue.push({
      time: item.record.fullTime,
      content: item.record.code,
      raw: item.raw || item.record.code,
    });
  });

  saveToStorage();
  renderTodayVisitorCount();

  if (els.logList) {
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      frag.appendChild(createLogRow(item.record));
    });
    els.logList.prepend(frag);
  }
}

function handleRangeClosingScan(currentParsed, time, fullTime) {
  const anchor = state.rangeAnchor;
  if (!anchor || !anchor.parsed || !anchor.parsed.sequence) {
    state.rangeModeArmed = false;
    state.rangeAnchor = null;
    playErrorBeep();
    setDisplay('連號模式失效', 'error');
    clearLastArmableTicket();
    return true;
  }

  if (!currentParsed.sequence) {
    playErrorBeep();
    setDisplayWithSubline('連號不符', '請掃同批票券的最後一張', 'error');
    showUserInfo(anchor.parsed.code, '仍在等待最後一張');
    return true;
  }

  const sameStructure =
    anchor.parsed.sequence.prefix === currentParsed.sequence.prefix &&
    anchor.parsed.sequence.suffix === currentParsed.sequence.suffix &&
    anchor.parsed.sequence.width === currentParsed.sequence.width &&
    anchor.parsed.tailSignature === currentParsed.tailSignature;

  if (!sameStructure) {
    playErrorBeep();
    setDisplayWithSubline('連號不符', '請掃同批票券的最後一張', 'error');
    showUserInfo(anchor.parsed.code, '仍在等待最後一張');
    return true;
  }

  const startNum = Math.min(anchor.parsed.sequence.number, currentParsed.sequence.number);
  const endNum = Math.max(anchor.parsed.sequence.number, currentParsed.sequence.number);
  const count = endNum - startNum + 1;

  const existingOkCodes = new Set(
    state.localHistory
      .filter((item) => item.status === 'ok')
      .map((item) => item.code)
  );

  const batchItems = [];
  for (let n = startNum; n <= endNum; n += 1) {
    const built = buildRawFromParsedTicket(anchor.parsed, n);

    if (existingOkCodes.has(built.code)) {
      playDuplicateSound();
      setDisplayWithSubline('區間含重複票', built.code, 'warning');
      showUserInfo(anchor.parsed.code, '請重新掃描或點一下取消');
      return true;
    }

    batchItems.push({
      raw: built.raw,
      record: {
        code: built.code,
        time,
        fullTime,
        status: 'ok',
        className: 'st-ok',
      },
    });
  }

  pushBatchRecords(batchItems);

  state.rangeModeArmed = false;
  state.rangeAnchor = null;
  state.lastArmableTicket = null;

  const firstCode = batchItems[0].record.code;
  const lastCode = batchItems[batchItems.length - 1].record.code;
  const ticketTypeName = anchor.ticketTypeName || '';

  playSuccessBeeps(1);
  setDisplayWithSubline(
    `${firstCode}~${lastCode}`,
    `共${count}張${ticketTypeName ? ` ｜ ${ticketTypeName}` : ''}`,
    'success'
  );
  showUserInfo(' ', `連號完成｜共${count}張`);

  return true;
}

function showUserInfo(line1, line2) {
  if (!els.userInfoBox) return;
  els.userInfoLine1.innerText = line1 == null ? '--' : line1;
  els.userInfoLine2.innerText = line2 == null ? '--' : line2;
  els.userInfoBox.hidden = false;
}

function hideUserInfo() {
  if (!els.userInfoBox) return;
  els.userInfoBox.hidden = true;
  els.userInfoLine1.innerText = '--';
  els.userInfoLine2.innerText = '--';
}

function getNowParts() {
  const now = new Date();
  const time = new Intl.DateTimeFormat('zh-TW', {
    timeZone: CONFIG.timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);

  const fullTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: CONFIG.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now).replace(' ', ' ');

  const ymdParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now).split('-');

  return {
    time,
    fullTime,
    todayYmdCompact: `${ymdParts[0]}${ymdParts[1]}${ymdParts[2]}`,
  };
}

function isLikelyBase64CipherText_(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.includes(',')) return false;
  if (isGujiTestCode_(text)) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  if (text.length < 16 || text.length % 4 !== 0) return false;
  return true;
}

function tryDecodeReadableBase64_(value) {
  const text = String(value || '').trim();
  if (!isLikelyBase64CipherText_(text)) return '';

  try {
    const decoded = decodeURIComponent(escape(window.atob(text)));
    if (!decoded) return '';
    const printable = (decoded.match(/[\x20-\x7E]/g) || []).length;
    const printableRatio = printable / decoded.length;
    const looksReadable =
      decoded.includes(',') ||
      /^B\d{7}$/i.test(decoded.trim()) ||
      /^TEST\d{2}/i.test(decoded.trim()) ||
      printableRatio >= 0.9;

    return looksReadable ? decoded : '';
  } catch (error) {
    return '';
  }
}

function normalizeInput(data) {
  if (typeof data !== 'string') return '';
  const trimmed = data.trim();
  if (!trimmed) return '';

  const decoded = tryDecodeReadableBase64_(trimmed);
  return decoded || trimmed;
}

function handleScanInput(data, source = 'keyboard') {
  if (!data) return;
  const rawInput = data.trim();
  if (!rawInput) return;

  if (source === 'keyboard' && /[^\x00-\x7F]/.test(rawInput)) {
    playErrorBeep();
    setDisplay('輸入法錯誤!', 'error');
    openKeyboardModal();
    return;
  }

  const decodedData = normalizeInput(rawInput);
  processLocalLogic(decodedData, rawInput);
  focusTrap();
}



async function loadAgencyAesBootstrap(includeBitmap = true, force = false) {
  if (!CONFIG.agencyAes.enabled) return;
  if (state.agencyAes.loading) return;
  if (!force && state.agencyAes.ready && (!includeBitmap || state.agencyAes.bitmapReady)) return;

  state.agencyAes.loading = true;
  state.agencyAes.loadError = '';

  try {
    const res = await apiRequest(CONFIG.agencyAes.bootstrapAction, { includeBitmap: !!includeBitmap }, 'POST');
    const payload = res && res.agencyAes ? res.agencyAes : null;
    if (!payload || !payload.aes) {
      throw new Error('AES 啟動資料缺失');
    }

    applyAgencyAesBootstrap_(payload);
    persistAgencyAesBootstrap_();
    addSystemLog(
      'AES/旅行社資料載入完成：' +
      state.agencyAes.totalAgencies +
      ' 間｜區段 ' +
      state.agencyAes.ranges.length +
      (state.agencyAes.bitmapReady ? '｜bitmap 已載入' : '｜bitmap 未載入'),
      'st-ok'
    );
  } catch (error) {
    console.error('loadAgencyAesBootstrap failed', error);
    state.agencyAes.loadError = error && error.message ? error.message : '未知錯誤';
    addSystemLog('AES/旅行社資料載入失敗：' + state.agencyAes.loadError, 'st-exp');
  } finally {
    state.agencyAes.loading = false;
  }
}

async function refreshAgencyAesBitmapIfChanged_() {
  if (!CONFIG.agencyAes.enabled) return;
  if (state.agencyAes.loading) return;

  try {
    const res = await apiRequest(CONFIG.agencyAes.bootstrapAction, { includeBitmap: false }, 'POST');
    const payload = res && res.agencyAes ? res.agencyAes : null;
    const remoteUpdatedAt = String(payload && payload.bitmap && payload.bitmap.updatedAt ? payload.bitmap.updatedAt : '').trim();
    if (!remoteUpdatedAt) return;
    if (remoteUpdatedAt === String(state.agencyAes.bitmapUpdatedAt || '').trim()) return;

    await loadAgencyAesBootstrap(true, true);
    addSystemLog('bitmap 已更新並重新載入', 'st-ok');
  } catch (error) {
    console.warn('refreshAgencyAesBitmapIfChanged failed', error);
  }
}

function normalizeTicketNoToNumber_(ticketNo) {
  const m = String(ticketNo || '').trim().toUpperCase().match(/^B0*(\d{1,7})$/);
  if (!m) return 0;
  const no = Number(m[1]);
  return Number.isFinite(no) ? no : 0;
}

function getAgencyNameByTicketNo_(ticketNo) {
  const no = normalizeTicketNoToNumber_(ticketNo);
  if (!no) return '無';

  const ranges = Array.isArray(state.agencyAes.ranges) ? state.agencyAes.ranges : [];
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i] || {};
    if (no >= Number(range.startNo || 0) && no <= Number(range.endNo || 0)) {
      return String(range.agencyName || '無').trim() || '無';
    }
  }

  return '無';
}

function decryptAgencyAesCipherTextToTicketNo_(rawInput) {
  const code = String(rawInput || '').trim();
  if (!code) return '';
  if (!state.agencyAes.ready) return '';
  if (typeof window.CryptoJS === 'undefined') return '';

  let cipherWords = null;

  if (isGujiRedeemHex_(code)) {
    cipherWords = window.CryptoJS.enc.Hex.parse(code.toUpperCase());
  } else if (isLikelyBase64CipherText_(code)) {
    try {
      cipherWords = window.CryptoJS.enc.Base64.parse(code);
    } catch (error) {
      cipherWords = null;
    }
  }

  if (!cipherWords) return '';

  try {
    const key = window.CryptoJS.enc.Utf8.parse(state.agencyAes.aesKey);
    const iv = window.CryptoJS.enc.Utf8.parse(state.agencyAes.aesIv);
    const cipherParams = window.CryptoJS.lib.CipherParams.create({ ciphertext: cipherWords });
    const decrypted = window.CryptoJS.AES.decrypt(cipherParams, key, {
      iv: iv,
      mode: window.CryptoJS.mode.CBC,
      padding: window.CryptoJS.pad.Pkcs7,
    });
    const text = window.CryptoJS.enc.Utf8.stringify(decrypted).replace(/[\u0000]+/g, '').trim().toUpperCase();
    if (!/^B\d{7}$/.test(text)) return '';

    const no = normalizeTicketNoToNumber_(text);
    if (!no) return '';
    if (no < Number(CONFIG.agencyAes.startNo) || no > Number(CONFIG.agencyAes.endNo)) return '';
    return text;
  } catch (error) {
    return '';
  }
}

function resolveAgencyAesTicket_(rawInput) {
  const raw = String(rawInput || '').trim();
  const ticketNo = decryptAgencyAesCipherTextToTicketNo_(raw);
  if (!ticketNo) return null;

  return {
    raw: raw,
    ticketNo: ticketNo,
    agencyName: getAgencyNameByTicketNo_(ticketNo),
  };
}

function isTicketMarkedUsedInBitmap_(ticketNo) {
  const normalized = String(ticketNo || '').trim().toUpperCase();
  if (!/^B\d{7}$/.test(normalized)) return false;
  if (state.agencyAes.optimisticUsed && state.agencyAes.optimisticUsed[normalized]) return true;
  if (!state.agencyAes.bitmapReady || typeof state.agencyAes.bitmapBits !== 'string') return false;

  const no = normalizeTicketNoToNumber_(normalized);
  if (!no) return false;
  const offset = no - Number(state.agencyAes.bitmapStart || 1);
  if (offset < 0 || offset >= state.agencyAes.bitmapBits.length) return false;
  return state.agencyAes.bitmapBits.charAt(offset) === '1';
}

function markTicketUsedLocally_(ticketNo) {
  const normalized = String(ticketNo || '').trim().toUpperCase();
  if (!/^B\d{7}$/.test(normalized)) return;
  state.agencyAes.optimisticUsed[normalized] = 1;
  persistAgencyAesOptimisticUsed_();
}

function processAgencyAesCard(resolved, originalRaw, time, fullTime) {
  clearLastArmableTicket();

  const ticketNo = String(resolved.ticketNo || '').trim().toUpperCase();
  if (!ticketNo) return;

  const agencyName = String(resolved.agencyName || '無').trim() || '無';
  const isDuplicate = state.localHistory.some(function (item) {
    return item && item.code === ticketNo && item.status === 'ok';
  });
  const alreadyUsed = isTicketMarkedUsedInBitmap_(ticketNo);

  if (isDuplicate || alreadyUsed) {
    playDuplicateSound();
    setDisplayWithSubline('已使用票號', ticketNo + '｜' + agencyName, 'warning');
    showUserInfo('AES 解碼票', '此票已核銷 / 已使用');
    addLogToUI({ time: time, code: ticketNo + ' (' + agencyName + '｜已使用)', className: 'st-warn' });
    return;
  }

  playSuccessBeeps(1);
  setDisplayWithSubline(ticketNo, agencyName, 'success');
  showUserInfo('AES 解碼成功', '旅行社：' + agencyName);

  const record = {
    code: ticketNo,
    time: time,
    fullTime: fullTime,
    status: 'ok',
    className: 'st-ok',
    kind: 'agency_aes',
    agencyName: agencyName,
    ticketCategory: 'ABN',
  };

  pushRecord(record, originalRaw || resolved.raw || ticketNo);
  markTicketUsedLocally_(ticketNo);
}

function isGujiRedeemHex_(value) {
  return /^[0-9A-F]{32}$/i.test(String(value || '').trim());
}

function buildGujiRedeemSignature_(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!isGujiRedeemHex_(code)) return '';
  const pos = CONFIG.gujiRedeem.signaturePositions0Based || [];
  if (!Array.isArray(pos) || !pos.length) return '';
  return pos.map(function (p) { return code.charAt(Number(p) || 0); }).join('');
}

function formatGujiRedeemTicketNo_(no) {
  return CONFIG.gujiRedeem.ticketPrefix + String(no).padStart(7, '0');
}


function isGujiTestCode_(value) {
  return /^TEST\d{2}[A-Z]{26}$/i.test(String(value || '').trim());
}

function getGujiTestLabel_(value) {
  const code = String(value || '').trim().toUpperCase();
  const match = code.match(/^(TEST\d{2})[A-Z]{26}$/);
  return match ? match[1] : code.slice(0, 6);
}

function buildReadablePath_(value) {
  try {
    if (!value) return '(未設定)';
    if (/^https?:\/\//i.test(String(value))) return String(value);
    return new URL(String(value), window.location.href).href;
  } catch (error) {
    return String(value || '(未設定)');
  }
}

function processGujiTestCode_(rawInput, time) {
  const code = String(rawInput || '').trim().toUpperCase();
  const label = getGujiTestLabel_(code);

  setDisplayWithSubline(label, '測試模式：不寫入DB / 不計人數', 'warning');
  showUserInfo('TEST 測試碼已攔截', '僅寫入 SESSION LOG');
  addSystemLog('TEST 命中：' + label, 'st-warn');
  addSystemLog('TEST API 路徑：' + buildReadablePath_(CONFIG.apiBaseUrl), 'st-sys');
  addSystemLog('TEST 簽名檔：' + buildReadablePath_(CONFIG.gujiRedeem?.signaturesJsonUrl), 'st-sys');
  addLogToUI({ time: time, code: label + ' (TEST BYPASS)', className: 'st-warn' });
}

async function loadGujiRedeemData() {
  if (!CONFIG.gujiRedeem.enabled) return;
  if (state.gujiRedeem.loading || state.gujiRedeem.ready) return;

  state.gujiRedeem.loading = true;
  state.gujiRedeem.loadError = '';

  try {
    const response = await fetch(CONFIG.gujiRedeem.signaturesJsonUrl, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const payload = await response.json();
    const signatures = Array.isArray(payload && payload.signatures) ? payload.signatures : [];
    if (!signatures.length) {
      throw new Error('signatures.json 內容為空');
    }

    const map = {};
    signatures.forEach(function (signature, index) {
      const sig = String(signature || '').trim().toUpperCase();
      if (!sig) return;
      const no = Number(CONFIG.gujiRedeem.startNo) + index;
      map[sig] = formatGujiRedeemTicketNo_(no);
    });

    state.gujiRedeem.signatureToTicket = map;
    state.gujiRedeem.count = signatures.length;
    state.gujiRedeem.ready = true;
    addSystemLog('古吉核銷碼載入完成：' + signatures.length + ' 筆', 'st-ok');
  } catch (error) {
    console.error('loadGujiRedeemData failed', error);
    state.gujiRedeem.loadError = error && error.message ? error.message : '未知錯誤';
    addSystemLog('古吉核銷碼載入失敗：' + state.gujiRedeem.loadError, 'st-exp');
  } finally {
    state.gujiRedeem.loading = false;
  }
}

function resolveGujiRedeemTicket_(rawInput) {
  if (!CONFIG.gujiRedeem.enabled) return null;

  const code = String(rawInput || '').trim().toUpperCase();
  if (!isGujiRedeemHex_(code)) return null;
  if (!state.gujiRedeem.ready) return null;

  const signature = buildGujiRedeemSignature_(code);
  if (!signature) return null;

  const ticketNo = state.gujiRedeem.signatureToTicket[signature];
  if (!ticketNo) return null;

  return {
    signature: signature,
    ticketNo: ticketNo,
    raw: code,
  };
}

function processGujiRedeemCard(resolved, originalRaw, time, fullTime) {
  clearLastArmableTicket();

  const ticketNo = String(resolved.ticketNo || '').trim().toUpperCase();
  if (!ticketNo) return;

  const isDuplicate = state.localHistory.some(function (item) {
    return item && item.code === ticketNo && item.status === 'ok';
  });
  const alreadyUsed = isTicketMarkedUsedInBitmap_(ticketNo);

  if (isDuplicate || alreadyUsed) {
    playDuplicateSound();
    setDisplayWithSubline('重複核銷', ticketNo, 'warning');
    showUserInfo('古吉核銷碼', '此票已使用');
    addLogToUI({ time: time, code: ticketNo, className: 'st-warn' });
    return;
  }

  playSuccessBeeps(1);
  setDisplayWithSubline(ticketNo, '古吉核銷通過', 'success');
  showUserInfo('古吉核銷碼', resolved.signature || '');

  const record = {
    code: ticketNo,
    time: time,
    fullTime: fullTime,
    status: 'ok',
    className: 'st-ok',
    kind: 'guji_redeem',
    ticketCategory: 'ABN',
  };
  pushRecord(record, originalRaw || resolved.raw || ticketNo);
  markTicketUsedLocally_(ticketNo);
}


function processUnknownRawCode_(rawInput, time) {
  const code = String(rawInput || '').trim();
  if (!code) return;

  playErrorBeep();
  setDisplayWithSubline('未知亂碼', code, 'warning');
  showUserInfo('不計入人數', '不寫入 DB / 不列入票種統計');
  addSystemLog('未知亂碼已略過：' + code, 'st-warn');
  addLogToUI({ time: time, code: code + ' (SKIPPED)', className: 'st-warn' });
}

function processLocalLogic(rawInput, originalRaw = rawInput) {
  const { time, fullTime, todayYmdCompact } = getNowParts();
  hideUserInfo();

  if (rawInput.includes(',')) {
    processTicketLikeRecord(rawInput, originalRaw, time, fullTime, todayYmdCompact);
    return;
  }

  if (isGujiTestCode_(rawInput)) {
    processGujiTestCode_(rawInput, time);
    return;
  }

  clearLastArmableTicket();

  if (state.rangeModeArmed) {
    playErrorBeep();
    setDisplayWithSubline('連號模式中', '請直接掃最後一張票券', 'warning');
    showUserInfo(state.rangeAnchor?.parsed?.code || '--', '仍在等待最後一張');
    return;
  }

  const isValidationTarget = state.localWhiteListRules.some((rule) => {
    const prefix = String(rule.prefix || '').toUpperCase();
    const length = Number(rule.length || 0);
    return prefix && rawInput.toUpperCase().startsWith(prefix) && rawInput.length === length;
  });

  if (isValidationTarget) {
    processValidationCard(rawInput, originalRaw, time, fullTime);
    return;
  }

  const originalCandidate = String(originalRaw || '').trim();
  const normalizedCandidate = String(rawInput || '').trim();
  const agencyCandidate = originalCandidate || normalizedCandidate;

  // 新式隨機票是 32 碼 HEX，不是 AES。
  // 必須先走古吉核銷名單，比對失敗後才允許舊 AES 流程 fallback。
  const gujiCandidate = isGujiRedeemHex_(originalCandidate) ? originalCandidate : normalizedCandidate;
  if (isGujiRedeemHex_(gujiCandidate)) {
    if (!state.gujiRedeem.ready) {
      playErrorBeep();
      setDisplay('核銷資料載入中', 'warning');
      showUserInfo('請稍後重掃', state.gujiRedeem.loadError || '古吉核銷名單尚未就緒');
      return;
    }

    const resolvedGuji = resolveGujiRedeemTicket_(gujiCandidate);
    if (resolvedGuji) {
      processGujiRedeemCard(resolvedGuji, originalRaw, time, fullTime);
      return;
    }

    // 若未命中名單，不在這裡 return，讓舊版 AES HEX 票仍有 fallback 機會。
  }

  if (state.agencyAes.ready) {
    const resolvedAgency = resolveAgencyAesTicket_(agencyCandidate) || resolveAgencyAesTicket_(normalizedCandidate);
    if (resolvedAgency) {
      processAgencyAesCard(resolvedAgency, originalRaw, time, fullTime);
      return;
    }
  }

  if (isLikelyBase64CipherText_(agencyCandidate)) {
    if (state.agencyAes.loading) {
      playErrorBeep();
      setDisplay('AES 資料載入中', 'warning');
      showUserInfo('請稍後重掃', state.agencyAes.loadError || 'AES / bitmap / 旅行社資料尚未就緒');
      return;
    }

    processUnknownRawCode_(agencyCandidate, time);
    return;
  }

  processUnknownRawCode_(normalizedCandidate || originalCandidate, time);
}

function processTicketLikeRecord(rawInput, originalRaw, time, fullTime, todayYmdCompact) {
  const parsed = parseTicketRaw(rawInput);
  const code = parsed.code;
  const datePart = parsed.datePart;

  if (!code) {
    clearLastArmableTicket();
    playErrorBeep();
    setDisplay('格式錯誤', 'error');
    addSystemLog('掃描到空白票號', 'st-exp');
    return;
  }

  if (datePart && datePart !== todayYmdCompact) {
    clearLastArmableTicket();
    playErrorBeep();
    setDisplay(`過期票 (${datePart})`, 'error');
    addLogToUI({ time, code: `${code} (過期)`, className: 'st-exp' });
    return;
  }

  if (state.rangeModeArmed) {
    handleRangeClosingScan(parsed, time, fullTime);
    return;
  }

  const isDuplicate = state.localHistory.some((item) => item.code === code && item.status === 'ok');
  const prefix = extractPrefix(code);
  const rule = resolveSoundRule(prefix);
  const ticketTypeName = rule.name || '';

  if (isDuplicate) {
    clearLastArmableTicket();
    playDuplicateSound();
    if (ticketTypeName) {
      setDisplayWithSubline('重複入場', ticketTypeName, 'warning');
      showUserInfo(code, '重複票券');
    } else {
      setDisplay('重複入場', 'warning');
      showUserInfo(code, '重複票券');
    }
    addLogToUI({ time, code, className: 'st-warn' });
    return;
  }

  playSuccessBeeps(rule.sound || 1);
  if (ticketTypeName) {
    setDisplayWithSubline(code, ticketTypeName, 'success');
    showUserInfo(prefix || 'TICKET', '驗證通過');
  } else {
    setDisplay(code, 'success');
    showUserInfo(prefix || 'TICKET', '驗證通過');
  }

  const record = { code, time, fullTime, status: 'ok', className: 'st-ok' };
  pushRecord(record, originalRaw);

  state.lastArmableTicket = {
    parsed,
    originalRaw,
    record,
    ticketTypeName,
  };
}

function processValidationCard(rawInput, originalRaw, time, fullTime) {
  clearLastArmableTicket();
  const validUser = state.localValidationDB[rawInput];
  const isDuplicate = state.localHistory.some((item) => item.code === rawInput && item.status === 'ok');

  if (!validUser) {
    playErrorBeep();
    setDisplay('無效卡片', 'error');
    showUserInfo('查無資料', '請洽管理員');
    addLogToUI({ time, code: `${rawInput} (無效)`, className: 'st-exp' });
    return;
  }

  const userLine = [validUser.name, validUser.gender, validUser.birth].filter(Boolean).join(' | ');
  const idLine = validUser.id || '已找到會員資料';

  if (isDuplicate) {
    playDuplicateSound();
    setDisplay('重複入場', 'warning');
    showUserInfo(userLine || rawInput, idLine);
    addLogToUI({ time, code: `${rawInput} (重複)`, className: 'st-warn' });
    return;
  }

  playSuccessBeeps(1);
  setDisplay('驗證通過', 'success');
  showUserInfo(userLine || rawInput, idLine);

  const record = { code: rawInput, time, fullTime, status: 'ok', className: 'st-ok' };
  pushRecord(record, originalRaw);
}

function pushRecord(record, originalRaw) {
  state.localHistory.unshift(record);
  state.uploadQueue.push({
    time: record.fullTime,
    content: record.code,
    raw: originalRaw || record.code,
    kind: record.kind || '',
    agencyName: record.agencyName || '',
    ticketCategory: record.ticketCategory || '',
  });
  saveToStorage();
  renderTodayVisitorCount();
  addLogToUI(record);
}

function createLogRow(item) {
  const div = document.createElement('div');
  div.className = `log-row ${item.className || ''}`;

  const canDelete = state.deleteMode && item.time !== 'SYS';

  div.innerHTML = `
    <div class="log-time">${escapeHtml(item.time || 'SYS')}</div>
    <div class="log-data">${escapeHtml(item.code || '')}</div>
    <div class="log-actions">
      ${canDelete ? '<button class="log-delete-btn" type="button">✕</button>' : ''}
    </div>
  `;

  if (canDelete) {
    const btn = div.querySelector('.log-delete-btn');
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      confirmDeleteLogItem(item);
    });
  }

  return div;
}

async function confirmDeleteLogItem(item) {
  const ok = window.confirm(`確定刪除這筆？\n${item.time}｜${item.code}`);
  if (!ok) return;

  try {
    const res = await apiRequest('deleteTodayRecord', {
      time: item.fullTime || item.time,
      content: item.code
    }, 'POST');

    if (Array.isArray(res.data)) {
      state.localHistory = res.data.map((row) => ({
        time: row[0] || '00:00:00',
        code: row[1] || '',
        status: 'ok',
        className: 'st-ok'
      }));
    }

    state.todayVisitorCount = Number(res.todayVisitorCount || 0);
    state.todayTicketSummary = Array.isArray(res.todayTicketSummary) ? res.todayTicketSummary : [];
    saveToStorage();
    renderLogList();
    renderTodayVisitorCount();

    if (state.ticketSummaryOpen) {
      renderTicketSummaryRows(state.todayTicketSummary);
    }

    addSystemLog('單筆刪除完成', 'st-ok');
  } catch (error) {
    addSystemLog('單筆刪除失敗：' + error.message, 'st-exp');
  }
}

function addLogToUI(item) {
  if (!els.logList) return;
  els.logList.prepend(createLogRow(item));
}

function addSystemLog(message, className = 'st-sys') {
  addLogToUI({ time: 'SYS', code: message, className });
}

function renderLogList() {
  if (!els.logList) return;
  els.logList.innerHTML = '';
  state.localHistory.forEach((item) => {
    els.logList.appendChild(createLogRow(item));
  });
}

function clearLogs() {
  state.deleteMode = !state.deleteMode;
  renderLogList();
  addSystemLog(state.deleteMode ? '已進入單筆刪除模式' : '已離開單筆刪除模式');
}

function toggleHistoryView() {
  if (state.scannerRunning) return;
  els.body?.classList.toggle('history-mode');
}

function confirmKeyboard() {
  closeKeyboardModal();
  focusTrap();
}

function openKeyboardModal() {
  els.keyboardModal?.classList.add('active');
  els.keyboardModal?.setAttribute('aria-hidden', 'false');
  els.keyboardTestInput?.focus();
}

function closeKeyboardModal() {
  els.keyboardModal?.classList.remove('active');
  els.keyboardModal?.setAttribute('aria-hidden', 'true');
}

function openEntrySelection() {
  if (!els.entryModal) return;

  els.entryModal.classList.add('active');
  els.entryModal.setAttribute('aria-hidden', 'false');

  showEntryPage('select');
  setEntryMessage('');

  if (els.desktopAccountInput) els.desktopAccountInput.value = '';
  if (els.desktopPasswordInput) els.desktopPasswordInput.value = '';

  els.enterMobileBtn?.focus();
}

function showDesktopLoginForm() {
  showEntryPage('desktop');
  setEntryMessage('');
  window.setTimeout(() => {
    els.desktopAccountInput?.focus();
  }, 30);
}

function backToEntrySelection() {
  showEntryPage('select');
  setEntryMessage('');
}

function showEntryPage(page) {
  if (els.entrySelectPage) {
    els.entrySelectPage.hidden = page !== 'select';
  }
  if (els.entryDesktopPage) {
    els.entryDesktopPage.hidden = page !== 'desktop';
  }
}

function closeEntryModal() {
  els.entryModal?.classList.remove('active');
  els.entryModal?.setAttribute('aria-hidden', 'true');
}

function setEntryMessage(message, type = '') {
  if (!els.entryMessage) return;
  els.entryMessage.textContent = message || '';
  els.entryMessage.className = 'entry-message';
  if (type) els.entryMessage.classList.add(type);
}

function grantAccess(mode, user) {
  state.accessGranted = true;
  state.entryMode = mode || '';
  state.desktopUser = user || null;
}

function continueAsMobile() {
  grantAccess('mobile', null);
  closeEntryModal();
  openKeyboardModal();
}

function handleDesktopLoginEnter(event) {
  if (event.key !== 'Enter') return;

  event.preventDefault();
  event.stopPropagation();

  const target = event.target;

  if (target === els.desktopAccountInput) {
    if (!String(els.desktopPasswordInput?.value || '').trim()) {
      els.desktopPasswordInput?.focus();
      els.desktopPasswordInput?.select?.();
      return;
    }
  }

  if (target === els.desktopPasswordInput || target === els.desktopAccountInput) {
    submitDesktopLogin();
  }
}

async function submitDesktopLogin() {
  const account = String(els.desktopAccountInput?.value || '').trim();
  const password = String(els.desktopPasswordInput?.value || '').trim();

  if (!account || !password) {
    setEntryMessage('請輸入帳號與密碼', 'error');
    return;
  }

  if (els.desktopLoginBtn) els.desktopLoginBtn.disabled = true;
  setEntryMessage('登入中...');

  try {
    const res = await apiRequest('loginFrontDesk', { account, password }, 'POST');
    const loginUser = res.user || { account, name: account };
    const redirectUrl = buildAdminRedirectUrl_(res, loginUser);

    grantAccess('desktop', loginUser);
    persistAdminJumpContext_(res, loginUser);
    window.location.href = redirectUrl;
  } catch (error) {
    setEntryMessage(error.message || '登入失敗', 'error');
  } finally {
    if (els.desktopLoginBtn) els.desktopLoginBtn.disabled = false;
  }
}

function buildAdminRedirectUrl_(loginRes, loginUser) {
  const adminExecUrl = String(loginRes?.adminExecUrl || CONFIG.adminExecUrl || '').trim();

  if (!adminExecUrl) {
    throw new Error('尚未設定後台 GAS Web App URL');
  }

  if (adminExecUrl.includes('PASTE_NEW_WEB_GS_EXEC_URL_HERE')) {
    throw new Error('請先把 adminExecUrl 改成新的後台 Web App 網址');
  }

  const url = new URL(adminExecUrl);

  if (loginUser?.account) {
    url.searchParams.set('fromAccount', loginUser.account);
  }
  if (loginUser?.name) {
    url.searchParams.set('fromName', loginUser.name);
  }

  url.searchParams.set('fromMode', 'desktop-old-login');
  return url.toString();
}

function persistAdminJumpContext_(loginRes, loginUser) {
  const adminExecUrl = String(loginRes?.adminExecUrl || CONFIG.adminExecUrl || '').trim();
  const adminContext = {
    adminExecUrl: adminExecUrl && !adminExecUrl.includes('PASTE_NEW_WEB_GS_EXEC_URL_HERE') ? adminExecUrl : '',
    fromAccount: loginUser?.account || '',
    fromName: loginUser?.name || '',
    loggedAt: new Date().toISOString(),
  };

  try {
    sessionStorage.setItem('AGENCY_ADMIN_BOOTSTRAP', JSON.stringify(adminContext));
  } catch (error) {
    console.warn('後台跳轉資訊寫入失敗', error);
  }
}

function toggleBluetooth() {
  if (state.isConnected) {
    setConnectionState(false);
    addSystemLog('藍牙已斷開');
    return;
  }
  els.pairingModal?.classList.add('active');
  els.pairingModal?.setAttribute('aria-hidden', 'false');
}

function closePairing() {
  els.pairingModal?.classList.remove('active');
  els.pairingModal?.setAttribute('aria-hidden', 'true');
  focusTrap();
}

async function manualConnect() {
  closePairing();
  await setConnectionState(true);
  addSystemLog('藍牙已配對');
}

async function setConnectionState(connected) {
  state.isConnected = connected;
  els.btStatusBtn?.classList.toggle('bt-connected', connected);
  if (els.btText) els.btText.innerText = connected ? '已連線' : '未連線';

  if (connected) {
    setDisplay('LINKED', 'success');
    await requestWakeLock();
    window.setTimeout(() => {
      if (els.displayValue?.textContent === 'LINKED') setDisplay('READY', 'waiting');
    }, 1200);
  } else {
    releaseWakeLock();
    setDisplay('READY', 'waiting');
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (state.wakeLock) return;
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener?.('release', () => {
      state.wakeLock = null;
    });
  } catch (error) {
    console.warn('WakeLock failed', error);
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) return;
  try {
    await state.wakeLock.release();
  } catch (error) {
    console.warn('WakeLock release failed', error);
  } finally {
    state.wakeLock = null;
  }
}

function handleScannerKeydown(event) {
  if (!state.accessGranted) return;
  if (els.keyboardModal?.classList.contains('active')) return;
  if (els.pairingModal?.classList.contains('active')) return;
  if (state.scannerRunning) return;

  if (event.key === 'Enter') {
    if (state.scanBuffer.length > 0) {
      const finalValue = state.scanBuffer.trim();
      state.scanBuffer = '';
      clearTimeout(state.scanTimeout);
      if (finalValue === 'GATELINK_PAIRING_ACTION') {
        manualConnect();
      } else {
        handleScanInput(finalValue, 'keyboard');
      }
    }
    return;
  }

  if (event.key.length === 1) {
    state.scanBuffer += event.key;
    clearTimeout(state.scanTimeout);
    state.scanTimeout = window.setTimeout(() => {
      state.scanBuffer = '';
    }, 120);
  }
}

function focusTrap() {
  if (!state.accessGranted) return;
  if (els.entryModal?.classList.contains('active')) return;
  if (els.keyboardModal?.classList.contains('active')) return;
  if (state.scannerRunning) return;
  els.scanInputTrap?.focus({ preventScroll: true });
}

async function openCamera() {
  if (!state.accessGranted) {
    openEntrySelection();
    return;
  }
  if (typeof window.Html5Qrcode === 'undefined') {
    window.alert('QR 套件尚未載入，請重新整理後再試。');
    return;
  }

  if (state.cameraLocked || state.scannerRunning) return;
  state.cameraLocked = true;

  if (!state.scannerReaderEl) {
    throw new Error('找不到掃描器容器，請確認 HTML 內是否存在 #qr-reader 或 #scanner-reader');
  }

  try {
    els.body?.classList.remove('history-mode');

    if (!state.html5Qrcode) {
      const readerId = state.scannerReaderEl?.id || 'qr-reader';
      state.html5Qrcode = new Html5Qrcode(readerId);
    }

    state.scannerModalEl?.classList.add('active');
    state.scannerModalEl?.setAttribute('aria-hidden', 'false');
    if (state.scannerStatusEl) state.scannerStatusEl.textContent = '啟動鏡頭中...';

    const config = {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const side = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
        return { width: side, height: side };
      },
      aspectRatio: 1.0,
      disableFlip: false,
      rememberLastUsedCamera: true,
    };

    let started = false;

    try {
      await state.html5Qrcode.start(
        { facingMode: { exact: 'environment' } },
        config,
        onCameraScanSuccess,
        onCameraScanFailure
      );
      started = true;
    } catch (e1) {
      try {
        await state.html5Qrcode.start(
          { facingMode: 'environment' },
          config,
          onCameraScanSuccess,
          onCameraScanFailure
        );
        started = true;
      } catch (e2) {
        const devices = await Html5Qrcode.getCameras();
        if (!devices || !devices.length) {
          throw new Error('找不到可用鏡頭');
        }

        const backCam =
          devices.find((d) => /back|rear|environment/gi.test(d.label || '')) || devices[0];

        await state.html5Qrcode.start(
          { deviceId: { exact: backCam.id } },
          config,
          onCameraScanSuccess,
          onCameraScanFailure
        );
        started = true;
      }
    }

    if (started) {
      state.scannerRunning = true;
      if (state.scannerStatusEl) state.scannerStatusEl.textContent = '請將 QR Code 對準框內';
      addSystemLog('相機掃描已啟動');
    }
  } catch (error) {
    console.error('相機啟動失敗', error);
    await closeCameraScanner(false);
    reportClientError(`[相機啟動失敗] ${error.message}`, error.stack || '');
    window.alert(`無法開啟相機：${error.message}`);
  } finally {
    state.cameraLocked = false;
  }
}

function onCameraScanFailure() {
  // 持續掃描中，不做提示
}

async function onCameraScanSuccess(decodedText) {
  if (state.cameraLocked) return;
  state.cameraLocked = true;

  try {
    if (state.scannerStatusEl) state.scannerStatusEl.textContent = '已掃描成功，正在驗證...';
    playSuccessBeeps(1);
    await closeCameraScanner(false);
    handleScanInput(decodedText, 'camera');
  } catch (error) {
    console.error('掃描後處理失敗', error);
    reportClientError(`[掃描後處理失敗] ${error.message}`, error.stack || '');
  } finally {
    window.setTimeout(() => {
      state.cameraLocked = false;
    }, 300);
  }
}

async function closeCameraScanner(refocus = true) {
  try {
    if (state.html5Qrcode) {
      const isScanning =
        typeof state.html5Qrcode.isScanning === 'function'
          ? state.html5Qrcode.isScanning()
          : state.scannerRunning;

      if (isScanning) {
        await state.html5Qrcode.stop();
      }

      try {
        await state.html5Qrcode.clear();
      } catch (_) {
        // ignore
      }
    }
  } catch (error) {
    console.warn('關閉掃描器失敗', error);
  } finally {
    state.scannerRunning = false;
    state.scannerModalEl?.classList.remove('active');
    state.scannerModalEl?.setAttribute('aria-hidden', 'true');
    if (state.scannerStatusEl) state.scannerStatusEl.textContent = '啟動鏡頭中...';
    if (refocus) focusTrap();
  }
}

// 保留舊功能，避免其他地方呼叫報錯
async function handleImageScan(event) {
  const file = event?.target?.files && event.target.files[0];
  if (!file) {
    focusTrap();
    return;
  }

  if (typeof window.Html5Qrcode === 'undefined') {
    window.alert('QR 套件尚未載入。');
    focusTrap();
    return;
  }

  setDisplay('解析中...', 'waiting');

  try {
    if (!state.html5Qrcode) {
      const tempId = 'hidden-qr-reader';
      let tempEl = document.getElementById(tempId);
      if (!tempEl) {
        tempEl = document.createElement('div');
        tempEl.id = tempId;
        tempEl.style.cssText =
          'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(tempEl);
      }
      state.html5Qrcode = new Html5Qrcode(tempId);
    }

    const decodedText = await state.html5Qrcode.scanFile(file, true);
    handleScanInput(decodedText, 'camera');
  } catch (error) {
    console.warn('圖片解析失敗', error);
    setDisplay('READY', 'waiting');
    window.alert('無法辨識圖片中的 QR Code，請確認畫面清晰後再試。');
  } finally {
    if (els.qrFileInput) els.qrFileInput.value = '';
    focusTrap();
  }
}

function extractPrefix(code) {
  const match = String(code || '').match(/^([A-Z]+)/i);
  return match ? match[1].toUpperCase() : '';
}

function resolveSoundRule(prefix) {
  const raw = state.localSoundRules[prefix];
  if (!raw) return { sound: 1, name: '' };
  if (typeof raw === 'number') return { sound: raw, name: '' };
  return {
    sound: Number(raw.sound || 1),
    name: String(raw.name || ''),
  };
}

function playDuplicateSound() {
  beep(880, 100, 'square');
  window.setTimeout(() => beep(440, 300, 'square'), 120);
}

function playSuccessBeeps(count) {
  const total = Math.max(1, Number(count || 1));
  const gap = 220;
  for (let i = 0; i < total; i += 1) {
    window.setTimeout(() => beep(900, 180, 'square'), i * gap);
  }
}

function playErrorBeep() {
  beep(440, 900, 'square');
}

let audioCtx;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep(freq, duration, type = 'square') {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  } catch (error) {
    console.warn('beep failed', error);
  }
}

async function apiRequest(action, payload = {}, method = 'POST') {
  const baseUrl = String(CONFIG.apiBaseUrl || '').trim();
  if (!baseUrl || baseUrl.includes('PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE')) {
    throw new Error('尚未設定 Apps Script Web App URL');
  }

  if (method === 'GET') {
    const url = new URL(baseUrl);
    url.searchParams.set('action', action);
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    });
    const response = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    return handleApiResponse(response);
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({ action, payload }),
  });
  return handleApiResponse(response);
}

async function handleApiResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`API 回應不是 JSON：${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(data && data.message ? data.message : `HTTP ${response.status}`);
  }

  if (data && data.ok === false) {
    throw new Error(data.message || 'API 執行失敗');
  }

  return data;
}

async function performSystemCheck() {
  try {
    addSystemLog('正在檢查雲端路徑...');
    const res = await apiRequest('ping', {}, 'GET');
    addSystemLog(res.message || '雲端檢查完成', 'st-ok');
  } catch (error) {
    console.error(error);
    addSystemLog(`路徑異常：${error.message}`, 'st-exp');
    updateSyncStatus('路徑異常');
  }
}

async function fetchSystemSettings() {
  try {
    const res = await apiRequest('getSystemSettings', {}, 'GET');
    if (res.settings) {
      state.systemSettings = Object.assign({}, state.systemSettings, res.settings);
      applyAutoSyncInterval(state.systemSettings.autoSyncMinutes);
      saveToStorage();
    }
  } catch (error) {
    console.warn('讀取參數失敗', error);
  }
}

async function fetchTodayStats() {
  try {
    const res = await apiRequest('getTodayStats', {}, 'GET');
    if (typeof res.todayVisitorCount !== 'undefined') {
      renderTodayVisitorCount(res.todayVisitorCount);
    } else {
      renderTodayVisitorCount();
    }

    if (Array.isArray(res.todayTicketSummary)) {
      state.todayTicketSummary = res.todayTicketSummary;
      if (state.ticketSummaryOpen) {
        renderTicketSummaryRows(state.todayTicketSummary);
      }
    }
  } catch (error) {
    console.warn('讀取當日進場人數失敗', error);
    renderTodayVisitorCount();
    if (state.ticketSummaryOpen) {
      renderTicketSummaryRows(state.todayTicketSummary);
    }
  }
}

function autoSync() {
  forceSync({ silent: true });
}

async function forceSync(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) updateSyncStatus('同步中...', true);

  const batch = [...state.uploadQueue];

  try {
    const res = await apiRequest('syncTodayData', { records: batch }, 'POST');

    const syncedKeys = new Set(batch.map((item) => `${item.time}|${item.content}|${item.raw || ''}`));
    state.uploadQueue = state.uploadQueue.filter(
      (item) => !syncedKeys.has(`${item.time}|${item.content}|${item.raw || ''}`)
    );

    if (Array.isArray(res.data)) {
      state.localHistory = res.data.map((row) => ({
        time: row[0] || '00:00:00',
        code: row[1] || '',
        status: 'ok',
        className: 'st-ok',
      }));
    }

    if (typeof res.todayVisitorCount !== 'undefined') {
      state.todayVisitorCount = Number(res.todayVisitorCount) || 0;
    } else {
      state.todayVisitorCount = getLocalSuccessCount();
    }

    if (Array.isArray(res.todayTicketSummary)) {
      state.todayTicketSummary = res.todayTicketSummary;
    }

    if (res.validation) state.localValidationDB = res.validation;
    if (res.whitelist) state.localWhiteListRules = res.whitelist;
    if (res.soundRules) state.localSoundRules = res.soundRules;
    if (res.settings) {
      state.systemSettings = Object.assign({}, state.systemSettings, res.settings);
      applyAutoSyncInterval(state.systemSettings.autoSyncMinutes);
    }

    saveToStorage();
    renderLogList();
    renderTodayVisitorCount();

    if (state.ticketSummaryOpen) {
      renderTicketSummaryRows(state.todayTicketSummary);
    }

    if (batch.some((item) => /^B\d{7}$/i.test(String(item.content || '').trim()))) {
      refreshAgencyAesBitmapIfChanged_();
    }

    if (!silent) {
      updateSyncStatus(res.message || '同步完成');
      window.setTimeout(() => updateSyncStatus('系統待機'), 3000);
    }
  } catch (error) {
    console.error(error);
    if (!silent) updateSyncStatus('同步失敗');
    addSystemLog(`同步失敗：${error.message}`, 'st-exp');
  } finally {
    if (!silent) {
      updateSyncStatus(els.syncText?.innerText || '系統待機', false);
    } else {
      updateSyncStatus('系統待機', false);
    }
  }
}

async function reportClientError(message, stack = '') {
  console.error(message, stack);
  try {
    await apiRequest('logClientError', { message, stack }, 'POST');
  } catch (error) {
    console.warn('上報錯誤失敗', error);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
