# Garmin Vivoactive 6 Watch-Face Builder

## Project overview
Build a local web-based visual design tool that lets me design a custom watch face for the Garmin Vivoactive 6 (390×390 round display), then export a valid Garmin Connect IQ Monkey C project that can be compiled into a .prg file for installation on the watch.

## Quick start
- **`npm start`** — Launch the desktop app (Electron) — automatically opens the watch face builder in a window
- **`npm run server`** — Run just the Node.js backend server (for advanced use)
- **`npm test`** — Run test suite

## Tech stack
- **Desktop**: Electron (cross-platform native window + IPC bridge to main process)
- **Backend**: Node.js + Express (auto-detects Garmin SDK, generates Monkey C code)
- **Frontend**: Vanilla JavaScript (canvas editor, property panel, element palette)
- **Code generation**: Monkey C watch face → Garmin Connect IQ → .prg binary for device
- **SDK**: Garmin Connect IQ 9.1.0+ (minApiLevel 4.2.0 for Vivoactive 6)

---

## Working style for this repo

### Code review and refactor rules
When asked to analyze, clean up, or refactor code, act as a senior software engineer and code reviewer.

Follow this process:
1. Briefly summarize what the code does in 2–4 sentences.
2. List specific issues that hurt readability or maintainability, such as naming problems, long functions, duplication, unclear control flow, tight coupling, weak error handling, or missing documentation.
3. Suggest concrete improvements and explain why each change helps.
4. Provide a refactored version that preserves existing behavior unless I explicitly approve functional changes.
5. End with a short migration notes section that calls out any non-trivial changes, risks, or follow-up checks.

Refactor expectations:
- Preserve behavior unless I explicitly ask for feature changes.
- Prefer small, reviewable edits over large rewrites.
- Use clear, consistent names.
- Break large functions into smaller focused helpers when it improves clarity.
- Keep modules loosely coupled and easy to edit independently.
- Add or improve docstrings, function headers, and inline comments only where they clarify non-obvious logic.
- Remove misleading, stale, or redundant comments.
- Follow idiomatic style for the language and framework in use.
- Keep diffs practical and easy to review.
- If a full rewrite is not justified, do the minimum refactor that materially improves readability and maintainability.

Preferred output format when reviewing code:
- Summary
- Issues
- Proposed changes
- Refactored code
- Migration notes

Documentation expectations:
- Document public functions, exported modules, important classes, and non-obvious data structures.
- Explain why something exists or why logic is tricky; do not comment obvious line-by-line behavior.
- Include assumptions, constraints, side effects, and error cases where relevant.
- For project files, keep README-level guidance high level and keep implementation details close to the code.

If the code is large:
- Prioritize core logic, public interfaces, error handling, and files currently being edited.
- State clearly what was not refactored and why.

### General implementation rules
- Generate work in small, reviewable steps.
- Before major changes, explain the approach and tradeoffs.
- Prefer maintainable, modular code over clever shortcuts.
- Surface blockers and assumptions explicitly.
- Do not silently change architecture or file layout without explaining why.

---

## Phase 0 — Environment setup (do this first, step by step)

Before writing any application code, guide me through installing and verifying the full toolchain. For each step, provide the exact shell commands for Windows (PowerShell), macOS, and Linux where they differ.

### Required tools
1. **Java JDK 11+**  
   - Check: `java -version`  
   - Install via: winget (Windows), Homebrew (macOS), apt/dnf (Linux)  
   - Set JAVA_HOME if not automatically configured.

2. **Garmin Connect IQ SDK Manager**  
   - Download from: https://developer.garmin.com/connect-iq/sdk/  
   - After install, launch SDK Manager, log in with Garmin Connect credentials.  
   - Download the latest stable SDK.  
   - Download the **Vivoactive 6** device definition (or the closest available if not yet in the device list; note which device ID is used and why).  
   - Verify: `connectiq --version` or locate `monkeyc` in the SDK bin directory.  
   - Document the SDK install path (e.g., `~/Library/Application Support/Garmin/ConnectIQ` on macOS, `%APPDATA%\\Garmin\\ConnectIQ` on Windows).

