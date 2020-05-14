import { Component, Input, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { Subscription } from 'rxjs';
import { MatDialog,MatDialogRef,MAT_DIALOG_DATA } from '@angular/material';

import { ModalWidgetComponent } from '../modal-widget/modal-widget.component';
import { SignalKService } from '../signalk.service';
import { AppSettingsService } from '../app-settings.service';
import { WidgetManagerService, IWidget, IWidgetConfig } from '../widget-manager.service';
import { isNull } from 'util';


const defaultConfig: IWidgetConfig = {
  displayName: null,
  paths: {
    "stringPath": {
      description: "String Data",
      path: null,
      source: null,
      pathType: "string",
    }
  },
  filterSelfPaths: true
};

@Component({
  selector: 'app-widget-text-generic',
  templateUrl: './widget-text-generic.component.html',
  styleUrls: ['./widget-text-generic.component.css']
})
export class WidgetTextGenericComponent implements OnInit, OnDestroy {

  @Input('widgetUUID') widgetUUID: string;
  @Input('unlockStatus') unlockStatus: boolean;
  @ViewChild('canvasEl') canvasEl: ElementRef;
  @ViewChild('canvasBG') canvasBG: ElementRef;
  @ViewChild('wrapperDiv') wrapperDiv: ElementRef;

  activeWidget: IWidget;
    config: IWidgetConfig;

  dataValue: any = null;

  dataTimestamp: number = Date.now();

  valueFontSize: number = 1;
  currentValueLength: number = 0; // length (in charaters) of value text to be displayed. if changed from last time, need to recalculate font size...
  currentMinMaxLength: number = 0;
  canvasCtx;
  canvasBGCtx;

  //subs
  valueSub: Subscription = null;

  // dynamics theme support
  themeNameSub: Subscription = null;


  constructor(
    public dialog:MatDialog,
    private SignalKService: SignalKService,
    private WidgetManagerService: WidgetManagerService,
    private AppSettingsService: AppSettingsService, // need for theme change subscription
    ) {
  }

  ngOnInit() {
    this.activeWidget = this.WidgetManagerService.getWidget(this.widgetUUID);
    if (this.activeWidget.config === null) {
        // no data, let's set some!
      this.WidgetManagerService.updateWidgetConfig(this.widgetUUID, defaultConfig);
      this.config = defaultConfig; // load default config.
    } else {
      this.config = this.activeWidget.config;
    }

    this.canvasCtx = this.canvasEl.nativeElement.getContext('2d');
    this.canvasBGCtx = this.canvasBG.nativeElement.getContext('2d');

    this.subscribePath();
    this.subscribeTheme();
    this.resizeWidget();
  }

  ngOnDestroy() {
    this.unsubscribePath();
    this.unsubscribeTheme();
  }

  ngAfterViewChecked() {
    this.resizeWidget();
  }

  resizeWidget() {
    let rect = this.wrapperDiv.nativeElement.getBoundingClientRect();

    if (rect.height < 50) { return; }
    if (rect.width < 50) { return; }
    if ((this.canvasEl.nativeElement.width != Math.floor(rect.width)) || (this.canvasEl.nativeElement.height != Math.floor(rect.height))) {
      this.canvasEl.nativeElement.width = Math.floor(rect.width);
      this.canvasEl.nativeElement.height = Math.floor(rect.height);
      this.canvasBG.nativeElement.width = Math.floor(rect.width);
      this.canvasBG.nativeElement.height = Math.floor(rect.height);
      this.currentValueLength = 0; //will force resetting the font size
      this.currentMinMaxLength = 0;
      this.updateCanvas();
      this.updateCanvasBG();
    }

  }


  subscribePath() {
    this.unsubscribePath();
    if (typeof(this.config.paths['stringPath'].path) != 'string') { return } // nothing to sub to...
    this.valueSub = this.SignalKService.subscribePath(this.widgetUUID, this.config.paths['stringPath'].path, this.config.paths['stringPath'].source).subscribe(
      newValue => {
        this.dataValue = newValue;
        this.updateCanvas();
      }
    );
  }

  unsubscribePath() {
    if (this.valueSub !== null) {
      this.valueSub.unsubscribe();
      this.valueSub = null;
      this.SignalKService.unsubscribePath(this.widgetUUID, this.config.paths['stringPath'].path)
    }
  }
  // Subscribe to theme event
  subscribeTheme() {
    this.themeNameSub = this.AppSettingsService.getThemeNameAsO().subscribe(
      themeChange => {
      setTimeout(() => {   // need a delay so browser getComputedStyles has time to complete theme application.
        this.drawTitle();
        this.drawValue();
      }, 100);
    })
  }

  unsubscribeTheme(){
    if (this.themeNameSub !== null) {
      this.themeNameSub.unsubscribe();
      this.themeNameSub = null;
    }
  }

  openWidgetSettings(content) {

    let dialogRef = this.dialog.open(ModalWidgetComponent, {
      width: '80%',
      data: this.config
    });

    dialogRef.afterClosed().subscribe(result => {
      // save new settings
      if (result) {
        console.log(result);
        this.unsubscribePath();//unsub now as we will change variables so wont know what was subbed before...
        this.config = result;
        this.WidgetManagerService.updateWidgetConfig(this.widgetUUID, this.config);
        this.subscribePath();
      }

    });
  }


/* ******************************************************************************************* */
/* ******************************************************************************************* */
/* ******************************************************************************************* */
/*                                  Canvas                                                     */
/* ******************************************************************************************* */
/* ******************************************************************************************* */
/* ******************************************************************************************* */

  updateCanvas() {
    if (this.canvasCtx) {
      this.canvasCtx.clearRect(0,0,this.canvasEl.nativeElement.width, this.canvasEl.nativeElement.height);
      this.drawValue();
    }
  }

  updateCanvasBG() {
    if (this.canvasBGCtx) {
      this.canvasBGCtx.clearRect(0,0,this.canvasEl.nativeElement.width, this.canvasEl.nativeElement.height);
      this.drawTitle();
    }
  }

  drawValue() {
    let maxTextWidth = Math.floor(this.canvasEl.nativeElement.width - (this.canvasEl.nativeElement.width * 0.15));
    let maxTextHeight = Math.floor(this.canvasEl.nativeElement.height - (this.canvasEl.nativeElement.height * 0.2));
    let valueText : string;

    if (isNull(this.dataValue)) {
      valueText = "--";
    } else {
      valueText = this.dataValue;
    }
    //check if length of string has changed since laste time.
    if (this.currentValueLength != valueText.length) {
      //we need to set font size...
      this.currentValueLength = valueText.length;

      //TODO: at high res.large area, this can take way too long :( (500ms+) (added skip by 10 which helps, still feel it could be better...)
      // set font small and make bigger until we hit a max.
      this.valueFontSize = 1;
      this.canvasCtx.font = "bold " + this.valueFontSize.toString() + "px Arial"; // need to init it so we do loop at least once :)
      //first increase fontsize by 10, skips lots of loops.
      while ( (this.canvasCtx.measureText(valueText).width < maxTextWidth) && (this.valueFontSize < maxTextHeight)) {
        this.valueFontSize = this.valueFontSize + 10;
        this.canvasCtx.font = "bold " + this.valueFontSize.toString() + "px Arial";
      }
      // now decrease by 1 to find the right size
      while ( (this.canvasCtx.measureText(valueText).width < maxTextWidth) && (this.valueFontSize < maxTextHeight)) {
        this.valueFontSize--;
        this.canvasCtx.font = "bold " + this.valueFontSize.toString() + "px Arial";
      }
    }

    this.canvasCtx.font = "bold " + this.valueFontSize.toString() + "px Arial";
    this.canvasCtx.textAlign = "center";
    this.canvasCtx.textBaseline="middle";
    this.canvasCtx.fillStyle = window.getComputedStyle(this.wrapperDiv.nativeElement).color;
    this.canvasCtx.fillText(valueText,this.canvasEl.nativeElement.width/2,(this.canvasEl.nativeElement.height/2)+(this.valueFontSize/15), maxTextWidth);
  }

  drawTitle() {
    var maxTextWidth = Math.floor(this.canvasEl.nativeElement.width - (this.canvasEl.nativeElement.width * 0.2));
    var maxTextHeight = Math.floor(this.canvasEl.nativeElement.height - (this.canvasEl.nativeElement.height * 0.8));
    // set font small and make bigger until we hit a max.
    if (this.config.displayName === null) { return; }
    var fontSize = 1;

    this.canvasBGCtx.font = "bold " + fontSize.toString() + "px Arial"; // need to init it so we do loop at least once :)
    while ( (this.canvasBGCtx.measureText(this.config.displayName).width < maxTextWidth) && (fontSize < maxTextHeight)) {
        fontSize++;
        this.canvasBGCtx.font = "bold " + fontSize.toString() + "px Arial";
    }

    this.canvasBGCtx.textAlign = "left";
    this.canvasBGCtx.textBaseline="top";
    this.canvasBGCtx.fillStyle = window.getComputedStyle(this.wrapperDiv.nativeElement).color;
    this.canvasBGCtx.fillText(this.config.displayName,this.canvasEl.nativeElement.width*0.03,this.canvasEl.nativeElement.height*0.03, maxTextWidth);
  }




}
