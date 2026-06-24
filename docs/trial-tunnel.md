# Stable trial tunnel (kills the rotating-URL problem)

The homepage trial proxies to the box over a Cloudflare tunnel. Quick tunnels
(`cloudflared tunnel --url ...`) hand out a throwaway hostname like
`c5pvto71.runonaspen.com` that CHANGES every restart, so the Vercel `TRIAL_TUNNEL_URL`
goes stale and the trial breaks. A *named* tunnel has a fixed hostname you set once
(`trial.runonaspen.com`) and never touch again, and a systemd unit brings it back on
reboot.

Run all of this ON THE BOX. `runonaspen.com` is already on Cloudflare, so the DNS
route just works.

## Port note
The tunnel forwards to the Aspen gateway: `http://127.0.0.1:4000`.
(Confirmed: the working endpoint required the Bearer key and returned `owned_by:local`,
which is the gateway, not raw Ollama on 11434.) If your gateway runs on a different
port, change the one `service:` line below.

## 1. Install cloudflared (skip if `cloudflared --version` already works)
```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

## 2. Authenticate (one-time, opens a browser)
```bash
cloudflared tunnel login
```
Pick the `runonaspen.com` zone. This drops a cert at `~/.cloudflared/cert.pem`.

## 3. Create the named tunnel
```bash
cloudflared tunnel create aspen-trial
```
Note the UUID it prints. Credentials are written to `~/.cloudflared/<UUID>.json`.

## 4. Point a stable hostname at it
```bash
cloudflared tunnel route dns aspen-trial trial.runonaspen.com
```
This creates the `trial.runonaspen.com` CNAME in Cloudflare automatically.

## 5. Config (system path so the service can read it as root)
```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/aspen-trial.json
sudo tee /etc/cloudflared/aspen-trial.yml >/dev/null <<'YAML'
tunnel: aspen-trial
credentials-file: /etc/cloudflared/aspen-trial.json
# Liveness so a dead origin returns a clear error instead of hanging.
originRequest:
  connectTimeout: 10s
  noTLSVerify: true
ingress:
  - hostname: trial.runonaspen.com
    service: http://127.0.0.1:4000
  - service: http_status:404
YAML
```
Replace `<UUID>` with the value from step 3.

## 6. Test by hand before turning it into a service
```bash
cloudflared tunnel --config /etc/cloudflared/aspen-trial.yml run aspen-trial
```
In another shell, confirm the stable hostname now serves your model list:
```bash
curl -i https://trial.runonaspen.com/v1/models \
  -H "Authorization: Bearer YOUR-TRIAL-API-KEY"
```
Expect `HTTP/2 200` and `qwen3.6:35b-a3b` in the JSON. Then Ctrl-C the foreground run.

## 7. Run it forever (systemd, survives reboot)
```bash
sudo tee /etc/systemd/system/cloudflared-trial.service >/dev/null <<'UNIT'
[Unit]
Description=Cloudflare named tunnel for Aspen trial
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --config /etc/cloudflared/aspen-trial.yml run aspen-trial
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-trial
sudo systemctl status cloudflared-trial --no-pager
```

## 8. Point Vercel at the stable hostname, once and for good
In the `open-llm` project env (Production scope):
```
TRIAL_TUNNEL_URL = https://trial.runonaspen.com/v1
```
Redeploy. This is the LAST time you ever change that value. The hostname is fixed now;
restarts and reboots no longer rotate it.

## Verify end to end
- `curl https://trial.runonaspen.com/v1/models -H "Authorization: Bearer <key>"` → 200 + model
- Homepage trial answers
- `sudo reboot`, wait, then re-run the curl → still 200 (proves the service auto-starts)

## If it ever breaks again
```bash
sudo systemctl status cloudflared-trial      # is the tunnel up?
journalctl -u cloudflared-trial -n 50 --no-pager
curl -i https://trial.runonaspen.com/v1/models -H "Authorization: Bearer <key>"
```
The Vercel `[trial]` log line will name the host it used; it should always say
`trial.runonaspen.com` now, never a random subdomain.
