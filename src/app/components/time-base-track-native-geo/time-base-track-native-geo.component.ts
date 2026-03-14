import { Component, Input, OnInit, OnDestroy, ViewChild, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { WellDataService } from '../../service/well-service/well.service'; 
import { TimeBasedThemeService } from '../time-based-tracks/time-based-theme.service';
import {  ITimeCurve, ITimeTrack, IWellboreObject } from '../time-based-tracks/time-based-tracks.component';
import { TimeBasedToolbarComponent } from '../time-based-tracks/time-based-toolbar/time-based-toolbar.component';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { Iterator } from '@int/geotoolkit/util/iterator';
import { Subscription } from 'rxjs';
import { HttpClient } from '@angular/common/http';

// Log2DVisual imports for image track
import { Log2DVisual, PlotTypes } from '@int/geotoolkit/welllog/Log2DVisual';
import { Log2DVisualData } from '@int/geotoolkit/welllog/data/Log2DVisualData';
import { Log2DDataRow } from '@int/geotoolkit/welllog/data/Log2DDataRow';
import { CompositeLog2DVisualHeader } from '@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader';
import { DefaultColorProvider } from '@int/geotoolkit/util/DefaultColorProvider';
import { HeaderType } from '@int/geotoolkit/welllog/header/LogAxisVisualHeader';
import { Orientation } from '@int/geotoolkit/util/Orientation';

// Interface for image data response
interface ImageDataResponse {
  wellId: string;
  wellboreId: string;
  objectId: string;
  startIndex: number;
  endIndex: number;
  imageData: Array<{
    depth: number;
    values: number[];
    angles: number[];
  }>;
}

// Interface for log data item
interface LogDataItem {
  depth: number;
  values: number[];
  angles: number[];
}

// Extended interface for image track
export interface IImageTrack extends ITimeTrack {
  trackType: 'Image';
  imageData?: Log2DVisualData;
}

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
  @Input() wellboreObjects: IWellboreObject[] = [];
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
  private logIdToHeader: Map<string, IWellboreObject> = new Map();
  private subscriptions: Subscription[] = [];
  private lastVisibleMin = 0;
  private lastVisibleMax = 0;
  private scrollPollHandle: ReturnType<typeof setInterval> | undefined;
  private loadingLogIds = new Set<string>();

  // Image track properties
  private imageTrackMap: Map<number, Log2DVisual> = new Map();
  private imageData: Log2DVisualData | null = null;

  constructor(
    private wellDataService: WellDataService,
    private timeBasedThemeService: TimeBasedThemeService,
    private ngZone: NgZone,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    console.log('TimeBaseTrackNativeGeo initialized', { well: this.well, wellbore: this.wellbore });
    
    // Work directly with provided tracks
    if (this.listOfTracks.length > 0) {
      console.log('Using provided tracks directly');
      this.processProvidedTracks();
    } else {
      console.warn('No tracks provided, fetching headers...');
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
    if (!this.baseWidget || !this.wellboreObjects.length || this.wellLogWidget) {
      return;
    }
    
    this.initializeWidget();
  }

  private processProvidedTracks(): void {
    // Fetch actual headers to get real date ranges
    this.fetchLogHeadersForTracks();
  }

  private fetchLogHeadersForTracks(): void {
    this.showLoading = true;
    this.wellDataService.getTimeLogHeaders(this.well, this.wellbore).subscribe(
      (headers: IWellboreObject[]) => {
        this.showLoading = false;
        
        if (headers && headers.length > 0) {
          // Filter for all time-related headers
          const timeRelatedHeaders = headers.filter(h => h.uid && h.uid.toLowerCase().includes('time'));
          
          if (timeRelatedHeaders.length > 0) {
            console.log(`✅ Found ${timeRelatedHeaders.length} time-related headers:`, timeRelatedHeaders.map(h => h.uid));
            
            // Use all time-related headers
            this.wellboreObjects = timeRelatedHeaders;
            
            // Process all headers
            this.processHeaders();
          } else {
            console.log('🔧 No time-related headers found, using all available headers as fallback');
            this.wellboreObjects = headers;
            this.processHeaders();
          }
        } else {
          console.warn('No headers found');
          this.showLoading = false;
          this.showNoDataMessage('No headers found for the specified well and wellbore.');
        }
        
        this.tryInitializeWidget();
      },
      (error: unknown) => {
        console.error('Error fetching headers:', error);
        this.showLoading = false;
        this.showNoDataMessage('Error loading headers. Please check your connection and try again.');
        this.tryInitializeWidget();
      }
    );
  }

  private showNoDataMessage(message: string): void {
    // TODO: Implement UI notification (e.g., toast, alert, or template variable)
    console.warn('User Message:', message);
  }

  private fetchLogHeaders(): void {
    this.showLoading = true;
    this.wellDataService.getTimeLogHeaders(this.well, this.wellbore).subscribe(
      (headers: IWellboreObject[]) => {
        this.wellboreObjects = headers;
        this.processHeaders();
        this.showLoading = false;
        this.tryInitializeWidget();
      },
      (error: unknown) => {
        console.error('Error fetching log headers:', error);
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

    this.setupCurvesForLogIds(Array.from(uniqueLogIds));
  }

  private setupCurvesForLogIds(logIds: string[]): void {
    logIds.forEach(logId => {
      const curves = this.listOfTracks
        .filter(track => track.curves)
        .flatMap(track => track.curves)
        .filter((curve: ITimeCurve) => curve.LogId === logId);

      this.logIdToCurves.set(logId, curves);
    });
  }

  private initializeWidget(): void {
    // Create WellLogWidget using the service
    const widget = this.wellDataService.createWellLogWidget(this.baseWidget.Canvas.nativeElement);
    
    if (!(widget instanceof WellLogWidget)) {
      console.error('Failed to create WellLogWidget instance');
      return;
    }
    
    // Set the widget on the base component
    this.baseWidget.Widget = widget;
    this.widget = widget;
    this.wellLogWidget = widget;

    if (!this.wellLogWidget) {
      console.error('WellLogWidget not available after creation');
      return;
    }

    // Configure widget for time-based data
    this.wellLogWidget.setIndexType('time');
    this.wellLogWidget.setIndexUnit('ms');

    this.setupTracks();
    this.setupScrollEvents();
    
    // Configure widget for time-based data with proper limits
    if (this.wellLogWidget) {
      // Set the total data range first (using your actual data range)
      const totalStartTime = 1739499194000; // Start of your data
      const totalEndTime = 1739513594000; // End of your data
      this.wellLogWidget.setDepthLimits(totalStartTime, totalEndTime);
      
      // Set visible range to show most recent 4 hours at bottom
      const visibleStartTime = totalEndTime - (4 * 3600000); // 4 hours back from end
      this.wellLogWidget.setVisibleDepthLimits(visibleStartTime, totalEndTime);
    }
    
    this.loadInitialData();
  }

  private setupTracks(): void {
    if (!this.wellLogWidget) {
      console.error('WellLogWidget not available for track creation');
      return;
    }

    // Register header provider for Log2DVisual
    const headerProvider = this.wellLogWidget.getHeaderContainer().getHeaderProvider();
    headerProvider.registerHeaderProvider(Log2DVisual.getClassName(), new CompositeLog2DVisualHeader());

    // Create index track first (important for time-based data)
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    if (indexTrack) {
      indexTrack.setName('Time Index');
      indexTrack.setWidth(150);
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

    console.log('🔍 Available tracks configuration:', this.listOfTracks.map(t => ({
      trackNo: t.trackNo,
      trackName: t.trackName,
      trackType: t.trackType,
      curvesCount: t.curves?.length || 0
    })));

    // Create tracks for each unique track number
    const trackNumbers = new Set<number>();
    this.listOfTracks.forEach(track => trackNumbers.add(track.trackNo));
    
    trackNumbers.forEach(trackNumber => {
      const trackInfo = this.listOfTracks.find(t => t.trackNo === trackNumber);
      if (!trackInfo) return;
      
      console.log(`🔍 Processing track ${trackNumber}: ${trackInfo.trackName} (type: ${trackInfo.trackType})`);
      
      try {
        // Check track type from configuration (case-insensitive)
        if (trackInfo.trackType?.toLowerCase() === 'image') {
          console.log(`🖼️ Creating image track for track ${trackNumber} (${trackInfo.trackName})`);
          this.createImageTrack(trackNumber, trackInfo);
        } else {
          // Create regular linear track for other track types
          const logTrack = this.wellLogWidget!.addTrack(TrackType.LinearTrack);
          if (logTrack) {
            logTrack.setName(trackInfo.trackName);
            logTrack.setWidth(trackInfo.width || 300);
            this.trackMap.set(trackNumber, logTrack);
            console.log(`✅ Created regular track ${trackNumber}: ${trackInfo.trackName}`);
          }
        }
      } catch (error) {
        console.error(`Error creating track ${trackNumber}:`, error);
      }
    });
    
    // Store curve mapping for data loading
    this.logIdToCurves = logIdToCurves;

    // Load image data for the image track
    this.loadImageData();
  }

  private createImageTrack(trackNumber: number, trackInfo: ITimeTrack): void {
    if (!this.wellLogWidget) {
      console.error('WellLogWidget not available for image track creation');
      return;
    }

    try {
      // Create linear track for image
      const logTrack = this.wellLogWidget.addTrack(TrackType.LinearTrack);
      if (logTrack) {
        logTrack.setName(trackInfo.trackName || 'Image Track');
        logTrack.setWidth(trackInfo.width || 300);
        this.trackMap.set(trackNumber, logTrack);

        console.log(`✅ Created image track: ${trackInfo.trackName}`);
      }
    } catch (error) {
      console.error(`Error creating image track ${trackNumber}:`, error);
    }
  }

  private loadImageData(): Promise<void> {
    console.log('🖼️ Loading image data for image track...');
    
    // Load image data from backend service
    return this.http.get<ImageDataResponse>('http://localhost:3004/api/getImageData').toPromise()
      .then(response => {
        if (!response || !response.imageData) {
          throw new Error('Failed to load image data: No data received from backend');
        }
        
        const log2dData = new Log2DVisualData();
        
        // Parse image data and create Log2DDataRow objects
        response.imageData.forEach((item: LogDataItem) => {
          const row = new Log2DDataRow(item.depth, item.values, item.angles);
          log2dData.getRows().push(row);
        });
        
        log2dData.updateLimits();
        this.imageData = log2dData;
        
        console.log(`✅ Loaded image data: ${log2dData.getRows().length} rows from depth ${response.imageData[0]?.depth} to ${response.imageData[response.imageData.length-1]?.depth}`);
        
        // Convert depth data to time data for time-based display
        const timeData = this.convertDepthToTime(log2dData);
        
        // Create Log2DVisual and add to track 4
        this.addLog2DVisualToTrack(timeData);
        
      })
      .catch(error => {
        console.error('Backend service not available, falling back to static data:', error);
        
        // Fallback to static data if backend is not available
        return this.http.get<LogDataItem[]>('/assets/data/log2DData.json').toPromise()
          .then(jsonData => {
            if (!jsonData) {
              throw new Error('Failed to load fallback log2DData.json: No data received');
            }
            
            const log2dData = new Log2DVisualData();
            
            // Parse JSON data and create Log2DDataRow objects
            jsonData.forEach((item: LogDataItem) => {
              const row = new Log2DDataRow(item.depth, item.values, item.angles);
              log2dData.getRows().push(row);
            });
            
            log2dData.updateLimits();
            this.imageData = log2dData;
            
            console.log(`✅ Loaded fallback image data: ${log2dData.getRows().length} rows`);
            
            // Convert depth data to time data for time-based display
            const timeData = this.convertDepthToTime(log2dData);
            
            // Create Log2DVisual and add to track 4
            this.addLog2DVisualToTrack(timeData);
          });
      });
  }

  private convertDepthToTime(depthData: Log2DVisualData): Log2DVisualData {
    const timeData = new Log2DVisualData();
    
    // The new log2DData.json already has timestamps as "depth" values
    // So we just need to convert them to Log2DDataRow format directly
    depthData.getRows().forEach(row => {
      // The depth value is already a timestamp in milliseconds
      const timestamp = row.getDepth();
      const timeRow = new Log2DDataRow(timestamp, row.getValues(), row.getAngles());
      timeData.getRows().push(timeRow);
    });
    
    timeData.updateLimits();
    console.log(`✅ Converted time-based image data: ${timeData.getRows().length} rows`);
    console.log(`📅 Image data time range: ${new Date(timeData.getRows()[0]?.getDepth()).toISOString()} to ${new Date(timeData.getRows()[timeData.getRows().length-1]?.getDepth()).toISOString()}`);
    
    return timeData;
  }

  private addLog2DVisualToTrack(timeData: Log2DVisualData): void {
    if (!this.wellLogWidget || !this.imageData) {
      console.error('WellLogWidget or image data not available for Log2DVisual creation');
      return;
    }

    try {
      // Find the image track dynamically by track type (case-insensitive)
      let imageTrackNumber: number | null = null;
      for (const track of this.listOfTracks) {
        if (track.trackType?.toLowerCase() === 'image') {
          imageTrackNumber = track.trackNo;
          break;
        }
      }

      if (!imageTrackNumber) {
        console.error('No image track found in configuration');
        return;
      }

      // Get the image track
      const imageTrack = this.trackMap.get(imageTrackNumber);
      if (!imageTrack) {
        console.error(`Image track (track ${imageTrackNumber}) not found`);
        return;
      }

      // Create Log2DVisual with time-based data
      const log2DVisual = this.create2DVisual(timeData, 'Time-based Image Track', 0, '#ff6b6b');
      log2DVisual.setPlotType(PlotTypes.Linear);
      
      // Add Log2DVisual to the image track
      imageTrack.addChild([log2DVisual]);
      
      // Store reference
      this.imageTrackMap.set(imageTrackNumber, log2DVisual);
      
      console.log(`✅ Log2DVisual added to image track ${imageTrackNumber} successfully`);
      
      // Refresh the widget
      this.wellLogWidget.updateLayout();
      
    } catch (error) {
      console.error('Error adding Log2DVisual to track:', error);
    }
  }

  private create2DVisual(
    log2dData: Log2DVisualData,
    name: string,
    offset: number,
    zeroColor: string
  ): Log2DVisual {
    const min = log2dData.getMinValue();
    const max = log2dData.getMaxValue();
    const delta = (max - min) / 3;
    
    // Create color provider
    const colors = new DefaultColorProvider()
      .addColor(min, zeroColor)
      .addColor(min + delta, 'yellow')
      .addColor(min + 2 * delta, 'orange')
      .addColor(max, 'red');

    // Create Log2DVisual
    return new Log2DVisual()
      .setName(name)
      .setData(log2dData)
      .setColorProvider(colors)
      .setOffsets(offset)
      .setMicroPosition(0, 1);
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
    if (!this.widget) {
      return;
    }

    // Initialize the last visible range to prevent immediate false triggers
    try {
      const initialLimits: { getLow?: () => number; getHigh?: () => number } | undefined = this.widget?.getVisibleDepthLimits();
      if (initialLimits) {
        this.lastVisibleMin = initialLimits.getLow ? initialLimits.getLow() : 0;
        this.lastVisibleMax = initialLimits.getHigh ? initialLimits.getHigh() : 0;
      }
    } catch (error) {
      this.lastVisibleMin = 0;
      this.lastVisibleMax = 0;
    }

    // Poll every 500ms for visible depth changes
    this.scrollPollHandle = setInterval(() => {
      this.handleScrollEvent();
    }, 500);
  }

  private handleScrollEvent(): void {
    if (!this.wellLogWidget || this.loadingLogIds.size > 0) {
      return; // Skip if widget not ready or already loading
    }

    try {
      const visibleLimits = this.wellLogWidget.getVisibleDepthLimits();
      if (!visibleLimits) return;

      const visibleMin = visibleLimits.getLow();
      const visibleMax = visibleLimits.getHigh();
      
      // Check if this is a real scroll event (not just minor adjustment)
      if (Math.abs(visibleMin - this.lastVisibleMin) < 1000 && 
          Math.abs(visibleMax - this.lastVisibleMax) < 1000) {
        return; // Skip minor adjustments
      }

      // Calculate smart 4-hour window to load
      const totalStartTime = this.getTotalTimeRange()?.startTime || 0;
      const totalEndTime = this.getTotalTimeRange()?.endTime || 0;
      
      if (totalStartTime && totalEndTime) {
        const { loadStart, loadEnd } = this.calculateLoadRange(visibleMin, visibleMax, totalStartTime, totalEndTime);
        this.checkAndLoadDataForRange(loadStart, loadEnd);
      }

      this.lastVisibleMin = visibleMin;
      this.lastVisibleMax = visibleMax;
      } catch (error: unknown) {
        console.warn('Error handling scroll event:', error);
    }
  }

  private loadInitialData(): void {
    this.matchedHeaders.forEach((logId: string) => {
      const header = this.logIdToHeader.get(logId);
      if (!header) {
        return;
      }

      const { startDateValue, endDateValue } = this.extractDateValues(header);
      const startTime = this.parseTimestamp(startDateValue!, 'start');
      const endTime = this.parseTimestamp(endDateValue!, 'end');

      if (!startTime || !endTime) {
        return;
      }

      // Smart initial load: Load 4 hours ending at the end time
      const windowSize = 4 * 3600000; // 4 hours in ms
      const initialLoadStart = endTime - windowSize;
      const initialLoadEnd = endTime;

      this.loadAdditionalData(logId, initialLoadStart, initialLoadEnd);
    });
  }

  private checkAndLoadDataForRange(visibleMin: number, visibleMax: number): void {
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

      // Use efficient min/max calculation to avoid stack overflow with large arrays
      let currentDataMin = this.indexCurveTime[0];
      let currentDataMax = this.indexCurveTime[0];
      
      for (let i = 1; i < this.indexCurveTime.length; i++) {
        const value = this.indexCurveTime[i];
        if (value < currentDataMin) currentDataMin = value;
        if (value > currentDataMax) currentDataMax = value;
      }

      console.log(`🔍 Data range check for ${logId}:`, JSON.stringify({
        visibleRange: `${new Date(visibleMin).toISOString()} to ${new Date(visibleMax).toISOString()}`,
        currentDataRange: `${new Date(currentDataMin).toISOString()} to ${new Date(currentDataMax).toISOString()}`,
        totalRange: `${new Date(totalStartTime).toISOString()} to ${new Date(totalEndTime).toISOString()}`,
        visibleMinRaw: visibleMin,
        visibleMaxRaw: visibleMax,
        currentDataMinRaw: currentDataMin,
        currentDataMaxRaw: currentDataMax,
        totalStartTimeRaw: totalStartTime,
        totalEndTimeRaw: totalEndTime
      }, null, 2));

      const edgeBufferMs = 2 * 3600000; // 2 hours
      const chunkSizeMs = 4 * 3600000; // 4 hours per chunk

      // Load earlier data when scrolling up
      if (visibleMin < currentDataMin && currentDataMin > totalStartTime) {
        // Load a chunk of data before the current range, not everything from the beginning
        const loadMin = Math.max(totalStartTime, currentDataMin - chunkSizeMs);
        const loadMax = currentDataMin;
        console.log(`⏪ Loading earlier data chunk for ${logId}: ${new Date(loadMin).toISOString()} to ${new Date(loadMax).toISOString()}`);
        this.loadAdditionalData(logId, loadMin, loadMax);
      }
      // Load later data when scrolling down
      else if (visibleMax > currentDataMax && currentDataMax < totalEndTime) {
        // Load a chunk of data after the current range, not everything to the end
        const loadMin = currentDataMax;
        const loadMax = Math.min(totalEndTime, currentDataMax + chunkSizeMs);
        console.log(`⏩ Loading later data chunk for ${logId}: ${new Date(loadMin).toISOString()} to ${new Date(loadMax).toISOString()}`);
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

    const queryParameter: { wellUid: string; logUid: string; wellboreUid: string; logName: string; indexType: string; indexCurve: string; startIndex: number; endIndex: number; isGrowing: boolean; mnemonicList: string } = {
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

    this.wellDataService.getLogData(queryParameter).subscribe(
      (response: unknown) => {
        this.appendData(response, logId);
        this.loadingLogIds.delete(logId);
      },
      (error: unknown) => {
        console.error(`❌ Error loading data for ${logId}:`, error);
        this.loadingLogIds.delete(logId);
      }
    );
  }

  private appendData(response: any, logId: string): void {
    console.log('🔧 Raw server response:', response);

    // Handle the actual response structure: {logs: [{logData: {...}}]}
    let logData: { data?: string[]; mnemonics?: string[]; logData?: any } | null = null;
    
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
      // Show user-friendly message for no data in range
      this.showNoDataMessage('No data found for the specified time range.');
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
        
        // Create mnemonics based on the configured curves for this log
        const curves = this.logIdToCurves.get(logId) || [];
        const configuredMnemonics = curves.map(c => c.mnemonicId);
        
        // Always include TIME as the first column
        const dynamicMnemonics = ['TIME', ...configuredMnemonics];
        
        // Use dynamic mnemonics if we have enough columns
        if (extractedCols.length >= dynamicMnemonics.length) {
          mnemonics = dynamicMnemonics;
          console.log('🔧 Using dynamic mnemonics from configuration:', mnemonics);
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

      logData.data!.forEach((dataRow: string, rowIndex: number) => {
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
            // Preserve user's current scroll position - don't reset to fixed window
            let visibleMin: number;
            let visibleMax: number;
            
            try {
              const currentVisible = this.wellLogWidget.getVisibleDepthLimits();
              if (currentVisible && currentVisible.getLow() > 0) {
                // Keep user's current visible range
                visibleMin = currentVisible.getLow();
                visibleMax = currentVisible.getHigh();
                console.log('📍 Preserving user scroll position:', {
                  visibleMin: new Date(visibleMin).toISOString(),
                  visibleMax: new Date(visibleMax).toISOString()
                });
              } else {
                // Only use fixed window for initial display
                visibleMin = endTime - (4 * 3600000);
                visibleMax = endTime;
                console.log('🎯 Using default 4-hour window for initial display');
              }
            } catch (error) {
              // Fallback to 4-hour window if getting visible range fails
              visibleMin = endTime - (4 * 3600000);
              visibleMax = endTime;
              console.log('⚠️ Could not get visible range, using default window');
            }
            
            console.log('🔧 Setting time-based configuration:', {
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
    
    const mergedTimes = sortedEntries.map(e => e[0]);
    const mergedValues = sortedEntries.map(e => e[1]);

    console.log(`✅ Merged data: ${mergedTimes.length} total points`);
    
    // GeoToolkit handles decimation and optimization automatically
    return {
      times: mergedTimes,
      values: mergedValues
    };
  }

  private extractDateValues(wo: IWellboreObject): { startDateValue?: string; endDateValue?: string } {
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
    } catch (error: unknown) {
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
    console.log('⏩ Scroll to latest data');
    if (this.wellLogWidget) {
      const totalRange = this.getTotalTimeRange();
      if (totalRange) {
        // Show the most recent 4 hours
        const visibleMin = totalRange.endTime - (4 * 3600000);
        const visibleMax = totalRange.endTime;
        this.wellLogWidget.setVisibleDepthLimits(visibleMin, visibleMax);
        this.wellLogWidget.updateLayout();
      }
    }
  }

  onZoomIn(): void {
    console.log('🔍 Zoom in');
    if (this.wellLogWidget) {
      // Implementation needed for zoom in
      const currentLimits = this.wellLogWidget.getVisibleDepthLimits();
      if (currentLimits) {
        const currentMin = currentLimits.getLow();
        const currentMax = currentLimits.getHigh();
        const currentRange = currentMax - currentMin;
        const newRange = currentRange / 1.5; // Zoom in by 33%
        const center = (currentMin + currentMax) / 2;
        const newMin = center - (newRange / 2);
        const newMax = center + (newRange / 2);
        
        this.wellLogWidget.setVisibleDepthLimits(newMin, newMax);
        this.wellLogWidget.updateLayout();
      }
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
    
    // Use efficient min/max calculation to avoid stack overflow with large arrays
    let startTime = this.indexCurveTime[0];
    let endTime = this.indexCurveTime[0];
    
    for (let i = 1; i < this.indexCurveTime.length; i++) {
      const value = this.indexCurveTime[i];
      if (value < startTime) startTime = value;
      if (value > endTime) endTime = value;
    }
    
    const durationMs = endTime - startTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  calculateDataPointsPerHour(): string {
    if (this.indexCurveTime.length < 2) return '0';
    
    // Use efficient min/max calculation to avoid stack overflow with large arrays
    let startTime = this.indexCurveTime[0];
    let endTime = this.indexCurveTime[0];
    
    for (let i = 1; i < this.indexCurveTime.length; i++) {
      const value = this.indexCurveTime[i];
      if (value < startTime) startTime = value;
      if (value > endTime) endTime = value;
    }
    
    const durationMs = endTime - startTime;
    const durationHours = durationMs / (1000 * 60 * 60);
    
    if (durationHours <= 0) return '0';
    
    const pointsPerHour = this.indexCurveTime.length / durationHours;
    return pointsPerHour.toFixed(1);
  }

  private getTotalTimeRange(): { startTime: number, endTime: number } | null {
    if (this.matchedHeaders.size === 0) return null;
    
    let startTime: number | null = null;
    let endTime: number | null = null;
    
    for (const logId of this.matchedHeaders) {
      const header = this.logIdToHeader.get(logId);
      if (!header) continue;
      
      const { startDateValue, endDateValue } = this.extractDateValues(header);
      const parsedStart = this.parseTimestamp(startDateValue!, 'start');
      const parsedEnd = this.parseTimestamp(endDateValue!, 'end');
      
      if (parsedStart && parsedEnd) {
        if (!startTime || parsedStart < startTime) startTime = parsedStart;
        if (!endTime || parsedEnd > endTime) endTime = parsedEnd;
      }
    }
    
    return startTime && endTime ? { startTime, endTime } : null;
  }

  private calculateLoadRange(scrollMin: number, scrollMax: number, totalStartTime: number, totalEndTime: number): { loadStart: number, loadEnd: number } {
    // Always load 4-hour windows
    const windowSize = 4 * 3600000; // 4 hours in ms
    
    // Center the window around the current scroll position
    const scrollCenter = (scrollMin + scrollMax) / 2;
    const loadStart = scrollCenter - (windowSize / 2);
    const loadEnd = scrollCenter + (windowSize / 2);
    
    // Ensure we don't go beyond total data range
    const finalLoadStart = Math.max(totalStartTime, loadStart);
    const finalLoadEnd = Math.min(totalEndTime, loadEnd);
    
    console.log(`🎯 Smart 4-hour window calculation:`, {
      scrollCenter: new Date(scrollCenter).toISOString(),
      windowStart: new Date(finalLoadStart).toISOString(),
      windowEnd: new Date(finalLoadEnd).toISOString(),
      windowSizeHours: (finalLoadEnd - finalLoadStart) / (3600000)
    });
    
    return {
      loadStart: finalLoadStart,
      loadEnd: finalLoadEnd
    };
  }
}