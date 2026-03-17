const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const express = require('express');
const WebSocket = require('ws');

const config = require('./config');
const { JsonFileStore } = require('./store/jsonFileStore');
const { calcSign, verifySign, buildAutoSubmitFormHtml, queryOrder } = require('./pay/epay');
const { TimerManager } = require('./ws/timerManager');

// 生产环境关键配置校验（DEV_BYPASS_PAYMENT=true 时会跳过）
try {
  config.validateForProd();
} catch (err) {
  console.error(String(err?.message || err));
  process.exit(1);
}

const store = new JsonFileStore({
  // 将数据文件放在项目根目录的 data/ 下，便于 Docker volume 挂载且不会覆盖代码目录
  filePath: path.join(__dirname, '..', 'data', 'store.json'),
  unlockMinutes: config.app.unlockMinutes,
});
const timerManager = new TimerManager();

/**
 * 运行时房间状态（不落盘）。
 * roomId -> { roomId, terminalId, app: { ws, appId, boundAt }|null, webClients: Set<WebSocket>, controllers: Map<WebSocket, {token, controllerId}>, viewers: Set<WebSocket> }
 */
const roomsRuntime = new Map();

function ensureRuntime(room) {
  const roomId = room.roomId;
  if (!roomsRuntime.has(roomId)) {
    roomsRuntime.set(roomId, {
      roomId,
      terminalId: room.terminalId,
      app: null,
      webClients: new Set(),
      controllers: new Map(),
      viewers: new Set(),
    });
  }
  const rt = roomsRuntime.get(roomId);
  // terminalId 可能随着 store 数据恢复而变化，确保同步
  rt.terminalId = room.terminalId;
  return rt;
}

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function broadcastToWeb(roomId, obj) {
  const rt = roomsRuntime.get(roomId);
  if (!rt) return;
  for (const ws of rt.webClients) safeSend(ws, obj);
}

function getPublicBaseUrl(req) {
  // 优先使用请求推断（适配反向代理），其次使用配置
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0].trim();
  const protocol = proto || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host) return `${protocol}://${host}`;
  return config.app.baseUrl;
}

function getPublicWsUrl(req, terminalId) {
  const base = new URL(getPublicBaseUrl(req));
  // 根据请求协议自动判断 ws/wss
  const wsProto = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = base.host || base.hostname;
  return `${wsProto}//${host}/${terminalId}`;
}

function makeDglabQrText(wsUrl) {
  return `https://www.dungeon-lab.com/app-download.php#DGLAB-SOCKET#${wsUrl}`;
}

function getUnlockByToken(token) {
  if (config.app.devBypassPayment) {
    // DEV 模式：有 token 就视为解锁（方便联调）
    const order = store.getOrderByToken(token);
    if (!order) return { unlocked: false, unlockUntil: null, remainingSeconds: 0, order: null };
    return {
      unlocked: true,
      unlockUntil: new Date(Date.now() + config.app.unlockMinutes * 60 * 1000).toISOString(),
      remainingSeconds: config.app.unlockMinutes * 60,
      order,
    };
  }

  const order = store.getOrderByToken(token);
  if (!order) return { unlocked: false, unlockUntil: null, remainingSeconds: 0, order: null };
  const status = store.getUnlockStatusByToken(token);
  return { ...status, order };
}

function parseJsonSafe(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// -------------------- HTTP --------------------

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 静态站点
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/public-config', (req, res) => {
  res.json({
    ok: true,
    money: config.app.orderMoney,
    unlockMinutes: config.app.unlockMinutes,
    devBypassPayment: config.app.devBypassPayment,
    baseUrl: getPublicBaseUrl(req),
  });
});

app.post('/api/room/create', (req, res) => {
  const room = store.createRoom();
  const wsUrl = getPublicWsUrl(req, room.terminalId);
  res.json({
    ok: true,
    room: {
      roomId: room.roomId,
      createdAt: room.createdAt,
      // 仅创建者需要的密钥（用于重新获取二维码/终端信息）
      hostKey: room.hostKey,
      terminalId: room.terminalId,
    },
    wsUrl,
    dglabQrText: makeDglabQrText(wsUrl),
    hostUrl: `${getPublicBaseUrl(req)}/?roomId=${encodeURIComponent(room.roomId)}&hostKey=${encodeURIComponent(room.hostKey)}`,
    shareUrl: `${getPublicBaseUrl(req)}/?roomId=${encodeURIComponent(room.roomId)}`,
  });
});

