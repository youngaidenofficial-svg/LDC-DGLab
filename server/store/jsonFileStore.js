const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * 一个极简 JSON 文件存储。
 * 注意：仅适用于轻量场景；并发写入会有风险，但对本项目足够。
 */
class JsonFileStore {
  /**
   * @param {object} opts
   * @param {string} opts.filePath
   * @param {number} opts.unlockMinutes
   */
  constructor({ filePath, unlockMinutes }) {
    this.filePath = filePath;
    this.unlockMinutes = unlockMinutes;
    this._data = { version: 1, orders: {}, tokenIndex: {}, rooms: {}, terminalIndex: {} };
    this._loaded = false;
    this._saveTimer = null;
  }

  load() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this._data = JSON.parse(raw);
      } else {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        this._flushSync();
      }
    } catch (err) {
      // 避免因为文件损坏导致服务无法启动
      this._data = { version: 1, orders: {}, tokenIndex: {}, rooms: {}, terminalIndex: {} };
      this._flushSync();
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flushSync();
    }, 200);
  }

  _flushSync() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this._data, null, 2), 'utf8');
  }

  // ---------------- Orders ----------------

  createOrder({ money, name, roomId }) {
    this.load();
    const outTradeNo = `M${Date.now()}-${randomUUID().slice(0, 8)}`;
    const token = randomUUID().replace(/-/g, '');

    const order = {
      outTradeNo,
      token,
      roomId: roomId || null,
      name,
      money: String(money),
      status: 'created',
      createdAt: nowIso(),
      paidAt: null,
      unlockUntil: null,
      tradeNo: null,
    };
    this._data.orders[outTradeNo] = order;
    this._data.tokenIndex[token] = outTradeNo;
    this._scheduleSave();
    return order;
  }

  getOrder(outTradeNo) {
    this.load();
    return this._data.orders[outTradeNo] || null;
  }

  getOrderByToken(token) {
    this.load();
    const outTradeNo = this._data.tokenIndex[token];
    if (!outTradeNo) return null;
    return this._data.orders[outTradeNo] || null;
  }

  markOrderPaid({ outTradeNo, tradeNo, money }) {
    this.load();
    const order = this._data.orders[outTradeNo];
    if (!order) return null;
    if (order.status === 'paid') return order;

    const paidAt = new Date();
    const unlockUntil = addMinutes(paidAt, this.unlockMinutes);

    order.status = 'paid';
    order.tradeNo = tradeNo || order.tradeNo;
    order.money = money !== undefined ? String(money) : order.money;
    order.paidAt = paidAt.toISOString();
    order.unlockUntil = unlockUntil.toISOString();
    this._scheduleSave();
    return order;
  }

  /**
   * @returns {{unlocked:boolean, unlockUntil:string|null, remainingSeconds:number}}
   */
  getUnlockStatusByToken(token) {
    const order = this.getOrderByToken(token);
    if (!order) {
      return { unlocked: false, unlockUntil: null, remainingSeconds: 0 };
    }
    if (order.status !== 'paid' || !order.unlockUntil) {
      return { unlocked: false, unlockUntil: null, remainingSeconds: 0 };
    }
    const until = new Date(order.unlockUntil).getTime();
    const now = Date.now();
    const remainingSeconds = Math.max(0, Math.floor((until - now) / 1000));
    return { unlocked: remainingSeconds > 0, unlockUntil: order.unlockUntil, remainingSeconds };
  }

  // ---------------- Rooms ----------------

  createRoom() {
    this.load();
    const roomId = randomUUID();
    const hostKey = randomUUID().replace(/-/g, '');
    const terminalId = randomUUID();
    const room = {
      roomId,
      hostKey,
      terminalId,
      createdAt: nowIso(),
    };
    this._data.rooms[roomId] = room;
    this._data.terminalIndex[terminalId] = roomId;
    this._scheduleSave();
    return room;
  }

  getRoom(roomId) {
    this.load();
    return this._data.rooms[roomId] || null;
  }

  getRoomByTerminalId(terminalId) {
    this.load();
    const roomId = this._data.terminalIndex[terminalId];
    if (!roomId) return null;
    return this._data.rooms[roomId] || null;
  }
}

module.exports = { JsonFileStore };