3. **VS Code + Monkey C extension**  
   - Install VS Code: https://code.visualstudio.com/  
   - Install extension: search "Monkey C" by Garmin in the Extensions Marketplace.  
   - Verify installation via Command Palette → "Monkey C: Verify Installation".  
   - Generate a developer key via Command Palette → "Monkey C: Generate a Developer Key" (required for signing .prg files).

4. **Node.js (LTS)**  
   - Needed only to run the local web builder dev server.  
   - Check: `node -v` and `npm -v`

5. **Verify everything works**  
   - Create a throwaway scaffold project via VS Code Command Palette → "Monkey C: New Project" → Watch Face → target Vivoactive 6 → run in simulator (F5).  
   - Confirm the Connect IQ Simulator launches and renders the watch face.

---

## Phase 1 — Architecture decision

Before writing any code, propose and explain the architecture for the builder app. Consider these three options:

### Option A: Local web app (HTML/CSS/JS, served via Node.js or Python)
- Canvas editor runs in the browser.
- Export button writes the Monkey C project files to disk via a small Node/Express backend, then calls monkeyc via child_process to build the .prg.
- Pros: fastest to build, easy to iterate on the UI, no native dependencies.
- Cons: requires a tiny backend process; file system access needs a local server.

### Option B: Electron app
- Full desktop app with Node.js backend embedded.
- Native file dialogs, direct file system access, can spawn monkeyc directly.
- Pros: cleaner desktop UX, no browser security sandbox issues.
- Cons: heavier setup, slower iteration.

### Option C: Pure static HTML + manual export
- No backend; editor saves the exported project as a downloadable ZIP.
- User unzips and builds manually with VS Code + monkeyc CLI.
- Pros: simplest, zero dependencies.
- Cons: no automated build pipeline.

**Recommend Option A (local web app with Node/Express backend) for the MVP** unless there is a strong reason to prefer another. Explain the tradeoff clearly, then proceed with the recommended option.

---

## Phase 2 — Project scaffold (generate in small, reviewable steps)

### 2.1 Folder structure

Create the following structure:
WatchFace Builder/
├── CLAUDE.md — project instructions for Claude Code
├── README.md — build, simulator, and deploy instructions
├── package.json
├── server.js — Node/Express backend (file write + monkeyc build trigger)
├── builder/ — the visual editor (frontend)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── modules/
│       ├── canvas.js — 390×390 round canvas editor
│       ├── elements.js — element types and default configs
│       ├── properties.js — per-element property panel
│       ├── export.js — Monkey C project file generator
│       └── data-fields.js — data field definitions (extensible list)
├── garmin-project-template/ — Monkey C project template files
├── manifest.xml
├── monkey.jungle
├── source/
│   └── WatchFaceView.mc
├── resources/
├── layouts/
│   └── layout.xml
├── strings/
│   └── strings.xml
└── fonts/

### 2.2 Visual editor (builder/index.html + modules)

Build a dark-themed single-page app with three panels:

**Left panel — Element palette**  
A scrollable list of all available data field elements the user can add to the canvas. Each entry shows the field name and a small icon. Include at minimum:
- Hours / Minutes / Seconds (digital)
- AM/PM indicator
- Date (day of week, month/day, full date)
- Steps / Step goal progress
- Heart rate (current, zone indicator)
- Battery level (percentage + icon)
- Calories burned
- Floors climbed
- Distance (km/mi)
- Notification count
- Active minutes / Intensity minutes
- Sunrise/Sunset time
- Weather temperature (if API supported)
- Custom label (static text)
- Decorative shapes (circle, line, arc)

Design the field list as a flat array of objects in `data-fields.js` with the shape:
```javascript
{ id: 'heartRate', label: 'Heart Rate', icon: '❤', apiCall: 'Activity.getHeartRate()', defaultFont: 'FONT_MEDIUM', defaultColor: 0xFF0000 }
```
So new fields can be added by appending to the array without touching any other code.

