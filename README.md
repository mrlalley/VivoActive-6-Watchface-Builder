# WatchFace Builder

A desktop GUI for designing custom Garmin Vivoactive 6 watch faces. You place elements
on a 390x390 canvas, configure their properties, and the app generates a Garmin Connect
IQ Monkey C project that compiles to a `.prg` binary installable on the watch. The app
runs as an Electron desktop window or as a standalone Express server in a browser.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 22.x |
| Garmin Connect IQ SDK | 9.x — [developer.garmin.com/connect-iq/sdk](https://developer.garmin.com/connect-iq/sdk/) |

The app runs on Windows, macOS, and Linux. The packaged installer (`npm run build`)
targets Windows only; all other platforms run from source.

---

## First-time setup

```sh
# 1. Clone and install
git clone <repo-url>
cd watchface-builder
npm ci

# 2. Configure environment variables
cp .env.example .env
# Edit .env — GARMIN_SDK_BIN and GARMIN_DEV_KEY auto-detect from standard
# install locations; set them explicitly only if auto-detection fails.
# See .env.example for all options and platform-specific path examples.

# 3. Generate SDK-derived constants (required before first start)
npm run generate-constants

# 4. Generate a developer key (one-time, required for build/preview)
# Option A — via the running app: Settings → Generate New Key
# Option B — via CLI (writes to ~/.garmin/developer_key.der):
#   node -e "const k=require('./lib/keygen'); k.generateKey(k.getDefaultKeyPath())"

# 5. Launch
npm start
```

`npm start` runs `generate-constants` automatically via `prestart`, so step 3 is only
strictly necessary if you need the constants before the first launch. If either the SDK
or developer key is missing, a warning banner appears but the app still opens.

---

## Available scripts

| Script | What it does |
|---|---|
| `npm start` | Launch the Electron desktop app. Runs `generate-constants` first via `prestart`. |
| `npm run dev` | Identical to `npm start`. |
| `npm run server` | Run the Express backend in standalone mode (no Electron window). |
| `npm run generate-constants` | Regenerate `src/constants/` from SDK definitions. |
| `npm test` | Run the Jest test suite once. |
| `npm run test:watch` | Run tests in watch mode. |
| `npm run test:coverage` | Run tests and emit a coverage report. |
| `npm run build` | Build a Windows installer via electron-builder. |
| `npm run dist` | Alias for `npm run build`. |
| `npm run package` | Package the app into a directory without an installer. |
| `npm run make` | Alias for `npm run build`. |

---

## Architecture overview

The app has three layers communicating through well-defined boundaries.

**Electron main process** (`electron/main.js`): Creates the `BrowserWindow`, persists
SDK and developer key paths in `electron-store`, starts the Express server on a random
localhost port, and bridges the renderer to the OS via IPC (file dialogs, key
generation, health polling). On macOS it keeps the app running after the window is
closed.

**Express server** (`server.js` + `lib/`): Shared between Electron mode and standalone
`npm run server`. Rate-limited routes handle build, preview, design save/load, and
health checks. Business logic lives in focused modules: `lib/build.js` (Monkey C
compilation via `monkeyc` spawn), `lib/preview.js` (simulator lifecycle), `lib/config.js`
(SDK path resolution with multi-level fallback), `lib/design-store.js` (design JSON
persistence), and `lib/keygen.js` (RSA-4096 developer key generation).

**Builder UI** (`builder/`): Vanilla JavaScript SPA served by Express. Communicates
with the backend exclusively over HTTP. All watch face rendering on-device is done via
Monkey C `dc.draw*` calls generated from the canvas element state at export time.

---

## Running tests

```sh
npm test
```

The suite covers: build orchestration and spawn mocking, concurrency and queue
serialization, design persistence, config path resolution, rate limiting, key
generation, logger redaction, and Monkey C code generation (manifest, permissions,
naming, validation). Tests run under Jest with `NODE_ENV=test`; logger output is
suppressed automatically during test runs.

---

## Environment variables

See `.env.example` for all supported variables, their default values, and
platform-specific path examples. No variable is required if the SDK and developer
key are installed in standard locations.
