import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { TimeBasedLogService } from './time-based-log.service';
import { TimeBasedThemeService } from './time-based-theme.service';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';

export interface ITimeCurve {
  mnemonicId: string;
  mnemonic?: string;
  data: number[];
  color?: string;
  lineWidth?: number;
  visible?: boolean;
}

export interface ITimeTrack {
  trackName: string;
  trackTitle: string;
  trackType: string;
  curves: ITimeCurve[];
  width?: number;
  isIndex?: boolean;
}

export interface ITimeWellboreObject {
  uid: string;
  name: string;
  wellId: string;
  wellboreId: string;
  indexType: string;
  indexCurve: string;
  startIndex: any;
  endIndex: any;
  indexUnit: string;
  isGrowing: boolean;
  mnemonicList: string;
  objectInfo: ITimeCurve[];
  isDepth?: boolean;
}

export interface ILogDataQueryParameter {
  wellUid: string;
  logUid: string;
  wellboreUid: string;
  logName: string;
  indexType: string;
  indexCurve: string;
  startIndex: any;
  endIndex: any;
  isGrowing: boolean;
  mnemonicList: string;
}

export interface LogData {
  mnemonicList: string;
  data: string[];
}

@Component({
  selector: 'app-time-based-tracks',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseWidgetComponent],
  providers: [TimeBasedLogService, TimeBasedThemeService],
  templateUrl: './time-based-tracks.component.html',
  styleUrls: ['./time-based-tracks.component.css']
})
export class TimeBasedTracksComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() wellId: string = '';
  @Input() wellboreId: string = '';
  @Input() listOfTracks: ITimeTrack[] = [];
  @Input() selectedScale: string = '1000';
  @Input() isDarkTheme: boolean = false;
  @Input() selectedHour: number = 24;

  @Output() scaleChange = new EventEmitter<string>();
  @Output() themeChange = new EventEmitter<boolean>();
  @Output() headersLoaded = new EventEmitter<any[]>();

  @ViewChild('widgetComponent') widgetComponent!: BaseWidgetComponent;

  wellLogWidget: WellLogWidget | null = null;
  wellboreObjects: ITimeWellboreObject[] = [];
  showLoading = false;
  isLiveTracking = false;
  indexCurveTime: number[] = [];

  private curveTimeIndices: Map<string, number[]> = new Map();
  private trackMap: Map<number, LogTrack> = new Map();
  private subscriptions: any[] = [];

  constructor(
    private timeBasedLogService: TimeBasedLogService,
    private timeBasedThemeService: TimeBasedThemeService
  ) {}

  ngOnInit(): void {
    console.log('🎯 TimeBasedTracksComponent initialized', { wellId: this.wellId, wellboreId: this.wellboreId });
    this.fetchLogHeaders();
  }

  ngAfterViewInit(): void {
    this.tryInitializeWidget();
  }

  ngOnDestroy(): void {
    if (this.wellLogWidget) {
      try { this.wellLogWidget.dispose(); } catch (_) {}
      this.wellLogWidget = null;
    }
    this.subscriptions.forEach(sub => sub?.unsubscribe?.());
    this.subscriptions = [];
  }

  private tryInitializeWidget(): void {
    if (!this.widgetComponent || !this.wellboreObjects.length || this.wellLogWidget) return;
    this.initializeWidget();
  }

  private fetchLogHeaders(): void {
    this.showLoading = true;
    this.timeBasedLogService.getTimeLogHeaders(this.wellId, this.wellboreId).subscribe(
      (headers: ITimeWellboreObject[]) => {
        this.showLoading = false;
        if (headers?.length) {
          this.wellboreObjects = headers.map(header => ({
            ...header,
            isDepth: false,
            objectInfo: this.generateCurveInfo(header)
          }));
          this.headersLoaded.emit(this.wellboreObjects);
          this.tryInitializeWidget();
        } else {
          console.warn('⚠️ No time-based headers found');
        }
      },
      (error) => {
        console.error('❌ Error fetching time-based log headers:', error);
        this.showLoading = false;
      }
    );
  }

  private generateCurveInfo(header: ITimeWellboreObject): ITimeCurve[] {
    return header.mnemonicList.split(',').map((mnemonic: string) => ({
      mnemonicId: mnemonic.trim(),
      data: [],
      color: this.timeBasedThemeService.getCurveColor(0),
      lineWidth: 1,
      visible: true
    }));
  }

  private initializeWidget(): void {
    if (!this.widgetComponent) return;

    try {
      this.wellLogWidget = this.timeBasedLogService.createWellLogWidget(this.widgetComponent.Canvas.nativeElement);
      this.widgetComponent.Widget = this.wellLogWidget;
      this.timeBasedThemeService.applyGeoToolkitTheme(this.wellLogWidget, this.isDarkTheme);
      this.createTracks();
      this.loadData();
    } catch (error) {
      console.error('❌ Error initializing widget:', error);
    }
  }

  private createTracks(): void {
    if (!this.wellLogWidget) return;

    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    if (indexTrack) {
      indexTrack.setName('Time Index');
      indexTrack.setWidth(80);
    }

    this.listOfTracks.forEach((trackInfo, trackIndex) => {
      try {
        const logTrack = this.wellLogWidget!.addTrack(TrackType.LinearTrack);
        if (logTrack) {
          logTrack.setName(trackInfo.trackTitle);
          logTrack.setWidth(trackInfo.width || 100);
          this.trackMap.set(trackIndex, logTrack);
        }
      } catch (error) {
        console.error(`❌ Error creating track ${trackInfo.trackName}:`, error);
      }
    });
  }

  private loadData(): void {
    if (!this.wellLogWidget || !this.wellboreObjects.length) return;
    this.wellboreObjects.forEach((wo) => this.loadLogData(wo));
  }

  private loadLogData(wo: ITimeWellboreObject): void {
    const queryParameter: ILogDataQueryParameter = {
      wellUid: this.wellId,
      logUid: wo.uid,
      wellboreUid: this.wellboreId,
      logName: wo.name,
      indexType: wo.indexType,
      indexCurve: wo.indexCurve,
      startIndex: wo.startIndex,
      endIndex: wo.endIndex,
      isGrowing: wo.isGrowing,
      mnemonicList: wo.mnemonicList
    };

    this.timeBasedLogService.getLogData(queryParameter).subscribe(
      (response: any) => this.processLogDataResponse(response),
      (error) => console.error('❌ Error retrieving time-based log data:', error)
    );
  }

  private processLogDataResponse(response: any): void {
    if (!response?.indexData || !response?.curveData) {
      console.error('❌ Invalid time-based response structure:', response);
      return;
    }

    const curveData = response.curveData;
    const timeData = response.indexData;
    const filteredMnemonics = Object.keys(curveData).filter(m => m !== 'TIME');
    const allMnemonics = ['TIME', ...filteredMnemonics];

    // Build CSV-style rows for parsing
    const csvData: string[] = [];
    for (let i = 0; i < timeData.length; i++) {
      csvData.push([
        timeData[i].toString(),
        ...filteredMnemonics.map(m => (curveData[m]?.[i] || 0).toString())
      ].join(','));
    }

    const logData: LogData = { mnemonicList: allMnemonics.join(','), data: csvData };

    console.log('📋 LogData:', { mnemonics: logData.mnemonicList, rows: logData.data.length });

    this.listOfTracks.forEach(track => {
      track.curves.forEach(curve => this.parseCurveData(logData, curve));
    });

    this.addCurvesToWidget();
  }

  private parseCurveData(logData: LogData, curve: ITimeCurve): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex(m => m.trim() === curve.mnemonicId);
    const timeIndex = mnemonics.findIndex(m => m.trim() === 'TIME');

    if (curveIndex === -1) {
      console.warn(`⚠️ Mnemonic not found: ${curve.mnemonicId}`);
      return;
    }

    const times: number[] = [];
    const values: number[] = [];

    logData.data.forEach((dataRow) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const value = parseFloat(cols[curveIndex]);
        const time = timeIndex >= 0 ? parseFloat(cols[timeIndex]) : NaN;
        if (!isNaN(value) && !isNaN(time)) {
          times.push(time);
          values.push(value);
        }
      }
    });

    curve.data = values;
    this.curveTimeIndices.set(curve.mnemonicId, times);

    console.log(`✅ Parsed ${curve.mnemonicId}: ${values.length} points`);
  }

  private addCurvesToWidget(): void {
    if (!this.wellLogWidget) return;

    this.listOfTracks.forEach((trackInfo, trackIndex) => {
      const track = this.trackMap.get(trackIndex);
      if (!track) return;

      trackInfo.curves.forEach((curveInfo) => {
        if (!curveInfo.data?.length) return;

        try {
          const indexData = this.curveTimeIndices.get(curveInfo.mnemonicId) || [];
          const geoLogData = new GeoLogData(curveInfo.mnemonicId);
          geoLogData.setValues(indexData, curveInfo.data);

          const curve = new LogCurve(geoLogData);
          curve.setLineStyle({ color: curveInfo.color || '#63b3ed', width: curveInfo.lineWidth || 1 });
          curve.setName(curveInfo.mnemonicId);
          track.addChild(curve);
        } catch (error) {
          console.error(`❌ Error adding curve ${curveInfo.mnemonicId}:`, error);
        }
      });
    });

    this.configureWidgetLimits();
  }

  private configureWidgetLimits(): void {
    if (!this.wellLogWidget) return;

    const { minTime, maxTime } = this.getTimeRange();
    if (minTime === 0 || maxTime === 0) {
      console.warn('⚠️ No time data available to set visible range');
      return;
    }

    // Store index curve times for template statistics
    const firstCurveTimes = this.curveTimeIndices.values().next().value;
    if (firstCurveTimes) {
      this.indexCurveTime = firstCurveTimes;
    }

    // Set full scrollable range
    this.wellLogWidget.setDepthLimits(minTime, maxTime);

    // Set depth scale (~1 hour per 100px)
    this.wellLogWidget.setDepthScale(3600000 / 100);

    // Show a 4-hour visible window starting from the beginning
    const visibleMax = Math.min(minTime + 4 * 3600000, maxTime);
    this.wellLogWidget.setVisibleDepthLimits(minTime, visibleMax);

    this.wellLogWidget.updateLayout();

    console.log(`🎯 Widget configured: depth=[${minTime}, ${maxTime}], visible=[${minTime}, ${visibleMax}]`);
  }

  private getTimeRange(): { minTime: number; maxTime: number } {
    let minTime = 0;
    let maxTime = 0;
    for (const times of this.curveTimeIndices.values()) {
      if (times.length > 0) {
        const curveMin = times[0];
        const curveMax = times[times.length - 1];
        if (minTime === 0 || curveMin < minTime) minTime = curveMin;
        if (maxTime === 0 || curveMax > maxTime) maxTime = curveMax;
      }
    }
    return { minTime, maxTime };
  }

  // --- Template event handlers ---

  onScaleChange(newScale: string): void {
    this.selectedScale = newScale;
    this.scaleChange.emit(newScale);
  }

  onThemeChange(isDark: boolean): void {
    this.isDarkTheme = isDark;
    this.themeChange.emit(isDark);
    if (this.wellLogWidget) {
      this.timeBasedThemeService.applyGeoToolkitTheme(this.wellLogWidget, isDark);
    }
  }

  toggleTheme(): void {
    this.onThemeChange(!this.isDarkTheme);
  }

  startLivePolling(): void {
    this.isLiveTracking = true;
    // TODO: Implement live polling logic
  }

  stopLivePolling(): void {
    this.isLiveTracking = false;
    // TODO: Implement stop polling logic
  }

  // --- Template utility methods ---

  formatDateTimeForInput(date: Date | number): string {
    if (!date) return '';
    const dateObj = typeof date === 'number' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  calculateDuration(): string {
    if (this.indexCurveTime.length < 2) return '0:00:00';
    const duration = this.indexCurveTime[this.indexCurveTime.length - 1] - this.indexCurveTime[0];
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  calculateDataPointsPerHour(): number {
    if (this.indexCurveTime.length < 2) return 0;
    const durationHours = (this.indexCurveTime[this.indexCurveTime.length - 1] - this.indexCurveTime[0]) / 3600000;
    return Math.round(this.indexCurveTime.length / durationHours);
  }

  applyCustomTimeRange(startTime: string, endTime: string): void {
    if (!startTime || !endTime) return;
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (isNaN(start) || isNaN(end) || start >= end) return;
    this.wellLogWidget?.setVisibleDepthLimits(start, end);
  }

  getCurveColor(trackIndex: number): string {
    return this.timeBasedThemeService.getCurveColor(trackIndex);
  }
}
