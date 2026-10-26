# Deploying the REST API on Ubuntu 24.04 LTS (nginx + systemd + NVM)

🇬🇧 English | [🇵🇱 Polski](DEPLOYMENT.pl.md)

This guide shows how to run the KSeF PDF generator REST API (`src/server`) on a fresh
**Ubuntu 24.04 LTS** server:

- the application runs under a dedicated, unprivileged system user called **`ksef`**,
- Node.js is installed for that user with **[NVM](https://github.com/nvm-sh/nvm)** (no system-wide Node.js),
- the application is started and supervised by a **systemd service**,
- **nginx** is the public entry point and proxies requests to the application.

```
client ──► nginx :80/:443 ──► 127.0.0.1:7321 (node, user ksef, systemd: ksef-pdf-generator.service)
```

Only the REST API is deployed. The browser demo app (`npm run dev`) is not needed on the server.

Commands are marked with the account they must be run as:

- **admin** – your regular account with `sudo` rights,
- **ksef** – the application user (open a shell with `sudo -iu ksef`).

Replace `ksef.example.com` with your own domain name everywhere.

---

## 1. Requirements

| Item | Value |
| --- | --- |
| OS | Ubuntu 24.04 LTS (x86-64 or arm64) |
| Account | a user with `sudo` rights |
| Node.js | **22.14.0** or newer (installed with NVM in step 3) |
| Network | outbound HTTPS (GitHub, npm registry), inbound ports 80/443 (and 22 for SSH) |
| DNS | an `A`/`AAAA` record pointing at the server (needed for HTTPS) |

## 2. Install system packages and create the `ksef` user

**admin:**

```bash
sudo apt update
sudo apt install -y nginx git curl
```

Create the application user. `--disabled-password` means nobody can log in as `ksef` with a
password; you switch to it with `sudo -iu ksef` (SSH keys can be added later if you need direct
logins). The user gets no `sudo` rights.

**admin:**

```bash
sudo adduser --disabled-password --gecos "" ksef
```

## 3. Install NVM and Node.js for the `ksef` user

Open a login shell as `ksef`:

**admin:**

```bash
sudo -iu ksef
```

Install NVM (the installer appends the NVM loader to `~/.bashrc`) and load it into the current shell:

**ksef:**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
. "$HOME/.nvm/nvm.sh"
```

Install Node.js 22 and make it the default version. The `default` alias is what the service
uses later, so it always runs the newest Node.js 22.x you have installed.

**ksef:**

```bash
nvm install 22
nvm alias default 22
node -v    # v22.x.y  (must be 22.14.0 or newer)
npm -v
```

## 4. Download and build the application

**ksef:**

```bash
git clone https://github.com/PadawanBreslau/probit-ksef-pdf-generator.git ~/app
cd ~/app
npm ci
npm run server:build
ls dist-server/main.js
```

`npm run server:build` needs the development dependencies (Vite), so run it before pruning
anything. The result is `dist-server/main.js`; the runtime packages (`express`, `multer`, …) are
still loaded from `node_modules`, so keep that directory.

> If the repository is private, clone it with a [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
> or a personal access token instead.

Optionally, free about 100 MB by removing the development dependencies (`npm ci` restores them
during the next update):

```bash
npm prune --omit=dev
```

## 5. Configure the application

The server reads its settings from environment variables (see
[DEV_README.md](../DEV_README.md#configuration)). systemd loads them from a file owned by root.

**ksef:** leave the `ksef` shell (you are back in your admin account):

```bash
exit
```

**admin:**

```bash
sudo tee /etc/ksef-pdf-generator.env >/dev/null <<'EOF'
# Listen on the loopback interface only - nginx is the public entry point.
HOST=127.0.0.1
PORT=7321
# Maximum accepted XML size in bytes (10 MiB). Keep nginx client_max_body_size above it.
MAX_UPLOAD_SIZE_BYTES=10485760
# debug | info | warn | error | silent
LOG_LEVEL=info
EOF
```

## 6. Create the start script

systemd does not read `~/.bashrc`, so `node` installed by NVM is not on its `PATH`. A tiny wrapper
script loads NVM and starts Node.js, which keeps the service independent of the exact Node.js
version number (no `.../versions/node/v22.x.y/...` path to update after every upgrade).

**admin:**

```bash
sudo -u ksef mkdir -p /home/ksef/bin
sudo -u ksef tee /home/ksef/bin/ksef-pdf-generator.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# Starts the KSeF PDF generator REST API with the Node.js version selected in NVM.
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use --silent default || exit 1

cd "$HOME/app" || exit 1
exec node dist-server/main.js
EOF
sudo chmod 750 /home/ksef/bin/ksef-pdf-generator.sh
```

`exec` replaces the shell with Node.js, so systemd sends `SIGTERM` straight to the application,
which shuts down gracefully.

## 7. Create the systemd service

**admin:**

```bash
sudo tee /etc/systemd/system/ksef-pdf-generator.service >/dev/null <<'EOF'
[Unit]
Description=KSeF PDF generator REST API
After=network.target

[Service]
Type=simple
User=ksef
Group=ksef
WorkingDirectory=/home/ksef/app
EnvironmentFile=/etc/ksef-pdf-generator.env
ExecStart=/home/ksef/bin/ksef-pdf-generator.sh
Restart=on-failure
RestartSec=5
SyslogIdentifier=ksef-pdf-generator

# Basic hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ksef-pdf-generator
sudo systemctl status ksef-pdf-generator --no-pager
```

Check that the application answers locally:

```bash
curl http://127.0.0.1:7321/health
# {"status":"ok","uptime":3}
```

Logs go to the journal: `sudo journalctl -u ksef-pdf-generator -f`.

## 8. Configure nginx

**admin:**

```bash
sudo tee /etc/nginx/sites-available/ksef-pdf-generator >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name ksef.example.com;

    # nginx rejects request bodies larger than 1 MB by default. Keep this value above
    # MAX_UPLOAD_SIZE_BYTES (10 MiB) to leave room for the multipart overhead.
    client_max_body_size 11m;

    location / {
        proxy_pass http://127.0.0.1:7321;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/ksef-pdf-generator /etc/nginx/sites-enabled/ksef-pdf-generator
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

If you change `PORT` in `/etc/ksef-pdf-generator.env`, change `proxy_pass` accordingly.
If you change `MAX_UPLOAD_SIZE_BYTES`, change `client_max_body_size` too.

## 9. Firewall

Ubuntu ships with `ufw`, disabled by default. Allow SSH **before** enabling it.

**admin:**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Port 7321 is deliberately not opened: the application listens on `127.0.0.1` only.

## 10. HTTPS (Let's Encrypt)

The domain from step 8 must already resolve to this server and ports 80/443 must be reachable.

**admin:**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ksef.example.com
sudo certbot renew --dry-run
```

Certbot adds the `listen 443 ssl` block, the certificate paths and an HTTP → HTTPS redirect to the
nginx site, and installs a systemd timer (`certbot.timer`) that renews the certificate
automatically.

## 11. Verify the installation

From any machine (the sample XML files are in the repository's `assets/` folder):

```bash
curl https://ksef.example.com/health

curl -X POST https://ksef.example.com/api/v1/invoices/pdf \
  -F "file=@assets/invoice.xml" \
  -o invoice.pdf

curl -X POST https://ksef.example.com/api/v1/upo/pdf \
  -H "Content-Type: application/xml" \
  --data-binary @assets/upo.xml \
  -o upo.pdf
```

The full list of endpoints, parameters and error codes is in [`api.apib`](api.apib).

## 12. Restrict access

> **The API has no authentication.** Anyone who can reach it can convert XML files. Do not
> leave a public deployment open unless that is intended.

Pick one of the following in the `location /` block of the nginx site (then
`sudo nginx -t && sudo systemctl reload nginx`).

**a) Allow only trusted networks** (for example a VPN or your office):

```nginx
allow 203.0.113.0/24;
deny all;
```

**b) HTTP basic authentication:**

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-ksef my-user
```

```nginx
auth_basic "KSeF PDF generator";
auth_basic_user_file /etc/nginx/.htpasswd-ksef;
```

## 13. Updating the application

**admin:**

```bash
sudo -iu ksef
```

**ksef:**

```bash
cd ~/app
git pull
npm ci
npm run server:build
exit
```

**admin:**

```bash
sudo systemctl restart ksef-pdf-generator
```

To move to a newer Node.js 22.x release, run `nvm install 22` (and `nvm alias default 22`) as
`ksef`, rebuild with `npm ci && npm run server:build`, and restart the service.

## 14. Troubleshooting

| Symptom | What to check |
| --- | --- |
| `502 Bad Gateway` from nginx | The service is down or listens on another port: `sudo systemctl status ksef-pdf-generator`, `ss -ltnp \| grep 7321`; compare `PORT` with `proxy_pass`. |
| `413 Request Entity Too Large` as an HTML page | nginx limit hit. Raise `client_max_body_size` (and `MAX_UPLOAD_SIZE_BYTES` if needed). A JSON `413 PAYLOAD_TOO_LARGE` comes from the application itself. |
| `status=203/EXEC` in `systemctl status` | `/home/ksef/bin/ksef-pdf-generator.sh` is missing or not executable (`sudo chmod 750 …`). |
| `nvm: command not found` / `node: command not found` in the journal | NVM is not installed for `ksef`, or no default is set: run `nvm alias default 22` as `ksef`. |
| `Cannot find module …` / `dist-server/main.js` not found | Run `npm ci && npm run server:build` in `/home/ksef/app` as `ksef`, then restart the service. |
| `EADDRINUSE` | Another process uses the port: `sudo ss -ltnp \| grep 7321`; pick a different `PORT` and update nginx. |
| Changes in `/etc/ksef-pdf-generator.env` have no effect | Restart the service: `sudo systemctl restart ksef-pdf-generator`. |

Useful commands:

```bash
sudo systemctl status ksef-pdf-generator --no-pager
sudo journalctl -u ksef-pdf-generator -n 100 --no-pager
sudo nginx -t
sudo tail -n 50 /var/log/nginx/error.log
```

## 15. What lives where

| Path | Purpose |
| --- | --- |
| `/home/ksef/.nvm` | NVM and the Node.js versions |
| `/home/ksef/app` | the cloned repository, `node_modules`, `dist-server/main.js` |
| `/home/ksef/bin/ksef-pdf-generator.sh` | start script used by systemd |
| `/etc/ksef-pdf-generator.env` | application configuration (environment variables) |
| `/etc/systemd/system/ksef-pdf-generator.service` | systemd unit |
| `/etc/nginx/sites-available/ksef-pdf-generator` | nginx site (enabled through `sites-enabled`) |
