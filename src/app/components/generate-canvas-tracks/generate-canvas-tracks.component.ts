import { Component, Input, OnInit, ViewChild, OnDestroy, NgZone, Optional, Inject, InjectionToken } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { LogHeadersService, LogHeader, LogData } from '../../services/log-headers.service';
import { PrintPropertiesDialogComponent, PrintPropertiesData, PrintPropertiesResult } from '../print-properties-dialog/print-properties-dialog.component';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
import { from, Subscription } from 'rxjs';
import { CrossTooltipComponent, CrossTooltipData, TooltipCurveValue } from '../cross-tooltip/cross-tooltip.component';
import { CssStyle } from '@int/geotoolkit/css/CssStyle';

/** Interface for real backend API query parameters */
export interface ILogDataQueryParameter {
  wellUid: string;
  logUid: string;
  wellboreUid: string;
  logName: string;
  indexType: string;
  indexCurve: string;
  startIndex: number;
  endIndex: number;
  isGrowing: boolean;
  mnemonicList: string;
}

/**
 * Interface representing a single curve within a track.
 * Contains configuration for curve display and data.
 */
export interface TrackCurve {
  /** Mnemonic identifier for the curve (e.g., 'GR', 'RT') */
  mnemonicId: string;
  /** Display name for the curve (e.g., 'Gamma Ray', 'Resistivity') */
  displayName: string;
  /** Color for the curve line */
  color: string;
  /** Line style (e.g., 'solid', 'dashed') */
  lineStyle: string;
  /** Line width in pixels */
  lineWidth: number;
  /** Minimum value for scaling (if not auto-scale) */
  min: number;
  /** Maximum value for scaling (if not auto-scale) */
  max: number;
  /** Whether to use automatic scaling */
  autoScale: boolean;
  /** Whether the curve should be displayed */
  show: boolean;
  /** Log ID this curve belongs to */
  LogId: string;
  /** Array of numerical data values for the curve */
  data: number[];
  /** List of mnemonic information (legacy, not used) */
  mnemonicLst: any[];
}

/**
 * Interface representing a track containing one or more curves.
 * Defines the track layout and contained curves.
 */
export interface TrackInfo {
  /** Track number for ordering */
  trackNo: number;
  /** Display name for the track */
  trackName: string;
  /** Type of track (e.g., 'Linear', 'Log') */
  trackType: string;
  /** Width of the track in pixels */
  trackWidth: number;
  /** Whether this is an index track */
  isIndex: boolean;
  /** Whether this uses depth indexing */
  isDepth: boolean;
  /** Array of curves in this track */
  curves: TrackCurve[];
}

/**
 * Component responsible for generating and managing canvas tracks for well log visualization.
 * Creates a WellLogWidget with tracks and curves based on provided configuration.
 * 
 * @remarks
 * This component handles the complete lifecycle of track creation:
 * 1. Loads log headers from the API
 * 2. Matches tracks to log headers by LogId
 * 3. Loads log data for each curve
 * 4. Creates GeoToolkit tracks and curves
 * 5. Sets up proper depth limits and layout
 * 
 * The component uses a timing mechanism to ensure all async data is loaded
 * before creating the widget scene to prevent empty curves.
 */
/** Injection token for WellService */
export const WELL_SERVICE_TOKEN = new InjectionToken<any>('WellService');

@Component({
  selector: 'app-generate-canvas-tracks',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, MatDialogModule, MatButtonModule, BaseWidgetComponent, CrossTooltipComponent],
  providers: [LogHeadersService],
  template: `
    <div class="well-log-container">
      <div class="toolbar" [ngClass]="getToolbarThemeClass()">
        <label for="scaleSelect">Scale:</label>
        <select id="scaleSelect" [(ngModel)]="selectedScale" (ngModelChange)="onScaleChange($event)">
          <option *ngFor="let scale of scaleOptions" [value]="scale.value">{{ scale.label }}</option>
        </select>
        <button class="settings-btn" (click)="openPrintProperties()" title="Print Properties">&#9881;</button>
        <button class="theme-btn" (click)="toggleDarkTheme()" title="Toggle Theme">
          <i class="theme-icon" [class]="isDarkTheme ? 'fa fa-sun' : 'fa fa-moon'"></i>
        </button>
        <span class="loading-indicator" *ngIf="isLoadingChunk">Loading...</span>
      </div>
      <div class="canvas-wrapper" [ngClass]="getCanvasThemeClass()">
        <app-basewidget #canvasWidget></app-basewidget>
        <app-cross-tooltip [data]="tooltipData"></app-cross-tooltip>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .well-log-container { display: flex; flex-direction: column; width: 100%; height: 100%; }
    .toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px; background: #f5f5f5; border-bottom: 1px solid #ddd;
      font-family: Arial, sans-serif; font-size: 13px;
    }
    .toolbar label { font-weight: 600; color: #333; }
    .toolbar select {
      padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px;
      font-size: 13px; background: white; cursor: pointer;
    }
    .toolbar select:hover { border-color: #999; }
    .settings-btn {
      padding: 4px 10px; border: 1px solid #ccc; border-radius: 4px;
      background: white; cursor: pointer; font-size: 16px; line-height: 1;
      color: #555; transition: all 0.2s;
    }
    .settings-btn:hover { background: #e8e8e8; border-color: #999; color: #333; }
    .theme-btn {
      padding: 4px 10px; border: 1px solid #ccc; border-radius: 4px;
      background: white; cursor: pointer; font-size: 16px; line-height: 1;
      color: #555; transition: all 0.2s; display: flex; align-items: center; justify-content: center;
      width: 32px; height: 28px;
    }
    .theme-btn:hover { background: #e8e8e8; border-color: #999; color: #333; }
    .theme-icon { font-size: 14px; }
    .loading-indicator {
      font-size: 12px; color: #667eea; font-weight: 600; margin-left: 8px;
      animation: pulse 1s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    
    /* ==========================================
       CANVAS COLOR OPTIONS - Choose one that matches your image:
       
       OPTION 1: Dark Professional (Default)
       background: #1a1a1a;
       
       OPTION 2: Light Gray
       background: #f8f9fa;
       
       OPTION 3: Blue Professional
       background: #2c3e50;
       
       OPTION 4: Green Technical
       background: #1e3a2e;
       
       OPTION 5: White Clean
       background: #ffffff;
       
       OPTION 6: Black High Contrast
       background: #000000;
       ========================================== */
    
    .canvas-wrapper { 
      flex: 1; 
      min-height: 0; 
      position: relative; 
      overflow: hidden; 
      height: 400px; 
      background: #808080; /* Gray background */
      transition: background-color 0.3s ease;
    }
    .canvas-wrapper.dark-theme { 
      background: #1a1a1a; /* Dark theme background */
    }
    .canvas-wrapper.light-theme { 
      background: #f8f9fa; /* Light theme background */
    }
    .canvas-wrapper app-basewidget { 
      width: 100%; 
      height: 100%; 
    }
    .canvas-wrapper ::ng-deep .basewidget-container {
      background: #808080; /* Gray background */
      transition: background-color 0.3s ease;
    }
    .canvas-wrapper.dark-theme ::ng-deep .basewidget-container {
      background: #1a1a1a; /* Dark theme background */
    }
    .canvas-wrapper.light-theme ::ng-deep .basewidget-container {
      background: #f8f9fa; /* Light theme background */
    }
    .canvas-wrapper ::ng-deep .plot-canvas {
      background: #808080; /* Gray background */
      transition: background-color 0.3s ease;
    }
    .canvas-wrapper.dark-theme ::ng-deep .plot-canvas {
      background: #1a1a1a; /* Dark theme background */
    }
    .canvas-wrapper.light-theme ::ng-deep .plot-canvas {
      background: #f8f9fa; /* Light theme background */
    }
    
    /* Theme-specific toolbar styles */
    .toolbar.dark-theme {
      background: #2d3748; border-bottom: 1px solid #4a5568;
    }
    .toolbar.dark-theme label { color: #e2e8f0; }
    .toolbar.dark-theme .settings-btn,
    .toolbar.dark-theme .theme-btn {
      background: #4a5568; border-color: #718096; color: #e2e8f0;
    }
    .toolbar.dark-theme .settings-btn:hover,
    .toolbar.dark-theme .theme-btn:hover {
      background: #718096; border-color: #a0aec0; color: #fff;
    }
    .toolbar.light-theme {
      background: #ffffff; border-bottom: 1px solid #e2e8f0;
    }
    .toolbar.light-theme label { color: #2d3748; }
    .toolbar.light-theme .settings-btn,
    .toolbar.light-theme .theme-btn {
      background: #f7fafc; border-color: #cbd5e0; color: #4a5568;
    }
    .toolbar.light-theme .settings-btn:hover,
    .toolbar.light-theme .theme-btn:hover {
      background: #edf2f7; border-color: #a0aec0; color: #2d3748;
    }
  `]
})
export class GenerateCanvasTracksComponent implements OnInit, OnDestroy {
  /** Array of track configurations to display */
  @Input() listOfTracks: TrackInfo[] = [];
  /** Unique identifier for the well */
  @Input() well: string = '';
  /** Unique identifier for the wellbore */
  @Input() wellbore: string = '';

  /** Whether the current data is time-based (detected from headers/config) */
  private isTimeBasedData = false;
  /** Current index type for the well log (time or depth) */
  private indexType: IndexType = IndexType.Depth;
  /** Stores the raw header start/end index strings for time-based API calls */
  private headerStartIndex = '';
  private headerEndIndex = '';

  /** Reference to the base widget component that hosts the canvas */
  @ViewChild('canvasWidget', { static: true })
  private widgetComponent!: BaseWidgetComponent;
  
  /** GeoToolkit WellLogWidget instance for rendering tracks and curves */
  private wellLogWidget!: WellLogWidget;
  /** Array of subscriptions to manage cleanup */
  private subscriptions: Subscription[] = [];
  /** Counter for tracking pending data loads */
  private pendingLoads = 0;
  /** Loading state indicator */
  isLoading = false;
  /** Loading state for chunk fetches */
  isLoadingChunk = false;

  /** Available depth scale options (meters per screen height) */
  scaleOptions = [
    { label: '1:100', value: 100 },
    { label: '1:200', value: 200 },
    { label: '1:500', value: 500 },
    { label: '1:1,000', value: 1000 },
    { label: '1:2,000', value: 2000 },
    { label: '1:3,000', value: 3000 },
    { label: '1:4,000', value: 4000 },
    { label: '1:6,000', value: 6000 },
    { label: '1:10,000', value: 10000 },
    { label: '1:16,000', value: 16000 },
    { label: 'Fit to Height', value: 0 },
  ];

  /** Currently selected depth scale value */
  selectedScale: number = 1000;

  /** Theme state */
  isDarkTheme = false;

  /** Tooltip data for the cross-tooltip component */
  tooltipData: CrossTooltipData | null = null;

  /** Map of curve mnemonic to GeoToolkit LogCurve reference for crosshair lookup */
  private curveMap: Map<string, { logCurve: LogCurve; info: TrackCurve; trackName: string }> = new Map();

  // --- Chunked loading state ---
  /** Cached log headers for lazy loading */
  private cachedHeaders: LogHeader[] = [];
  /** Number of depth/time rows per chunk */
  private readonly CHUNK_SIZE = 2000;
  /** Time chunk size in milliseconds (4 hours) */
  private readonly TIME_CHUNK_SIZE = 4 * 60 * 60 * 1000; // 4 hours in ms
  /** The overall max depth from headers (not from loaded data) */
  private headerMaxDepth = 0;
  /** Tracks which depth ranges have been loaded per curve */
  private loadedRanges: Map<string, { min: number; max: number }> = new Map();
  /** Depth indices per curve (parallel to data values) */
  private curveDepthIndices: Map<string, number[]> = new Map();
  /** Tracks in-flight chunk ranges to prevent duplicate requests */
  private inFlightRanges: Set<string> = new Set();

  /** Handle for the scroll polling interval */
  private scrollPollHandle: any = null;

  /** Handle for debounced index track updates */
  private indexTrackUpdateTimeout: any = null;

  // --- Dynamic Width Recalculation ---
  /** Handle for window resize timeout (debouncing) */
  private resizeTimeout: any = null;
  /** Last known container width for change detection */
  private lastContainerWidth: number = 0;
  /** Minimum width threshold to trigger recalculation */
  private readonly WIDTH_CHANGE_THRESHOLD = 50; // 50px minimum change
  /** Resize debounce delay in milliseconds */
  private readonly RESIZE_DEBOUNCE_DELAY = 300;

  // --- Live polling state ---
  /** Handle for live data polling interval */
  private livePollHandle: any = null;
  /** Live polling interval in milliseconds */
  private readonly LIVE_POLL_INTERVAL = 5000;
  /** Flag to enable/disable live data polling */
  private isLivePolling = false;
  /** Real backend wellbore objects with dynamic endIndex */
  private wellboreObjects: any[] = [];

  /**
   * Creates an instance of GenerateCanvasTracksComponent.
   * @param logHeadersService - Service for fetching log headers and data
   */
  constructor(
    private logHeadersService: LogHeadersService,
    @Optional() @Inject(WELL_SERVICE_TOKEN) private wellService: any,
    private dialog: MatDialog,
    private ngZone: NgZone
  ) {}

