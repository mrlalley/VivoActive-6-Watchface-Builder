// Monkey C source file generation for watch face rendering.

const DATE_FIELDS = new Set(['dateFullDate', 'dateMonthDay', 'dateDay', 'amPm']);
const ACTIVITY_FIELDS = new Set(['heartRate', 'heartRateZone']);
const MONITOR_FIELDS = new Set(['steps', 'stepGoal', 'calories', 'activeCalories', 'intensityMins', 'floorsClimbed', 'distance']);
const SOLAR_FIELDS = new Set(['sunrise', 'sunset', 'timeTillSunEvent']);

function colorLiteral(hexColor) {
  const n = parseInt((hexColor || '#ffffff').replace('#', ''), 16);
  return `0x${n.toString(16).padStart(6, '0').toUpperCase()}`;
}

function generateDataFetch(el) {
  const map = {
    altTimeZone: `var altTimeZone = "--";`,
    alarm: `var alarmTime = "--";`,
    sunrise: `var sunriseTime = _srMin >= 0 ? (_srMin / 60).format("%d") + ":" + (_srMin % 60).format("%02d") : "--:--";`,
    sunset: `var sunsetTime  = _ssMin >= 0 ? (_ssMin / 60).format("%d") + ":" + (_ssMin % 60).format("%02d") : "--:--";`,
    timeTillSunEvent: `var _nowM = Sys.getClockTime().hour * 60 + Sys.getClockTime().min;
        var _next = -1;
        if (_srMin >= 0 && _srMin > _nowM) { _next = _srMin - _nowM; }
        else if (_ssMin >= 0 && _ssMin > _nowM) { _next = _ssMin - _nowM; }
        else if (_srMin >= 0) { _next = 1440 - _nowM + _srMin; }
        var timeTillSun = _next >= 0 ? (_next / 60).format("%d") + "h " + (_next % 60).format("%02d") + "m" : "--h --m";`,
    moonPhase: `var _jdM = 2440587.5 + Time.now().value().toFloat() / 86400.0;
        var _phs = (_jdM - 2451549.5) / 29.530589;
        _phs -= _phs.toNumber().toFloat();
        if (_phs < 0.0) { _phs += 1.0; }
        _phs = 1.0 - _phs;`,
    moonPhasePercent: `var moonPhasePercent = ((_phs < 0.5 ? _phs : 1.0 - _phs) * 200.0).toNumber().toString() + "%";`,
    calendarEvent: `var calendarEvent = "--";`,
    heartRate: `var heartRate = (_ai != null && _ai.currentHeartRate != null) ? _ai.currentHeartRate.toString() : "--";`,
    restingHeartRate: `var restingHR = (_up != null && _up.restingHeartRate != null) ? _up.restingHeartRate.toString() : "--";`,
    heartRateZone: `var hrZone = "--";`,
    spo2: `var _o2h = SensorHistory.getOxygenSaturationHistory(null);
        var _o2s = _o2h != null ? _o2h.next() : null;
        var spo2 = (_o2s != null && _o2s.data != null) ? (_o2s.data.toNumber()).format("%d") + "%" : "--";`,
    respirationRate: `var _rrh = SensorHistory.getRespirationRateHistory(null);
        var _rrs = _rrh != null ? _rrh.next() : null;
        var respirationRate = (_rrs != null && _rrs.data != null) ? (_rrs.data.toNumber()).format("%d") : "--";`,
    hrvStatus: `var _hrvh = SensorHistory.getHeartRateVariabilityHistory(null);
        var _hrvs = _hrvh != null ? _hrvh.next() : null;
        var hrvStatus = (_hrvs != null && _hrvs.data != null) ? (_hrvs.data.toNumber()).format("%d") : "--";`,
    bodyBattery: `var _bbh = SensorHistory.getBodyBatteryHistory(null);
        var _bbs = _bbh != null ? _bbh.next() : null;
        var bodyBattery = (_bbs != null && _bbs.data != null) ? (_bbs.data.toNumber()).format("%d") : "--";`,
    stressLevel: `var _ssh = SensorHistory.getStressHistory(null);
        var _sss = _ssh != null ? _ssh.next() : null;
        var stressLevel = (_sss != null && _sss.data != null) ? (_sss.data.toNumber()).format("%d") : "--";`,
    recoveryTime: `var recoveryTime = "--";`,
    sleepScore: `var sleepScore = "--";`,
    sleepCoach: `var sleepCoach = "--";`,
    trainingReadiness: `var trainReadiness = (_up != null && _up.trainingReadiness != null) ? _up.trainingReadiness.toString() : "--";`,
    steps: `var steps    = (_ami != null && _ami.steps    != null) ? _ami.steps.toString()    : "--";`,
    stepGoal: `var stepGoal = (_ami != null && _ami.stepGoal != null) ? _ami.stepGoal.toString() : "--";`,
    calories: `var calories = (_ami != null && _ami.calories != null) ? _ami.calories.toString() : "--";`,
    activeCalories: `var activeCalories = "--";`,
    intensityMins: `var intensityMins = (_ami != null && _ami.activeMinutesWeek != null) ? _ami.activeMinutesWeek.total.toString() : "--";`,
    floorsClimbed: `var floors        = (_ami != null && _ami.floorsClimbed != null)    ? _ami.floorsClimbed.toString()             : "--";`,
    distance: `var distance      = (_ami != null && _ami.distance != null)          ? (_ami.distance / 100000.0).format("%.2f") + "km" : "--km";`,
    vo2Max: `var vo2Max = "--";`,
    fitnessAge: `var fitnessAge = "--";`,
    acuteLoad: `var acuteLoad = "--";`,
    lastActivity: `var lastActivity = "--";`,
    weeklyRunning: `var weeklyRunning = "--";`,
    weeklyCycling: `var weeklyCycling = "--";`,
    weather: `var weather = "--°";`,
    weatherHiLo: `var weatherHiLo = "--/--°";`,
    battery: `var battery = (Sys.getSystemStats().battery + 0.5).toNumber().toString() + "%";`,
    notifications: `var notifications = Sys.getDeviceSettings().notificationCount.toString();`,
    eventCountdown: `var eventCountdown = "--";`,
    timer: `var timerVal = "00:00";`,
    utcTime: `var utcTime = clockTime.hour.format("%02d") + ":" + clockTime.min.format("%02d");`,
  };
  return map[el.fieldId] || null;
}

