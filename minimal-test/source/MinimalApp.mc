import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

class MinimalApp extends Application.AppBase {
    function initialize() { AppBase.initialize(); }
    function onStart(state as Dictionary?) as Void {}
    function onStop(state as Dictionary?) as Void {}
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [new MinimalView()];
    }
}

class MinimalView extends WatchUi.WatchFace {
    function initialize() { WatchFace.initialize(); }
    function onLayout(dc as Graphics.Dc) as Void {}
    function onShow() as Void { WatchUi.requestUpdate(); }

    function onUpdate(dc as Graphics.Dc) as Void {
        System.println("MinimalView onUpdate called");
        // Fill entire screen bright red — if this doesn't appear, rendering is blocked
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_RED);
        dc.clear();
        dc.fillRectangle(0, 0, 390, 390);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(195, 195, Graphics.FONT_LARGE, "HELLO", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function onPartialUpdate(dc as Graphics.Dc) as Void {
        // In sleep mode: fill clip region with red so it's visible
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_RED);
        dc.clear();
    }

    function onHide() as Void {}
    function onExitSleep() as Void { WatchUi.requestUpdate(); }
    function onEnterSleep() as Void { WatchUi.requestUpdate(); }
}
