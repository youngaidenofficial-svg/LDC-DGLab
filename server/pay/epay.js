const crypto = require('node:crypto');

/**
 * 计算 pay.md 约定的 MD5 签名（小写）。
 * 规则：
 * 1) 取所有非空字段（排除 sign、sign_type）
 * 2) ASCII 升序拼接 k=v&k2=v2
 * 3) 在末尾追加应用密钥：payload + secret
 * 4) MD5，小写 hex
 */
function calcSign(params, secret) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && String(v) !== '';
    })
    .sort();

  const payload = keys.map((k) => `${k}=${params[k]}`).join('&');
  const raw = `${payload}${secret}`;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
}

function verifySign(params, secret) {
  const expected = calcSign(params, secret);
  const got = String(params.sign || '').toLowerCase();
  return expected === got;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAutoSubmitFormHtml({ actionUrl, fields, title = '正在跳转支付...' }) {
  const inputs = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => {
      return `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial; padding:24px;}</style>
</head>
<body>
  <h2>${escapeHtml(title)}</h2>
  <p>如果没有自动跳转，请点击按钮继续。</p>
  <form id="f" method="post" action="${escapeHtml(actionUrl)}">
    ${inputs}
    <button type="submit">继续</button>
  </form>
  <script>document.getElementById('f').submit();</script>
</body>
</html>`;
}

/**
 * 查询订单状态（pay.md /api.php）。
 * @returns {Promise<{found:boolean, paid:boolean, raw:any}>}
 */
async function queryOrder({ gatewayBase, pid, key, outTradeNo }) {
  const url = new URL(`${gatewayBase.replace(/\/$/, '')}/api.php`);
  url.searchParams.set('act', 'order');
  url.searchParams.set('pid', pid);
  url.searchParams.set('key', key);
  url.searchParams.set('out_trade_no', outTradeNo);

  const res = await fetch(url, { method: 'GET' });
  if (res.status === 404) {
    return { found: false, paid: false, raw: null };
  }
  const json = await res.json();
  const paid = String(json.status) === '1' && Number(json.code) === 1;
  return { found: true, paid, raw: json };
}

module.exports = {
  calcSign,
  verifySign,
  buildAutoSubmitFormHtml,
  queryOrder,
};
