const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

const app = express();
const PORT = 3000;

const SDK_BIN  = 'C:\\Users\\mr_la\\AppData\\Roaming\\Garmin\\ConnectIQ\\Sdks\\connectiq-sdk-win-9.1.0-2026-03-09-6a872a80b\\bin';
const MONKEYC  = path.join(SDK_BIN, 'monkeyc.bat');
const MONKEYDO = path.join(SDK_BIN, 'monkeydo.bat');
const SIM_EXE  = path.join(SDK_BIN, 'simulator.exe');
const DEV_KEY  = 'C:\\Users\\mr_la\\.garmin\\developer_key.der';
const EXPORT_DIR = path.join(__dirname, 'exported-garmin-project');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'builder')));

app.post('/api/export', (req, res) => {
  const { elements = [], projectName = 'MyWatchFace' } = req.body;

  try {
    generateProjectFiles(elements, projectName);
  } catch (err) {
    return res.json({ success: false, error: `File generation failed: ${err.message}`, log: '' });
  }

  if (!fs.existsSync(MONKEYC)) {
    return res.json({
      success: false,
      error: `monkeyc not found. Add the SDK bin directory to PATH:\n  ${SDK_BIN}\nThen restart this server, or open exported-garmin-project/ in VS Code and run "Monkey C: Build for Device".`,
      log: '',
      projectPath: EXPORT_DIR,
    });
  }

  if (!fs.existsSync(DEV_KEY)) {
    return res.json({
      success: false,
      error: `Developer key not found at: ${DEV_KEY}\nGenerate one via VS Code Command Palette → "Monkey C: Generate a Developer Key".`,
      log: '',
      projectPath: EXPORT_DIR,
    });
  }

  const prgName = safePrgName(projectName);
  const outPrg  = path.join(EXPORT_DIR, 'bin', `${prgName}.prg`);
  const jungle  = path.join(EXPORT_DIR, 'monkey.jungle');

  // All paths quoted so spaces in directory names (e.g. "WatchFace Builder") don't split the args
  const cmd = `"${MONKEYC}" -o "${outPrg}" -f "${jungle}" -y "${DEV_KEY}" -d vivoactive6 --warn`;

  exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
    const log = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (err) {
      return res.json({ success: false, error: 'Build failed — see log for details.', log, projectPath: EXPORT_DIR });
    }
    res.json({ success: true, log, prgPath: outPrg, projectPath: EXPORT_DIR });
  });
});

