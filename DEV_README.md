# Developer guide

This repository contains the `@akmf/ksef-fe-invoice-converter` library (PDF visualisations of
KSeF invoices and UPO documents) **and** a REST API that exposes the very same generators over
HTTP: you post an XML file, you get a PDF back.

- Library sources: `src/lib-public`, `src/shared`
- Browser demo app: `src/app-public`
- REST API: `src/server`
- API Blueprint documentation: [`docs/api.apib`](docs/api.apib)
- Production deployment on Ubuntu 24.04 LTS (nginx + systemd + NVM, dedicated `ksef` user):
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (English), [`docs/DEPLOYMENT.pl.md`](docs/DEPLOYMENT.pl.md) (Polski)

---

## 1. Requirements

| Tool | Version |
| --- | --- |
| Node.js | **22.14.0** or newer (the server relies on the global `File` and `Blob` APIs) |
| npm | Ships with Node.js |

If you juggle several Node.js versions, use a version manager such as
[nvm](https://github.com/nvm-sh/nvm).

## 2. Installing the libraries

```bash
npm install
```

This installs the runtime dependencies (`express`, `multer`, `pdfmake`, `xml-js`, `i18next`) and
the development tooling (`vite`, `vitest`, `eslint`, `prettier`, `tsx`, `supertest`).

## 3. Running the REST server

### Development

```bash
npm run server:dev     # tsx watch – restarts on every change
npm run server         # single run, no watcher
```

The API listens on <http://localhost:3000> by default and logs the effective address on startup.

### Production

```bash
npm run server:build   # bundles src/server/main.ts into dist-server/main.js
npm run server:start   # node dist-server/main.js
```

For a complete server setup (dedicated user, NVM, systemd service, nginx reverse proxy, HTTPS)
follow the [deployment guide](docs/DEPLOYMENT.md) ([po polsku](docs/DEPLOYMENT.pl.md)).

### Configuration

All settings are read from environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | TCP port the HTTP server binds to. |
| `HOST` | `0.0.0.0` | Interface the HTTP server binds to. |
| `MAX_UPLOAD_SIZE_BYTES` | `10485760` (10 MiB) | Maximum accepted XML document size. |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`, `silent`. |

```bash
PORT=8080 MAX_UPLOAD_SIZE_BYTES=2097152 npm run server
```

### Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health`, `/api/v1/health` | Liveness probe. |
| `POST` | `/api/v1/invoices/pdf` | Converts an `FA`/`FA_RR`/PEF invoice XML into a PDF. |
| `POST` | `/api/v1/upo/pdf` | Converts an UPO XML into a PDF. |

The XML can be sent either as a `multipart/form-data` upload in the `file` field or as a raw
`application/xml` / `text/xml` request body. Invoice metadata (`nrKSeF`, `acDate`, `qrCode`,
`qr2Code`, `watermark`, `isMobile`) is read from the multipart fields or from the query string.

```bash
# multipart upload
curl -X POST http://localhost:3000/api/v1/invoices/pdf \
  -F "file=@assets/invoice.xml" \
  -F "nrKSeF=5555555555-20250808-9231003CA67B-BE" \
  -o invoice.pdf

# raw XML body
curl -X POST "http://localhost:3000/api/v1/upo/pdf" \
  -H "Content-Type: application/xml" \
  --data-binary @assets/upo.xml \
  -o upo.pdf
```

Failures are returned as JSON (`{"error":{"code":"...","message":"..."}}`); the full list of
status codes and error codes lives in [`docs/api.apib`](docs/api.apib).

### How the server reuses the browser code

The generators were written for the browser, so `src/server` adds three thin adapters and nothing
else:

- `src/server/polyfills/file-reader.ts` – a minimal `FileReader` implementation, because
  `parseXML` reads the uploaded `File` through the DOM API that Node.js does not provide.
- `src/server/pdf/pdf-runtime.ts` – registers the Roboto fonts bundled with `pdfmake` through the
  library's public `configureFonts` API, and denies every remote/local resource lookup so that an
  untrusted XML document cannot make the renderer fetch external files.
- `src/server/pdf/pdf.service.ts` – wraps the uploaded buffer in a `File`, calls the unmodified
  `generateInvoice` / `generatePDFUPO` functions and converts the resulting `Blob` into a `Buffer`.

## 4. Running the demo app and building the library

```bash
npm run dev           # browser demo on http://localhost:5173/
npm run build         # production build of the library into dist/
npm run server:type   # type-checks the REST server and every library file it uses
```

> **Note:** `npm run type` (type-check of the browser demo app) fails on the inherited code because
> `tsconfig.base.json` does not declare the `@shared/*` path mapping. Use `npm run server:type`,
> which uses `src/server/tsconfig.json` and does declare it.

## 5. Running the tests

The project uses [Vitest](https://vitest.dev/guide/).

```bash
npm run test      # watch mode
npm run test:ui   # watch mode with the Vitest UI
npm run test:ci   # single run with a coverage report
```

The coverage report is written to `coverage/index.html`.

To execute only the REST API tests:

```bash
npx vitest run src/server
```

> **Time zone:** a few library tests assert Polish local times. Run the suite with
> `TZ=Europe/Warsaw` (for example `TZ=Europe/Warsaw npm run test:ci`) when your machine or CI
> runner is configured for a different time zone, otherwise those tests fail.

Server specs are marked with `// @vitest-environment node` so they run against the real Node.js
runtime (the rest of the suite uses `jsdom`). HTTP endpoints are covered with `supertest` against
the Express app, without opening a fixed port.

## 6. Linting and formatting

```bash
npm run lint       # eslint over the whole repository
npm run lint:fix   # eslint with --fix
```

Formatting is handled by Prettier through `eslint-plugin-prettier`, so `npm run lint:fix` also
reformats the code. Prettier can be run on its own as well:

```bash
npx prettier --check .
npx prettier --write .
```

> **Note:** `npm run lint` currently reports pre-existing issues in the inherited library code
> (`src/lib-public/generators/**`, `src/shared/PDF-functions.ts`). They are unrelated to the REST
> API. Use `npx eslint src/server` to lint only the server code.

## 7. API documentation

The HTTP API is documented in [API Blueprint](https://apiblueprint.org/) format in
[`docs/api.apib`](docs/api.apib). It can be rendered with any API Blueprint tool, for example:

```bash
npx aglio@2.3.0 -i docs/api.apib -o docs/api.html   # static HTML documentation
```

`aglio` is not a project dependency, so `npx` downloads it on demand. Keep `docs/api.apib` in sync
whenever an endpoint, parameter or error code changes.
