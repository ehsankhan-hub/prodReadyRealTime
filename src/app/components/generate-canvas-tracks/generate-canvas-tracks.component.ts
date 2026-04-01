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
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import {
  LogHeadersService,
  LogHeader,
  LogData,
} from '../../services/log-headers.service';
import { Log2DVisual, PlotTypes } from '@int/geotoolkit/welllog/Log2DVisual';
import { Log2DVisualData } from '@int/geotoolkit/welllog/data/Log2DVisualData';
import { Log2DDataRow } from '@int/geotoolkit/welllog/data/Log2DDataRow';
import { CompositeLog2DVisualHeader } from '@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader';
import { DefaultColorProvider } from '@int/geotoolkit/util/DefaultColorProvider';

import {
  PrintPropertiesDialogComponent,
  PrintPropertiesData,
  PrintPropertiesResult,
} from '../print-properties-dialog/print-properties-dialog.component';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';

import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';

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

import { InterpolationType } from '@int/geotoolkit/data/DataStepInterpolation';
import { BoxVisibility, DiscreteStackedFillVisualHeader } from '@int/geotoolkit/welllog/header/DiscreteStackedFillVisualHeader';
import { DiscreteFillDisplayType } from '@int/geotoolkit/welllog/header/AdaptiveDiscreteFillVisualHeader';
import { HttpClient } from '@angular/common/http';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';

