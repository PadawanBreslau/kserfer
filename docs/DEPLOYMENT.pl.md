# Wdrożenie REST API na Ubuntu 24.04 LTS (nginx + systemd + NVM)

[🇬🇧 English](DEPLOYMENT.md) | 🇵🇱 Polski

Ta instrukcja pokazuje, jak uruchomić REST API generatora PDF KSeF (`src/server`) na świeżym
serwerze z **Ubuntu 24.04 LTS**:

- aplikacja działa na dedykowanym, nieuprzywilejowanym koncie systemowym o nazwie **`ksef`**,
- Node.js jest zainstalowany dla tego użytkownika za pomocą **[NVM](https://github.com/nvm-sh/nvm)** (bez systemowej instalacji Node.js),
- aplikację uruchamia i nadzoruje **usługa systemd**,
- **nginx** jest publicznym punktem wejścia i przekazuje żądania do aplikacji.

```
klient ──► nginx :80/:443 ──► 127.0.0.1:3000 (node, użytkownik ksef, systemd: ksef-pdf-generator.service)
```

Wdrażane jest tylko REST API. Aplikacja demonstracyjna w przeglądarce (`npm run dev`) nie jest
potrzebna na serwerze.

Przy poleceniach zaznaczono, z jakiego konta należy je uruchomić:

- **admin** – Twoje zwykłe konto z uprawnieniami `sudo`,
- **ksef** – użytkownik aplikacji (powłokę otwierasz poleceniem `sudo -iu ksef`).

Wszędzie zamień `ksef.example.com` na własną nazwę domeny.

---

## 1. Wymagania

| Element | Wartość |
| --- | --- |
| System | Ubuntu 24.04 LTS (x86-64 lub arm64) |
| Konto | użytkownik z uprawnieniami `sudo` |
| Node.js | **22.14.0** lub nowszy (instalowany przez NVM w kroku 3) |
| Sieć | ruch wychodzący HTTPS (GitHub, rejestr npm), ruch przychodzący na porty 80/443 (oraz 22 dla SSH) |
| DNS | rekord `A`/`AAAA` wskazujący na serwer (wymagany dla HTTPS) |

## 2. Instalacja pakietów systemowych i utworzenie użytkownika `ksef`

**admin:**

```bash
sudo apt update
sudo apt install -y nginx git curl ca-certificates
```

Utwórz użytkownika aplikacji. Opcja `--disabled-password` oznacza, że nikt nie zaloguje się na
konto `ksef` hasłem; przełączasz się na nie poleceniem `sudo -iu ksef` (jeśli potrzebujesz
bezpośredniego logowania, możesz później dodać klucze SSH). Użytkownik nie otrzymuje uprawnień `sudo`.

**admin:**

```bash
sudo adduser --disabled-password --gecos "" ksef
```

## 3. Instalacja NVM i Node.js dla użytkownika `ksef`

Otwórz powłokę logowania jako `ksef`:

**admin:**

```bash
sudo -iu ksef
```

Zainstaluj NVM (instalator dopisuje ładowanie NVM do `~/.bashrc`) i załaduj go do bieżącej powłoki:

**ksef:**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
. "$HOME/.nvm/nvm.sh"
```

Zainstaluj Node.js 22 i ustaw go jako wersję domyślną. Alias `default` jest później używany przez
usługę, więc zawsze uruchamia ona najnowszą zainstalowaną wersję Node.js 22.x.

**ksef:**

```bash
nvm install 22
nvm alias default 22
node -v    # v22.x.y  (musi być 22.14.0 lub nowsza)
npm -v
```

## 4. Pobranie i zbudowanie aplikacji

**ksef:**

```bash
git clone https://github.com/PadawanBreslau/probit-ksef-pdf-generator.git ~/app
cd ~/app
npm ci
npm run server:build
ls dist-server/main.js
```

`npm run server:build` wymaga zależności deweloperskich (Vite), dlatego uruchom go przed
jakimkolwiek czyszczeniem zależności. Wynikiem jest `dist-server/main.js`; pakiety wykonawcze
(`express`, `multer` itd.) są nadal ładowane z `node_modules`, więc nie usuwaj tego katalogu.

> Jeśli repozytorium jest prywatne, sklonuj je z użyciem [klucza wdrożeniowego (deploy key)](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
> lub osobistego tokenu dostępu.

Opcjonalnie możesz odzyskać ok. 100 MB, usuwając zależności deweloperskie (przy następnej
aktualizacji `npm ci` przywróci je):

```bash
npm prune --omit=dev
```

## 5. Konfiguracja aplikacji

Serwer odczytuje ustawienia ze zmiennych środowiskowych (zob.
[DEV_README.md](../DEV_README.md#configuration)). systemd wczytuje je z pliku należącego do roota.

**ksef:** opuść powłokę użytkownika `ksef` (wrócisz na konto admina):

```bash
exit
```

**admin:**

```bash
sudo tee /etc/ksef-pdf-generator.env >/dev/null <<'EOF'
# Nasłuchiwanie wyłącznie na interfejsie loopback - publicznym punktem wejścia jest nginx.
HOST=127.0.0.1
PORT=3000
# Maksymalny rozmiar przyjmowanego pliku XML w bajtach (10 MiB). Wartość client_max_body_size w nginx musi być większa.
MAX_UPLOAD_SIZE_BYTES=10485760
# debug | info | warn | error | silent
LOG_LEVEL=info
EOF
```

## 6. Skrypt startowy

systemd nie czyta `~/.bashrc`, więc `node` zainstalowany przez NVM nie znajduje się w jego
`PATH`. Mały skrypt-opakowanie ładuje NVM i uruchamia Node.js, dzięki czemu usługa nie zależy od
konkretnego numeru wersji Node.js (nie trzeba poprawiać ścieżki `.../versions/node/v22.x.y/...`
po każdej aktualizacji).

**admin:**

```bash
sudo -u ksef mkdir -p /home/ksef/bin
sudo -u ksef tee /home/ksef/bin/ksef-pdf-generator.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# Uruchamia REST API generatora PDF KSeF w wersji Node.js wybranej w NVM.
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use --silent default || exit 1

cd "$HOME/app" || exit 1
exec node dist-server/main.js
EOF
sudo chmod 750 /home/ksef/bin/ksef-pdf-generator.sh
```

`exec` zastępuje powłokę procesem Node.js, dzięki czemu systemd wysyła `SIGTERM` bezpośrednio do
aplikacji, która kończy pracę w sposób kontrolowany.

## 7. Usługa systemd

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

# Podstawowe utwardzenie
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

Sprawdź, czy aplikacja odpowiada lokalnie:

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok","uptime":3}
```

Logi trafiają do dziennika systemd: `sudo journalctl -u ksef-pdf-generator -f`.

## 8. Konfiguracja nginx

**admin:**

```bash
sudo tee /etc/nginx/sites-available/ksef-pdf-generator >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name ksef.example.com;

    # Domyślnie nginx odrzuca żądania z treścią większą niż 1 MB. Wartość musi być większa niż
    # MAX_UPLOAD_SIZE_BYTES (10 MiB), aby zmieścił się narzut formatu multipart.
    client_max_body_size 11m;

    location / {
        proxy_pass http://127.0.0.1:3000;
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

Jeśli zmienisz `PORT` w `/etc/ksef-pdf-generator.env`, zmień odpowiednio `proxy_pass`.
Jeśli zmienisz `MAX_UPLOAD_SIZE_BYTES`, zmień także `client_max_body_size`.

## 9. Zapora sieciowa

Ubuntu zawiera `ufw`, domyślnie wyłączony. Zezwól na SSH **przed** jego włączeniem.

**admin:**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Port 3000 celowo nie jest otwierany: aplikacja nasłuchuje wyłącznie na `127.0.0.1`.

## 10. HTTPS (Let's Encrypt)

Domena z kroku 8 musi już wskazywać na ten serwer, a porty 80/443 muszą być dostępne z internetu.

**admin:**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ksef.example.com
sudo certbot renew --dry-run
```

Certbot dodaje do witryny nginx blok `listen 443 ssl`, ścieżki do certyfikatu oraz przekierowanie
HTTP → HTTPS, a także instaluje timer systemd (`certbot.timer`), który automatycznie odnawia
certyfikat.

## 11. Weryfikacja instalacji

Z dowolnego komputera (przykładowe pliki XML znajdują się w katalogu `assets/` repozytorium):

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

Pełna lista endpointów, parametrów i kodów błędów znajduje się w [`api.apib`](api.apib).

## 12. Ograniczenie dostępu

> **API nie ma uwierzytelniania.** Każdy, kto ma do niego dostęp, może konwertować pliki XML.
> Nie zostawiaj publicznego wdrożenia bez ograniczeń, jeśli nie jest to zamierzone.

Wybierz jedną z poniższych opcji i dodaj ją w bloku `location /` witryny nginx (następnie
`sudo nginx -t && sudo systemctl reload nginx`).

**a) Dostęp tylko z zaufanych sieci** (np. VPN lub sieć biurowa):

