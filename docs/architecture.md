# Architecture: Process Lifecycle and IPC Contract

## Execution Modes

### `npm start` — Electron mode (production and development)

The Electron main process (`electron/main.js`) owns the complete application lifecycle.
It spawns `server.js` as a managed child process, polls the `/health` endpoint until
the server is ready, then loads the renderer. When the user quits, the main process
sends SIGTERM to the server child before exiting.

Use this mode when running the app as a desktop application.

### `npm run server` — Standalone mode (backend development and CI)

`server.js` runs directly under Node.js with no Electron dependency. The port defaults
to 3000 (or `WFB_SERVER_PORT`). All route and middleware behavior is identical to
Electron mode — `createServer()` is the shared entry point for both modes.

Use this mode when developing server-side features, running integration tests, or in
CI environments where Electron is unavailable.

---

## Process Lifecycle — Electron Mode

```
electron/main.js (main process)          server.js (child process)
─────────────────────────────────────    ────────────────────────────────────
app.on('ready') fires
│
├─ startServer()
│    spawn(electronBinary, ['server.js'])  ──→ process starts
│    (returns immediately)                        │
│                                                 │ listens on 127.0.0.1:PORT
│                                                 │ logs [server] listening...
├─ waitForServer()
│    poll GET /health every 200ms ──────────→ 200 { status:'ok', pid, ts }
│    (up to 10 seconds)
│    on timeout: dialog.showErrorBox → app.quit()
│
├─ createWindow()
│    loadURL('http://127.0.0.1:PORT')
│    renderer navigates to /
│
└─ startHealthPolling()
     GET /api/health every 5s (SDK/key status)

User closes window / Ctrl+Q / File→Exit
│
app.on('before-quit') fires
│
├─ serverProcess.kill('SIGTERM') ──────────→ process.on('SIGTERM') fires
│                                                 │ server.close()
│                                                 └─ process.exit(0)
│
process.on('exit') fires (safety net)
└─ serverProcess.kill() if not already killed
```

---

## IPC Contract

All channels use `ipcMain.handle` (request/response). Channels annotated with
**[server required]** must only be called after `waitForServer()` resolves.

### Renderer → Main

| Channel | Input | Return shape | Notes |
|---|---|---|---|
| `dialog:open` | `options` (Electron dialog options) | `{ filePaths, canceled }` | Shows native file picker |
| `settings:getConfig` | none | `{ sdkBin, devKey }` | Reads from electron-store |
| `settings:saveConfig` | `{ sdkBin, devKey }` | `{ success: true }` | Saves to store, then `app.relaunch()` after 100ms. Rate-limited: 1 call / 2s |
| `settings:autoDetect` | none | `{ sdkBin, devKey, sdkFound, keyFound }` | Scans platform SDK paths. Rate-limited: 1 call / 2s |
| `key:generate` | `{ outputPath?, force? }` | `{ success, path?, exists?, error? }` | RSA-4096. Path must be inside `~/.garmin/` or `~/Documents/`. Rate-limited: 1 call / 5s |
| `shell:openVSCode` | `requestId` (string, `[a-z0-9]+`) | `{ success, error? }` | Opens exported project folder via `vscode://` URI. requestId is validated server-side. |
| `background:import` | none | `{ success, canceled?, assetId?, dataUrl?, error? }` | Opens native PNG file picker, validates magic bytes + dimensions (390×390) + size (≤512 KB), copies to `userData/wfb-backgrounds/<uuid>.png`. Returns dataUrl for immediate canvas use; renderer never receives the file path. Rate-limited: 1 call / 2s |

### Main → Renderer (fire-and-forget sends)

| Channel | Payload | When fired |
|---|---|---|
| `app:health-status` | SDK health object | Every 5s while window is focused |
| `app:health-warning` | SDK health object with `ok: false` | When `/api/health` returns `ok: false` or server is unreachable |
| `file:newDesign` | none | File → New Design menu item |
| `settings:showOverlay` | none | Ctrl+, menu item; also on startup if config is incomplete |

---

## Port Configuration

| Variable | Default | Description |
|---|---|---|
| `WFB_SERVER_PORT` | `3000` | TCP port server.js binds on `127.0.0.1` |

The server always binds to `127.0.0.1` only, never `0.0.0.0`. External network
access is not possible regardless of firewall configuration.

**Overriding the port** (e.g., for test isolation):

```sh
# Standalone mode
WFB_SERVER_PORT=3001 npm run server

# Electron mode (pass via env before launching)
WFB_SERVER_PORT=3001 npm start
```

In Electron mode, the main process passes `WFB_SERVER_PORT` to the spawned child
process via the `env` argument to `spawn()`.

---

## Known Limitations and Follow-up TODOs

### Dynamic port allocation

The port is currently fixed at `WFB_SERVER_PORT` (default 3000). If port 3000 is
already in use (by another app or a previous unclean exit), startup will fail.

**Follow-up**: allocate a random port in the main process using `net.createServer`,
pass it to the child via `WFB_SERVER_PORT`, and use it in all URL construction.
This eliminates port conflicts on rapid restart.

### Windows SIGTERM (graceful shutdown)

On Windows, `ChildProcess.kill()` calls `TerminateProcess()` which is equivalent to
SIGKILL. The `process.on('SIGTERM', ...)` handler in `server.js` does **not** fire on
Windows. The server child process is terminated immediately without a graceful shutdown.

**Impact**: in-flight builds or design saves may be interrupted. The export directory
sweep on next launch will clean up any orphaned request directories.

**Follow-up**: implement graceful Win32 shutdown using one of:
- A named pipe that the main process writes a shutdown message to
- An IPC channel (e.g., `process.send({ type: 'shutdown' })` via the `ipc` stdio channel)
- A dedicated HTTP endpoint `POST /shutdown` bound to localhost only

This is the approach to prefer over trying to emulate POSIX signals on Win32.
