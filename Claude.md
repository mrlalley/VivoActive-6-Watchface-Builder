# CLAUDE.md — WatchFace Builder

When working on this repository, read this file before making any changes.

---

## Repository purpose

A desktop Electron app that provides a GUI for designing Garmin Vivoactive 6 watch
faces. The user places elements on a 390x390 canvas; the app generates a Garmin
Connect IQ Monkey C project and compiles it to a `.prg` binary via the `monkeyc`
CLI. The app runs as either an Electron window or a standalone Express server.

---

## Template versioning contract

`garmin-project-template/VERSION` is the single source of truth for template-to-SDK compatibility. It must be updated every time the template is modified for a new SDK version.

### VERSION fields

| Field | Description | Must match |
|---|---|---|
| `templateVersion` | Semver for the template itself | — |
| `minSdkVersion` | Minimum Connect IQ SDK required to compile | `bin/version.txt` in installed SDK |
| `minApiLevel` | API level targeted by the template | `minSdkVersion` attribute in `manifest.xml` |
| `targetDeviceId` | Preferred build target | `<iq:product id="..."/>` in `manifest.xml` |
| `fallbackDeviceId` | Used if targetDeviceId absent from SDK | Documented in `notes` field |

`minApiLevel` in VERSION and `minSdkVersion` in `manifest.xml` are the same value (4.2.0). **They must never diverge.** Update both files together.

### SDK compatibility check

`scripts/generate-constants.js` runs on every `npm start`, `npm run server`, and `npm run build`. It detects the installed SDK version and checks it against `minSdkVersion` in VERSION:
- SDK absent: warning to stderr, script continues (non-fatal for standalone testing)
- SDK too old: warning logged; `electron/main.js` shows `dialog.showErrorBox()` and quits
- `vivoactive6` absent from device list: `fallbackDeviceId` (venu3) used; one-time warning dialog shown

### Update protocol when bumping SDK support

1. Update `minSdkVersion` in `garmin-project-template/manifest.xml`
2. Update all four version fields in `garmin-project-template/VERSION`
3. Run `npm run generate-constants:force`
4. Run `npm test` to confirm no regressions
5. Bump `package.json` minor version (minor bump for API level changes, patch for template content changes)

### Device detection paths

`generate-constants.js` detects device IDs from:
1. `%APPDATA%\Garmin\ConnectIQ\Devices` (Windows) / `~/Library/.../Garmin/ConnectIQ/Devices` (macOS) — authoritative
2. `bin/default.jungle` in the SDK install — fallback if Devices directory is empty

---

## generate-constants cache

`scripts/generate-constants.js` generates `builder/constants.js` from `src/constants/device.js`. It runs automatically via `prestart`, `preserver`, and `prebuild` hooks. A SHA-256 cache guard skips regeneration when inputs haven't changed.

### Cache inputs (all must be unchanged for a cache hit)

| Input | Why |
|---|---|
| `src/constants/device.js` | Device dimensions, API levels, DEVICE_ID |
| `scripts/generate-constants.js` | Static grid and timing constants live in the script itself |

No environment variables affect the output.

### Cache file

`builder/constants.js.cache.json` — written alongside the output. Never committed (`.gitignore`) and excluded from installer builds (`!**/*.cache.json` in `electron-builder` files array).

### Force regeneration

Use when the SDK path changes, after `git clean`, or in CI:

```sh
# Via npm script (cross-platform):
npm run generate-constants:force

# Via env var (macOS / Linux):
GENERATE_FORCE=1 npm run generate-constants

# Via env var (Windows PowerShell):
$env:GENERATE_FORCE = '1'; npm run generate-constants

# Via CLI flag:
node scripts/generate-constants.js --force
```

**CI note:** Run `npm run generate-constants:force` on first install to ensure a clean output regardless of any cached artifacts restored from CI cache.

### What not to do

- Do not edit `builder/constants.js` directly — it is a generated file and will be overwritten.
- Do not delete `builder/constants.js.cache.json` manually unless you intend to force a full regeneration.
- Do not add the cache file to git — it is machine-specific.

