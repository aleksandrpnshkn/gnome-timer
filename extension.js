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
const Slider = imports.ui.slider;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;

class Time {
    constructor(hours, minutes, seconds) {
        this.hours = hours;
        this.minutes = minutes;
        this.seconds = seconds;
    }

    getFormatted() {
        return String(this.hours).padStart(2, '0')
            + ':' + String(this.minutes).padStart(2, '0')
            + ':' + String(this.seconds).padStart(2, '0');
    }
}

// unfortunately static properties are not implemented
const STATE_PLAY = 0;
const STATE_PAUSE = 1;
const STATE_STOP = 2;

class Timer {
    constructor(time) {
        this.SECOND_TO_MS = 1000000;
        this.MINUTE_TO_MS = 1000000 * 60;
        this.HOUR_TO_MS = 1000000 * 60 * 60;

        this.mcsLeft = null;
        this.pauseTimestamp = null;
        this.finishTimestamp = null;

        if (time) {
            this.setTime(time);
        }

        this.state = STATE_STOP;
    }

    /**
     * @param {Time} time
     */
    setTime(time) {
        this.time = new Time(time.hours, time.minutes, time.seconds);
    }

    update() {
        if (this.isPaused()) {
            return;
        }

        this.mcsLeft = this.finishTimestamp - GLib.get_real_time();

        if (this.mcsLeft <= 0) {
            this.stop();
        }

        this.time.seconds = Math.floor(this.mcsLeft / this.SECOND_TO_MS % 60);
        this.time.minutes = Math.floor(this.mcsLeft / this.MINUTE_TO_MS % 60);
        this.time.hours = Math.floor(this.mcsLeft / this.HOUR_TO_MS);
    }

    start() {
        this.finishTimestamp = GLib.get_real_time()
            + this.SECOND_TO_MS * this.time.seconds
            + this.MINUTE_TO_MS * this.time.minutes
            + this.HOUR_TO_MS * this.time.hours;
        this.state = STATE_PLAY;
        this.update();
    }

    pause() {
        this.pauseTimestamp = GLib.get_real_time();
        this.state = STATE_PAUSE;
    }

    resume() {
        // Add time spent in pause
        this.finishTimestamp += GLib.get_real_time() - this.pauseTimestamp;
        this.pauseTimestamp = null;
        this.state = STATE_PLAY;
    }

    stop() {
        this.time.seconds = 0;
        this.time.minutes = 0;
        this.time.hours = 0;
        this.state = STATE_STOP;
    }

    isPaused() {
        return this.state === STATE_PAUSE;
    }

    isPlaying() {
        return this.state === STATE_PLAY;
    }

    isStopped() {
        return this.state === STATE_STOP;
    }
}

