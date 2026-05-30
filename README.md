# Garmin Vivoactive 6 Watch Face Builder

A local web-based visual design tool for creating Garmin Vivoactive 6 watch faces, with one-click export to a valid Connect IQ Monkey C project.

> **Contributing?** See [DEVELOPER.md](DEVELOPER.md) for architecture, testing, and how to add new features.

---

## Quick start

### Web server (development / testing)
```powershell
npm install
npm start
# App runs at http://127.0.0.1:<random-port> in Express mode
```

### Electron app (desktop / packaged)
```powershell
npm install
npm run dev
# Electron window opens with embedded Express server
```

---

## Environment

| Component | Version / Path |
|-----------|---------------|
| Java JDK | 21.0.11 (`C:\Program Files\Common Files\Oracle\Java\javapath\java.exe`) |
| Connect IQ SDK | 9.1.0 (`%APPDATA%\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.1.0-…\`) |
| monkeyc | `…\bin\monkeyc.bat` |
| Developer key | `C:\Users\mr_la\.garmin\developer_key.der` |
| Device definition | `vivoactive6` (native in SDK 9.1.0) |
| Node.js | v26.2.0 |

### Add monkeyc to PATH (one-time)

```powershell
$sdkBin = "C:\Users\mr_la\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.1.0-2026-03-09-6a872a80b\bin"
$cur = [Environment]::GetEnvironmentVariable("PATH","User")
[Environment]::SetEnvironmentVariable("PATH","$cur;$sdkBin","User")
# Restart terminal, then: monkeyc --version
```

---

## Using the builder

1. **Add elements** — click an element in the left palette, or press **＋ Add Element** in the toolbar.
2. **Position** — drag elements on the canvas. The dashed red circle marks the safe area (370 px inner circle); elements near the edge turn red.
3. **Properties** — click an element to select it, then edit position, size, font, color, and alignment in the right panel.
4. **Layers** — use **▲ Forward / ▼ Back** in the toolbar or the Z-index field in Properties.
5. **Undo / Redo** — toolbar buttons or `Ctrl+Z` / `Ctrl+Y` (10-step history).
6. **Export** — click **⚙ Export .prg**. The server generates the Monkey C project at `exported-garmin-project/` and runs `monkeyc` to build `WatchFace.prg`.

---

## Simulator testing

1. Open `exported-garmin-project/` in VS Code.
2. Press **F5** (Run Without Debugging).
3. Select **vivoactive6** from the device dropdown.
4. The Connect IQ Simulator launches and renders your watch face.
5. Use the simulator's **Data** menu to inject test values (heart rate, steps, etc.).

---

## Building the .prg

### Via VS Code (recommended)
`Command Palette` → `Monkey C: Build for Device` → `vivoactive6` → choose output directory.

### Via CLI
```powershell
$sdk = "C:\Users\mr_la\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.1.0-2026-03-09-6a872a80b\bin\monkeyc.bat"
& $sdk `
  -o ".\exported-garmin-project\bin\WatchFace.prg" `
  -f ".\exported-garmin-project\monkey.jungle" `
  -y "C:\Users\mr_la\.garmin\developer_key.der" `
  -d vivoactive6 `
  --warn
```

---

## Deploying to the watch

1. Connect the Vivoactive 6 via USB.
2. It mounts as a removable drive.
3. Copy `exported-garmin-project\bin\WatchFace.prg` into `GARMIN\APPS\` on the drive.
4. Safely eject the watch.
5. On the watch: **Settings → Watch Faces** → select your new face.

---

## Project structure

```
WatchFace Builder/
├── server.js               Express backend — file generation + monkeyc build
├── package.json
├── builder/                Frontend (served at http://localhost:3000)
│   ├── index.html
│   ├── style.css
│   ├── app.js              Main orchestrator
│   └── modules/
│       ├── canvas.js       390×390 round canvas editor
│       ├── elements.js     Element data model + undo/redo history
│       ├── properties.js   Right-panel property editor
│       ├── export.js       POST to /api/export
│       └── data-fields.js  Field definitions (extend by appending objects)
├── garmin-project-template/ Reference template files
└── exported-garmin-project/ Generated on export (git-ignored)
```

---

## Packaging and distribution

### Build the packaged app
```powershell
npm run package
# Output: out/WatchFace Builder-win32-x64/
```

### Create the installer
```powershell
npm run make
# Output: out/make/squirrel.windows/x64/WatchFaceBuilder Setup.exe
```

### Install and run
1. Run `WatchFaceBuilder Setup.exe` on any Windows machine (no dependencies required).
2. On first launch, **Settings** overlay appears — configure SDK path and developer key.
3. Design watch faces, export, and preview in the simulator.
4. Exports saved to `Documents/WatchFaceBuilder/exported/` (user-writable location).

### Troubleshooting
- **"SmartScreen blocked it"** — installer is unsigned. Click "More info → Run anyway."
- **First run shows Settings overlay** — normal behavior. Fill in SDK paths once, then relaunch is automatic.
- **Export folder location** — in packaged app, changes to `Documents/WatchFaceBuilder/exported/` instead of project root (for write permissions).

---

## Extending the field list

Add an entry to `builder/modules/data-fields.js`:

```javascript
{ id: 'myField', label: 'My Field', icon: '⭐',
  apiCall: 'Activity.getActivityInfo().myField',
  defaultFont: 'FONT_MEDIUM', defaultColor: '#FFFFFF', preview: '42' }
```

Then add the corresponding `generateDataFetch` and `generateDrawCall` cases to `server.js`.
No other files need to change.

---

## Gotchas

- **Device ID:** `vivoactive6` is the exact ID in SDK 9.1.0 device definitions.
- **API level:** `minSdkVersion="4.2.0"` — required for Connect IQ 9.x features.
- **Colors:** Monkey C uses `0xRRGGBB` integer literals, not CSS hex strings. `server.js` converts automatically.
- **Text origin:** `dc.drawText()` with `TEXT_JUSTIFY_CENTER | TEXT_JUSTIFY_VCENTER` centers text at (x, y). The canvas editor uses the same center-anchor convention, so positions export correctly.
- **Sensor data:** All `Activity` / `UserProfile` calls must live inside `onUpdate()`. Never cache sensor handles across lifecycle events.
- **Permissions:** `manifest.xml` is generated with only the permissions required by the placed elements — do not add blanket permissions.
- **Safe area:** 370 px inner circle (10 px inset from the 390 px display edge). The builder enforces this constraint during drag.
