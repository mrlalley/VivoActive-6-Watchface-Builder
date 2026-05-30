using Toybox.Application as App;
using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;






using Toybox.Lang as Lang;



class WatchFaceApp extends App.AppBase {
    function initialize() { AppBase.initialize(); }
    function getInitialView() {
        return [new WatchFaceView()];
    }
}

class WatchFaceView extends Ui.WatchFace {

    function initialize() {
        WatchFace.initialize();
    }

    function onLayout(dc) {
    }

    function onShow() {
        Ui.requestUpdate();
    }

    function onUpdate(dc) {
        Sys.println("WF onUpdate called");
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_BLACK);
        dc.clear();
        try {
            var clockTime = Sys.getClockTime();
            
            
            
            
            
            

            
        } catch (ex instanceof Lang.Exception) {
            dc.setColor(Gfx.COLOR_RED, Gfx.COLOR_BLACK);
            dc.drawText(195, 195, Gfx.FONT_SMALL, ex.getErrorMessage(), Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
            Sys.println("WF onUpdate exception: " + ex.getErrorMessage());
        }
    }

    function onTick(tickEvent) {
        Ui.requestUpdate();
    }

    function onPartialUpdate(dc) {
        try {
            var clockTime = Sys.getClockTime();
            dc.setColor(Gfx.COLOR_WHITE, Gfx.COLOR_BLACK);
            dc.drawText(195, 195, Gfx.FONT_NUMBER_HOT,
                clockTime.hour.format("%02d") + ":" + clockTime.min.format("%02d") + ":" + clockTime.sec.format("%02d"),
                Gfx.TEXT_JUSTIFY_CENTER | Gfx.TEXT_JUSTIFY_VCENTER);
        } catch (ex instanceof Lang.Exception) {
            Sys.println("WF onPartialUpdate exception: " + ex.getErrorMessage());
        }
    }

    function onHide() {}
    function onExitSleep() { Ui.requestUpdate(); }
    function onEnterSleep() { Ui.requestUpdate(); }
}
