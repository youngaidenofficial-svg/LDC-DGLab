/* global QRCode */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const el = {
    baseUrl: $('#baseUrl'),
    unlockMinutes: $('#unlockMinutes'),
    money: $('#money'),
    mode: $('#mode'),

    createRoomCard: $('#createRoomCard'),
    btnCreateRoom: $('#btnCreateRoom'),
    createRoomResult: $('#createRoomResult'),
    shareUrl: $('#shareUrl'),
    hostUrl: $('#hostUrl'),
    hostQr: $('#hostQr'),
    wsUrlText: $('#wsUrlText'),

    roomCard: $('#roomCard'),
    roomId: $('#roomId'),
    appStatus: $('#appStatus'),
    controllerCount: $('#controllerCount'),
    viewerCount: $('#viewerCount'),

    hostSection: $('#hostSection'),
    hostQr2: $('#hostQr2'),
    wsUrlText2: $('#wsUrlText2'),
    shareUrl2: $('#shareUrl2'),

    token: $('#token'),
    btnSaveToken: $('#btnSaveToken'),
    btnClearToken: $('#btnClearToken'),
    unlockStatus: $('#unlockStatus'),
    unlockRemain: $('#unlockRemain'),
    btnPay: $('#btnPay'),
    btnRefresh: $('#btnRefresh'),

    pulseChannel: $('#pulseChannel'),
    pulsePreset: $('#pulsePreset'),
    pulseTime: $('#pulseTime'),
    pulseCustom: $('#pulseCustom'),
    btnSendPulse: $('#btnSendPulse'),
    btnStop: $('#btnStop'),

    strengthA: $('#strengthA'),
    strengthB: $('#strengthB'),
    softA: $('#softA'),
    softB: $('#softB'),

    log: $('#log'),
  };

  const PRESETS = [
    {
      id: 'breath',
      name: '呼吸',
      wave: JSON.stringify([
        '0A0A0A0A00000000',
        '0A0A0A0A14141414',
        '0A0A0A0A28282828',
        '0A0A0A0A3C3C3C3C',
        '0A0A0A0A50505050',
        '0A0A0A0A64646464',
        '0A0A0A0A64646464',
        '0A0A0A0A64646464',
        '0A0A0A0A00000000',
        '0A0A0A0A00000000',
        '0A0A0A0A00000000',
        '0A0A0A0A00000000',
      ]),
    },
    {
      id: 'tide',
      name: '潮汐',
      wave: JSON.stringify([
        '0A0A0A0A00000000',
        '0B0B0B0B10101010',
        '0D0D0D0D21212121',
        '0E0E0E0E32323232',
        '1010101042424242',
        '1212121253535353',
        '1313131364646464',
        '151515155C5C5C5C',
        '1616161654545454',
        '181818184C4C4C4C',
        '1A1A1A1A44444444',
        '1A1A1A1A00000000',
        '1B1B1B1B10101010',
        '1D1D1D1D21212121',
        '1E1E1E1E32323232',
        '2020202042424242',
        '2222222253535353',
        '2323232364646464',
        '252525255C5C5C5C',
        '2626262654545454',
        '282828284C4C4C4C',
        '2A2A2A2A44444444',
        '0A0A0A0A00000000',
      ]),
    },
    {
      id: 'combo',
      name: '连击',
      wave: JSON.stringify([
        '0A0A0A0A64646464',
        '0A0A0A0A00000000',
        '0A0A0A0A64646464',
        '0A0A0A0A42424242',
        '0A0A0A0A21212121',
        '0A0A0A0A00000000',
        '0A0A0A0A00000000',
        '0A0A0A0A00000000',
      ]),
    },
    {
      id: 'knead',
      name: '快速按捏',
      wave: JSON.stringify([
        '0A0A0A0A00000000',
        '0A0A0A0A64646464',
        '0A0A0A0A00000000',
        '0A0A0A0A64646464',
        '0A0A0A0A00000000',
        '0A0A0A0A64646464',
        '0A0A0A0A00000000',
        '0A0A0A0A64646464',
      ]),
    },
  ];

  // ---------------- utils ----------------

  function log(...args) {
    const line = `[${new Date().toLocaleTimeString()}] ${args.map(String).join(' ')}`;
    if (el.log) {
      el.log.textContent = (el.log.textContent + '\n' + line).trimStart();
      el.log.scrollTop = el.log.scrollHeight;
    }
    console.log(...args);
  }

  function show(elm) { elm && elm.classList.remove('hidden'); }
  function hide(elm) { elm && elm.classList.add('hidden'); }

  function wsBaseUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/`;
  }

  function renderQr(containerEl, text) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    // 调试：显示二维码文本
    console.log('[QRCode] 生成二维码文本:', text);
    log('二维码内容:', text);
    // 添加白色边框样式
    containerEl.style.cssText = 'background: white; padding: 12px; border: 4px solid white; display: inline-block;';
    // eslint-disable-next-line no-new
    new QRCode(containerEl, {
      text,
      width: 200,
      height: 200,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H,
    });
  }

  function setAppStatus(connected) {
    el.appStatus.textContent = connected ? '已连接' : '未连接';
    el.appStatus.className = 'status-indicator ' + (connected ? 'status-online' : 'status-offline');
  }

  function setUnlockStatus({ unlocked, remainingSeconds }) {
    if (!el.unlockStatus) return;
    el.unlockStatus.textContent = unlocked ? '已解锁' : '未解锁/已到期';
    el.unlockStatus.className = 'status-indicator ' + (unlocked ? 'status-online' : 'status-locked');
    if (unlocked) {
      el.unlockRemain.textContent = `剩余 ${remainingSeconds} 秒`;
    } else {
      el.unlockRemain.textContent = '请先支付解锁';
    }

    updateControlAccess();
  }

  function setControlsEnabled(enabled) {
    const disable = !enabled;
    if (el.btnSendPulse) el.btnSendPulse.disabled = disable;
    if (el.btnStop) el.btnStop.disabled = disable;
    if (el.pulseChannel) el.pulseChannel.disabled = disable;
    if (el.pulsePreset) el.pulsePreset.disabled = disable;
    if (el.pulseTime) el.pulseTime.disabled = disable;
    if (el.pulseCustom) el.pulseCustom.disabled = disable;

    const setA = document.getElementById('setA');
    const setB = document.getElementById('setB');
    if (setA) setA.disabled = disable;
    if (setB) setB.disabled = disable;

    document.querySelectorAll('[data-strength]').forEach((btn) => {
      btn.disabled = disable;
    });
  }

  function updateControlAccess() {
    const enabled = role === 'controller' && !!lastUnlock.unlocked;
    setControlsEnabled(enabled);
  }

  function parseStrengthMessage(msg) {
    // strength-11+7+100+35
    const m = String(msg || '');
    if (!m.startsWith('strength-')) return null;
    const body = m.slice('strength-'.length);
    const parts = body.split('+').map((x) => parseInt(x, 10));
    if (parts.length < 4 || parts.some((x) => Number.isNaN(x))) return null;
    return { a: parts[0], b: parts[1], softA: parts[2], softB: parts[3] };
  }

  function getRoomTokenKey(roomId) {
    return `dglab_token_${roomId}`;
  }

  // ---------------- main state ----------------

  let roomId = null;
  let hostKey = null;
  let ws = null;
  let role = 'none'; // viewer | controller
  let unlockTimer = null;
  let lastUnlock = { unlocked: false, remainingSeconds: 0 };

  function closeWs() {
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
    ws = null;
    role = 'none';
  }

  function connectWsViewer() {
    closeWs();
    const url = new URL(wsBaseUrl());
    url.searchParams.set('roomId', roomId);
    ws = new WebSocket(url.toString());
    role = 'viewer';
    updateControlAccess();
    log('WS(观众) 连接中...', url.toString());

    ws.onopen = () => log('WS(观众) 已连接');
    ws.onclose = () => log('WS(观众) 已断开');
    ws.onerror = () => log('WS(观众) 出错');
    ws.onmessage = (ev) => onWsMessage(ev.data);
  }

  function connectWsController(token) {
    closeWs();
    const url = new URL(wsBaseUrl());
    url.searchParams.set('token', token);
    ws = new WebSocket(url.toString());
    role = 'controller';
    updateControlAccess();
    log('WS(控制者) 连接中...', url.toString());

    ws.onopen = () => log('WS(控制者) 已连接');
    ws.onclose = () => log('WS(控制者) 已断开');
    ws.onerror = () => log('WS(控制者) 出错');
    ws.onmessage = (ev) => onWsMessage(ev.data);
  }

  function onWsMessage(raw) {
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      log('WS消息(非JSON):', raw);
      return;
    }

    if (msg.type === 'hello') {
      setAppStatus(!!msg.appConnected);
      el.controllerCount.textContent = String(msg.controllerCount ?? 0);
      el.viewerCount.textContent = String(msg.viewerCount ?? 0);
      if (msg.unlock) {
        lastUnlock = { unlocked: !!msg.unlock.unlocked, remainingSeconds: msg.unlock.remainingSeconds || 0 };
        setUnlockStatus(lastUnlock);
        startUnlockCountdown();
      }
      return;
    }

    if (msg.type === 'room') {
      if (msg.event === 'counts') {
        setAppStatus(!!msg.appConnected);
        el.controllerCount.textContent = String(msg.controllerCount ?? 0);
        el.viewerCount.textContent = String(msg.viewerCount ?? 0);
      } else {
        log('房间事件:', msg.event);
      }
      return;
    }

    if (msg.type === 'app') {
      const payload = msg.payload;
      const s = parseStrengthMessage(payload?.message);
      if (s) {
        el.strengthA.textContent = String(s.a);
        el.strengthB.textContent = String(s.b);
        el.softA.textContent = String(s.softA);
        el.softB.textContent = String(s.softB);
      }
      log('设备消息:', payload?.message || JSON.stringify(payload));
      return;
    }

    if (msg.type === 'error') {
      log('错误:', msg.error || JSON.stringify(msg));
      return;
    }

    if (msg.type === 'notify') {
      log('通知:', msg.message);
      return;
    }

    if (msg.type === 'ok') {
      log('OK:', msg.event || '', JSON.stringify(msg));
      return;
    }

    if (msg.type === 'status') {
      setAppStatus(!!msg.appConnected);
      el.controllerCount.textContent = String(msg.controllerCount ?? 0);
      el.viewerCount.textContent = String(msg.viewerCount ?? 0);
      if (msg.unlock) {
        lastUnlock = { unlocked: !!msg.unlock.unlocked, remainingSeconds: msg.unlock.remainingSeconds || 0 };
        setUnlockStatus(lastUnlock);
        startUnlockCountdown();
      }
      return;
    }

    log('WS消息:', JSON.stringify(msg));
  }

  function startUnlockCountdown() {
    if (unlockTimer) {
      clearInterval(unlockTimer);
      unlockTimer = null;
    }
    if (!lastUnlock.unlocked) return;
    unlockTimer = setInterval(() => {
      lastUnlock.remainingSeconds = Math.max(0, (lastUnlock.remainingSeconds || 0) - 1);
      if (lastUnlock.remainingSeconds <= 0) {
        lastUnlock.unlocked = false;
        clearInterval(unlockTimer);
        unlockTimer = null;
      }
      setUnlockStatus(lastUnlock);
    }, 1000);
  }

  function wsSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('WS未连接，无法发送');
      return;
    }
    ws.send(JSON.stringify(obj));
  }

  // ---------------- HTTP actions ----------------

  async function apiJson(url, opts) {
    const res = await fetch(url, opts);
    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.error || '请求失败');
    }
    return json;
  }

  async function createRoom() {
    const json = await apiJson('/api/room/create', { method: 'POST' });
    show(el.createRoomResult);
    el.shareUrl.value = json.shareUrl;
    el.hostUrl.value = json.hostUrl;
    el.wsUrlText.textContent = json.wsUrl;
    renderQr(el.hostQr, json.dglabQrText);
    log('房间已创建:', json.room.roomId);
  }

  async function loadRoomInfo() {
    let url = `/api/room/${encodeURIComponent(roomId)}`;
    if (hostKey) {
      url += `?hostKey=${encodeURIComponent(hostKey)}`;
    }
    const json = await apiJson(url);
    el.roomId.textContent = json.room.roomId;
    setAppStatus(!!json.appConnected);
    el.controllerCount.textContent = String(json.controllerCount || 0);
    el.viewerCount.textContent = String(json.viewerCount || 0);

    if (json.host) {
      show(el.hostSection);
      const share = `${location.origin}/?roomId=${encodeURIComponent(roomId)}`;
      el.shareUrl2.value = share;
      el.wsUrlText2.textContent = json.host.wsUrl;
      renderQr(el.hostQr2, json.host.dglabQrText);
    } else {
      hide(el.hostSection);
    }
  }

  async function createOrderAndPay() {
    const json = await apiJson('/api/order/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
    });
    const token = json.order.token;
    el.token.value = token;
    localStorage.setItem(getRoomTokenKey(roomId), token);
    log('订单已创建:', json.order.outTradeNo);

    // 立刻切换为控制者连接（即使未支付也可接收错误提示/状态）
    connectWsController(token);
    loadUnlockStatusFromServer();

    // 打开支付页面（尽量不打断当前房间页）
    const payUrl = json.redirectUrl;
    const w = window.open(payUrl, '_blank');
    if (!w) {
      // 可能被浏览器拦截弹窗，回退到当前页跳转
      location.href = payUrl;
      return;
    }
    log('已打开支付页面，请完成支付后点击“刷新状态”。');
  }

  async function refreshUnlockStatus() {
    const token = String(el.token.value || '').trim();
    if (!token) {
      log('请先输入或支付获取 token');
      return;
    }
    const json = await apiJson('/api/order/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    lastUnlock = { unlocked: !!json.unlocked, remainingSeconds: json.remainingSeconds || 0 };
    setUnlockStatus(lastUnlock);
    startUnlockCountdown();
    log('解锁状态已刷新');
  }

  async function loadUnlockStatusFromServer() {
    const token = String(el.token.value || '').trim();
    if (!token) return;
    try {
      const json = await apiJson(`/api/order/status?token=${encodeURIComponent(token)}`);
      lastUnlock = { unlocked: !!json.unlocked, remainingSeconds: json.remainingSeconds || 0 };
      setUnlockStatus(lastUnlock);
      startUnlockCountdown();
    } catch (err) {
      // ignore
    }
  }

  // ---------------- event wiring ----------------

  function initPresets() {
    el.pulsePreset.innerHTML = '';
    for (const p of PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      el.pulsePreset.appendChild(opt);
    }
  }

  function getSelectedWave() {
    const custom = String(el.pulseCustom.value || '').trim();
    if (custom) return custom;
    const presetId = el.pulsePreset.value;
    const preset = PRESETS.find((p) => p.id === presetId);
    return preset ? preset.wave : PRESETS[0].wave;
  }

  function bindButtons() {
    el.btnCreateRoom?.addEventListener('click', () => {
      createRoom().catch((e) => alert(e.message));
    });

    document.body.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        const sel = copyBtn.getAttribute('data-copy');
        const input = document.querySelector(sel);
        const text = input?.value || '';
        navigator.clipboard.writeText(text).then(() => {
          log('已复制');
        }).catch(() => {
          log('复制失败，请手动复制');
        });
        return;
      }

      const strengthBtn = e.target.closest('[data-strength]');
      if (strengthBtn) {
        const action = strengthBtn.getAttribute('data-strength');
        const ch = parseInt(strengthBtn.getAttribute('data-ch'), 10);
        if (action === 'set') {
          const inputSel = strengthBtn.getAttribute('data-input');
          const value = parseInt(document.querySelector(inputSel).value, 10);
          wsSend({ type: 'strength', action: 'set', channel: ch, value });
        } else if (action === 'inc') {
          wsSend({ type: 'strength', action: 'inc', channel: ch, value: 1 });
        } else {
          wsSend({ type: 'strength', action: 'dec', channel: ch, value: 1 });
        }
      }
    });

    el.btnSaveToken?.addEventListener('click', () => {
      const t = String(el.token.value || '').trim();
      if (!t) {
        alert('token 不能为空');
        return;
      }
      localStorage.setItem(getRoomTokenKey(roomId), t);
      log('token 已保存');
      connectWsController(t);
      loadUnlockStatusFromServer();
    });

    el.btnClearToken?.addEventListener('click', () => {
      el.token.value = '';
      localStorage.removeItem(getRoomTokenKey(roomId));
      setUnlockStatus({ unlocked: false, remainingSeconds: 0 });
      connectWsViewer();
      log('token 已清除');
    });

    el.btnPay?.addEventListener('click', () => {
      createOrderAndPay().catch((e) => alert(e.message));
    });

    el.btnRefresh?.addEventListener('click', () => {
      refreshUnlockStatus().catch((e) => alert(e.message));
    });

    el.btnSendPulse?.addEventListener('click', () => {
      const channel = el.pulseChannel.value === 'B' ? 'B' : 'A';
      const time = parseInt(el.pulseTime.value || '5', 10);
      const wave = getSelectedWave();
      wsSend({ type: 'pulse', channel, time, wave });
    });

    el.btnStop?.addEventListener('click', () => {
      wsSend({ type: 'stop' });
    });
  }

  async function init() {
    initPresets();
    bindButtons();

    const cfg = await (await fetch('/api/public-config')).json();
    el.baseUrl.textContent = cfg.baseUrl;
    el.unlockMinutes.textContent = String(cfg.unlockMinutes);
    el.money.textContent = String(cfg.money);
    el.mode.textContent = cfg.devBypassPayment ? 'DEV（跳过支付）' : '生产（需要支付）';

    const params = new URLSearchParams(location.search);
    roomId = String(params.get('roomId') || '').trim() || null;
    hostKey = String(params.get('hostKey') || '').trim() || null;
    const tokenFromUrl = String(params.get('token') || '').trim();

    if (!roomId) {
      // 首页：创建房间
      show(el.createRoomCard);
      hide(el.roomCard);
      return;
    }

    // 房间页
    hide(el.createRoomCard);
    show(el.roomCard);
    await loadRoomInfo();

    // token：URL 优先，否则从 localStorage
    const saved = localStorage.getItem(getRoomTokenKey(roomId)) || '';
    const token = tokenFromUrl || saved;
    if (token) {
      el.token.value = token;
      localStorage.setItem(getRoomTokenKey(roomId), token);
      connectWsController(token);
      await loadUnlockStatusFromServer();

      // 每 10 秒拉一次本地订单状态（不访问第三方支付网关；若 notify 成功会自动更新）
      setInterval(() => {
        loadUnlockStatusFromServer().catch(() => { /* ignore */ });
      }, 10000);
    } else {
      setUnlockStatus({ unlocked: false, remainingSeconds: 0 });
      connectWsViewer();
    }

    // 每 15 秒拉一次房间状态（避免 websocket 断开时页面不刷新）
    setInterval(() => {
      loadRoomInfo().catch(() => { /* ignore */ });
    }, 15000);
  }

  init().catch((err) => {
    console.error(err);
    alert(err.message || String(err));
  });
})();