app.get('/api/room/:roomId', (req, res) => {
  const room = store.getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ ok: false, error: '房间不存在' });
    return;
  }
  const rt = ensureRuntime(room);
  const hostKey = String(req.query?.hostKey || '').trim();
  const isHost = hostKey && hostKey === room.hostKey;

  let hostInfo = null;
  if (isHost) {
    const wsUrl = getPublicWsUrl(req, room.terminalId);
    hostInfo = {
      terminalId: room.terminalId,
      wsUrl,
      dglabQrText: makeDglabQrText(wsUrl),
    };
  }
  res.json({
    ok: true,
    room: {
      roomId: room.roomId,
      createdAt: room.createdAt,
    },
    host: hostInfo,
    appConnected: !!rt.app,
    controllerCount: rt.controllers.size,
    viewerCount: rt.viewers.size,
  });
});

app.post('/api/order/create', (req, res) => {
  const roomId = String(req.body?.roomId || '').trim();
  if (!roomId) {
    res.status(400).json({ ok: false, error: '缺少 roomId' });
    return;
  }
  const room = store.getRoom(roomId);
  if (!room) {
    res.status(404).json({ ok: false, error: '房间不存在' });
    return;
  }

  const order = store.createOrder({
    roomId,
    money: config.app.orderMoney,
    name: config.app.orderName,
  });

  if (config.app.devBypassPayment) {
    store.markOrderPaid({ outTradeNo: order.outTradeNo, tradeNo: 'DEV', money: order.money });
  }

  res.json({
    ok: true,
    order: {
      outTradeNo: order.outTradeNo,
      token: order.token,
      money: order.money,
      roomId: order.roomId,
    },
    redirectUrl: `/pay/redirect?out_trade_no=${encodeURIComponent(order.outTradeNo)}`,
    unlockMinutes: config.app.unlockMinutes,
  });
});

app.get('/api/order/status', (req, res) => {
  const token = String(req.query?.token || '').trim();
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 token' });
    return;
  }
  const { unlocked, remainingSeconds, unlockUntil, order } = getUnlockByToken(token);
  if (!order) {
    res.status(404).json({ ok: false, error: '订单不存在' });
    return;
  }
  res.json({
    ok: true,
    unlocked,
    remainingSeconds,
    unlockUntil,
    order: {
      outTradeNo: order.outTradeNo,
      roomId: order.roomId,
      status: order.status,
      money: order.money,
      paidAt: order.paidAt,
    },
  });
});

app.post('/api/order/refresh', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 token' });
    return;
  }
  const order = store.getOrderByToken(token);
  if (!order) {
    res.status(404).json({ ok: false, error: '订单不存在' });
    return;
  }

  if (config.app.devBypassPayment) {
    store.markOrderPaid({ outTradeNo: order.outTradeNo, tradeNo: 'DEV', money: order.money });
  } else {
    if (!config.pay.pid || !config.pay.key) {
      res.status(500).json({ ok: false, error: '未配置 PAY_PID / PAY_KEY' });
      return;
    }
    try {
      const q = await queryOrder({
        gatewayBase: config.pay.gatewayBase,
        pid: config.pay.pid,
        key: config.pay.key,
        outTradeNo: order.outTradeNo,
      });
      if (q.paid) {
        store.markOrderPaid({
          outTradeNo: order.outTradeNo,
          tradeNo: q.raw?.trade_no,
          money: q.raw?.money,
        });
      }
    } catch (err) {
      res.status(502).json({ ok: false, error: `查询失败：${String(err?.message || err)}` });
      return;
    }
  }

  const status = getUnlockByToken(token);
  res.json({ ok: true, ...status, order: status.order ? {
    outTradeNo: status.order.outTradeNo,
    roomId: status.order.roomId,
    status: status.order.status,
    money: status.order.money,
    paidAt: status.order.paidAt,
    unlockUntil: status.order.unlockUntil,
  } : null });
});