function generateTickCode(el, count, hasMajorMinor, majorLen, minorLen, majorPen) {
  const color = colorLiteral(el.color);
  const cx = Math.round(el.x), cy = Math.round(el.y);
  const outerR = Math.round(el.width);
  const minorInnerR = outerR - minorLen;
  const majorInnerR = outerR - majorLen;

  if (!hasMajorMinor) {
    return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
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

  return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
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
  return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        for (var _i = 0; _i < ${count}; _i++) {
            var _a = (_i.toDouble() / ${count}.0) * 2.0 * Math.PI - Math.PI / 2.0;
            var _px = ${cx} + (${outerR}.0 * Math.cos(_a)).toNumber();
            var _py = ${cy} + (${outerR}.0 * Math.sin(_a)).toNumber();
            dc.fillCircle(_px, _py, ${r});
        }`;
}

function generateAnalogHandCode(el, type) {
  const color = colorLiteral(el.color);
  const cx = Math.round(el.x), cy = Math.round(el.y);
  const len = el.width, tail = el.height;
  const penW = type === 'hour' ? 5 : type === 'minute' ? 4 : 2;
  const angleExpr = type === 'hour' ? `((clockTime.hour % 12) * 30 + clockTime.min * 0.5) * Math.PI / 180.0 - Math.PI / 2.0`
    : type === 'minute' ? `(clockTime.min * 6 + clockTime.sec * 0.1) * Math.PI / 180.0 - Math.PI / 2.0`
      : `clockTime.sec * Math.PI / 30.0 - Math.PI / 2.0`;

  return `{ var _a = ${angleExpr};
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
  return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        dc.fillCircle(${Math.round(el.x)}, ${Math.round(el.y)}, ${r});`;
}

function generateHRGraphCode(el) {
  const color = colorLiteral(el.color);
  const gx = Math.round(el.x - el.width / 2), gy = Math.round(el.y - el.height / 2);
  const gw = Math.round(el.width), gh = Math.round(el.height);
  return `{ var _hrIt = SensorHistory.getHeartRateHistory({:period => 180, :order => SensorHistory.ORDER_OLDEST_FIRST});
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

function generateDrawCall(el) {
  const color = colorLiteral(el.color);
  const font = `Gfx.${el.font || 'FONT_MEDIUM'}`;
  const align = el.align === 'center' ? 'Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER'
    : el.align === 'right' ? 'Gfx.TEXT_JUSTIFY_RIGHT  | Gfx.TEXT_JUSTIFY_VCENTER'
      : 'Gfx.TEXT_JUSTIFY_LEFT | Gfx.TEXT_JUSTIFY_VCENTER';

  const textMap = {
    hours: `clockTime.hour.format("%02d")`,
    minutes: `clockTime.min.format("%02d")`,
    seconds: `clockTime.sec.format("%02d")`,
    amPm: `(clockTime.hour < 12) ? "AM" : "PM"`,
    dateFullDate: `info.day_of_week + ", " + info.month.toString() + "/" + info.day.toString()`,
    dateMonthDay: `info.month.toString() + "/" + info.day.toString()`,
    dateDay: `info.day_of_week`,
    altTimeZone: `altTimeZone`,
    alarm: `alarmTime`,
    sunrise: `sunriseTime`,
    sunset: `sunsetTime`,
    timeTillSunEvent: `timeTillSun`,
    moonPhase: `moonPhase`,
    moonPhasePercent: `moonPhasePercent`,
    calendarEvent: `calendarEvent`,
    heartRate: `heartRate`,
    restingHeartRate: `restingHR`,
    heartRateZone: `hrZone`,
    spo2: `spo2`,
    respirationRate: `respirationRate`,
    hrvStatus: `hrvStatus`,
    bodyBattery: `bodyBattery`,
    stressLevel: `stressLevel`,
    recoveryTime: `recoveryTime`,
    sleepScore: `sleepScore`,
    sleepCoach: `sleepCoach`,
    trainingReadiness: `trainReadiness`,
    steps: `steps`,
    stepGoal: `stepGoal`,
    calories: `calories`,
    activeCalories: `activeCalories`,
    intensityMins: `intensityMins`,
    floorsClimbed: `floors`,
    distance: `distance`,
    vo2Max: `vo2Max`,
    fitnessAge: `fitnessAge`,
    acuteLoad: `acuteLoad`,
    lastActivity: `lastActivity`,
    weeklyRunning: `weeklyRunning`,
    weeklyCycling: `weeklyCycling`,
    weather: `weather`,
    weatherHiLo: `weatherHiLo`,
    battery: `battery`,
    notifications: `notifications`,
    eventCountdown: `eventCountdown`,
    timer: `timerVal`,
    utcTime: `utcTime`,
    customLabel: `"${(el.format || el.label || 'Label').replace(/"/g, '\\"')}"`,
  };

  if (el.shapeType === 'btIcon') {
    const r = Math.round(Math.min(el.width, el.height) / 2);
    return `if (Sys.getDeviceSettings().phoneConnected) {
            dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
            dc.fillCircle(${Math.round(el.x)}, ${Math.round(el.y)}, ${r});
        }`;
  }
  if (el.shapeType === 'moonPhase') {
    const r = Math.round(Math.min(el.width, el.height) / 2);
    const cx = Math.round(el.x);
    const cy = Math.round(el.y);
    return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);
        dc.fillCircle(${cx}, ${cy}, ${r});
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_TRANSPARENT);
        if (_phs < 0.5) {
            var _sxWan = ${cx} + (${r} - ${r} * 2.0 * _phs).toNumber();
            dc.fillCircle(_sxWan, ${cy}, ${r});
        } else {
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
  if (el.shapeType === 'tickHour') return generateTickCode(el, 12, false, el.height, el.height, 2);
  if (el.shapeType === 'tickMinute') return generateTickCode(el, 60, false, el.height, el.height, 1);
  if (el.shapeType === 'tickMixed') return generateTickCode(el, 60, true, el.height, Math.max(2, Math.round(el.height * 0.45)), 3);
  if (el.shapeType === 'tickDots') return generateTickDotsCode(el, 12, el.height);
  if (el.shapeType === 'analogHour') return generateAnalogHandCode(el, 'hour');
  if (el.shapeType === 'analogMinute') return generateAnalogHandCode(el, 'minute');
  if (el.shapeType === 'analogSecond') return generateAnalogHandCode(el, 'second');
  if (el.shapeType === 'analogCenter') return generateAnalogCenterCode(el);
  if (el.shapeType === 'hrGraph') return generateHRGraphCode(el);

  const textExpr = textMap[el.fieldId] || `"${el.label}"`;
  return `dc.setColor(${color}, Gfx.COLOR_TRANSPARENT);\n        dc.drawText(${Math.round(el.x)}, ${Math.round(el.y)}, ${font}, ${textExpr}, ${align});`;
}

function generateMonkeyC(elements) {
  const sorted = elements.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const fieldIds = new Set(elements.map(e => e.fieldId));

  const needsCalendar = [...fieldIds].some(id => DATE_FIELDS.has(id));
  const needsActivity = [...fieldIds].some(id => ACTIVITY_FIELDS.has(id));
  const needsMonitor = [...fieldIds].some(id => MONITOR_FIELDS.has(id));
  const needsUserProfile = [...fieldIds].some(id => ['restingHeartRate', 'trainingReadiness'].includes(id));
  const needsSolar = [...fieldIds].some(id => SOLAR_FIELDS.has(id));
  const needsMoonPhase = fieldIds.has('moonPhase');
  const needsMath = needsSolar || elements.some(e => e.shapeType && (e.shapeType.startsWith('tick') || e.shapeType.startsWith('analog')));
  const needsSensorHistory = [...fieldIds].some(id => ['hrGraph', 'bodyBattery', 'stressLevel', 'spo2', 'respirationRate', 'hrvStatus'].includes(id));

  const seenFields = new Set();
  let dataFetches = sorted
    .filter(el => { if (seenFields.has(el.fieldId)) return false; seenFields.add(el.fieldId); return true; })
    .map(generateDataFetch).filter(Boolean).join('\n        ');

  if (fieldIds.has('moonPhasePercent') && !fieldIds.has('moonPhase')) {
    dataFetches = generateDataFetch({ fieldId: 'moonPhase' }) + '\n        ' + dataFetches;
  }

  const drawCalls = sorted.map(generateDrawCall).filter(Boolean).join('\n\n        ');

  const calendarVars = needsCalendar
    ? `var now = Time.now();\n        var info = Calendar.info(now, Time.FORMAT_MEDIUM);`
    : '';
  const activityVar = needsActivity ? `var _ai = Activity.getActivityInfo();` : '';
  const monitorVar = needsMonitor ? `var _ami = ActivityMonitor.getInfo();` : '';
  const userProfileVar = needsUserProfile ? `var _up = UserProfile.getProfile();` : '';
  const solarVars = needsSolar ? `
        var _pos = Position.getInfo();
        var _lat = 0.0; var _lon = 0.0; var _hasPos = false;
        if (_pos != null && _pos.position != null) {
            var _coords = _pos.position.toDegrees();
            _lat = _coords[0].toFloat(); _lon = _coords[1].toFloat(); _hasPos = true;
        }
        var _srMin = _hasPos ? calcSunTimeMin(_lat, _lon, true)  : -1;
        ${fieldIds.has('sunset') || fieldIds.has('timeTillSunEvent') ? 'var _ssMin = _hasPos ? calcSunTimeMin(_lat, _lon, false) : -1;' : ''}` : '';

  const sunMethodBody = needsSolar ? `
    function calcSunTimeMin(latDeg, lonDeg, isSunrise) {
        var jd = 2440587.5 + Time.today().value().toFloat() / 86400.0;
        var D = jd - 2451545.0;
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
${needsActivity ? 'using Toybox.Activity as Activity;' : ''}
${needsMonitor ? 'using Toybox.ActivityMonitor as ActivityMonitor;' : ''}
${needsUserProfile ? 'using Toybox.UserProfile as UserProfile;' : ''}
${(needsCalendar || needsSolar || needsMoonPhase) ? 'using Toybox.Time as Time;' : ''}
${needsCalendar ? 'using Toybox.Time.Gregorian as Calendar;' : ''}
${needsSolar ? 'using Toybox.Position as Position;' : ''}
using Toybox.Lang as Lang;
${needsMath ? 'using Toybox.Math as Math;' : ''}
${needsSensorHistory ? 'using Toybox.SensorHistory as SensorHistory;' : ''}

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
    }
${sunMethodBody}
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
            ${userProfileVar}
            ${solarVars}
            ${dataFetches}

            ${drawCalls}
        } catch (ex instanceof Lang.Exception) {
            dc.setColor(Gfx.COLOR_RED, Gfx.COLOR_BLACK);
            dc.drawText(195, 195, Gfx.FONT_SMALL, ex.getErrorMessage(), Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
            Sys.println("WF onUpdate exception: " + ex.getErrorMessage());
        }
    }

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

module.exports = {
  generateMonkeyC,
  generateDrawCall,
  generateDataFetch,
  colorLiteral,
};
