# Connect your Apple devices

Run the server on your Mac mini. Your MacBook Pro, iPad, and iPhone connect to that server; they do not run separate database copies.

## Option A: private HTTPS with Tailscale

This provides a private address that works away from home. It requires a Tailscale account and the Tailscale app on each device. Keep the server bound to localhost.

1. Install [Tailscale](https://tailscale.com/download) on all four devices and sign them into your private tailnet.
2. In the repository on your Mac mini, copy `.env.example` to `.env`. Set a long, unique `TASK_MANAGER_PASSWORD` in `.env`; leave `HOST=127.0.0.1`.
3. Run `npm start`.
4. In another terminal, run `tailscale serve --bg http://127.0.0.1:3000`. Depending on your macOS installation, you may need to [enable the Tailscale CLI](https://tailscale.com/kb/1080/cli). Follow Tailscale's instructions if it asks you to enable HTTPS for the tailnet.
5. Open the HTTPS address printed by Tailscale on each connected device and sign in with your app passphrase. Use that exact address when adding the app to your Home Screen or Dock.

Use **Serve**, which is private to your tailnet. Do not enable public Funnel access. Existing tailnet access rules still apply. Use `tailscale serve status` to inspect the address and `tailscale serve reset` to remove this machine's Serve configuration if it is dedicated to this app. Avoid resetting shared Serve configuration for other apps.

## Option B: home Wi-Fi

Use this on a trusted local network. The direct HTTP connection does not encrypt your passphrase or tasks; prefer Option A when privacy matters.

1. Copy `.env.example` to `.env` on the Mac mini.
2. Set `TASK_MANAGER_PASSWORD` to a unique passphrase of at least 12 characters.
3. Run `npm run start:lan`. This listens on IPv4 network interfaces. The server refuses this mode without the passphrase.
4. On the Mac mini, run `scutil --get LocalHostName`. If the result is `Eriks-Mac-mini`, the address is `http://Eriks-Mac-mini.local:3000`.
5. Open that address in Safari on all devices while connected to the same home network. Enter the passphrase when prompted.

If macOS asks, allow incoming connections for Node on your private network. If `.local` discovery does not work, use the Mac mini's local IP address from System Settings → Network → the active connection → Details. Guest Wi-Fi and client isolation can prevent devices from connecting. No router port forwarding is needed.

`localhost` on the iPhone means the iPhone itself. Use the Mac mini's address on your other devices.

## Keep the Mac mini available

- Leave the server running. Closing its terminal stops it.
- In System Settings → Energy, enable **Prevent automatic sleeping when the display is off** if available. Turning off the display is fine; system sleep interrupts access.
- During a manual session, `caffeinate -i npm start` keeps the Mac awake while the server runs. For direct LAN access, use `caffeinate -i npm run start:lan`.
- Restart the app after rebooting. Automatic startup via a macOS LaunchAgent is a future improvement; this repository does not install a background service.
- Check `http://localhost:3000` on the Mac mini first when troubleshooting.