**Center panel — Canvas**
- 390×390 pixel circle canvas representing the Vivoactive 6 screen.
- Black background, round clip path.
- Safe area: fields must not extend beyond a 370×370 inner circle (10px inset from edge).
- Click to select an element; drag to move it; corner handles to resize.
- Selected element is highlighted with a dashed white outline.
- Layer order: elements rendered in z-order; Bring Forward / Send Backward buttons in the toolbar.
- Live preview updates as properties change.

**Right panel — Properties**  
When an element is selected, show editable properties:
- Position (X, Y) — numeric inputs, constrained to safe area
- Width / Height — with lock-aspect-ratio toggle
- Font (select from Garmin system fonts: FONT_XTINY, FONT_TINY, FONT_SMALL, FONT_MEDIUM, FONT_LARGE, FONT_NUMBER_MILD, FONT_NUMBER_MEDIUM, FONT_NUMBER_HOT, FONT_NUMBER_THAI_HOT)
- Font color (hex color picker → converts to 0xRRGGBB Monkey C format)
- Text align (left, center, right)
- Visibility (always, only awake, only sleep)
- Format string (e.g., "%02d:%02d" for time)
- Layer order (numeric, for fine control)
- Delete button (removes from canvas)

**Toolbar**
- Add Element (opens field picker modal)
- Undo / Redo (10-step history)
- Show/hide safe area guide
- Export Project (triggers Phase 3 export pipeline)
- Open in VS Code (if VS Code CLI is available, run `code ./exported-project`)

### 2.3 Safe area enforcement

All element bounding boxes must be constrained within the 370×370 inner circle. When a drag or resize operation would push an element outside this circle, clamp it to the nearest valid position. Show a subtle red highlight when an element is near the edge.

---

## Phase 3 — Export pipeline (Monkey C project generation)

When the user clicks "Export Project":

### 3.1 File generation (export.js + server.js)

The frontend (`export.js`) serializes the current canvas state as JSON and POSTs it to `POST /api/export` on the local Express server. The server generates a complete Garmin Connect IQ project at `./exported-garmin-project/`.

**manifest.xml** — generate with:
- `<iq:application type="watchface">`
- `<iq:product id="vivoactive6"/>` (or closest supported device ID in the installed SDK)
- API level: 4.2.0 minimum (verify against installed SDK; note the exact version used)
- Permissions: only request what the placed fields actually need (e.g., `UserProfile` for steps, `Sensor` for heart rate)

**monkey.jungle** — standard jungle file referencing resources and source directories.

**WatchFaceView.mc** — generated Monkey C source. Structure:
```monkeyc
using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;
using Toybox.Activity as Activity;
using Toybox.UserProfile as UserProfile;
using Toybox.SensorHistory as SensorHistory;

class WatchFaceView extends Ui.WatchFace {
    function initialize() { WatchFace.initialize(); }
    function onLayout(dc) { setLayout(Rez.Layouts.WatchFace(dc)); }
    function onUpdate(dc) {
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_BLACK);
        dc.clear();
        // Generated drawElement calls for each canvas element
    }
}
```
For each element on the canvas, generate the corresponding `dc.drawText()` or `dc.drawLine()` / `dc.drawArc()` call with the exact X, Y, font, and color from the canvas state. Convert hex colors to `0xRRGGBB` integer literals. Map font names to `Gfx.FONT_MEDIUM` etc. constants.

**layout.xml** — generate a minimal layout XML that matches the canvas elements (use programmatic drawing in `onUpdate()` as primary rendering; layout.xml serves as fallback/structure reference).

**strings.xml** — include app name and any static labels.

### 3.2 Build trigger

After writing the project files, the server runs:
```bash
monkeyc -o ./exported-garmin-project/bin/WatchFace.prg \
-f ./exported-garmin-project/monkey.jungle \
-y [developer-key-path] \
-d vivoactive6 \
--warn
```

