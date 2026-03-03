import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ViewChild, ElementRef, ChangeDetectorRef, AfterViewInit } from '@angular/core';
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
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { CssStyle } from '@int/geotoolkit/css/CssStyle';



export interface ITimeCurve {
  mnemonicId: string;
  mnemonic?: string; // For backward compatibility
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

  // Widget and data properties
  wellLogWidget: WellLogWidget | null = null;
  wellboreObjects: ITimeWellboreObject[] = [];
  showLoading: boolean = false;
  isLiveTracking: boolean = false;
  
  // Time-based data properties
  indexCurveTime: number[] = [];
  indexCurveTimeDepthForShowMarker: number[] = [];
  private curveTimeIndices: Map<string, number[]> = new Map();
  private trackMap: Map<number, LogTrack> = new Map();
  loadedTimeRanges: Map<string, { min: number, max: number }> = new Map();
  
  // Subscriptions
  private subscriptions: any[] = [];

  constructor(
    private timeBasedLogService: TimeBasedLogService,
    private timeBasedThemeService: TimeBasedThemeService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    console.log('🎯 TimeBasedTracksComponent initialized');
    console.log('🎯 Inputs:', {
      wellId: this.wellId,
      wellboreId: this.wellboreId,
      trackCount: this.listOfTracks.length,
      selectedScale: this.selectedScale,
      isDarkTheme: this.isDarkTheme,
      selectedHour: this.selectedHour
    });
    
    // Fetch log headers first
    this.fetchLogHeaders();
  }