---

## Runtime prerequisites

### Node.js and npm (enforced)

The `engines` field in `package.json` and `engine-strict=true` in `.npmrc` together enforce:

| Runtime | Minimum | Why |
|---|---|---|
| Node.js | `>=22.12.0` | Electron 42.x's own `engines.node` requirement |
| npm | `>=10.0.0` | lockfile v3 compatibility with electron-builder 26.x |

Running `npm install` on an incompatible Node version produces:
```
npm error code EBADENGINE
npm error Unsupported engine
```
and aborts — the install does not silently complete.

**To fix:** install the correct Node version:
```sh
# nvm (reads .nvmrc automatically):
nvm install && nvm use

# Or download from nodejs.org — get Node 22 LTS or later
```

Verify your environment before starting:
```sh
node --version   # must be >= 22.12.0
npm --version    # must be >= 10.0.0
```

**Do not remove or lower the `engines` floor** without first checking the `engines.node` field of the Electron version in `devDependencies`. The floor must match or exceed Electron's own requirement.

### Other required tools

- **Java JDK 17 minimum** (required by Connect IQ SDK 9.x). JDK 11 is EOL and will cause cryptic SDK launch failures.
  - Verify: `java -version` (must show version 17 or higher)
  - Install: [adoptium.net/temurin/releases/?version=17](https://adoptium.net/temurin/releases/?version=17)
  - `scripts/generate-constants.js` asserts JDK ≥17 on every `npm start`, `npm run server`, and `npm run build`. Set `SKIP_JAVA_CHECK=1` to bypass (CI pipelines that don't invoke monkeyc):
    ```sh
    # macOS / Linux
    SKIP_JAVA_CHECK=1 npm start
    # Windows PowerShell
    $env:SKIP_JAVA_CHECK = "1"; npm start
    ```
- **Garmin Connect IQ SDK 8.0.0 or later** — download from [developer.garmin.com](https://developer.garmin.com/connect-iq/sdk/)
- **Developer key** (`.der` file) for watch face signing — generate via Settings → Generate New Key in the app, or: `node -e "const k=require('./lib/keygen'); k.generateKey(k.getDefaultKeyPath())"`

---

## Critical setup facts

These are non-obvious sequencing requirements you must understand before suggesting
changes to the startup or build pipeline:

- `npm run generate-constants` must run before `npm start`. The `prestart` hook does
  this automatically, but the generated files in `src/constants/` must exist before
  `lib/build.js` or `lib/preview.js` can be imported.
- The app requires a Garmin Connect IQ developer key (`.der` file) to sign `.prg`
  files. Without it, export and preview return a clear error but the app still opens.
- SDK path and developer key path are resolved by `lib/config.js` using a four-level
  fallback: explicit override parameter, environment variable, auto-detector function,
  platform default. The Electron main process passes resolved paths through a `cfg`
  object to the Express server.
- In packaged builds (`npm run build`), `__dirname` inside the ASAR archive is not
  writable. Design saves and exports must use paths from `app.getPath()`, not
  `path.join(__dirname, ...)`.

---

## Observability contract

All server and main-process logging must use pino via `lib/logger.js`. Never use `console.log`, `console.error`, or `console.warn` in `server.js`, `electron/main.js`, or any `lib/*.js` file.

### createLogger API

```js
const { createLogger } = require('./lib/logger');
const log = createLogger('my-module'); // binds { module: 'my-module' } to every entry

log.info({ event: 'operation.start', key: value });
log.error({ event: 'operation.failure', message: err.message });
```

### Log levels

| Level | When to use |
|---|---|
| `fatal` | Process cannot continue, about to exit |
| `error` | Operation failed, request aborted |
| `warn` | Recoverable issue, degraded behavior |
| `info` | Normal operation milestones (server start, request complete) |
| `debug` | Internal detail (file paths, argv, durations) |
| `trace` | High-frequency events (poll cycles, IPC payloads) |

### Required fields

Every log entry automatically includes: `timestamp`, `level`, `pid`, `module`.  
Request-scoped entries must also include `requestId`.  
monkeyc entries must also include `component: 'monkeyc'`.

### monkeyc tracing (required)

```js
// lib/build.js — wrap every spawn with this pattern
monkeycLog.info({ event: 'monkeyc.start',   argv });
monkeycLog.info({ event: 'monkeyc.success', exitCode: 0, durationMs });
monkeycLog.error({ event: 'monkeyc.failure', exitCode, durationMs, stderr });
monkeycLog.fatal({ event: 'monkeyc.spawn_error', code: err.code, message: err.message });
```

### Redaction (non-negotiable)

Never log: `WFB_SESSION_TOKEN`, `x-wfb-token` header value, passwords, or raw file content.  
Pino's `redact` option in `lib/logger.js` covers `*.token`, `*.password`, and `req.headers["x-wfb-token"]`.

### Log file locations

In Electron mode, logs are written to:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\WatchFace Builder\logs\wfb-YYYY-MM-DD.log` |
| macOS | `~/Library/Logs/WatchFace Builder/wfb-YYYY-MM-DD.log` |
| Linux | `~/.config/WatchFace Builder/logs/wfb-YYYY-MM-DD.log` |

In standalone mode (`npm run server`), logs go to stdout only.  
`WFB_LOG_LEVEL` env var overrides the default log level (`info` in production, `debug` in dev).

---

## Content Security Policy

The CSP is enforced at two independent layers that must be kept in sync:

| Layer | Location | Scope |
|---|---|---|
| **HTTP header (enforcement)** | `server.js` CSP middleware | Every Express response; includes per-request nonce for `script-src` |
| **Meta tag (declarative fallback)** | `builder/index.html` `<head>` first element | Backup when served outside Express (browser, file://) |
| **Session handler (Electron guard)** | `electron/main.js` `session.defaultSession.webRequest.onHeadersReceived` | Fallback CSP for responses lacking the server header |

### Current policy

```
default-src 'none';
script-src  'self'  [meta tag] / 'self' 'strict-dynamic' 'nonce-xxx'  [server header];
# Note: 'strict-dynamic' ignores 'self', so the meta tag must NOT use 'strict-dynamic'
# or it would block all scripts (no nonce available at template time).
style-src   'self';
img-src     'self' data:;
font-src    'self';
connect-src 'self'  [meta tag] / http://127.0.0.1:PORT [session handler];
worker-src  'none';
frame-src   'none';
object-src  'none';
base-uri    'self';
form-action 'self';
frame-ancestors 'none';
```

### Rules for adding new origins

Every new external resource (CDN script, font host, image host) requires:
1. An explicit directive in **both** `server.js` CSP middleware AND `builder/index.html` meta tag.
2. A comment in this section explaining exactly what the origin serves and why it is needed.
3. A matching entry in the Electron session handler's `STATIC_CSP` constant.

Do not use `'unsafe-inline'` or `'unsafe-eval'` without explicit approval and a documented remediation path below.

### CSP violation logging

Chromium reports blocked resources as console errors in the renderer. `electron/main.js` captures these via the `console-message` event handler and logs them at `warn` level using pino (`event: 'csp.violation'`). Navigation blocked events are logged as `navigation.blocked`. Check `app.getPath('logs')` for these entries when debugging blocked resources.

### Session handler design

The session `onHeadersReceived` handler PRESERVES the server's nonce-bearing CSP header for all Express responses. It only injects a static fallback CSP when no server header is present. **Do not change this to replace the server's CSP** — doing so would break the per-request nonce mechanism in `script-src`.

---

## Electron security posture (non-negotiable)

`electron/main.js` creates `BrowserWindow` with:
```js
webPreferences: {
  contextIsolation: true,   // isolates renderer from Node.js context
  nodeIntegration: false,   // no Node.js APIs in renderer
  sandbox: true,            // OS-level process sandbox
  preload: path.join(__dirname, 'preload.js'),
}
```

`electron/preload.js` is the **only** bridge between renderer and Node.js:
- Uses `contextBridge.exposeInMainWorld('electronAPI', { ... })` with named methods only.
- Every named method maps to exactly one channel in `VALID_INVOKE_CHANNELS` or `VALID_RECEIVE_CHANNELS`.
- Does not expose `require`, `process` (only reads `process.platform` as a static string), `__dirname`, or `Buffer`.
- All renderer IPC goes through `window.electronAPI.*` — never `require('electron')` directly.

**Security constraints — these rules are non-negotiable for all future changes:**

- Never set `nodeIntegration: true` in any `BrowserWindow`.
- Never set `contextIsolation: false` in any `BrowserWindow`.
- Never call `require()` or access `process` from renderer-side code (`builder/`).
- All new IPC channels must be added to `VALID_INVOKE_CHANNELS` or `VALID_RECEIVE_CHANNELS` in `electron/preload.js` AND documented in `docs/architecture.md` IPC Contract table before use.
- Every `ipcMain.handle()` must validate its payload before processing.
- After any change to `main.js` or `preload.js`, run `npm start`, open DevTools, and verify: `window.require === undefined`, `window.process === undefined`, `window.electronAPI` is an object.

---

## Architecture map

| File | Responsibility |
|---|---|
| `electron/main.js` | Electron entry point. Creates `BrowserWindow` (hardened — see security posture above), spawns Express as child process, handles IPC, persists config in `electron-store`. |
| `server.js` | Express HTTP layer. Defines all routes with rate limiters. Reads `index.html` once at startup into `indexTemplate`; injects CSP nonce per request. |
| `lib/build.js` | Orchestrates Monkey C compilation: validates input, generates project files, spawns `monkeyc`, handles timeout and SIGTERM. |
| `lib/preview.js` | Manages simulator lifecycle: checks if running, launches if needed, copies `.prg` to request-scoped temp dir, spawns `monkeydo`. |
| `lib/config.js` | Resolves all paths (SDK bin, developer key, export dir, temp dir, designs dir) with multi-level fallback. Returns the `cfg` object consumed by `server.js`. |
| `lib/design-store.js` | Saves, lists, and loads design JSON files. `saveDesign` is synchronous with atomic write-then-rename. `listDesigns` is async (`Promise.all` over `fs.promises.readFile`). |
| `lib/logger.js` | Structured JSON logger. Redacts sensitive fields (paths, keys) before emitting. Early-returns silently when `NODE_ENV === 'test'` unless `LOG_VERBOSE` is set. |
| `lib/keygen.js` | Generates RSA-4096 developer keys in PKCS#8 DER format. CPU-intensive (1-5 s). |

---

## Known patterns

### Rate limiters

Three instances are defined in `server.js`. Apply them by cost profile:

| Limiter | Cap | Use for |
|---|---|---|
| `healthLimiter` | 30 req/60s | Trivial in-memory or fast `existsSync` routes (`GET /api/health`) |
| `loadDesignLimiter` | 30 req/60s | Filesystem reads: `GET /`, `GET /api/designs`, `GET /api/designs/:filename`, `GET /api/designs/check/:name` |
| `buildLimiter` | 10 req/60s | CPU/disk-heavy: `POST /api/export`, `POST /api/preview`, `POST /api/save-design`, `POST /api/generate-key`, `GET /api/export/check/:name` |

Do not create new limiter instances. When in doubt between `loadDesignLimiter` and
`buildLimiter`, use `buildLimiter`.

### The `cfg` object

Built by `lib/config.js:getConfig()` and passed from `electron/main.js` to
`createServer()`. Shape:

```js
{
  sdkBin, monkeyc, monkeydo, simExe,  // resolved binary paths
  devKey, exportDir, tempDir, designsDir,
  sdkFound,   // boolean — monkeyc and monkeydo both exist
  keyFound,   // boolean — devKey exists
}
```

Do not store quoted paths (e.g., `"\"C:\\path\""`) in this object. Quote only at the
`spawn()` call site when `shell: true` is active on Windows.

### Mocking `child_process.spawn` in tests

`lib/build.js` and `lib/preview.js` destructure `spawn` at module load time. Use
`jest.mock('child_process')` at the file's top level so Jest hoists it before any
`require`. Then mutate the shared mock per test:

```js
jest.mock('child_process');
const childProcess = require('child_process');

const mockChild = new EventEmitter();
mockChild.stdout = new EventEmitter();
mockChild.stderr = new EventEmitter();
mockChild.kill = jest.fn(() => mockChild.emit('close', null, 'SIGTERM'));
childProcess.spawn.mockReturnValue(mockChild);
```

`jest.spyOn(childProcess, 'spawn')` will NOT intercept build.js's captured reference;
always use `childProcess.spawn.mockReturnValue()` directly.

---

## Server security contract (non-negotiable)

- **`server.js` MUST bind to `127.0.0.1` only. Never `0.0.0.0`.** Changing the bind address exposes all API endpoints to the local network.
- **Every `/api/` route MUST apply `requireSessionToken` middleware.** The only exceptions are `GET /health` (liveness probe, called before the renderer loads) and `GET /api/health` (SDK status, called by the Electron main process which sends the token itself). Page routes (`GET /`, static files) do not require a token.
- **Every route MUST apply a rate limiter** (`buildLimiter` or `loadDesignLimiter`). Do not add routes without one.
- **The session token is generated in `electron/main.js` via `crypto.randomBytes(32)` at app startup.** It is never hardcoded, never written to disk, and never logged.
- **Token comparison MUST use `crypto.timingSafeEqual()`.** Never use `===`. Timing-safe comparison prevents oracle attacks.
- **The token is held in the `preload.js` closure.** It is never exposed as a readable property on `window`. `apiFetch()` attaches it automatically — renderer code never touches it directly.
- **In standalone mode (`npm run server`), `WFB_SESSION_TOKEN` must be set before starting:**

  ```powershell
  # Windows PowerShell
  $env:WFB_SESSION_TOKEN = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
  npm run server
  ```

  ```sh
  # macOS / Linux
  WFB_SESSION_TOKEN=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") npm run server
  ```

  The server exits with code 1 if started standalone without the token.

- **All renderer API calls MUST go through `window.electronAPI.apiFetch()`**, not bare `fetch()`. The only exception is `fetch('/api/health')` in the web-mode fallback (guarded by `!window.electronAPI`) — that endpoint is token-exempt.

---

## What not to do

- **Do not enable `nodeIntegration` or disable `contextIsolation`.** These are the primary Electron attack vectors. The security posture above is enforced unconditionally.
- **Do not add IPC channels without updating `VALID_INVOKE_CHANNELS` / `VALID_RECEIVE_CHANNELS` in `preload.js` and the `docs/architecture.md` IPC table.** An undocumented channel is an unaudited channel.
- **Do not use `ipcMain.on()` with `event.returnValue`.** Synchronous IPC blocks the main process. Always use `ipcMain.handle()` + `ipcRenderer.invoke()`.
- **Do not store quoted paths in `cfg`.** Quote only at the `spawn()` call site:
  `process.platform === 'win32' ? \`"${cfg.monkeyc}"\` : cfg.monkeyc`.
- **Do not add `'unsafe-hashes'` to the CSP.** The `style-src` directive is
  `'self'` only. Inline styles belong in `builder/style.css`, not in HTML attributes.
- **Do not call `fs.readFileSync` inside route handlers.** The `index.html` template
  is read once at startup into `indexTemplate`; route handlers inject the per-request
  nonce into that cached string.
- **Do not apply `jest.useFakeTimers()` globally.** It blocks Promise microtask
  resolution and breaks async tests. Apply it only inside the specific test that needs
  it and restore with `jest.useRealTimers()` before the test exits.
- **Do not use `path.join(__dirname, 'designs')` in `server.js`.** The designs
  directory is `cfg.designsDir`, resolved by `lib/config.js` from the caller-supplied
  override or `os.homedir()` fallback — never from `__dirname`.
