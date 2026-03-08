import { Component, OnInit, OnDestroy, Input, ViewChild, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { TimeBasedLogService } from './time-based-log.service';
import { TimeBasedThemeService } from './time-based-theme.service';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { TimeBasedToolbarComponent } from './time-based-toolbar/time-based-toolbar.component';
import { AdaptiveTickGenerator } from '@int/geotoolkit/axis/AdaptiveTickGenerator';
import { LogAxis } from '@int/geotoolkit/welllog/LogAxis';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';

export interface ITimeCurve {
  mnemonicId: string;
  mnemonic?: string;
  data: number[];
  color?: string;
  lineWidth?: number;
  visible?: boolean;
  LogId?: string;
}

export interface ITimeTrack {
  trackNo: number;
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

export interface ILogDataResponse {
  mnemonicList: string;
  data: string[];
}

@Component({
  selector: 'app-time-based-tracks',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseWidgetComponent, TimeBasedToolbarComponent],
  providers: [TimeBasedLogService, TimeBasedThemeService],
  templateUrl: './time-based-tracks.component.html',
  styleUrls: ['./time-based-tracks.component.css']
})
export class TimeBasedTracksComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() wellId: string = '';
  @Input() wellboreId: string = '';
  @Input() listOfTracks: ITimeTrack[] = [];

  /** Internal component state - accessible by template */
  protected selectedScale: string = '1000';
  protected isDarkTheme: boolean = false;
  protected selectedHour: number = 24;

  @ViewChild('widgetComponent') widgetComponent!: BaseWidgetComponent;

  wellLogWidget: WellLogWidget | null = null;
  wellboreObjects: ITimeWellboreObject[] = [];
  showLoading = false;
  isLiveTracking = false;
  indexCurveTime: number[] = [];
  latestTimestamp: number = 0;

  private curveTimeIndices: Map<string, number[]> = new Map();
  private trackMap: Map<number, LogTrack> = new Map();
  private scrollPollHandle: any = null;
  private lastVisibleMin = -1;
  private lastVisibleMax = -1;
  private subscriptions: any[] = [];

  constructor(
    private timeBasedLogService: TimeBasedLogService,
    private timeBasedThemeService: TimeBasedThemeService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    console.log('🎯 TimeBasedTracksComponent initialized', { wellId: this.wellId, wellboreId: this.wellboreId });
    this.fetchLogHeaders();
  }

  ngAfterViewInit(): void {
    this.tryInitializeWidget();
  }

  ngOnDestroy(): void {
    this.stopScrollPolling();
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
          this.wellboreObjects = headers.map(header => {
            const wellboreObject: ITimeWellboreObject = {
              ...header,
              isDepth: false,
              objectInfo: this.generateCurveInfo(header)
            };
            
            // Set the LogId from the first curve that has one (or use header uid as fallback)
            const firstCurveWithLogId = this.listOfTracks
              .flatMap(track => track.curves)
              .find(curve => curve.LogId);
            
            if (firstCurveWithLogId) {
              wellboreObject.uid = firstCurveWithLogId.LogId!;
            }
            
            return wellboreObject;
          });
          console.log('🕐 Headers loaded internally:', this.wellboreObjects);
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
    return header.mnemonicList.split(',').map((mnemonic: string) => {
      // Find the curve in listOfTracks to get its LogId
      let curveLogId = header.uid; // Default to header uid
      for (const track of this.listOfTracks) {
        const curve = track.curves.find(c => c.mnemonicId === mnemonic.trim());
        if (curve && curve.LogId) {
          curveLogId = curve.LogId;
          break;
        }
      }
      
      return {
        mnemonicId: mnemonic.trim(),
        data: [],
        color: this.timeBasedThemeService.getCurveColor(0),
        lineWidth: 1,
        visible: true,
        LogId: curveLogId
      };
    });
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
      indexTrack.setWidth(150);

      // Find the existing axis on the index track and replace its tick generator
      const childCount = indexTrack.getChildrenCount();
      for (let i = 0; i < childCount; i++) {
        const child = indexTrack.getChild(i);
        if (child instanceof LogAxis) {
          const tickGen = new AdaptiveTickGenerator({
            'spacing': 3 * 3600000 // 2 hours in milliseconds
          });
          tickGen.setFormatLabelHandler((tickGenerator: any, parent: any, orientation: any, tickInfo: any, tickIndex: number, value: number) => {
            const date = new Date(value);
            if (isNaN(date.getTime())) return '';
            let hours = date.getHours();
            const minutes = date.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            const min = minutes.toString().padStart(2, '0');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = monthNames[date.getMonth()];
            const day = date.getDate();
            return `${month} ${day} ${hours}:${min} ${ampm}`;
          });
          child.setTickGenerator(tickGen);
          break;
        }
      }
    }

    // Sort tracks by trackNo to ensure proper ordering
    const sortedTracks = [...this.listOfTracks].sort((a, b) => a.trackNo - b.trackNo);
    
    console.log('🎵 Creating tracks in order:');
    sortedTracks.forEach((trackInfo) => {
      console.log(`  - Creating track ${trackInfo.trackNo}: ${trackInfo.trackTitle}`);
    });
    
    sortedTracks.forEach((trackInfo) => {
      try {
        const logTrack = this.wellLogWidget!.addTrack(TrackType.LinearTrack);
        if (logTrack) {
          logTrack.setName(trackInfo.trackTitle);
          logTrack.setWidth(trackInfo.width || 100);
          this.trackMap.set(trackInfo.trackNo, logTrack);
          console.log(`✅ Created track ${trackInfo.trackNo}: ${trackInfo.trackTitle}`);
        }
      } catch (error) {
        console.error(`❌ Error creating track ${trackInfo.trackName} (trackNo: ${trackInfo.trackNo}):`, error);
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

    const logData: ILogDataResponse = { mnemonicList: allMnemonics.join(','), data: csvData };

    console.log('📋 LogData:', { mnemonics: logData.mnemonicList, rows: logData.data.length });

    this.listOfTracks.forEach(track => {
      track.curves.forEach(curve => this.parseCurveData(logData, curve));
    });

    this.addCurvesToWidget();
  }

  private parseCurveData(logData: ILogDataResponse, curve: ITimeCurve): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex((m: string) => m.trim() === curve.mnemonicId);
    const timeIndex = mnemonics.findIndex((m: string) => m.trim() === 'TIME');

    console.log(`🔍 Processing curve ${curve.mnemonicId}: curveIndex=${curveIndex}, timeIndex=${timeIndex}`);
    console.log(`🔍 Available mnemonics: ${mnemonics.join(', ')}`);

    if (curveIndex === -1) {
      console.warn(`⚠️ Mnemonic not found: ${curve.mnemonicId}`);
      return;
    }

    const times: number[] = [];
    const values: number[] = [];

    logData.data.forEach((dataRow: string) => {
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

    // Add value range debugging for NPHI
    if (curve.mnemonicId === 'NPHI') {
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const avgValue = values.reduce((a, b) => a + b, 0) / values.length;
      console.log(`📈 NPHI Statistics: min=${minValue.toFixed(3)}, max=${maxValue.toFixed(3)}, avg=${avgValue.toFixed(3)}`);
    }

    console.log(`✅ Parsed ${curve.mnemonicId}: ${values.length} points (first value: ${values[0] || 'N/A'})`);
  }

  private addCurvesToWidget(): void {
    if (!this.wellLogWidget) return;

    // Sort tracks by trackNo to ensure proper ordering
    const sortedTracks = [...this.listOfTracks].sort((a, b) => a.trackNo - b.trackNo);
    
    sortedTracks.forEach((trackInfo) => {
      const track = this.trackMap.get(trackInfo.trackNo);
      if (!track) {
        console.warn(`⚠️ Track not found for trackNo: ${trackInfo.trackNo}, trackName: ${trackInfo.trackName}`);
        return;
      }

      console.log(`🎯 Adding curves to track ${trackInfo.trackNo}: ${trackInfo.trackTitle}`);
      console.log(`🎯 Available curves: ${trackInfo.curves.map(c => c.mnemonicId).join(', ')}`);

      trackInfo.curves.forEach((curveInfo) => {
        console.log(`🔍 Checking curve ${curveInfo.mnemonicId}: data length=${curveInfo.data?.length || 0}, visible=${curveInfo.visible}`);
        
        if (!curveInfo.data?.length) {
          console.warn(`⚠️ No data for curve ${curveInfo.mnemonicId} in track ${trackInfo.trackNo}`);
          return;
        }

        try {
          const indexData = this.curveTimeIndices.get(curveInfo.mnemonicId) || [];
          const geoLogData = new GeoLogData(curveInfo.mnemonicId);
          geoLogData.setValues(indexData, curveInfo.data);

          const curve = new LogCurve(geoLogData);
          curve.setLineStyle({ color: curveInfo.color || '#63b3ed', width: curveInfo.lineWidth || 1 });
          curve.setName(curveInfo.mnemonicId);
          track.addChild(curve);
          
          console.log(`✅ Added curve ${curveInfo.mnemonicId} to track ${trackInfo.trackNo} with ${curveInfo.data.length} points`);
        } catch (error) {
          console.error(`❌ Error adding curve ${curveInfo.mnemonicId} to track ${trackInfo.trackName}:`, error);
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
    console.log('🕐 Scale changed internally to:', newScale);

    if (!this.wellLogWidget) return;

    const { minTime, maxTime } = this.getTimeRange();
    if (minTime === 0 || maxTime === 0) return;

    const scaleHours = parseFloat(newScale);

    if (scaleHours === 0) {
      // Fit to full data range
      this.wellLogWidget.setVisibleDepthLimits(minTime, maxTime);
    } else {
      // Show selected hours ending at the most recent data
      const windowMs = scaleHours * 3600000; // Convert hours to milliseconds
      const visibleMin = Math.max(maxTime - windowMs, minTime);
      this.wellLogWidget.setVisibleDepthLimits(visibleMin, maxTime);
    }

    this.wellLogWidget.updateLayout();
    console.log(`🕐 Scale changed to ${scaleHours} hours, visible range: ${new Date(maxTime - (scaleHours * 3600000)).toISOString()} to ${new Date(maxTime).toISOString()}`);
  }

  onThemeChange(isDark: boolean): void {
    this.isDarkTheme = isDark;
    console.log('🕐 Theme changed internally to:', isDark ? 'dark' : 'light');
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

  // --- Toolbar methods ---

  onResetView(): void {
    if (!this.wellLogWidget) return;
    const { minTime, maxTime } = this.getTimeRange();
    if (minTime === 0 || maxTime === 0) return;
    
    // Show most recent data like on initial load (1 day window)
    const scaleDays = parseFloat(this.selectedScale) || 1;
    const windowMs = scaleDays * 24 * 3600000; // Convert days to milliseconds
    const visibleMin = Math.max(maxTime - windowMs, minTime);
    this.wellLogWidget.setVisibleDepthLimits(visibleMin, maxTime);
    this.wellLogWidget.updateLayout();
  }

  onScrollToLatest(): void {
    if (!this.wellLogWidget) return;
    const { minTime, maxTime } = this.getTimeRange();
    if (minTime === 0 || maxTime === 0) return;
    const scaleDays = parseFloat(this.selectedScale) || 1;
    const windowMs = scaleDays * 24 * 3600000; // Convert days to milliseconds
    const visibleMin = Math.max(maxTime - windowMs, minTime);
    this.wellLogWidget.setVisibleDepthLimits(visibleMin, maxTime);
    this.wellLogWidget.updateLayout();
  }

  onZoomIn(): void {
    if (!this.wellLogWidget) return;
    
    // Get current scale and make it larger (more detail)
    const currentScale = this.wellLogWidget.getDepthScale();
    const newScale = currentScale * 1.5; // 50% zoom in
    
    // Set maximum scale limit to prevent over-zooming
    const maxScale = 100000; // Maximum time units per pixel (adjust as needed)
    const finalScale = Math.min(newScale, maxScale);
    
    this.wellLogWidget.setDepthScale(finalScale);
    this.wellLogWidget.updateLayout();
    console.log('🔍 Zoomed in:', { oldScale: currentScale, newScale: finalScale, maxScale });
  }

  onZoomOut(): void {
    if (!this.wellLogWidget) return;
    
    // Get current scale and make it smaller (less detail)
    const currentScale = this.wellLogWidget.getDepthScale();
    const newScale = currentScale * 0.67; // 33% zoom out
    
    // Set minimum scale limit to prevent over-shrinking
    const minScale = 1000; // Minimum time units per pixel (adjust as needed)
    const finalScale = Math.max(newScale, minScale);
    
    this.wellLogWidget.setDepthScale(finalScale);
    this.wellLogWidget.updateLayout();
    console.log('🔍 Zoomed out:', { oldScale: currentScale, newScale: finalScale, minScale });
  }

  
  onEditToggle(enabled: boolean): void {
    console.log('✏️ Edit mode:', enabled);
    // TODO: Enable/disable annotation tool on the widget
  }

  onToolbarColorChange(color: string): void {
    console.log('🎨 Color changed:', color);
    // TODO: Apply color to selected track/curve
  }

  onRigTimeToggle(enabled: boolean): void {
    console.log('🕐 Rig Time:', enabled);
    // TODO: Toggle rig time display
  }

  onTimeRangeChange(range: {start: string, end: string}): void {
    // Handle custom time range from toolbar
    console.log('📅 Custom time range:', range);
    this.applyCustomTimeRange(range.start, range.end);
  }

  private stopScrollPolling(): void {
    if (this.scrollPollHandle) {
      clearInterval(this.scrollPollHandle);
      this.scrollPollHandle = null;
      console.log('⏹️ Stopped scroll polling');
    }
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
