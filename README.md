# DG-LAB × 支付解锁 × 脉冲（pulse）网站

此项目提供一个最小可用的「多人控制同一台 DG-LAB 设备」网站：

1. **房主**建立房间，取得 **DG-LAB APP 扫码用 QRCode**（SOCKET 连接）。
2. **控制者**打开房间链接并完成支付（EasyPay 兼容协议，见 `pay.md`）。
3. 支付成功后获得 `token`，在**解锁时间内**即可透过网站发送 `pulse-A / pulse-B`、调整 `strength`、以及急停。

> 注意：本项目仅示范技术串接。请务必在合法合规、双方知情同意、并做好安全限制的前提下使用。

---

## 目录结构

- `server/`：Node.js + Express + WebSocket 后端
- `public/`：纯前端页面（`index.html` / `app.js` / `style.css`）
- `data/`：运行时自动建立（持久化订单/房间数据）
- `docker-compose.yml` + `docker/Caddyfile`：Docker + Caddy（HTTPS/WSS 反代）

---

## 本机启动（DEV：跳过支付）

1) 安装依赖：

```bash
npm install
```

2) 建立 `.env`：

```bash
copy .env.example .env
```

3) 设置 `.env`：

```ini
DEV_BYPASS_PAYMENT=true

# 重要：设置为你的内网 IP，否则手机无法扫描 QRCode
# Windows 可用 ipconfig 查看 IPv4 地址
BASE_URL=http://192.168.x.x:8787
```

> **注意**：`BASE_URL` 必须使用电脑的内网 IP（而非 localhost），手机才能正确连接。

4) 启动：

```bash
npm start
```

5) 打开：

```
http://localhost:8787
# 或
http://192.168.x.x:8787
```

---

## 生产环境（需要支付）设置

### 1) 支付平台（pay.md）

依照 `pay.md`：在控制台建立 API Key，取得：

- `PAY_PID`（Client ID）
- `PAY_KEY`（Client Secret）

并在控制台将 **notify_url** 设为：

```
https://你的域名/api/pay/notify
```

> pay.md 说明：请求体中的 `notify_url` 仅参与签名，**不会覆盖**控制台设置。

### 2) `.env` 建议值

将 `.env` 内改成（重要）：

```ini
DEV_BYPASS_PAYMENT=false
PAY_PID=xxxx
PAY_KEY=yyyy

# 可选：若你希望建立订单时也把 notify/return 一起带入参与签名
PAY_NOTIFY_URL=https://你的域名/api/pay/notify
PAY_RETURN_URL=https://你的域名/
```

---

## 使用流程（页面操作）

### A. 房主（设备持有者）

1. 进入首页，点「**建立房间**」
2. 会得到：
   - **房间链接（分享给控制者）**：`/?roomId=...`
   - **房主链接（请保管）**：`/?roomId=...&hostKey=...`（可重新打开 QRCode）
3. 用 DG-LAB APP 的 SOCKET 功能扫描 QRCode 连接（成功后房间会显示「设备已连接」）

### B. 控制者

1. 打开房间链接（只含 `roomId`）
2. 点「**支付解锁**」取得 token（token 会自动填入并保存到 localStorage）
3. 支付完成后点「**刷新状态**」或等待自动刷新，显示「已解锁」后即可：
   - 发送脉冲：`pulse-A / pulse-B`
   - 调整强度：`strength-1/2`（A/B）
   - 「急停」：清波形 + 强度归零

---

## WebSocket 协议（简述）

- **DG-LAB APP**：通过 QRCode 连接到 `wss://domain/<terminalId>`
- **控制者**：使用 `wss://domain/?token=<token>`
- **观众/房间页**：使用 `wss://domain/?roomId=<roomId>`

后端会在控制者发送控制指令时检查 token 是否有效且未到期。

---

## Docker + Caddy（HTTPS/WSS 公网部署）

1) 准备域名 DNS 指向服务器，开放 80/443。

2) 编辑 `.env` 加上：

```ini
DOMAIN=your-domain.com
DEV_BYPASS_PAYMENT=false
PAY_PID=...
PAY_KEY=...
```

3) 启动：

```bash
docker compose up -d --build
```

完成后即可通过：

```
https://your-domain.com
```

> Caddy 会自动处理 TLS，WebSocket 也会自动升级成 `wss://`。

---

## 常见问题

### QRCode 扫描失败

1. **检查 BASE_URL**：必须使用内网 IP
2. **防火墙设置**：Windows 需开放 8787 端口
3. **同一网络**：手机和电脑必须在同一 WiFi 下
4. **QRCode 格式**：必须包含白色边框（安静区），否则 APP 无法识别

### WebSocket 连接失败

- 检查 `BASE_URL` 的协议是否正确（`http` → `ws://`，`https` → `wss://`）
- 生产环境必须使用 HTTPS/WSS

---

## 重要安全提醒

- **token 等同控制权限**，请勿泄露。
- **hostKey** 用于重新取得 QRCode/终端信息，也请勿泄露。
- 后端已加上：
  - 每秒控制消息数限制（`WS_MAX_MSGS_PER_SEC`）
  - 单次 pulse 秒数上限（`WS_MAX_PULSE_SECONDS`）
  - 波形字符串长度上限（目前 1600）