app.post('/api/open-vscode', (req, res) => {
  exec(`code "${EXPORT_DIR}"`, (err) => {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/preview', (req, res) => {
  const { elements = [], projectName = 'WatchFacePreview' } = req.body;

  try {
    generateProjectFiles(elements, projectName);
  } catch (err) {
    return res.json({ success: false, error: `File generation failed: ${err.message}`, log: '' });
  }

  if (!fs.existsSync(MONKEYC) || !fs.existsSync(DEV_KEY)) {
    return res.json({ success: false, error: 'monkeyc or developer key not found.', log: '' });
  }

  const outPrg = path.join(EXPORT_DIR, 'bin', 'WatchFace.prg');
  const jungle = path.join(EXPORT_DIR, 'monkey.jungle');
  // Use vivoactive6 (not vivoactive6_sim) — the SDK Devices dir only has vivoactive6.
  // monkeydo must receive the same device ID as the build target.
  const buildCmd = `"${MONKEYC}" -o "${outPrg}" -f "${jungle}" -y "${DEV_KEY}" -d vivoactive6 --warn`;

  exec(buildCmd, { timeout: 60000 }, (buildErr, stdout, stderr) => {
    const log = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (buildErr) {
      return res.json({ success: false, error: 'Build failed — see log.', log });
    }

    // Check if simulator is already running
    exec('tasklist /FI "IMAGENAME eq simulator.exe" /NH', (_, taskOut) => {
      const simRunning = taskOut && taskOut.toLowerCase().includes('simulator.exe');

      if (!simRunning) {
        spawn(SIM_EXE, [], { detached: true, stdio: 'ignore' }).unref();
      }

      res.json({ success: true, log, message: simRunning ? 'Reloading in simulator…' : 'Starting simulator…' });

      // Poll until simulator.exe process is visible, then give it 5s to finish initializing
      waitForSimulator(() => {
        // monkeydo.bat passes %prg_path% unquoted to Java, so spaces in the path break it.
        // Copy the .prg to a no-spaces temp path to work around this.
        const tmpDir = 'C:\\Temp\\CIQPreview';
        const tmpPrg = path.join(tmpDir, 'WatchFace.prg');
        try { fs.mkdirSync(tmpDir, { recursive: true }); fs.copyFileSync(outPrg, tmpPrg); } catch {}

        const prgArg = fs.existsSync(tmpPrg) ? tmpPrg : outPrg;
        console.log('[monkeydo] loading:', prgArg);
        // monkeydo is a long-lived debug session — use exec with no timeout so it
        // isn't killed early. The HTTP response already went out; callback fires when done.
        exec(`"${MONKEYDO}" "${prgArg}" vivoactive6`, (mdErr, mdOut, mdErr2) => {
          const mdLog = [mdOut, mdErr2].filter(Boolean).join('\n').trim();
          if (mdErr) console.error('[monkeydo] failed:', mdErr.message, '\n', mdLog);
          else console.log('[monkeydo] OK:', mdLog || '(no output)');
        });
      });
    });
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safePrgName(name) {
  return ((name || 'WatchFace')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 30)) || 'WatchFace';
}

// ─── Simulator helpers ────────────────────────────────────────────────────────

// Poll until simulator.exe is in the process list, then wait 2s for it to init
function waitForSimulator(callback, deadline) {
  if (!deadline) deadline = Date.now() + 20000; // 20s max
  exec('tasklist /FI "IMAGENAME eq simulator.exe" /NH', (_, out) => {
    if (out && out.toLowerCase().includes('simulator.exe')) {
      console.log('[sim] simulator.exe is running — waiting 8s for init');
      setTimeout(callback, 8000);
    } else if (Date.now() < deadline) {
      setTimeout(() => waitForSimulator(callback, deadline), 1000);
    } else {
      console.error('[sim] simulator never became ready within 20s');
      callback();
    }
  });
}

// ─── Project file generators ──────────────────────────────────────────────────

const TEMPLATE_DIR = path.join(__dirname, 'garmin-project-template');

function generateProjectFiles(elements, projectName) {
  const dirs = [
    EXPORT_DIR,
    path.join(EXPORT_DIR, 'source'),
    path.join(EXPORT_DIR, 'resources', 'layouts'),
    path.join(EXPORT_DIR, 'resources', 'drawables'),
    path.join(EXPORT_DIR, 'resources', 'strings'),
    path.join(EXPORT_DIR, 'resources', 'fonts'),
    path.join(EXPORT_DIR, 'bin'),
  ];
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  // Copy launcher icon assets from template
  const iconSrc = path.join(TEMPLATE_DIR, 'resources', 'drawables', 'launcher_icon.png');
  const iconDst = path.join(EXPORT_DIR,   'resources', 'drawables', 'launcher_icon.png');
  if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, iconDst);
  fs.writeFileSync(
    path.join(EXPORT_DIR, 'resources', 'drawables', 'drawables.xml'),
    `<drawables xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://developer.garmin.com/downloads/connect-iq/resources.xsd">\n    <bitmap id="LauncherIcon" filename="launcher_icon.png" />\n</drawables>\n`,
  );

  // VS Code Monkey C extension needs the developer key path
  const vscodeDir = path.join(EXPORT_DIR, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(path.join(vscodeDir, 'settings.json'),
    JSON.stringify({ 'monkeyC.developerKeyPath': DEV_KEY }, null, 2) + '\n');

  const permissions = getRequiredPermissions(elements);

  fs.writeFileSync(path.join(EXPORT_DIR, 'manifest.xml'),   generateManifest(projectName, permissions));
  fs.writeFileSync(path.join(EXPORT_DIR, 'monkey.jungle'),  generateJungle());
  fs.writeFileSync(path.join(EXPORT_DIR, 'source', 'WatchFaceView.mc'), generateMonkeyC(elements));
  fs.writeFileSync(path.join(EXPORT_DIR, 'resources', 'layouts', 'layout.xml'), generateLayout());
  fs.writeFileSync(path.join(EXPORT_DIR, 'resources', 'strings', 'strings.xml'), generateStrings(projectName));
}

function getRequiredPermissions(elements) {
  const permMap = {
    restingHeartRate: 'UserProfile',
    steps:            'UserProfile',
    stepGoal:         'UserProfile',
    calories:         'UserProfile',
    activeCalories:   'UserProfile',
    intensityMins:    'UserProfile',
    floorsClimbed:    'UserProfile',
    distance:         'UserProfile',
    hrGraph:          'SensorHistory',
    spo2:             'SensorHistory',
    respirationRate:  'SensorHistory',
    hrvStatus:        'SensorHistory',
    bodyBattery:      'SensorHistory',
    stressLevel:      'SensorHistory',
    steps:            'UserProfile',
    stepGoal:         'UserProfile',
    calories:         'UserProfile',
    activeCalories:   'UserProfile',
    intensityMins:    'UserProfile',
    distance:         'UserProfile',
    floorsClimbed:    'UserProfile',
    vo2Max:           'UserProfile',
    fitnessAge:       'UserProfile',
    sunrise:          'Positioning',
    sunset:           'Positioning',
    timeTillSunEvent: 'Positioning',
    weather:          'Positioning',
    weatherHiLo:      'Positioning',
    // moonPhase uses only Time.now() — no Positioning permission needed
  };
  const perms = new Set();
  elements.forEach(el => { const p = permMap[el.fieldId]; if (p) perms.add(p); });
  return [...perms];
}

function generateManifest(projectName, permissions) {
  const ts = Date.now().toString(16).padStart(12, '0').slice(-12);
  const permXml = permissions.map(p => `            <iq:uses-permission id="${p}"/>`).join('\n');
  const permBlock = permissions.length
    ? `<iq:permissions>\n${permXml}\n        </iq:permissions>`
    : `<iq:permissions/>`;

  return `<?xml version="1.0"?>
<iq:manifest version="3" xmlns:iq="http://www.garmin.com/xml/connectiq">
    <iq:application id="a3872ef0-6346-4321-abcd-${ts}" type="watchface" name="@Strings.AppName" entry="WatchFaceApp" launcherIcon="@Drawables.LauncherIcon" minApiLevel="4.2.0">
        <iq:products>
            <iq:product id="vivoactive6"/>
        </iq:products>
        ${permBlock}
        <iq:languages>
            <iq:language>eng</iq:language>
        </iq:languages>
        <iq:barrels/>
    </iq:application>
</iq:manifest>
`;
}

function generateJungle() {
  return `project.manifest = manifest.xml

base.sourcePath = source
base.resourcePath = resources

vivoactive6.resourcePath = $(base.resourcePath)
vivoactive6.sourcePath = $(base.sourcePath)
`;
}

const DATE_FIELDS     = new Set(['dateFullDate', 'dateMonthDay', 'dateDay', 'amPm']);
const ACTIVITY_FIELDS = new Set(['heartRate','heartRateZone']);
const MONITOR_FIELDS  = new Set(['steps','stepGoal','calories','activeCalories','intensityMins','floorsClimbed','distance']);
const SOLAR_FIELDS    = new Set(['sunrise','sunset','timeTillSunEvent']); // GPS-based only
// moonPhase uses only the current date — no GPS permission needed

function generateMonkeyC(elements) {
  const sorted = elements.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const fieldIds = new Set(elements.map(e => e.fieldId));

  const needsCalendar      = [...fieldIds].some(id => DATE_FIELDS.has(id));
  const needsActivity      = [...fieldIds].some(id => ACTIVITY_FIELDS.has(id));
  const needsMonitor       = [...fieldIds].some(id => MONITOR_FIELDS.has(id));
  const needsUserProfile   = [...fieldIds].some(id => ['restingHeartRate'].includes(id));
  const needsSolar         = [...fieldIds].some(id => SOLAR_FIELDS.has(id));
  const needsMoonPhase     = fieldIds.has('moonPhase'); // date only, no GPS
  const needsMath          = needsSolar || elements.some(e => e.shapeType && (e.shapeType.startsWith('tick') || e.shapeType.startsWith('analog')));
  const needsSensorHistory = [...fieldIds].some(id => ['hrGraph','bodyBattery','stressLevel','spo2','respirationRate','hrvStatus'].includes(id));

  // Deduplicate fetches — each fieldId only needs one var declaration
  const seenFields = new Set();
  let dataFetches = sorted
    .filter(el => { if (seenFields.has(el.fieldId)) return false; seenFields.add(el.fieldId); return true; })
    .map(generateDataFetch).filter(Boolean).join('\n        ');

  // If moonPhasePercent is used but moonPhase isn't, prepend moonPhase fetch (needed for _phs calculation)
  if (fieldIds.has('moonPhasePercent') && !fieldIds.has('moonPhase')) {
    dataFetches = generateDataFetch({fieldId: 'moonPhase'}) + '\n        ' + dataFetches;
  }

  const drawCalls = sorted.map(generateDrawCall).filter(Boolean).join('\n\n        ');

  const calendarVars = needsCalendar
    ? `var now = Time.now();\n        var info = Calendar.info(now, Time.FORMAT_MEDIUM);`
    : '';
  const activityVar = needsActivity ? `var _ai = Activity.getActivityInfo();` : '';
  const monitorVar  = needsMonitor  ? `var _ami = ActivityMonitor.getInfo();` : '';
  // Solar: get GPS fix, compute sunrise/sunset as minutes-from-midnight integers
  const solarVars = needsSolar ? `
        var _pos = Position.getInfo();
        var _lat = 0.0; var _lon = 0.0; var _hasPos = false;
        if (_pos != null && _pos.position != null) {
            var _coords = _pos.position.toDegrees();
            _lat = _coords[0].toFloat(); _lon = _coords[1].toFloat(); _hasPos = true;
        }
        var _srMin = _hasPos ? calcSunTimeMin(_lat, _lon, true)  : -1;
        ${fieldIds.has('sunset') || fieldIds.has('timeTillSunEvent') ? 'var _ssMin = _hasPos ? calcSunTimeMin(_lat, _lon, false) : -1;' : ''}` : '';

  // calcSunTimeMin — only generated when solar fields are present
  const sunMethodBody = needsSolar ? `
    // Returns local time (minutes past midnight) for sunrise or sunset using NOAA algorithm.
    // Returns -1 for polar day/night or when location unavailable.
    function calcSunTimeMin(latDeg, lonDeg, isSunrise) {
        // All arithmetic kept as Float to avoid Double/Float mixed-type errors
        var jd = 2440587.5 + Time.today().value().toFloat() / 86400.0;
        var D = jd - 2451545.0;
        // Monkey C % only works on integers — simulate float modulo with floor division
        var g = (357.529 + 0.98560028 * D).toFloat();
        g -= (g / 360.0).toNumber() * 360.0;
        if (g < 0.0) { g += 360.0; }
        var q = (280.459 + 0.98564736 * D).toFloat();
        q -= (q / 360.0).toNumber() * 360.0;
        if (q < 0.0) { q += 360.0; }
        var gRad = g * Math.PI / 180.0;
        var L = (q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2.0 * gRad)) * Math.PI / 180.0;
        var e = (23.439 - 0.00000036 * D) * Math.PI / 180.0;
        var sinDec = Math.sin(e) * Math.sin(L);
        var dec = Math.asin(sinDec);
        var latRad = latDeg * Math.PI / 180.0;
        var cosH = (Math.cos(90.833 * Math.PI / 180.0) - Math.sin(latRad) * sinDec)
                   / (Math.cos(latRad) * Math.cos(dec));
        if (cosH > 1.0 || cosH < -1.0) { return -1; }
        var H = Math.acos(cosH) * 180.0 / Math.PI;
        var RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * 12.0 / Math.PI;
        var eqTime = (q / 15.0 - RA) * 60.0;
        var solarNoon = 720.0 - lonDeg * 4.0 - eqTime;
        var sunUTC = solarNoon + (isSunrise ? -H : H) * 4.0;
        var tzSec = Sys.getClockTime().timeZoneOffset;
        var localMin = (sunUTC + tzSec.toFloat() / 60.0).toNumber();
        if (localMin < 0) { localMin += 1440; }
        if (localMin >= 1440) { localMin -= 1440; }
        return localMin;
    }` : '';

  return `using Toybox.Application as App;
using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;
${needsActivity               ? 'using Toybox.Activity as Activity;'               : ''}
${needsMonitor                ? 'using Toybox.ActivityMonitor as ActivityMonitor;' : ''}
${needsUserProfile            ? 'using Toybox.UserProfile as UserProfile;'         : ''}
${(needsCalendar||needsSolar||needsMoonPhase) ? 'using Toybox.Time as Time;'           : ''}
${needsCalendar               ? 'using Toybox.Time.Gregorian as Calendar;'         : ''}
${needsSolar                  ? 'using Toybox.Position as Position;'               : ''}
using Toybox.Lang as Lang;
${needsMath                   ? 'using Toybox.Math as Math;'                       : ''}
${needsSensorHistory          ? 'using Toybox.SensorHistory as SensorHistory;'     : ''}

// Entry point — manifest entry="WatchFaceApp"
class WatchFaceApp extends App.AppBase {
    function initialize() { AppBase.initialize(); }
    function getInitialView() {
        if (Ui has :WatchFaceDelegate) {
            var view = new WatchFaceView();
            return [view, new WatchFaceViewDelegate(view)];
        }
        return [new WatchFaceView()];
    }
}

// Required in CIQ 3+ to receive onPowerBudgetExceeded callbacks
class WatchFaceViewDelegate extends Ui.WatchFaceDelegate {
    function initialize(view as WatchFaceView) {
        WatchFaceDelegate.initialize();
    }
    function onPowerBudgetExceeded(powerInfo as Ui.WatchFacePowerInfo) as Void {
        Sys.println("Power budget exceeded: " + powerInfo.executionTimeAverage + "ms");
    }
}

class WatchFaceView extends Ui.WatchFace {

    function initialize() {
        WatchFace.initialize();
    }

    function onLayout(dc) {
        // All rendering done programmatically in onUpdate
    }
${sunMethodBody}
    // Force initial render when view becomes visible
    function onShow() {
        Ui.requestUpdate();
    }

    function onUpdate(dc) {
        Sys.println("WF onUpdate called");
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_BLACK);
        dc.clear();
        try {
            var clockTime = Sys.getClockTime();
            ${calendarVars}
            ${activityVar}
            ${monitorVar}
            ${solarVars}
            ${dataFetches}

            ${drawCalls}
        } catch (ex instanceof Lang.Exception) {
            // Render the exception message so we can see it in the simulator
            dc.setColor(Gfx.COLOR_RED, Gfx.COLOR_BLACK);
            dc.drawText(195, 195, Gfx.FONT_SMALL, ex.getErrorMessage(), Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
            Sys.println("WF onUpdate exception: " + ex.getErrorMessage());
        }
    }

    // In sleep/ambient mode the dc is a partial-update context — only redraw the clock digits
    // to avoid clearing/drawing outside the clip region.
    function onPartialUpdate(dc) {
        try {
            var clockTime = Sys.getClockTime();
            dc.setColor(Gfx.COLOR_WHITE, Gfx.COLOR_BLACK);
            dc.drawText(195, 195, Gfx.FONT_NUMBER_HOT,
                clockTime.hour.format("%02d") + ":" + clockTime.min.format("%02d"),
                Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
        } catch (ex instanceof Lang.Exception) {
            Sys.println("WF onPartialUpdate exception: " + ex.getErrorMessage());
        }
    }

    function onHide() {}
    function onExitSleep() { Ui.requestUpdate(); }
    function onEnterSleep() { Ui.requestUpdate(); }
}
`;
}

function generateDataFetch(el) {
  const map = {
    // Time (no fetch needed — clockTime and info already declared)
    altTimeZone:       `var altTimeZone = "--"; // TODO: store UTC offset in app settings`,
    alarm:             `var alarmTime = "--"; // TODO: Sys.getClockTime().alarmCount`,
    sunrise:          `var sunriseTime = _srMin >= 0 ? (_srMin / 60).format("%d") + ":" + (_srMin % 60).format("%02d") : "--:--";`,
    sunset:           `var sunsetTime  = _ssMin >= 0 ? (_ssMin / 60).format("%d") + ":" + (_ssMin % 60).format("%02d") : "--:--";`,
    timeTillSunEvent: `var _nowM = Sys.getClockTime().hour * 60 + Sys.getClockTime().min;
        var _next = -1;
        if (_srMin >= 0 && _srMin > _nowM) { _next = _srMin - _nowM; }
        else if (_ssMin >= 0 && _ssMin > _nowM) { _next = _ssMin - _nowM; }
        else if (_srMin >= 0) { _next = 1440 - _nowM + _srMin; }
        var timeTillSun = _next >= 0 ? (_next / 60).format("%d") + "h " + (_next % 60).format("%02d") + "m" : "--h --m";`,
    // Moon phase: synodic month from Jan 6, 2000 (JD 2451549.5).
    // Only generates phase calculation (_jdM, _phs) — text variables generated separately only if used.
    moonPhase: `var _jdM = 2440587.5 + Time.now().value().toFloat() / 86400.0;
        var _phs = (_jdM - 2451549.5) / 29.530589;
        _phs -= _phs.toNumber().toFloat();
        if (_phs < 0.0) { _phs += 1.0; }
        _phs = 1.0 - _phs;`,  // Invert phase (reference date fix)
    moonPhasePercent: `var moonPhasePercent = ((_phs < 0.5 ? _phs : 1.0 - _phs) * 200.0).toNumber().toString() + "%";`,
    calendarEvent:     `var calendarEvent = "--"; // TODO: Toybox.Calendar not public on vivoactive6`,
    // Heart & Cardiovascular
    heartRate:         `var heartRate = (_ai != null && _ai.currentHeartRate != null) ? _ai.currentHeartRate.toString() : "--";`,
    restingHeartRate:  `var restingHR = "--"; // TODO: UserProfile.getProfile().restingHeartRate (SDK 3.2+)`,
    heartRateZone:     `var hrZone = "--"; // TODO: derive zone from HR ranges in UserProfile`,
    spo2:              `var _o2h = SensorHistory.getOxygenSaturationHistory(null);
        var _o2s = _o2h != null ? _o2h.next() : null;
        var spo2 = (_o2s != null && _o2s.data != null) ? (_o2s.data.toNumber()).format("%d") + "%" : "--";`,
    respirationRate:   `var _rrh = SensorHistory.getRespirationRateHistory(null);
        var _rrs = _rrh != null ? _rrh.next() : null;
        var respirationRate = (_rrs != null && _rrs.data != null) ? (_rrs.data.toNumber()).format("%d") : "--";`,
    hrvStatus:         `var _hrvh = SensorHistory.getHeartRateVariabilityHistory(null);
        var _hrvs = _hrvh != null ? _hrvh.next() : null;
        var hrvStatus = (_hrvs != null && _hrvs.data != null) ? (_hrvs.data.toNumber()).format("%d") : "--";`,
    // Energy & Recovery (SensorHistory)
    bodyBattery:       `var _bbh = SensorHistory.getBodyBatteryHistory(null);
        var _bbs = _bbh != null ? _bbh.next() : null;
        var bodyBattery = (_bbs != null && _bbs.data != null) ? (_bbs.data.toNumber()).format("%d") : "--";`,
    stressLevel:       `var _ssh = SensorHistory.getStressHistory(null);
        var _sss = _ssh != null ? _ssh.next() : null;
        var stressLevel = (_sss != null && _sss.data != null) ? (_sss.data.toNumber()).format("%d") : "--";`,
    recoveryTime:      `var recoveryTime = "--"; // TODO: not in public API`,
    sleepScore:        `var sleepScore = "--"; // TODO: Toybox.SensorHistory`,
    sleepCoach:        `var sleepCoach = "--"; // TODO: not in public API`,
    trainingReadiness: `var trainReadiness = "--"; // TODO: not in public API`,
    // Daily totals — from ActivityMonitor.getInfo() (cached as _ami)
    steps:             `var steps    = (_ami != null && _ami.steps    != null) ? _ami.steps.toString()    : "--";`,
    stepGoal:          `var stepGoal = (_ami != null && _ami.stepGoal != null) ? _ami.stepGoal.toString() : "--";`,
    calories:          `var calories = (_ami != null && _ami.calories != null) ? _ami.calories.toString() : "--";`,
    activeCalories:    `var activeCalories = "--"; // TODO: ActivityMonitor does not separate active vs. resting`,
    intensityMins:     `var intensityMins = (_ami != null && _ami.activeMinutesWeek != null) ? _ami.activeMinutesWeek.total.toString() : "--";`,
    floorsClimbed:     `var floors        = (_ami != null && _ami.floorsClimbed != null)    ? _ami.floorsClimbed.toString()             : "--";`,
    distance:          `var distance      = (_ami != null && _ami.distance != null)          ? (_ami.distance / 100000.0).format("%.2f") + "km" : "--km";`,
    // Fitness
    vo2Max:            `var vo2Max = "--"; // TODO: UserProfile.getProfile().vo2MaxRunning`,
    fitnessAge:        `var fitnessAge = "--"; // TODO: not directly available`,
    acuteLoad:         `var acuteLoad = "--"; // TODO: not in public API`,
    lastActivity:      `var lastActivity = "--"; // TODO: not in public API`,
    weeklyRunning:     `var weeklyRunning = "--"; // TODO: ActivityMonitor weekly summary`,
    weeklyCycling:     `var weeklyCycling = "--"; // TODO: not in public API`,
    // Environment
    weather:           `var weather = "--°"; // TODO: Toybox.Weather.getCurrentConditions()`,
    weatherHiLo:       `var weatherHiLo = "--/--°"; // TODO: Toybox.Weather.getDailyForecast()`,
    // Device
    battery:           `var battery = (Sys.getSystemStats().battery + 0.5).toNumber().toString() + "%";`,
    notifications:     `var notifications = Sys.getDeviceSettings().notificationCount.toString();`,
    eventCountdown:    `var eventCountdown = "--"; // TODO: not in public API`,
    timer:             `var timerVal = "00:00"; // TODO: requires a dedicated timer implementation`,
    utcTime:           `var utcTime = clockTime.hour.format("%02d") + ":" + clockTime.min.format("%02d"); // Note: displays local time; UTC offset via clockTime.timeZoneOffset`,
  };
  return map[el.fieldId] || null;
}

function colorLiteral(hexColor) {
  const n = parseInt((hexColor || '#ffffff').replace('#', ''), 16);
  return `0x${n.toString(16).padStart(6, '0').toUpperCase()}`;
}

function generateDrawCall(el) {
  const color  = colorLiteral(el.color);
  const font   = `Gfx.${el.font || 'FONT_MEDIUM'}`;
  // Always use VCENTER so the element's (x,y) is the visual center on device,
  // matching the canvas where textBaseline='middle' for all alignments.
  const align  = el.align === 'center' ? 'Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER'
               : el.align === 'right'  ? 'Gfx.TEXT_JUSTIFY_RIGHT  | Gfx.TEXT_JUSTIFY_VCENTER'
               : 'Gfx.TEXT_JUSTIFY_LEFT | Gfx.TEXT_JUSTIFY_VCENTER';

  const textMap = {
    // Time & Calendar
    hours:             `clockTime.hour.format("%02d")`,
    minutes:           `clockTime.min.format("%02d")`,
    seconds:           `clockTime.sec.format("%02d")`,
    amPm:              `(clockTime.hour < 12) ? "AM" : "PM"`,
    dateFullDate:      `info.day_of_week + ", " + info.month.toString() + "/" + info.day.toString()`,
    dateMonthDay:      `info.month.toString() + "/" + info.day.toString()`,
    dateDay:           `info.day_of_week`,
    altTimeZone:       `altTimeZone`,
    alarm:             `alarmTime`,
    sunrise:           `sunriseTime`,
    sunset:            `sunsetTime`,
    timeTillSunEvent:  `timeTillSun`,
    moonPhase:         `moonPhase`,
    moonPhasePercent:  `moonPhasePercent`,
    calendarEvent:     `calendarEvent`,
    // Heart & Cardiovascular
    heartRate:         `heartRate`,
    restingHeartRate:  `restingHR`,
    heartRateZone:     `hrZone`,
    spo2:              `spo2`,
    respirationRate:   `respirationRate`,
    hrvStatus:         `hrvStatus`,
    // Energy & Recovery
    bodyBattery:       `bodyBattery`,
    stressLevel:       `stressLevel`,
    recoveryTime:      `recoveryTime`,
    sleepScore:        `sleepScore`,
    sleepCoach:        `sleepCoach`,
    trainingReadiness: `trainReadiness`,
    // Activity
    steps:             `steps`,
    stepGoal:          `stepGoal`,
    calories:          `calories`,
    activeCalories:    `activeCalories`,
    intensityMins:     `intensityMins`,
    floorsClimbed:     `floors`,
    distance:          `distance`,
    // Fitness
    vo2Max:            `vo2Max`,
    fitnessAge:        `fitnessAge`,
    acuteLoad:         `acuteLoad`,
    lastActivity:      `lastActivity`,
    weeklyRunning:     `weeklyRunning`,
    weeklyCycling:     `weeklyCycling`,
    // Environment
    weather:           `weather`,
    weatherHiLo:       `weatherHiLo`,
    // Device
    battery:           `battery`,
    notifications:     `notifications`,
    eventCountdown:    `eventCountdown`,
    timer:             `timerVal`,
    utcTime:           `utcTime`,
    // Custom
    customLabel:       `"${(el.format || el.label || 'Label').replace(/"/g, '\\"')}"`,
  };

  if (el.shapeType === 'btIcon') {
    const r = Math.round(Math.min(el.width, el.height) / 2);
    return `// Bluetooth indicator — only visible when phone is connected
        if (Sys.getDeviceSettings().phoneConnected) {
            dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
            dc.fillCircle(${Math.round(el.x)}, ${Math.round(el.y)}, ${r});
        }`;
  }
  if (el.shapeType === 'moonPhase') {
    const r = Math.round(Math.min(el.width, el.height) / 2);
    const cx = Math.round(el.x);
    const cy = Math.round(el.y);
    return `// Moon phase graphic — lit circle + shadow showing illumination
        // Uses _phs calculated in variable section above
        dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        dc.fillCircle(${cx}, ${cy}, ${r});
        // Draw shadow (dark part) based on phase
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_TRANSPARENT);
        if (_phs < 0.5) {
            // Waning: shadow on right
            var _sxWan = ${cx} + (${r} - ${r} * 2.0 * _phs).toNumber();
            dc.fillCircle(_sxWan, ${cy}, ${r});
        } else {
            // Waxing: shadow on left
            var _sxWax = ${cx} - (${r} - ${r} * 2.0 * (_phs - 0.5)).toNumber();
            dc.fillCircle(_sxWax, ${cy}, ${r});
        }`;
  }
  if (el.shapeType === 'circle') {
    const r = Math.round(Math.min(el.width, el.height) / 2);
    return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);\n        dc.drawCircle(${Math.round(el.x)}, ${Math.round(el.y)}, ${r});`;
  }
  if (el.shapeType === 'line') {
    const lx1 = Math.round(el.x - el.width / 2), lx2 = Math.round(el.x + el.width / 2);
    return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);\n        dc.drawLine(${lx1}, ${Math.round(el.y)}, ${lx2}, ${Math.round(el.y)});`;
  }
  if (el.shapeType === 'arc') {
    const r = Math.round(Math.min(el.width, el.height) / 2);
    return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);\n        dc.drawArc(${Math.round(el.x)}, ${Math.round(el.y)}, ${r}, Gfx.ARC_CLOCKWISE, 0, 180);`;
  }
  if (el.shapeType === 'tickHour')    return generateTickCode(el, 12, false, el.height, el.height, 2);
  if (el.shapeType === 'tickMinute')  return generateTickCode(el, 60, false, el.height, el.height, 1);
  if (el.shapeType === 'tickMixed')   return generateTickCode(el, 60, true,  el.height, Math.max(2, Math.round(el.height * 0.45)), 3);
  if (el.shapeType === 'tickDots')    return generateTickDotsCode(el, 12, el.height);
  if (el.shapeType === 'analogHour')   return generateAnalogHandCode(el, 'hour');
  if (el.shapeType === 'analogMinute') return generateAnalogHandCode(el, 'minute');
  if (el.shapeType === 'analogSecond') return generateAnalogHandCode(el, 'second');
  if (el.shapeType === 'analogCenter') return generateAnalogCenterCode(el);
  if (el.shapeType === 'hrGraph')      return generateHRGraphCode(el);

  const textExpr = textMap[el.fieldId] || `"${el.label}"`;
  return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);\n        dc.drawText(${Math.round(el.x)}, ${Math.round(el.y)}, ${font}, ${textExpr}, ${align});`;
}

function generateTickCode(el, count, hasMajorMinor, majorLen, minorLen, majorPen) {
  const color = colorLiteral(el.color);
  const cx = Math.round(el.x), cy = Math.round(el.y);
  const outerR = Math.round(el.width);
  const minorInnerR = outerR - minorLen;
  const majorInnerR = outerR - majorLen;

  if (!hasMajorMinor) {
    return `// ${el.label} (${count} ticks, outer r=${outerR}, len=${majorLen})
        dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        dc.setPenWidth(${majorPen});
        for (var _i = 0; _i < ${count}; _i++) {
            var _a = (_i.toDouble() / ${count}.0) * 2.0 * Math.PI - Math.PI / 2.0;
            var _ox = ${cx} + (${outerR}.0 * Math.cos(_a)).toNumber();
            var _oy = ${cy} + (${outerR}.0 * Math.sin(_a)).toNumber();
            var _ix = ${cx} + (${minorInnerR}.0 * Math.cos(_a)).toNumber();
            var _iy = ${cy} + (${minorInnerR}.0 * Math.sin(_a)).toNumber();
            dc.drawLine(_ox, _oy, _ix, _iy);
        }`;
  }

  // Major + minor
  return `// ${el.label} (${count} ticks, major every 5, outer r=${outerR})
        dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        for (var _i = 0; _i < ${count}; _i++) {
            var _a = (_i.toDouble() / ${count}.0) * 2.0 * Math.PI - Math.PI / 2.0;
            var _isMaj = (_i % 5) == 0;
            var _innerR = _isMaj ? ${majorInnerR}.0 : ${minorInnerR}.0;
            dc.setPenWidth(_isMaj ? ${majorPen} : 1);
            var _ox = ${cx} + (${outerR}.0 * Math.cos(_a)).toNumber();
            var _oy = ${cy} + (${outerR}.0 * Math.sin(_a)).toNumber();
            var _ix = ${cx} + (_innerR * Math.cos(_a)).toNumber();
            var _iy = ${cy} + (_innerR * Math.sin(_a)).toNumber();
            dc.drawLine(_ox, _oy, _ix, _iy);
        }`;
}

function generateTickDotsCode(el, count, dotR) {
  const color = colorLiteral(el.color);
  const cx = Math.round(el.x), cy = Math.round(el.y);
  const outerR = Math.round(el.width);
  const r = Math.max(1, Math.round(dotR));
  return `// ${el.label} (${count} dots, outer r=${outerR}, dot r=${r})
        dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        for (var _i = 0; _i < ${count}; _i++) {
            var _a = (_i.toDouble() / ${count}.0) * 2.0 * Math.PI - Math.PI / 2.0;
            var _px = ${cx} + (${outerR}.0 * Math.cos(_a)).toNumber();
            var _py = ${cy} + (${outerR}.0 * Math.sin(_a)).toNumber();
            dc.fillCircle(_px, _py, ${r});
        }`;
}

function generateAnalogHandCode(el, type) {
  const color  = colorLiteral(el.color);
  const cx     = Math.round(el.x), cy = Math.round(el.y);
  const len    = el.width,  tail = el.height;
  const penW   = type === 'hour' ? 5 : type === 'minute' ? 4 : 2;
  // Use integer arithmetic first to avoid Double % Float type error in Monkey C
  const angleExpr =
    type === 'hour'   ? `((clockTime.hour % 12) * 30 + clockTime.min * 0.5) * Math.PI / 180.0 - Math.PI / 2.0`
  : type === 'minute' ? `(clockTime.min * 6 + clockTime.sec * 0.1) * Math.PI / 180.0 - Math.PI / 2.0`
  :                     `clockTime.sec * Math.PI / 30.0 - Math.PI / 2.0`;

  return `// ${el.label} (len=${len}, tail=${tail})
        { var _a = ${angleExpr};
          var _cos = Math.cos(_a); var _sin = Math.sin(_a);
          dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
          dc.setPenWidth(${penW});
          dc.drawLine(
              (${cx}.0 - ${tail}.0 * _cos).toNumber(), (${cy}.0 - ${tail}.0 * _sin).toNumber(),
              (${cx}.0 + ${len}.0  * _cos).toNumber(), (${cy}.0 + ${len}.0  * _sin).toNumber()
          ); }`;
}

function generateAnalogCenterCode(el) {
  const color = colorLiteral(el.color);
  const r = Math.max(2, Math.round(el.width));
  return `// Center cap
        dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        dc.fillCircle(${Math.round(el.x)}, ${Math.round(el.y)}, ${r});`;
}

function generateHRGraphCode(el) {
  const color = colorLiteral(el.color);
  const gx = Math.round(el.x - el.width / 2),  gy = Math.round(el.y - el.height / 2);
  const gw = Math.round(el.width),              gh = Math.round(el.height);
  // SensorHistoryIterator has no .size() — use a fixed max and integer math to avoid type errors
  return `// Heart Rate Graph (SensorHistory, last 3 h)
        { var _hrIt = SensorHistory.getHeartRateHistory({:period => 180, :order => SensorHistory.ORDER_OLDEST_FIRST});
          if (_hrIt != null) {
              var _MAX = 60; var _idx = 0;
              var _px = -1; var _py = -1;
              dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
              dc.setPenWidth(2);
              var _s = _hrIt.next();
              while (_s != null && _idx < _MAX) {
                  var _hr = _s.data;
                  if (_hr instanceof Number) {
                      var _nx = ${gx} + _idx * ${gw} / _MAX;
                      var _ny = ${gy + gh} - (_hr - 50) * ${gh} / 80;
                      if (_px >= 0) { dc.drawLine(_px, _py, _nx, _ny); }
                      _px = _nx; _py = _ny;
                  }
                  _idx++; _s = _hrIt.next();
              }
          } }`;
}

function generateLayout() {
  return `<layouts xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://developer.garmin.com/downloads/connect-iq/resources.xsd">
    <layout id="WatchFace">
    </layout>
</layouts>
`;
}

function generateStrings(projectName) {
  return `<strings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://developer.garmin.com/downloads/connect-iq/resources.xsd">
    <string id="AppName">${projectName}</string>
</strings>
`;
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Watch Face Builder  →  http://localhost:${PORT}`);
  console.log(`SDK bin:            ${SDK_BIN}`);
  console.log(`Developer key:      ${DEV_KEY}`);
  console.log(`Export dir:         ${EXPORT_DIR}`);
});
