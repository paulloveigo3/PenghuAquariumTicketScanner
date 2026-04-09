const CONFIG = {
  apiBaseUrl: 'https://script.google.com/macros/s/AKfycbz4Feb4Xd-WybwnCb2-Xl715QtMz87gefKyzG12eIllZGJM_p7kkguH7eKn-oI46wLsSg/exec',
  storagePrefix: 'ticketScanner_v3',
  defaultAutoSyncMinutes: 10,
  timezone: 'Asia/Taipei',
};

const state = {
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

  // camera
  scannerModalEl: null,
  scannerReaderEl: null,
  scannerCloseBtnEl: null,
  scannerStatusEl: null,
  scannerRunning: false,
  cameraLocked: false,
};

const els = {};

window.addEventListener('DOMContentLoaded', init);

function init() {
  cacheDom();
  ensureScannerModal();
  bindEvents();
  loadFromStorage();
  renderLogList();
  applyAutoSyncInterval(state.systemSettings.autoSyncMinutes);
  updateSyncStatus('待機中');
  hideUserInfo();
  setDisplay('READY', 'waiting');
  addSystemLog('前端已啟動');
  focusTrap();
  state.uiReady = true;

  performSystemCheck();
  fetchSystemSettings();

  if (
    Object.keys(state.localValidationDB).length === 0 ||
    Object.keys(state.localSoundRules).length === 0 ||
    state.localWhiteListRules.length === 0
  ) {
    forceSync();
  }
}

function cacheDom() {
  els.body = document.body;
  els.headerBar = document.getElementById('headerBar');
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

  els.btStatusBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleBluetooth();
  });

  els.cameraBtn?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await openCamera();
  });

  els.clearLogsBtn?.addEventListener('click', clearLogs);
  els.historyBtn?.addEventListener('click', toggleHistoryView);
  els.syncBtn?.addEventListener('click', forceSync);
  els.reloadBtn?.addEventListener('click', () => window.location.reload());
  els.manualConnectBtn?.addEventListener('click', manualConnect);
  els.closePairingBtn?.addEventListener('click', closePairing);
  els.confirmKeyboardBtn?.addEventListener('click', confirmKeyboard);
  els.qrFileInput?.addEventListener('change', handleImageScan);

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
      if (!state.scannerRunning) focusTrap();
    } else if (document.visibilityState === 'hidden' && state.scannerRunning) {
      await closeCameraScanner(false);
    }
  });
}

function handleDocumentClick(event) {
  if (els.keyboardModal?.classList.contains('active')) return;
  if (els.pairingModal?.classList.contains('active')) return;
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

function setDisplay(text, status = 'waiting') {
  if (!els.displayValue || !els.displayCard) return;
  els.displayValue.innerHTML = text;
  els.displayCard.className = `display-card ${status}`;
}

function showUserInfo(line1, line2) {
  if (!els.userInfoBox) return;
  els.userInfoLine1.innerText = line1 || '--';
  els.userInfoLine2.innerText = line2 || '--';
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

function normalizeInput(data) {
  if (typeof data !== 'string') return '';
  const trimmed = data.trim();
  if (!trimmed) return '';

  try {
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (
      trimmed.length >= 8 &&
      trimmed.length % 4 === 0 &&
      trimmed.includes('=') &&
      base64Regex.test(trimmed)
    ) {
      return decodeURIComponent(escape(window.atob(trimmed)));
    }
  } catch (error) {
    // ignore
  }

  return trimmed;
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

function processLocalLogic(rawInput, originalRaw = rawInput) {
  const { time, fullTime, todayYmdCompact } = getNowParts();
  hideUserInfo();

  if (rawInput.includes(',')) {
    processTicketLikeRecord(rawInput, originalRaw, time, fullTime, todayYmdCompact);
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

  playSuccessBeeps(1);
  setDisplay(escapeHtml(rawInput), 'success');
  const record = { code: rawInput, time, fullTime, status: 'ok', className: 'st-ok' };
  pushRecord(record, originalRaw);
}

function processTicketLikeRecord(rawInput, originalRaw, time, fullTime, todayYmdCompact) {
  const parts = rawInput.split(',').map((part) => part.trim());
  const code = parts[0] || '';
  const datePart = parts[1] || '';

  if (!code) {
    playErrorBeep();
    setDisplay('格式錯誤', 'error');
    addSystemLog('掃描到空白票號', 'st-exp');
    return;
  }

  if (datePart && datePart !== todayYmdCompact) {
    playErrorBeep();
    setDisplay(`過期票 (${escapeHtml(datePart)})`, 'error');
    addLogToUI({ time, code: `${code} (過期)`, className: 'st-exp' });
    return;
  }

  const isDuplicate = state.localHistory.some((item) => item.code === code && item.status === 'ok');
  const prefix = extractPrefix(code);
  const rule = resolveSoundRule(prefix);
  const ticketTypeName = rule.name || '';

  if (isDuplicate) {
    playDuplicateSound();
    setDisplay('重複入場', 'warning');
    if (ticketTypeName) showUserInfo(ticketTypeName, '重複票券');
    addLogToUI({ time, code, className: 'st-warn' });
    return;
  }

  playSuccessBeeps(rule.sound || 1);
  if (ticketTypeName) {
    setDisplay(`${escapeHtml(code)}<div style="font-size:1rem;color:#aaa;margin-top:6px;">${escapeHtml(ticketTypeName)}</div>`, 'success');
    showUserInfo(ticketTypeName, prefix || 'TICKET');
  } else {
    setDisplay(escapeHtml(code), 'success');
  }

  const record = { code, time, fullTime, status: 'ok', className: 'st-ok' };
  pushRecord(record, originalRaw);
}

function processValidationCard(rawInput, originalRaw, time, fullTime) {
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
  });
  saveToStorage();
  addLogToUI(record);
}

function createLogRow(item) {
  const div = document.createElement('div');
  div.className = `log-row ${item.className || ''}`;
  div.innerHTML = `
    <div class="log-time">${escapeHtml(item.time || 'SYS')}</div>
    <div class="log-data">${escapeHtml(item.code || '')}</div>
  `;
  return div;
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
  const ok = window.confirm('確定清除本機紀錄？這不會刪除雲端資料。');
  if (!ok) return;
  state.localHistory = [];
  state.uploadQueue = [];
  saveToStorage();
  renderLogList();
  addSystemLog('本機紀錄已清除');
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
  if (els.keyboardModal?.classList.contains('active')) return;
  if (state.scannerRunning) return;
  els.scanInputTrap?.focus({ preventScroll: true });
}

async function openCamera() {
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

function autoSync() {
  if (state.uploadQueue.length === 0) return;
  forceSync();
}

async function forceSync() {
  updateSyncStatus('同步中...', true);
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

    if (res.validation) state.localValidationDB = res.validation;
    if (res.whitelist) state.localWhiteListRules = res.whitelist;
    if (res.soundRules) state.localSoundRules = res.soundRules;
    if (res.settings) {
      state.systemSettings = Object.assign({}, state.systemSettings, res.settings);
      applyAutoSyncInterval(state.systemSettings.autoSyncMinutes);
    }

    saveToStorage();
    renderLogList();
    updateSyncStatus(res.message || '同步完成');
    window.setTimeout(() => updateSyncStatus('系統待機'), 3000);
  } catch (error) {
    console.error(error);
    updateSyncStatus('同步失敗');
    addSystemLog(`同步失敗：${error.message}`, 'st-exp');
  } finally {
    updateSyncStatus(els.syncText?.innerText || '系統待機', false);
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
