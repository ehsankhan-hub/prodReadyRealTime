import { Component, Input, OnInit, AfterViewInit, ViewChild, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { BaseWidgetComponent } from '../../../components/core/basewidget/basewidget.component'; 
import { RealTimeDisplayService ,  LogData } from '../../../service/real-time-display.service'; 

import { PrintPropertiesDialogComponent , PrintPropertiesData, PrintPropertiesResult} from '../../../components/core/basewidget/print-properties-dialog/print-properties-dialog.component'; 
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
import { Subscription } from 'rxjs';
import { WellDataService } from "../../../service/well-service/well.service";
import {
  ILogDataQueryParameter,
  IMnemonic,
  IWellboreLogData,
  IWellboreObject,
} from "../../../models/wellbore/wellbore-object";

// INT GeoToolkit type definitions for proper typing
interface ITrack {
  getName(): string;
  setDepthLimits(min: number, max: number): void;
}

interface ITracksCollection {
  forEach(callback: (track: ITrack) => void): void;
  length?: number;
  [index: number]: ITrack;
}

// Handle different possible return types from getTracks()
type TracksResult = ITracksCollection | ITrack[] | Iterator<ITrack> | null | undefined;

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
  trackWidth?: number;
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

@Component({
  selector: 'app-dynamic-track-generator',
  standalone: true,
   imports: [CommonModule, FormsModule, HttpClientModule, MatDialogModule, MatButtonModule, BaseWidgetComponent, ],
  templateUrl: './dynamic-track-generator.component.html',
  styleUrl: './dynamic-track-generator.component.scss'
})
export class DynamicTrackGeneratorComponent implements OnInit, AfterViewInit, OnDestroy {
  /** Array of track configurations to display */
  @Input() listOfTracks: TrackInfo[] = [];
  /** Unique identifier for the well */
  @Input() well: string = '';
  /** Unique identifier for the wellbore */
  @Input() wellbore: string = '';
  /** Index type: 'depth' or 'time' */
  @Input() indexType: 'depth' | 'time' = 'depth';

  /** Reference to the base widget component that hosts the canvas */
  @ViewChild('canvasWidget', { static: true })
  private widgetComponent!: BaseWidgetComponent;

  /** GeoToolkit WellLogWidget instance for rendering tracks and curves */
  private wellLogWidget!: WellLogWidget;
  /** Array of subscriptions to manage cleanup */
  private subscriptions: Subscription[] = [];
  /** Counter for tracking pending data loads */
  private pendingLoads = 0;
  /** Flag indicating if the component view is ready */
  private sceneReady = false;
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

  /** Tooltip data for the cross-tooltip component */
//  tooltipData: CrossTooltipData | null = null;

  /** Map of curve mnemonic to GeoToolkit LogCurve reference for crosshair lookup */
  private curveMap: Map<string, { logCurve: LogCurve; info: TrackCurve; trackName: string }> = new Map();

  // --- Chunked loading state ---
  /** Cached log headers for lazy loading */
  private cachedHeaders: IWellboreObject[] = [];
  /** Number of depth rows per chunk */
  private readonly CHUNK_SIZE = 2000;
  /** The overall max depth from headers (not from loaded data) */
  private headerMaxDepth = 0;
  /** Tracks which depth ranges have been loaded per curve */
  private loadedRanges: Map<string, { min: number; max: number }> = new Map();
  /** Depth indices per curve (parallel to data values) */
  private curveDepthIndices: Map<string, number[]> = new Map();
  /** Tracks in-flight chunk ranges to prevent duplicate requests */
  private inFlightRanges: Set<string> = new Set();
  
  private wellboreObjects: IWellboreObject[] = [];

  // Version 2: Live polling state for real-time data appending
  /** Handle for live data polling interval */
  private livePollHandle: any = null;
  /** Live polling interval in milliseconds */
  private readonly LIVE_POLL_INTERVAL = 5000;
  /** Flag to enable/disable live data polling */
  private isLivePolling = false;

  /**
   * Creates an instance of DynamicTrackGeneratorComponent.
   * @param logHeadersService - Service for fetching log headers and data
   */
  constructor(
    private logHeadersService: WellDataService,
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
    this.loadLogHeadersAndCreateTracks();
  }

  /**
   * Angular lifecycle hook called after the component view has been initialized.
   * Sets the scene ready flag and waits for data to load before creating scene.
   */
  ngAfterViewInit(): void {
    this.sceneReady = true;
    console.log('🔧 Scene ready - waiting for data to load');
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
    // Version 2: Clean up live polling on destroy
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
    (async () => {
      this.wellboreObjects = await this.logHeadersService.getLogHeader(
        this.well,
        this.wellbore
      );

      console.log('this.wellboreObjects  ', this.wellboreObjects);
      console.log('📊 Log Headers loaded:', this.wellboreObjects);

      // Version 2: Store wellboreObjects as cachedHeaders for chunk loading & live polling
      this.cachedHeaders = this.wellboreObjects;

      await this.processLogHeaders(this.wellboreObjects);
      this.isLoading = false;
    })();
  }

  /**
   * Processes loaded log headers and initiates data loading.
   * Groups curves by LogId to avoid duplicate API calls — one call per unique LogId.
   * 
   * @param headers - Array of loaded log headers
   * @private
   */
  private async processLogHeaders(headers: IWellboreObject[]): Promise<void> {
    console.log('processLogHeaders ', headers);

    // Version 2: Calculate headerMaxDepth from backend endIndex for proper depth limits
    headers?.forEach(h => {
      // endIndex can be a string number (depth) or a date string (time)
      const endVal = h.endIndex?.['#text'] || h.endIndex;
      const end = parseFloat(String(endVal));
      if (!isNaN(end) && end > this.headerMaxDepth) {
        this.headerMaxDepth = end;
      }
    });
    console.log('📏 Header max depth calculated:', this.headerMaxDepth);

    // Group all curves by LogId to avoid duplicate API calls
    const logIdGroups = new Map<string, { header: IWellboreObject; curves: TrackCurve[] }>();
    
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        console.log('curve.LogId ', curve.LogId);
        const matchingHeader = headers.find(header => { 
          console.log('header.objectId.includes ', header.objectId.includes(curve.LogId));
          return header.objectId.includes(curve.LogId); 
        });
        console.log('matchingHeader ', matchingHeader);
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

    // Version 2: Load initial chunk per LogId using actual header start/end values
    const loadPromises: Promise<void>[] = [];
    logIdGroups.forEach(({ header, curves }, logId) => {
      // Use the actual startIndex and endIndex from the header
      const startIndex = header.startIndex?.['#text'] || header.startIndex || '0';
      const endIndex = header.endIndex?.['#text'] || header.endIndex || '1000';
      console.log(`📦 Loading initial chunk for LogId ${logId}: ${startIndex}-${endIndex} (${curves.length} curves)`);
      loadPromises.push(this.loadLogDataForGroup(header, curves, startIndex, endIndex));
    });

    // Wait for all data loading to complete before proceeding
    await Promise.all(loadPromises);
    console.log('✅ All LogId data loading completed');
  }

  /**
   * Loads log data for a group of curves that share the same LogId.
   * Makes one API call and distributes data to all curves in the group.
   * 
   * Version 2: Fixed - removed duplicate API calls and hardcoded params.
   * Now uses dynamic header values and single API call with proper response parsing.
   * 
   * @param header - Log header containing metadata
   * @param curves - All curves sharing this LogId
   * @param startIndex - Starting index for data range
   * @param endIndex - Ending index for data range
   * @private
   */
  private loadLogDataForGroup(header: IWellboreObject, curves: TrackCurve[], startIndex: string, endIndex: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const queryParameter: ILogDataQueryParameter = {
        wellUid: this.well,
        logUid: header.objectId,
        wellboreUid: this.wellbore,
        logName: header.objectName,
        indexType: header.indexType,
        indexCurve: header.indexCurve,
        startIndex: startIndex,
        endIndex: endIndex,
        isGrowing: header.objectGrowing,
        mnemonicList: '',
      };
      console.log('queryParameter ', queryParameter);

      // Handle both Observable and direct return types from getLogData
      const result = this.logHeadersService.getLogData(queryParameter);
      
      // Check if result is an Observable (has subscribe method)
      if (result && typeof result.subscribe === 'function') {
        // It's an Observable - use subscribe
        (result as any).subscribe({
          next: (logDataArray: IWellboreLogData) => {
            console.log('logDataArray  ---', logDataArray);
            if (logDataArray != null) {
              // Version 2: Parse using backend response format (logs[0].logData)
              curves.forEach(curve => this.parseCurveData(logDataArray, curve, false));
            } else {
              console.warn(`⚠️ No log data found for LogId: ${header.objectName}`);
            }
            this.pendingLoads--;
            if (this.pendingLoads <= 0 && this.sceneReady) {
              console.log('🎯 All data loaded - creating scene');
              this.createSceneWithData();
            }
            resolve();
          },
          error: (err: Error) => {
            console.error('❌ Error loading log data for LogId:', header.objectId, err);
            this.pendingLoads--;
            if (this.pendingLoads <= 0 && this.sceneReady) {
              this.createSceneWithData();
            }
            reject(err);
          }
        });
      } else {
        // It's a direct result - handle synchronously
        try {
          console.log('logDataArray  ---', result);
          if (result != null) {
            // Version 2: Parse using backend response format (logs[0].logData)
            curves.forEach(curve => this.parseCurveData(result, curve, false));
          } else {
            console.warn(`⚠️ No log data found for LogId: ${header.objectName}`);
          }
          this.pendingLoads--;
          if (this.pendingLoads <= 0 && this.sceneReady) {
            console.log('🎯 All data loaded - creating scene');
            this.createSceneWithData();
          }
          resolve();
        } catch (err) {
          console.error('❌ Error loading log data for LogId:', header.objectId, err);
          this.pendingLoads--;
          if (this.pendingLoads <= 0 && this.sceneReady) {
            this.createSceneWithData();
          }
          reject(err);
        }
      }
    });
  }

  /**
   * Parses raw log data and extracts values for a specific curve.
   * Also stores depth indices for each curve for correct mapping.
   * 
   * Version 2: Handles real backend response format { logs: [{ logData: { data, mnemonicList } }] }
   * 
   * @param logData - Log data from backend (full response with logs array)
   * @param curve - Track curve object to populate with parsed data
   * @param decrementPending - Whether to decrement pendingLoads counter (false when called from group loader)
   * @private
   */
  private parseCurveData(logData: any, curve: TrackCurve, decrementPending: boolean = true): void {
    // Version 2: Extract logData from backend response format
    // Backend returns: { logs: [{ logData: { data: [...], mnemonicList: "..." } }] }
    const innerLogData = logData?.logs?.[0]?.logData;
    if (!innerLogData || !innerLogData.data || !innerLogData.mnemonicList) {
      console.warn(`⚠️ Invalid logData structure for curve ${curve.mnemonicId}:`, logData);
      if (decrementPending) {
        this.pendingLoads--;
        if (this.pendingLoads <= 0 && this.sceneReady) {
          this.createSceneWithData();
        }
      }
      return;
    }

    console.log('logData----', innerLogData.data);
    console.log('logData.mnemonicList----', innerLogData.mnemonicList);

    const mnemonics = innerLogData.mnemonicList.split(',');
    console.log('mnemonics ----', mnemonics);
    const curveIndex = mnemonics.findIndex((m: any) => m.trim() === curve.mnemonicId);
    const timeIndex = mnemonics.findIndex((m: any) => m.trim() === 'MWD_Depth'); // Changed from DEPTH to MWD_Depth
    
    console.log(`🔍 Parsing ${curve.mnemonicId}: curveIndex=${curveIndex}, timeIndex=${timeIndex}, dataRows=${innerLogData.data.length}`);
    
    if (curveIndex === -1) {
      console.warn('⚠️ Mnemonic not found:', curve.mnemonicId, '| Available:', mnemonics);
      if (decrementPending) {
        this.pendingLoads--;
        if (this.pendingLoads <= 0 && this.sceneReady) {
          this.createSceneWithData();
        }
      }
      return;
    }

    const times: number[] = [];
    const values: number[] = [];

    innerLogData.data.forEach((dataRow: any) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const value = parseFloat(cols[curveIndex]);
        const timeString = timeIndex >= 0 ? cols[timeIndex] : null;
        
        // Convert time string to timestamp (milliseconds since epoch)
        let timeValue = NaN;
        if (timeString) {
          try {
            timeValue = new Date(timeString).getTime();
          } catch (e) {
            console.warn('⚠️ Invalid time format:', timeString);
          }
        }
        
        if (!isNaN(value) && !isNaN(timeValue)) {
          times.push(timeValue);
          values.push(value);
        }
      }
    });

    curve.data = values;
    this.curveDepthIndices.set(curve.mnemonicId, times); // Store times instead of depths

    // Track loaded range
    if (times.length > 0) {
      this.loadedRanges.set(curve.mnemonicId, {
        min: times[0],
        max: times[times.length - 1],
      });
    }

    console.log('✅ Parsed data for curve:', curve.mnemonicId, values.length, 'points',
      times.length > 0 ? `time range: ${times[0]}-${times[times.length - 1]}` : '');

    // Only decrement pending loads when called directly (not from group loader)
    if (decrementPending) {
      this.pendingLoads--;
      console.log(`⏳ Pending loads remaining: ${this.pendingLoads}`);
      if (this.pendingLoads <= 0 && this.sceneReady) {
        console.log('🎯 All data loaded - updating scene');
        this.createSceneWithData();
      }
    }
  }

  /**
   * AUTO-DETECTION: Determines if the loaded data is time-based or depth-based.
   * Checks multiple sources to make the best determination:
   * 1. Track configuration (isIndex track marked as non-depth)
   * 2. Log header metadata (indexType contains 'time' or indexCurve contains 'time')
   * 3. Defaults to depth-based if no time indicators found
   * 
   * @returns true if data is time-based, false if depth-based
   * @private
   */
  private detectTimeBasedData(): boolean {
    // ================================================
    // METHOD 1: Check track configuration for time-based index track
    // ================================================
    const hasTimeIndexTrack = this.listOfTracks.some(track => 
      track.isIndex && !track.isDepth
    );
    
    if (hasTimeIndexTrack) {
      console.log('🕐 Time-based data detected from track configuration (isIndex && !isDepth)');
      return true;
    }
    
    // ================================================
    // METHOD 2: Check log header metadata for time indicators
    // ================================================
    if (this.cachedHeaders.length > 0) {
      const firstHeader = this.cachedHeaders[0];
      const indexTypeHasTime = firstHeader?.indexType?.toLowerCase().includes('time');
      const indexCurveHasTime = firstHeader?.indexCurve?.toLowerCase().includes('time');
      
      if (indexTypeHasTime || indexCurveHasTime) {
        console.log('🕐 Time-based data detected from log header metadata');
        console.log(`   indexType: ${firstHeader?.indexType}, indexCurve: ${firstHeader?.indexCurve}`);
        return true;
      }
    }
    
    // ================================================
    // DEFAULT: Assume depth-based if no time indicators found
    // ================================================
    console.log('📏 Depth-based data assumed (no time indicators found)');
    return false;
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

      // ================================================
      // AUTO-DETECTION: Determine if data is time-based or depth-based
      // This allows one component to handle both data types dynamically
      // ================================================
      const isTimeBased = this.detectTimeBasedData();
      console.log(`🔍 Data type detected: ${isTimeBased ? 'TIME-based' : 'DEPTH-based'}`);

      // Create WellLogWidget with dynamic configuration
      this.wellLogWidget = new WellLogWidget({
        indextype: isTimeBased ? IndexType.Time : IndexType.Depth,  // Dynamic: Time or Depth
        indexunit: isTimeBased ? 's' : 'ft',                        // Dynamic: seconds or feet
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

      this.wellLogWidget.setLayoutStyle({
        left: 0, top: 0, right: 0, bottom: 0
      });

      // Create index track first to ensure it's always visible
      
      // ================================================
      // BACKEND DRIVEN INDEX TRACK CREATION
      // Index depth calculation from backend service not GeoToolkit default
      // This creates index track based on actual loaded data from all tracks
      // ================================================
      this.createRealIndexTracksFromBackend();
      
      // ================================================
      // DEFAULT GEOTOOLKIT INDEX TRACK CREATION (COMMENTED)
      // Fallback: Use default GeoToolkit logic if backend approach causes issues
      // Uncomment the following lines and comment out the above call if needed:
      // const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
      // indexTrack.setWidth(60);
      // indexTrack.setName('Depth');
      // ================================================

      // Assign widget to BaseWidgetComponent
      this.widgetComponent.Widget = this.wellLogWidget;
      console.log('✅ Widget assigned to BaseWidgetComponent');

      // Create data tracks
      this.createTracks();

      // Set depth limits, show recent data first, and configure crosshair + scroll listener
      setTimeout(() => {
        try {
          // Version 2: Use actual depth from loaded data if headerMaxDepth is 0 (e.g. time-based logs)
          const fullMaxDepth = this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();
          console.log('📊 Setting depth limits: 0 to', fullMaxDepth);
          this.wellLogWidget.setDepthLimits(0, fullMaxDepth);

          // Show recent data first: scroll to bottom of loaded data
          const loadedMax = this.getMaxDepth();
          if (this.selectedScale > 0 && this.selectedScale < loadedMax) {
            const visibleRange = this.selectedScale;
            const recentStart = loadedMax - visibleRange;
            this.wellLogWidget.setVisibleDepthLimits(recentStart, loadedMax);
          } else {
            this.applyScale(this.selectedScale);
          }

          this.wellLogWidget.updateLayout();

          // Configure crosshair for tooltip
          this.configureCrossHair();

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

  /** Handle for the scroll polling interval */
  private scrollPollHandle: any = null;
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
    // Poll every 300ms for visible depth changes
    this.scrollPollHandle = setInterval(() => {
      if (!this.wellLogWidget) return;
      try {
        const visibleLimits: any = this.wellLogWidget.getVisibleDepthLimits();
        if (!visibleLimits) return;
        const vMin = visibleLimits.getLow ? visibleLimits.getLow() : 0;
        const vMax = visibleLimits.getHigh ? visibleLimits.getHigh() : 0;

        // Only trigger if visible range actually changed
        if (Math.abs(vMin - this.lastVisibleMin) > 1 || Math.abs(vMax - this.lastVisibleMax) > 1) {
          this.lastVisibleMin = vMin;
          this.lastVisibleMax = vMax;
          this.ngZone.run(() => this.checkAndLoadChunks());
        }
      } catch (_) { /* widget may not be ready */ }
    }, 300);
  }

  /**
   * Checks current visible depth range and loads missing chunks.
   * Groups requests by LogId to avoid duplicate API calls during scroll.
   * 
   * Version 2: Uses cachedHeaders (populated from wellboreObjects) and
   * properly converts backend response via convertResponseToLogData before appending.
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
    const buffer = this.CHUNK_SIZE / 2;
    const needMin = Math.max(0, vMin - buffer);
    const needMax = Math.min(this.headerMaxDepth, vMax + buffer);

    // Build chunk requests grouped by LogId+direction, using ONE reference range per LogId
    const chunkRequests = new Map<string, { header: IWellboreObject; curves: TrackCurve[]; start: number; end: number }>();

    // Version 2: Group curves by LogId using cachedHeaders (now populated from wellboreObjects)
    const logIdCurves = new Map<string, { header: IWellboreObject; curves: TrackCurve[]; range: { min: number; max: number } }>();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        if (logIdCurves.has(curve.LogId)) {
          logIdCurves.get(curve.LogId)!.curves.push(curve);
          return;
        }
        // Version 2: Match using objectId.includes() (same as processLogHeaders)
        const matchingHeader = this.cachedHeaders.find(h => h.objectId.includes(curve.LogId));
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
        const chunkStart = Math.max(0, needMin - this.CHUNK_SIZE / 2);
        const chunkEnd = Math.min(this.headerMaxDepth, needMin + this.CHUNK_SIZE / 2);
        const key = `${logId}_${chunkStart}_${chunkEnd}`;
        if (!this.inFlightRanges.has(key)) {
          chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
        }
      } else {
        // Check if we need data below loaded range (user scrolled up)
        if (needMin < range.min && range.min > 0) {
          const chunkEnd = range.min;
          const chunkStart = Math.max(0, chunkEnd - this.CHUNK_SIZE);
          const key = `${logId}_${chunkStart}_${chunkEnd}`;
          if (!this.inFlightRanges.has(key)) {
            chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
          }
        }

        // Check if we need data above loaded range (user scrolled down)
        if (needMax > range.max && range.max < this.headerMaxDepth) {
          const chunkStart = range.max;
          const chunkEnd = Math.min(this.headerMaxDepth, chunkStart + this.CHUNK_SIZE);
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
      console.log(`  📥 Chunk: ${start}-${end} for ${header.objectId}`);

      this.logHeadersService.getLogData({
        wellUid: this.well,
        logUid: header.objectId,
        wellboreUid: this.wellbore,
        logName: header.objectName,
        indexType: header.indexType,
        indexCurve: header.indexCurve,
        startIndex: start.toString(),
        endIndex: end.toString(),
        isGrowing: header.objectGrowing,
        mnemonicList: '',
      }).subscribe({
        next: (logDataArray: any) => {
          // Version 2: Convert backend response and append chunk data (was previously commented out)
          if (logDataArray != null && logDataArray.logs && logDataArray.logs.length > 0 && logDataArray.logs[0].logData?.data?.length > 0) {
            const convertedLogData = this.convertResponseToLogData(logDataArray.logs[0]);
            curves.forEach(curve => this.appendChunkData(convertedLogData, curve));
          }
          onDone(key);
        },
        error: () => onDone(key),
      });
    });
  }

  /**
   * Appends a new chunk of data to an existing curve without recreating the scene.
   * Merges new data into existing arrays sorted by depth.
   * 
   * @param logData - New chunk of log data (converted to flat format by convertResponseToLogData)
   * @param curve - Curve to append data to
   * @private
   */
  private appendChunkData(logData: any, curve: TrackCurve): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex((m: string) => m.trim() === curve.mnemonicId);
    const depthIdx = mnemonics.findIndex((m: string) => m.trim() === 'DEPTH');
    if (curveIndex === -1 || depthIdx === -1) return;

    const newDepths: number[] = [];
    const newValues: number[] = [];

    logData.data.forEach((row: string) => {
      const cols = row.split(',');
      const depth = parseFloat(cols[depthIdx]);
      const value = parseFloat(cols[curveIndex]);
      if (!isNaN(depth) && !isNaN(value)) {
        newDepths.push(depth);
        newValues.push(value);
      }
    });

    if (newDepths.length === 0) return;

    // Merge with existing data
    const existingDepths = this.curveDepthIndices.get(curve.mnemonicId) || [];
    const existingValues = curve.data || [];

    // Create a map for deduplication
    const depthValueMap = new Map<number, number>();
    for (let i = 0; i < existingDepths.length; i++) {
      depthValueMap.set(existingDepths[i], existingValues[i]);
    }
    for (let i = 0; i < newDepths.length; i++) {
      depthValueMap.set(newDepths[i], newValues[i]);
    }

    // Sort by depth
    const sortedEntries = Array.from(depthValueMap.entries()).sort((a, b) => a[0] - b[0]);
    const mergedDepths = sortedEntries.map(e => e[0]);
    const mergedValues = sortedEntries.map(e => e[1]);

    curve.data = mergedValues;
    this.curveDepthIndices.set(curve.mnemonicId, mergedDepths);

    // Update loaded range
    this.loadedRanges.set(curve.mnemonicId, {
      min: mergedDepths[0],
      max: mergedDepths[mergedDepths.length - 1],
    });

    // Update the GeoToolkit curve data source
    const entry = this.curveMap.get(curve.mnemonicId);
    if (entry) {
      try {
        const geoLogData = new GeoLogData(curve.displayName);
        geoLogData.setValues(mergedDepths, mergedValues);
        entry.logCurve.setData(geoLogData);
      } catch (e) {
        console.warn('⚠️ Could not update curve data source for', curve.mnemonicId, e);
      }
    }

    console.log(`📈 Appended chunk to ${curve.mnemonicId}: now ${mergedValues.length} points, depth ${mergedDepths[0]}-${mergedDepths[mergedDepths.length - 1]}`);
    
    // Update index track scale if we have new depth range
    this.updateIndexTrackScale();
  }

  /**
   * Updates the index track scale to show the full depth range.
   * Ensures the index track always shows the complete scale, not just visible range.
   * 
   * @private
   */
  private updateIndexTrackScale(): void {
    if (!this.wellLogWidget) return;
    
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
            
            if (track && typeof track === 'object' && track.getName) {
              const trackName = track.getName?.() || '';
              console.log(`🔍 Track ${i} name: ${trackName}`);
              if (trackName === 'Depth' || trackName === 'Time') {
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
        // Handle crosshair position changes for tooltips
        // You can add tooltip logic here if needed
      });
    } catch (error) {
      console.warn('⚠️ Could not configure CrossHair tool:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Version 2: LIVE DATA POLLING
  //
  // Polls the backend at regular intervals for new data beyond the current
  // loaded max depth. Groups requests by LogId (same as checkAndLoadChunks).
  // Uses appendChunkData() to merge new data into existing curves in-place.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Version 2: Starts live data polling at LIVE_POLL_INTERVAL.
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
   * Version 2: Stops live data polling and clears the interval.
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
   * Version 2: Fetches new data beyond the current loaded max depth for each LogId.
   * Groups curves by LogId to minimize API calls (one per unique LogId).
   * Uses appendChunkData() to merge new data without rebuilding the scene.
   *
   * @private
   */
  private loadNewLiveData(): void {
    if (!this.wellLogWidget || !this.isLivePolling) return;

    // Group curves by LogId → one API call per unique LogId
    const logIdCurves = new Map<string, { header: IWellboreObject; curves: TrackCurve[]; maxLoaded: number }>();

    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        if (logIdCurves.has(curve.LogId)) {
          logIdCurves.get(curve.LogId)!.curves.push(curve);
          return;
        }
        const matchingHeader = this.cachedHeaders.find(h => h.objectId.includes(curve.LogId));
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

      console.log(`🔄 Live poll: ${start}-${end} for ${header.objectId}`);

      const queryParameter: ILogDataQueryParameter = {
        wellUid: this.well,
        logUid: header.objectId,
        wellboreUid: this.wellbore,
        logName: header.objectName,
        indexType: header.indexType,
        indexCurve: header.indexCurve,
        startIndex: start,
        endIndex: end,
        isGrowing: header.objectGrowing,
        mnemonicList: '',
      };

      this.logHeadersService.getLogData(queryParameter).subscribe({
        next: (response: any) => {
          if (response && response.logs && response.logs.length > 0 && response.logs[0].logData?.data?.length > 0) {
            // Convert response to flat LogData format for appendChunkData
            const logData = this.convertResponseToLogData(response.logs[0]);
            curves.forEach(curve => this.appendChunkData(logData, curve));
            
            console.log(`✅ Live data loaded: ${response.logs[0].logData.data.length} rows for ${logId}`);
          }
          this.inFlightRanges.delete(key);
        },
        error: (err: any) => {
          console.warn(`⚠️ Live poll error for ${logId}:`, err);
          this.inFlightRanges.delete(key);
        },
      });
    });
  }

  /**
   * Version 2: Converts real backend response to flat LogData format for appendChunkData.
   * Backend returns: { logData: { data: [...], mnemonicList: "...", unitList: "..." } }
   * This converts to flat: { mnemonicList: "...", data: [...], unitList: "..." }
   *
   * @param response - Single log entry from backend (logs[0])
   * @returns Flat LogData object with mnemonicList, data, unitList at top level
   * @private
   */
  private convertResponseToLogData(response: any): any {
    return {
      mnemonicList: response.logData.mnemonicList,
      unitList: response.logData.unitList,
      data: response.logData.data,
      uid: response.uid || response.logUid
    };
  }

  /**
   * Configures the built-in GeoToolkit crosshair tool to emit tooltip data.
   * Collects all curve values at the crosshair depth and updates the tooltip panel.
   * 
   * @private
   */
  // private configureCrossHair(): void {
  //   try {
  //     const crossHair: any = this.wellLogWidget.getToolByName('cross-hair');
  //     if (!crossHair) {
  //       console.warn('⚠️ CrossHair tool not found on WellLogWidget');
  //       return;
  //     }

  //     crossHair.on(CrossHairEvents.onPositionChanged, (evt: any, sender: any, eventArgs: any) => {
  //       // Run inside Angular zone so change detection picks up tooltipData updates
  //       this.ngZone.run(() => {
  //         try {
  //           const position = eventArgs.getPosition();
  //           if (!position) {
  //             this.tooltipData = { depth: 0, curveValues: [], screenY: 0, visible: false };
  //             return;
  //           }

  //           // Transform position to model coordinates to get depth
  //           const trackContainer = this.wellLogWidget.getTrackContainer();
  //           if (!trackContainer) return;
  //           const sceneTransform = trackContainer.getSceneTransform();
  //           if (!sceneTransform) return;
  //           const pt = sceneTransform.transformPoint(position);
  //           const depth = pt.getY ? pt.getY() : pt.y;

  //           // Get device Y for tooltip vertical position
  //           const posY = position.getY ? position.getY() : position.y;

  //           // Build flat list of all curve values at this depth
  //          // const curveValues: TooltipCurveValue[] = [];

  //           this.curveMap.forEach((entry) => {
  //             const { logCurve, info, trackName } = entry;
  //             let value: number | null = null;
  //             try {
  //               const dataSource = logCurve.getDataSource();
  //               if (dataSource) {
  //                 const rawValue = dataSource.getValueAt(
  //                   depth, 0, dataSource.getSize(), logCurve.getInterpolationType()
  //                 );
  //                 if (rawValue != null && !isNaN(rawValue) && isFinite(rawValue)) {
  //                   value = rawValue;
  //                 }
  //               }
  //             } catch (_) {
  //               // Data not available at this depth
  //             }

  //             curveValues.push({
  //               mnemonic: info.mnemonicId,
  //               displayName: info.displayName,
  //               value: value,
  //               unit: '',
  //               color: info.color,
  //               trackName: trackName,
  //             });
  //           });

  //           this.tooltipData = {
  //             depth: depth,
  //             curveValues: curveValues,
  //             screenY: posY,
  //             visible: curveValues.length > 0,
  //           };
  //         } catch (e) {
  //           // Silently handle tooltip errors to not break scrolling
  //         }
  //       });
  //     });

  //     console.log('✅ CrossHair configured for tooltip');
  //   } catch (error) {
  //     console.warn('⚠️ Could not configure CrossHair:', error);
  //   }
  // }

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
      indexType: this.indexType,
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
         // track.setWidth(trackInfo.trackWidth || 100);
        }

        // Create curves for this track
        this.createCurves(track, trackInfo);

        console.log(`✅ Track ${trackInfo.trackName} created successfully`);

      } catch (error) {
        console.error(`❌ Error creating track ${trackInfo.trackName}:`, error);
      }
    });
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
   * Calculates the maximum depth based on loaded curve data.
   * Finds the curve with the deepest data point.
   * 
   * @returns Maximum depth in meters (minimum 10m)
   * @private
   */
  private getMaxDepth(): number {
    let maxDepth = 0;
    this.curveDepthIndices.forEach((depths) => {
      if (depths.length > 0) {
        const last = depths[depths.length - 1];
        if (last > maxDepth) maxDepth = last;
      }
    });
    // Fallback to data length if no depth indices
    if (maxDepth === 0) {
      this.listOfTracks.forEach((trackInfo) => {
        trackInfo.curves.forEach((curve) => {
          if (curve.data && curve.data.length > maxDepth) {
            maxDepth = curve.data.length;
          }
        });
      });
    }
    return Math.max(maxDepth, 10); // At least 10m depth
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

  // Public methods for external control

  /**
   * Creates real depth/time-based index tracks from backend data.
   * Extracts actual DEPTH or TIME values from all loaded track data.
   * Index tracks automatically use the depth/time scale from the data tracks.
   * 
   * FIXED VERSION: Calculates depth range from ALL tracks, not just first track
   * This prevents the scrolling issue where only first track data was visible
   * 
   * @private
   */
  private createRealIndexTracksFromBackend(): void {
    console.log('🎯 Creating real index tracks from backend data...');
    
    // Find index track configuration to determine type
    let isTimeBased = false;
    let indexTrackFound = false;
    
    for (const trackInfo of this.listOfTracks) {
      if (trackInfo.isIndex) {
        isTimeBased = !trackInfo.isDepth;
        indexTrackFound = true;
        console.log(`📊 Index track type: ${isTimeBased ? 'Time-based' : 'Depth-based'}`);
        break;
      }
    }
    
    if (!indexTrackFound) {
      console.warn('⚠️ No index track configuration found - using default depth-based');
      isTimeBased = false;
    }
    
    // Debug: Check actual depth values from backend data
    console.log('🔍 Verifying real backend depth values...');
    for (const trackInfo of this.listOfTracks) {
      if (!trackInfo.isIndex && trackInfo.curves.length > 0) {
        const firstCurve = trackInfo.curves[0];
        const depthIndices = this.curveDepthIndices.get(firstCurve.mnemonicId);
        if (depthIndices && depthIndices.length > 0) {
          console.log(`📏 Real backend depth values from ${firstCurve.mnemonicId}:`);
          console.log(`  First depth: ${depthIndices[0]}, Last depth: ${depthIndices[depthIndices.length - 1]}`);
          console.log(`  Total points: ${depthIndices.length}`);
          break;
        }
      }
    }
    
    // Create real index track - GeoToolkit will automatically use depth/time from data tracks
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    indexTrack.setWidth(60);
    indexTrack.setName(isTimeBased ? 'Time' : 'Depth');
    
    // Configure index track to show full scale instead of just visible range
    // Get the full depth range from ALL loaded data (FIXED: check all tracks, not just first)
    let fullMinDepth = Number.MAX_VALUE;
    let fullMaxDepth = Number.MIN_VALUE;
    
    // ================================================
    // FIXED: Calculate depth range from ALL tracks to prevent scrolling issues
    // Previous version only checked first track which caused other tracks to become invisible
    // ================================================
    for (const trackInfo of this.listOfTracks) {
      if (!trackInfo.isIndex && trackInfo.curves.length > 0) {
        for (const curve of trackInfo.curves) {
          const depthIndices = this.curveDepthIndices.get(curve.mnemonicId);
          if (depthIndices && depthIndices.length > 0) {
            fullMinDepth = Math.min(fullMinDepth, depthIndices[0]);
            fullMaxDepth = Math.max(fullMaxDepth, depthIndices[depthIndices.length - 1]);
            console.log(`📏 Track ${trackInfo.trackName}, Curve ${curve.mnemonicId}: depth range ${depthIndices[0]}-${depthIndices[depthIndices.length - 1]}`);
          }
        }
      }
    }
    
    // Set the index track to show the full scale
    if (fullMinDepth !== Number.MAX_VALUE && fullMaxDepth !== Number.MIN_VALUE) {
      console.log(`📏 Setting index track full scale from ALL tracks: ${fullMinDepth} to ${fullMaxDepth}`);
      // Configure the index track to show full scale
      indexTrack.setDepthLimits(fullMinDepth, fullMaxDepth);
    } else {
      console.warn('⚠️ No depth data found for index track scale - using default behavior');
    }
    
    console.log(`✅ Created real ${isTimeBased ? 'time-based' : 'depth-based'} index track from backend data`);
    console.log('📏 Index track will show full depth scale from backend data');
    console.log('🎯 All tracks should remain visible during scrolling');
  }

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
}