The server captures stdout/stderr and returns it to the frontend as a build log. The frontend displays the log in a scrollable terminal-style overlay.

If `monkeyc` is not found on PATH, the server returns the error message with exact instructions for adding the Garmin SDK `bin` directory to PATH.

If direct .prg generation is not possible in one automated step (e.g., developer key not configured), fall back gracefully: write all the project files and return instructions for the user to run `Monkey C: Build for Device` in VS Code manually.

---

## Phase 4 — Simulator and deployment workflow

Generate the following in `README.md`:

### Simulator testing
1. Open `exported-garmin-project/` in VS Code.
2. Press F5 (or Run Without Debugging).
3. Select `vivoactive6` from the device dropdown.
4. The Connect IQ Simulator will launch and render your watch face.
5. Use the simulator's data injection controls to test each data field (heart rate, steps, etc.).

### Building the .prg
Via VS Code: Command Palette → `Monkey C: Build for Device` → select `vivoactive6` → choose output directory.  
Via CLI: show the exact monkeyc command from Phase 3.2 with correct paths.

### Deploying to the watch
1. Connect Vivoactive 6 to your computer via USB.
2. The watch appears as a removable drive.
3. Navigate to `GARMIN/APPS/` on the watch drive.
4. Copy `WatchFace.prg` into that folder.
5. Safely eject the watch.
6. On the watch: Settings → Watch Faces → select your new face.

---

## Phase 5 — CLAUDE.md for this project

Ensure `CLAUDE.md` includes:
- One-line project description
- Tech stack: Node.js + Express backend, vanilla JS frontend, Garmin Connect IQ SDK / Monkey C
- Key commands: `npm start` (start builder server), `npm run export` (export and build .prg)
- The exact paths to: SDK bin directory, developer key file, device definition files
- Gotchas:
  - The Vivoactive 6 device ID to use in manifests and build commands
  - API level compatibility notes
  - Permissions that must be declared in manifest.xml for each data field type
  - The safe area constraint (370px inner circle for 390px display)
  - Monkey C uses `0xRRGGBB` integer color literals, not hex strings
  - `dc.drawText()` origin is top-left of the text bounding box by default; use `Gfx.TEXT_JUSTIFY_CENTER` for centered elements
  - All sensor data access (heart rate, steps) must use Toybox API calls inside `onUpdate()`; never cache sensor handles across lifecycle events

---

## Constraints and explicit notes

- **Do not assume drag-and-drop output maps directly to Garmin layouts.** All rendering is done via Monkey C `dc.draw*` calls in `onUpdate()`, generated from the canvas element state.
- **Be explicit about API level and device support.** If the Vivoactive 6 is not yet in the installed SDK device list, use the closest supported device (e.g., Venu 3 or similar 390×390 round device), state which device ID is used, and note that the manifest should be updated when the Vivoactive 6 definition is released.
- **Permissions in manifest.xml must match what the code uses.** Generate the permissions list dynamically from the placed field types, not as a blanket include-all.
- **Keep the code modular.** Each module (canvas, elements, properties, export, data-fields) must be independently editable without breaking others. No module should be longer than ~300 lines.
- **MVP first.** Get the canvas editor working with time + date + 3 data fields, export, and build before adding the full field list. Mark future-expansion items with `// TODO: extend` comments.
- **Error handling.** If the monkeyc build fails, show the full compiler error in the UI. Never silently swallow errors.

---

## Deliverables checklist

By the end of all phases, I expect:
- [ ] Toolchain installation verified
- [ ] Working local web builder MVP running at http://localhost:3000
- [ ] Canvas editor with time, date, heart rate, steps, battery fields
- [ ] Property panel for font, color, position, format
- [ ] Export pipeline generating valid Monkey C project files
- [ ] Automated .prg build via monkeyc CLI (with manual fallback documented)
- [ ] README.md with simulator, build, and deploy instructions
- [ ] CLAUDE.md with project configuration

Start with Phase 0. After each phase is complete, pause and confirm before proceeding to the next.
