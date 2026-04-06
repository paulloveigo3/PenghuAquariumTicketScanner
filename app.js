(() => {
  'use strict';

  let wakeLock = null;
  let html5QrcodeScanner = null;
  let isConnectedState = false;
  let localHistory = [];
  let uploadQueue = [];
  let localValidationDB = {};
  let localWhiteListRules = [];
  let localSoundRules = {};
  let autoSyncTimer = null;
  let systemSettings = { autoSyncMinutes: 10 };
  let scanBuffer = '';
  let scanTimeout = null;
  let audioCtx = null;

  const $ = (id) => document.getElementById(id);

  const server = {
    available() {
      return typeof google !== 'undefined' && google.script && google.script.run;
    },

    call(method, ...args) {
      return new Promise((resolve, reject) => {
        if (!this.available()) {
          reject(new Error('google.script.run unavailable'));
          return;
        }

        try {
          google.script.run
            .withSuccessHandler(resolve)
            .withFailureHandler((err) => reject(normalizeError(err)))
            [method](...args);
        } catch (err) {
          reject(normalizeError(err));
        }
      });
    },

    log(message, stack = '') {
      if (!this.available()) return;
      try {
        google.script.run.logToServer(message, stack);
      } catch (err) {
        console.warn('logToServer failed:', err);
      }
    }
  };

  function normalizeError(err) {
    if (err instanceof Error) return err;
    if (typeof err === 'string') return new Error(err);
    return new Error(err && err.message ? err.message : JSON.stringify(err));
  }

  function ensureAudioCtx() {
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioCtx = new AudioCtor();
    }
    return audioCtx;
  }

  function beep(freq, duration, type = 'square') {
    const ctx = ensureAudioCtx();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  }

  function playSuccessBeeps(count) {
    const safeCount = Math.max(1, Number(count) || 1);
    for (let i = 0; i < safeCount; i += 1) {
      setTimeout(() => beep(900, 180, 'square'), i * 220);
    }
  }

  function playDuplicateSound() {
    beep(880, 100, 'square');
    setTimeout(() => beep(440, 300, 'square'), 120);
  }

  function playErrorBeep() {
    beep(440, 1200, 'square');
  }

  function sanitizeAutoSyncMinutes(value) {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) return 10;
    return Math.min(Math.max(num, 1), 1440);
  }

  function applyAutoSyncInterval(minutes) {
    const safeMinutes = sanitizeAutoSyncMinutes(minutes);
    systemSettings.autoSyncMinutes = safeMinutes;

    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = setInterval(autoSync, safeMinutes * 60 * 1000);
  }

  function todayKey() {
    return new Date().toDateString();
  }

  function saveToStorage() {
    localStorage.setItem('appLastRunDate', todayKey());
    localStorage.setItem('localHistory', JSON.stringify(localHistory));
    localStorage.setItem('uploadQueue', JSON.stringify(uploadQueue));
    localStorage.setItem('localValidationDB', JSON.stringify(localValidationDB));
    localStorage.setItem('localWhiteListRules', JSON.stringify(localWhiteListRules));
    localStorage.setItem('localSoundRules', JSON.stringify(localSoundRules));
    localStorage.setItem('systemSettings', JSON.stringify(systemSettings));
  }

  function loadFromStorage() {
    try {
      const lastRunDate = localStorage.getItem('appLastRunDate');

      const storedSoundRules = localStorage.getItem('localSoundRules');
      if (storedSoundRules) localSoundRules = JSON.parse(storedSoundRules);

      const storedSettings = localStorage.getItem('systemSettings');
      if (storedSettings) {
        systemSettings = Object.assign(systemSettings, JSON.parse(storedSettings));
      }

      if (lastRunDate !== todayKey()) {
        localHistory = [];
        uploadQueue = [];
      } else {
        const hist = localStorage.getItem('localHistory');
        const queue = localStorage.getItem('uploadQueue');
        if (hist) localHistory = JSON.parse(hist);
        if (queue) uploadQueue = JSON.parse(queue);
      }

      const db = localStorage.getItem('localValidationDB');
      if (db) localValidationDB = JSON.parse(db);

      const rules = localStorage.getItem('localWhiteListRules');
      if (rules) localWhiteListRules = JSON.parse(rules);

      saveToStorage();
    } catch (err) {
      console.error('Storage Error:', err);
      server.log(`[Storage Error] ${err.message}`, err.stack || '');
    }
  }

  function updateSyncStatus(text, blinking = false) {
    $('syncText').innerText = text;
    $('syncDot').classList.toggle('syncing', Boolean(blinking));
  }

  function setDisplayState(state, message, subText = '') {
    const displayCard = $('displayCard');
    const displayValue = $('displayValue');

    displayCard.className = 'display-card';
    if (state) displayCard.classList.add(state);

    if (subText) {
      displayValue.innerHTML = '';
      const main = document.createElement('div');
      main.textContent = message;
      const sub = document.createElement('div');
      sub.className = 'ticket-subtitle';
      sub.textContent = subText;
      displayValue.append(main, sub);
    } else {
      displayValue.textContent = message;
    }
  }

  function setUserInfo(line1 = '', line2 = '') {
    const box = $('userInfoBox');
    if (!line1 && !line2) {
      box.style.display = 'none';
      $('userInfoLine1').textContent = '--';
      $('userInfoLine2').textContent = '--';
      return;
    }

    $('userInfoLine1').textContent = line1;
    $('userInfoLine2').textContent = line2;
    box.style.display = 'block';
  }

  function addLogRow(targetList, item) {
    const row = document.createElement('div');
    row.className = `log-row ${item.className || ''}`.trim();

    const time = document.createElement('div');
    time.className = 'log-time';
    time.textContent = item.time || '--:--:--';

    const data = document.createElement('div');
    data.className = 'log-data';
    data.textContent = item.code || item.data || '';

    row.append(time, data);
    targetList.prepend(row);
  }

  function addLogToUI(item) {
    addLogRow($('logList'), item);
  }

  function addSystemLog(status, message) {
    let className = 'st-ok';
    if (status === 'error') className = 'st-exp';
    if (status === 'warning') className = 'st-warn';
    addLogToUI({ time: 'SYS', code: message, className });
  }

  function renderLogList() {
    const list = $('logList');
    list.innerHTML = '';
    localHistory.forEach((item) => {
      const row = document.createElement('div');
      row.className = `log-row ${item.className || ''}`.trim();

      const time = document.createElement('div');
      time.className = 'log-time';
      time.textContent = item.time || '--:--:--';

      const data = document.createElement('div');
      data.className = 'log-data';
      data.textContent = item.code || '';

      row.append(time, data);
      list.appendChild(row);
    });
  }

  function clearLogs() {
    if (!confirm('確定清除紀錄? (這不會刪除雲端資料)')) return;
    localHistory = [];
    uploadQueue = [];
    saveToStorage();
    renderLogList();
    setDisplayState('', 'READY');
    setUserInfo();
  }

  function maybeDecodeBase64(input) {
    try {
      const normalized = input.trim();
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (
        normalized.length > 0 &&
        normalized.length % 4 === 0 &&
        normalized.includes('=') &&
        base64Regex.test(normalized)
      ) {
        const binary = atob(normalized);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch (err) {
      return input;
    }
    return input;
  }

  function getNowRecordTime() {
    return new Date().toLocaleTimeString('zh-TW', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function getNowFullTime() {
    return new Date().toLocaleString('zh-TW', { hour12: false });
  }

  function getTodayYYYYMMDD() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }

  function isValidationTarget(rawInput) {
    return localWhiteListRules.some((rule) =>
      rawInput.toUpperCase().startsWith(String(rule.prefix || '').toUpperCase()) &&
      rawInput.length === Number(rule.length)
    );
  }

  function recordSuccess(code, originalRaw, nowTime, fullTimeStr, className = 'st-ok') {
    const record = {
      code,
      time: nowTime,
      fullTime: fullTimeStr,
      status: 'ok',
      className
    };

    localHistory.unshift(record);
    uploadQueue.push({ time: fullTimeStr, content: code, raw: originalRaw });
    saveToStorage();
    addLogToUI(record);
  }

  function handleTicketRecord(rawInput, originalRaw, nowTime, fullTimeStr) {
    const parts = rawInput.split(',');
    const code = (parts[0] || '').trim();
    const datePart = (parts[1] || '').trim();

    if (!code) {
      playErrorBeep();
      setUserInfo();
      setDisplayState('error', '格式錯誤');
      addLogToUI({ time: nowTime, code: '票券格式錯誤', className: 'st-exp' });
      return;
    }

    if (datePart && datePart !== getTodayYYYYMMDD()) {
      playErrorBeep();
      setUserInfo();
      setDisplayState('error', `過期票 (${datePart})`);
      addLogToUI({ time: nowTime, code: `${code} (過期)`, className: 'st-exp' });
      return;
    }

    const isDuplicate = localHistory.some((item) => item.code === code && item.status === 'ok');
    const match = code.match(/^([A-Z]+)/);
    const prefix = match ? match[1] : '';
    const rule = localSoundRules[prefix] || {};
    const beepCount = Number(rule.sound) || 1;
    const ticketTypeName = rule.name || '';

    if (isDuplicate) {
      playDuplicateSound();
      setDisplayState('warning', '重複入場');
      setUserInfo(ticketTypeName || prefix || '票券資料', '重複票券');
      addLogToUI({ time: nowTime, code, className: 'st-warn' });
      return;
    }

    playSuccessBeeps(beepCount);
    setDisplayState('success', code, ticketTypeName);
    if (ticketTypeName) {
      setUserInfo(ticketTypeName, `嗶聲 ${beepCount} 次`);
    } else {
      setUserInfo();
    }

    recordSuccess(code, originalRaw, nowTime, fullTimeStr);
  }

  function handleValidationRecord(rawInput, originalRaw, nowTime, fullTimeStr) {
    const validUser = localValidationDB[rawInput];
    const isDuplicate = localHistory.some((item) => item.code === rawInput && item.status === 'ok');

    if (!validUser) {
      playErrorBeep();
      setDisplayState('error', '無效卡片');
      setUserInfo('查無資料', '請洽管理員');
      addLogToUI({ time: nowTime, code: `${rawInput} (無效)`, className: 'st-exp' });
      return;
    }

    const userLine1 = [validUser.name, validUser.gender, validUser.birth].filter(Boolean).join(' | ');
    const userLine2 = validUser.id || '';

    if (isDuplicate) {
      playDuplicateSound();
      setDisplayState('warning', '重複入場');
      setUserInfo(userLine1 || '已驗證卡片', userLine2 || '重複入場');
      addLogToUI({ time: nowTime, code: `${rawInput} (重複)`, className: 'st-warn' });
      return;
    }

    playSuccessBeeps(1);
    setDisplayState('success', '驗證通過');
    setUserInfo(userLine1 || '驗證通過', userLine2);
    recordSuccess(rawInput, originalRaw, nowTime, fullTimeStr);
  }

  function handleGenericRecord(rawInput, originalRaw, nowTime, fullTimeStr) {
    playSuccessBeeps(1);
    setDisplayState('success', rawInput);
    setUserInfo();
    recordSuccess(rawInput, originalRaw, nowTime, fullTimeStr);
  }

  function processLocalLogic(rawInput, originalRaw = rawInput) {
    const nowTime = getNowRecordTime();
    const fullTimeStr = getNowFullTime();

    setUserInfo();

    if (rawInput.includes(',')) {
      handleTicketRecord(rawInput, originalRaw, nowTime, fullTimeStr);
      return;
    }

    if (isValidationTarget(rawInput)) {
      handleValidationRecord(rawInput, originalRaw, nowTime, fullTimeStr);
      return;
    }

    handleGenericRecord(rawInput, originalRaw, nowTime, fullTimeStr);
  }

  function handleScanInput(data, source = 'keyboard') {
    if (!data) return;

    const trimmed = String(data).trim();
    if (!trimmed) return;

    if (source === 'keyboard' && /[^\x00-\x7F]/.test(trimmed)) {
      setDisplayState('error', '輸入法錯誤!');
      $('keyboard-modal').style.display = 'flex';
      return;
    }

    const decodedData = maybeDecodeBase64(trimmed);
    processLocalLogic(decodedData, trimmed);
  }

  async function fetchSystemSettings() {
    if (!server.available()) {
      updateSyncStatus('靜態模式');
      return;
    }

    try {
      const res = await server.call('getSystemSettings');
      if (res && typeof res.autoSyncMinutes !== 'undefined') {
        systemSettings.autoSyncMinutes = sanitizeAutoSyncMinutes(res.autoSyncMinutes);
        saveToStorage();
        applyAutoSyncInterval(systemSettings.autoSyncMinutes);
      }
    } catch (err) {
      console.warn('讀取參數設置失敗，沿用目前同步間隔', err);
      server.log(`[讀取參數失敗] ${err.message}`, err.stack || '');
    }
  }

  async function performSystemCheck() {
    if (!server.available()) {
      addSystemLog('warning', '靜態模式：未連接 Apps Script');
      updateSyncStatus('靜態模式');
      return;
    }

    addSystemLog('warning', '正在檢查雲端路徑...');

    try {
      const res = await server.call('checkEnvironment');
      if (res.status === 'success') {
        addSystemLog('success', '路徑連接成功');
      } else {
        addSystemLog('error', res.msg || '路徑異常');
        updateSyncStatus('路徑異常');
      }
    } catch (err) {
      addSystemLog('error', '網路連線失敗');
      updateSyncStatus('連線失敗');
      server.log(`[環境檢查失敗] ${err.message}`, err.stack || '');
    }
  }

  function mergeCloudHistory(rows) {
    if (!Array.isArray(rows)) return;
    localHistory = rows.map((row) => ({
      time: row[0],
      code: row[1],
      status: 'ok',
      className: 'st-ok',
      statusText: '雲端'
    }));
  }

  async function forceSync() {
    if (!server.available()) {
      updateSyncStatus('GitHub 模式');
      addSystemLog('warning', '目前不在 Apps Script 內，無法同步雲端');
      return;
    }

    updateSyncStatus('同步中...', true);
    const batch = [...uploadQueue];

    try {
      const res = await server.call('syncTodayData', batch);

      if (res.status !== 'success') {
        updateSyncStatus('同步異常');
        addSystemLog('error', res.msg || '同步失敗');
        return;
      }

      const batchKeys = new Set(batch.map((b) => `${b.time}|${b.content}|${b.raw || ''}`));
      uploadQueue = uploadQueue.filter((item) => !batchKeys.has(`${item.time}|${item.content}|${item.raw || ''}`));

      if (Array.isArray(res.data) && res.data.length > 0) {
        mergeCloudHistory(res.data);
      }

      if (res.validation) localValidationDB = res.validation;
      if (res.whitelist) localWhiteListRules = res.whitelist;
      if (res.soundRules) localSoundRules = res.soundRules;
      if (res.settings) {
        systemSettings = Object.assign(systemSettings, res.settings);
        applyAutoSyncInterval(systemSettings.autoSyncMinutes);
      }

      saveToStorage();
      renderLogList();
      updateSyncStatus(res.msg || '同步完成');
      setTimeout(() => updateSyncStatus('系統待機'), 3000);
    } catch (err) {
      updateSyncStatus('連線中斷');
      addSystemLog('error', `同步失敗: ${err.message}`);
      server.log(`[同步失敗] ${err.message}`, err.stack || '');
    } finally {
      $('syncDot').classList.remove('syncing');
    }
  }

  function autoSync() {
    if (uploadQueue.length === 0) return;
    forceSync();
  }

  function toggleHistoryView() {
    document.body.classList.toggle('history-mode');
  }

  function focusTrap() {
    const trap = $('scanInputTrap');
    if (trap) trap.focus();
  }

  function confirmKeyboard() {
    $('keyboard-modal').style.display = 'none';
    document.addEventListener('click', focusTrap);
    setDisplayState('', 'READY');
    focusTrap();
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {
      wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try {
      await wakeLock.release();
    } catch (_) {
      // ignore
    } finally {
      wakeLock = null;
    }
  }

  function manualConnect() {
    isConnectedState = true;
    $('pairing-modal').style.display = 'none';
    $('pairing-modal').classList.remove('active');
    $('btStatusBtn').classList.add('bt-connected');
    $('btText').innerText = '已連線';
    setDisplayState('', 'LINKED');

    setTimeout(() => {
      if ($('displayValue').textContent === 'LINKED') {
        setDisplayState('', 'READY');
      }
    }, 1500);

    requestWakeLock();
    setTimeout(() => {
      document.addEventListener('click', focusTrap);
      focusTrap();
    }, 100);
  }

  async function setConnectionState(connected) {
    isConnectedState = connected;
    $('btStatusBtn').classList.toggle('bt-connected', connected);
    $('btText').innerText = connected ? '已連線' : '未連線';

    if (connected) {
      setDisplayState('', 'LINKED');
      setTimeout(() => {
        if ($('displayValue').textContent === 'LINKED') {
          setDisplayState('', 'READY');
        }
      }, 1000);
      await requestWakeLock();
    } else {
      await releaseWakeLock();
    }
  }

  function toggleBluetooth() {
    if (!isConnectedState) {
      $('pairing-modal').style.display = 'flex';
      $('pairing-modal').classList.add('active');
      document.removeEventListener('click', focusTrap);

      setTimeout(() => {
        const trap = $('scanInputTrap');
        trap.value = '';
        trap.focus();
      }, 50);
      return;
    }

    setConnectionState(false);
  }

  function openCamera() {
    try {
      const ctx = ensureAudioCtx();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      document.removeEventListener('click', focusTrap);
      const fileInput = $('qr-file-input');
      if (!fileInput) throw new Error('qr-file-input not found');
      fileInput.click();
    } catch (err) {
      console.error('相機呼叫失敗:', err);
      server.log(`[相機喚醒失敗] ${err.message}`, err.stack || '');
      setDisplayState('error', '相機無法啟動');
    }
  }

  function handleImageScan(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      setTimeout(() => document.addEventListener('click', focusTrap), 200);
      return;
    }

    setDisplayState('', '解析中...');

    try {
      if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode('reader');
      }

      html5QrcodeScanner.scanFile(file, true)
        .then((decodedText) => {
          handleScanInput(decodedText, 'camera');
          event.target.value = '';
          setTimeout(() => document.addEventListener('click', focusTrap), 200);
        })
        .catch((err) => {
          console.warn('圖片解析失敗:', err);
          alert('⚠️ 無法辨識圖片中的 QR Code，請確認對焦清晰且無嚴重反光後重試。');
          setDisplayState('', 'READY');
          event.target.value = '';
          setTimeout(() => document.addEventListener('click', focusTrap), 200);
        });
    } catch (err) {
      console.error('相機掃碼初始化失敗:', err);
      server.log(`[相機掃碼初始化失敗] ${err.message}`, err.stack || '');
      setDisplayState('error', '相機初始化失敗');
    }
  }

  function bindEvents() {
    $('historyToggleHeader').addEventListener('click', toggleHistoryView);
    $('btStatusBtn').addEventListener('click', (event) => {
      event.stopPropagation();
      toggleBluetooth();
    });
    $('openCameraBtn').addEventListener('click', (event) => {
      event.stopPropagation();
      openCamera();
    });
    $('historyBtn').addEventListener('click', toggleHistoryView);
    $('syncBtn').addEventListener('click', forceSync);
    $('reloadBtn').addEventListener('click', () => window.location.reload());
    $('clearLogsBtn').addEventListener('click', clearLogs);
    $('manualConnectBtn').addEventListener('click', manualConnect);
    $('confirmKeyboardBtn').addEventListener('click', confirmKeyboard);
    $('pairing-modal').addEventListener('click', focusTrap);
    $('qr-file-input').addEventListener('change', handleImageScan);
  }

  function bindScannerKeyboard() {
    document.addEventListener('keydown', (e) => {
      if ($('pairing-modal').classList.contains('active')) return;

      if (e.key === 'Enter') {
        if (scanBuffer.length > 0) {
          const finalValue = scanBuffer.trim();
          scanBuffer = '';

          if (finalValue === 'GATELINK_PAIRING_ACTION') {
            manualConnect();
          } else {
            handleScanInput(finalValue);
          }
        }
        return;
      }

      if (e.key.length === 1) {
        scanBuffer += e.key;

        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          scanBuffer = '';
        }, 100);
      }
    });
  }

  function bindGlobalErrorLogging() {
    window.onerror = function(message, source, lineno, colno, error) {
      const errMsg = `[全域錯誤] ${message} (行: ${lineno})`;
      const errStack = error ? error.stack : '';
      console.error(errMsg, errStack);
      server.log(errMsg, errStack);
      return false;
    };

    window.addEventListener('unhandledrejection', (event) => {
      const reason = normalizeError(event.reason);
      const errMsg = `[Promise 錯誤] ${reason.message}`;
      console.error(errMsg, reason.stack || '');
      server.log(errMsg, reason.stack || '');
    });
  }

  async function init() {
    loadFromStorage();
    renderLogList();
    bindEvents();
    bindScannerKeyboard();
    bindGlobalErrorLogging();
    applyAutoSyncInterval(systemSettings.autoSyncMinutes);
    updateSyncStatus('待機中');
    await performSystemCheck();
    await fetchSystemSettings();

    if (
      Object.keys(localValidationDB).length === 0 ||
      Object.keys(localSoundRules).length === 0 ||
      localWhiteListRules.length === 0
    ) {
      forceSync();
    }
  }

  window.toggleHistoryView = toggleHistoryView;
  window.forceSync = forceSync;
  window.confirmKeyboard = confirmKeyboard;
  window.manualConnect = manualConnect;
  window.openCamera = openCamera;
  window.handleImageScan = handleImageScan;
  window.clearLogs = clearLogs;
  window.handleScanInput = handleScanInput;

  document.addEventListener('DOMContentLoaded', init);
})();