import { PatternFactory } from '@int/geotoolkit/attributes/PatternFactory';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
import { Subscription } from 'rxjs';
import {
  CrossTooltipComponent,
  CrossTooltipData,
  TooltipCurveValue,
} from '../cross-tooltip/cross-tooltip.component';
import { StackedLogFill } from '@int/geotoolkit/welllog/StackedLogFill';

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
  /** Array of numerical data values for the curve OR MudLog lithology data */
  data: number[] | Array<{ depth: number, value: string }> | string[];
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
  /** Type of track (e.g., 'Linear', 'Log', 'Log2D', 'MudLog') */
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
  selector: 'app-generate-canvas-tracks',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatDialogModule,
    MatButtonModule,
    BaseWidgetComponent,
    CrossTooltipComponent,
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
export class GenerateCanvasTracksComponent
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
  tooltipData: CrossTooltipData | null = null;

  /** Map of curve instances keyed by mnemonicId */
  private curveMap: Map<
    string,
    { logCurve: LogCurve | StackedLogFill | any; info: TrackCurve; trackName: string }
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
  /** Observer to handle container resizing for responsive tracks */
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Creates an instance of GenerateCanvasTracksComponent.
   * @param logHeadersService - Service for fetching log headers and data
   */
  constructor(
    private logHeadersService: LogHeadersService,
    private dialog: MatDialog,
    private ngZone: NgZone,
    private http: HttpClient
  ) { }

  /**
   * Angular lifecycle hook called after component initialization.
   * Initiates the process of loading log headers and creating tracks.
   */
  ngOnInit(): void {
    console.log('🎨 Generate Canvas Tracks Component initialized');
    console.log('📊 Input tracks:', this.listOfTracks);
    this.registerLithologyPatterns();
    this.loadLogHeadersAndCreateTracks();
  }

  /**
   * Angular lifecycle hook called after the component view has been initialized.
   * Sets the scene ready flag and waits for data to load before creating scene.
   */
  ngAfterViewInit(): void {
    this.sceneReady = true;
    console.log('🔧 Scene ready - waiting for data to load');
    this.setupResizeHandler();
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
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Sets up a ResizeObserver to handle horizontal responsiveness.
   * Tells the WellLogWidget to update its layout when the container size changes.
   *
   * @private
   */
  private setupResizeHandler(): void {
    // Look for the specific container for this component
    const container = document.querySelector('.track-generator-container');
    if (!container) {
      console.warn('⚠️ Could not find .track-generator-container for ResizeObserver');
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.ngZone.run(() => {
        if (this.wellLogWidget) {
          console.log('📏 Container resized - updating track layout');
          this.wellLogWidget.updateLayout();
        }
      });
    });

    this.resizeObserver.observe(container);
  }

  /**
   * Registers lithology patterns globally in GeoToolkit's PatternFactory.
   * Loads pattern definitions and images from the lithologyPatterns.json file.
   *
   * @private
   */
  private registerLithologyPatterns(): void {
    console.log('🧱 Registering lithology patterns from assets/data/lithologyPatterns.json...');
    this.http.get<any>('assets/data/lithologyPatterns.json').subscribe({
      next: (patternsObj) => {
        if (!patternsObj) {
          console.error('❌ Lithology patterns JSON is empty or undefined');
          return;
        }
        const factory = PatternFactory.getInstance();
        let count = 0;

        Object.keys(patternsObj).forEach((name) => {
          const base64Data = patternsObj[name];
          if (!base64Data || !base64Data.startsWith('data:image')) {
            console.warn(`⚠️ Skipping pattern "${name}": invalid base64 data`);
            return;
          }

          const img = new Image();
          img.onload = () => {
            // Correct signature is addPattern(image, name)
            factory.addPattern(img, name.toLowerCase());
          };
          img.onerror = () => console.error(`❌ Failed to load image for pattern: ${name}`);
          img.src = base64Data;
          count++;
        });
        console.log(`✅ ${count} lithology patterns registration initiated`);
      },
      error: (err) => console.error('❌ Failed to load lithology patterns:', err)
    });
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

    // Handle MudLog and Log2D tracks separately
    let mudLogTrackCount = 0;
    let log2DTrackCount = 0;
    this.listOfTracks.forEach((trackInfo) => {
      if (trackInfo.trackType === 'MudLog') {
        mudLogTrackCount++;
        trackInfo.curves.forEach((curve) => {
          this.loadMudLogData(curve);
        });
      } else if (trackInfo.trackType === 'Log2D') {
        // Log2D tracks load data separately via loadLog2DData - skip from regular log data loading
        log2DTrackCount++;
        console.log(`🖼️ Skipping Log2D track curves from regular data loading: ${trackInfo.trackName}`);
      } else {
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
      }
    });

    // One pending load per unique LogId (not per curve)
    this.pendingLoads = logIdGroups.size;

    // Add delay for MudLog data to load
    if (mudLogTrackCount > 0) {
      console.log(`🪨 Waiting ${mudLogTrackCount} MudLog track(s) to load data...`);
      setTimeout(() => {
        this.createSceneWithData();
      }, 1000); // Wait 1 second for MudLog data to load
    }

    // Log Log2D tracks
    if (log2DTrackCount > 0) {
      console.log(`🖼️ ${log2DTrackCount} Log2D track(s) will load data separately via createLog2DCurves`);
    }
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
   * Loads MudLog lithology data from the sample data file.
   * 
   * @param curve - The MudLog curve to load data for
   * @private
   */
  private loadMudLogData(curve: TrackCurve): void {
    console.log(`🪨 Loading MudLog data for curve: ${curve.displayName}`);

    this.http.get<Array<{ depth: number, value: string }>>('/assets/data/mudLogData.json').subscribe({
      next: (mudLogData) => {
        console.log(`✅ MudLog data loaded for ${curve.displayName}:`, mudLogData.length, 'entries');

        // Removing depth shift logic for production usage: 
        // using raw absolute depths as determined by the downloaded JSON.
        curve.data = mudLogData;

        // Reactively update visual section if it already exists in the scene
        const entry = this.curveMap.get(curve.mnemonicId);
        if (entry && entry.logCurve instanceof StackedLogFill) {
          console.log(`🔄 Reactively updating MudLog visual for ${curve.displayName}`);
          // Reactive updates for StackedLogFill should be implemented here if needed in the future
          this.wellLogWidget?.updateLayout();
        }
      },
      error: (err) => {
        console.error(`❌ Error loading MudLog data for ${curve.displayName}:`, err);
        // Set empty data to prevent errors
        curve.data = [];
      }
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
    const values: any[] = []; // Use any to support both number and string

    // Better way to check if this curve belongs to a MudLog track
    const isMudLog = this.listOfTracks.some(
      (t) =>
        t.trackType === 'MudLog' &&
        t.curves.some((c) => c.mnemonicId === curve.mnemonicId)
    );

    console.log('logData.data', logData.data);
    logData.data.forEach((dataRow) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const depth = depthIndex >= 0 ? parseFloat(cols[depthIndex]) : NaN;
        if (isNaN(depth)) return;

        if (isMudLog) {
          // Handle lithology string for MudLog
          const value = cols[curveIndex]?.trim() || 'UNKNOWN';
          depths.push(depth);
          values.push(value);
        } else {
          // Handle numeric value for regular curve
          const value = parseFloat(cols[curveIndex]);
          if (!isNaN(value)) {
            depths.push(depth);
            values.push(value);
          }
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

      const headerProvider = this.wellLogWidget.getHeaderContainer().getHeaderProvider();
      headerProvider.registerHeaderProvider(
        StackedLogFill.getClassName(),
        new DiscreteStackedFillVisualHeader()
          .setDiscreteDisplayType(DiscreteFillDisplayType.FlexBox)
          .setBoxVisibility(BoxVisibility.Visible)
      );

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
      // Skip MudLog and Log2D tracks - they handle data loading separately
      if (trackInfo.trackType === 'MudLog' || trackInfo.trackType === 'Log2D') {
        return;
      }
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
    const newValues: any[] = []; // Use any to support both number and string

    const entry = this.curveMap.get(curve.mnemonicId);
    // Use the more reliable way to check for MudLog
    const isMudLog =
      entry?.logCurve instanceof StackedLogFill ||
      this.listOfTracks.some(
        (t) =>
          t.trackType === 'MudLog' &&
          t.curves.some((c) => c.mnemonicId === curve.mnemonicId)
      );

    logData.data.forEach((row) => {
      const cols = row.split(',');
      const depth = parseFloat(cols[depthIdx]);
      if (isNaN(depth)) return;

      if (isMudLog) {
        // Handle lithology string for MudLog
        const value = cols[curveIndex]?.trim() || 'UNKNOWN';
        newDepths.push(depth);
        newValues.push(value);
      } else {
        // Handle numeric value for regular curve
        const value = parseFloat(cols[curveIndex]);
        if (!isNaN(value)) {
          newDepths.push(depth);
          newValues.push(value);
        }
      }
    });

    if (newDepths.length === 0) return;

    // Merge with existing data
    const existingDepths = this.curveDepthIndices.get(curve.mnemonicId) || [];
    const existingValues = curve.data || [];

    // Create a map for deduplication to resolve the TS error with union types
    const depthValueMap = new Map<number, any>();
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
    if (entry) {
      try {
        if (entry.logCurve instanceof LogCurve) {
          const geoLogData = new GeoLogData(curve.displayName);
          geoLogData.setValues(mergedDepths, mergedValues);
          entry.logCurve.setData(geoLogData);
        } else if (entry.logCurve instanceof StackedLogFill) {
          // Rebuild the individual log data arrays for StackedLogFill
          const patternsList = [
            { pattern: 'chert', color: 'crimson' },
            { pattern: 'lime', color: 'lightgreen' },
            { pattern: 'lime', color: '#0099FF' },
            { pattern: 'salt', color: '#afeeee' },
            { pattern: 'sand', color: '#cf33e1' },
            { pattern: 'shale', color: 'yellow' },
            { pattern: 'volc', color: 'gray' },
            { pattern: 'dolomite', color: '#DDA0DD' },
            { pattern: 'siltstone', color: '#DEB887' },
            { pattern: 'pattern', color: '#E0E0E0' }
          ];
          const lithMap = this.getLithologyPatternMap();
          const valuesArrays = patternsList.map(() => [] as number[]);

          mergedValues.forEach((lith: string) => {
            const mappedPattern = lithMap[lith] || 'pattern';
            for (let i = 0; i < patternsList.length; i++) {
              if (patternsList[i].pattern === mappedPattern) {
                valuesArrays[i].push(1);
              } else {
                valuesArrays[i].push(0);
              }
            }
          });

          const geoLogDatas: GeoLogData[] = [];
          patternsList.forEach((p, i) => {
            const gld = new GeoLogData(p.pattern);
            gld.setValues(mergedDepths, valuesArrays[i]);
            geoLogDatas.push(gld);
          });

          const newStackedFill = new StackedLogFill(geoLogDatas)
            .setName(curve.displayName)
            .setInterpolationType(InterpolationType.EndStep);

          geoLogDatas.forEach((src, i) => {
            newStackedFill.setCurveOptions(i, {
              'fillstyle': {
                'pattern': PatternFactory.getInstance().getPattern(patternsList[i].pattern) || undefined,
                'color': patternsList[i].color
              },
              'linestyle': patternsList[i].color,
              'displaymode': ['line']
            });
          });

          const track = entry.logCurve.getParent();
          if (track) {
            (track as any).removeChild(entry.logCurve);
            (track as any).addChild(newStackedFill);
            entry.logCurve = newStackedFill as any;
          }
        }
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

      crossHair.on(
        CrossHairEvents.onPositionChanged,
        (evt: any, sender: any, eventArgs: any) => {
          // Run inside Angular zone so change detection picks up tooltipData updates
          this.ngZone.run(() => {
            try {
              const position = eventArgs.getPosition();
              if (!position) {
                this.tooltipData = {
                  depth: 0,
                  curveValues: [],
                  screenY: 0,
                  visible: false,
                };
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
                let value: number | string | null = null;
                try {
                  if (logCurve instanceof LogCurve) {
                    const dataSource = logCurve.getDataSource();
                    if (dataSource) {
                      const rawValue = dataSource.getValueAt(
                        depth,
                        0,
                        dataSource.getSize(),
                        logCurve.getInterpolationType()
                      );
                      if (
                        rawValue != null &&
                        !isNaN(rawValue) &&
                        isFinite(rawValue)
                      ) {
                        value = rawValue;
                      }
                    }
                  } else if (logCurve instanceof StackedLogFill) {
                    // Raw string array from info.data
                    if (Array.isArray(info.data)) {
                      const depthsObj = this.curveDepthIndices.get(info.mnemonicId) || [];
                      const idx = depthsObj.findIndex((d: number) => Math.abs(d - depth) < 0.5);
                      if (idx !== -1 && info.data[idx]) {
                        value = (info.data[idx] as any).value || info.data[idx] as string;
                      } else {
                        // Alternatively, look at original parsed data or curveMap entry data
                        // Actually, curve.data was updated in appendChunkData!
                        const curveData: any = info.data;
                        if (curveData[idx]) {
                          value = curveData[idx];
                        }
                      }
                    }
                  }
                } catch (_) {
                  // Data not available at this depth
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
        }
      );

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
   * Opens the Print Properties dialog.
   * Passes current widget state and handles the result.
   */
  openPrintProperties(): void {
    const maxDepth =
      this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();
    const visibleLimits: any = this.wellLogWidget?.getVisibleDepthLimits();
    const vMin = visibleLimits
      ? visibleLimits.getLow
        ? visibleLimits.getLow()
        : 0
      : 0;
    const vMax = visibleLimits
      ? visibleLimits.getHigh
        ? visibleLimits.getHigh()
        : maxDepth
      : maxDepth;

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

    dialogRef
      .afterClosed()
      .subscribe((result: PrintPropertiesResult | null) => {
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
        } else if (
          result.printRange === 'range' &&
          typeof result.rangeFrom === 'number' &&
          typeof result.rangeTo === 'number'
        ) {
          this.wellLogWidget.setVisibleDepthLimits(
            result.rangeFrom,
            result.rangeTo
          );
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
      const canvas = this.widgetComponent.Canvas
        ?.nativeElement as HTMLCanvasElement;
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
          <p style="margin:4px 0;color:#666;">Well: ${this.well} | Wellbore: ${this.wellbore
          }</p>
          <p style="margin:4px 0;color:#666;">Scale: 1:${this.selectedScale
          } | Range: ${result.printRange === 'all'
            ? 'All'
            : result.printRange === 'visible'
              ? 'Visible Range'
              : `${result.rangeFrom} - ${result.rangeTo}`
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
          ${result.headerOption === 'topAndBottom' ||
          result.headerOption === 'top'
          ? headerHtml
          : ''
        }
          <img src="${dataUrl}" style="max-width:100%;" />
          ${result.headerOption === 'topAndBottom' ||
          result.headerOption === 'bottom'
          ? headerHtml
          : ''
        }
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
        } else if (trackInfo.trackType === 'MudLog') {
          // Create MudLog track using dedicated method
          track = this.createMudLogTrack(trackInfo);
        } else if (trackInfo.trackType === 'Log2D') {
          // Create Log2D track using dedicated method
          track = this.createLog2DTrack(trackInfo);
        } else {
          // Create regular track - use setFactor for responsiveness
          track = this.wellLogWidget.addTrack(TrackType.LinearTrack);
          track.setName(trackInfo.trackName);
          // Converting pixel width to factor (weight) for proportional scaling
          (track as any).setLayoutStyle({ factor: trackInfo.trackWidth || 130 });
        }

        // Create curves for this track
        if (trackInfo.trackType === 'MudLog') {
          this.createMudLogCurves(track, trackInfo);
        } else if (trackInfo.trackType === 'Log2D') {
          this.createLog2DCurves(track, trackInfo);
        } else {
          this.createCurves(track, trackInfo);
        }

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
        if (!curveInfo.show) {
          console.warn(
            `⚠️ Skipping curve ${curveInfo.mnemonicId} - curve hidden`
          );
          return;
        }

        if (!curveInfo.data || curveInfo.data.length === 0) {
          console.log(`ℹ️ Creating empty curve header for ${curveInfo.mnemonicId} (no data)`);
        }

        console.log(`📈 Creating curve: ${curveInfo.mnemonicId}`);

        // Use stored depth indices or generate fallback
        const indexData =
          this.curveDepthIndices.get(curveInfo.mnemonicId) ||
          this.generateIndexData(curveInfo.data.length);

        // Create GeoLogData
        const geoLogData = new GeoLogData(curveInfo.displayName);

        // Handle different data types for setValues
        let valuesData: number[];
        if (Array.isArray(curveInfo.data) && curveInfo.data.length > 0 && typeof curveInfo.data[0] === 'object' && 'depth' in curveInfo.data[0]) {
          // Extract numeric values from object array (for MudLog-style data)
          valuesData = (curveInfo.data as Array<{ depth: number, value: string }>).map(item => parseFloat(item.value.toString()) || 0);
        } else if (Array.isArray(curveInfo.data) && curveInfo.data.every(item => typeof item === 'number')) {
          // Already numeric array
          valuesData = curveInfo.data as number[];
        } else {
          // Convert string array to numbers or use empty array
          valuesData = (curveInfo.data as string[]).map(item => parseFloat(item.toString()) || 0);
        }

        geoLogData.setValues(indexData, valuesData);

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

  /**
   * Creates a MudLog track with lithology display capabilities.
   * Follows GeoToolkit MudLog track patterns for clean separation.
   *
   * @param trackInfo - Track configuration for MudLog
   * @returns Created MudLog track
   * @private
   */
  private createMudLogTrack(trackInfo: TrackInfo): LogTrack {
    console.log(`🪨 Creating MudLog track: ${trackInfo.trackName}`);

    // Create MudLog track using TrackType.LinearTrack
    const mudLogTrack = this.wellLogWidget.addTrack(TrackType.LinearTrack);
    mudLogTrack.setName(trackInfo.trackName);
    // Use proportional factor (via layout style) for responsiveness
    (mudLogTrack as any).setLayoutStyle({ factor: trackInfo.trackWidth || 150 });

    // Configure MudLog-specific properties
    mudLogTrack.setProperty('show-grid', false);
    mudLogTrack.setProperty('show-title', true);

    console.log(`✅ MudLog track ${trackInfo.trackName} created successfully`);
    return mudLogTrack;
  }

  /**
   * Creates MudLog curves with lithology data and color mapping.
   * Parses MudLog-specific data and creates lithology curves.
   *
   * @param track - The MudLog track to add curves to
   * @param trackInfo - Track configuration containing MudLog curve definitions
   * @private
   */
  private createMudLogCurves(track: LogTrack, trackInfo: TrackInfo): void {
    console.log(`🎨 Creating MudLog curves for track: ${trackInfo.trackName}`);

    trackInfo.curves.forEach((curveInfo, curveIndex) => {
      try {
        if (!curveInfo.show) {
          console.warn(`⚠️ MudLog curve ${curveInfo.displayName} is hidden`);
          return;
        }

        if (!curveInfo.data || curveInfo.data.length === 0) {
          console.log(`ℹ️ Creating empty MudLog header for ${curveInfo.displayName} (no data)`);
        }

        console.log(`🪨 Creating MudLog curve: ${curveInfo.displayName}`);

        // Parse MudLog data using dedicated method
        const mudLogData = this.parseMudLogData(curveInfo);

        if (mudLogData.depths.length === 0) {
          console.warn(`⚠️ No valid MudLog data parsed for ${curveInfo.displayName}`);
          return;
        }

        const patternsList = [
          { pattern: 'chert', color: 'crimson' },
          { pattern: 'lime', color: 'lightgreen' },
          { pattern: 'lime', color: '#0099FF' },
          { pattern: 'salt', color: '#afeeee' },
          { pattern: 'sand', color: '#cf33e1' },
          { pattern: 'shale', color: 'yellow' },
          { pattern: 'volc', color: 'gray' },
          { pattern: 'dolomite', color: '#DDA0DD' },
          { pattern: 'siltstone', color: '#DEB887' },
          { pattern: 'pattern', color: '#E0E0E0' }
        ];

        // Map lithology values to pattern names via our previous helper
        const lithMap = this.getLithologyPatternMap();

        // Create GeoLogData for each pattern
        const geoLogDatas: GeoLogData[] = [];
        patternsList.forEach(p => {
          geoLogDatas.push(new GeoLogData(p.pattern));
        });

        // Populate binary values arrays (1 or 0)
        const valuesArrays = geoLogDatas.map(() => [] as number[]);
        mudLogData.lithology.forEach(lith => {
          const mappedPattern = lithMap[lith] || 'pattern';
          for (let i = 0; i < patternsList.length; i++) {
            if (patternsList[i].pattern === mappedPattern) {
              valuesArrays[i].push(1);
            } else {
              valuesArrays[i].push(0);
            }
          }
        });

        geoLogDatas.forEach((gld, i) => {
          gld.setValues(mudLogData.depths, valuesArrays[i]);
        });

        const stackedFill = new StackedLogFill(geoLogDatas)
          .setName(curveInfo.displayName)
          .setInterpolationType(InterpolationType.EndStep);

        geoLogDatas.forEach((src, i) => {
          stackedFill.setCurveOptions(i, {
            'fillstyle': {
              'pattern': PatternFactory.getInstance().getPattern(patternsList[i].pattern) || undefined,
              'color': patternsList[i].color
            },
            'linestyle': patternsList[i].color,
            'displaymode': ['line']
          });
        });

        // Add the StackedLogFill to the track
        track.addChild(stackedFill);

        // Register MudLog curve in the map for lazy loading and lookup
        this.curveMap.set(curveInfo.mnemonicId, {
          logCurve: stackedFill as any, // Cast to any because curveMap is typed for LogCurve | LogMudLogSection
          info: curveInfo,
          trackName: trackInfo.trackName,
        });

        // Track loaded range for MudLog too
        this.loadedRanges.set(curveInfo.mnemonicId, {
          min: mudLogData.depths[0],
          max: mudLogData.depths[mudLogData.depths.length - 1],
        });
        this.curveDepthIndices.set(curveInfo.mnemonicId, mudLogData.depths);

        console.log(`✅ MudLog curve ${curveInfo.displayName} created successfully with ${mudLogData.depths.length} points`);

      } catch (error) {
        console.error(`❌ Error creating MudLog curve ${curveInfo.displayName}:`, error);
      }
    });
  }

  /**
   * Parses MudLog data from curve information.
   * Extracts depth and lithology data following GeoToolkit patterns.
   *
   * @param curveInfo - Curve configuration containing raw MudLog data
   * @returns Parsed MudLog data with depths and lithology arrays
   * @private
   */
  private parseMudLogData(curveInfo: TrackCurve): { depths: number[], lithology: string[] } {
    const depths: number[] = [];
    const lithology: string[] = [];

    try {
      // Parse data similar to regular curves but for lithology
      if (Array.isArray(curveInfo.data)) {
        curveInfo.data.forEach((dataPoint) => {
          if (dataPoint && typeof dataPoint === 'object' && 'depth' in dataPoint && 'value' in dataPoint) {
            const depth = parseFloat((dataPoint as any).depth?.toString() || '0');
            const lith = (dataPoint as any).value?.toString() || 'UNKNOWN';

            if (!isNaN(depth) && lith) {
              depths.push(depth);
              lithology.push(lith);
            }
          } else if (typeof dataPoint === 'string') {
            // Handle string format: "depth,lithology"
            const parts = dataPoint.split(',');
            if (parts.length >= 2) {
              const depth = parseFloat(parts[0]?.trim());
              const lith = parts[1]?.trim();

              if (!isNaN(depth) && lith) {
                depths.push(depth);
                lithology.push(lith);
              }
            }
          }
        });
      }

      console.log(`📊 Parsed MudLog data: ${depths.length} points, depth range: ${depths.length > 0 ? Math.min(...depths) : 0}-${depths.length > 0 ? Math.max(...depths) : 0}`);

    } catch (error) {
      console.error('❌ Error parsing MudLog data:', error);
    }

    return { depths, lithology };
  }


  /**
   * Returns lithology pattern mapping for rock types.
   * Maps rock names to pattern names registered in PatternFactory.
   *
   * @returns Object mapping lithology types to pattern names
   * @private
   */
  private getLithologyPatternMap(): { [key: string]: string } {
    return {
      'SAND': 'sand',
      'SANDSTONE': 'sand',
      'SHALE': 'shale',
      'CLAY': 'shale',
      'LIMESTONE': 'lime',
      'DOLOMITE': 'dolomite',
      'SILT': 'siltstone',
      'SILTSTONE': 'siltstone',
      'MUD': 'shale',
      'MUDSTONE': 'shale',
      'COAL': 'pattern',
      'ANHYDRITE': 'pattern',
      'SALT': 'salt',
      'GYPSUM': 'pattern',
      'UNKNOWN': 'pattern',
      'DEFAULT': 'pattern'
    };
  }

  /**
   * Creates Log2D track for depth-based image visualization.
   * Sets up track with Log2D-specific configuration.
   *
   * @param trackInfo - Track configuration for Log2D display
   * @returns Created Log2D track
   * @private
   */
  private createLog2DTrack(trackInfo: TrackInfo): LogTrack {
    console.log(`🖼️ Creating Log2D track: ${trackInfo.trackName}`);

    // Create Log2D track using TrackType.LinearTrack
    const log2DTrack = this.wellLogWidget.addTrack(TrackType.LinearTrack);
    log2DTrack.setName(trackInfo.trackName);
    // Use proportional factor (via layout style) for responsiveness
    (log2DTrack as any).setLayoutStyle({ factor: trackInfo.trackWidth || 150 });

    // Configure Log2D-specific properties
    log2DTrack.setProperty('show-grid', false);
    log2DTrack.setProperty('show-title', true);

    // Register Log2D header provider
    const headerProvider = this.wellLogWidget.getHeaderContainer().getHeaderProvider();
    headerProvider.registerHeaderProvider(Log2DVisual.getClassName(), new CompositeLog2DVisualHeader());

    console.log(`✅ Log2D track ${trackInfo.trackName} created successfully`);
    return log2DTrack;
  }

  /**
   * Creates Log2D curves with image data visualization.
   * Loads image data from backend and creates Log2D visual elements.
   *
   * @param track - The Log2D track to add curves to
   * @param trackInfo - Track configuration containing Log2D curve definitions
   * @private
   */
  private createLog2DCurves(track: LogTrack, trackInfo: TrackInfo): void {
    console.log(`🎨 Creating Log2D curves for track: ${trackInfo.trackName}`);

    trackInfo.curves.forEach((curveInfo, curveIndex) => {
      try {
        if (!curveInfo.show) {
          console.warn(`⚠️ Log2D curve ${curveInfo.displayName} is hidden`);
          return;
        }

        console.log(`🖼️ Creating Log2D curve: ${curveInfo.displayName}`);

        // Load Log2D data from backend
        this.loadLog2DData(curveInfo).then(log2DData => {
          if (!log2DData || log2DData.getRows().length === 0) {
            console.warn(`⚠️ No valid Log2D data loaded for ${curveInfo.displayName}`);
            return;
          }

          // Create Log2D visual
          const log2DVisual = this.create2DVisual(log2DData, curveInfo.displayName, 0, curveInfo.color || '#7cb342');
          log2DVisual.setPlotType(PlotTypes.Linear);

          // Add to track
          track.addChild([log2DVisual]);

          console.log(`✅ Log2D curve ${curveInfo.displayName} created successfully with ${log2DData.getRows().length} rows`);
        }).catch(error => {
          console.error(`❌ Error loading Log2D data for ${curveInfo.displayName}:`, error);
        });

      } catch (error) {
        console.error(`❌ Error creating Log2D curve ${curveInfo.displayName}:`, error);
      }
    });
  }

  /**
   * Loads Log2D image data from backend service.
   * Fetches image data and converts to Log2DVisualData format.
   *
   * @param curveInfo - Curve configuration containing LogId for data fetching
   * @returns Promise resolving to Log2DVisualData
   * @private
   */
  private loadLog2DData(curveInfo: TrackCurve): Promise<Log2DVisualData> {
    console.log(`📡 Loading Log2D data for curve: ${curveInfo.displayName}`);

    // Load image data from backend service (same endpoint as simple-log2d-demo)
    return this.http.get<ImageDataResponse>('http://localhost:3000/api/getImageData').toPromise()
      .then(response => {
        if (!response || !response.imageData) {
          throw new Error('Failed to load Log2D data: No data received from backend');
        }

        const log2dData = new Log2DVisualData();

        // Get depth range from image data (may be timestamps or depths)
        const rawMinDepth = response.imageData[0]?.depth || 0;
        const rawMaxDepth = response.imageData[response.imageData.length - 1]?.depth || rawMinDepth + 1;

        // Target depth range to match the well log (use headerMaxDepth or reasonable default)
        const targetMinDepth = 0;
        const targetMaxDepth = this.headerMaxDepth > 0 ? this.headerMaxDepth : 100000;

        // Calculate scaling factors to normalize depths to well's range
        const rawRange = rawMaxDepth - rawMinDepth;
        const targetRange = targetMaxDepth - targetMinDepth;
        const scaleFactor = rawRange > 0 ? targetRange / rawRange : 1;

        console.log(`📐 Scaling image depths: raw(${rawMinDepth}-${rawMaxDepth}) → target(${targetMinDepth}-${targetMaxDepth}), factor: ${scaleFactor}`);

        // Parse image data and create Log2DDataRow objects with scaled depths
        response.imageData.forEach((item: LogDataItem) => {
          // Scale depth proportionally to fit within well's depth range
          const scaledDepth = targetMinDepth + ((item.depth - rawMinDepth) * scaleFactor);
          const row = new Log2DDataRow(scaledDepth, item.values, item.angles);
          log2dData.getRows().push(row);
        });

        log2dData.updateLimits();
        console.log(`✅ Loaded Log2D image data: ${log2dData.getRows().length} rows from depth ${log2dData.getMinDepth()} to ${log2dData.getMaxDepth()}`);

        return log2dData;
      })
      .catch(error => {
        console.error('Error fetching Log2D data from backend:', error);
        throw error;
      });
  }

  /**
   * Creates Log2D visual element with color provider.
   * Configures colors and visual properties for Log2D display.
   *
   * @param log2dData - Log2DVisualData containing image data
   * @param name - Display name for the visual
   * @param offset - Offset position for the visual
   * @param zeroColor - Base color for the color provider
   * @returns Configured Log2DVisual
   * @private
   */
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
}