```nginx
allow 203.0.113.0/24;
deny all;
```

**b) Uwierzytelnianie HTTP Basic:**

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-ksef my-user
```

```nginx
auth_basic "KSeF PDF generator";
auth_basic_user_file /etc/nginx/.htpasswd-ksef;
```

## 13. Aktualizacja aplikacji

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

Aby przejść na nowsze wydanie Node.js 22.x, uruchom jako `ksef` polecenie `nvm install 22` (oraz
`nvm alias default 22`), przebuduj aplikację (`npm ci && npm run server:build`) i zrestartuj usługę.

## 14. Rozwiązywanie problemów

| Objaw | Co sprawdzić |
| --- | --- |
| `502 Bad Gateway` z nginx | Usługa nie działa lub nasłuchuje na innym porcie: `sudo systemctl status ksef-pdf-generator`, `ss -ltnp \| grep 3000`; porównaj `PORT` z `proxy_pass`. |
| `413 Request Entity Too Large` jako strona HTML | Przekroczono limit nginx. Zwiększ `client_max_body_size` (oraz w razie potrzeby `MAX_UPLOAD_SIZE_BYTES`). Odpowiedź JSON `413 PAYLOAD_TOO_LARGE` pochodzi z samej aplikacji. |
| `status=203/EXEC` w `systemctl status` | Brakuje pliku `/home/ksef/bin/ksef-pdf-generator.sh` lub nie jest wykonywalny (`sudo chmod 750 …`). |
| `nvm: command not found` / `node: command not found` w dzienniku | NVM nie jest zainstalowany dla `ksef` albo nie ustawiono wersji domyślnej: uruchom `nvm alias default 22` jako `ksef`. |
| `Cannot find module …` / brak `dist-server/main.js` | Uruchom `npm ci && npm run server:build` w `/home/ksef/app` jako `ksef`, a następnie zrestartuj usługę. |
| `EADDRINUSE` | Port zajmuje inny proces: `sudo ss -ltnp \| grep 3000`; wybierz inny `PORT` i zaktualizuj nginx. |
| Zmiany w `/etc/ksef-pdf-generator.env` nie działają | Zrestartuj usługę: `sudo systemctl restart ksef-pdf-generator`. |

Przydatne polecenia:

```bash
sudo systemctl status ksef-pdf-generator --no-pager
sudo journalctl -u ksef-pdf-generator -n 100 --no-pager
sudo nginx -t
sudo tail -n 50 /var/log/nginx/error.log
```

## 15. Co gdzie się znajduje

| Ścieżka | Przeznaczenie |
| --- | --- |
| `/home/ksef/.nvm` | NVM i wersje Node.js |
| `/home/ksef/app` | sklonowane repozytorium, `node_modules`, `dist-server/main.js` |
| `/home/ksef/bin/ksef-pdf-generator.sh` | skrypt startowy używany przez systemd |
| `/etc/ksef-pdf-generator.env` | konfiguracja aplikacji (zmienne środowiskowe) |
| `/etc/systemd/system/ksef-pdf-generator.service` | jednostka systemd |
| `/etc/nginx/sites-available/ksef-pdf-generator` | witryna nginx (włączona przez `sites-enabled`) |