  ngAfterViewInit(): void {
    console.log('🎯 TimeBasedTracksComponent view initialized');
    // Try to initialize widget now that view is ready
    this.tryInitializeWidget();
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private cleanup(): void {
    // Clean up widget
    if (this.wellLogWidget) {
      try {
        this.wellLogWidget.dispose();
      } catch (error) {
        console.warn('⚠️ Error disposing widget:', error);
      }
      this.wellLogWidget = null;
    }

    // Clean up subscriptions
    this.subscriptions.forEach(sub => {
      if (sub && sub.unsubscribe) {
        sub.unsubscribe();
      }
    });
    this.subscriptions = [];
  }

  /**
   * Tries to initialize the widget when both headers and widget component are available
   */
  private tryInitializeWidget(): void {
    if (!this.widgetComponent) {
      console.log('⏳ Widget component not ready yet, will try again after headers load...');
      return;
    }

    if (!this.wellboreObjects || this.wellboreObjects.length === 0) {
      console.log('⏳ Headers not loaded yet, will try again after headers load...');
      return;
    }

    if (this.wellLogWidget) {
      console.log('ℹ️ Widget already initialized, skipping...');
      return;
    }

    console.log('🎯 Both headers and widget component ready - initializing widget...');
    this.initializeWidget();
  }

  /**
   * Fetches time-based log headers
   */
  private fetchLogHeaders(): void {
    console.log('🔄 Fetching time-based log headers...');
    this.showLoading = true;

    this.timeBasedLogService.getTimeLogHeaders(this.wellId, this.wellboreId).subscribe(
      (headers: ITimeWellboreObject[]) => {
        console.log('✅ Time-based log headers loaded:', headers);
        this.showLoading = false;
        
        if (headers && headers.length > 0) {
          this.wellboreObjects = headers.map(header => ({
            ...header,
            isDepth: false, // This is time-based data
            objectInfo: this.generateCurveInfo(header)
          }));
          
          this.headersLoaded.emit(this.wellboreObjects);
          
          // Try to initialize widget if component is available
          this.tryInitializeWidget();
        } else {
          console.warn('⚠️ No headers found');
        }
      },
      (error) => {
        console.error('❌ Error fetching time-based log headers:', error);
        this.showLoading = false;
      }
    );
  }

  /**
   * Generates curve info from header
   */
  private generateCurveInfo(header: ITimeWellboreObject): ITimeCurve[] {
    const mnemonics = header.mnemonicList.split(',');
    return mnemonics.map((mnemonic: string) => ({
      mnemonicId: mnemonic.trim(),
      data: [],
      color: this.timeBasedThemeService.getCurveColor(0),
      lineWidth: 1,
      visible: true
    }));
  }

  /**
   * Initializes the widget
   */
  private initializeWidget(): void {
    if (!this.widgetComponent) {
      console.warn('⚠️ Widget component not available');
      return;
    }

    try {
      console.log('🎯 Creating time-based WellLogWidget...');
      
      // Create widget using time-based service
      this.wellLogWidget = this.timeBasedLogService.createWellLogWidget(this.widgetComponent.Canvas.nativeElement);
      
      // Assign widget to BaseWidgetComponent
      this.widgetComponent.Widget = this.wellLogWidget;
      
      console.log('✅ Widget assigned to BaseWidgetComponent');
      
      // Apply theme
      this.timeBasedThemeService.applyGeoToolkitTheme(this.wellLogWidget, this.isDarkTheme);
      
      // Create tracks
      this.createTracks();
      
      // Load data
      this.loadData();
      
    } catch (error) {
      console.error('❌ Error initializing widget:', error);
    }
  }

  /**
   * Creates tracks for the widget
   */
  private createTracks(): void {
    if (!this.wellLogWidget) {
      console.warn('⚠️ Widget not available for track creation');
      return;
    }

    console.log('🎯 Creating time-based tracks...');
    
    // Create index track
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    if (indexTrack) {
      indexTrack.setName('Time Index');
      indexTrack.setWidth(80);
      console.log('✅ Time-based index track created');
    }

    // Create data tracks
    this.listOfTracks.forEach((trackInfo, trackIndex) => {
      try {
        const logTrack = this.wellLogWidget!.addTrack(TrackType.LinearTrack);
        if (logTrack) {
          logTrack.setName(trackInfo.trackTitle);
          logTrack.setWidth(trackInfo.width || 100);
          // Store track reference for later curve addition
          this.trackMap.set(trackIndex, logTrack);
          console.log(`✅ Time-based data track created: ${trackInfo.trackName}`);
        }
      } catch (error) {
        console.error(`❌ Error creating track ${trackInfo.trackName}:`, error);
      }
    });
    
    console.log('✅ Time-based tracks created successfully');
  }

  /**
   * Loads data for all tracks
   */
  private loadData(): void {
    if (!this.wellLogWidget || this.wellboreObjects.length === 0) {
      console.warn('⚠️ Cannot load data - widget or headers not available');
      return;
    }

    console.log('🔄 Loading time-based data...');
    
    // Load data for each wellbore object
    this.wellboreObjects.forEach((wellboreObject, index) => {
      this.loadLogData(wellboreObject, index);
    });
  }

  /**
   * Loads log data for a specific wellbore object
   */
  private loadLogData(selectedlogObject: ITimeWellboreObject, logIndex: number): void {
    console.log(`🔄 Loading data for ${selectedlogObject.name}...`);
    
    const queryParameter: ILogDataQueryParameter = {
      wellUid: this.wellId,
      logUid: selectedlogObject.uid,
      wellboreUid: this.wellboreId,
      logName: selectedlogObject.name,
      indexType: selectedlogObject.indexType,
      indexCurve: selectedlogObject.indexCurve,
      startIndex: selectedlogObject.startIndex,
      endIndex: selectedlogObject.endIndex,
      isGrowing: selectedlogObject.isGrowing,
      mnemonicList: selectedlogObject.mnemonicList
    };

    this.timeBasedLogService.getLogData(queryParameter).subscribe(
      (response: any) => {
        this.processLogDataResponse(response, selectedlogObject, logIndex, false);
      },
      (error) => {
        console.error('❌ Error retrieving time-based log data:', error);
      }
    );
  }

  /**
   * Processes log data response following generate-canvas-tracks pattern
   */
  private processLogDataResponse(response: any, selectedlogObject: ITimeWellboreObject, logIndex: number, isLiveData: boolean): void {
    console.log('🔄 Processing log data response using time-based service pattern');
    console.log('📊 Response structure:', response);
    
    // Handle time-based service response structure: {indexData: [...], curveData: {...}}
    if (!response || !response.indexData || !response.curveData) {
      console.error('❌ Invalid time-based response structure:', response);
      return;
    }
    
    // Convert time-based service response to LogData format
    // The curveData is an object with curve names as keys and arrays as values
    const curveData = response.curveData;
    const timeData = response.indexData;
    
    // Dynamically get mnemonics from curveData keys
    const dataMnemonics = Object.keys(curveData);
    // Remove TIME from dataMnemonics if it exists to avoid duplication
    const filteredMnemonics = dataMnemonics.filter(m => m !== 'TIME');
    const allMnemonics = ['TIME', ...filteredMnemonics];
    
    // Create CSV data format from the parsed curve data
    const csvData: string[] = [];
    for (let i = 0; i < timeData.length; i++) {
      const row = [
        timeData[i].toString(),
        ...filteredMnemonics.map(mnemonic => (curveData[mnemonic]?.[i] || 0).toString())
      ].join(',');
      csvData.push(row);
    }
    
    const logData: LogData = {
      mnemonicList: allMnemonics.join(','),
      data: csvData
    };
    
    console.log('📋 Time-based LogData structure:', {
      mnemonicList: logData.mnemonicList,
      dataRows: logData.data?.length || 0,
      firstDataRow: logData.data?.[0],
      curveDataKeys: Object.keys(curveData)
    });
    
    // Parse data for each curve in the track
    this.listOfTracks.forEach(track => {
      track.curves.forEach(curve => {
        console.log(`🔍 About to parse curve: ${curve.mnemonicId}`);
        this.parseCurveData(logData, curve, false);
      });
    });
    
    console.log('✅ Time-based data processed successfully');
    
    // Now add the parsed curves to the GeoToolkit widget tracks
    this.addCurvesToWidget();
  }

  /**
   * Parses curve data following the same pattern as generate-canvas-tracks
   */
  private parseCurveData(logData: LogData, curve: ITimeCurve, decrementPending: boolean = true): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex(m => m.trim() === curve.mnemonicId);
    const timeIndex = mnemonics.findIndex(m => m.trim() === 'TIME');
    
    console.log(`🔍 Parsing ${curve.mnemonicId}:`, {
      availableMnemonics: mnemonics,
      curveIndex,
      timeIndex,
      dataRows: logData.data?.length || 0
    });
    
    if (curveIndex === -1) {
      console.warn('⚠️ Mnemonic not found:', curve.mnemonicId);
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
    
    // Store time indices for the curve
    this.curveTimeIndices.set(curve.mnemonicId, times);

    // Track loaded range
    if (times.length > 0) {
      this.loadedTimeRanges.set(curve.mnemonicId, {
        min: times[0],
        max: times[times.length - 1],
      });
    }

    console.log('✅ Parsed data for curve:', curve.mnemonicId, values.length, 'points',
      times.length > 0 ? `time range: ${times[0]}-${times[times.length - 1]}` : '');
  }

  // Event handlers
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

  onHeadersLoaded(headers: any[]): void {
    console.log('🕐 Headers loaded:', headers);
  }

  // Additional methods needed by HTML template
  toggleTheme(): void {
    this.onThemeChange(!this.isDarkTheme);
  }

  startLivePolling(): void {
    console.log('🔄 Starting live polling...');
    this.isLiveTracking = true;
    // TODO: Implement live polling logic
  }

  stopLivePolling(): void {
    console.log('⏹️ Stopping live polling...');
    this.isLiveTracking = false;
    // TODO: Implement stop polling logic
  }

  // Utility methods
  formatDateTimeForInput(date: Date | number): string {
    if (!date) return '';
    
    // Convert number timestamp to Date if needed
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
    if (!this.indexCurveTime || this.indexCurveTime.length < 2) return '0:00:00';
    const startTime = this.indexCurveTime[0];
    const endTime = this.indexCurveTime[this.indexCurveTime.length - 1];
    const duration = endTime - startTime;
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  calculateDataPointsPerHour(): number {
    if (!this.indexCurveTime || this.indexCurveTime.length < 2) return 0;
    const startTime = this.indexCurveTime[0];
    const endTime = this.indexCurveTime[this.indexCurveTime.length - 1];
    const durationHours = (endTime - startTime) / 3600000;
    return Math.round(this.indexCurveTime.length / durationHours);
  }

  applyCustomTimeRange(startTime: string, endTime: string): void {
    if (!startTime || !endTime) return;
    
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    
    if (isNaN(start) || isNaN(end) || start >= end) {
      console.warn('⚠️ Invalid time range:', startTime, endTime);
      return;
    }
    
    // Apply the custom time range to the widget
    if (this.wellLogWidget) {
      this.wellLogWidget.setVisibleDepthLimits(start, end);
      console.log(`🎯 Applied custom time range: ${startTime} to ${endTime}`);
    }
  }

  getCurveColor(trackIndex: number): string {
    return this.timeBasedThemeService.getCurveColor(trackIndex);
  }

  /**
   * Adds parsed curves to the GeoToolkit widget tracks
   */
  private addCurvesToWidget(): void {
    if (!this.wellLogWidget) {
      console.error('❌ WellLogWidget not available for adding curves');
      return;
    }

    console.log('🎯 Adding curves to GeoToolkit widget tracks...');
    console.log(`📊 Found ${this.trackMap.size} tracks in map`);

    this.listOfTracks.forEach((trackInfo, trackIndex) => {
      const track = this.trackMap.get(trackIndex);
      
      if (track) {
        console.log(`🎯 Processing track ${trackInfo.trackName} (index: ${trackIndex})`);
        
        trackInfo.curves.forEach((curveInfo, curveIndex) => {
          if (curveInfo.data && curveInfo.data.length > 0) {
            try {
              // Get time indices for this curve
              const indexData = this.curveTimeIndices.get(curveInfo.mnemonicId) || [];

              // Create GeoLogData
              const geoLogData = new GeoLogData(curveInfo.mnemonicId);
              geoLogData.setValues(indexData, curveInfo.data);

              // Create LogCurve
              const curve = new LogCurve(geoLogData);
              curve.setLineStyle({
                color: curveInfo.color || '#63b3ed',
                width: curveInfo.lineWidth || 1,
              });
              curve.setName(curveInfo.mnemonicId);

              // Add curve to track
              track.addChild(curve);
              console.log(`✅ Added curve ${curveInfo.mnemonicId} to track ${trackInfo.trackName} with ${curveInfo.data.length} points`);
            } catch (error) {
              console.error(`❌ Error adding curve ${curveInfo.mnemonicId}:`, error);
            }
          } else {
            console.warn(`⚠️ No data available for curve ${curveInfo.mnemonicId}`);
          }
        });
      } else {
        console.error(`❌ Track not found for index ${trackIndex}`);
      }
    });

    console.log('✅ All curves added to widget tracks');
    
    // Set visible range to show the data using time data from curves
    let minTime = 0;
    let maxTime = 0;
    
    // Get time range from any of the parsed curves
    for (const [mnemonic, times] of this.curveTimeIndices.entries()) {
      if (times.length > 0) {
        const curveMin = times[0];
        const curveMax = times[times.length - 1];
        
        if (minTime === 0 || curveMin < minTime) {
          minTime = curveMin;
        }
        if (maxTime === 0 || curveMax > maxTime) {
          maxTime = curveMax;
        }
        break; // Use first curve with data
      }
    }
    
    if (minTime > 0 && maxTime > 0) {
      const range = maxTime - minTime;
      
      // First set the overall depth limits of the widget
      this.wellLogWidget.setDepthLimits(minTime, maxTime);
      console.log(`🎯 Set depth limits: ${minTime} to ${maxTime}`);
      
      // Set depth scale for proper time display (show reasonable time range)
      // For time data, we want to show maybe 1 hour per 100 pixels or similar
      const msPerPixel = 3600000 / 100; // 1 hour = 3,600,000 ms, so 36,000 ms per pixel
      this.wellLogWidget.setDepthScale(msPerPixel);
      console.log(`🎯 Set depth scale: ${msPerPixel} ms per pixel (~1 hour per 100px)`);
      
      // Then set the visible window (show a reasonable window around the data)
      const visibleMin = minTime;
      const visibleMax = maxTime + (range * 0.1); // Add 10% padding
      
      this.wellLogWidget.setVisibleDepthLimits(visibleMin, visibleMax);
      console.log(`🎯 Set visible range: ${visibleMin} to ${visibleMax} (data range: ${minTime} to ${maxTime})`);
      
      // Force widget update to render curves
      this.wellLogWidget.updateLayout();
      console.log('🔄 Widget updated to render curves');
    } else {
      console.warn('⚠️ No time data available to set visible range');
    }
  }
}
