using Toybox.Application as App;
using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;
using Toybox.Activity as Activity;
using Toybox.ActivityMonitor as ActivityMonitor;
using Toybox.UserProfile as UserProfile;
using Toybox.Time as Time;
using Toybox.Time.Gregorian as Calendar;
using Toybox.Position as Position;
using Toybox.Lang as Lang;
using Toybox.Math as Math;
using Toybox.SensorHistory as SensorHistory;

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
    }
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
            var now = Time.now();
        var info = Calendar.info(now, Time.FORMAT_MEDIUM);
            var _ai = Activity.getActivityInfo();
            var _ami = ActivityMonitor.getInfo();
            
        var _pos = Position.getInfo();
        var _lat = 0.0; var _lon = 0.0; var _hasPos = false;
        if (_pos != null && _pos.position != null) {
            var _coords = _pos.position.toDegrees();
            _lat = _coords[0].toFloat(); _lon = _coords[1].toFloat(); _hasPos = true;
        }
        var _srMin = _hasPos ? calcSunTimeMin(_lat, _lon, true)  : -1;
        var _ssMin = _hasPos ? calcSunTimeMin(_lat, _lon, false) : -1;
            var heartRate = (_ai != null && _ai.currentHeartRate != null) ? _ai.currentHeartRate.toString() : "--";
        var battery = (Sys.getSystemStats().battery + 0.5).toNumber().toString() + "%";
        var sunriseTime = _srMin >= 0 ? (_srMin / 60).format("%d") + ":" + (_srMin % 60).format("%02d") : "--:--";
        var sunsetTime  = _ssMin >= 0 ? (_ssMin / 60).format("%d") + ":" + (_ssMin % 60).format("%02d") : "--:--";
        var _nowM = Sys.getClockTime().hour * 60 + Sys.getClockTime().min;
        var _next = -1;
        if (_srMin >= 0 && _srMin > _nowM) { _next = _srMin - _nowM; }
        else if (_ssMin >= 0 && _ssMin > _nowM) { _next = _ssMin - _nowM; }
        else if (_srMin >= 0) { _next = 1440 - _nowM + _srMin; }
        var timeTillSun = _next >= 0 ? (_next / 60).format("%d") + "h " + (_next % 60).format("%02d") + "m" : "--h --m";
        var restingHR = "--"; // TODO: UserProfile.getProfile().restingHeartRate (SDK 3.2+)
        var notifications = Sys.getDeviceSettings().notificationCount.toString();
        var _jdM = 2440587.5 + Time.now().value().toFloat() / 86400.0;
        var _phs = (_jdM - 2451549.5) / 29.530589;
        _phs -= _phs.toNumber().toFloat();
        if (_phs < 0.0) { _phs += 1.0; }
        _phs = 1.0 - _phs;
        var trainReadiness = "--"; // TODO: not in public API
        var _ssh = SensorHistory.getStressHistory(null);
        var _sss = _ssh != null ? _ssh.next() : null;
        var stressLevel = (_sss != null && _sss.data != null) ? (_sss.data.toNumber()).format("%d") : "--";
        var steps    = (_ami != null && _ami.steps    != null) ? _ami.steps.toString()    : "--";

            dc.setColor(0xFFFFFF, Gfx.COLOR_TRANSPARENT);
        dc.drawText(117, 137, Gfx.FONT_NUMBER_HOT, clockTime.hour.format("%02d"), Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFFFFFF, Gfx.COLOR_TRANSPARENT);
        dc.drawText(249, 138, Gfx.FONT_NUMBER_HOT, clockTime.min.format("%02d"), Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xCCCCCC, Gfx.COLOR_TRANSPARENT);
        dc.drawText(195, 240, Gfx.FONT_SMALL, info.day_of_week + ", " + info.month.toString() + "/" + info.day.toString(), Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFF4444, Gfx.COLOR_TRANSPARENT);
        dc.drawText(120, 290, Gfx.FONT_MEDIUM, heartRate, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFFFF00, Gfx.COLOR_TRANSPARENT);
        dc.drawText(270, 290, Gfx.FONT_SMALL, battery, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFFCC44, Gfx.COLOR_TRANSPARENT);
        dc.drawText(97, 187, Gfx.FONT_TINY, sunriseTime, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFF8844, Gfx.COLOR_TRANSPARENT);
        dc.drawText(290, 189, Gfx.FONT_TINY, sunsetTime, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFFAA44, Gfx.COLOR_TRANSPARENT);
        dc.drawText(190, 168, Gfx.FONT_TINY, timeTillSun, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFF8888, Gfx.COLOR_TRANSPARENT);
        dc.drawText(65, 279, Gfx.FONT_TINY, restingHR, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        // Bluetooth indicator — only visible when phone is connected
        if (Sys.getDeviceSettings().phoneConnected) {
            dc.setColor(0x0077FF, Gfx.COLOR_TRANSPARENT);
            dc.fillCircle(55, 145, 10);
        }

        dc.setColor(0xFFFFFF, Gfx.COLOR_TRANSPARENT);
        dc.drawText(48, 188, Gfx.FONT_TINY, notifications, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        // Moon phase graphic — lit circle + shadow showing illumination
        // Uses _phs calculated in variable section above
        dc.setColor(0xDDDDFF, Gfx.COLOR_TRANSPARENT);
        dc.fillCircle(194, 63, 20);
        // Draw shadow (dark part) based on phase
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_TRANSPARENT);
        if (_phs < 0.5) {
            // Waning: shadow on right
            var _sxWan = 194 + (20 - 20 * 2.0 * _phs).toNumber();
            dc.fillCircle(_sxWan, 63, 20);
        } else {
            // Waxing: shadow on left
            var _sxWax = 194 - (20 - 20 * 2.0 * (_phs - 0.5)).toNumber();
            dc.fillCircle(_sxWax, 63, 20);
        }

        dc.setColor(0x44FF88, Gfx.COLOR_TRANSPARENT);
        dc.drawText(276, 325, Gfx.FONT_TINY, trainReadiness, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xFF8844, Gfx.COLOR_TRANSPARENT);
        dc.drawText(240, 324, Gfx.FONT_TINY, stressLevel, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0x00FF88, Gfx.COLOR_TRANSPARENT);
        dc.drawText(193, 202, Gfx.FONT_SMALL, steps, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
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
