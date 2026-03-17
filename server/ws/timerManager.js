const logger = console;

class TimerManager {
  constructor() {
    // key: roomId-channel -> task
    this.timers = new Map();
  }

  /**
   * @param {object} opts
   * @param {string} opts.roomId
   * @param {'A'|'B'} opts.channel
   * @param {WebSocket} opts.targetWs
   * @param {object} opts.pulseMessage  发给 APP 的 JSON 对象（已包含 type/msg/clientId/targetId）
   * @param {object} opts.clearMessage  发给 APP 的 clear 指令 JSON
   * @param {number} opts.totalSends
   * @param {number} opts.intervalMs
   * @param {WebSocket|null} [opts.sourceWs]
   */
  sendRoomPulse({ roomId, channel, targetWs, pulseMessage, clearMessage, totalSends, intervalMs, sourceWs = null }) {
    const timerKey = `${roomId}-${channel}`;

    // 如果已有任务，覆盖并先清除 APP 队列
    if (this.timers.has(timerKey)) {
      const oldTask = this.timers.get(timerKey);
      this._clearTask(timerKey);

      // 清空 APP 波形队列
      this._safeSend(targetWs, clearMessage);

      // 延迟 150ms 避免 clear 晚于 pulse
      setTimeout(() => {
        this._startTask({ timerKey, roomId, channel, targetWs, pulseMessage, clearMessage, totalSends, intervalMs, sourceWs });
      }, 150);
      return;
    }

    this._startTask({ timerKey, roomId, channel, targetWs, pulseMessage, clearMessage, totalSends, intervalMs, sourceWs });
  }

  clearRoom(roomId) {
    const keys = [];
    for (const k of this.timers.keys()) {
      if (k.startsWith(`${roomId}-`)) keys.push(k);
    }
    keys.forEach((k) => this._clearTask(k));
  }

  _startTask({ timerKey, roomId, channel, targetWs, pulseMessage, clearMessage, totalSends, intervalMs, sourceWs }) {
    const task = {
      timerKey,
      roomId,
      channel,
      targetWs,
      pulseMessage: JSON.parse(JSON.stringify(pulseMessage)),
      clearMessage: JSON.parse(JSON.stringify(clearMessage)),
      remaining: totalSends,
      intervalMs,
      sourceWs,
      timerId: null,
      startedAt: new Date(),
    };

    // 先发第一条
    this._safeSend(targetWs, task.pulseMessage);
    task.remaining--;

    if (task.remaining <= 0) {
      this._notifyDone(sourceWs, task);
      return;
    }

    const timerId = setInterval(() => {
      if (!targetWs || targetWs.readyState !== 1) {
        logger.warn(`[${timerKey}] 目标连接已断开，停止发送`);
        clearInterval(timerId);
        this.timers.delete(timerKey);
        return;
      }

      this._safeSend(targetWs, task.pulseMessage);
      task.remaining--;
      if (task.remaining <= 0) {
        clearInterval(timerId);
        this.timers.delete(timerKey);
        this._notifyDone(sourceWs, task);
      }
    }, intervalMs);

    task.timerId = timerId;
    this.timers.set(timerKey, task);
  }

  _notifyDone(sourceWs, task) {
    if (!sourceWs || sourceWs.readyState !== 1) return;
    try {
      sourceWs.send(JSON.stringify({
        type: 'notify',
        roomId: task.roomId,
        message: '发送完毕',
      }));
    } catch {
      // ignore
    }
  }

  _clearTask(timerKey) {
    const task = this.timers.get(timerKey);
    if (!task) return;

    if (task.timerId) {
      clearInterval(task.timerId);
    }
    this.timers.delete(timerKey);
  }

  _safeSend(ws, messageObj) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(messageObj));
    } catch {
      // ignore
    }
  }
}

module.exports = { TimerManager };
