import {
  Component,
  Input,
  OnInit,
  AfterViewInit,
  ViewChild,
  OnDestroy,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { BaseWidgetComponent } from '../basewidget/basewidget.component';
import {
  LogHeadersService,
  LogHeader,
  LogData,
} from '../services/log-headers.service';

import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
import { Subscription } from 'rxjs';


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
@Component({
  selector: 'app-genrate-canvas-tracks-time',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatDialogModule,
    MatButtonModule,
    BaseWidgetComponent,

  ],
  providers: [LogHeadersService],
  template: `
    <div class="well-log-container">
      <div class="toolbar">
        <label for="scaleSelect">Scale:</label>
        <select id="scaleSelect" [(ngModel)]="selectedScale" (ngModelChange)="onScaleChange($event)">
          <option *ngFor="let scale of scaleOptions" [value]="scale.value">{{ scale.label }}</option>
        </select>
        <button class="settings-btn" (click)="openPrintProperties()" title="Print Properties">&#9881;</button>
        <span class="loading-indicator" *ngIf="isLoadingChunk">Loading...</span>
      </div>
      <div class="canvas-wrapper">
        <app-basewidget #canvasWidget></app-basewidget>
        <app-cross-tooltip [data]="tooltipData"></app-cross-tooltip>
      </div>
    </div>
  `,
  styles: [
    `
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
    .loading-indicator {
      font-size: 12px; color: #667eea; font-weight: 600; margin-left: 8px;
      animation: pulse 1s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .canvas-wrapper { flex: 1; min-height: 0; position: relative; overflow: hidden; }
    .canvas-wrapper app-basewidget { width: 100%; height: 100%; }
  `,
  ],
})
export class GenrateCanvasTracksTimeComponent
  implements OnInit, AfterViewInit, OnDestroy {
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
  //tooltipData: CrossTooltipData | null = null;

  /** Map of curve mnemonic to GeoToolkit LogCurve reference for crosshair lookup */
  private curveMap: Map<
    string,
    { logCurve: LogCurve; info: TrackCurve; trackName: string }
  > = new Map();

  // --- Chunked loading state ---
  /** Cached log headers for lazy loading */
  private cachedHeaders: LogHeader[] = [];
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

  /**
   * Creates an instance of GenerateCanvasTracksComponent.
   * @param logHeadersService - Service for fetching log headers and data
   */
  constructor(
    private logHeadersService: LogHeadersService,
    private dialog: MatDialog,
    private ngZone: NgZone
  ) { }

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
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    if (this.scrollPollHandle) {
      clearInterval(this.scrollPollHandle);
      this.scrollPollHandle = null;
    }
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

    this.logHeadersService.getLogHeaders(this.well, this.wellbore).subscribe({
      next: (headers) => {
        console.log('📊 Log Headers loaded:', headers);
        this.cachedHeaders = headers;
        this.processLogHeaders(headers);
        this.isLoading = false;
      },
      error: (err) => {
        console.error('❌ Error loading log headers:', err);
        this.isLoading = false;
      },
    });
  }

  /**
   * Processes loaded log headers and initiates data loading.
   * Groups curves by LogId to avoid duplicate API calls — one call per unique LogId.
   *
   * @param headers - Array of loaded log headers
   * @private
   */
  private processLogHeaders(headers: LogHeader[]): void {
    // Determine overall max depth from headers
    headers.forEach((h) => {
      const end = parseFloat(h.endIndex?.['#text'] || '0');
      if (end > this.headerMaxDepth) this.headerMaxDepth = end;
    });

    // Group all curves by LogId to avoid duplicate API calls
    const logIdGroups = new Map<
      string,
      { header: LogHeader; curves: TrackCurve[] }
    >();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        const matchingHeader = headers.find(
          (header) => header.uid === curve.LogId
        );
        if (matchingHeader) {
          if (!logIdGroups.has(curve.LogId)) {
            logIdGroups.set(curve.LogId, {
              header: matchingHeader,
              curves: [],
            });
          }
          logIdGroups.get(curve.LogId)!.curves.push(curve);
        }
      });
    });

    // One pending load per unique LogId (not per curve)
    this.pendingLoads = logIdGroups.size;
    console.log(
      `🔄 ${this.pendingLoads} unique LogId(s) to fetch (chunk size: ${this.CHUNK_SIZE})`
    );

    // Load initial chunk per LogId: most recent data
    logIdGroups.forEach(({ header, curves }, logId) => {
      const endIndex = parseFloat(header.endIndex?.['#text'] || '1000');
      const startIndex = Math.max(0, endIndex - this.CHUNK_SIZE);
      console.log(
        `📦 Loading initial chunk for LogId ${logId}: ${startIndex}-${endIndex} (${curves.length} curves)`
      );
      this.loadLogDataForGroup(header, curves, startIndex, endIndex);
    });
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
  private loadLogDataForGroup(
    header: LogHeader,
    curves: TrackCurve[],
    startIndex: number,
    endIndex: number
  ): void {
    console.log(
      `🔄 Loading data for LogId: ${header.uid}, range: ${startIndex}-${endIndex}`
    );
    this.logHeadersService
      .getLogData(this.well, this.wellbore, header.uid, startIndex, endIndex)
      .subscribe({
        next: (logDataArray) => {
          if (logDataArray.length > 0) {
            const logData = logDataArray[0];
            // Parse data for each curve in the group from the single response
            curves.forEach((curve) =>
              this.parseCurveData(logData, curve, false)
            );
          } else {
            console.warn(`⚠️ No log data found for LogId: ${header.uid}`);
          }
          this.pendingLoads--;
          if (this.pendingLoads <= 0 && this.sceneReady) {
            console.log('🎯 All data loaded - creating scene');
            this.createSceneWithData();
          }
        },
        error: (err) => {
          console.error(
            '❌ Error loading log data for LogId:',
            header.uid,
            err
          );
          this.pendingLoads--;
          if (this.pendingLoads <= 0 && this.sceneReady) {
            this.createSceneWithData();
          }
        },
      });
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
  private parseCurveData(
    logData: LogData,
    curve: TrackCurve,
    decrementPending: boolean = true
  ): void {
    const mnemonics = logData?.mnemonicList?.split(',');
    const curveIndex = mnemonics?.findIndex(
      (m) => m.trim() === curve.mnemonicId
    );
    const depthIndex = mnemonics?.findIndex((m) => m.trim() === 'DEPTH');

    if (curveIndex === -1) {
      console.warn('⚠️ Mnemonic not found:', curve.mnemonicId);
      return;
    }

    const depths: number[] = [];
    const values: number[] = [];
    console.log('logData.data', logData.data)
    logData.data.forEach((dataRow) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const value = parseFloat(cols[curveIndex]);
        const depth = depthIndex >= 0 ? parseFloat(cols[depthIndex]) : NaN;
        if (!isNaN(value) && !isNaN(depth)) {
          depths.push(depth);
          values.push(value);
        }
      }
    });

    curve.data = values;
    this.curveDepthIndices.set(curve.mnemonicId, depths);

    // Track loaded range
    if (depths.length > 0) {
      this.loadedRanges.set(curve.mnemonicId, {
        min: depths[0],
        max: depths[depths.length - 1],
      });
    }

    console.log(
      '✅ Parsed data for curve:',
      curve.mnemonicId,
      values.length,
      'points',
      depths.length > 0
        ? `depth range: ${depths[0]}-${depths[depths.length - 1]}`
        : ''
    );

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
        indextype: IndexType.Depth,
        indexunit: 'm',
        horizontalscrollable: false,
        verticalscrollable: true,
        header: {
          visible: true,
          height: 80,
        },
        viewcache: true,
        trackcontainer: {
          border: { visible: true },
        },
      });

      this.wellLogWidget.setLayoutStyle({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      });

      // Create index track first to ensure it's always visible
      const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
      indexTrack.setWidth(60);
      indexTrack.setName('Depth');

      // Assign widget to BaseWidgetComponent
      this.widgetComponent.Widget = this.wellLogWidget;
      console.log('✅ Widget assigned to BaseWidgetComponent');

      // Create data tracks
      this.createTracks();

      // Set depth limits, show recent data first, and configure crosshair + scroll listener
      setTimeout(() => {
        try {
          // Use headerMaxDepth for full range so scroll works beyond loaded data
          const fullMaxDepth =
            this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();
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
          // this.configureCrossHair();

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
        if (
          Math.abs(vMin - this.lastVisibleMin) > 1 ||
          Math.abs(vMax - this.lastVisibleMax) > 1
        ) {
          this.lastVisibleMin = vMin;
          this.lastVisibleMax = vMax;
          this.ngZone.run(() => this.checkAndLoadChunks());
        }
      } catch (_) {
        /* widget may not be ready */
      }
    }, 300);
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
    const buffer = this.CHUNK_SIZE / 2;
    const needMin = Math.max(0, vMin - buffer);
    const needMax = Math.min(this.headerMaxDepth, vMax + buffer);

    // Build chunk requests grouped by LogId+direction, using ONE reference range per LogId
    const chunkRequests = new Map<
      string,
      { header: LogHeader; curves: TrackCurve[]; start: number; end: number }
    >();

    // Group curves by LogId and find the loaded range (all curves of same LogId share the same range)
    const logIdCurves = new Map<
      string,
      {
        header: LogHeader;
        curves: TrackCurve[];
        range: { min: number; max: number };
      }
    >();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        if (logIdCurves.has(curve.LogId)) {
          logIdCurves.get(curve.LogId)!.curves.push(curve);
          return;
        }
        const matchingHeader = this.cachedHeaders.find(
          (h) => h.uid === curve.LogId
        );
        const range = this.loadedRanges.get(curve.mnemonicId);
        if (!matchingHeader || !range) return;
        logIdCurves.set(curve.LogId, {
          header: matchingHeader,
          curves: [curve],
          range,
        });
      });
    });

    logIdCurves.forEach(({ header, curves, range }, logId) => {
      // Check if we need data below loaded range (user scrolled up)
      if (needMin < range.min && range.min > 0) {
        const chunkEnd = range.min;
        const chunkStart = Math.max(0, chunkEnd - this.CHUNK_SIZE);
        const key = `${logId}_${chunkStart}_${chunkEnd}`;
        if (!this.inFlightRanges.has(key)) {
          chunkRequests.set(key, {
            header,
            curves,
            start: chunkStart,
            end: chunkEnd,
          });
        }
      }

      // Check if we need data above loaded range (user scrolled down)
      if (needMax > range.max && range.max < this.headerMaxDepth) {
        const chunkStart = range.max;
        const chunkEnd = Math.min(
          this.headerMaxDepth,
          chunkStart + this.CHUNK_SIZE
        );
        const key = `${logId}_${chunkStart}_${chunkEnd}`;
        if (!this.inFlightRanges.has(key)) {
          chunkRequests.set(key, {
            header,
            curves,
            start: chunkStart,
            end: chunkEnd,
          });
        }
      }
    });

    if (chunkRequests.size === 0) return;

    console.log(
      `📦 Scroll chunk: ${chunkRequests.size
      } request(s) for visible ${vMin.toFixed(0)}-${vMax.toFixed(0)}`
    );
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

      this.logHeadersService
        .getLogData(this.well, this.wellbore, header.uid, start, end)
        .subscribe({
          next: (logDataArray) => {
            if (logDataArray.length > 0) {
              curves.forEach((curve) =>
                this.appendChunkData(logDataArray[0], curve)
              );
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
   * @param logData - New chunk of log data
   * @param curve - Curve to append data to
   * @private
   */
  private appendChunkData(logData: LogData, curve: TrackCurve): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex(
      (m) => m.trim() === curve.mnemonicId
    );
    const depthIdx = mnemonics.findIndex((m) => m.trim() === 'DEPTH');
    if (curveIndex === -1 || depthIdx === -1) return;

    const newDepths: number[] = [];
    const newValues: number[] = [];

    logData.data.forEach((row) => {
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
    const sortedEntries = Array.from(depthValueMap.entries()).sort(
      (a, b) => a[0] - b[0]
    );
    const mergedDepths = sortedEntries.map((e) => e[0]);
    const mergedValues = sortedEntries.map((e) => e[1]);

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
        console.warn(
          '⚠️ Could not update curve data source for',
          curve.mnemonicId,
          e
        );
      }
    }

    console.log(
      `📈 Appended chunk to ${curve.mnemonicId}: now ${mergedValues.length
      } points, depth ${mergedDepths[0]}-${mergedDepths[mergedDepths.length - 1]
      }`
    );
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

    const maxDepth =
      this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();

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
    console.log(
      '📏 Scale applied:',
      scale === 0 ? 'Fit to Height' : `1:${scale}`,
      '| Visible:',
      limits
    );
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
   * Creates all tracks based on the input track configurations.
   * Iterates through track definitions and creates appropriate track types.
   *
   * @private
   */
  private createTracks(): void {
    this.listOfTracks.forEach((trackInfo, trackIndex) => {
      try {
        console.log(
          `📊 Creating track ${trackIndex + 1}: ${trackInfo.trackName}`
        );

        let track: LogTrack;

        if (trackInfo.isIndex) {
          // Skip index track creation - it's already created in createScene
          console.log(
            '⚠️ Skipping index track creation - already created in createScene'
          );
          return;
        } else {
          // Create regular track
          track = this.wellLogWidget.addTrack(TrackType.LinearTrack);
          track.setName(trackInfo.trackName);
          track.setWidth(trackInfo.trackWidth || 100);
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
          console.warn(
            `⚠️ Skipping curve ${curveInfo.mnemonicId} - no data or hidden`
          );
          return;
        }

        console.log(`📈 Creating curve: ${curveInfo.mnemonicId}`);

        // Use stored depth indices or generate fallback
        const indexData =
          this.curveDepthIndices.get(curveInfo.mnemonicId) ||
          this.generateIndexData(curveInfo.data.length);

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
        if (
          !curveInfo.autoScale &&
          curveInfo.min !== undefined &&
          curveInfo.max !== undefined
        ) {
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
        console.error(
          `❌ Error creating curve ${curveInfo.mnemonicId}:`,
          error
        );
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

