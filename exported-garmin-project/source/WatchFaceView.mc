using Toybox.Application as App;
using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;






using Toybox.Lang as Lang;

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
            
            
            
            
            var _bbh = SensorHistory.getBodyBatteryHistory(null);
        var _bbs = _bbh != null ? _bbh.next() : null;
        var bodyBattery = (_bbs != null && _bbs.data != null) ? (_bbs.data.toNumber()).format("%d") : "--";

            dc.setColor(0xFFFFFF, Gfx.COLOR_TRANSPARENT);
        dc.drawText(142, 178, Gfx.FONT_NUMBER_THAI_HOT, clockTime.hour.format("%02d"), Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0x00FF88, Gfx.COLOR_TRANSPARENT);
        dc.drawText(70, 290, Gfx.FONT_SMALL, bodyBattery, Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
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
