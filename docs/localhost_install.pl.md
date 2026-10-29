# Instalacja kserfer wyłącznie lokalnie (nginx + systemd, port 7321)

[🇬🇧 English](localhost_install.md) | 🇵🇱 Polski

Ta instrukcja konfiguruje REST API (`src/server`) na Ubuntu 24.04 LTS tak, aby było dostępne
**tylko z samego serwera** pod adresem `http://127.0.0.1:7321` i nie było widoczne z zewnątrz.

```
curl (na serwerze) ──► nginx 127.0.0.1:7321 ──► node 127.0.0.1:7322 (użytkownik ksef, systemd: kserfer)
```

nginx i aplikacja Node.js nie mogą używać tego samego portu, dlatego nginx nasłuchuje na 7321,
a aplikacja na 7322. Oba procesy są związane wyłącznie z interfejsem loopback.

Wdrożenie publiczne (domena, HTTPS) opisuje [DEPLOYMENT.pl.md](DEPLOYMENT.pl.md).

Polecenia są oznaczone kontem, na którym należy je wykonać:

- **ksef** – użytkownik aplikacji (`sudo -iu ksef`); wszystko wewnątrz `/home/ksef`,
- **root** – Twoje konto administratora z `sudo`; wszystko poza `/home/ksef` (`/etc`, systemd, nginx).

## 1. Przygotowanie systemu

**root:**

```bash
sudo apt update
sudo apt install -y nginx git curl
sudo adduser --disabled-password --gecos "" ksef
```

## 2. Instalacja Node.js i budowa aplikacji

**ksef** (`sudo -iu ksef`):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 22
nvm alias default 22

# pomiń klonowanie, jeśli pliki są już w /home/ksef/app
git clone https://github.com/PadawanBreslau/kserfer.git ~/app
cd ~/app
npm ci
npm run server:build
ls dist-server/main.js
```

Katalog `node_modules` musi zostać obok `dist-server/main.js` (express, multer i xml-js są ładowane w czasie działania).

## 3. Skrypt startowy

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

## 4. Konfiguracja aplikacji

**root:**

```bash
sudo tee /etc/kserfer.env >/dev/null <<'EOF'
# Tylko loopback - domyślnie byłoby 0.0.0.0 (wszystkie interfejsy)
HOST=127.0.0.1
PORT=7322
MAX_UPLOAD_SIZE_BYTES=10485760
LOG_LEVEL=info
EOF
```

## 5. Usługa systemd

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

`enable` sprawia, że usługa uruchamia się automatycznie po restarcie serwera.

## 6. nginx na 127.0.0.1:7321

**root:**

```bash
sudo tee /etc/nginx/sites-available/kserfer >/dev/null <<'EOF'
server {
    listen 127.0.0.1:7321;
    server_name localhost;

    # musi być większe niż MAX_UPLOAD_SIZE_BYTES
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

Nigdy nie używaj `listen 7321;` ani `listen 0.0.0.0:7321;` – wystawiają port do sieci.
Nie otwieraj portu 7321 w zaporze.

## 7. Test za pomocą curl

Wykonaj na serwerze, w katalogu repozytorium (przykładowe pliki są w `assets/`).

```bash
# sprawdzenie stanu
curl -i http://127.0.0.1:7321/health
# oczekiwane: HTTP/1.1 200 OK  {"status":"ok","uptime":...}

# faktura -> PDF
curl -X POST http://127.0.0.1:7321/api/v1/invoices/pdf \
  -F "file=@assets/invoice.xml" -o invoice.pdf
file invoice.pdf          # PDF document

# UPO -> PDF
curl -X POST http://127.0.0.1:7321/api/v1/upo/pdf \
  -H "Content-Type: application/xml" --data-binary @assets/upo.xml -o upo.pdf
file upo.pdf
```

## 8. Sprawdzenie, że usługa nie jest widoczna z zewnątrz

```bash
# mogą się pojawić tylko 127.0.0.1:7321 i 127.0.0.1:7322 - nigdy 0.0.0.0 ani *
sudo ss -ltnp | grep -E '7321|7322'
```

Z innego komputera to polecenie musi się nie udać (connection refused / timeout):

```bash
curl --max-time 5 http://<adres-ip-serwera>:7321/health
```

## 9. Obsługa

| Zadanie | Konto | Polecenie |
| --- | --- | --- |
| Start / stop / restart | root | `sudo systemctl start\|stop\|restart kserfer` |
| Status, sprawdzenie autostartu | root | `systemctl status kserfer`, `systemctl is-enabled kserfer` |
| Logi | root | `sudo journalctl -u kserfer -f` |
| Aktualizacja kodu | ksef | `cd ~/app && git pull && npm ci && npm run server:build` |
| Zastosowanie aktualizacji | root | `sudo systemctl restart kserfer` |
| Test po restarcie | root | `sudo reboot`, potem `systemctl is-active kserfer nginx` i test `/health` |

## 10. Kto co wykonuje

| Plik / czynność | Konto |
| --- | --- |
| NVM, Node.js, `npm ci`, `npm run server:build` | ksef |
| `/home/ksef/bin/kserfer.sh` (+ `chmod 750`) | ksef |
| `/etc/kserfer.env` | root |
| `/etc/systemd/system/kserfer.service`, `systemctl` | root |
| `/etc/nginx/sites-available/kserfer`, dowiązanie, `nginx -t`, reload | root |

## 11. Rozwiązywanie problemów

| Objaw | Rozwiązanie |
| --- | --- |
| `502 Bad Gateway` | Aplikacja nie działa na 7322: `systemctl status kserfer`; porównaj `PORT` z `proxy_pass`. |
| `bind() failed (98: Address already in use)` | Aplikacja nadal używa 7321; ustaw `PORT=7322` i zrestartuj. |
| `status=203/EXEC` | Brak `/home/ksef/bin/kserfer.sh` lub brak uprawnień wykonania; sprawdź właściciela (`sudo chown -R ksef:ksef /home/ksef`). |
| `node: command not found` w logach | Wykonaj `nvm alias default 22` jako ksef. |
| `413 Request Entity Too Large` | Zwiększ `client_max_body_size`. |
