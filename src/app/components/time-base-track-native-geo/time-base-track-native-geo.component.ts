import { Component, Input, OnInit, OnDestroy, ViewChild, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { TimeBasedLogService } from '../time-based-tracks/time-based-log.service';
import { TimeBasedThemeService } from '../time-based-tracks/time-based-theme.service';
import { ITimeWellboreObject, ITimeCurve, ITimeTrack } from '../time-based-tracks/time-based-tracks.component';
import { TimeBasedToolbarComponent } from '../time-based-tracks/time-based-toolbar/time-based-toolbar.component';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { Iterator } from '@int/geotoolkit/util/iterator';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-time-base-track-native-geo',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatButtonModule,
    BaseWidgetComponent,
    TimeBasedToolbarComponent
  ],
  templateUrl: './time-base-track-native-geo.component.html',
  styleUrls: ['./time-base-track-native-geo.component.css']
})
export class TimeBaseTrackNativeGeoComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() well: string = '';
  @Input() wellbore: string = '';
  @Input() wellboreObjects: ITimeWellboreObject[] = [];
  @Input() listOfTracks: ITimeTrack[] = [];

  @ViewChild(BaseWidgetComponent) baseWidget!: BaseWidgetComponent;

  showLoading = false;
  widget: WellLogWidget | null = null;
  wellLogWidget: WellLogWidget | null = null;

  // Toolbar properties
  selectedScale: string = '1000';
  isDarkTheme: boolean = false;
  isLiveTracking: boolean = false;
  indexCurveTime: number[] = [];

  private trackMap: Map<number, LogTrack> = new Map();
  private curveMap: Map<string, LogCurve> = new Map();
  private logDataMap: Map<string, GeoLogData> = new Map();
  private matchedHeaders: Set<string> = new Set();
  private logIdToCurves: Map<string, ITimeCurve[]> = new Map();
  private logIdToHeader: Map<string, ITimeWellboreObject> = new Map();
  private subscriptions: Subscription[] = [];
  private lastVisibleMin = 0;
  private lastVisibleMax = 0;
  private scrollPollHandle: any;
  private loadingLogIds = new Set<string>();

  constructor(
    private timeBasedLogService: TimeBasedLogService,
    private timeBasedThemeService: TimeBasedThemeService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    console.log('🎯 TimeBaseTrackNativeGeo initialized', { well: this.well, wellbore: this.wellbore });
    console.log('🔍 Input data check:', {
      hasWellboreObjects: this.wellboreObjects?.length || 0,
      hasTracks: this.listOfTracks?.length || 0,
      wellboreObjects: this.wellboreObjects,
      tracks: this.listOfTracks
    });
    
    // Work directly with provided tracks
    if (this.listOfTracks.length > 0) {
      console.log('🕐 Using provided tracks directly');
      this.processProvidedTracks();
    } else {
      console.log('⚠️ No tracks provided, fetching headers...');
      this.fetchLogHeaders();
    }
  }

  ngAfterViewInit(): void {
    this.tryInitializeWidget();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.scrollPollHandle) {
      clearInterval(this.scrollPollHandle);
    }
  }

  private tryInitializeWidget(): void {
    console.log('🔍 Checking widget initialization conditions:', {
      hasBaseWidget: !!this.baseWidget,
      hasWellboreObjects: this.wellboreObjects.length > 0,
      hasWellLogWidget: !!this.wellLogWidget,
      wellboreObjectsCount: this.wellboreObjects.length
    });
    
    if (!this.baseWidget || !this.wellboreObjects.length || this.wellLogWidget) {
      console.log('⏸️ Widget initialization skipped:', {
        noBaseWidget: !this.baseWidget,
        noWellboreObjects: !this.wellboreObjects.length,
        alreadyHasWellLogWidget: !!this.wellLogWidget
      });
      return;
    }
    
    console.log('🚀 Proceeding with widget initialization');
    this.initializeWidget();
  }

  private processProvidedTracks(): void {
    console.log('🔧 Processing provided tracks...');
    
    // Fetch actual headers to get real date ranges
    this.fetchLogHeadersForTracks();
  }

  private fetchLogHeadersForTracks(): void {
    console.log('🕐 Fetching actual headers for time-based configuration...');
    this.showLoading = true;
    this.timeBasedLogService.getTimeLogHeaders(this.well, this.wellbore).subscribe(
      (headers: ITimeWellboreObject[]) => {
        console.log('🕐 Actual headers loaded:', headers);
        this.showLoading = false;
        
        if (headers && headers.length > 0) {
          // Use the first header that matches our expected LogId
          const matchingHeader = headers.find(h => h.uid.includes('MWD_Time')) || headers[0];
          console.log('🕐 Using header for configuration:', matchingHeader);
          
          this.wellboreObjects = [matchingHeader];
          this.matchedHeaders.add(matchingHeader.uid);
          this.logIdToHeader.set(matchingHeader.uid, matchingHeader);
          
          // Set up curves for the actual LogId
          this.setupCurvesForLogIds([matchingHeader.uid]);
          
          console.log('🔍 After processing actual headers:', {
            wellboreObjectsCount: this.wellboreObjects.length,
            logIdToCurvesCount: this.logIdToCurves.size,
            matchedHeadersCount: this.matchedHeaders.size,
            startDate: matchingHeader.startIndex,
            endDate: matchingHeader.endIndex
          });
        } else {
          console.warn('⚠️ No headers found, falling back to mock data');
          this.createMockWellboreObject();
        }
        
        // Try to initialize widget now
        this.tryInitializeWidget();
      },
      (error: any) => {
        console.error('❌ Error fetching headers:', error);
        this.showLoading = false;
        console.log('⚠️ Falling back to mock data due to error');
        this.createMockWellboreObject();
        this.tryInitializeWidget();
      }
    );
  }

  private createMockWellboreObject(): void {
    console.log('🔧 Creating mock wellbore object as fallback...');
    
    // Create a mock wellbore object for data loading
    const mockWellboreObject: ITimeWellboreObject = {
      uid: 'MWD_Time_SLB',
      name: 'MWD Time',
      wellId: this.well,
      wellboreId: this.wellbore,
      indexType: 'time',
      indexCurve: 'TIME',
      startIndex: '2025-02-11T06:13:15.000Z',
      endIndex: '2025-02-14T06:13:14.000Z',
      indexUnit: 'ms',
      isGrowing: false,
      mnemonicList: 'TIME,GR,RT,RHOB,NPHI,PEF,DTC,LLD',
      objectInfo: []
    };
    
    this.wellboreObjects = [mockWellboreObject];
    this.matchedHeaders.add(mockWellboreObject.uid);
    this.logIdToHeader.set(mockWellboreObject.uid, mockWellboreObject);
    
    // Set up curves for the mock LogId
    this.setupCurvesForLogIds([mockWellboreObject.uid]);
  }

  private fetchLogHeaders(): void {
    console.log('🕐 Starting to fetch log headers...', { well: this.well, wellbore: this.wellbore });
    this.showLoading = true;
    this.timeBasedLogService.getTimeLogHeaders(this.well, this.wellbore).subscribe(
      (headers: ITimeWellboreObject[]) => {
        console.log('🕐 Headers loaded:', headers);
        console.log('🕐 Headers count:', headers?.length || 0);
        console.log('🕐 Input tracks count:', this.listOfTracks?.length || 0);
        
        this.wellboreObjects = headers;
        this.processHeaders();
        this.showLoading = false;
        
        console.log('🔍 After processing headers:', {
          wellboreObjectsCount: this.wellboreObjects.length,
          logIdToCurvesCount: this.logIdToCurves.size,
          matchedHeadersCount: this.matchedHeaders.size
        });
        
        this.tryInitializeWidget();
      },
      (error: any) => {
        console.error('❌ Error fetching log headers:', error);
        this.showLoading = false;
      }
    );
  }

  private processHeaders(): void {
    const uniqueLogIds = new Set<string>();
    
    this.wellboreObjects.forEach(wo => {
      if (wo.uid) {
        uniqueLogIds.add(wo.uid);
        this.matchedHeaders.add(wo.uid);
        this.logIdToHeader.set(wo.uid, wo);
      }
    });

    console.log('📊 Found unique LogIds:', Array.from(uniqueLogIds));
    this.setupCurvesForLogIds(Array.from(uniqueLogIds));
  }

  private setupCurvesForLogIds(logIds: string[]): void {
    console.log('🔧 Setting up curves for LogIds:', logIds);
    console.log('🔧 Available tracks:', this.listOfTracks.map(t => ({
      trackNo: t.trackNo,
      trackName: t.trackName,
      curvesCount: t.curves?.length || 0,
      curves: t.curves?.map(c => ({ mnemonicId: c.mnemonicId, LogId: c.LogId }))
    })));
    
    logIds.forEach(logId => {
      const curves = this.listOfTracks
        .filter(track => track.curves)
        .flatMap(track => track.curves)
        .filter((curve: ITimeCurve) => curve.LogId === logId);

      console.log(`🔧 For LogId ${logId}: found ${curves.length} matching curves:`, curves.map(c => c.mnemonicId));
      
      this.logIdToCurves.set(logId, curves);
      console.log(`✅ Set up ${curves.length} curves for LogId: ${logId}`);
    });
  }

  private initializeWidget(): void {
    console.log('🚀 Initializing WellLogWidget using TimeBasedLogService');
    
    // Create WellLogWidget using the service
    const widget = this.timeBasedLogService.createWellLogWidget(this.baseWidget.Canvas.nativeElement);
    
    if (!(widget instanceof WellLogWidget)) {
      console.error('❌ Failed to create WellLogWidget instance');
      return;
    }
    
    // Set the widget on the base component
    this.baseWidget.Widget = widget;
    this.widget = widget;
    this.wellLogWidget = widget;

    if (!this.wellLogWidget) {
      console.error('❌ WellLogWidget not available after creation');
      return;
    }

    // Configure widget for time-based data
    console.log('⚙️ Configuring widget for time-based data');
    this.wellLogWidget.setIndexType('time');
    this.wellLogWidget.setIndexUnit('ms');

    console.log('✅ Widget initialized with GeoToolkit native loading');
    this.setupTracks();
    this.setupScrollEvents();
    
    // Set initial visible range to show the data
    if (this.wellLogWidget) {
      this.wellLogWidget.setVisibleDepthLimits(1739499194000, 1739513594000);
      console.log('📊 Set initial visible range to data time range');
      
      // Force widget to update and redraw
      setTimeout(() => {
        this.wellLogWidget?.updateLayout();
      
        console.log('🔄 Forced widget update and redraw');
      }, 100);
    }
    
    this.loadInitialData();
  }

  private setupTracks(): void {
    console.log('🎨 Setting up tracks for time-based data');
    
    if (!this.wellLogWidget) {
      console.error('❌ WellLogWidget not available for track creation');
      return;
    }

    // Create index track first (important for time-based data)
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    if (indexTrack) {
      indexTrack.setName('Time Index');
      indexTrack.setWidth(150);
      console.log('✅ Created index track');
    }

    // Group curves by LogId to understand track structure
    const logIdToCurves = new Map<string, ITimeCurve[]>();
    this.listOfTracks.forEach((track) => {
      track.curves.forEach((curve) => {
        if (!logIdToCurves.has(curve.LogId || '')) {
          logIdToCurves.set(curve.LogId || '', []);
        }
        logIdToCurves.get(curve.LogId || '')!.push(curve);
      });
    });

    console.log(`📋 Processing ${logIdToCurves.size} LogIds with tracks`);

    // Create tracks for each unique track number
    const trackNumbers = new Set<number>();
    this.listOfTracks.forEach(track => trackNumbers.add(track.trackNo));
    
    trackNumbers.forEach(trackNumber => {
      const trackInfo = this.listOfTracks.find(t => t.trackNo === trackNumber);
      if (!trackInfo) return;

      console.log(`🆕 Creating track ${trackNumber}: ${trackInfo.trackName}`);
      
      try {
        const logTrack = this.wellLogWidget!.addTrack(TrackType.LinearTrack);
        if (logTrack) {
          logTrack.setName(trackInfo.trackName);
          logTrack.setWidth(trackInfo.width || 300);
          this.trackMap.set(trackNumber, logTrack);
          console.log(`✅ Track ${trackNumber} created successfully`);
        }
      } catch (error) {
        console.error(`❌ Error creating track ${trackNumber}:`, error);
      }
    });

    console.log(`🎯 Total tracks created: ${this.trackMap.size}`);
    
    // Store curve mapping for data loading
    this.logIdToCurves = logIdToCurves;
  }

  private getOrCreateTrack(trackNumber: number, trackName: string): LogTrack {
    if (this.trackMap.has(trackNumber)) {
      console.log(`🔄 Using existing track ${trackNumber}`);
      return this.trackMap.get(trackNumber)!;
    }

    console.log(`🆕 Creating new track ${trackNumber}: ${trackName}`);
    // Use time-based limits from the actual data range
    const currentTime = Date.now();
    const track = new LogTrack()
      .setDepthLimits(1739499194000, 1739513594000) // Actual data time range
      .setVisible(true);

    this.wellLogWidget!.addTrack(track);
    this.trackMap.set(trackNumber, track);
    
    console.log(`✅ Track ${trackNumber} added to widget`);
    return track;
  }

  private findTrackNumberForCurve(curve: ITimeCurve): number {
    for (const track of this.listOfTracks) {
      if (track.curves.some((c: ITimeCurve) => c.mnemonicId === curve.mnemonicId)) {
        return track.trackNo;
      }
    }
    return 1;
  }

  
  private setupScrollEvents(): void {
    console.log('📜 Setting up event-based scroll detection');

    if (!this.widget) {
      console.warn('⚠️ Widget not available for scroll detection');
      return;
    }

    // Initialize the last visible range to prevent immediate false triggers
    try {
      const initialLimits: any = this.widget?.getVisibleDepthLimits();
      if (initialLimits) {
        this.lastVisibleMin = initialLimits.getLow ? initialLimits.getLow() : 0;
        this.lastVisibleMax = initialLimits.getHigh ? initialLimits.getHigh() : 0;
        console.log(`📊 Initial visible range: ${this.lastVisibleMin.toFixed(1)} - ${this.lastVisibleMax.toFixed(1)}`);
      }
    } catch (error) {
      console.warn('⚠️ Error getting initial visible limits:', error);
      this.lastVisibleMin = 0;
      this.lastVisibleMax = 0;
    }

    // Poll every 500ms for visible depth changes
    this.scrollPollHandle = setInterval(() => {
      if (!this.widget) return;

      try {
        const visibleLimits: any = this.widget.getVisibleDepthLimits();
        if (!visibleLimits) return;

        const vMin = visibleLimits.getLow ? visibleLimits.getLow() : 0;
        const vMax = visibleLimits.getHigh ? visibleLimits.getHigh() : 0;

        // Skip invalid ranges (0-0 indicates widget not ready)
        if (vMin === 0 && vMax === 0) {
          return;
        }

        // Only trigger if visible range actually changed beyond tolerance
        const tolerance = 10.0;
        const minDiff = Math.abs(vMin - this.lastVisibleMin);
        const maxDiff = Math.abs(vMax - this.lastVisibleMax);
        
        // Detect scroll direction
        const scrollDirection = vMin < this.lastVisibleMin ? 'up' : 
                               vMax > this.lastVisibleMax ? 'down' : 'none';
        
        if (minDiff > tolerance || maxDiff > tolerance) {
          console.log(`📜 Scroll ${scrollDirection}: ${this.lastVisibleMin.toFixed(1)}-${this.lastVisibleMax.toFixed(1)} → ${vMin.toFixed(1)}-${vMax.toFixed(1)}`);
          
          this.lastVisibleMin = vMin;
          this.lastVisibleMax = vMax;
          
          // Load data for the new visible range
          this.loadDataForVisibleRange(vMin, vMax);
        }
      } catch (error) {
        console.warn('⚠️ Error in scroll polling:', error);
      }
    }, 500);
    
    console.log('✅ Scroll polling configured');
  }

  private loadInitialData(): void {
    console.log('🔄 Starting initial data load');
    this.matchedHeaders.forEach(logId => {
      const header = this.logIdToHeader.get(logId);
      if (!header) {
        console.warn(`⚠️ No header found for LogId: ${logId}`);
        return;
      }

      console.log(`📅 Using header dates for ${logId}:`, {
        startIndex: header.startIndex,
        endIndex: header.endIndex
      });
      
      const { startDateValue, endDateValue } = this.extractDateValues(header);
      console.log(`📅 Extracted date values for ${logId}:`, { startDateValue, endDateValue });
      
      if (!startDateValue || !endDateValue) {
        console.warn(`⚠️ Missing date values for ${logId}`);
        return;
      }

      const endTime = this.parseTimestamp(endDateValue, 'end');
      const startTime = endTime ? endTime - (4 * 3600000) : null; // 4 hours before end

      if (startTime && endTime) {
        console.log(`🔄 Loading initial 4-hour window for ${logId}: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
        this.loadAdditionalData(logId, startTime, endTime);
      } else {
        console.error(`❌ Invalid timestamps for ${logId}:`, { startTime, endTime });
      }
    });
  }

  private loadDataForVisibleRange(visibleMin: number, visibleMax: number): void {
    console.log(`🔍 Checking if data needed for range: ${new Date(visibleMin).toISOString()} to ${new Date(visibleMax).toISOString()}`);
    
    this.matchedHeaders.forEach(logId => {
      if (this.loadingLogIds.has(logId)) {
        console.log(`⏸️ Skipping ${logId} - already loading`);
        return;
      }

      const header = this.logIdToHeader.get(logId);
      if (!header) return;

      const { startDateValue, endDateValue } = this.extractDateValues(header);
      const totalStartTime = this.parseTimestamp(startDateValue!, 'start');
      const totalEndTime = this.parseTimestamp(endDateValue!, 'end');

      if (!totalStartTime || !totalEndTime) return;

      // Use indexCurveTime to track what data we have
      if (this.indexCurveTime.length === 0) {
        console.log(`⏸️ No existing data for ${logId} - skipping lazy load`);
        return;
      }

      const currentDataMin = Math.min(...this.indexCurveTime);
      const currentDataMax = Math.max(...this.indexCurveTime);

      console.log(`🔍 Data range check for ${logId}:`, {
        visibleRange: `${new Date(visibleMin).toISOString()} to ${new Date(visibleMax).toISOString()}`,
        currentDataRange: `${new Date(currentDataMin).toISOString()} to ${new Date(currentDataMax).toISOString()}`,
        totalRange: `${new Date(totalStartTime).toISOString()} to ${new Date(totalEndTime).toISOString()}`
      });

      const edgeBufferMs = 2 * 3600000; // 2 hours

      // Load earlier data when scrolling up
      if (visibleMin < currentDataMin && currentDataMin > totalStartTime) {
        const loadMin = Math.max(totalStartTime, visibleMin - edgeBufferMs);
        const loadMax = currentDataMin;
        console.log(`⏪ Loading earlier data for ${logId}: ${new Date(loadMin).toISOString()} to ${new Date(loadMax).toISOString()}`);
        this.loadAdditionalData(logId, loadMin, loadMax);
      }
      // Load later data when scrolling down
      else if (visibleMax > currentDataMax && currentDataMax < totalEndTime) {
        const loadMin = currentDataMax;
        const loadMax = Math.min(totalEndTime, visibleMax + edgeBufferMs);
        console.log(`⏩ Loading later data for ${logId}: ${new Date(loadMin).toISOString()} to ${new Date(loadMax).toISOString()}`);
        this.loadAdditionalData(logId, loadMin, loadMax);
      }
      else {
        console.log(`✅ No additional data needed for ${logId}`);
      }
    });
  }

  private loadAdditionalData(logId: string, startTime: number, endTime: number): void {
    if (this.loadingLogIds.has(logId)) return;

    const header = this.logIdToHeader.get(logId);
    if (!header) return;

    this.loadingLogIds.add(logId);
    console.log(`📥 Loading additional data for ${logId}: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

    const queryParameter: any = {
      wellUid: this.well,
      logUid: header.uid,
      wellboreUid: this.wellbore,
      logName: header.name,
      indexType: 'time',
      indexCurve: 'TIME',
      startIndex: startTime,
      endIndex: endTime,
      isGrowing: header.isGrowing || false,
      mnemonicList: header.mnemonicList || ''
    };

    this.timeBasedLogService.getLogData(queryParameter).subscribe(
      (response: any) => {
        this.appendData(response, logId);
        this.loadingLogIds.delete(logId);
      },
      (error: any) => {
        console.error(`❌ Error loading data for ${logId}:`, error);
        this.loadingLogIds.delete(logId);
      }
    );
  }

  private appendData(response: any, logId: string): void {
    console.log('🔧 Raw server response:', response);

    // Handle the actual response structure: {logs: [{logData: {...}}]}
    let logData = null;
    
    if (response.logs && Array.isArray(response.logs) && response.logs.length > 0) {
      console.log('🔍 Analyzing logs array:', response.logs.map((log: any, index: number) => ({
        index,
        uid: log.uid,
        hasLogData: !!log.logData,
        hasData: !!log.data,
        keys: Object.keys(log)
      })));
      
      const logEntry = response.logs.find((log: any) => log.uid === logId || log.logData);
      console.log('🔍 Found log entry:', logEntry);
      
      if (logEntry && logEntry.logData) {
        logData = logEntry.logData;
      } else if (logEntry && logEntry.data) {
        logData = logEntry;
      }
    } else if (response.logData) {
      logData = response.logData;
    } else if (response.data) {
      logData = response;
    }

    if (!logData || !logData.data) {
      console.warn('⚠️ No valid log data found in response');
      console.log('🔍 Response structure analysis:', {
        hasLogs: !!response.logs,
        logsIsArray: Array.isArray(response.logs),
        logsLength: response.logs?.length,
        hasLogData: !!response.logData,
        hasData: !!response.data,
        responseKeys: Object.keys(response)
      });
      return;
    }

    console.log(`📊 Processing log data for ${logId}:`, {
      hasMnemonics: !!logData.mnemonics,
      mnemonicCount: logData.mnemonics?.length || 0,
      dataRowCount: logData.data?.length || 0,
      mnemonics: logData.mnemonics,
      firstDataRow: logData.data?.[0],
      logDataKeys: Object.keys(logData),
      sampleDataRows: logData.data?.slice(0, 3)
    });

    // Check if we need to extract mnemonics from data rows
    let mnemonics = logData.mnemonics || [];
    if (mnemonics.length === 0 && logData.data && logData.data.length > 0) {
      // Try to extract mnemonics from the first data row
      const firstRow = logData.data[0];
      if (typeof firstRow === 'string') {
        const extractedCols = firstRow.split(',').map((col: string) => col.trim());
        console.log('🔧 Extracted columns from first data row:', extractedCols);
        
        // Since we don't have proper mnemonics, create a mapping based on expected curve order
        // From the data, we can see: TIME, GR, RT, RHOB, NPHI, PEF, DTC, LLD
        // But our component only expects GR and RT
        const expectedMnemonics = ['TIME', 'GR', 'RT', 'RHOB', 'NPHI', 'PEF', 'DTC', 'LLD'];
        
        // Use expected mnemonics if we have enough columns
        if (extractedCols.length >= expectedMnemonics.length) {
          mnemonics = expectedMnemonics;
          console.log('🔧 Using expected mnemonics mapping:', mnemonics);
        } else {
          // Fallback: create generic mnemonics
          mnemonics = extractedCols.map((_, index) => index === 0 ? 'TIME' : `COL${index}`);
          console.log('🔧 Using generic mnemonics fallback:', mnemonics);
        }
      }
    }

    const curves = this.logIdToCurves.get(logId) || [];
    console.log(`🎯 Processing ${curves.length} curves for ${logId}:`, curves.map(c => c.mnemonicId));

    // Check if this is the initial load or a scroll load
    const isInitialLoad = this.indexCurveTime.length === 0;
    console.log(`🔍 Data load type: ${isInitialLoad ? 'initial' : 'scroll/lazy'}`);

    // Process each curve and create/merge LogCurve objects
    curves.forEach(curve => {
      const curveIndex = mnemonics.findIndex((m: string) => m.trim() === curve.mnemonicId);
      console.log(`🔍 Looking for ${curve.mnemonicId} at index ${curveIndex} in mnemonics:`, mnemonics);
      
      if (curveIndex === -1) {
        console.warn(`⚠️ Curve ${curve.mnemonicId} not found in mnemonics list`);
        return;
      }

      const newTimes: number[] = [];
      const newValues: number[] = [];

      logData.data.forEach((dataRow: string, rowIndex: number) => {
        const cols = dataRow.split(',');
        if (cols.length > curveIndex && cols[curveIndex]) {
          const value = parseFloat(cols[curveIndex]);
          const timeStr = cols[0];
          
          if (!isNaN(value) && timeStr) {
            const timeValue = this.parseTimestamp(timeStr.trim(), 'data');
            if (timeValue && !isNaN(timeValue)) {
              newTimes.push(timeValue);
              newValues.push(value);
            }
          }
        }
      });

      console.log(`📈 Parsed ${newValues.length} data points for ${curve.mnemonicId}`);

      if (newTimes.length > 0) {
        if (isInitialLoad) {
          // Initial load - create new curve
          const geoLogData = new GeoLogData(curve.mnemonicId);
          geoLogData.setValues(newTimes, newValues);
          
          // Store in logDataMap for future access
          this.logDataMap.set(curve.mnemonicId, geoLogData);

          const logCurve = new LogCurve(geoLogData);
          logCurve.setLineStyle({ 
            color: curve.color || '#63b3ed', 
            width: curve.lineWidth || 1 
          });
          logCurve.setName(curve.mnemonicId);

          // Find the appropriate track and add the curve
          const trackNumber = this.findTrackNumberForCurve(curve);
          const track = this.trackMap.get(trackNumber);
          
          if (track) {
            track.addChild(logCurve);
            console.log(`✅ Added curve ${curve.mnemonicId} to track ${trackNumber} (${newValues.length} points)`);
          } else {
            console.warn(`⚠️ Track ${trackNumber} not found for curve ${curve.mnemonicId}`);
          }

          // Update indexCurveTime for statistics
          this.indexCurveTime = newTimes;
        } else {
          // Scroll/lazy load - merge with existing data
          this.mergeDataWithExistingCurve(curve.mnemonicId, newTimes, newValues);
        }
      } else {
        console.warn(`⚠️ No valid data points parsed for ${curve.mnemonicId}`);
      }
    });
    
    // Clear the loading flag
    this.loadingLogIds.delete(logId);
    
    // Force widget update after data is loaded
    setTimeout(() => {
      // Configure widget for time-based data with proper limits from actual header
      if (this.wellLogWidget) {
        // Get the actual time range from the header
        const header = this.logIdToHeader.get(logId);
        if (header) {
          const { startDateValue, endDateValue } = this.extractDateValues(header);
          const startTime = this.parseTimestamp(startDateValue!, 'start');
          const endTime = this.parseTimestamp(endDateValue!, 'end');
          
          if (startTime && endTime) {
            // Use a 4-hour window for initial display (ending at the most recent data)
            const visibleMin = endTime - (4 * 3600000);
            const visibleMax = endTime;
            
            console.log('🔧 Setting final time-based configuration from header:', {
              headerStart: new Date(startTime).toISOString(),
              headerEnd: new Date(endTime).toISOString(),
              visibleMin: new Date(visibleMin).toISOString(),
              visibleMax: new Date(visibleMax).toISOString()
            });
            
            // Configure widget for time-based data
            this.wellLogWidget.setIndexType('time', 'ms');
            this.wellLogWidget.setDepthLimits(startTime, endTime);
            this.wellLogWidget.setVisibleDepthLimits(visibleMin, visibleMax);
            
            // Force multiple updates to ensure proper rendering
            this.wellLogWidget.updateLayout();
            
            setTimeout(() => {
              this.wellLogWidget?.setVisibleDepthLimits(visibleMin, visibleMax);
              this.wellLogWidget?.updateLayout();
              console.log('🔄 Final widget update with actual header time-based configuration');
            }, 100);
          } else {
            console.error('❌ Invalid header timestamps for configuration');
          }
        } else {
          console.error('❌ No header found for final configuration');
        }
      }
      
      console.log('🔄 Forced widget update after data load');
    }, 50);
  }

  private mergeDataWithExistingCurve(mnemonicId: string, newTimes: number[], newValues: number[]): void {
    console.log(`🔧 Merging data for ${mnemonicId}: ${newValues.length} new points`);
    
    // Find existing curve in tracks
    let existingCurve: LogCurve | null = null;
    let existingGeoLogData: GeoLogData | null = this.logDataMap.get(mnemonicId) || null;
    
    for (const track of this.trackMap.values()) {
      const children = Iterator.toArray(track.getChildren());
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child instanceof LogCurve && child.getName() === mnemonicId) {
          existingCurve = child;
          break;
        }
      }
      if (existingCurve) break;
    }
    
    if (!existingCurve || !existingGeoLogData) {
      console.warn(`⚠️ Existing curve not found for ${mnemonicId}, creating new one`);
      // Fallback to creating new curve
      const geoLogData = new GeoLogData(mnemonicId);
      geoLogData.setValues(newTimes, newValues);
      
      // Store in logDataMap for future access
      this.logDataMap.set(mnemonicId, geoLogData);
      
      const logCurve = new LogCurve(geoLogData);
      logCurve.setName(mnemonicId);
      
      // Find track and add
      const curveObject: ITimeCurve = { mnemonicId, data: newValues };
      const trackNumber = this.findTrackNumberForCurve(curveObject);
      const track = this.trackMap.get(trackNumber);
      if (track) {
        track.addChild(logCurve);
        console.log(`✅ Created and added new curve ${mnemonicId} to track ${trackNumber}`);
      }
      return;
    }
    
    // Merge data
    const existingTimes = existingGeoLogData.getDepths();
    const existingValues = existingGeoLogData.getValues();
    
    const merged = this.mergeTimeSeriesData(existingTimes, existingValues, newTimes, newValues);
    existingGeoLogData.setValues(merged.times, merged.values);
    
    // Update the existing curve with the merged data
    if (existingCurve) {
      existingCurve.setData(existingGeoLogData);
    }
    
    // Update indexCurveTime for statistics
    this.indexCurveTime = merged.times;
    
    console.log(`✅ Merged ${newValues.length} points with existing ${existingValues.length} points for ${mnemonicId}, total: ${merged.times.length}`);
  }

  private mergeTimeSeriesData(
    existingTimes: number[], 
    existingValues: number[], 
    newTimes: number[], 
    newValues: number[]
  ): { times: number[], values: number[] } {
    const dataMap = new Map<number, number>();
    
    existingTimes.forEach((t, i) => dataMap.set(t, existingValues[i]));
    newTimes.forEach((t, i) => dataMap.set(t, newValues[i]));

    const sortedEntries = Array.from(dataMap.entries()).sort((a, b) => a[0] - b[0]);
    
    return {
      times: sortedEntries.map(e => e[0]),
      values: sortedEntries.map(e => e[1])
    };
  }

  private extractDateValues(wo: ITimeWellboreObject): { startDateValue?: string; endDateValue?: string } {
    let endDateValue: string | undefined;
    let startDateValue: string | undefined;

    if (typeof wo.endIndex === 'string') {
      endDateValue = wo.endIndex;
    } else if (wo.endIndex && typeof wo.endIndex === 'object') {
      endDateValue = (wo.endIndex as any).value || (wo.endIndex as any).date;
    }

    if (typeof wo.startIndex === 'string') {
      startDateValue = wo.startIndex;
    } else if (wo.startIndex && typeof wo.startIndex === 'object') {
      startDateValue = (wo.startIndex as any).value || (wo.startIndex as any).date;
    }

    return { startDateValue, endDateValue };
  }

  private parseTimestamp(timestamp: string, context: 'start' | 'end' | 'data'): number | null {
    try {
      // Handle ISO format timestamps
      if (timestamp.includes('T') && timestamp.includes('Z')) {
        const date = new Date(timestamp);
        return date.getTime();
      }
      
      // Handle other formats as needed
      return null;
    } catch (error) {
      console.warn(`⚠️ Error parsing timestamp ${timestamp}:`, error);
      return null;
    }
  }

  // Public methods for external interaction
  setVisibleTimeRange(startTime: string, endTime: string): void {
    const start = this.parseTimestamp(startTime, 'start');
    const end = this.parseTimestamp(endTime, 'end');

    if (!start || !end || start >= end) return;

    this.wellLogWidget?.setVisibleDepthLimits(start, end);
  }

  getCurveColor(trackIndex: number): string {
    return this.timeBasedThemeService.getCurveColor(trackIndex);
  }

  // Toolbar event handlers
  onScaleChange(newScale: string): void {
    this.selectedScale = newScale;
    console.log(`📏 Scale changed to: ${newScale}`);
  }

  onThemeChange(isDark: boolean): void {
    this.isDarkTheme = isDark;
    console.log(`🎨 Theme changed to: ${isDark ? 'dark' : 'light'}`);
  }

  startLivePolling(): void {
    this.isLiveTracking = true;
    console.log('🔄 Live tracking started');
  }

  stopLivePolling(): void {
    this.isLiveTracking = false;
    console.log('⏹️ Live tracking stopped');
  }

  onResetView(): void {
    console.log('🔄 View reset');
    if (this.wellLogWidget) {
      // Reset to initial view
      this.loadInitialData();
    }
  }

  onScrollToLatest(): void {
    console.log('⏭️ Scroll to latest');
    // Implementation needed for scrolling to latest data
  }

  onZoomIn(): void {
    console.log('🔍 Zoom in');
    if (this.wellLogWidget) {
      // Implementation needed for zoom in
    }
  }

  onZoomOut(): void {
    console.log('🔍 Zoom out');
    if (this.wellLogWidget) {
      // Implementation needed for zoom out
    }
  }

  onEditToggle(enabled: boolean): void {
    console.log(`✏️ Edit toggle: ${enabled}`);
  }

  onToolbarColorChange(color: string): void {
    console.log(`🎨 Toolbar color changed: ${color}`);
  }

  onRigTimeToggle(enabled: boolean): void {
    console.log(`⏰ Rig time toggle: ${enabled}`);
  }

  onTimeRangeChange(range: {start: string, end: string}): void {
    console.log(`📅 Time range changed: ${range.start} to ${range.end}`);
    this.setVisibleTimeRange(range.start, range.end);
  }

  // Statistics methods
  calculateDuration(): string {
    if (this.indexCurveTime.length < 2) return '0 min';
    const startTime = Math.min(...this.indexCurveTime);
    const endTime = Math.max(...this.indexCurveTime);
    const durationMs = endTime - startTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  calculateDataPointsPerHour(): number {
    if (this.indexCurveTime.length < 2) return 0;
    const startTime = Math.min(...this.indexCurveTime);
    const endTime = Math.max(...this.indexCurveTime);
    const durationHours = (endTime - startTime) / (1000 * 60 * 60);
    return durationHours > 0 ? Math.round(this.indexCurveTime.length / durationHours) : 0;
  }
}
