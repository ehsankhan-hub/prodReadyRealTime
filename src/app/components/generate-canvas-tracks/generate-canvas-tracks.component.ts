import {
  Component,
  Input,
  OnInit,
  AfterViewInit,
  ViewChild,
  OnDestroy,
  NgZone,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import {
  LogHeadersService,
  LogHeader,
  LogData,
} from '../../service/well-service/log-headers.service';
import { Log2DVisual, PlotTypes } from '@int/geotoolkit/welllog/Log2DVisual';
import { Log2DVisualData } from '@int/geotoolkit/welllog/data/Log2DVisualData';
import { Log2DDataRow } from '@int/geotoolkit/welllog/data/Log2DDataRow';
import { CompositeLog2DVisualHeader } from '@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader';
import { DefaultColorProvider } from '@int/geotoolkit/util/DefaultColorProvider';
import { LogCompositeVisualHeader } from '@int/geotoolkit/welllog/header/LogCompositeVisualHeader';
import { LogVisualTitleHeader } from '@int/geotoolkit/welllog/header/LogVisualTitleHeader';
import { AdaptiveLogCurveVisualHeader } from '@int/geotoolkit/welllog/header/AdaptiveLogCurveVisualHeader';
import { AnchorType } from '@int/geotoolkit/util/AnchorType';

import {
  PrintPropertiesDialogComponent,
  PrintPropertiesData,
  PrintPropertiesResult,
} from '../print-properties-dialog/print-properties-dialog.component';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { HoldTitle } from '@int/geotoolkit/welllog/header/HoldTitle';

import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { LogCurveDataSource } from '@int/geotoolkit/welllog/data/LogCurveDataSource';
import { Range } from '@int/geotoolkit/util/Range';

/**
 * Canonical Remote Data Source pattern for GeoToolkit-js.
 * This class handles lazy loading of log data when requested by the visual (WellLogWidget).
 */
class RemoteLogCurveDataSource extends LogCurveDataSource {
  private inFlightRanges: Set<string> = new Set();
  private loadedRanges: Range[] = [];
  private isMudLog: boolean = false;

  constructor(
    private service: LogHeadersService,
    private well: string,
    private wellbore: string,
    private logId: string,
    private mnemonic: string,
    options: any = {}
  ) {
    super(options);
    this.isMudLog = options.isMudLog || false;
    (this as any)._parentComponent = options.parent;
  }

  /**
   * For simulation/unit testing: manually push data into the source.
   */
  public pushSimulationData(depths: number[], values: any[]): void {
    const currentDepths = this.getDepths() || [];
    const currentValues = this.getValues() || [];
    this.setData({
      depths: [...currentDepths, ...depths],
      values: [...currentValues, ...values] as any
    });
    this.notify('GetData', this);
  }

  /**
   * Overridden from LogCurveDataSource.
   * Called by the widget/renderer when data for a specific depth range and scale is needed.
   */
  override requestData(range: Range, scale: number, callback?: () => void): void {
    const start = Math.floor(range.getLow());
    const end = Math.ceil(range.getHigh());

    // 1. Check if we already have this data
    const alreadyLoaded = this.loadedRanges.some(r => r.contains(range));
    if (alreadyLoaded) {
      if (callback) callback();
      return;
    }

    // 2. Prevent duplicate in-flight requests
    const key = `${start}_${end}`;
    if (this.inFlightRanges.has(key)) return;
    this.inFlightRanges.add(key);

    console.log(`📡 [RemoteDS] Requesting ${this.mnemonic} for range: ${start}-${end} (scale: ${scale})`);

    // 3. Fetch data from service
    this.service.getLogData(this.well, this.wellbore, this.logId, start, end).subscribe({
      next: (logDataArray: LogData[]) => {
        if (logDataArray && logDataArray.length > 0) {
          const logData = logDataArray[0];
          this.parseAndAppendData(logData);
          this.loadedRanges.push(new Range(start, end));
        }
        this.inFlightRanges.delete(key);
        if (callback) callback();
        // IMPORTANT: Notify the data source that data has changed to trigger re-render
        this.notify('GetData', this);
      },
      error: (err) => {
        console.error(`❌ [RemoteDS] Fetch failed for ${this.mnemonic}:`, err);
        this.inFlightRanges.delete(key);
        if (callback) callback();
      }
    });
  }

  /**
   * Internal method to parse LogData and append/merge to the data source.
   */
  public parseAndAppendData(logData: LogData): void {
    const mnemonics = logData.mnemonicList.split(',').map((m: string) => m.trim());
    const depthIdx = mnemonics.indexOf('DEPTH');
    const curveIdx = mnemonics.indexOf(this.mnemonic);

    if (depthIdx === -1 || curveIdx === -1) return;

    const newData = logData.data
      .map(row => {
        const cols = row.split(',');
        const d = parseFloat(cols[depthIdx]);
        const v = this.isMudLog ? (cols[curveIdx]?.trim() || 'UNKNOWN') : parseFloat(cols[curveIdx]);
        return { d, v };
      })
      .filter(entry => !isNaN(entry.d));

    if (newData.length > 0) {
      // Get current data and merge
      const current = (this.getDepths() || []).map((d, i) => ({ d, v: (this.getValues() || [])[i] }));
      const combined = [...current, ...newData].sort((a, b) => a.d - b.d);

      // Remove duplicates (keep latest)
      const unique = combined.filter((val, index, self) =>
        index === 0 || val.d !== self[index - 1].d
      );

      this.setData({
        depths: unique.map(c => c.d),
        values: unique.map(c => c.v) as any
      });

      // Update global counters for Hard Reset stability
      (this as any)._parentComponent.totalPointsProcessed += newData.length;

      // Trigger re-render
      this.notify('GetData', this);
    }
  }
}

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
import { forkJoin, Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';

import { PatternFactory } from '@int/geotoolkit/attributes/PatternFactory';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
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
    MatDialogModule,
    MatButtonModule,
    BaseWidgetComponent,
    CrossTooltipComponent,
    MatIconModule,
  ],
  providers: [LogHeadersService],
  template: `
    <div class="well-log-container">
      <div class="toolbar">
        <div class="toolbar-group left">
          <label for="scaleSelect">Scale:</label>
          <select id="scaleSelect" [(ngModel)]="selectedScale" (ngModelChange)="onScaleChange($event)">
            <option *ngFor="let scale of scaleOptions" [value]="scale.value">{{ scale.label }}</option>
          </select>
          
          <div class="btn-divider"></div>
          
          <div class="btn-group">
            <button class="tool-btn" (click)="zoomIn()" title="Zoom In">
              <i class="fa fa-search-plus"></i>
            </button>
            <button class="tool-btn" (click)="zoomOut()" title="Zoom Out">
              <i class="fa fa-search-minus"></i>
            </button>
            <button class="tool-btn reset-btn" (click)="resetView()" title="Reset View">Reset</button>
          </div>

          <div class="btn-divider"></div>

          <button class="tool-btn live-btn" [class.active]="isLivePolling" (click)="toggleLiveFeeding()" [title]="isLivePolling ? 'Stop Live Feeding' : 'Start Live Feeding'">
            <i class="fa" [ngClass]="isLivePolling ? 'fa-stop text-danger' : 'fa-play text-success'"></i>
            <span class="btn-text">Live Monitoring</span>
            <span *ngIf="isLivePolling" class="live-indicator blinking-label">LIVE</span>
          </button>
        </div>

        <div class="toolbar-group right">
          <button class="tool-btn sim-btn" (click)="simulateLivePoint()" title="Simulate Next Data Point (Local Only)">
            <i class="fa fa-vial"></i> Sim
          </button>
          <div class="btn-divider"></div>
          <button class="settings-btn" (click)="openPrintProperties()" title="Print Properties">
             <i class="fa fa-cog"></i>
          </button>
        </div>
      </div>
      <div class="canvas-wrapper" #trackContainer>
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
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 16px; background: #ffffff; border-bottom: 1px solid #e0e0e0;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      z-index: 100;
    }
    
    .toolbar-group { display: flex; align-items: center; gap: 12px; }
    
    .btn-divider { width: 1px; height: 20px; background: #e0e0e0; margin: 0 4px; }

    .toolbar label { font-weight: 500; color: #666; font-size: 13px; }
    .toolbar select {
      padding: 4px 10px; border: 1px solid #d1d1d1; border-radius: 4px;
      font-size: 13px; background: #fafafa; cursor: pointer; color: #333;
      outline: none; transition: border-color 0.2s;
    }
    .toolbar select:focus { border-color: #3f51b5; }

    .btn-group { display: flex; gap: 2px; background: #f0f0f0; padding: 2px; border-radius: 6px; }

    .tool-btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 6px 12px; border: 1px solid transparent; border-radius: 4px;
      background: transparent; cursor: pointer; font-size: 13px;
      color: #555; transition: all 0.2s ease; gap: 6px;
      min-width: 32px; height: 32px;
    }
    .tool-btn:hover { background: #f5f5f5; color: #000; border-color: #ddd; }
    .tool-btn i { font-size: 14px; }
    
    .reset-btn { font-weight: 500; padding: 0 10px; }

    .live-btn {
      border: 1px solid #ddd;
      background: #fff;
      padding: 0 12px;
      width: auto;
      min-width: 130px;
    }
    .live-btn.active {
      background: #fff5f5;
      border-color: #ff4757;
      color: #ff4757;
      box-shadow: 0 0 8px rgba(255, 71, 87, 0.2);
    }
    .text-danger { color: #ff4757; }
    .text-success { color: #2ed573; }

    .live-indicator {
      font-size: 9px; font-weight: 800; color: #fff;
      background: #ff4757; padding: 2px 5px; border-radius: 3px;
      margin-left: 4px; line-height: 1; text-transform: uppercase;
    }

    .sim-btn {
      background: #e1f5fe; border-color: #b3e5fc; color: #0288d1;
      font-weight: 600;
    }
    .sim-btn:hover { background: #81d4fa; border-color: #4fc3f7; }

    .settings-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%; border: none;
      background: #f5f5f5; cursor: pointer; color: #666;
      transition: all 0.2s;
    }
    .settings-btn:hover { background: #e0e0e0; color: #333; transform: rotate(30deg); }

    .loading-indicator {
      font-size: 12px; color: #3f51b5; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
    }

    .blinking-label { animation: blink 1.2s infinite; }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    .canvas-wrapper { flex: 1; min-height: 0; position: relative; overflow: hidden; background: #fff; }
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

  /** Reference to the main container for ResizeObserver */
  @ViewChild('trackContainer', { static: true })
  private trackContainer!: ElementRef;

  /** GeoToolkit WellLogWidget instance for rendering tracks and curves */
  private wellLogWidget!: WellLogWidget;

  /** Flag indicating if the component view is ready */
  private sceneReady = false;

  /** Live polling state for real-time data appending */
  /** Handle for live data polling interval */
  private livePollHandle: any = null;
  /** Live polling interval in milliseconds */
  private readonly LIVE_POLL_INTERVAL = 5000;
  /** Flag to enable/disable live data polling */
  public isLivePolling = false;

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

  // --- Chunked loading state (Cached headers only) ---
  private cachedHeaders: LogHeader[] = [];

  /** Centralized lithology patterns configuration */
  private readonly LITHOLOGY_PATTERNS = [
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

  /** Number of depth rows per chunk */
  private readonly CHUNK_SIZE = 2000;
  /** The overall max depth from headers (not from loaded data) */
  private headerMaxDepth = 0;
  /** Observer to handle container resizing for responsive tracks */
  private resizeObserver: ResizeObserver | null = null;

  /**
   * --- PERFORMANCE & MEMORY MANAGEMENT CONSTANTS ---
   * MAX_WINDOW_SIZE: Memory limit for high-resolution data (2000m).
   * POINTS_BEFORE_RESET: Counter to trigger engine Hard Reset to prevent ghost memory.
   */
  private readonly MAX_WINDOW_SIZE = 2000;
  private readonly POINTS_BEFORE_RESET = 50000; // Increased for better stability
  private totalPointsProcessed = 0;
  private isResetting = false; // Guard flag

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
    if (this.livePollHandle) {
      clearInterval(this.livePollHandle);
      this.livePollHandle = null;
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
    // Robustly use the @ViewChild reference instead of global document query
    const container = this.trackContainer?.nativeElement;
    if (!container) {
      console.warn('⚠️ Could not find trackContainer native element for ResizeObserver');
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

    this.logHeadersService.getLogHeaders(this.well, this.wellbore).subscribe({
      next: (headers) => {
        console.log('📊 Log Headers loaded:', headers);
        this.cachedHeaders = headers;
        this.processLogHeaders(headers);
      },
      error: (err) => {
        console.error('❌ Error loading log headers:', err);
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

    // Collect all MudLog data loading observables
    const mudLogObservables: Observable<any>[] = [];

    this.listOfTracks.forEach((trackInfo) => {
      if (trackInfo.trackType === 'MudLog') {
        trackInfo.curves.forEach((curve) => {
          mudLogObservables.push(this.loadMudLogDataAsObservable(curve));
        });
      }
    });

    if (mudLogObservables.length > 0) {
      forkJoin(mudLogObservables).subscribe({
        next: () => {
          console.log('✅ All MudLog data loaded - creating scene');
          this.createSceneWithData();
        },
        error: (err) => {
          console.error('❌ Error loading MudLog data - creating scene anyway', err);
          this.createSceneWithData();
        }
      });
    } else {
      this.createSceneWithData();
    }
  }

  /**
   * Loads MudLog data and returns an observable for synchronization.
   */
  private loadMudLogDataAsObservable(curve: TrackCurve): Observable<any> {
    console.log(`🪨 Loading MudLog data for curve: ${curve.displayName}`);
    // Use proper absolute path for Angular assets
    return this.http.get<Array<{ depth: number, value: string }>>('assets/data/mudLogData.json').pipe(
      map((mudLogData: Array<{ depth: number, value: string }>) => {
        console.log(`✅ MudLog data loaded for ${curve.displayName}:`, mudLogData.length, 'entries');
        curve.data = mudLogData;

        // Ensure headerMaxDepth is updated if MudLog data goes deeper than headers
        if (mudLogData.length > 0) {
          const maxMudDepth = Math.max(...mudLogData.filter(d => !isNaN(d.depth)).map(d => d.depth));
          if (maxMudDepth > this.headerMaxDepth) {
            console.log(`📏 Updating headerMaxDepth from MudLog: ${this.headerMaxDepth} -> ${maxMudDepth}`);
            this.headerMaxDepth = maxMudDepth;
          }
        }
        return mudLogData;
      }),
      catchError((err: any) => {
        console.error(`❌ Error loading MudLog data for ${curve.displayName}:`, err);
        curve.data = [];
        return of([]);
      })
    );
  }

  /**
   * Creates the scene with loaded data and sets proper depth limits.
   * Called after all data has been loaded to ensure data is available.
   *
   * @private
   */
  private createSceneWithData(): void {
    if (this.wellLogWidget) {
      console.log('🛡️ Scene already exists - skipping recreation');
      return;
    }
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
        track: {
          header: {
            visibletracktitle: true, // ENSURES TRACK NAMES STAY
            holdtitle: HoldTitle.Top // KEEPS THEM AT TOP
          }
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

      // ENSURE PERMANENT HEADERS: Register prototypes for Tracks and Curves
      // This ensures all tracks and curves get these headers automatically and they persist through data loads.
      headerProvider.registerHeaderProvider(LogTrack.getClassName(), new LogVisualTitleHeader(undefined));
      headerProvider.registerHeaderProvider(LogCurve.getClassName(), new AdaptiveLogCurveVisualHeader(undefined));

      // Create data tracks
      this.createTracks();

      // Set depth limits, show recent data first, and configure crosshair + scroll listener
      // setTimeout(() => {
      try {
        // Use headerMaxDepth for full range so scroll works beyond loaded data
        const fullMaxDepth =
          this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();
        console.log('📊 Setting depth limits: 0 to', fullMaxDepth);
        this.wellLogWidget.setDepthLimits(0, fullMaxDepth);

        // Show recent data first: scroll to bottom of the entire log range
        const scrollTarget = fullMaxDepth;
        if (this.selectedScale > 0 && this.selectedScale < scrollTarget) {
          const visibleRange = this.selectedScale;
          const recentStart = scrollTarget - visibleRange;
          this.wellLogWidget.setVisibleDepthLimits(recentStart, scrollTarget);
        } else {
          // If fit-to-height or scale is larger than entire log, show 0 to end
          this.wellLogWidget.setVisibleDepthLimits(0, scrollTarget);
        }

        // Force an initial layout update to ensure horizontal factor fitting
        this.wellLogWidget.updateLayout();

        // Configure crosshair for tooltip
        // this.configureCrossHair();

        // CANONICAL SCROLL LISTENER: Trigger lazy loading based on widget events
        this.wellLogWidget.on('VisibleDepthLimitsChanged', () => {
          this.ngZone.run(() => {
            const limits = this.wellLogWidget.getVisibleDepthLimits();
            const scale = this.wellLogWidget.getDepthScale();
            console.log('📜 VisibleDepthLimitsChanged - triggering requestData on all curves');

            // Trigger requestData on all data sources
            this.curveMap.forEach((entry) => {
              const dataSource = entry.logCurve.getDataSource();
              if (dataSource && dataSource instanceof RemoteLogCurveDataSource) {
                dataSource.requestData(limits, scale);
              }
            });
          });
        });

        console.log('✅ Scene created with data successfully');
      } catch (error) {
        console.error('❌ Error setting depth limits:', error);
      }
      // }, 100);
    } catch (error) {
      console.error('❌ Error creating scene with data:', error);
    }
  }

  /**
   * Performs a 'Hard Reset' of the GeoToolkit widget.
   * This is a 'Maintenance' method used for 24/7 stability. It disposes
   * the current widget and recreates it using only the active data.
   * 
   * @param force - If true, ignores the check for POINTS_BEFORE_RESET
   */
  public performHardReset(force: boolean = false): void {
    if (this.isResetting) return;
    if (!force && this.totalPointsProcessed < this.POINTS_BEFORE_RESET) return;

    this.isResetting = true;
    console.log('🔄 Performing High-Stability Hard Reset...');

    // Capture state before disposal
    const limits = this.wellLogWidget?.getVisibleDepthLimits();
    const low = limits?.getLow();
    const high = limits?.getHigh();
    const currentScale = this.selectedScale;

    // Dispose old widget
    if (this.wellLogWidget) {
      this.wellLogWidget.dispose();
      this.wellLogWidget = null!;
    }
    this.totalPointsProcessed = 0;

    // Recreate
    this.createSceneWithData();
    console.log('✅ Base scene recreated. Processing counter reset.');

    // Restore viewport with a small delay to ensure widget is ready
    setTimeout(() => {
      if (this.wellLogWidget && low !== undefined) {
        this.wellLogWidget.setVisibleDepthLimits(low, high);
        if (currentScale > 0) this.applyScale(currentScale);
        this.wellLogWidget.updateLayout();
      }
      this.isResetting = false;
      console.log('🏁 Viewport restored after Hard Reset.');
    }, 50);
  }

  private simulateProcessData(logId: string, data: Record<string, { depths: number[], values: any[] }>): void {
    // Mocked for simulation: In a real scenario, this would update the DataSources
    console.log('🧪 Simulating processing data for:', logId);
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

  //     crossHair.on(
  //       CrossHairEvents.onPositionChanged,
  //       (_evt: any, _sender: any, eventArgs: any) => {
  //         // Run inside Angular zone so change detection picks up tooltipData updates
  //         this.ngZone.run(() => {
  //           try {
  //             const position = eventArgs.getPosition();
  //             if (!position) {
  //               this.tooltipData = {
  //                 depth: 0,
  //                 curveValues: [],
  //                 screenY: 0,
  //                 visible: false,
  //               };
  //               return;
  //             }

  //             // Transform position to model coordinates to get depth
  //             const trackContainer = this.wellLogWidget.getTrackContainer();
  //             if (!trackContainer) return;
  //             const sceneTransform = trackContainer.getSceneTransform();
  //             if (!sceneTransform) return;
  //             const pt = sceneTransform.transformPoint(position);
  //             const depth = pt.getY ? pt.getY() : pt.y;

  //             // Get device Y for tooltip vertical position
  //             const posY = position.getY ? position.getY() : position.y;

  //             // Build flat list of all curve values at this depth
  //             const curveValues: TooltipCurveValue[] = [];

  //             this.curveMap.forEach((entry) => {
  //               const { logCurve, info, trackName } = entry;
  //               let value: number | string | null = null;
  //               try {
  //                 if (logCurve instanceof LogCurve) {
  //                   const dataSource = logCurve.getDataSource();
  //                   if (dataSource) {
  //                     const rawValue = dataSource.getValueAt(
  //                       depth,
  //                       0,
  //                       dataSource.getSize(),
  //                       logCurve.getInterpolationType()
  //                     );
  //                     if (
  //                       rawValue != null &&
  //                       !isNaN(rawValue) &&
  //                       isFinite(rawValue)
  //                     ) {
  //                       value = rawValue;
  //                     }
  //                   }
  //                 } else if (logCurve instanceof StackedLogFill) {
  //                   // Manual tooltip lookup for StackedLogFill (simplified)
  //                   value = 'LITHOLOGY';
  //                 }
  //               } catch (_) {
  //                 // Data not available at this depth
  //               }

  //               curveValues.push({
  //                 mnemonic: info.mnemonicId,
  //                 displayName: info.displayName,
  //                 value: value,
  //                 unit: '',
  //                 color: info.color,
  //                 trackName: trackName,
  //               });
  //             });

  //             this.tooltipData = {
  //               depth: depth,
  //               curveValues: curveValues,
  //               screenY: posY,
  //               visible: curveValues.length > 0,
  //             };
  //           } catch (e) {
  //             // Silently handle tooltip errors to not break scrolling
  //           }
  //         });
  //       }
  //     );

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
   * Relative Zoom In: Shrinks the visible depth range around the current center.
   */
  zoomIn(): void {
    if (!this.wellLogWidget) return;
    const limits: any = this.wellLogWidget.getVisibleDepthLimits();
    if (!limits) return;

    const vMin = limits.getLow();
    const vMax = limits.getHigh();
    const center = (vMin + vMax) / 2;
    const range = vMax - vMin;
    const newRange = range * 0.8; // Zoom in by 20%

    this.wellLogWidget.setVisibleDepthLimits(center - newRange / 2, center + newRange / 2);
    this.wellLogWidget.updateLayout();
    console.log('🔍 Zoomed In:', (center - newRange / 2).toFixed(1), '-', (center + newRange / 2).toFixed(1));
  }

  /**
   * Relative Zoom Out: Expands the visible depth range around the current center.
   */
  zoomOut(): void {
    if (!this.wellLogWidget) return;
    const limits: any = this.wellLogWidget.getVisibleDepthLimits();
    if (!limits) return;

    const vMin = limits.getLow();
    const vMax = limits.getHigh();
    const center = (vMin + vMax) / 2;
    const range = vMax - vMin;
    const newRange = range * 1.25; // Zoom out

    // Constrain to positive depths and max depth if needed, though GeoToolkit handles most
    const start = Math.max(0, center - newRange / 2);
    const end = Math.min(this.headerMaxDepth || 100000, center + newRange / 2);

    this.wellLogWidget.setVisibleDepthLimits(start, end);
    this.wellLogWidget.updateLayout();
    console.log('🔍 Zoomed Out:', start.toFixed(1), '-', end.toFixed(1));
  }

  resetView(): void {
    console.log('🔄 Resetting view to default scale (1:1000)');
    this.selectedScale = 1000;
    this.applyScale(this.selectedScale);
  }

  /**
   * Toggles the live data feeding state.
   */
  toggleLiveFeeding(): void {
    this.isLivePolling = !this.isLivePolling;
    if (this.isLivePolling) {
      this.startLivePolling();
    } else {
      this.stopLivePolling();
    }
  }

  /**
   * Starts periodic polling for new data 'tail'.
   */
  private startLivePolling(): void {
    if (this.livePollHandle) return;

    console.log(`📡 Starting live polling (interval: ${this.LIVE_POLL_INTERVAL}ms)`);
    this.livePollHandle = setInterval(() => {
      this.ngZone.run(() => {
        this.pollLatestData();
      });
    }, this.LIVE_POLL_INTERVAL);
  }

  /**
   * Stops live data polling.
   */
  private stopLivePolling(): void {
    if (this.livePollHandle) {
      clearInterval(this.livePollHandle);
      this.livePollHandle = null;
      console.log('🛑 Live polling stopped');
    }
  }

  /**
   * Polls for the latest tail data for all active curves.
   */
  private pollLatestData(): void {
    // Logic for live polling remains similar but updates the new data source
    const logIdGroups = new Map<string, { header: LogHeader; curves: TrackCurve[]; lastMax: number }>();

    this.curveMap.forEach((entry, mnemonicId) => {
      let max = 0;
      let hasDataSource = false;

      if (entry.logCurve instanceof LogCurve) {
        const dataSource = entry.logCurve.getDataSource();
        if (dataSource instanceof RemoteLogCurveDataSource) {
          const depths = dataSource.getDepths();
          max = depths.length > 0 ? depths[depths.length - 1] : 0;
          hasDataSource = true;
        }
      } else if (entry.logCurve instanceof StackedLogFill) {
        // For MudLog tracks, polling is currently static/local-only in this demo
        hasDataSource = false;
      }

      if (hasDataSource) {
        if (!logIdGroups.has(entry.info.LogId)) {
          const header = this.cachedHeaders.find(h => h.uid === entry.info.LogId);
          if (header) {
            logIdGroups.set(entry.info.LogId, { header, curves: [], lastMax: max });
          }
        }
        const group = logIdGroups.get(entry.info.LogId);
        if (group) {
          group.curves.push(entry.info);
          if (max > group.lastMax) group.lastMax = max;
        }
      }
    });

    logIdGroups.forEach((group) => {
      const startIndex = group.lastMax;
      const endIndex = startIndex + this.CHUNK_SIZE;

      this.logHeadersService.getLogData(this.well, this.wellbore, group.header.uid, startIndex, endIndex)
        .subscribe({
          next: (logDataArray) => {
            if (logDataArray && logDataArray.length > 0) {
              const logData = logDataArray[0];
              group.curves.forEach(c => {
                const entry = this.curveMap.get(c.mnemonicId);
                if (entry && entry.logCurve.getDataSource instanceof Function) {
                  const ds = entry.logCurve.getDataSource();
                  if (ds instanceof RemoteLogCurveDataSource) {
                    ds.parseAndAppendData(logData);

                    // Update global max depth tracker
                    const depths = ds.getDepths();
                    const newMax = depths.length > 0 ? depths[depths.length - 1] : 0;
                    if (newMax > this.headerMaxDepth) {
                      this.headerMaxDepth = newMax;
                      if (this.wellLogWidget) {
                        this.wellLogWidget.setDepthLimits(0, this.headerMaxDepth);
                      }
                    }
                  }
                }
              });

              if (this.isLivePolling && this.wellLogWidget) {
                // Adaptive "Follow Mode"
                setTimeout(() => {
                  if (!this.wellLogWidget) return;
                  const fullMaxDepth = this.headerMaxDepth;
                  const currentLimits: any = this.wellLogWidget.getVisibleDepthLimits();
                  if (currentLimits) {
                    const currentRange = currentLimits.getHigh() - currentLimits.getLow();
                    const isUserBrowsingHistory = (fullMaxDepth - currentLimits.getHigh()) > (currentRange * 5);
                    if (!isUserBrowsingHistory) {
                      const scrollStart = Math.max(0, fullMaxDepth - currentRange);
                      this.wellLogWidget.setVisibleDepthLimits(scrollStart, fullMaxDepth);
                    }
                    this.wellLogWidget.updateLayout();
                  }
                }, 100);
              }
            }
          },
          error: err => console.warn('⚠️ Polling error:', err)
        });
    });
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

          // Native GeoToolkit automatic header management is now configured via the provider
          // No manual injection needed - this avoids conflicts with the widget synchronization
        }

        // Create curves for this track
        if (trackInfo.trackType === 'MudLog') {
          this.createMudLogCurves(track, trackInfo);
        } else if (trackInfo.trackType === 'Log2D') {
          this.createLog2DCurves(track, trackInfo);
        } else {
          this.createCurves(track, trackInfo);
        }


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

        // --- CANONICAL DATA VIRTUALIZATION ---
        // Create specialized RemoteLogCurveDataSource instead of simple GeoLogData
        const dataSource = new RemoteLogCurveDataSource(
          this.logHeadersService,
          this.well,
          this.wellbore,
          curveInfo.LogId,
          curveInfo.mnemonicId,
          { parent: this }
        );

        // Initial setup for the first chunk already loaded
        if (curveInfo.data && Array.isArray(curveInfo.data) && curveInfo.data.length > 0) {
          // Fallback to basic data for initial display if available
          dataSource.setData({
            depths: [],
            values: curveInfo.data as any
          });
        }

        // Create LogCurve with specialized data source
        const curve = new LogCurve(dataSource);
        curve.setLineStyle({
          color: curveInfo.color,
          width: curveInfo.lineWidth,
        });
        curve.setName(curveInfo.displayName);
        curve.setDescription(curveInfo.displayName);

        // Set normalization limits if not auto scale
        if (
          !curveInfo.autoScale &&
          curveInfo.min !== undefined &&
          curveInfo.max !== undefined
        ) {
          curve.setNormalizationLimits(curveInfo.min, curveInfo.max);
        }

        track.addChild(curve);

        // Header is now managed automatically by the AdaptiveLogCurveVisualHeader provider
        // configured in createSceneWithData.

        // Register curve in the map for crosshair tooltip lookup
        this.curveMap.set(curveInfo.mnemonicId, {
          logCurve: curve,
          info: curveInfo,
          trackName: trackInfo.trackName,
        });


      } catch (error) {
        console.error(
          `❌ Error creating curve ${curveInfo.mnemonicId}:`,
          error
        );
      }
    });
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

    // Native GeoToolkit automatic header management is used

    // Configure MudLog-specific properties
    mudLogTrack.setProperty('show-grid', false);
    mudLogTrack.setProperty('show-title', true);


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

        // Map lithology values to pattern names via our previous helper
        const lithMap = this.getLithologyPatternMap();

        // Create GeoLogData for each pattern
        const geoLogDatas: GeoLogData[] = this.LITHOLOGY_PATTERNS.map(p => new GeoLogData(p.pattern));

        // Populate binary values arrays (1 or 0)
        const valuesArrays = geoLogDatas.map(() => [] as number[]);
        mudLogData.lithology.forEach(lith => {
          const mappedPattern = lithMap[lith] || 'pattern';
          this.LITHOLOGY_PATTERNS.forEach((p, i) => {
            valuesArrays[i].push(p.pattern === mappedPattern ? 1 : 0);
          });
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
              'pattern': PatternFactory.getInstance().getPattern(this.LITHOLOGY_PATTERNS[i].pattern) || undefined,
              'color': this.LITHOLOGY_PATTERNS[i].color
            },
            'linestyle': this.LITHOLOGY_PATTERNS[i].color,
            'displaymode': ['line']
          });
        });

        // Add the StackedLogFill to the track
        track.addChild(stackedFill);

        // Register MudLog curve in the map for lazy loading and lookup
        this.curveMap.set(curveInfo.mnemonicId, {
          logCurve: stackedFill as any,
          info: curveInfo,
          trackName: trackInfo.trackName,
        });

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

    // Native GeoToolkit automatic header management is used

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

        // Parse image data and create Log2DDataRow objects with original depths
        response.imageData.forEach((item: LogDataItem) => {
          // Use original depth from data source
          const row = new Log2DDataRow(item.depth, item.values, item.angles);
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

  /**
   * Manual data simulator to verify Live Feeding functionality works.
   */
  simulateLivePoint(): void {
    if (!this.wellLogWidget) return;
    console.log('🧪 Simulating new live data point...');

    let maxLoadedDepth = 0;
    this.curveMap.forEach(entry => {
      const dataSource = entry.logCurve.getDataSource();
      if (dataSource instanceof RemoteLogCurveDataSource) {
        const depths = dataSource.getDepths();
        if (depths.length > 0) maxLoadedDepth = Math.max(maxLoadedDepth, depths[depths.length - 1]);
      }
    });

    const nextDepth = maxLoadedDepth + 1;
    const windowStart = Math.max(0, nextDepth - (this.MAX_WINDOW_SIZE / 2));
    const windowEnd = windowStart + this.MAX_WINDOW_SIZE;

    this.curveMap.forEach((entry) => {
      const ds = entry.logCurve.getDataSource ? entry.logCurve.getDataSource() : null;
      if (ds instanceof RemoteLogCurveDataSource) {
        const val = parseFloat((40 + Math.random() * 20).toFixed(2));
        ds.pushSimulationData([nextDepth], [val]);
      }
    });

    setTimeout(() => {
      const limits: any = this.wellLogWidget.getVisibleDepthLimits();
      if (limits) {
        const range = limits.getHigh() - limits.getLow();
        this.wellLogWidget.setVisibleDepthLimits(nextDepth - range, nextDepth);
        this.wellLogWidget.updateLayout();
      }
    }, 50);
  }

  /**
   * Calculates the maximum depth currently available across all data sources.
   */
  private getMaxDepth(): number {
    let max = 0;
    this.curveMap.forEach((entry) => {
      const dataSource = entry.logCurve.getDataSource ? entry.logCurve.getDataSource() : null;
      if (dataSource instanceof RemoteLogCurveDataSource) {
        const depths = dataSource.getDepths();
        if (depths && depths.length > 0) {
          max = Math.max(max, depths[depths.length - 1]);
        }
      }
    });

    return max || this.headerMaxDepth || 1000;
  }

}