  /**
   * Angular lifecycle hook called after component initialization.
   * Initiates the process of loading log headers and creating tracks.
   */
  ngOnInit(): void {
    console.log('🎨 Generate Canvas Tracks Component initialized');
    console.log('📊 Input tracks:', this.listOfTracks);
    
    // Initialize window resize listener for dynamic width adjustment
    this.initializeWindowResizeListener();
    
    this.loadLogHeadersAndCreateTracks();
  }

  /**
   * Angular lifecycle hook called before component destruction.
   * Cleans up all subscriptions to prevent memory leaks.
   */
  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.scrollPollHandle) {
      clearInterval(this.scrollPollHandle);
      this.scrollPollHandle = null;
    }
    if (this.indexTrackUpdateTimeout) {
      clearTimeout(this.indexTrackUpdateTimeout);
      this.indexTrackUpdateTimeout = null;
    }
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
    // Remove window resize listener
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    this.stopLivePolling();
  }

  /**
   * Loads log headers from the service and initiates track creation process.
   * Validates required parameters and handles loading states.
   * 
   * @private
   */
  private loadLogHeadersAndCreateTracks(): void {
    if (!this.well || !this.wellbore) {
      console.error('❌ Well and wellbore parameters are required');
      return;
    }

    this.isLoading = true;
    
    if (this.wellService) {
      // Real backend path - use wellService
      console.log('🔌 Using real WellService backend');
      this.wellService.getLogHeaders(this.well, this.wellbore).subscribe({
        next: (wellboreObjects: any[]) => {
          console.log('📊 Wellbore Objects loaded:', wellboreObjects);
          
          // Convert wellboreObjects to LogHeader format for compatibility
          const headers = wellboreObjects.map((obj: any): any => ({
            '@uidWell': obj.wellUid,
            '@uidWellbore': obj.wellboreUid,
            uid: obj.logUid,
            name: obj.logName,
            nameWell: obj.wellName || obj.wellUid,
            nameWellbore: obj.wellboreName || obj.wellboreUid,
            creationDate: obj.creationDate || new Date().toISOString(),
            dataDelimiter: obj.dataDelimiter || ',',
            direction: obj.direction || 'increasing',
            objectGrowing: obj.isGrowing ? 'true' : 'false',
            indexType: obj.indexType,
            indexCurve: obj.indexCurve,
            endIndex: {
              '@uom': obj.indexType === 'depth' ? 'm' : 's',
              '#text': obj.endIndex.toString()
            },
            startIndex: {
              '@uom': obj.indexType === 'depth' ? 'm' : 's',
              '#text': obj.startIndex.toString()
            },
            logCurveInfo: []
          }));
          
          this.cachedHeaders = headers;
          
          // Detect time-based data before processing headers
          this.detectTimeBasedData();
          this.processLogHeaders(headers);
          
          // Store wellboreObjects for live data access
          this.wellboreObjects = wellboreObjects;
          
          this.isLoading = false;
        },
        error: (err: any) => {
          console.error('❌ Error loading wellbore objects:', err);
          this.isLoading = false;
        }
      });
    } else {
      // Use HTTP service for real API calls
      console.log('🌐 Loading log headers via HTTP service');
      
      // First, do a quick check if we have time-based tracks
      const hasTimeBasedTracks = this.listOfTracks.some(track => 
        track.curves.some(curve => 
          (curve.LogId && (curve.LogId.toLowerCase().includes('time') || curve.LogId.toLowerCase().includes('mwd_time')))
        )
      );
      
      console.log(`🔍 Quick check - has time-based tracks: ${hasTimeBasedTracks}`);
      
      // Use appropriate endpoint based on track analysis
      const headersObservable = hasTimeBasedTracks 
        ? this.logHeadersService.getTimeLogHeaders(this.well, this.wellbore)
        : this.logHeadersService.getLogHeaders(this.well, this.wellbore);
      
      headersObservable.subscribe({
        next: (headers) => {
          console.log(`📋 Loaded ${headers.length} log headers via HTTP (${hasTimeBasedTracks ? 'time-based' : 'depth-based'} endpoint)`);
          this.cachedHeaders = headers;
          
          // Detect time-based data before processing headers
          this.detectTimeBasedData();
          this.processLogHeaders(headers);
        },
        error: (error) => {
          console.error('❌ Error loading log headers via HTTP:', error);
          console.log('🔄 Falling back to mock headers for demo');
          const mockHeaders = this.createMockHeaders();
          this.cachedHeaders = mockHeaders;
          
          // Detect time-based data before processing headers
          this.detectTimeBasedData();
          this.processLogHeaders(mockHeaders);
        }
      });
    }
  }

  /**
   * Creates mock log headers for demo purposes.
   * Generates LogHeader objects that match the expected structure.
   * 
   * @private
   */
  private createMockHeaders(): LogHeader[] {
    console.log('🔧 Creating mock headers for demo...');
    
    // Extract unique LogIds from tracks to create matching headers
    const uniqueLogIds = new Set<string>();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        if (curve.LogId) {
          uniqueLogIds.add(curve.LogId);
        }
      });
    });
    
    console.log('📋 Found LogIds in tracks:', Array.from(uniqueLogIds));
    
    // Create mock headers for each unique LogId
    const mockHeaders: LogHeader[] = Array.from(uniqueLogIds).map((logId, index) => {
      // Check if this should be time-based by looking at the LogId itself
      const logIdLower = logId.toLowerCase();
      const isTimeBased = logIdLower.includes('time') || logIdLower.includes('mwd_time');
      
      console.log(`🔍 Creating mock header for ${logId}, isTimeBased: ${isTimeBased}`);
      
      const baseHeader = {
        '@uidWell': this.well || 'demo-well',
        '@uidWellbore': this.wellbore || 'demo-wellbore',
        uid: logId,
        name: logId, // Use the actual LogId as name for detection
        nameWell: this.well || 'Demo Well',
        nameWellbore: this.wellbore || 'Demo Wellbore',
        creationDate: new Date().toISOString(),
        dataDelimiter: ',',
        direction: 'increasing',
        objectGrowing: 'false',
        logCurveInfo: []
      };

      if (isTimeBased) {
        // Time-based mock header with proper February 2025 dates
        return {
          ...baseHeader,
          indexType: 'date time',
          indexCurve: 'TIME',
          endDateTimeIndex: '2025-02-11T06:13:15.000Z',
          startDateTimeIndex: '2025-02-04T18:13:15.000Z',
          endIndex: {
            '@uom': 'ms',
            '#text': '1739254395000'
          },
          startIndex: {
            '@uom': 'ms',
            '#text': '1738692795000'
          }
        };
      } else {
        // Depth-based mock header
        return {
          ...baseHeader,
          indexType: 'measured depth',
          indexCurve: 'DEPTH',
          endIndex: {
            '@uom': 'm',
            '#text': '10000'
          },
          startIndex: {
            '@uom': 'm',
            '#text': '0'
          }
        };
      }
    });

    console.log('✅ Mock headers created:', mockHeaders.length, 'headers for LogIds:', mockHeaders.map(h => h.uid));
    return mockHeaders;
  }

  /**
   * Processes loaded log headers and initiates data loading.
   * Groups curves by LogId to avoid duplicate API calls — one call per unique LogId.
   * 
   * @param headers - Array of loaded log headers
   * @private
   */
  private processLogHeaders(headers: LogHeader[]): void {
    // Store raw header start/end index strings for time-based API calls
    if (this.isTimeBasedData && headers.length > 0) {
      this.headerStartIndex = headers[0].startDateTimeIndex || '';
      this.headerEndIndex = headers[0].endDateTimeIndex || '';
      console.log('🕐 Stored time-based header indices:', this.headerStartIndex, 'to', this.headerEndIndex);
    }

    // Determine overall max depth/time from headers
    headers.forEach(h => {
      let end: number;
      if (this.isTimeBasedData) {
        // For time-based data, convert ISO string to timestamp
        if (h.endDateTimeIndex) {
          try {
            end = new Date(h.endDateTimeIndex).getTime();
            if (isNaN(end) || end <= 0) {
              console.warn(`⚠️ Invalid endDateTimeIndex in header: ${h.endDateTimeIndex}, using 0`);
              end = 0;
            }
          } catch (error) {
            console.warn(`⚠️ Error parsing endDateTimeIndex: ${h.endDateTimeIndex}, using 0`);
            end = 0;
          }
        } else {
          console.warn(`⚠️ Missing endDateTimeIndex in header, using 0`);
          end = 0;
        }
      } else {
        // For depth-based data, parse endIndex as number
        const endIndexValue = typeof h.endIndex === 'object' ? h.endIndex?.['#text'] : h.endIndex;
        end = parseFloat(endIndexValue || '0');
        if (isNaN(end) || end <= 0) {
          console.warn(`⚠️ Invalid endIndex in header: ${h.endIndex}, using 0`);
          end = 0;
        }
      }
      
      if (end > this.headerMaxDepth) {
        this.headerMaxDepth = end;
      }
    });
    
    console.log(`📊 Header max ${this.isTimeBasedData ? 'time' : 'depth'}: ${this.headerMaxDepth}`);

    // Group all curves by LogId to avoid duplicate API calls
    const logIdGroups = new Map<string, { header: LogHeader; curves: TrackCurve[] }>();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        const matchingHeader = headers.find(header => header.uid === curve.LogId);
        if (matchingHeader) {
          if (!logIdGroups.has(curve.LogId)) {
            logIdGroups.set(curve.LogId, { header: matchingHeader, curves: [] });
          }
          logIdGroups.get(curve.LogId)!.curves.push(curve);
        }
      });
    });

    // One pending load per unique LogId (not per curve)
    this.pendingLoads = logIdGroups.size;
    console.log(`🔄 ${this.pendingLoads} unique LogId(s) to fetch (chunk size: ${this.CHUNK_SIZE})`);

    // Load initial chunk per LogId: most recent data
    logIdGroups.forEach(({ header, curves }, logId) => {
      // Debug logging for MWD_Time logs
      const isMwdTime = (header.name || header.uid || '').toLowerCase().includes('mwd_time');
      if (isMwdTime) {
        console.log(`🔍 MWD_Time processing:`, {
          logId,
          isTimeBasedData: this.isTimeBasedData,
          indexType: this.indexType,
          header: {
            uid: header.uid,
            name: header.name,
            indexType: header.indexType,
            indexCurve: header.indexCurve,
            endDateTimeIndex: header.endDateTimeIndex,
            endIndex: header.endIndex
          }
        });
      }
      
      let endIndex: number;
      let startIndex: number;
      
      if (this.isTimeBasedData) {
        // For time-based data, work with timestamps and 4-hour chunks
        let endTime: number;
        let startTime: number;
        
        try {
          // Parse endTime from endDateTimeIndex with fallback
          const endTimeStr = header.endDateTimeIndex || new Date().toISOString();
          endTime = new Date(endTimeStr).getTime();
          
          if (isNaN(endTime) || endTime <= 0) {
            console.warn(`⚠️ Invalid endDateTimeIndex from header: ${endTimeStr}, using current time`);
            endTime = Date.now();
          }
          
          // Check if the endTime is in the future (indicating cached old data)
          // If so, use the actual data range from this.headerMaxDepth
          const currentTime = Date.now();
          if (endTime > currentTime) {
            console.warn(`⚠️ Header endDateTimeIndex ${endTimeStr} is in the future, using headerMaxDepth: ${this.headerMaxDepth}`);
            // Use the actual data range from headerMaxDepth (should be 1739254395000)
            endTime = this.headerMaxDepth || Date.now();
          }
          
          // For time-based, load most recent 4 hours
          startTime = endTime - this.TIME_CHUNK_SIZE;
          
        } catch (error) {
          console.error(`❌ Error parsing time-based indices:`, error);
          // Fallback to current time minus 4 hours
          endTime = Date.now();
          startTime = endTime - this.TIME_CHUNK_SIZE;
        }
        
        endIndex = endTime;
        startIndex = startTime;
      } else {
        // For depth-based data, use headerMaxDepth for full range
        const headerEndIndexValue = typeof header.endIndex === 'object' ? header.endIndex?.['#text'] : header.endIndex;
        endIndex = this.headerMaxDepth || parseFloat(headerEndIndexValue || '1000');
        startIndex = Math.max(0, endIndex - this.CHUNK_SIZE);
      }
      
      console.log(`📦 Loading initial chunk for LogId ${logId}: ${startIndex}-${endIndex} (${curves.length} curves)`);
      this.loadLogDataForGroup(header, curves, startIndex, endIndex);
    });
  }

  /**
   * Intelligently determines the correct index type for a log header.
   * Uses multiple heuristics to detect time-based vs depth-based data,
   * even when header metadata is inconsistent.
   * 
   * @param header - Log header to analyze
   * @returns Correct index type string ('date time' or 'measured depth')
   * @private
   */
  private getIndexTypeForLog(header: LogHeader): string {
    // Special logging for MWD_Time logs
    const logNameLower = (header.name || header.uid || '').toLowerCase();
    const isMwdTime = logNameLower.includes('mwd_time') || logNameLower.includes('mwdtime');
    
    if (isMwdTime) {
      console.log(`🔍 MWD_Time log detected - analyzing header:`, {
        uid: header.uid,
        name: header.name,
        indexType: header.indexType,
        indexCurve: header.indexCurve,
        startIndex: header.startIndex,
        endIndex: header.endIndex
      });
      // FORCE TIME-BASED FOR MWD_Time
      console.log(`🕐 FORCING time-based detection for MWD_Time log: ${header.uid}`);
      return 'date time';
    }
    
    // METHOD 1: Check if log name/uid contains time indicators
    if (logNameLower.includes('time') || logNameLower.includes('mwd_time')) {
      console.log(`🕐 Time-based data detected from log name/uid: ${header.name || header.uid}`);
      return 'date time';
    }
    
    // METHOD 2: Check index curve name
    const indexCurveLower = (header.indexCurve || '').toLowerCase();
    if (indexCurveLower.includes('time')) {
      console.log(`🕐 Time-based data detected from index curve: ${header.indexCurve}`);
      return 'date time';
    }
    
    // METHOD 3: Check header indexType for time indicators
    const indexTypeLower = (header.indexType || '').toLowerCase();
    if (indexTypeLower.includes('time') || indexTypeLower.includes('date')) {
      console.log(`🕐 Time-based data detected from indexType: ${header.indexType}`);
      return 'date time';
    }
    
    // METHOD 4: Check if index curve is TIME and units are time-based
    if (indexCurveLower === 'time') {
      console.log(`🕐 Time-based data detected from index curve 'TIME': ${header.indexCurve}`);
      return 'date time';
    }
    
    // METHOD 5: Check units in startIndex/endIndex for time indicators
    const startUnit = typeof header.startIndex === 'object' ? header.startIndex?.['@uom']?.toLowerCase() : '';
    const endUnit = typeof header.endIndex === 'object' ? header.endIndex?.['@uom']?.toLowerCase() : '';
    if (startUnit?.includes('s') || endUnit?.includes('s') || startUnit?.includes('time') || endUnit?.includes('time')) {
      console.log(`🕐 Time-based data detected from index units: start=${startUnit}, end=${endUnit}`);
      return 'date time';
    }
    
    // Default to depth-based
    console.log(`📏 Depth-based data detected (default) for log: ${header.name || header.uid}`);
    return 'measured depth';
  }

  /**
   * Loads log data for a group of curves that share the same LogId.
   * Makes one API call and distributes data to all curves in the group.
   * 
   * @param header - Log header containing metadata
   * @param curves - All curves sharing this LogId
   * @param startIndex - Starting index for data range
   * @param endIndex - Ending index for data range
   * @private
   */
  private loadLogDataForGroup(header: LogHeader, curves: TrackCurve[], startIndex: number, endIndex: number): void {
    const isMwdTime = (header.name || header.uid || '').toLowerCase().includes('mwd_time');
    console.log(`🔄 Loading data for LogId: ${header.uid}, range: ${startIndex}-${endIndex}, isTimeBased: ${this.isTimeBasedData}, isMwdTime: ${isMwdTime}`);
    
    // Convert timestamps back to ISO strings for time-based API calls
    let apiStartIndex: any = startIndex;
    let apiEndIndex: any = endIndex;
    
    if (this.isTimeBasedData) {
      console.log(`🕐 Converting to time-based API: startIndex=${startIndex}, endIndex=${endIndex}`);
      
      // Validate timestamps before creating Date objects
      if (isNaN(startIndex) || startIndex <= 0) {
        console.warn(`⚠️ Invalid startIndex: ${startIndex}, using current time`);
        startIndex = Date.now();
      }
      if (isNaN(endIndex) || endIndex <= 0) {
        console.warn(`⚠️ Invalid endIndex: ${endIndex}, using current time`);
        endIndex = Date.now();
      }
      
      try {
        apiStartIndex = new Date(startIndex).toISOString();
        apiEndIndex = new Date(endIndex).toISOString();
        console.log(`🕐 Time-based API call: ${apiStartIndex} to ${apiEndIndex}`);
      } catch (error) {
        console.error(`❌ Error converting timestamps to ISO:`, error);
        // Fallback to current time
        const now = new Date();
        apiStartIndex = new Date(now.getTime() - 3600000).toISOString(); // 1 hour ago
        apiEndIndex = now.toISOString();
        console.log(`🕐 Fallback time-based API call: ${apiStartIndex} to ${apiEndIndex}`);
      }
    } else {
      console.log(`📏 Using depth-based API: startIndex=${startIndex}, endIndex=${endIndex}`);
    }
    
    // Prepare queryParameter for real backend API
    const queryParameter: ILogDataQueryParameter = {
      wellUid: this.well,
      logUid: header.uid,
      wellboreUid: this.wellbore,
      logName: header.name,
      indexType: this.getIndexTypeForLog(header),
      indexCurve: header.indexCurve,
      startIndex: apiStartIndex,
      endIndex: apiEndIndex,
      isGrowing: true, // Convert string to boolean
      mnemonicList: '',
    };
    
    if (isMwdTime) {
      console.log(`🔍 MWD_Time API parameters:`, queryParameter);
    }
    
    const onData = (logData: LogData) => {
      curves.forEach(curve => this.parseCurveData(logData, curve, false));
    };
    const onComplete = () => {
      console.log(`🔄 onComplete called - pendingLoads before: ${this.pendingLoads}`);
      this.pendingLoads--;
      console.log(`⏳ Pending loads remaining: ${this.pendingLoads}`);
      if (this.pendingLoads <= 0) {
        console.log('🎯 All data loaded - creating scene');
        this.createSceneWithData();
      }
    };
    const onError = (err: any) => {
      console.error('❌ Error loading log data for LogId:', header.uid, err);
      onComplete();
    };

    if (this.wellService) {
      // Real backend path
      this.wellService.getLogData(queryParameter).subscribe({
        next: (logDataArray: any) => {
          if (logDataArray.length > 0) {
            onData(logDataArray[0]);
          } else {
            console.warn(`⚠️ No log data found for LogId: ${header.uid}`);
          }
          onComplete();
        },
        error: onError
      });
    } else {
      // HTTP service fallback
      console.log(`🌐 Using HTTP service for ${this.isTimeBasedData ? 'time' : 'depth'} log data`);
      if (this.isTimeBasedData) {
        this.logHeadersService.getTimeLogData(this.well, this.wellbore, header.uid, apiStartIndex, apiEndIndex).subscribe({
          next: (logDataArray: LogData[]) => {
            if (logDataArray.length > 0) {
              onData(logDataArray[0]);
            } else {
              console.warn(`⚠️ No time log data found for LogId: ${header.uid}`);
            }
            onComplete();
          },
          error: onError
        });
      } else {
        this.logHeadersService.getLogData(this.well, this.wellbore, header.uid, apiStartIndex, apiEndIndex).subscribe({
          next: (logDataArray: LogData[]) => {
            if (logDataArray.length > 0) {
              onData(logDataArray[0]);
            } else {
              console.warn(`⚠️ No depth log data found for LogId: ${header.uid}`);
            }
            onComplete();
          },
          error: onError
        });
      }
    }
  }

  /**
   * Parses raw log data and extracts values for a specific curve.
   * Also stores depth indices for each curve for correct mapping.
   * 
   * @param logData - Log data containing raw data strings and metadata
   * @param curve - Track curve object to populate with parsed data
   * @param decrementPending - Whether to decrement pendingLoads counter (false when called from group loader)
   * @private
   */
  private parseCurveData(logData: LogData, curve: TrackCurve, decrementPending: boolean = true): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex(m => m.trim() === curve.mnemonicId);
    
    // Look for both TIME and DEPTH index columns
    const depthIndex = mnemonics.findIndex(m => m.trim() === 'DEPTH');
    const timeIndex = mnemonics.findIndex(m => m.trim() === 'TIME');
    const indexIndex = mnemonics.findIndex(m => m.trim() === 'INDEX');
    
    // Use appropriate index based on data type
    let indexColumn = -1;
    if (this.isTimeBasedData) {
      indexColumn = timeIndex !== -1 ? timeIndex : indexIndex;
    } else {
      indexColumn = depthIndex !== -1 ? depthIndex : indexIndex;
    }
    
    console.log(`🔍 Parsing ${curve.mnemonicId}:`, {
      availableMnemonics: mnemonics,
      curveIndex,
      indexColumn,
      isTimeBased: this.isTimeBasedData,
      dataRows: logData.data?.length || 0
    });
    
    if (curveIndex === -1) {
      console.warn('⚠️ Mnemonic not found:', curve.mnemonicId);
      return;
    }

    const indices: number[] = [];
    const values: number[] = [];

    logData.data.forEach((dataRow) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const value = parseFloat(cols[curveIndex]);
        const index = indexColumn >= 0 ? parseFloat(cols[indexColumn]) : NaN;
        if (!isNaN(value) && !isNaN(index)) {
          indices.push(index);
          values.push(value);
        }
      }
    });

    curve.data = values;
    this.curveDepthIndices.set(curve.mnemonicId, indices);

    // Track loaded range
    if (indices.length > 0) {
      this.loadedRanges.set(curve.mnemonicId, {
        min: indices[0],
        max: indices[indices.length - 1],
      });
    }

    console.log('✅ Parsed data for curve:', curve.mnemonicId, values.length, 'points',
      indices.length > 0 ? `${this.isTimeBasedData ? 'time' : 'depth'} range: ${indices[0]}-${indices[indices.length - 1]}` : '');

    // Only decrement pending loads when called directly (not from group loader)
    if (decrementPending) {
      this.pendingLoads--;
      console.log(`⏳ Pending loads remaining: ${this.pendingLoads}`);
      if (this.pendingLoads <= 0) {
        console.log('🎯 All data loaded - updating scene');
        this.createSceneWithData();
      }
    }
  }

  /**
   * Creates the scene with loaded data and sets proper depth limits.
   * Called after all data has been loaded to ensure data is available.
   * 
   * @private
   */
  private createSceneWithData(): void {
    try {
      console.log('🔧 Creating scene with loaded data');

      this.curveMap.clear();

      // Create WellLogWidget
      this.wellLogWidget = new WellLogWidget({
        indextype: this.indexType,
        indexunit: this.isTimeBasedData ? 'ms' : 'ft',
        horizontalscrollable: false,
        verticalscrollable: true,
        header: {
          visible: true,
          height: 80
        },
        viewcache: true,
        trackcontainer: {
          border: { visible: true }
        }
      });

      // Enable rubber band zoom tool by default (simple implementation like demo)
      const rubberBandTool = this.wellLogWidget.getToolByName('rubberband');
      if (rubberBandTool) {
        rubberBandTool.setEnabled(true);
        
        // Add event listener to keep tool enabled and handle state changes
        rubberBandTool.on('enabledStateChanged', (evt: any, tool: any) => {
          console.log('🔲 Rubber band tool state changed:', tool.isEnabled());
          // Re-enable if it gets disabled after zoom
          if (!tool.isEnabled()) {
            setTimeout(() => {
              tool.setEnabled(true);
              console.log('🔲 Rubber band tool re-enabled');
            }, 100);
          }
        });
        
        console.log('✅ Rubber band zoom enabled by default');
      }
      
      // Disable conflicting tools that might interfere with rubber band zoom
      ['TrackZoom', 'TrackPanning', 'pick'].forEach((toolName) => {
        const tool = this.wellLogWidget.getToolByName(toolName);
        if (tool) {
          tool.setEnabled(false);
          console.log(`🔧 Disabled conflicting tool: ${toolName}`);
        }
      });

      this.wellLogWidget.setLayoutStyle({
        left: 0, top: 0, right: 0, bottom: 0
      });

      // Create index track first to ensure it's always visible
      // Commented out - will create real depth/time-based index tracks from WITSML data
      // const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
      // indexTrack.setWidth(60);
      // indexTrack.setName('Depth');

      // Assign widget to BaseWidgetComponent
      this.widgetComponent.Widget = this.wellLogWidget;
      console.log('✅ Widget assigned to BaseWidgetComponent');

      // Apply initial theme styling to GeoToolkit elements
      this.applyGeoToolkitTheme();

      // Create data tracks
      this.createTracks();

      // Set depth limits, show recent data first, and configure crosshair + scroll listener
      setTimeout(() => {
        try {
          // Use headerMaxDepth for full range so scroll works beyond loaded data
          const fullMaxDepth = this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();
          console.log('📊 Depth ranges - headerMaxDepth:', this.headerMaxDepth, 'getMaxDepth():', this.getMaxDepth(), 'fullMaxDepth:', fullMaxDepth);
          console.log('📊 Setting depth limits: 0 to', fullMaxDepth);
          this.wellLogWidget.setDepthLimits(0, fullMaxDepth);

          // Show recent data first: scroll to bottom of loaded data
          const loadedMax = this.getMaxDepth();
          console.log('📊 Loaded max depth:', loadedMax, 'selectedScale:', this.selectedScale);
          
          if (this.selectedScale > 0 && this.selectedScale < loadedMax) {
            const visibleRange = this.selectedScale;
            const recentStart = loadedMax - visibleRange;
            console.log('📊 Setting visible limits:', recentStart, 'to', loadedMax, '(range:', visibleRange, ')');
            this.wellLogWidget.setVisibleDepthLimits(recentStart, loadedMax);
          } else {
            console.log('📊 Applying scale:', this.selectedScale);
            this.applyScale(this.selectedScale);
          }

          // Get current visible limits for debugging
          const currentVisible = this.wellLogWidget.getVisibleDepthLimits();
          console.log('📊 Current visible limits after setup:', currentVisible);

          this.wellLogWidget.updateLayout();

          // Ensure the widget takes full width on initial load
          // Force recalculation by resetting lastContainerWidth
          console.log('🔄 Triggering initial width calculation for full width display');
          this.lastContainerWidth = 0; // Reset to force recalculation
          this.recalculateTrackWidths();
          
          setTimeout(() => {
            console.log('🔄 Triggering delayed width calculation for full width display');
            this.lastContainerWidth = 0; // Reset to force recalculation
            this.recalculateTrackWidths();
          }, 100);

          // Configure crosshair for tooltip - DELAYED to ensure all data is fully initialized
          setTimeout(() => {
            // Force widget update to ensure all curves are properly attached
            console.log('🔄 Forcing widget update before crosshair setup...');
            this.wellLogWidget.updateLayout();
            
            // Check curve data status
            console.log('📊 Checking curve data status...');
            this.curveMap.forEach((entry, mnemonic) => {
              const { logCurve } = entry;
              if (logCurve && logCurve.getDataSource) {
                const dataSource = logCurve.getDataSource();
                const size = dataSource ? dataSource.getSize() : 0;
                console.log(`📊 Curve ${mnemonic}: dataSource=${!!dataSource}, size=${size}`);
              }
            });
            
            // Now configure crosshair after ensuring data is ready
            console.log('🎯 Configuring crosshair after widget update...');
            this.configureCrossHair();
          }, 1000);

          // Configure scroll-based lazy loading
          this.configureScrollLazyLoad();

          console.log('✅ Scene created with data successfully');
        } catch (error) {
          console.error('❌ Error setting depth limits:', error);
        }
      }, 100);

    } catch (error) {
      console.error('❌ Error creating scene with data:', error);
    }
  }

  /** Last known visible depth range for change detection */
  private lastVisibleMin = -1;
  private lastVisibleMax = -1;

  /**
   * Configures scroll-based lazy loading.
   * Uses polling of visible depth limits instead of wheel events,
   * because GeoToolkit handles scroll internally and may not propagate wheel events.
   * 
   * @private
   */
  private configureScrollLazyLoad(): void {
    console.log('🔄 Configuring scroll lazy loading...');
    
    // Initialize the last visible range to prevent immediate false triggers
    try {
      const initialLimits: any = this.wellLogWidget.getVisibleDepthLimits();
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
    
    // Poll every 1000ms for visible depth changes (reduced frequency to prevent hangs)
    this.scrollPollHandle = setInterval(() => {
      if (!this.wellLogWidget) return;
      try {
        const visibleLimits: any = this.wellLogWidget.getVisibleDepthLimits();
        if (!visibleLimits) return;
        const vMin = visibleLimits.getLow ? visibleLimits.getLow() : 0;
        const vMax = visibleLimits.getHigh ? visibleLimits.getHigh() : 0;

        // Skip invalid ranges (0-0 indicates widget not ready)
        if (vMin === 0 && vMax === 0) {
          return;
        }

        // Only trigger if visible range actually changed beyond tolerance
        const tolerance = 5.0; // Reduced tolerance for more responsive loading
        const minDiff = Math.abs(vMin - this.lastVisibleMin);
        const maxDiff = Math.abs(vMax - this.lastVisibleMax);
        
        // Detect scroll direction and prioritize accordingly
        const scrollDirection = vMin < this.lastVisibleMin ? 'up' : 
                               vMax > this.lastVisibleMax ? 'down' : 'none';
        
        if (minDiff > tolerance || maxDiff > tolerance) {
          console.log(`📜 Scroll ${scrollDirection}: ${this.lastVisibleMin.toFixed(1)}-${this.lastVisibleMax.toFixed(1)} → ${vMin.toFixed(1)}-${vMax.toFixed(1)} (diff: ${minDiff.toFixed(1)}, ${maxDiff.toFixed(1)})`);
          this.lastVisibleMin = vMin;
          this.lastVisibleMax = vMax;
          
          // Only use specialized scroll-up loading when scrolling up
          if (scrollDirection === 'up') {
            this.ngZone.run(() => this.checkAndLoadScrollUpChunks());
          } else {
            // Use existing chunk loading logic for scroll-down and other cases
            this.ngZone.run(() => this.checkAndLoadChunks());
          }
        }
      } catch (error) { 
        // Silently handle errors to reduce console spam
      }
    }, 300); // Match dynamic-track-generator frequency
    
    console.log('✅ Scroll polling configured with reduced frequency');
  }

  /**
   * Specialized method for loading chunks when scrolling up (to show earlier data).
   * Prioritizes loading historical data above the current visible range.
   * 
   * @private
   */
  private checkAndLoadScrollUpChunks(): void {
    if (!this.wellLogWidget) return;
    // Allow more concurrent requests for scroll-up to improve responsiveness
    if (this.inFlightRanges.size >= 3) return;

    const visibleLimits: any = this.wellLogWidget.getVisibleDepthLimits();
    if (!visibleLimits) return;

    const vMin = visibleLimits.getLow ? visibleLimits.getLow() : 0;
    const vMax = visibleLimits.getHigh ? visibleLimits.getHigh : 0;

    // For scroll-up, focus on loading data above the visible range
    const scrollUpBuffer = (this.isTimeBasedData ? this.TIME_CHUNK_SIZE : this.CHUNK_SIZE) * 1.5; // Larger buffer for scroll-up
    const needMin = Math.max(0, vMin - scrollUpBuffer);
    const needMax = vMin; // Only care about data above visible range

    const chunkRequests = new Map<string, { header: LogHeader; curves: TrackCurve[]; start: number; end: number }>();

    // Group curves by LogId and find loaded ranges
    const logIdCurves = new Map<string, { header: LogHeader; curves: TrackCurve[]; range: { min: number; max: number } }>();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        if (logIdCurves.has(curve.LogId)) {
          logIdCurves.get(curve.LogId)!.curves.push(curve);
          return;
        }
        const matchingHeader = this.cachedHeaders.find(h => h.uid.includes(curve.LogId));
        const range = this.loadedRanges.get(curve.mnemonicId);
        if (!matchingHeader) return;
        
        const effectiveRange = range || { min: 0, max: 0 };
        logIdCurves.set(curve.LogId, { header: matchingHeader, curves: [curve], range: effectiveRange });
      });
    });

    logIdCurves.forEach(({ header, curves, range }, logId) => {
      // For scroll-up, prioritize loading data above current range
      const chunkSize = this.isTimeBasedData ? this.TIME_CHUNK_SIZE : this.CHUNK_SIZE;
      
      if (needMin < range.min && range.min > 0) {
        // Load chunk immediately above the current loaded range
        const chunkEnd = range.min;
        const chunkStart = Math.max(0, chunkEnd - chunkSize);
        const key = `${logId}_${chunkStart}_${chunkEnd}`;
        
        if (!this.inFlightRanges.has(key)) {
          chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
        }
        
        // Also add a gap-fill chunk to ensure smooth scrolling
        const gapFillStart = Math.max(0, chunkEnd - chunkSize * 1.5);
        const gapFillEnd = chunkEnd - chunkSize * 0.5;
        const gapFillKey = `${logId}_${gapFillStart}_${gapFillEnd}`;
        
        if (!this.inFlightRanges.has(gapFillKey) && gapFillStart < gapFillEnd) {
          console.log(`⬆️ Adding gap-fill chunk for ${logId}: ${gapFillStart.toFixed(1)} - ${gapFillEnd.toFixed(1)}`);
          chunkRequests.set(gapFillKey, { header, curves, start: gapFillStart, end: gapFillEnd });
        }
      }
      
      // Also check if we need to fill gaps between needMin and current range
      if (needMin < range.min && range.min - needMin > chunkSize / 2) {
        // Load additional chunk to fill the gap
        const chunkEnd = Math.max(0, range.min - chunkSize / 2);
        const chunkStart = Math.max(0, chunkEnd - chunkSize);
        const key = `${logId}_${chunkStart}_${chunkEnd}`;
        
        if (!this.inFlightRanges.has(key) && !chunkRequests.has(key)) {
          console.log(`⬆️ Adding gap-fill chunk for ${logId}: ${chunkStart.toFixed(1)} - ${chunkEnd.toFixed(1)}`);
          chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
        }
      }
    });

    // Execute scroll-up chunk requests
    chunkRequests.forEach(({ header, curves, start, end }, key) => {
      this.inFlightRanges.add(key);
      
      const onDone = (k: string) => {
        this.inFlightRanges.delete(k);
      };

      if (this.wellService) {
        const queryParameter: ILogDataQueryParameter = {
          wellUid: this.well,
          logUid: header.uid,
          wellboreUid: this.wellbore,
          logName: header.name,
          indexType: header.indexType,
          indexCurve: header.indexCurve,
          startIndex: start,
          endIndex: end,
          isGrowing: header.objectGrowing === 'true',
          mnemonicList: '',
        };

        this.wellService.getLogData(queryParameter).subscribe({
          next: (logDataArray: any) => {
            if (logDataArray.length > 0) {
              curves.forEach(curve => this.appendChunkData(logDataArray[0], curve));
            }
            onDone(key);
          },
          error: (error: any) => {
            onDone(key);
          }
        });
      } else {
        // HTTP service path
        if (this.isTimeBasedData) {
          this.logHeadersService.getTimeLogData(this.well, this.wellbore, header.uid, start, end).subscribe({
            next: (logDataArray: LogData[]) => {
              if (logDataArray.length > 0) {
                curves.forEach(curve => this.appendChunkData(logDataArray[0], curve));
              }
              onDone(key);
            },
            error: (error: any) => {
              onDone(key);
            }
          });
        } else {
          this.logHeadersService.getLogData(this.well, this.wellbore, header.uid, start, end).subscribe({
            next: (logDataArray: LogData[]) => {
              if (logDataArray.length > 0) {
                console.log(`⬆️ Received ${logDataArray.length} depth data points for scroll-up chunk ${key}`);
                curves.forEach(curve => this.appendChunkData(logDataArray[0], curve));
              } else {
                console.warn(`⬆️ No depth data received for scroll-up chunk ${key}`);
              }
              onDone(key);
            },
            error: (error: any) => {
              console.error(`⬆️ Error loading scroll-up depth chunk for ${header.uid}:`, error);
              onDone(key);
            }
          });
        }
      }
    });
  }

  /**
   * Checks current visible depth range and loads missing chunks.
   * Groups requests by LogId to avoid duplicate API calls during scroll.
   * 
   * @private
   */
  private checkAndLoadChunks(): void {
    if (!this.wellLogWidget) return;
    // Limit concurrent in-flight requests
    if (this.inFlightRanges.size >= 2) return;

    const visibleLimits: any = this.wellLogWidget.getVisibleDepthLimits();
    if (!visibleLimits) return;

    const vMin = visibleLimits.getLow ? visibleLimits.getLow() : 0;
    const vMax = visibleLimits.getHigh ? visibleLimits.getHigh() : 0;

    // Add a buffer around visible range
    const buffer = this.isTimeBasedData ? this.TIME_CHUNK_SIZE / 2 : this.CHUNK_SIZE / 2;
    const needMin = Math.max(0, vMin - buffer);
    const needMax = Math.min(this.headerMaxDepth, vMax + buffer);

    // Build chunk requests grouped by LogId+direction, using ONE reference range per LogId
    const chunkRequests = new Map<string, { header: LogHeader; curves: TrackCurve[]; start: number; end: number }>();

    // Group curves by LogId and find the loaded range (all curves of same LogId share the same range)
    const logIdCurves = new Map<string, { header: LogHeader; curves: TrackCurve[]; range: { min: number; max: number } }>();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        if (logIdCurves.has(curve.LogId)) {
          logIdCurves.get(curve.LogId)!.curves.push(curve);
          return;
        }
        const matchingHeader = this.cachedHeaders.find(h => h.uid.includes(curve.LogId));
        const range = this.loadedRanges.get(curve.mnemonicId);
        if (!matchingHeader) return;
        
        // For curves without existing range, use a default range to allow initial loading
        const effectiveRange = range || { min: 0, max: 0 };
        logIdCurves.set(curve.LogId, { header: matchingHeader, curves: [curve], range: effectiveRange });
      });
    });

    logIdCurves.forEach(({ header, curves, range }, logId) => {
      // For unloaded curves (range.max === 0), load data around visible area
      if (range.max === 0) {
        let chunkStart: number;
        let chunkEnd: number;
        
        if (this.isTimeBasedData) {
          // For time-based data, use time-based chunking
          chunkStart = Math.max(0, needMin - this.TIME_CHUNK_SIZE / 2);
          chunkEnd = Math.min(this.headerMaxDepth, needMin + this.TIME_CHUNK_SIZE / 2);
        } else {
          // For depth-based data, use depth-based chunking
          chunkStart = Math.max(0, needMin - this.CHUNK_SIZE / 2);
          chunkEnd = Math.min(this.headerMaxDepth, needMin + this.CHUNK_SIZE / 2);
        }
        
        const key = `${logId}_${chunkStart}_${chunkEnd}`;
        if (!this.inFlightRanges.has(key)) {
          chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
        }
      } else {
        // Check if we need data below loaded range (user scrolled up)
        if (needMin < range.min && range.min > 0) {
          const chunkEnd = range.min;
          let chunkStart: number;
          
          if (this.isTimeBasedData) {
            chunkStart = Math.max(0, chunkEnd - this.TIME_CHUNK_SIZE);
          } else {
            chunkStart = Math.max(0, chunkEnd - this.CHUNK_SIZE);
          }
          
          const key = `${logId}_${chunkStart}_${chunkEnd}`;
          if (!this.inFlightRanges.has(key)) {
            chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
          }
        }

        // Check if we need data above loaded range (user scrolled down)
        if (needMax > range.max && range.max < this.headerMaxDepth) {
          const chunkStart = range.max;
          let chunkEnd: number;
          
          if (this.isTimeBasedData) {
            chunkEnd = Math.min(this.headerMaxDepth, chunkStart + this.TIME_CHUNK_SIZE);
          } else {
            chunkEnd = Math.min(this.headerMaxDepth, chunkStart + this.CHUNK_SIZE);
          }
          
          const key = `${logId}_${chunkStart}_${chunkEnd}`;
          if (!this.inFlightRanges.has(key)) {
            chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
          }
        }
      }
    });

    if (chunkRequests.size === 0) return;

    console.log(`📦 Scroll chunk: ${chunkRequests.size} request(s) for visible ${vMin.toFixed(0)}-${vMax.toFixed(0)}`);
    this.isLoadingChunk = true;

    let remaining = chunkRequests.size;
    const onDone = (key: string) => {
      this.inFlightRanges.delete(key);
      remaining--;
      if (remaining <= 0) {
        this.isLoadingChunk = false;
      }
    };

    chunkRequests.forEach(({ header, curves, start, end }, key) => {
      // Mark range as in-flight immediately to prevent duplicates
      this.inFlightRanges.add(key);
      console.log(`  📥 Chunk: ${start}-${end} for ${header.uid}`);

      // Prepare queryParameter for real backend API
      let queryParameter: ILogDataQueryParameter = {
        wellUid: this.well,
        logUid: header.uid,
        wellboreUid: this.wellbore,
        logName: header.name,
        indexType: header.indexType,
        indexCurve: header.indexCurve,
        startIndex: start,
        endIndex: end,
        isGrowing: header.objectGrowing === 'true', // Convert string to boolean
        mnemonicList: '',
      };
      
      if (this.wellService) {
        // Real backend path
        this.wellService.getLogData(queryParameter).subscribe({
          next: (logDataArray: any) => {
            if (logDataArray.length > 0) {
              curves.forEach(curve => this.appendChunkData(logDataArray[0], curve));
            }
            onDone(key);
          },
          error: () => onDone(key),
        });
      } else {
        // Use HTTP service for real API calls
        console.log(`🌐 Making HTTP call for LogId: ${header.uid}, range: ${start}-${end}`);
        if (this.isTimeBasedData) {
          this.logHeadersService.getTimeLogData(this.well, this.wellbore, header.uid, start, end).subscribe({
            next: (logDataArray: LogData[]) => {
              if (logDataArray.length > 0) {
                console.log(`🕐 Received ${logDataArray.length} time log data records from API`);
                console.log(`📊 First record has ${logDataArray[0].data?.length || 0} data rows`);
                curves.forEach((curve, index) => {
                  console.log(`🔄 Processing time API data for curve ${curve.mnemonicId} (${index + 1}/${curves.length})`);
                  this.appendChunkData(logDataArray[0], curve);
                });
              } else {
                console.warn(`⚠️ No time data returned from API for LogId: ${header.uid}, range: ${start}-${end}`);
              }
              onDone(key);
            },
            error: () => onDone(key),
          });
        } else {
          this.logHeadersService.getLogData(this.well, this.wellbore, header.uid, start, end).subscribe({
            next: (logDataArray: LogData[]) => {
              if (logDataArray.length > 0) {
                console.log(`📏 Received ${logDataArray.length} depth log data records from API`);
                console.log(`📊 First record has ${logDataArray[0].data?.length || 0} data rows`);
                curves.forEach((curve, index) => {
                  console.log(`🔄 Processing depth API data for curve ${curve.mnemonicId} (${index + 1}/${curves.length})`);
                  this.appendChunkData(logDataArray[0], curve);
                });
              } else {
                console.warn(`⚠️ No depth data returned from API for LogId: ${header.uid}, range: ${start}-${end}`);
              }
              onDone(key);
            },
            error: () => onDone(key),
          });
        }
      }
    });
  }


  /**
   * Appends a new chunk of data to an existing curve without recreating the scene.
   * Merges new data into existing arrays sorted by depth.
   * 
   * @param logData - New chunk of log data
   * @param curve - Curve to append data to
   * @private
   */
  private appendChunkData(logData: LogData, curve: TrackCurve): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex(m => m.trim() === curve.mnemonicId);
    
    // Look for both TIME and DEPTH index columns
    const depthIdx = mnemonics.findIndex(m => m.trim() === 'DEPTH');
    const timeIdx = mnemonics.findIndex(m => m.trim() === 'TIME');
    const indexIdx = mnemonics.findIndex(m => m.trim() === 'INDEX');
    
    // Use appropriate index based on data type
    let indexColumn = -1;
    if (this.isTimeBasedData) {
      indexColumn = timeIdx !== -1 ? timeIdx : indexIdx;
    } else {
      indexColumn = depthIdx !== -1 ? depthIdx : indexIdx;
    }
    
    if (curveIndex === -1 || indexColumn === -1) {
      return;
    }

    const newIndices: number[] = [];
    const newValues: number[] = [];

    logData.data.forEach((row) => {
      const cols = row.split(',');
      const index = parseFloat(cols[indexColumn]);
      const value = parseFloat(cols[curveIndex]);
      if (!isNaN(index) && !isNaN(value)) {
        newIndices.push(index);
        newValues.push(value);
      }
    });

    if (newIndices.length === 0) return;

    // Merge with existing data - optimized for performance
    const existingIndices = this.curveDepthIndices.get(curve.mnemonicId) || [];
    const existingValues = curve.data || [];

    // Simple array concatenation and sort - much faster than Map operations
    const allIndices = existingIndices.concat(newIndices);
    const allValues = existingValues.concat(newValues);
    
    // Create index-value pairs for sorting
    const pairs: [number, number][] = [];
    for (let i = 0; i < allIndices.length; i++) {
      pairs.push([allIndices[i], allValues[i]]);
    }
    
    // Sort by index
    pairs.sort((a, b) => a[0] - b[0]);
    
    // Remove duplicates while preserving order
    const deduplicatedPairs: [number, number][] = [];
    let lastIndex: number | null = null;
    
    for (const [index, value] of pairs) {
      if (lastIndex === null || index !== lastIndex) {
        deduplicatedPairs.push([index, value]);
        lastIndex = index;
      }
    }
    
    const mergedIndices = deduplicatedPairs.map(pair => pair[0]);
    const mergedValues = deduplicatedPairs.map(pair => pair[1]);

    curve.data = mergedValues;
    this.curveDepthIndices.set(curve.mnemonicId, mergedIndices);

    // Update loaded range
    this.loadedRanges.set(curve.mnemonicId, {
      min: mergedIndices[0],
      max: mergedIndices[mergedIndices.length - 1],
    });

    // Update the GeoToolkit curve data source
    const entry = this.curveMap.get(curve.mnemonicId);
    
    if (entry) {
      try {
        const geoLogData = new GeoLogData(curve.displayName);
        geoLogData.setValues(mergedIndices, mergedValues);
        entry.logCurve.setData(geoLogData);
      } catch (e) {
        console.warn('Could not update curve data source for', curve.mnemonicId, e);
      }
    }

    // Debounce index track scale update to avoid excessive calls during scroll
    this.scheduleIndexTrackUpdate();
  }

  /**
   * Schedules an index track update with debouncing to prevent excessive calls during scroll.
   * @private
   */
  private scheduleIndexTrackUpdate(): void {
    if (this.indexTrackUpdateTimeout) {
      clearTimeout(this.indexTrackUpdateTimeout);
    }
    this.indexTrackUpdateTimeout = setTimeout(() => {
      this.updateIndexTrackScale();
      this.indexTrackUpdateTimeout = null;
    }, 200); // Debounce for 200ms
  }

  /**
   * Updates the index track scale to show the full depth range.
   * Ensures the index track always shows the complete scale, not just visible range.
   * 
   * @private
   */
  private updateIndexTrackScale(): void {
    // Find the index track - handle different GeoToolkit versions
    let indexTrack = null;
    
    try {
      // GeoToolkit 4.1.41: getTracks() returns a number (count)
      // GeoToolkit 5.0.58: getTracks() returns an iterable collection
      const tracksResult = (this.wellLogWidget as any).getTracks();
      
      console.log('🔍 getTracks() returned:', typeof tracksResult, tracksResult);
      
      if (typeof tracksResult === 'number') {
        // GeoToolkit 4.1.41 - getTracks() returns count, need to use getTrack(index)
        console.log('📋 Using GeoToolkit 4.1.41 approach (getTrack by index)');
        const trackCount = tracksResult;
        
        for (let i = 0; i < trackCount; i++) {
          try {
            const track = (this.wellLogWidget as any).getTrack(i);
            console.log(`🔍 Track ${i}:`, track);
            
            if (track && typeof track === 'object') {
              // Check if track has getName method before calling it
              const trackName = (track.getName && typeof track.getName === 'function') ? track.getName() : '';
              console.log(`🔍 Track ${i} name: ${trackName}`);
              
              // Check for various index track names (depth-based and time-based)
              let isIndexTrack = trackName === 'Depth' || 
                                trackName === 'Time' || 
                                trackName === 'Index' ||
                                trackName.toLowerCase().includes('depth') ||
                                trackName.toLowerCase().includes('time') ||
                                trackName.toLowerCase().includes('index');
              
              // Fallback: check track type properties if available
              if (!isIndexTrack) {
                const trackType = (track.getType && typeof track.getType === 'function') ? track.getType() : 
                                 (track.getTrackType && typeof track.getTrackType === 'function') ? track.getTrackType() : '';
                console.log(`🔍 Track ${i} type: ${trackType}`);
                
                isIndexTrack = trackType === 'Index' || 
                              trackType === 'IndexTrack' ||
                              trackType.toLowerCase().includes('index');
              }
              
              // Additional fallback: check if it's an index track by its properties
              if (!isIndexTrack) {
                const isIndexType = track.isIndex || (track.getIsIndex && typeof track.getIsIndex === 'function' ? track.getIsIndex() : false);
                const isDepthType = track.isDepth || (track.getIsDepth && typeof track.getIsDepth === 'function' ? track.getIsDepth() : false);
                console.log(`🔍 Track ${i} properties: isIndex=${isIndexType}, isDepth=${isDepthType}`);
                
                isIndexTrack = isIndexType === true;
              }
              
              if (isIndexTrack) {
                console.log(`✅ Found index track at position ${i}: ${trackName}`);
                indexTrack = track;
                break;
              }
            } else {
              console.log(`⚠️ Track ${i} is undefined or invalid (type: ${typeof track})`);
            }
          } catch (trackError) {
            console.warn(`⚠️ Error getting track ${i}:`, trackError);
          }
        }
      }
      else if (tracksResult && typeof tracksResult.forEach === 'function') {
        // GeoToolkit 5.0.58+ - getTracks() returns iterable
        console.log('📋 Using GeoToolkit 5.0.58+ approach (forEach)');
        tracksResult.forEach((track: any) => {
          const trackName = track.getName?.() || '';
          if (trackName === 'Depth' || trackName === 'Time') {
            indexTrack = track;
          }
        });
      }
      else if (Array.isArray(tracksResult)) {
        // Simple array
        console.log('📋 Using array approach');
        for (const track of tracksResult) {
          const trackName = track.getName?.() || '';
          if (trackName === 'Depth' || trackName === 'Time') {
            indexTrack = track;
            break;
          }
        }
      }
      else {
        console.warn('⚠️ Unknown tracks result type:', typeof tracksResult, tracksResult);
        return;
      }
    } catch (error) {
      console.warn('⚠️ Error getting tracks in updateIndexTrackScale:', error);
      return;
    }
    
    if (!indexTrack) {
      console.log('ℹ️ No index track found, skipping depth limits update');
      return;
    }
    
    console.log('✅ Found index track:', indexTrack);
    console.log('🔍 Index track type:', typeof indexTrack);
    console.log('🔍 Index track methods:', Object.getOwnPropertyNames(indexTrack));
    
    // Verify the index track has the expected methods before proceeding
    if (!indexTrack || typeof indexTrack !== 'object') {
      console.warn('⚠️ Invalid index track object');
      return;
    }
    
    // Get the full depth range from all loaded data
    let fullMinDepth = Number.MAX_VALUE;
    let fullMaxDepth = Number.MIN_VALUE;
    
    for (const [mnemonicId, depths] of this.curveDepthIndices.entries()) {
      if (depths && depths.length > 0) {
        fullMinDepth = Math.min(fullMinDepth, depths[0]);
        fullMaxDepth = Math.max(fullMaxDepth, depths[depths.length - 1]);
      }
    }
    
    // Update index track to show full scale
    if (fullMinDepth !== Number.MAX_VALUE && fullMaxDepth !== Number.MIN_VALUE) {
      console.log(`📏 Updating index track full scale: ${fullMinDepth} to ${fullMaxDepth}`);
      try {
        // Try different methods for setting depth limits based on GeoToolkit version
        if (indexTrack.setDepthLimits && typeof indexTrack.setDepthLimits === 'function') {
          // Standard method
          indexTrack.setDepthLimits(fullMinDepth, fullMaxDepth);
        }
        else if ((indexTrack as any).setLimits && typeof (indexTrack as any).setLimits === 'function') {
          // Alternative method
          (indexTrack as any).setLimits(fullMinDepth, fullMaxDepth);
        }
        else if ((indexTrack as any).setRange && typeof (indexTrack as any).setRange === 'function') {
          // Another alternative method
          (indexTrack as any).setRange(fullMinDepth, fullMaxDepth);
        }
        else {
          console.warn('⚠️ No suitable method found to set depth limits on index track');
          console.log('🔍 Available methods:', Object.getOwnPropertyNames(indexTrack));
        }
      } catch (error) {
        console.warn('⚠️ Error setting depth limits on index track:', error);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE DATA POLLING
  //
  // Polls the backend at regular intervals for new data beyond the current
  // loaded max depth. Groups requests by LogId (same as checkAndLoadChunks).
  // Uses appendChunkData() to merge new data into existing curves in-place.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Starts live data polling at LIVE_POLL_INTERVAL.
   * Call this after initial data load is complete.
   */
  startLivePolling(): void {
    this.stopLivePolling();
    this.isLivePolling = true;
    console.log(`🟢 Live polling started (every ${this.LIVE_POLL_INTERVAL}ms)`);

    this.livePollHandle = setInterval(() => {
      this.ngZone.run(() => this.loadNewLiveData());
    }, this.LIVE_POLL_INTERVAL);
  }

  /**
   * Stops live data polling and clears the interval.
   */
  stopLivePolling(): void {
    if (this.livePollHandle) {
      clearInterval(this.livePollHandle);
      this.livePollHandle = null;
    }
    this.isLivePolling = false;
    console.log('🔴 Live polling stopped');
  }

  /**
   * Fetches new data beyond the current loaded max depth for each LogId.
   * Groups curves by LogId to minimize API calls (one per unique LogId).
   * Uses appendChunkData() to merge new data without rebuilding the scene.
   *
   * @private
   */
  private loadNewLiveData(): void {
    if (!this.wellLogWidget || !this.isLivePolling) return;

    // Group curves by LogId → one API call per unique LogId
    const logIdCurves = new Map<string, { header: LogHeader; curves: TrackCurve[]; maxLoaded: number }>();

    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        if (logIdCurves.has(curve.LogId)) {
          logIdCurves.get(curve.LogId)!.curves.push(curve);
          return;
        }
        const matchingHeader = this.cachedHeaders.find(h => h.uid.includes(curve.LogId));
        const range = this.loadedRanges.get(curve.mnemonicId);
        if (!matchingHeader || !range) return;
        logIdCurves.set(curve.LogId, { header: matchingHeader, curves: [curve], maxLoaded: range.max });
      });
    });

    if (logIdCurves.size === 0) return;

    logIdCurves.forEach(({ header, curves, maxLoaded }, logId) => {
      const start = maxLoaded + 1;
      const end = start + this.CHUNK_SIZE;
      const key = `live_${logId}_${start}_${end}`;

      // Prevent duplicate in-flight requests
      if (this.inFlightRanges.has(key)) return;
      this.inFlightRanges.add(key);

      console.log(`🔄 Live poll: ${start}-${end} for ${header.uid}`);

      // Use real backend queryParameter format (same as RfRealTimeDisplay)
      const wellboreObj = this.wellboreObjects.find(obj => obj.logUid === header.uid);
      if (!wellboreObj) {
        console.warn(`⚠️ Wellbore object not found for ${logId}`);
        this.inFlightRanges.delete(key);
        return;
      }

      const queryParameter = {
        wellUid: wellboreObj.wellUid,
        logUid: wellboreObj.logUid,
        wellboreUid: wellboreObj.wellboreUid,
        logName: wellboreObj.logName,
        indexType: wellboreObj.indexType,
        indexCurve: wellboreObj.indexCurve,
        startIndex: start,
        endIndex: end,
        isGrowing: wellboreObj.isGrowing,
        mnemonicList: '',
      };

      if (this.wellService) {
        // Real backend path
        this.wellService.getLogData(queryParameter).subscribe({
          next: (response: any) => {
            if (response && response.logs && response.logs.length > 0 && response.logs[0].logData.data.length > 0) {
              const logData = this.convertResponseToLogData(response.logs[0]);
              curves.forEach(curve => this.appendChunkData(logData, curve));
              
              if (end > wellboreObj.endIndex) {
                wellboreObj.endIndex = end;
                console.log(`🔄 Updated endIndex for ${logId} to ${end}`);
              }
              
              console.log(`✅ Live data loaded: ${response.logs[0].logData.data.length} rows for ${logId}`);
            }
            this.inFlightRanges.delete(key);
          },
          error: (err: any) => {
            console.warn(`⚠️ Live poll error for ${logId}:`, err);
            this.inFlightRanges.delete(key);
          },
        });
      } else {
        // Mock service fallback (demo mode)
        if (this.isTimeBasedData) {
          this.logHeadersService.getTimeLogData(this.well, this.wellbore, header.uid, start, end).subscribe({
            next: (logData: LogData[]) => {
              logData.forEach(data => curves.forEach(curve => this.appendChunkData(data, curve)));
              console.log(`✅ Live time data loaded (mock) for ${logId}`);
              this.inFlightRanges.delete(key);
            },
            error: (err: any) => {
              console.warn(`⚠️ Live poll time error for ${logId}:`, err);
              this.inFlightRanges.delete(key);
            },
          });
        } else {
          this.logHeadersService.getLogData(this.well, this.wellbore, header.uid, start, end).subscribe({
            next: (logData: LogData[]) => {
              logData.forEach(data => curves.forEach(curve => this.appendChunkData(data, curve)));
              console.log(`✅ Live depth data loaded (mock) for ${logId}`);
              this.inFlightRanges.delete(key);
            },
            error: (err: any) => {
              console.warn(`⚠️ Live poll depth error for ${logId}:`, err);
              this.inFlightRanges.delete(key);
            },
          });
        }
      }
    });
  }

  /**
   * Converts real backend response to LogData format for appendChunkData.
   *
   * @param response - Real backend log response
   * @returns LogData in expected format
   * @private
   */
  private convertResponseToLogData(response: any): LogData {
    return {
      uidWell: response.uidWell || this.well,
      uidWellbore: response.uidWellbore || this.wellbore,
      startIndex: response.startIndex || { '@uom': 'm', '#text': '0' },
      endIndex: response.endIndex || { '@uom': 'm', '#text': '0' },
      mnemonicList: response.logData.mnemonicList,
      unitList: response.logData.unitList,
      data: response.logData.data,
      uid: response.uid || response.logUid
    };
  }

  /**
   * Extracts the maximum depth value from a LogData response.
   *
   * @param logData - The log data response
   * @returns The maximum depth value found in the data
   * @private
   */
  private getMaxDepthFromLogData(logData: LogData): number {
    const mnemonics = logData.mnemonicList.split(',');
    const depthIdx = mnemonics.findIndex(m => m.trim() === 'DEPTH');
    if (depthIdx === -1 || logData.data.length === 0) return 0;
    const lastRow = logData.data[logData.data.length - 1];
    return parseFloat(lastRow.split(',')[depthIdx]) || 0;
  }

  /**
   * Configures the built-in GeoToolkit crosshair tool to emit tooltip data.
   * Collects all curve values at the crosshair depth and updates the tooltip panel.
   * 
   * @private
   */
  private configureCrossHair(): void {
    try {
      const crossHair: any = this.wellLogWidget.getToolByName('cross-hair');
      if (!crossHair) {
        console.warn('⚠️ CrossHair tool not found on WellLogWidget');
        return;
      }

      crossHair.on(CrossHairEvents.onPositionChanged, (evt: any, sender: any, eventArgs: any) => {
        // Run inside Angular zone so change detection picks up tooltipData updates
        this.ngZone.run(() => {
          try {
            const position = eventArgs.getPosition();
            if (!position) {
              this.tooltipData = { depth: 0, curveValues: [], screenY: 0, visible: false };
              return;
            }

            // Transform position to model coordinates to get depth
            const trackContainer = this.wellLogWidget.getTrackContainer();
            if (!trackContainer) return;
            const sceneTransform = trackContainer.getSceneTransform();
            if (!sceneTransform) return;
            const pt = sceneTransform.transformPoint(position);
            const depth = pt.getY ? pt.getY() : pt.y;

            // Get device Y for tooltip vertical position
            const posY = position.getY ? position.getY() : position.y;

            // Build flat list of all curve values at this depth
            const curveValues: TooltipCurveValue[] = [];

            this.curveMap.forEach((entry) => {
              const { logCurve, info, trackName } = entry;
              let value: number | null = null;
              try {
                const dataSource = logCurve.getDataSource();
                if (dataSource) {
                  const dataSize = dataSource.getSize();
                  
                  // Try NaN approach first since that was working
                  const nanResult = dataSource.getValueAt(NaN, 0, dataSize, logCurve.getInterpolationType());
                  if (nanResult != null && !isNaN(nanResult) && isFinite(nanResult)) {
                    value = nanResult;
                  }
                }
              } catch (error) {
                // Silently handle tooltip errors to not break scrolling
              }

              curveValues.push({
                mnemonic: info.mnemonicId,
                displayName: info.displayName,
                value: value,
                unit: '',
                color: info.color,
                trackName: trackName,
              });
            });

            this.tooltipData = {
              depth: depth,
              curveValues: curveValues,
              screenY: posY,
              visible: curveValues.length > 0,
            };
          } catch (e) {
            // Silently handle tooltip errors to not break scrolling
          }
        });
      });

      console.log('✅ CrossHair configured for tooltip');
    } catch (error) {
      console.warn('⚠️ Could not configure CrossHair:', error);
    }
  }

  /**
   * Applies the selected depth scale to the widget.
   * Scale value represents meters of depth visible on screen.
   * A value of 0 means fit-to-height (show all data).
   * 
   * @param scale - Meters of depth to display on screen (0 = fit all)
   * @private
   */
  private applyScale(scale: number): void {
    if (!this.wellLogWidget) return;

    const maxDepth = this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();

    if (scale === 0) {
      // Fit to height - show all data
      this.wellLogWidget.setVisibleDepthLimits(0, maxDepth);
      this.wellLogWidget.fitToHeight();
    } else {
      // Set visible range based on scale
      const visibleRange = Math.min(scale, maxDepth);
      this.wellLogWidget.setVisibleDepthLimits(0, visibleRange);
    }

    this.wellLogWidget.updateLayout();
    
    const limits = this.wellLogWidget.getVisibleDepthLimits();
    console.log('📏 Scale applied:', scale === 0 ? 'Fit to Height' : `1:${scale}`, 
                '| Visible:', limits);
  }

  /**
   * Handles scale change from the UI dropdown.
   * Dynamically updates the visible depth limits based on the selected scale.
   * 
   * @param scale - New scale value selected by the user
   */
  onScaleChange(scale: number): void {
    this.selectedScale = Number(scale);
    console.log('🔄 Scale changed to:', this.selectedScale);
    this.applyScale(this.selectedScale);
  }

  /**
   * Opens the Print Properties dialog.
   * Passes current widget state and handles the result.
   */
  openPrintProperties(): void {
    const maxDepth = this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();
    const visibleLimits: any = this.wellLogWidget?.getVisibleDepthLimits();
    const vMin = visibleLimits ? (visibleLimits.getLow ? visibleLimits.getLow() : 0) : 0;
    const vMax = visibleLimits ? (visibleLimits.getHigh ? visibleLimits.getHigh() : maxDepth) : maxDepth;

    const dialogData: PrintPropertiesData = {
      indexType: this.isTimeBasedData ? 'time' : 'depth',
      dataMin: 0,
      dataMax: maxDepth,
      visibleMin: vMin,
      visibleMax: vMax,
      currentScale: this.selectedScale,
      scaleOptions: this.scaleOptions,
    };

    const dialogRef = this.dialog.open(PrintPropertiesDialogComponent, {
      width: '520px',
      data: dialogData,
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe((result: PrintPropertiesResult | null) => {
      if (!result) return;
      console.log('🖨️ Print Properties result:', result);

      // Apply scale from dialog
      if (result.scale !== this.selectedScale) {
        this.selectedScale = result.scale;
        this.applyScale(this.selectedScale);
      }

      // Apply range
      if (result.printRange === 'all') {
        this.wellLogWidget.setVisibleDepthLimits(0, this.getMaxDepth());
        this.wellLogWidget.fitToHeight();
        this.wellLogWidget.updateLayout();
      } else if (result.printRange === 'range' && typeof result.rangeFrom === 'number' && typeof result.rangeTo === 'number') {
        this.wellLogWidget.setVisibleDepthLimits(result.rangeFrom, result.rangeTo);
        this.wellLogWidget.updateLayout();
      }
      // 'visible' means keep current visible range - no change needed

      // Handle print
      if (result.print) {
        this.printCanvas(result);
      }
    });
  }

  /**
   * Prints the canvas based on the dialog result.
   * 
   * @param result - Print properties from the dialog
   * @private
   */
  private printCanvas(result: PrintPropertiesResult): void {
    try {
      const canvas = this.widgetComponent.Canvas?.nativeElement as HTMLCanvasElement;
      if (!canvas) {
        console.error('❌ Canvas element not found for printing');
        return;
      }

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        console.error('❌ Could not open print window');
        return;
      }

      const dataUrl = canvas.toDataURL('image/png');
      let headerHtml = '';
      if (result.headerOption !== 'none') {
        headerHtml = `<div style="text-align:center;margin-bottom:10px;font-family:Arial,sans-serif;">
          <h2 style="margin:0;">Well Log Print</h2>
          <p style="margin:4px 0;color:#666;">Well: ${this.well} | Wellbore: ${this.wellbore}</p>
          <p style="margin:4px 0;color:#666;">Scale: 1:${this.selectedScale} | Range: ${
            result.printRange === 'all' ? 'All' :
            result.printRange === 'visible' ? 'Visible Range' :
            `${result.rangeFrom} - ${result.rangeTo}`
          }</p>
        </div>`;
      }

      let pageNumberHtml = '';
      if (result.showPageNumber) {
        pageNumberHtml = `<div style="text-align:center;margin-top:10px;font-family:Arial;font-size:11px;color:#999;">Page 1</div>`;
      }

      let printRangeHtml = '';
      if (result.showPrintRange) {
        printRangeHtml = `<div style="text-align:center;margin-top:5px;font-family:Arial;font-size:11px;color:#999;">
          Print Range: ${result.rangeFrom} - ${result.rangeTo}
        </div>`;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html><head><title>Well Log Print</title></head>
        <body style="margin:20px;">
          ${(result.headerOption === 'topAndBottom' || result.headerOption === 'top') ? headerHtml : ''}
          <img src="${dataUrl}" style="max-width:100%;" />
          ${(result.headerOption === 'topAndBottom' || result.headerOption === 'bottom') ? headerHtml : ''}
          ${pageNumberHtml}
          ${printRangeHtml}
        </body></html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    } catch (error) {
      console.error('❌ Error printing canvas:', error);
    }
  }

  /**
   * Detects if the data is time-based or depth-based.
   * Uses track configuration and log headers to determine data type.
   * 
   * @returns true if data is time-based, false if depth-based
   * @private
   */
  private detectTimeBasedData(): boolean {
    console.log(`🔍 detectTimeBasedData called with ${this.cachedHeaders.length} headers and ${this.listOfTracks.length} tracks`);
    
    // METHOD 1: Check track configuration for time-based index track
    const hasTimeIndexTrack = this.listOfTracks.some(track => 
      track.isIndex && !track.isDepth
    );
    
    if (hasTimeIndexTrack) {
      console.log('🕐 Time-based data detected from track configuration (isIndex && !isDepth)');
      this.isTimeBasedData = true;
      this.indexType = IndexType.Time;
      return true;
    }
    
    // METHOD 2: Use intelligent detection on cached headers
    if (this.cachedHeaders.length > 0) {
      // Check ALL headers for time-based data, not just the first one
      for (const header of this.cachedHeaders) {
        console.log(`🔍 Analyzing header:`, {
          uid: header.uid,
          name: header.name,
          indexType: header.indexType,
          indexCurve: header.indexCurve
        });
        
        // FORCE DETECTION FOR MWD_Time
        const logNameLower = (header.name || header.uid || '').toLowerCase();
        const isMwdTime = logNameLower.includes('mwd_time') || logNameLower.includes('mwdtime');
        
        if (isMwdTime) {
          console.log(`🕐 FORCING time-based detection for MWD_Time header: ${header.uid}`);
          this.isTimeBasedData = true;
          this.indexType = IndexType.Time;
          return true;
        }
        
        const detectedIndexType = this.getIndexTypeForLog(header);
        
        if (detectedIndexType === 'date time') {
          console.log(`🕐 Time-based data detected from log header analysis for: ${header.uid}`);
          this.isTimeBasedData = true;
          this.indexType = IndexType.Time;
          return true;
        }
      }
    }
    
    // Default to depth-based
    console.log('📏 Depth-based data detected (default)');
    this.isTimeBasedData = false;
    this.indexType = IndexType.Depth;
    return false;
  }

  /**
   * Creates real depth/time-based index tracks from WITSML data.
   * Extracts actual DEPTH or TIME values from the first available log data.
   * Index tracks automatically use the depth/time scale from the data tracks.
   * 
   * @private
   */
  private createRealIndexTracks(): void {
    console.log('🎯 Creating real index tracks from WITSML data...');
    
    // Find index track configuration to determine type
    let isTimeBased = false;
    let indexTrackFound = false;
    
    // Check if listOfTracks exists and is an array
    if (!this.listOfTracks || !Array.isArray(this.listOfTracks)) {
      console.warn('⚠️ listOfTracks is not available - skipping index track creation');
      return;
    }
    
    for (const trackInfo of this.listOfTracks) {
      // Add null check for trackInfo
      if (trackInfo && trackInfo.isIndex) {
        isTimeBased = !trackInfo.isDepth;
        indexTrackFound = true;
        console.log(`📊 Index track type: ${isTimeBased ? 'Time-based' : 'Depth-based'}`);
        break;
      }
    }
    
    if (!indexTrackFound) {
      console.warn('⚠️ No index track configuration found - creating fallback depth index track');
      // Create fallback depth index track for demo
      this.createFallbackIndexTrack();
      return;
    }
    
    // Debug: Check actual depth values from WITSML data
    console.log('🔍 Verifying real WITSML depth values...');
    for (const trackInfo of this.listOfTracks) {
      // Add null check for trackInfo
      if (trackInfo && !trackInfo.isIndex && trackInfo.curves && trackInfo.curves.length > 0) {
        const firstCurve = trackInfo.curves[0];
        // Add null check for firstCurve
        if (firstCurve && firstCurve.mnemonicId) {
          const depthIndices = this.curveDepthIndices.get(firstCurve.mnemonicId);
          if (depthIndices && depthIndices.length > 0) {
            console.log(`📏 Real WITSML depth values from ${firstCurve.mnemonicId}:`);
            console.log(`   First depth: ${depthIndices[0]}`);
            console.log(`   Second depth: ${depthIndices[1]}`);
            console.log(`   Last depth: ${depthIndices[depthIndices.length - 1]}`);
            console.log(`   Total points: ${depthIndices.length}`);
            break;
          }
        }
      }
    }
    
    // Create real index track - GeoToolkit will automatically use depth/time from data tracks
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    indexTrack.setWidth(isTimeBased ? 120 : 60); // Wider for time display
    indexTrack.setName(isTimeBased ? 'Time' : 'Depth');
    
    // Index track styling handled through CSS
    
    // Configure time-based index track with proper date formatting
    if (isTimeBased) {
      console.log('🕐 Configuring time-based index track with date formatting');
      // Add labelformat handler for time display (following GeoToolkit SecondaryAxis tutorial)
      // This would format timestamps as MM/DD/YYYY HH:MM:SS
      // Implementation depends on GeoToolkit version specifics
    }
    
    // Configure index track to show full scale instead of just visible range
    // Get the full depth range from the loaded data
    let fullMinDepth = 0;
    let fullMaxDepth = 0;
    
    for (const trackInfo of this.listOfTracks) {
      // Add null check for trackInfo
      if (trackInfo && !trackInfo.isIndex && trackInfo.curves && trackInfo.curves.length > 0) {
        const firstCurve = trackInfo.curves[0];
        // Add null check for firstCurve
        if (firstCurve && firstCurve.mnemonicId) {
          const depthIndices = this.curveDepthIndices.get(firstCurve.mnemonicId);
          if (depthIndices && depthIndices.length > 0) {
            fullMinDepth = Math.min(fullMinDepth, depthIndices[0]);
            fullMaxDepth = Math.max(fullMaxDepth, depthIndices[depthIndices.length - 1]);
            break; // Use first curve to determine full range
          }
        }
      }
    }
    
    // Set the index track to show the full scale
    if (fullMinDepth !== fullMaxDepth) {
      console.log(`📏 Setting index track full scale: ${fullMinDepth} to ${fullMaxDepth}`);
      // Configure the index track to show full scale
      indexTrack.setDepthLimits(fullMinDepth, fullMaxDepth);
    }
    
    console.log(`✅ Created real ${isTimeBased ? 'time-based' : 'depth-based'} index track`);
    console.log('📏 Index track will show full depth scale from WITSML data');
    console.log('🎯 Check the index track display - it should show 200.5 as first depth value (not 200)');
  }

  /**
   * Creates fallback index track when no WITSML data is available.
   * Used for demo/mock data scenarios.
   * 
   * @private
   */
  private createFallbackIndexTrack(): void {
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    indexTrack.setWidth(60);
    indexTrack.setName('Depth');
    
    // Fallback index track styling handled through CSS
    
    console.log('🔄 Created fallback synthetic index track for demo data');
    console.log('📏 Index track will use synthetic depth scale for demo purposes');
  }

  /**
   * Creates all tracks based on the input track configurations.
   * Iterates through track definitions and creates appropriate track types.
   * 
   * @private
   */
  private createTracks(): void {
    this.listOfTracks.forEach((trackInfo, trackIndex) => {
      try {
        console.log(`📊 Creating track ${trackIndex + 1}: ${trackInfo.trackName}`);
        
        let track: LogTrack;
        
        if (trackInfo.isIndex) {
          // Skip index track creation - it's already created in createScene
          console.log('⚠️ Skipping index track creation - already created in createScene');
          return;
        } else {
          // Create regular track
          track = this.wellLogWidget.addTrack(TrackType.LinearTrack);
          track.setName(trackInfo.trackName);
          track.setWidth(trackInfo.trackWidth || 100);
          
          // Track styling handled through CSS
        }

        // Create curves for this track
        this.createCurves(track, trackInfo);

        console.log(`✅ Track ${trackInfo.trackName} created successfully`);

      } catch (error) {
        console.error(`❌ Error creating track ${trackInfo.trackName}:`, error);
      }
    });
    
    // Create index tracks after data tracks
    this.createRealIndexTracks();
  }

  /**
   * Creates curves for a specific track based on curve configurations.
   * Uses stored depth indices for correct depth-value mapping.
   * 
   * @param track - The LogTrack to add curves to
   * @param trackInfo - Track configuration containing curve definitions
   * @private
   */
  private createCurves(track: LogTrack, trackInfo: TrackInfo): void {
    trackInfo.curves.forEach((curveInfo, curveIndex) => {
      try {
        if (!curveInfo.show || !curveInfo.data || curveInfo.data.length === 0) {
          console.warn(`⚠️ Skipping curve ${curveInfo.mnemonicId} - no data or hidden`);
          return;
        }

        console.log(`📈 Creating curve: ${curveInfo.mnemonicId}`);

        // Use stored depth indices or generate fallback
        const indexData = this.curveDepthIndices.get(curveInfo.mnemonicId)
          || this.generateIndexData(curveInfo.data.length);

        // Create GeoLogData
        const geoLogData = new GeoLogData(curveInfo.displayName);
        geoLogData.setValues(indexData, curveInfo.data);

        // Create LogCurve
        const curve = new LogCurve(geoLogData);
        curve.setLineStyle({
          color: curveInfo.color,
          width: curveInfo.lineWidth,
        });
        curve.setName(curveInfo.displayName);

        // Set normalization limits if not auto scale
        if (!curveInfo.autoScale && curveInfo.min !== undefined && curveInfo.max !== undefined) {
          curve.setNormalizationLimits(curveInfo.min, curveInfo.max);
        }

        track.addChild(curve);

        // Register curve in the map for crosshair tooltip lookup
        this.curveMap.set(curveInfo.mnemonicId, {
          logCurve: curve,
          info: curveInfo,
          trackName: trackInfo.trackName,
        });

        console.log(`✅ Curve ${curveInfo.mnemonicId} created successfully`);

      } catch (error) {
        console.error(`❌ Error creating curve ${curveInfo.mnemonicId}:`, error);
      }
    });
  }

  /**
   * Calculates the maximum depth from loaded curve data.
   * Uses both depth indices and header information for accuracy.
   * 
   * @returns Maximum depth in meters (minimum 10m)
   * @private
   */
  private getMaxDepth(): number {
    // First try to get from headerMaxDepth (most accurate)
    if (this.headerMaxDepth > 0) {
      return this.headerMaxDepth;
    }
    
    // Fallback to depth indices
    let maxDepth = 0;
    this.curveDepthIndices.forEach((depths) => {
      if (depths.length > 0) {
        const last = depths[depths.length - 1];
        if (last > maxDepth) maxDepth = last;
      }
    });
    
    // Final fallback to data length
    if (maxDepth === 0) {
      this.listOfTracks.forEach((trackInfo) => {
        trackInfo.curves.forEach((curve) => {
          if (curve.data && curve.data.length > maxDepth) {
            maxDepth = curve.data.length;
          }
        });
      });
    }
    return Math.max(maxDepth, 10);
  }

  /**
   * Generates index data for curves based on data point count.
   * Creates depth indices assuming 1 meter spacing between points.
   * 
   * @param count - Number of data points
   * @returns Array of depth indices
   * @private
   */
  private generateIndexData(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i * 1); // 1 meter per point
  }

  /**
   * Initializes window resize listener for dynamic width adjustment.
   * Sets up debounced resize handling to optimize performance.
   * 
   * @private
   */
  private initializeWindowResizeListener(): void {
    console.log('🔄 Initializing window resize listener for dynamic width adjustment');
    
    // Add window resize event listener
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Initialize last container width with fallback
    setTimeout(() => {
      this.lastContainerWidth = this.getContainerWidth();
      // Fallback: use window width if container measurement fails
      if (this.lastContainerWidth === 0) {
        this.lastContainerWidth = window.innerWidth;
        console.log('🔧 Using window.innerWidth as fallback:', this.lastContainerWidth);
      }
      console.log('📏 Initial container width:', this.lastContainerWidth, 'px');
    }, 100);
  }

  /**
   * Handles window resize events with debouncing.
   * Recalculates track widths when container size changes significantly.
   * 
   * @private
   */
  private onWindowResize(): void {
    // Clear existing timeout to debounce rapid resize events
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    
    // Debounce resize handling to improve performance
    this.resizeTimeout = setTimeout(() => {
      this.handleResize();
    }, this.RESIZE_DEBOUNCE_DELAY);
  }

  /**
   * Handles the actual resize logic after debouncing.
   * Checks if container width changed significantly and recalculates track widths.
   * 
   * @private
   */
  private handleResize(): void {
    if (!this.wellLogWidget) {
      return;
    }
    
    const currentContainerWidth = this.getContainerWidth();
    const widthDifference = Math.abs(currentContainerWidth - this.lastContainerWidth);
    
    // Only recalculate if width change exceeds threshold
    if (widthDifference > this.WIDTH_CHANGE_THRESHOLD) {
      console.log('🔄 Significant width change detected - recalculating track widths');
      this.recalculateTrackWidths();
      this.lastContainerWidth = currentContainerWidth;
    }
  }

  /**
   * Recalculates and applies new track widths based on current container size.
   * Dynamically adjusts all non-index tracks to utilize available space optimally.
   * 
   * @private
   */
  private recalculateTrackWidths(): void {
    try {
      console.log('🔄 Starting dynamic track width recalculation');
      
      const containerWidth = this.getContainerWidth();
      const nonIndexTrackCount = this.getNonIndexTrackCount();
      
      console.log(`📊 Container: ${containerWidth}px, Non-index tracks: ${nonIndexTrackCount}`);
      
      if (nonIndexTrackCount === 0) {
        console.log('⏭️ No non-index tracks to resize');
        return;
      }
      
      // Calculate new responsive widths based on current container size
      const newWidths = this.calculateDynamicWidths(containerWidth, nonIndexTrackCount);
      
      // Apply new widths to tracks
      this.applyTrackWidths(newWidths);
      
      // Update widget layout to reflect changes
      this.wellLogWidget.updateLayout();
      
      console.log('✅ Dynamic track width recalculation completed');
    } catch (error) {
      console.error('❌ Error during track width recalculation:', error);
    }
  }

  /**
   * Gets the current container width in pixels.
   * Uses the widget component's container element for accurate measurements.
   * 
   * @returns Container width in pixels
   * @private
   */
  private getContainerWidth(): number {
    try {
      // Try multiple approaches to get container width
      const canvasElement = this.widgetComponent?.Canvas?.nativeElement;
      const containerElement = this.widgetComponent?.ContainerElement?.nativeElement;
      
      // Try canvas element first, then container element
      let width = canvasElement?.clientWidth || 
                 containerElement?.clientWidth || 
                 this.widgetComponent?.Canvas?.nativeElement?.clientWidth || 0;
      
      // Fallback: use window width if container measurement fails
      if (width === 0) {
        width = window.innerWidth;
      }
      
      return width;
    } catch (error) {
      console.warn('⚠️ Error getting container width:', error);
      return window.innerWidth; // Final fallback
    }
  }

  /**
   * Counts the number of non-index tracks in the configuration.
   * Excludes depth/time index tracks from width calculations.
   * 
   * @returns Number of non-index tracks
   * @private
   */
  private getNonIndexTrackCount(): number {
    return this.listOfTracks.filter(track => !track.isIndex).length;
  }

  /**
   * Calculates optimal track widths based on container width and track count.
   * Uses responsive logic to maximize space utilization while maintaining readability.
   * 
   * @param containerWidth - Available container width in pixels
   * @param trackCount - Number of non-index tracks
   * @returns Array of optimal widths for each track
   * @private
   */
  private calculateDynamicWidths(containerWidth: number, trackCount: number): number[] {
    // Reserve space for index track (depth/time)
    const indexTrackWidth = 60; // Standard depth track width
    const availableWidth = containerWidth - indexTrackWidth;
    
    // Calculate base width per track
    const baseWidth = Math.floor(availableWidth / trackCount);
    
    // Apply minimum and maximum constraints
    const minWidth = 200;  // Minimum readable width
    const maxWidth = 1200; // Maximum reasonable width
    
    let finalWidth = Math.max(minWidth, Math.min(maxWidth, baseWidth));
    
    // Special handling for very small containers
    if (containerWidth < 768) {
      // Mobile: use more compact layout
      finalWidth = Math.max(150, Math.min(400, baseWidth));
    } else if (containerWidth < 1024) {
      // Tablet: moderate layout
      finalWidth = Math.max(180, Math.min(600, baseWidth));
    }
    
    // Return array with same width for all tracks (can be customized for different strategies)
    return Array(trackCount).fill(finalWidth);
  }

  /**
   * Applies calculated widths to the actual GeoToolkit tracks.
   * Updates each non-index track with its new width and logs the changes.
   * 
   * @param widths - Array of new widths for tracks
   * @private
   */
  private applyTrackWidths(widths: number[]): void {
    let trackIndex = 0;
    
    this.listOfTracks.forEach((trackInfo, index) => {
      if (trackInfo.isIndex) {
        return; // Skip index tracks
      }
      
      if (trackIndex >= widths.length) {
        console.warn(` Width array index out of bounds for track ${trackIndex}`);
        return;
      }
      
      try {
        // Get the actual GeoToolkit track
        const geoTrack = this.wellLogWidget.getTrack(index);
        if (geoTrack) {
          const newWidth = widths[trackIndex];
          geoTrack.setWidth(newWidth);
          console.log(` Track ${trackInfo.trackName}: set to ${newWidth}px`);
        }
      } catch (error) {
        console.warn(` Error applying width to track ${trackInfo.trackName}:`, error);
      }
      
      trackIndex++;
    });
  }

  /**
   * Calculates responsive track width based on the number of tracks.
   * Ensures optimal space utilization for different track configurations.
   * 
   * @param trackCount - Number of non-index tracks
   * @returns Optimal width in pixels for each track
   * @private
   */
  private calculateResponsiveTrackWidth(trackCount: number): number {
    // ================================================
    // RESPONSIVE WIDTH RULES - FULL WIDTH UTILIZATION
    // Use maximum available space - tracks will take remaining full width
    // ================================================
    
    if (trackCount === 0) return 100;                    // Default fallback
    if (trackCount === 1) return 1200;                  // Single track takes full width
    if (trackCount === 2) return 600;                   // Two tracks split full width
    if (trackCount === 3) return 400;                   // Three tracks share full width
    if (trackCount === 4) return 350;                   // Four tracks get large space
    if (trackCount === 5) return 320;                   // Five tracks take most of full width
    if (trackCount === 6) return 300;                   // Six tracks get good space
    
    // For 7+ tracks, use minimal width to fit all
    return Math.max(200, Math.floor(1400 / trackCount));
  }

  // Public methods for external control

  /**
   * Refreshes the tracks by reloading log headers and recreating the scene.
   * Can be called externally to update the display with new data.
   */
  public refreshTracks(): void {
    this.loadLogHeadersAndCreateTracks();
  }

  /**
   * Gets the underlying WellLogWidget instance.
   * Provides access to the widget for external manipulation.
   * 
   * @returns The WellLogWidget instance
   */
  public getWidget(): WellLogWidget {
    return this.wellLogWidget;
  }


  /**
   * Toggles between dark and light theme.
   * Updates the theme state and applies appropriate CSS classes to GeoToolkit elements.
   */
  public toggleDarkTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;
    console.log('🎨 Theme toggled to:', this.isDarkTheme ? 'dark' : 'light');
    
    // Apply theme to GeoToolkit headers and tracks
    this.applyGeoToolkitTheme();
  }

  /**
   * Gets the current CSS class for the canvas wrapper based on theme.
   * 
   * @returns CSS class string for theme
   */
  public getCanvasThemeClass(): string {
    return this.isDarkTheme ? 'dark-theme' : 'light-theme';
  }

  /**
   * Gets the current CSS class for the toolbar based on theme.
   * 
   * @returns CSS class string for theme
   */
  public getToolbarThemeClass(): string {
    return this.isDarkTheme ? 'dark-theme' : 'light-theme';
  }

  /**
   * Applies theme styling to GeoToolkit headers and tracks.
   * Uses CssStyle to programmatically set colors for headers, tracks, and curves.
   * 
   * @private
   */
  private applyGeoToolkitTheme(): void {
    if (!this.wellLogWidget) {
      console.warn('⚠️ WellLogWidget not available for theme application');
      return;
    }

    try {
      console.log('🎨 Applying GeoToolkit theme:', this.isDarkTheme ? 'dark' : 'light');
      
      // Define theme colors
      const theme = this.isDarkTheme ? {
        headerBg: 'transparent',
        headerText: '#e2e8f0',
        headerBorder: '#4a5568',
        trackBg: '#1a202c',
        trackBorder: '#4a5568',
        gridLines: '#1a202c',
        axisText: '#e2e8f0',
        curveColors: ['#63b3ed', '#f687b3', '#68d391', '#fbb6ce', '#90cdf4']
      } : {
        headerBg: 'transparent',
        headerText: '#2d3748',
        headerBorder: '#e2e8f0',
        trackBg: '#f7fafc',
        trackBorder: '#cbd5e0',
        gridLines: '#e2e8f0',
        axisText: '#4a5568',
        curveColors: ['#3182ce', '#d53f8c', '#38a169', '#ed64a6', '#2b6cb0']
      };

      // Create comprehensive CSS for GeoToolkit elements
      const geoToolkitCSS = new CssStyle({
        css: [
          /* Header styles */
          '.geotoolkit.welllog.header.Header {',
          `  fillstyle: ${theme.headerBg};`,
          `  textstyle-color: ${theme.headerText};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Track container styles */
          '.geotoolkit.welllog.LogTrack {',
          `  fillstyle: ${theme.trackBg};`,
          `  linestyle-color: ${theme.trackBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Index track styles */
          '.geotoolkit.welllog.IndexTrack {',
          `  fillstyle: ${theme.trackBg};`,
          `  linestyle-color: ${theme.trackBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Grid lines */
          '.geotoolkit.welllog.grid.Grid {',
          `  linestyle-color: ${theme.gridLines};`,
          '  linestyle-width: 0.5;',
          '}',
          
          /* Axis labels and text */
          '.geotoolkit.welllog.axis.Axis {',
          `  textstyle-color: ${theme.axisText};`,
          `  linestyle-color: ${theme.gridLines};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Curve visual headers */
          '.geotoolkit.welllog.header.AdaptiveLogCurveVisualHeader {',
          `  textstyle-color: ${theme.headerText};`,
          `  fillstyle: ${theme.headerBg};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Track title headers */
          '.geotoolkit.welllog.header.TitleHeader {',
          `  textstyle-color: ${theme.headerText};`,
          `  fillstyle: ${theme.headerBg};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Depth scale headers */
          '.geotoolkit.welllog.header.ScaleHeader {',
          `  textstyle-color: ${theme.headerText};`,
          `  fillstyle: ${theme.headerBg};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Cross-hair tool */
          '.geotoolkit.controls.tools.CrossHair {',
          `  linestyle-color: ${theme.axisText};`,
          '  linestyle-width: 1;',
          `  textstyle-color: ${theme.axisText};`,
          '}',
          
          /* Selection box */
          '.geotoolkit.controls.tools.SelectionBox {',
          `  linestyle-color: ${theme.curveColors[0]};`,
          '  linestyle-width: 2;',
          `  fillstyle: ${theme.curveColors[0]}20;`, // Semi-transparent
          '}'
        ].join('\n')
      });

      // Apply the CSS to the widget
      this.wellLogWidget.setCss(geoToolkitCSS);
      console.log('✅ GeoToolkit theme applied successfully');
      
    } catch (error) {
      console.error('❌ Error applying GeoToolkit theme:', error);
    }
  }
}
