require('dotenv').config();

function required(name, value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function int(name, value, fallback) {
  const v = value === undefined ? fallback : parseInt(value, 10);
  if (Number.isNaN(v)) throw new Error(`Invalid int env: ${name}`);
  return v;
}

module.exports = {
  app: {
    port: int('PORT', process.env.PORT, 8787),
    baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 8787}`,
    adminApiKey: process.env.ADMIN_API_KEY || '',
    devBypassPayment: String(process.env.DEV_BYPASS_PAYMENT || '').toLowerCase() === 'true',
    // 一次付款解锁分钟数
    unlockMinutes: int('UNLOCK_MINUTES', process.env.UNLOCK_MINUTES, 30),
    // 订单金额（积分数量），最多 2 位小数
    orderMoney: process.env.ORDER_MONEY || '10',
    orderName: process.env.ORDER_NAME || 'DG-LAB 脉冲控制解锁',
  },
  pay: {
    gatewayBase: process.env.PAY_GATEWAY_BASE || 'https://credit.linux.do/epay',
    pid: process.env.PAY_PID || '',
    key: process.env.PAY_KEY || '',
    // 注意：pay.md 说明 notify_url 以“创建应用时设置”为准。
    notifyUrl: process.env.PAY_NOTIFY_URL || '',
    returnUrl: process.env.PAY_RETURN_URL || '',
    type: 'epay',
  },
  ws: {
    // WebSocket 服务使用同一个 HTTP 端口（Upgrade）。
    // 防刷：同一个 token 每秒允许的控制消息数（粗略限制）
    maxControlMsgsPerSecond: int('WS_MAX_MSGS_PER_SEC', process.env.WS_MAX_MSGS_PER_SEC, 5),
    // 单次波形发送 time 上限（秒）
    maxPulseSeconds: int('WS_MAX_PULSE_SECONDS', process.env.WS_MAX_PULSE_SECONDS, 10),
    // 波形发送频率（每秒发送次数）— 对应 DG-LAB socket/v2 backend 的 DEFAULT_PUNISHMENT_TIME
    punishmentTime: int('DEFAULT_PUNISHMENT_TIME', process.env.DEFAULT_PUNISHMENT_TIME, 1),
    // 默认波形持续（秒）
    punishmentDuration: int('DEFAULT_PUNISHMENT_DURATION', process.env.DEFAULT_PUNISHMENT_DURATION, 5),
  },
  // 校验在生产环境需要的关键参数（devBypassPayment 可跳过）
  validateForProd() {
    if (module.exports.app.devBypassPayment) return;
    required('PAY_PID', module.exports.pay.pid);
    required('PAY_KEY', module.exports.pay.key);
    // notify_url / return_url 可选（pay.md：请求体里的 notify_url 仅参与签名，不覆盖控制台配置）
    // BASE_URL 也可不填：服务端会根据反向代理转发头自动推断。
  },
};