const TimerPopup = GObject.registerClass(
    class TimerPopup extends PanelMenu.Button {
        _init(timer) {
            super._init(0);

            this.timer = timer;

            this.MAX_HOURS = 10;

            this.playStateLabelMap = {
                [STATE_PLAY]: 'Pause',
                [STATE_PAUSE]: 'Resume',
                [STATE_STOP]: 'Start',
            };

            this.playStateIconMap = {
                [STATE_PLAY]: 'media-playback-start-symbolic',
                [STATE_PAUSE]: 'media-playback-pause-symbolic',
                [STATE_STOP]: 'media-playback-stop-symbolic',
            };

            const defaultTime = new Time(0, 40, 0);

            this.options = {
                time: defaultTime,
            };

            // Timer could be not stopped if PC was in sleep mode with active timer
            if (this.timer.isStopped()) {
                this.timer.setTime(this.options.time);
            }

            this.sliders = {
                hours: new Slider.Slider(this.options.time.hours / this.MAX_HOURS),
                minutes: new Slider.Slider(this.options.time.minutes / 60),
                seconds: new Slider.Slider(this.options.time.seconds / 60),
            };

            this.sliders.hours.connect('notify::value', this.handleTimeInput.bind(this, this.MAX_HOURS));
            this.sliders.hours.accessible_name = 'Hours';

            this.sliders.minutes.connect('notify::value', this.handleTimeInput.bind(this, 60));
            this.sliders.minutes.accessible_name = 'Minutes';

            this.sliders.seconds.connect('notify::value', this.handleTimeInput.bind(this, 60));
            this.sliders.seconds.accessible_name = 'Seconds';

            // Only one St-element can be added. For multiple need to use a wrapper.
            // https://wiki.gnome.org/Projects/GnomeShell/Extensions/EcoDoc/Applet#Labels_and_Icons
            const box = new St.BoxLayout();
            this.panelLabel = new St.Label({
                style_class: 'timer_panel-label',
                text: this.options.time.getFormatted(),
                y_align: St.Align.END,
            });
            this.panelIcon = new St.Icon({
                icon_name: this.playStateIconMap[this.timer.state],
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

            const hoursItem = new PopupMenu.PopupBaseMenuItem();
            hoursItem.add(this.sliders.hours);
            this.menu.addMenuItem(hoursItem);

            const minutesItem = new PopupMenu.PopupBaseMenuItem();
            minutesItem.add(this.sliders.minutes);
            this.menu.addMenuItem(minutesItem);

            const secondsItem = new PopupMenu.PopupBaseMenuItem();
            secondsItem.add(this.sliders.seconds);
            this.menu.addMenuItem(secondsItem);

            this.menuItems.play.connect('activate', this.handlePlayClick.bind(this));
            this.menuItems.stop.connect('activate', () => this.stopTimer());

            if (! this.timer.isStopped()) {
                this.startDisplayingTime();
            }
        }

        handleTimeInput() {
            this.options.time.hours = Math.round(this.MAX_HOURS * this.sliders.hours.value);
            this.options.time.minutes = Math.round(60 * this.sliders.minutes.value);
            this.options.time.seconds = Math.round(60 * this.sliders.seconds.value);
            this.updatePanelLabel();
        }

        updatePanelLabel(panelLabelText) {
            if (panelLabelText) {
                this.panelLabel.set_text(panelLabelText);
            }
            else if (this.timer.isStopped()) {
                this.panelLabel.set_text(this.options.time.getFormatted());
            }
            else {
                this.panelLabel.set_text(this.timer.time.getFormatted());
            }

            this.panelIcon.set_icon_name(this.playStateIconMap[this.timer.state]);
        }

        handlePlayClick() {
            if (this.timer.isStopped()) {
                this.startTimer();
            }
            else if (this.timer.isPlaying()) {
                this.timer.pause();
            }
            else if (this.timer.isPaused()) {
                this.timer.resume();
            }

            // after timeout manipulations
            this.menuItems.play.label.set_text(this.playStateLabelMap[this.timer.state]);
        }

        startTimer() {
            this.timer.setTime(this.options.time);
            this.timer.start();
            this.startDisplayingTime();
        }

        updateTimer() {
            this.timer.update();

            if (this.timer.isStopped()) {
                this.stopTimer('Done!');
                Main.notify('Done!');
                return false;
            }

            this.updatePanelLabel();
            return true;
        }

        stopTimer(panelLabelText) {
            this.stopDisplayingTime();
            this.timer.stop();
            this.updatePanelLabel(panelLabelText);
            this.menuItems.play.label.set_text(this.playStateLabelMap[STATE_STOP]);
        }

        startDisplayingTime() {
            this.updateTimer(); // call before the timeout
            this.timeout = Mainloop.timeout_add(500, this.updateTimer.bind(this));
        }

        stopDisplayingTime() {
            Mainloop.source_remove(this.timeout);
        }

        /**
         * Destroy TimerPopup. Timeouts should't work in sleep mode
         */
        destroy() {
            this.stopDisplayingTime();
            super.destroy();
        }
    }
);

class Extension {
    constructor() {
        // Timer instance must remain in memory, otherwise timer state will be reset after wake up from sleep mode
        this.timer = new Timer();
    }

    enable() {
        this.timerPopup = new TimerPopup(this.timer);
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
