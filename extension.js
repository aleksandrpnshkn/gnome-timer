/**
 * To apply changes restart gnome shell:
 *      alt+f2 -> r -> enter.
 *
 * Logs:
 * - sudo journalctl /usr/bin/gnome-shell | less +G
 * where +G moves pointer to the end of the file;
 * - sudo journalctl -f /usr/bin/gnome-shell
 * for realtime logs.
 *
 * Icons:
 * - https://gitlab.gnome.org/Archive/gnome-icon-theme-symbolic/-/tree/master/
 * - /usr/share/icons
 *
 * Materials:
 * https://www.youtube.com/playlist?list=PLr3kuDAFECjZhW-p56BoVB7SubdUHBVQT
 * https://gjs.guide/extensions/development/creating.html
 * https://gjs-docs.gnome.org/
 * https://gitlab.gnome.org/GNOME/gnome-shell/-/tree/master/js/ui
 * GNOME Shell Javascript Source Reference - https://github.com/julio641742/gnome-shell-extension-reference/blob/master/REFERENCE.md
 */

const Main = imports.ui.main;
const St = imports.gi.St;
const GObject = imports.gi.GObject;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;

class Timer {
    constructor(hours, minutes, seconds) {
        this.mcsLeft = null;
        this.pauseTimestamp = null;

        this.SECOND_TO_MS = 1000000;
        this.MINUTE_TO_MS = 1000000 * 60;
        this.HOUR_TO_MS = 1000000 * 60 * 60;

        this.finishTimestamp = GLib.get_real_time()
            + this.SECOND_TO_MS * seconds
            + this.MINUTE_TO_MS * minutes
            + this.HOUR_TO_MS * hours;
    }

    update() {
        if (this.isPaused()) {
            return this.mcsLeft;
        }

        this.mcsLeft = this.finishTimestamp - GLib.get_real_time();

        if (this.isFinished()) {
            return false;
        }

        this.seconds = Math.floor(this.mcsLeft / this.SECOND_TO_MS % 60);
        this.minutes = Math.floor(this.mcsLeft / this.MINUTE_TO_MS % 60);
        this.hours = Math.floor(this.mcsLeft / this.HOUR_TO_MS);

        return this.mcsLeft;
    }

    pause() {
        this.pauseTimestamp = GLib.get_real_time();
    }

    resume() {
        // Add time spent in pause
        this.finishTimestamp += GLib.get_real_time() - this.pauseTimestamp;
        this.pauseTimestamp = null;
    }

    isFinished() {
        return this.mcsLeft <= 0;
    }

    isPaused() {
        return this.pauseTimestamp !== null;
    }
}

const TimerPopup = GObject.registerClass(
    class TimerPopup extends PanelMenu.Button {
        _init() {
            super._init(0);

            this.STATE_PLAY = 0;
            this.STATE_PAUSE = 1;
            this.STATE_STOP = 2;

            this.state = this.STATE_STOP;

            this.playStateLabelMap = {
                [this.STATE_PLAY]: 'Pause',
                [this.STATE_PAUSE]: 'Resume',
                [this.STATE_STOP]: 'Start',
            };

            // Only one St-element can be added. For multiple need to use a wrapper.
            // https://wiki.gnome.org/Projects/GnomeShell/Extensions/EcoDoc/Applet#Labels_and_Icons
            const box = new St.BoxLayout();
            this.panelLabel = new St.Label({
                style_class: 'timer_panel-label',
                text: 'Timer',
                y_align: St.Align.END,
            });
            this.panelIcon = new St.Icon({
                icon_name: 'timer-symbolic',
                style_class: 'system-status-icon',
            });
            box.add_actor(this.panelIcon);
            box.add_actor(this.panelLabel);
            box.add_actor(new St.Icon({ // arrow icon
                icon_name: 'pan-down-symbolic',
                style_class: 'system-status-icon',
            }));
            this.add_child(box);

            this.menuItems = {
                play: new PopupMenu.PopupMenuItem('Start'),
                stop: new PopupMenu.PopupMenuItem('Stop'),
            };

            this.menu.addMenuItem(this.menuItems.play);
            this.menu.addMenuItem(this.menuItems.stop);

            this.menuItems.play.connect('activate', this.handlePlayClick.bind(this));
            this.menuItems.stop.connect('activate', () => this.stopTimer('00:00:00'));
        }

        handlePlayClick() {
            if (this.isStopped()) {
                this.state = this.STATE_PLAY;
                this.timer = new Timer(0, 0, 5);
                this.updateTime(); // call before the timeout
                this.timeout = Mainloop.timeout_add(500, this.updateTime.bind(this));
            }
            else if (this.isPlaying()) {
                this.state = this.STATE_PAUSE;
                this.timer.pause();
            }
            else if (this.isPaused()) {
                this.state = this.STATE_PLAY;
                this.timer.resume();
            }

            // after timeout manipulations
            this.menuItems.play.label.set_text(this.playStateLabelMap[this.state]);
        }

        updateTime() {
            const msLeft = this.timer.update();

            if (msLeft === false) {
                this.stopTimer('Done!');
                Main.notify('Done!');
                return false;
            }

            this.panelLabel.set_text(
                String(this.timer.hours).padStart(2, '0')
                + ':' + String(this.timer.minutes).padStart(2, '0')
                + ':' + String(this.timer.seconds).padStart(2, '0')
            );

            return true;
        }

        stopTimer(panelLabelText) {
            this.state = this.STATE_STOP;
            Mainloop.source_remove(this.timeout);
            this.panelLabel.set_text(panelLabelText);
            this.menuItems.play.label.set_text(this.playStateLabelMap[this.STATE_STOP]);
        }

        isPaused() {
            return this.state === this.STATE_PAUSE;
        }

        isPlaying() {
            return this.state === this.STATE_PLAY;
        }

        isStopped() {
            return this.state === this.STATE_STOP;
        }
    }
);

class Extension {
    enable() {
        this.timerPopup = new TimerPopup();
        Main.panel.addToStatusArea('TimerPopup', this.timerPopup, 1);
    }

    disable() {
        this.timerPopup.destroy();
        this.timerPopup = null;
    }
}

function init() {
    return new Extension();
}
