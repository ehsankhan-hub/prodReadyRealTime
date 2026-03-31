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
import { BaseWidgetComponent } from '../../../components/core/basewidget/basewidget.component'; 

import {
  RealTimeDisplayService,
  LogData,
  LogHeader,
} from '../../../service/real-time-display.service';

import {
  PrintPropertiesDialogComponent,
  PrintPropertiesData,
  PrintPropertiesResult,
} from '../../../components/core/basewidget/print-properties-dialog/print-properties-dialog.component';


import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
import { Subscription } from 'rxjs';
import {
  CrossTooltipComponent,
  CrossTooltipData,
  TooltipCurveValue,
} from '../cross-tooltip/cross-tooltip.component';
import { WellDataService } from '../../../service/well-service/well.service';
import { IWellboreLogData, IWellboreObject } from '../../../models/wellbore/wellbore-object';
import { ILogDataQueryParameter } from '../time-base-track-native-geo/time-base-track-native-geo.component';
import { ITracks } from '../../../models/chart/tracks';
import { MatIconModule } from '@angular/material/icon';
import { CssStyle } from '@int/geotoolkit/css/CssStyle';

import { Log2DVisual, PlotTypes } from "@int/geotoolkit/welllog/Log2DVisual";
import { CompositeLog2DVisualHeader } from "@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader";
import { Log2DVisualData } from "@int/geotoolkit/welllog/data/Log2DVisualData";
import { Log2DDataRow } from "@int/geotoolkit/welllog/data/Log2DDataRow";
import { DefaultColorProvider } from "@int/geotoolkit/util/DefaultColorProvider";

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
  selector: 'app-dynamic-track-generator',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatDialogModule,
    MatButtonModule,
    BaseWidgetComponent,
    CrossTooltipComponent,
    MatIconModule
  ],
 templateUrl: './dynamic-track-generator.component.html',
  styleUrl: './dynamic-track-generator.component.scss',
})
export class DynamicTrackGeneratorComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  /** Array of track configurations to display */
  @Input() listOfTracks: ITracks[] = [];
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

  private wellboreObjects: IWellboreObject[] = [];

    /** Live polling state for real-time data appending */
  /** Handle for live data polling interval */
  private livePollHandle: any = null;
  /** Live polling interval in milliseconds */
  private readonly LIVE_POLL_INTERVAL = 5000;
  /** Flag to enable/disable live data polling */
  public isLivePolling = false;
  
    /** Canvas theme flag  */
  public isDarkTheme = false;
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

  /** Map of curve mnemonic to GeoToolkit LogCurve reference for crosshair lookup */
  private curveMap: Map<
    string,
    { logCurve: LogCurve; info: TrackCurve; trackName: string }
  > = new Map();

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
  isFirstTimeLoading: boolean;

  /**
   * Creates an instance of GenerateCanvasTracksComponent.
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
    (async () => {
      this.wellboreObjects = await this.logHeadersService.getLogHeader(
        this.well,
        this.wellbore
      );

      // console.log('this.wellboreObjects  ', this.wellboreObjects);
      // console.log('📊 Log Headers loaded:', this.wellboreObjects);

      // Store wellboreObjects as cachedHeaders for chunk loading & live polling
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

    // Calculate headerMaxDepth from backend endIndex for proper depth limits
    headers?.forEach((h) => {
      // endIndex can be a string number (depth) or a date string (time)
      const endVal = h.endIndex?.['#text'] || h.endIndex;
      const end = parseFloat(String(endVal));
      if (!isNaN(end) && end > this.headerMaxDepth) {
        this.headerMaxDepth = end;
      }
    });
    console.log('📏 Header max depth calculated:', this.headerMaxDepth);

    // Group all curves by LogId to avoid duplicate API calls
    const logIdGroups = new Map<
      string,
      { header: IWellboreObject; curves: TrackCurve[] }
    >();

    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve) => {
        console.log('curve.LogId ', curve.LogId);
        const matchingHeader = headers.find((header) => {
          console.log(
            'header.objectId.includes ',
            header.objectId.includes(curve.LogId)
          );
          return header.objectId.includes(curve.LogId);
        });
        console.log('matchingHeader ', matchingHeader);
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
    console.log(`🔄 ${this.pendingLoads} unique LogId(s) to fetch (chunk size: ${this.CHUNK_SIZE})`);

    // Load initial chunk per LogId: most recent data
    logIdGroups.forEach(({ header, curves }, logId) => {
console.log('header---------',header)
       const endIndex =parseFloat(
        header.endIndex?.['#text'] || header.endIndex || '1000'
      );
      console.log('endIndex---------',endIndex)
      const startIndex = Math.max(0, endIndex - this.CHUNK_SIZE);
      console.log(`📦 Loading initial chunk for LogId ${logId}: ${startIndex}-${endIndex} (${curves.length} curves)`);
      this.loadLogDataForGroup(header, curves, startIndex.toString(), endIndex.toString());
    });
  }


/**
   * Loads log data for a group of curves that share the same LogId.
   * Makes one API call and distributes data to all curves in the group.
   *
   * Fixed - removed duplicate API calls and hardcoded params.
   * Now uses dynamic header values and single API call with proper response parsing.
   *
   * @param header - Log header containing metadata
   * @param curves - All curves sharing this LogId
   * @param startIndex - Starting index for data range
   * @param endIndex - Ending index for data range
   * @private
   */
  private loadLogDataForGroup(
    header: IWellboreObject,
    curves: TrackCurve[],
    startIndex: string,
    endIndex: string
  ): Promise<void> {
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
            this.isFirstTimeLoading = false;
            if (logDataArray != null) {
              // Parse using backend response format (logs[0].logData)
              curves.forEach((curve) =>
                this.parseCurveData(logDataArray, curve, false)
              );
            } else {
              console.warn(
                `⚠️ No log data found for LogId: ${header.objectName}`
              );
            }
            this.pendingLoads--;
            if (this.pendingLoads <= 0 && this.sceneReady) {
              console.log('🎯 All data loaded - creating scene');
              this.createSceneWithData();
            }
            resolve();
          },
          error: (err: Error) => {
            this.isFirstTimeLoading = false;
            console.error(
              '❌ Error loading log data for LogId:',
              header.objectId,
              err
            );
            this.pendingLoads--;
            if (this.pendingLoads <= 0 && this.sceneReady) {
              this.createSceneWithData();
            }
            reject(err);
          },
        });
      } else {
        // It's a direct result - handle synchronously
        try {
          console.log('logDataArray  ---', result);
          if (result != null) {
            // Parse using backend response format (logs[0].logData)
            curves.forEach((curve) =>
              this.parseCurveData(result, curve, false)
            );
          } else {
            console.warn(
              `⚠️ No log data found for LogId: ${header.objectName}`
            );
          }
          this.pendingLoads--;
          if (this.pendingLoads <= 0 && this.sceneReady) {
            console.log('🎯 All data loaded - creating scene');
            this.createSceneWithData();
          }
          resolve();
        } catch (err) {
          console.error(
            '❌ Error loading log data for LogId:',
            header.objectId,
            err
          );
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
   * @param logData - Log data containing raw data strings and metadata
   * @param curve - Track curve object to populate with parsed data
   * @param decrementPending - Whether to decrement pendingLoads counter (false when called from group loader)
   * @private
   */

  private parseCurveData(
    logData: any,
    curve: TrackCurve,
    decrementPending: boolean = true
  ): void {
    // Extract logData from backend response format
    // Backend returns: { logs: [{ logData: { data: [...], mnemonicList: "..." } }] }
    const innerLogData = logData?.logs?.[0]?.logData;
    if (!innerLogData || !innerLogData.data || !innerLogData.mnemonicList) {
      console.warn(
        `⚠️ Invalid logData structure for curve ${curve.mnemonicId}:`,
        logData
      );
      if (decrementPending) {
        this.pendingLoads--;
        if (this.pendingLoads <= 0 && this.sceneReady) {
          this.createSceneWithData();
        }
      }
      return;
    }
    const mnemonics = innerLogData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex(
      (m: any) => m.trim() === curve.mnemonicId
    );
    const depthIdx = mnemonics.findIndex((m: any) => m.trim() === 'DEPTH');

    if (curveIndex === -1 || depthIdx === -1) {
      console.warn(
        '⚠️ Mnemonic or DEPTH not found:',
        curve.mnemonicId,
        '| Available:',
        mnemonics
      );
      if (decrementPending) {
        this.pendingLoads--;
        if (this.pendingLoads <= 0 && this.sceneReady) {
          this.createSceneWithData();
        }
      }
      return;
    }

    const depths: number[] = [];
    const values: number[] = [];

    innerLogData.data.forEach((dataRow: any) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const value = parseFloat(cols[curveIndex]);
        const depth = parseFloat(cols[depthIdx]);
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
      `✅ Parsed data for curve: ${curve.mnemonicId} ${values.length} points`,
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
      indexTrack.setWidth(120);
      indexTrack.setName('Depth');

      // Assign widget to BaseWidgetComponent
      this.widgetComponent.Widget = this.wellLogWidget;
      console.log('✅ Widget assigned to BaseWidgetComponent');
       // Apply track styling following GeoToolkit demo pattern
      this.applyGeoToolkitTheme()
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
      { header: IWellboreObject; curves: TrackCurve[]; start: number; end: number }
    >();

    // Group curves by LogId and find the loaded range (all curves of same LogId share the same range)
    const logIdCurves = new Map<
      string,
      {
        header: IWellboreObject;
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
        const matchingHeader = this.cachedHeaders.find((h) =>
          h.objectId.includes(curve.LogId)
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


    // chunkRequests.forEach(({ header, curves, start, end }, key) => {
    //   // Mark range as in-flight immediately to prevent duplicates
    //   this.inFlightRanges.add(key);
    //   console.log(`  📥 Chunk: ${start}-${end} for ${header.uid}`);

    //   this.logHeadersService
    //     .getLogData(this.well, this.wellbore, header.uid, start, end)
    //     .subscribe({
    //       next: (logDataArray) => {
    //         if (logDataArray.length > 0) {
    //           curves.forEach((curve) =>
    //             this.appendChunkData(logDataArray[0], curve)
    //           );
    //         }
    //         onDone(key);
    //       },
    //       error: () => onDone(key),
    //     });
    // });
  //}

   chunkRequests.forEach(({ header, curves, start, end }, key) => {
      // Mark range as in-flight immediately to prevent duplicates
      this.inFlightRanges.add(key);
      console.log(`  📥 Chunk: ${start}-${end} for ${header.objectId}`);

      this.logHeadersService
        .getLogData({
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
        })
        .subscribe({
          next: (logDataArray: any) => {
            // Convert backend response and append chunk data
            if (
              logDataArray != null &&
              logDataArray.logs &&
              logDataArray.logs.length > 0 &&
              logDataArray.logs[0].logData?.data?.length > 0
            ) {
              const convertedLogData = this.convertResponseToLogData(
                logDataArray.logs[0]
              );
              curves.forEach((curve) =>
                this.appendChunkData(convertedLogData, curve)
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
      `📈 Appended chunk to ${curve.mnemonicId}: now ${
        mergedValues.length
      } points, depth ${mergedDepths[0]}-${
        mergedDepths[mergedDepths.length - 1]
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
                let value: number | null = null;
                try {
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
          <p style="margin:4px 0;color:#666;">Well: ${this.well} | Wellbore: ${
          this.wellbore
        }</p>
          <p style="margin:4px 0;color:#666;">Scale: 1:${
            this.selectedScale
          } | Range: ${
          result.printRange === 'all'
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
          ${
            result.headerOption === 'topAndBottom' ||
            result.headerOption === 'top'
              ? headerHtml
              : ''
          }
          <img src="${dataUrl}" style="max-width:100%;" />
          ${
            result.headerOption === 'topAndBottom' ||
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
        if(trackInfo.trackType == "Image"){
          this.createSceneImage(trackInfo);
        }
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
  private createCurves(track: LogTrack, trackInfo: ITracks): void {
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

  /**
   * Converts real backend response to flat LogData format for appendChunkData.
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
      uid: response.uid || response.logUid,
    };
  }

  // Image Track creation 

   createSceneImage(trackInfo: ITracks) {
    if (trackInfo.curves.length > 0) {
      let trackX: any = [];
      trackInfo.curves.forEach((curve) => {
        if (curve.show && curve.data.length > 0) {
          trackX.push(
            this.createImageCurve(curve).setPlotType(PlotTypes.Linear),
          );
        }

        const headerProvider = this.wellLogWidget
          .getHeaderContainer()
          .getHeaderProvider();
        headerProvider.registerHeaderProvider(
          Log2DVisual.getClassName(),
          new CompositeLog2DVisualHeader(),
        );

        this.wellLogWidget
          .addTrack(TrackType.LinearTrack)
          .setName(trackInfo.trackName)
          .addChild(trackX);
      });
    }
  }

  
  createImageCurve(curveInfo: IWellboreLogData) {
    const values = curveInfo.data;
    const depths = values.map(
      (_val, i) =>
       0 +
        (i * (100 - 0)) / (values.length - 1),
    );
    const log2dData = new Log2DVisualData();

    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;

    for (let index = 0; index < values.length; index++) {
      let value: any = [];
      if (Number.isNaN(values[index])) {
        // Let's just build dummy data.
        value = [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ];
      } else if (typeof values[index] === "string") {
        // Split the array if value is !NaN.
        value = values[index].split(" ").map(Number);
        let localMax = Math.max(...value);
        max = max < localMax ? localMax : max;
        let localMin = Math.min(...value);
        min = min > localMin ? localMin : min;
      }

      let piDistance = (2 * Math.PI) / (value.length - 1);

      let angles = [];
      let angle = 0;

      for (let j = 0; j < value.length; j++) {
        angles.push(angle);
        angle += piDistance;
      }

      log2dData.getRows().push(new Log2DDataRow(depths[index], value, angles));
    }
    log2dData.updateLimits();

    // Set options
    let colors, delta;
    delta = (max - min) / 3;
    colors = new DefaultColorProvider()
      .setNamedColor("NegativeInfinity", "blue")
      .setNamedColor("PositiveInfinity", "green")
      .addColor(min, "#7cb342") // 0 is the minimum value on this color provider
      .addColor(min + delta, "yellow")
      .addColor(min + 2 * delta, "orange")
      .addColor(max, "red");

    // Create Visual
    return new Log2DVisual()
      .setName(curveInfo.displayName + "(" + curveInfo.unit + ")")
      .setData(log2dData)
      .setColorProvider(colors)
      .setOffsets(0)
      .setMicroPosition(0, 1); // DEFAULT: Visual model limits are from 0,1
  }


  /**
   * Applies comprehensive theme styling to GeoToolkit elements.
   * Uses a single, clean CSS approach for both light and dark themes.
   *
   * @private
   */
  private applyGeoToolkitTheme(): void {
    if (!this.wellLogWidget) {
      console.warn('⚠️ WellLogWidget not available for theme application');
      return;
    }

    try {
    

      // Define theme colors
      const theme = this.isDarkTheme
        ? {
            headerBg: 'transparent',
            headerText: '#e2e8f0',
            headerBorder: '#4a5568',
            trackBg: 'white',
            trackBorder: 'gray',
            gridLines: '#2564e0ff',
            axisText: '#e2e8f0',
            curveColors: [
              '#40857fff',
              '#f687b3',
              '#68d391',
              '#fbb6ce',
              '#90cdf4',
            ],
          }
        : {
            headerBg: 'transparent',
            headerText: '#e2e8f0',
            headerBorder: '#e2e8f0',
            trackBg: '#fcf8f7ff',
            trackBorder: '#e0cfcbff',
            gridLines: '#e2e8f0',
            axisText: '#4a5568',
            curveColors: [
              '#3182ce',
              '#d53f8c',
              '#38a169',
              '#ed64a6',
              '#2b6cb0',
            ],
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

          /* Selection box */
          '.geotoolkit.controls.tools.SelectionBox {',
          `  linestyle-color: ${theme.curveColors[0]};`,
          '  linestyle-width: 2;',
          `  fillstyle: ${theme.curveColors[0]}20;`, // Semi-transparent
          '}',
        ].join('\n'),
      });

      // Apply the CSS to the widget
      this.wellLogWidget.setCss(geoToolkitCSS);
      console.log('✅ GeoToolkit theme applied successfully');
    } catch (error) {
      console.error('❌ Error applying GeoToolkit theme:', error);
    }
  }

}
