# Mana Mobile PWA Cloudflare Setup

This guide exposes only Mana's mobile gateway through a dedicated
Cloudflare-protected hostname. Mana detects the public host and Cloudflare
forwarding headers, permits `/mobile`, and rejects core, admin, caption, and
tray surfaces even though `cloudflared` connects over loopback.

## Local prerequisites

- Mana backend starts successfully on `http://127.0.0.1:5005`.
- `MANA_BACKEND_HOST=127.0.0.1` remains unchanged.
- `MANA_ALLOW_REMOTE_ACCESS=1` is set deliberately.
- `MOBILE_PASSCODE_HASH` is set.
- `MOBILE_SESSION_SECRET` contains at least 32 bytes.
- `node-bot/data/` is ignored by Git.
- A Cloudflare account and domain are available for the tunnel hostname.

Generate a passcode hash from `node-bot`:

```powershell
cd C:\ManaAI\Mana\node-bot
$passcode = Read-Host -AsSecureString "Mana mobile passcode"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passcode)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) | node -e "const fs = require('fs'); const { hashPasscode } = require('./mobile-auth'); const pass = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, ''); console.log(hashPasscode(pass));"
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
```

Generate a session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `ADMIN_TOKEN` to a separate random value when pairing or device-management
routes must be used through the tunnel. Without it, those administrative mobile
routes remain local-only.

## Local test

Start Mana, then open:

```text
http://127.0.0.1:5005/mobile/app/
```

Unlock with the configured passcode.

## Cloudflare Tunnel

Install `cloudflared`, authenticate it, and create a tunnel that routes your chosen hostname to:

```text
http://127.0.0.1:5005
```

In Cloudflare Zero Trust, add an Access application for the hostname and allow only your email or identity provider account.

Keep the original public `Host` and Cloudflare forwarding headers intact. Do not
set `originRequest.httpHostHeader` to `127.0.0.1` or strip `Forwarded`,
`X-Forwarded-For`, `X-Forwarded-Host`, and `CF-Connecting-IP`; those signals let Mana distinguish a
tunnel request from a trusted local client. Restricting the Access application
to `/mobile/*` is still recommended as defense in depth.

Use a dedicated hostname such as:

```text
https://mana.example.com/mobile/app/
```

Do not expose unrelated local services through this tunnel.

## Phone install

On iPhone Safari:

1. Open the Cloudflare-protected Mana URL.
2. Complete Cloudflare Access login.
3. Unlock with the Mana passcode.
4. Use Share -> Add to Home Screen.

## Verification

- Open the app on cellular data, not Wi-Fi.
- Confirm Cloudflare Access blocks an unauthorized browser.
- Confirm Mana passcode is still required after Cloudflare login.
- Confirm `https://mana.example.com/health` returns `403` while
  `https://mana.example.com/mobile/health` succeeds.
- Send a text chat.
- Record a push-to-talk message.
- Close and reopen the PWA and confirm chats remain.
- Tap Send Summary and confirm the summary appears in `node-bot/data/mobile-summaries.json`.