app.get('/pay/redirect', (req, res) => {
  const outTradeNo = String(req.query?.out_trade_no || '').trim();
  if (!outTradeNo) {
    res.status(400).send('Missing out_trade_no');
    return;
  }
  const order = store.getOrder(outTradeNo);
  if (!order) {
    res.status(404).send('Order not found');
    return;
  }

  if (config.app.devBypassPayment) {
    // DEV：不跳转第三方支付，直接回首页
    res.redirect(`/?roomId=${encodeURIComponent(order.roomId)}&token=${encodeURIComponent(order.token)}`);
    return;
  }

  // 构造支付字段
  const fields = {
    pid: config.pay.pid,
    type: config.pay.type,
    out_trade_no: order.outTradeNo,
    name: order.name,
    money: order.money,
  };
  if (config.pay.notifyUrl) fields.notify_url = config.pay.notifyUrl;
  if (config.pay.returnUrl) fields.return_url = config.pay.returnUrl;
  fields.sign = calcSign(fields, config.pay.key);
  fields.sign_type = 'MD5';

  const actionUrl = `${config.pay.gatewayBase.replace(/\/$/, '')}/pay/submit.php`;
  const html = buildAutoSubmitFormHtml({
    actionUrl,
    fields,
    title: '正在跳转到支付页面...',
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/api/pay/notify', (req, res) => {
  // pay.md：异步通知方式为 HTTP GET
  const params = { ...req.query };
  const outTradeNo = String(params.out_trade_no || '').trim();
  const tradeNo = String(params.trade_no || '').trim();
  const tradeStatus = String(params.trade_status || '').trim();

  if (!outTradeNo || !tradeNo) {
    res.status(400).send('fail');
    return;
  }
  if (tradeStatus !== 'TRADE_SUCCESS') {
    res.status(200).send('fail');
    return;
  }
  if (!verifySign(params, config.pay.key)) {
    res.status(200).send('fail');
    return;
  }

  const order = store.getOrder(outTradeNo);
  if (!order) {
    // 对方会重试；这里仍返回 fail
    res.status(200).send('fail');
    return;
  }

  store.markOrderPaid({ outTradeNo, tradeNo, money: params.money });
  res.status(200).send('success');
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// -------------------- WebSocket --------------------

const server = http.createServer(app);
const wss = new WebSocket.WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  // 让 ws 自己处理协议升级
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

function closeWs(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    // ignore
  }
}

function getRoomRtByRoomId(roomId) {
  const room = store.getRoom(roomId);
  if (!room) return null;
  return ensureRuntime(room);
}

function getRoomRtByTerminalId(terminalId) {
  const room = store.getRoomByTerminalId(terminalId);
  if (!room) return null;
  return ensureRuntime(room);
}

function sendRoomCounts(roomId) {
  const rt = roomsRuntime.get(roomId);
  if (!rt) return;
  broadcastToWeb(roomId, {
    type: 'room',
    event: 'counts',
    controllerCount: rt.controllers.size,
    viewerCount: rt.viewers.size,
    appConnected: !!rt.app,
  });
}

function requireApp(rt, ws) {
  if (!rt.app || !rt.app.ws || rt.app.ws.readyState !== WebSocket.OPEN) {
    safeSend(ws, { type: 'error', error: '设备未连接（请让 DG-LAB APP 扫码连接）' });
    return null;
  }
  return rt.app;
}

function sendToApp(rt, messageStr) {
  const appConn = rt.app;
  if (!appConn) return false;
  safeSend(appConn.ws, {
    type: 'msg',
    clientId: rt.terminalId,
    targetId: appConn.appId,
    message: messageStr,
  });
  return true;
}

function handleControllerMessage(rt, ws, ctx, msg) {
  // 频率限制（粗略）
  const nowSec = Math.floor(Date.now() / 1000);
  if (ctx.rate.sec !== nowSec) {
    ctx.rate.sec = nowSec;
    ctx.rate.count = 0;
  }
  ctx.rate.count++;
  if (ctx.rate.count > config.ws.maxControlMsgsPerSecond) {
    safeSend(ws, { type: 'error', error: '操作过于频繁，请稍后再试' });
    return;
  }

  // 解锁校验
  const unlock = getUnlockByToken(ctx.token);
  if (!unlock.order) {
    safeSend(ws, { type: 'error', error: 'token 无效' });
    return;
  }
  if (unlock.order.roomId !== rt.roomId) {
    safeSend(ws, { type: 'error', error: 'token 不属于该房间' });
    return;
  }
  if (!unlock.unlocked) {
    safeSend(ws, { type: 'error', error: '未解锁或已到期，请先支付解锁' });
    return;
  }

  // 必须有设备连接
  if (!requireApp(rt, ws)) return;

  switch (msg.type) {
    case 'pulse': {
      const channel = msg.channel === 'B' ? 'B' : 'A';
      const time = Math.min(
        Math.max(1, parseInt(msg.time || config.ws.punishmentDuration, 10)),
        config.ws.maxPulseSeconds
      );
      const wave = String(msg.wave || '').trim();
      if (!wave.startsWith('[') || wave.length > 1600) {
        safeSend(ws, { type: 'error', error: '波形数据不合法或过长' });
        return;
      }

      const sendTime = time;
      const totalSends = config.ws.punishmentTime * sendTime;
      const intervalMs = 1000 / config.ws.punishmentTime;

      const pulseMessage = {
        type: 'msg',
        clientId: rt.terminalId,
        targetId: rt.app.appId,
        message: `pulse-${channel}:${wave}`,
      };
      const clearMessage = {
        type: 'msg',
        clientId: rt.terminalId,
        targetId: rt.app.appId,
        message: `clear-${channel === 'A' ? '1' : '2'}`,
      };

      timerManager.sendRoomPulse({
        roomId: rt.roomId,
        channel,
        targetWs: rt.app.ws,
        pulseMessage,
        clearMessage,
        totalSends,
        intervalMs,
        sourceWs: ws,
      });

      safeSend(ws, { type: 'ok', event: 'pulse_queued', channel, time: sendTime });
      return;
    }

    case 'strength': {
      // channel: 1(A) / 2(B)
      const ch = msg.channel === 2 ? 2 : 1;
      const action = String(msg.action || '').toLowerCase();
      let mode = 2;
      let value = 0;
      if (action === 'inc') {
        mode = 1;
        value = Math.max(1, Math.min(200, parseInt(msg.value || 1, 10)));
      } else if (action === 'dec') {
        mode = 0;
        value = Math.max(1, Math.min(200, parseInt(msg.value || 1, 10)));
      } else {
        mode = 2;
        value = Math.max(0, Math.min(200, parseInt(msg.value || 0, 10)));
      }

      sendToApp(rt, `strength-${ch}+${mode}+${value}`);
      safeSend(ws, { type: 'ok', event: 'strength_sent', channel: ch, mode, value });
      return;
    }

    case 'clear': {
      const channel = msg.channel === 'B' ? 'B' : 'A';
      sendToApp(rt, `clear-${channel === 'A' ? '1' : '2'}`);
      safeSend(ws, { type: 'ok', event: 'clear_sent', channel });
      return;
    }

    case 'stop': {
      // 清空 + 强度归零
      sendToApp(rt, 'clear-1');
      sendToApp(rt, 'clear-2');
      sendToApp(rt, 'strength-1+2+0');
      sendToApp(rt, 'strength-2+2+0');
      timerManager.clearRoom(rt.roomId);
      safeSend(ws, { type: 'ok', event: 'stopped' });
      return;
    }

    case 'status': {
      safeSend(ws, {
        type: 'status',
        roomId: rt.roomId,
        appConnected: !!rt.app,
        controllerCount: rt.controllers.size,
        viewerCount: rt.viewers.size,
        unlock: {
          unlocked: unlock.unlocked,
          remainingSeconds: unlock.remainingSeconds,
          unlockUntil: unlock.unlockUntil,
        },
      });
      return;
    }

    default:
      safeSend(ws, { type: 'error', error: '未知消息类型' });
  }
}

wss.on('connection', (ws, req) => {
  const u = new URL(req.url || '/', 'http://localhost');
  const token = String(u.searchParams.get('token') || '').trim();
  const roomIdQuery = String(u.searchParams.get('roomId') || '').trim();
  const pathname = u.pathname || '/';

  // 1) 控制端：带 token
  if (token) {
    const unlock = getUnlockByToken(token);
    const order = unlock.order;
    if (!order) {
      safeSend(ws, { type: 'error', error: 'token 无效' });
      closeWs(ws, 1008, 'invalid token');
      return;
    }

    const rt = getRoomRtByRoomId(order.roomId);
    if (!rt) {
      safeSend(ws, { type: 'error', error: '房间不存在' });
      closeWs(ws, 1008, 'room not found');
      return;
    }

    rt.webClients.add(ws);
    rt.controllers.set(ws, { token, controllerId: randomUUID() });
    sendRoomCounts(rt.roomId);

    safeSend(ws, {
      type: 'hello',
      role: 'controller',
      roomId: rt.roomId,
      appConnected: !!rt.app,
      controllerCount: rt.controllers.size,
      viewerCount: rt.viewers.size,
      unlock: {
        unlocked: unlock.unlocked,
        remainingSeconds: unlock.remainingSeconds,
        unlockUntil: unlock.unlockUntil,
      },
    });

    const ctx = {
      token,
      rate: { sec: 0, count: 0 },
    };

    ws.on('message', (raw) => {
      const text = raw.toString('utf8');
      const parsed = parseJsonSafe(text);
      if (!parsed.ok) {
        safeSend(ws, { type: 'error', error: '消息必须是 JSON' });
        return;
      }
      handleControllerMessage(rt, ws, ctx, parsed.data);
    });

    ws.on('close', () => {
      rt.controllers.delete(ws);
      rt.viewers.delete(ws);
      rt.webClients.delete(ws);
      sendRoomCounts(rt.roomId);
    });
    return;
  }

  // 2) APP 端：路径为 /<terminalId>
  if (pathname !== '/' && pathname.length > 1) {
    const terminalId = pathname.slice(1);
    const rt = getRoomRtByTerminalId(terminalId);
    if (!rt) {
      closeWs(ws, 1008, 'unknown terminal');
      return;
    }

    // 替换已有 APP 连接
    if (rt.app?.ws && rt.app.ws.readyState === WebSocket.OPEN) {
      closeWs(rt.app.ws, 1000, 'replaced');
    }

    const appId = randomUUID();
    rt.app = { ws, appId, boundAt: null };
    broadcastToWeb(rt.roomId, { type: 'room', event: 'app_connected' });
    sendRoomCounts(rt.roomId);

    // 发送初始 bind（告知 APP 它的 targetId）
    safeSend(ws, {
      type: 'bind',
      clientId: appId,
      targetId: '',
      message: 'targetId',
    });

    ws.on('message', (raw) => {
      const text = raw.toString('utf8');
      const parsed = parseJsonSafe(text);
      if (!parsed.ok) return;
      const msg = parsed.data;

      // 处理 bind
      if (msg?.type === 'bind') {
        if (String(msg.clientId) !== rt.terminalId) {
          safeSend(ws, { type: 'bind', clientId: rt.terminalId, targetId: appId, message: '400' });
          return;
        }
        if (String(msg.targetId) !== appId) {
          safeSend(ws, { type: 'bind', clientId: rt.terminalId, targetId: appId, message: '400' });
          return;
        }
        rt.app.boundAt = new Date().toISOString();
        safeSend(ws, { type: 'bind', clientId: rt.terminalId, targetId: appId, message: '200' });
        broadcastToWeb(rt.roomId, { type: 'room', event: 'app_bound' });
        sendRoomCounts(rt.roomId);
        return;
      }

      // 广播 APP 消息给所有网页端（用于强度回传/反馈按钮等）
      broadcastToWeb(rt.roomId, {
        type: 'app',
        payload: msg,
      });
    });

    ws.on('close', () => {
      // 清空 app 状态
      if (rt.app?.ws === ws) {
        rt.app = null;
      }
      timerManager.clearRoom(rt.roomId);
      broadcastToWeb(rt.roomId, { type: 'room', event: 'app_disconnected' });
      sendRoomCounts(rt.roomId);
    });

    return;
  }

  // 3) 观众/房主页面：仅订阅状态（不控制）
  const roomId = roomIdQuery;
  if (!roomId) {
    safeSend(ws, { type: 'error', error: '缺少 roomId 或 token' });
    closeWs(ws, 1008, 'missing roomId');
    return;
  }
  const rt = getRoomRtByRoomId(roomId);
  if (!rt) {
    safeSend(ws, { type: 'error', error: '房间不存在' });
    closeWs(ws, 1008, 'room not found');
    return;
  }
  rt.webClients.add(ws);
  rt.viewers.add(ws);
  sendRoomCounts(rt.roomId);
  safeSend(ws, {
    type: 'hello',
    role: 'viewer',
    roomId: rt.roomId,
    appConnected: !!rt.app,
    controllerCount: rt.controllers.size,
    viewerCount: rt.viewers.size,
  });

  ws.on('message', () => {
    // viewer 不处理任何消息
  });

  ws.on('close', () => {
    rt.controllers.delete(ws);
    rt.viewers.delete(ws);
    rt.webClients.delete(ws);
    sendRoomCounts(rt.roomId);
  });
});

// WS ping/pong keepalive
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch { /* ignore */ }
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// -------------------- start --------------------

server.listen(config.app.port, () => {
  console.log(`[server] listening on :${config.app.port}`);
  if (!config.app.devBypassPayment) {
    console.log(`[pay] gateway=${config.pay.gatewayBase}`);
    console.log(`[pay] pid=${config.pay.pid ? '***已配置***' : '(未配置)'}`);
    console.log(`[pay] notify_url=${config.pay.notifyUrl || '(未配置)'}`);
  } else {
    console.log('[dev] DEV_BYPASS_PAYMENT=true（不会跳转支付）');
  }
});
