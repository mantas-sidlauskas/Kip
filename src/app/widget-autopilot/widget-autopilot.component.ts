import { ViewChild, Input, ElementRef, Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { MatDialog, MatButton } from '@angular/material';

import { SignalKService } from '../signalk.service';
import { SignalkRequestsService, skRequest } from '../signalk-requests.service';
import { ModalWidgetComponent } from '../modal-widget/modal-widget.component';
import { WidgetManagerService, IWidget, IWidgetConfig } from '../widget-manager.service';
import { UnitsService } from '../units.service';


const defaultConfig: IWidgetConfig = {
  displayName: 'N2k Autopilot',
  filterSelfPaths: true,
  useMetadata: false,
  useZones: false,
  paths: {
    "apState": {
      description: "Autopilot State",
      path: 'self.steering.autopilot.state',
      source: 'default',
      pathType: "string",
    },
    "apTargetHeadingMag": {
      description: "Autopilot Target Heading Mag",
      path: 'self.steering.autopilot.target.headingMagnetic',
      source: 'default',
      pathType: "number",
    },
    "apTargetWindAngleApp": {
      description: "Autopilot Target Wind Angle Apparent",
      path: 'self.steering.autopilot.target.windAngleApparent',
      source: 'default',
      pathType: "number",
    },
    "apNotifications": {
      description: "Autopilot Notifications",
      path: 'self.notifications.autopilot.*',
      source: 'default',
      pathType: "number",
    },
    "headingMag": {
      description: "Heading Magnetic",
      path: 'self.navigation.headingMagnetic',
      source: 'default',
      pathType: "number",
    },
    "headingTrue": {
      description: "Heading True",
      path: 'self.navigation.headingTrue',
      source: 'default',
      pathType: "number",
    },
    "windAngleApparent": {
      description: "Wind Angle Apparent",
      path: 'self.environment.wind.angleApparent',
      source: 'default',
      pathType: "number",
    },
    "windAngleTrueWater": {
      description: "Wind Angle True Water",
      path: 'self.environment.wind.angleTrueWater',
      source: 'default',
      pathType: "number",
    },
    "rudderAngle": {
      description: "Rudder Angle",
      path: 'self.steering.rudderAngle',
      source: 'default',
      pathType: "number",
    },
  },
  units: {
    "apTargetHeadingMag": "angle",
    "apTargetWindAngleApp": "angle",
    "apNotifications": "unitless",
    "headingMag": "angle",
    "headingTrue": "angle",
    "windAngleApparent": "angle",
    "windAngleTrueWater": "angle",
    "rudderAngle": "angle",
  },
  usage: {
    "headingMag": ['wind', 'route', 'auto', 'standby'],
    "headingTrue": ['wind', 'route', 'auto', 'standby'],
    "windAngleApparent": ['wind'],
    "windAngleTrueWater": ['wind'],
  },
  typeVal: {
    "headingMag": 'Mag',
    "headingTrue": 'True',
    "windAngleApparent": 'AWA',
    "windAngleTrueWater": 'TWA',
  },

  // filterSelfPaths: true,     // removed option. We never want to operation other vessel's AP!!!
  barColor: 'accent',     // theme palette to select
  autoStart: false,
};

const defaultPpreferedDisplayMode = {
  wind: 'windAngleApparent',
  route: 'headingMag',
  auto: 'headingMag',
  standby: 'headingMag'
}

const commands = {
  "auto":    {"path":"self.steering.autopilot.state","value":"auto"},
  "wind":    {"path":"self.steering.autopilot.state","value":"wind"},
  "route":   {"path":"self.steering.autopilot.state","value":"route"},
  "standby": {"path":"self.steering.autopilot.state","value":"standby"},
  "+1":      {"path":"self.steering.autopilot.actions.adjustHeading","value":1},
  "+10":     {"path":"self.steering.autopilot.actions.adjustHeading","value":10},
  "-1":      {"path":"self.steering.autopilot.actions.adjustHeading","value":-1},
  "-10":     {"path":"self.steering.autopilot.actions.adjustHeading","value":-10},
  "tackToPort":   {"path":"self.steering.autopilot.actions.tack","value":"port"},
  "tackToStarboard":   {"path":"self.steering.autopilot.actions.tack","value":"starboard"},
  "advanceWaypoint":   {"path":"self.steering.autopilot.actions.advanceWaypoint","value":"1"}
};

const noData = '-- -- -- --';
const noPilot = 'No pilot';
const noHeading = '---&deg;';
const countDownDefault: number = 5;
const timeoutBlink = 250;

@Component({
  selector: 'app-widget-autopilot',
  templateUrl: './widget-autopilot.component.html',
  styleUrls: ['./widget-autopilot.component.scss'],
})
export class WidgetAutopilotComponent implements OnInit, OnDestroy {
  @Input('widgetUUID') widgetUUID: string;
  @Input('unlockStatus') unlockStatus: boolean;

  // AP keypad
  @ViewChild('powerBtn') powerBtn: MatButton;
  @ViewChild('stbTackBtn') stbTackBtn: MatButton;
  @ViewChild('plus1Btn') plus1Btn: MatButton;
  @ViewChild('minus1Btn') minus1Btn: MatButton;
  @ViewChild('prtTackBtn') prtTackBtn: MatButton;
  @ViewChild('standbyBtn') standbyBtn: MatButton;
  @ViewChild('plus10Btn') plus10Btn: MatButton;
  @ViewChild('minus10Btn') minus10Btn: MatButton;
  @ViewChild('autoBtn') autoBtn: MatButton;
  @ViewChild('windModeBtn') windModeBtn: MatButton;
  @ViewChild('trackModeBtn') trackModeBtn: MatButton;
  @ViewChild('nxtWpBtn') nxtWpBtn: MatButton;
  @ViewChild('muteBtn') muteBtn: MatButton;
  @ViewChild('messageBtn') messageBtn: MatButton;

  // AP Screen
  @ViewChild('appSvgAutopilot') apScreen : any;

  // hack to access material-theme palette colors
  @ViewChild('primary') private primaryElement: ElementRef;
  @ViewChild('accent') private accentElement: ElementRef;
  @ViewChild('warn') private warnElement: ElementRef;
  @ViewChild('primaryDark') private primaryDarkElement: ElementRef;
  @ViewChild('accentDark') private accentDarkElement: ElementRef;
  @ViewChild('warnDark') private warnDarkElement: ElementRef;
  @ViewChild('background') private backgroundElement: ElementRef;
  @ViewChild('text') private textElement: ElementRef;

  activeWidget: IWidget;
  config: IWidgetConfig;

  // Subscription stuff
  currentAPState: any = null;      // Current Pilot Mode - used for display, keyboard state and buildCommand function
  apStateSub: Subscription = null;

  currentAPTargetAppWind: number = 0;
  apTargetAppWindSub: Subscription = null;

  currentHeading: number = 0;
  headingSub: Subscription = null;

  currentAppWindAngle: number = null;
  appWindAngleSub: Subscription = null;

  currentRudder: number = null;
  rudderSub: Subscription = null;

  skApNotificationSub =  new Subscription;
  skRequestSub = new Subscription; // signalk-Request result observer

  // Widget var
  handleCountDownCounterTimeout = null;
  handleConfirmActionTimeout = null;
  handleMessageTimeout = null;
  handleReceiveTimeout = null;
  handleDisplayErrorTimeout = null;
  countDownValue: number = 0;
  actionToBeConfirmed: string = "";
  skPathToAck: string = "";
  preferedDisplayMode = defaultPpreferedDisplayMode;
  isWChecked: boolean = false;       // used for Wind toggle
  isTChecked: boolean = false;       // used for Track toggle
  isApConnected: boolean = false;
  notificationsArray = {};
  alarmsCount: number = 0;

  notificationTest = {};

  constructor(
    public dialog:MatDialog,
    private SignalKService: SignalKService,
    private SignalkRequestsService: SignalkRequestsService,
    private WidgetManagerService: WidgetManagerService,
    private UnitsService: UnitsService,
  ) { }

  ngOnInit() {
    this.activeWidget = this.WidgetManagerService.getWidget(this.widgetUUID);
    if (this.activeWidget.config === null) {
        // no data, let's set some!
      this.WidgetManagerService.updateWidgetConfig(this.widgetUUID, defaultConfig);
      this.config = defaultConfig; // load default config.
    } else {
      this.config = this.activeWidget.config;
    }
    if (this.config.autoStart) {
      setTimeout(() => {this.startApHead();});
    }
    this.demoMode(); return; // demo mode for troubleshooting
  }

  demoMode() {

    // this.setNotificationMessage('{"path":"notifications.autopilot.PilotWarningWindShift","value":{"state":"alarm","message":"Pilot Warning Wind Shift"}}');
  }



  ngOnDestroy() {
    this.stopAllSubscriptions();
  }

  startAllSubscriptions() {
    this.subscribeHeading();
    this.subscribeAppWindAngle();
    this.subscribeRudder();
    this.subscribeAPState();
    this.subscribeAPTargetAppWind();
    this.subscribeSKRequest();
    this.subscribeAPNotification();
    console.log("Autopilot Sub Started");
  }

  stopAllSubscriptions() {
    this.unsubscribeHeading();
    this.unsubscribeAppWindAngle();
    this.unsubscribeRudder();
    this.unsubscribeAPState();
    this.unsubscribeAPTargetAppWind();
    this.unsubscribeSKRequest();
    this.unsubscribeAPNotification();
    console.log("Autopilot Subs Stopped");
  }

  subscribeAPNotification() {
    if (typeof(this.config.paths['apNotifications'].path) != 'string') { return } // nothing to sub to...
    this.skApNotificationSub = this.SignalKService.subscribePath(this.widgetUUID, this.config.paths['apNotifications'].path, this.config.paths['apNotifications'].source).subscribe(
      newValue => {

          if (newValue == null) {
            console.log("Null AP Notification: probably a clear message that is not handled");
          } else {
          this.setNotificationMessage(newValue);
          console.log(newValue);
          }
        }
    );
  }

  unsubscribeAPNotification() {
    this.skApNotificationSub.unsubscribe();
  }

  subscribeSKRequest() {
    this.skRequestSub = this.SignalkRequestsService.subscribeRequest().subscribe(requestResult => {
      if (requestResult.widgetUUID == this.widgetUUID) {
        this.commandReceived(requestResult);
      }
    });
  }

  unsubscribeSKRequest() {
    this.skRequestSub.unsubscribe();
  }

  subscribeAPTargetAppWind() {
    this.unsubscribeAPTargetAppWind();
    if (typeof(this.config.paths['apTargetWindAngleApp'].path) != 'string') { return } // nothing to sub to...
    this.apTargetAppWindSub = this.SignalKService.subscribePath(this.widgetUUID, this.config.paths['apTargetWindAngleApp'].path, this.config.paths['apTargetWindAngleApp'].source).subscribe(
      newValue => {
        if (newValue === null) {
          this.currentAPTargetAppWind = 0;
        } else {
          this.currentAPTargetAppWind = this.UnitsService.convertUnit('deg', newValue);
        }
      }
    );
  }

  unsubscribeAPTargetAppWind() {
    if (this.apTargetAppWindSub !== null) {
      this.apTargetAppWindSub.unsubscribe();
      this.apTargetAppWindSub = null;
      this.SignalKService.unsubscribePath(this.widgetUUID, this.config.paths['apTargetWindAngleApp'].path);
    }
  }

  subscribeAPState() {
    if (typeof(this.config.paths['apState'].path) != 'string') { return } // nothing to sub to...
    this.apStateSub = this.SignalKService.subscribePath(this.widgetUUID, this.config.paths['apState'].path, this.config.paths['apState'].source).subscribe(
      newValue => {
        this.currentAPState = newValue;
        this.SetKeyboardMode(this.currentAPState);
      }
    );
  }

  unsubscribeAPState() {
      this.apStateSub.unsubscribe();
  }

  subscribeHeading() {
    this.unsubscribeHeading();
    if (typeof(this.config.paths['headingMag'].path) != 'string') { return } // nothing to sub to...
    this.headingSub = this.SignalKService.subscribePath(this.widgetUUID, this.config.paths['headingMag'].path, this.config.paths['headingMag'].source).subscribe(
      newValue => {
        if (newValue === null) {
          this.currentHeading = 0;
        } else {

          this.currentHeading = this.UnitsService.convertUnit('deg', newValue);
        }

      }
    );
  }

  unsubscribeHeading() {
    if (this.headingSub !== null) {
      this.headingSub.unsubscribe();
      this.headingSub = null;
      this.SignalKService.unsubscribePath(this.widgetUUID, this.config.paths['headingMag'].path);
    }
  }

  subscribeAppWindAngle() {
    this.unsubscribeAppWindAngle();
    if (typeof(this.config.paths['windAngleApparent'].path) != 'string') { return } // nothing to sub to...

    this.appWindAngleSub = this.SignalKService.subscribePath(this.widgetUUID, this.config.paths['windAngleApparent'].path, this.config.paths['windAngleApparent'].source).subscribe(
      newValue => {
        if (newValue === null) {
          this.currentAppWindAngle = null;
          return;
        }

        let converted = this.UnitsService.convertUnit('deg', newValue);
        // 0-180+ for stb
        // -0 to -180 for port
        // need in 0-360

        if (converted < 0) {// stb
          this.currentAppWindAngle = 360 + converted; // adding a negative number subtracts it...
        } else {
          this.currentAppWindAngle = converted;
        }
      }
    );
  }

  unsubscribeAppWindAngle() {
    if (this.appWindAngleSub !== null) {
      this.appWindAngleSub.unsubscribe();
      this.appWindAngleSub = null;
      this.SignalKService.unsubscribePath(this.widgetUUID, this.config.paths['windAngleApparent'].path);
    }
  }

  subscribeRudder() {
    this.unsubscribeRudder();
    if (typeof(this.config.paths['rudderAngle'].path) != 'string') { return } // nothing to sub to...
    this.rudderSub = this.SignalKService.subscribePath(this.widgetUUID, this.config.paths['rudderAngle'].path, this.config.paths['rudderAngle'].source).subscribe(
      newValue => {
        if (newValue === null) {
          this.currentRudder = 0;
        } else {

          this.currentRudder = this.UnitsService.convertUnit('deg', newValue);
        }

      }
    );
  }

  unsubscribeRudder() {
    if (this.rudderSub !== null) {
      this.rudderSub.unsubscribe();
      this.rudderSub = null;
      this.SignalKService.unsubscribePath(this.widgetUUID, this.config.paths['rudderAngle'].path);
    }
  }

  openWidgetSettings() {
    let dialogRef = this.dialog.open(ModalWidgetComponent, {
      width: '80%',
      data: this.config
    });

    dialogRef.afterClosed().subscribe(result => {
      // save new settings
      if (result) {
        this.config = result;
        console.log(result);
        this.WidgetManagerService.updateWidgetConfig(this.widgetUUID, this.config);

        if (this.isApConnected) {
          this.stopAllSubscriptions();
          this.startAllSubscriptions();
        }
      }
    });
  }

  addHeading(h1: number, h2: number) {
    let h3 = h1 + h2;
    while (h3 > 359) { h3 = h3 - 359; }
    while (h3 < 0) { h3 = h3 + 359; }
    return h3;
  }

  powerBtnClick(event: Event) {
    if (!this.isApConnected) {
      this.startApHead();
    } else {
      this.stopApHead();
    }
  }

  startApHead() {
    this.startAllSubscriptions();
    this.config.autoStart = true; // save power-on state to autostart or not
    this.WidgetManagerService.updateWidgetConfig(this.widgetUUID, this.config);

    this.isApConnected = true;
    this.muteBtn.disabled = true;
    this.messageBtn.disabled = false;
  }

  stopApHead() {
    this.muteBtn.disabled = true;
    this.messageBtn.disabled = true;
    this.windModeBtn.disabled = true;
    this.trackModeBtn.disabled = true;
    this.nxtWpBtn.disabled = true;
    this.autoBtn.disabled = true;
    this.standbyBtn.disabled = true;
    this.plus1Btn.disabled = true;
    this.plus10Btn.disabled = true;
    this.minus1Btn.disabled = true;
    this.minus10Btn.disabled = true;
    this.prtTackBtn.disabled = true;
    this.stbTackBtn.disabled = true;

    this.apScreen.errorIconVisibility = 'hidden';

    this.isApConnected = false; // hide ap screen
    this.stopAllSubscriptions();
    this.config.autoStart = false; // save power on state to autostart or not
    this.WidgetManagerService.updateWidgetConfig(this.widgetUUID, this.config);
  }

  SetKeyboardMode(apMode: string) {
    switch (apMode) {
      case "standby":
        this.trackModeBtn.disabled = false;
        this.nxtWpBtn.disabled = true;
        this.autoBtn.disabled = false;
        this.standbyBtn.disabled = false;

        this.windModeBtn.disabled = false;
        this.plus1Btn.disabled = true;
        this.plus10Btn.disabled = true;
        this.minus1Btn.disabled = true;
        this.minus10Btn.disabled = true;
        this.prtTackBtn.disabled = true;
        this.stbTackBtn.disabled = true;
        break;

      case "auto":
        this.trackModeBtn.disabled = false;
        this.nxtWpBtn.disabled = true;
        this.autoBtn.disabled = false;
        this.standbyBtn.disabled = false;

        this.windModeBtn.disabled = false;
        this.plus1Btn.disabled = false;
        this.plus10Btn.disabled = false;
        this.minus1Btn.disabled = false;
        this.minus10Btn.disabled = false;
        this.prtTackBtn.disabled = true;
        this.stbTackBtn.disabled = true;
        break;

      case "wind":
        this.trackModeBtn.disabled = true;
        this.nxtWpBtn.disabled = true;
        this.autoBtn.disabled = false;
        this.standbyBtn.disabled = false;

        this.windModeBtn.disabled = false;
        this.plus1Btn.disabled = false;
        this.plus10Btn.disabled = false;
        this.minus1Btn.disabled = false;
        this.minus10Btn.disabled = false;
        this.prtTackBtn.disabled = false;
        this.stbTackBtn.disabled = false;
        break;

      case "route":
        this.trackModeBtn.disabled = true;
        this.nxtWpBtn.disabled = false;
        this.autoBtn.disabled = false;
        this.standbyBtn.disabled = false;

        this.windModeBtn.disabled = true;
        this.plus1Btn.disabled = true;
        this.plus10Btn.disabled = true;
        this.minus1Btn.disabled = true;
        this.minus10Btn.disabled = true;
        this.prtTackBtn.disabled = true;
        this.stbTackBtn.disabled = true;
        break;

      default:
        break;
    }
  }

  buildAndSendCommand(cmd: string) {
    let cmdAction = commands[cmd];
    if (typeof cmdAction === 'undefined') {
      alert('Unknown Autopilot command: ' + cmd);
      return null;
    }
    if ((this.actionToBeConfirmed !== '')&&(this.actionToBeConfirmed !== cmd)) {
      this.clearConfirmCmd();
    }
    if (((cmd === 'tackToPort')||(cmd === 'tackToStarboard'))&&(this.actionToBeConfirmed === '')) {
      this.confirmTack(cmd);
      return null;
    }
    if ((cmd === 'route')&&(this.currentAPState === 'route')&&(this.actionToBeConfirmed === '')) {
      this.confirmAdvanceWaypoint(cmd);
      return null;
    }
    if (this.actionToBeConfirmed === cmd) {
      this.clearConfirmCmd();
      if ((cmd === 'tackToPort')||(cmd === 'tackToStarboard')) {
        this.sendCommand(commands['auto']); // force mode 'auto' to take a tack
        this.sendCommand(cmdAction);
      }
      if ((cmd === 'route')&&(this.currentAPState === 'route')) {
        this.sendCommand(commands['advanceWaypoint']);
      }
      return null;
    }
    this.sendCommand(cmdAction);
  }

  confirmAdvanceWaypoint(cmd: string) {
    let message: string = "Repeat key <b>[Next Wpt]</b><br>to confirm<br>Advance Waypoint";
    this.startConfirmCmd(cmd, message);
  }

  confirmTack(cmd: string) {
    let message = "Repeat same key<br>to confirm<br>tack to ";
    if (cmd === "tackToPort") {
      message += "port";
      this.actionToBeConfirmed = cmd;
    } else if (cmd === "tackToStarboard") {
        message += "starboard";
        this.actionToBeConfirmed = cmd;
      } else {
          this.actionToBeConfirmed = "";
          return null;
        }
    this.startConfirmCmd(cmd, message);
  }

  sendCommand(cmdAction) {
    let requestId = this.SignalkRequestsService.putRequest(cmdAction["path"], cmdAction["value"], this.widgetUUID);
    this.apScreen.activityIconVisibility = "visible";
    setTimeout(() => {this.apScreen.activityIconVisibility = 'hidden';}, timeoutBlink);

    console.log("AP Action:\n" + JSON.stringify(cmdAction));
  }

  commandReceived(cmdResult: skRequest) {
    this.apScreen.activityIconVisibility = "visible";
    clearTimeout(this.handleReceiveTimeout);
    this.handleReceiveTimeout = setTimeout(() => {this.apScreen.activityIconVisibility = 'hidden';}, timeoutBlink);

    if (cmdResult.statusCode != 200){
      this.displayApError(cmdResult);
    } else {
      console.log("AP Received: \n" + JSON.stringify(cmdResult));
    }
  }

  startConfirmCmd(cmd: string, message: string) {
    this.countDownValue = countDownDefault;
    this.actionToBeConfirmed = cmd;

    this.apScreen.msgStencilInnerHTML = "<p>" + message + "</p>";
    this.apScreen.msgStencilVisibility = "visible";

    this.updateCountDownCounter(message);

    clearTimeout(this.handleConfirmActionTimeout);

    this.handleConfirmActionTimeout = setTimeout(() => {
      this.apScreen.msgStencilVisibility = "hidden";
      this.apScreen.msgStencilInnerHTML = "";
      this.actionToBeConfirmed = "";
    }, 5000);
  }

  clearConfirmCmd() : boolean {
    clearTimeout(this.handleConfirmActionTimeout);
    clearTimeout(this.handleCountDownCounterTimeout);
    this.countDownValue = -1;
    this.apScreen.msgStencilVisibility = "hidden";
    this.apScreen.msgStencilInnerHTML = "";
    this.actionToBeConfirmed = '';
    return null;
  }

  updateCountDownCounter(message: string) {
    if (this.countDownValue > 0) {
      clearTimeout(this.handleCountDownCounterTimeout);
      this.apScreen.msgStencilInnerHTML = "<p>" + message + "</p>" + "<h1 class='counterText'>" + this.countDownValue.toString() + "</h1>";
      this.countDownValue -= 1;
      this.handleCountDownCounterTimeout = setTimeout(() => {
        this.updateCountDownCounter(message);
      }, 1000);
    } else {
        clearTimeout(this.handleCountDownCounterTimeout);
    }
  }

  displayApError(cmdResult: skRequest) {
    let errMsg = cmdResult.statusCode + " - " +cmdResult.statusCodeDescription;
    if (cmdResult.message){
      errMsg = errMsg + " Server Message: " + cmdResult.message;
    }
    this.apScreen.errorStencilInnerText = errMsg;
    this.apScreen.errorStencilVisibility = "visible";

    clearTimeout(this.handleDisplayErrorTimeout);

    this.handleDisplayErrorTimeout = setTimeout(() => {
      this.apScreen.errorStencilVisibility = "hidden";
      this.apScreen.errorStencilInnerText = "";
    }, 6000);
    this.apScreen.errorIconVisibility = 'visible';
  }

  getNextNotification(skPath: string): string {
    let notificationsKeys = Object.keys(this.notificationsArray);
    let newSkPathToAck: string = "";
    let index: number = 0;
    if (notificationsKeys.length > 0) {
      if (typeof skPath !== "undefined") {
        index = notificationsKeys.indexOf(skPath) + 1;
      } else {
          index = 0;
        }
      if (notificationsKeys.length <= index) {
        index = 0;
      }
      newSkPathToAck = notificationsKeys[index];
    }
    return newSkPathToAck;
  }

  setNotificationMessage(value) {
    this.apScreen.activityIconVisibility = "visible";
    clearTimeout(this.handleReceiveTimeout);
    this.handleReceiveTimeout = setTimeout(() => {this.apScreen.activityIconVisibility = 'hidden';}, timeoutBlink);

    if (typeof value.path !== 'undefined') {
      value.path = value.path.replace('notifications.', '');
      if (typeof value.value !== 'undefined') {
        if (value.value.state === 'normal') {
          if (this.apScreen.messageInnerText === this.notificationsArray[value.path]) {
            this.apScreen.messageInnerText = '';
          }
          delete this.notificationsArray[value.path]
        } else {
            this.notificationsArray[value.path] = value.value.message.replace("Pilot", "");
            this.apScreen.messageInnerText = this.notificationsArray[value.path];
          }
      }
    }
    this.alarmsCount = Object.keys(this.notificationsArray).length;
    if (this.alarmsCount > 0) {
      this.muteBtn.disabled = false;
      if (this.apScreen.messageInnerText == "") {
        this.apScreen.messageInnerText = Object.keys(this.notificationsArray)[0];
      }
    } else {
        this.muteBtn.disabled = true;
        this.alarmsCount = 0;
        this.apScreen.messageInnerText = "";
      }
  }

  notificationToValue(skPathToAck: string): string {
    let message: string = this.notificationsArray[skPathToAck];
    if (typeof message == "undefined") {
      message = "No alarm present...";
    }
    return message;
  }

  notificationScroll() {
    if ((Object.keys(this.notificationsArray).length > 0) && (this.skPathToAck == "")) {
      this.skPathToAck = Object.keys(this.notificationsArray)[0];
    }

    this.skPathToAck = this.getNextNotification(this.skPathToAck);
    // Not sure about this DIV ??? May be message area???
    // silenceScreenTextDiv.innerHTML = notificationToValue(skPathToAck);
    this.apScreen.messageInnerText = this.notificationToValue(this.skPathToAck);
    this.apScreen.messageVisibility = 'visible';
    clearTimeout(this.handleMessageTimeout);
    this.handleMessageTimeout = setTimeout(() => {
      this.apScreen.messageInnerText = "";
      this.apScreen.messageVisibility = 'hidden';
    }, 2000);
  }

  sendSilence() {
    if (this.apScreen.messageVisibility != 'visible') {
      this.apScreen.messageVisibility = 'visible';

      if ((Object.keys(this.notificationsArray).length > 0) && (this.skPathToAck == "")) {
        this.skPathToAck = Object.keys(this.notificationsArray)[0];
      }
    } else {
        if (this.skPathToAck !== "") {
          this.sendCommand({"path":"notifications." + this.skPathToAck + ".state","value":"normal"});
          // this.sendCommand({"path":"notifications." + skPathToAck + ".method","value":[]});
        }
        this.apScreen.messageVisibility = 'hidden';
      }
      this.apScreen.messageInnerText = this.notificationToValue(this.skPathToAck);
  }
}
