const WebSocket = require('ws');

const BASE = process.env.SELFTEST_BASE || 'http://localhost:8787';

async function httpJson(path, opts) {
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`${path} failed: ${json.error || 'unknown error'}`);
  }
  return json;
}

function wsUrlFromHttp(url) {
  const u = new URL(url);
  const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${u.host}`;
}

function onceMessage(ws, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error('timeout waiting for ws message'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(t);
      ws.off('message', onMsg);
      ws.off('error', onErr);
      ws.off('close', onClose);
    }

    function onErr(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error('ws closed'));
    }

    function onMsg(raw) {
      cleanup();
      resolve(raw.toString('utf8'));
    }

    ws.on('message', onMsg);
    ws.on('error', onErr);
    ws.on('close', onClose);
  });
}

function waitForJsonMessage(ws, predicate, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function onMsg(raw) {
      let msg = null;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    }

    function onErr(err) {
      cleanup();
      reject(err);
    }

    function onClose() {
      cleanup();
      reject(new Error('ws closed'));
    }

    const t = setInterval(() => {
      if (Date.now() - started > timeoutMs) {
        cleanup();
        reject(new Error('timeout waiting for matching ws message'));
      }
    }, 50);

    function cleanup() {
      clearInterval(t);
      ws.off('message', onMsg);
      ws.off('error', onErr);
      ws.off('close', onClose);
    }

    ws.on('message', onMsg);
    ws.on('error', onErr);
    ws.on('close', onClose);
  });
}

async function main() {
  console.log('[selftest] base:', BASE);

  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (!health.ok) throw new Error('health not ok');
  console.log('[selftest] health ok');

  const room = await httpJson('/api/room/create', { method: 'POST' });
  const { roomId, terminalId } = room.room;
  console.log('[selftest] room created:', roomId, 'terminalId=', terminalId);

  // 模拟 APP 连接
  const wsBase = wsUrlFromHttp(BASE);
  const appWs = new WebSocket(`${wsBase}/${terminalId}`);
  await new Promise((r, j) => {
    appWs.once('open', r);
    appWs.once('error', j);
  });
  const initBind = await waitForJsonMessage(appWs, (m) => m.type === 'bind' && m.message === 'targetId');
  const appId = initBind.clientId;
  console.log('[selftest] app connected, appId=', appId);

  // 回 bind
  appWs.send(JSON.stringify({
    type: 'bind',
    clientId: terminalId,
    targetId: appId,
    message: 'bind',
  }));
  await waitForJsonMessage(appWs, (m) => m.type === 'bind' && m.clientId === terminalId && m.targetId === appId && m.message === '200');
  console.log('[selftest] app bind ok');

  // 创建订单（DEV 模式会自动 paid）
  const order = await httpJson('/api/order/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId }),
  });
  const token = order.order.token;
  console.log('[selftest] order created, token=', token);

  const status = await httpJson(`/api/order/status?token=${encodeURIComponent(token)}`);
  console.log('[selftest] unlock status:', status.unlocked, 'remaining=', status.remainingSeconds);

  // 控制端连接
  const ctrlWs = new WebSocket(`${wsBase}/?token=${encodeURIComponent(token)}`);
  await new Promise((r, j) => {
    ctrlWs.once('open', r);
    ctrlWs.once('error', j);
  });
  await waitForJsonMessage(ctrlWs, (m) => m.type === 'hello' && m.role === 'controller');
  console.log('[selftest] controller hello ok');

  // strength set
  ctrlWs.send(JSON.stringify({ type: 'strength', action: 'set', channel: 1, value: 7 }));
  const strengthMsg = await waitForJsonMessage(appWs, (m) => m.type === 'msg' && String(m.message).startsWith('strength-1+2+7'));
  console.log('[selftest] strength forwarded:', strengthMsg.message);

  // pulse
  const wave = '["0A0A0A0A00000000","0A0A0A0A64646464"]';
  ctrlWs.send(JSON.stringify({ type: 'pulse', channel: 'A', time: 1, wave }));
  const pulseMsg = await waitForJsonMessage(appWs, (m) => m.type === 'msg' && String(m.message).startsWith('pulse-A:'));
  console.log('[selftest] pulse forwarded:', pulseMsg.message.slice(0, 24) + '...');
  await waitForJsonMessage(ctrlWs, (m) => m.type === 'notify' && m.message === '发送完毕');
  console.log('[selftest] pulse done notified');

  // stop
  ctrlWs.send(JSON.stringify({ type: 'stop' }));
  const msg1 = await waitForJsonMessage(appWs, (m) => m.type === 'msg' && (m.message === 'clear-1' || m.message === 'clear-2'));
  console.log('[selftest] stop forwarded:', msg1.message);

  ctrlWs.close();
  appWs.close();

  console.log('[selftest] PASS');
}

main().catch((err) => {
  console.error('[selftest] FAIL:', err);
  process.exit(1);
});
