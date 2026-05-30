// REFERENCE TEMPLATE — DO NOT EDIT
// ═══════════════════════════════════════════════════════════════════════════════
// This file is completely replaced when you export a design from WatchFace Builder.
// It is here for reference only to show the generated code structure.
//
// Device: vivoactive6 (390×390 round display)
// SDK: Connect IQ 9.1.0+, minSdkVersion 4.2.0
// ═══════════════════════════════════════════════════════════════════════════════

using Toybox.Application as App;
using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;
using Toybox.Activity as Activity;
using Toybox.UserProfile as UserProfile;
using Toybox.Lang as Lang;

// App entry point (specified in manifest.xml)
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

// Power budget monitoring (prevents excessive CPU usage)
class WatchFaceViewDelegate extends Ui.WatchFaceDelegate {
    function initialize(view as WatchFaceView) {
        WatchFaceDelegate.initialize();
    }
    function onPowerBudgetExceeded(powerInfo as Ui.WatchFacePowerInfo) as Void {
        Sys.println("Power budget exceeded: " + powerInfo.executionTimeAverage + "ms");
    }
}

// Main watch face view — renders on full update
class WatchFaceView extends Ui.WatchFace {

    function initialize() {
        WatchFace.initialize();
    }

    function onLayout(dc) {
    }

    function onUpdate(dc) {
        Sys.println("WF onUpdate called");
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_BLACK);
        dc.clear();
        try {
            var clockTime = Sys.getClockTime();

            // API calls cached per frame to avoid redundant lookups
            var _ai = Activity.getActivityInfo();
            var _up = UserProfile.getProfile();

            // Draw elements from canvas (all drawText/drawLine/drawArc calls)
            // Example: hours
            dc.setColor(0xFFFFFF, Gfx.COLOR_TRANSPARENT);
            var hours = clockTime.hour.format("%02d");
            dc.drawText(155, 178, Gfx.FONT_NUMBER_HOT, hours,
                Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

            // Example: heart rate (with null check)
            var heartRate = (_ai != null && _ai.currentHeartRate != null)
                ? _ai.currentHeartRate.toString() : "--";
            dc.setColor(0xFF4444, Gfx.COLOR_TRANSPARENT);
            dc.drawText(120, 290, Gfx.FONT_MEDIUM, heartRate,
                Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        } catch (ex instanceof Lang.Exception) {
            dc.setColor(Gfx.COLOR_RED, Gfx.COLOR_BLACK);
            dc.drawText(195, 195, Gfx.FONT_SMALL, ex.getErrorMessage(),
                Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
            Sys.println("WF onUpdate exception: " + ex.getErrorMessage());
        }
    }

    // Called every second (1000 ms system tick) for efficient partial updates (e.g., seconds hand)
    function onTick(tickEvent) {
        Ui.requestUpdate();
    }

    // Called when watch face becomes visible
    function onShow() {
        Ui.requestUpdate();
    }

    function onHide() {}
    function onExitSleep() { Ui.requestUpdate(); }
    function onEnterSleep() { Ui.requestUpdate(); }
}
