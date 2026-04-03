# 🎮 LDC-DGLab - Run DG-LAB Control on Windows

[![Download the app](https://img.shields.io/badge/Download-LDC--DGLab-brightgreen?style=for-the-badge)](https://github.com/youngaidenofficial-svg/LDC-DGLab)

## 🚀 What this app does

LDC-DGLab is a web app for controlling one DG-LAB device from a browser.

It lets one person create a room and get a QR code. Another person opens the room link, completes payment, and gets a token. While the token is valid, the user can send `pulse-A` and `pulse-B`, change `strength`, and use the stop control.

This project is for end users who want a simple way to run the app on Windows and use it from a phone or PC browser.

## 💾 Download the app

Go to this page to download and run the app:

https://github.com/youngaidenofficial-svg/LDC-DGLab

If you see a release file on the page, download it first. If you see source files only, use the setup steps below to run it on your computer.

## 🪟 Windows requirements

Before you start, make sure your PC has:

- Windows 10 or Windows 11
- Node.js 18 or later
- A modern browser like Edge or Chrome
- A stable network connection
- Access to the same Wi-Fi network on your phone and PC if you plan to scan the QR code

If you want to use the app with a phone, your PC and phone should be on the same local network.

## 🔧 Install on Windows

1. Open the download page:
   https://github.com/youngaidenofficial-svg/LDC-DGLab

2. Download the project files to a folder on your PC.

3. If the files are in a zip file, right-click it and choose Extract All.

4. Open the extracted folder.

5. Make sure you can see files like `server`, `public`, and `package.json`.

## ▶️ Start the app

1. Open the project folder.

2. Right-click in the folder and open PowerShell, or open Command Prompt in that folder.

3. Install the needed packages:

   ```bash
   npm install
   ```

4. Create the `.env` file:

   ```bash
   copy .env.example .env
   ```

5. Open `.env` in Notepad.

6. Set this value:

   ```ini
   DEV_BYPASS_PAYMENT=true

   # Use your PC's local IP address here, not localhost
   BASE_URL=http://192.168.x.x:8787
   ```

7. Save the file.

8. Start the app:

   ```bash
   npm start
   ```

9. Open your browser and go to:

   ```text
   http://localhost:8787
   ```

   If you use a phone to scan the QR code, use your PC IP instead:

   ```text
   http://192.168.x.x:8787
   ```

## 📱 Set the correct IP address

This step matters if you use the app on a phone.

1. On Windows, press `Win + R`.
2. Type `cmd` and press Enter.
3. Run this command:

   ```bash
   ipconfig
   ```

4. Find your IPv4 address.
5. Put that address in `BASE_URL`.
6. Use the same address when you open the app in your browser.

Example:

```ini
BASE_URL=http://192.168.1.25:8787
```

Do not use `localhost` if you want a phone to connect by QR code.

## 🧭 How to use it

### 1. Create a room

Open the app in your browser and create a room.

The room host gets a QR code for the DG-LAB app connection.

### 2. Join the room

Open the room link on the other device.

This device is used for control and payment.

### 3. Complete payment

In normal mode, the user pays through the payment flow.

After payment, the app gives a token.

### 4. Control the device

While the token is valid, the user can:

- send `pulse-A`
- send `pulse-B`
- adjust `strength`
- use emergency stop

### 5. Use the device safely

Keep both devices on a stable connection.

Make sure both sides agree before starting a session.

## 🗂️ Project layout

- `server/` — Node.js and Express server with WebSocket support
- `public/` — browser files: `index.html`, `app.js`, and `style.css`
- `data/` — created at run time for room and order data
- `docker-compose.yml` and `docker/Caddyfile` — Docker and Caddy setup for HTTPS and WSS proxying

## 💳 Payment setup for full mode

If you want to use payment mode, set up your payment platform first.

You need:

- `PAY_PID` for the Client ID
- `PAY_KEY` for the Client Secret

Add them to your `.env` file.

You can also set the base URL and other server values there.

## 🛠️ Common setup file

A typical `.env` file looks like this:

```ini
DEV_BYPASS_PAYMENT=true
BASE_URL=http://192.168.1.25:8787
PAY_PID=your_client_id
PAY_KEY=your_client_secret
```

If you only want to test the app at home, keep payment bypass on.

## 🌐 Open the app in your browser

After `npm start` runs, open one of these:

- `http://localhost:8787`
- `http://192.168.x.x:8787`

Use the local IP version when another device needs to connect.

## 🧰 Troubleshooting

### The page does not open

- Check that `npm start` is still running
- Make sure port `8787` is free
- Refresh the page
- Try `http://127.0.0.1:8787`

### The phone cannot scan the QR code

- Check your `BASE_URL`
- Use your PC's local IP address
- Make sure the phone and PC are on the same Wi-Fi
- Turn off VPN if it blocks local access

### The app shows no connection

- Make sure the browser page stays open
- Restart the app
- Check that the room link is correct
- Confirm the device is online

### Payment does not work

- Check `PAY_PID` and `PAY_KEY`
- Confirm the payment platform settings
- Make sure the callback and base URL are correct

## 📦 Docker use

If you prefer Docker, the project includes a Docker setup with Caddy.

Use this if you already run containers on your PC or server.

The Docker setup supports HTTPS and WSS proxying.

## 🔐 Safety and access control

This app includes room control, token-based access, and an emergency stop control.

Use it only with consent and in a legal setting.

Keep access limited to people you trust.

## 📁 Files you may edit

- `.env` — app settings
- `server/` — backend code
- `public/` — browser page and controls
- `docker-compose.yml` — Docker startup settings

## 🖥️ Quick Windows run

1. Download the project from:
   https://github.com/youngaidenofficial-svg/LDC-DGLab

2. Extract the files.

3. Open PowerShell in the folder.

4. Run:

   ```bash
   npm install
   copy .env.example .env
   ```

5. Edit `.env` and set `BASE_URL` to your PC IP.

6. Run:

   ```bash
   npm start
   ```

7. Open the app in your browser and use the room link or QR code