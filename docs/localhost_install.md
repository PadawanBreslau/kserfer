# Local-only installation of kserfer (nginx + systemd, port 7321)

🇬🇧 English | [🇵🇱 Polski](localhost_install.pl.md)

This guide sets up the REST API (`src/server`) on Ubuntu 24.04 LTS so that it is reachable **only
from the server itself** on `http://127.0.0.1:7321`, and is not visible from outside.

```
curl (on the server) ──► nginx 127.0.0.1:7321 ──► node 127.0.0.1:7322 (user ksef, systemd: kserfer)
```

nginx and the Node.js app cannot share one port, so nginx listens on 7321 and the app on 7322.
Both are bound to the loopback interface only.

For a public deployment (domain, HTTPS) see [DEPLOYMENT.md](DEPLOYMENT.md).

Commands are marked with the account they must be run as:

- **ksef** – the application user (`sudo -iu ksef`); everything inside `/home/ksef`,
- **root** – your admin account using `sudo`; everything outside `/home/ksef` (`/etc`, systemd, nginx).

## 1. Prepare the system

**root:**

```bash
sudo apt update
sudo apt install -y nginx git curl
sudo adduser --disabled-password --gecos "" ksef
```

## 2. Install Node.js and build the app

**ksef** (`sudo -iu ksef`):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 22
nvm alias default 22

# skip the clone if the files are already in /home/ksef/app
git clone https://github.com/PadawanBreslau/kserfer.git ~/app
cd ~/app
npm ci
npm run server:build
ls dist-server/main.js
```

`node_modules` must stay next to `dist-server/main.js` (express, multer and xml-js are loaded at runtime).

## 3. Create the start script

**ksef:**

```bash
mkdir -p ~/bin
cat > ~/bin/kserfer.sh <<'EOF'
#!/usr/bin/env bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use --silent default || exit 1
cd "$HOME/app" || exit 1
exec node dist-server/main.js
EOF
chmod 750 ~/bin/kserfer.sh
exit
```

## 4. Application configuration

**root:**

```bash
sudo tee /etc/kserfer.env >/dev/null <<'EOF'
# Loopback only - the default would be 0.0.0.0 (all interfaces)
HOST=127.0.0.1
PORT=7322
MAX_UPLOAD_SIZE_BYTES=10485760
LOG_LEVEL=info
EOF
```

## 5. systemd service

**root:**

```bash
sudo tee /etc/systemd/system/kserfer.service >/dev/null <<'EOF'
[Unit]
Description=kserfer REST API
After=network.target

[Service]
Type=simple
User=ksef
Group=ksef
WorkingDirectory=/home/ksef/app
EnvironmentFile=/etc/kserfer.env
ExecStart=/home/ksef/bin/kserfer.sh
Restart=on-failure
RestartSec=5
SyslogIdentifier=kserfer
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now kserfer
sudo systemctl status kserfer --no-pager
```

`enable` makes the service start automatically after a server reboot.

## 6. nginx on 127.0.0.1:7321

**root:**

```bash
sudo tee /etc/nginx/sites-available/kserfer >/dev/null <<'EOF'
server {
    listen 127.0.0.1:7321;
    server_name localhost;

    # must be larger than MAX_UPLOAD_SIZE_BYTES
    client_max_body_size 11m;

    location / {
        proxy_pass http://127.0.0.1:7322;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/kserfer /etc/nginx/sites-enabled/kserfer
sudo nginx -t && sudo systemctl reload nginx
```

Never use `listen 7321;` or `listen 0.0.0.0:7321;` – they expose the port to the network.
Do not open port 7321 in the firewall.

## 7. Test with curl

Run on the server, from the repository directory (sample files are in `assets/`).

```bash
# health check
curl -i http://127.0.0.1:7321/health
# expected: HTTP/1.1 200 OK  {"status":"ok","uptime":...}

# invoice -> PDF
curl -X POST http://127.0.0.1:7321/api/v1/invoices/pdf \
  -F "file=@assets/invoice.xml" -o invoice.pdf
file invoice.pdf          # PDF document

# UPO -> PDF
curl -X POST http://127.0.0.1:7321/api/v1/upo/pdf \
  -H "Content-Type: application/xml" --data-binary @assets/upo.xml -o upo.pdf
file upo.pdf
```

## 8. Check that it is not visible from outside

```bash
# only 127.0.0.1:7321 and 127.0.0.1:7322 may appear - never 0.0.0.0 or *
sudo ss -ltnp | grep -E '7321|7322'
```

From another machine this must fail (connection refused / timeout):

```bash
curl --max-time 5 http://<server-ip>:7321/health
```

## 9. Operations

| Task | Account | Command |
| --- | --- | --- |
| Start / stop / restart | root | `sudo systemctl start\|stop\|restart kserfer` |
| Status, autostart check | root | `systemctl status kserfer`, `systemctl is-enabled kserfer` |
| Logs | root | `sudo journalctl -u kserfer -f` |
| Update code | ksef | `cd ~/app && git pull && npm ci && npm run server:build` |
| Apply update | root | `sudo systemctl restart kserfer` |
| Test after reboot | root | `sudo reboot`, then `systemctl is-active kserfer nginx` and the health check |

## 10. Who does what

| File / action | Account |
| --- | --- |
| NVM, Node.js, `npm ci`, `npm run server:build` | ksef |
| `/home/ksef/bin/kserfer.sh` (+ `chmod 750`) | ksef |
| `/etc/kserfer.env` | root |
| `/etc/systemd/system/kserfer.service`, `systemctl` | root |
| `/etc/nginx/sites-available/kserfer`, symlink, `nginx -t`, reload | root |

## 11. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `502 Bad Gateway` | The app is not running on 7322: `systemctl status kserfer`; compare `PORT` with `proxy_pass`. |
| `bind() failed (98: Address already in use)` | The app still uses 7321; set `PORT=7322` and restart. |
| `status=203/EXEC` | `/home/ksef/bin/kserfer.sh` is missing or not executable; check the owner (`sudo chown -R ksef:ksef /home/ksef`). |
| `node: command not found` in the journal | Run `nvm alias default 22` as ksef. |
| `413 Request Entity Too Large` | Raise `client_max_body_size`. |
