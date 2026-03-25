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
  RealTimeDisplayService,
  LogData,
} from '../../service/real-time-display.service';

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
import { WellDataService } from '../../../service/well-service/well.service';
import {
  ILogDataQueryParameter,
  IMnemonic,
  IWellboreLogData,
  IWellboreObject,
} from '../../../models/wellbore/wellbore-object';
import { MatIconModule } from '@angular/material/icon';
import { CssStyle } from '@int/geotoolkit/css/CssStyle';
import { AddDynamicTracksDialogComponent } from '../add-dynamic-tracks-dialog/add-dynamic-tracks-dialog.component';
import { ILinePattern } from '../../../models/chart/linePattern';
import { Patterns } from '@int/geotoolkit/attributes/LineStyle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

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
type TracksResult =
  | ITracksCollection
  | ITrack[]
  | Iterator<ITrack>
  | null
  | undefined;

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
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatDialogModule,
    MatButtonModule,
    BaseWidgetComponent,
    MatIconModule,
    MatSlideToggleModule,
  ],
  templateUrl: './dynamic-track-generator.component.html',
  styleUrl: './dynamic-track-generator.component.scss',
})
export class DynamicTrackGeneratorComponent
  implements OnInit, AfterViewInit, OnDestroy
{
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
  isFirstTimeLoading = true;
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
  private curveMap: Map<
    string,
    { logCurve: LogCurve; info: TrackCurve; trackName: string }
  > = new Map();

  // --- Chunked loading state ---
  /** Cached log headers for lazy loading */
  private cachedHeaders: IWellboreObject[] = [];
  /** Number of rows per chunk - dynamic based on data type */
  private get CHUNK_SIZE(): number {
    const isTimeBased = this.detectTimeBasedData();
    // For time-based data: 4 hours in milliseconds (4 * 60 * 60 * 1000)
    // For depth-based data: 2000 units (original)
    return isTimeBased ? (4 * 60 * 60 * 1000) : 2000;
  }
  /** The overall max depth from headers (not from loaded data) */
  private headerMaxDepth = 0;
  /** Tracks which depth ranges have been loaded per curve */
  private loadedRanges: Map<string, { min: number; max: number }> = new Map();
  /** Depth indices per curve (parallel to data values) */
  private curveDepthIndices: Map<string, number[]> = new Map();
  /** Tracks in-flight chunk ranges to prevent duplicate requests */
  private inFlightRanges: Set<string> = new Set();

  private wellboreObjects: IWellboreObject[] = [];

  /** Live polling state for real-time data appending */
  /** Handle for live data polling interval */
  private livePollHandle: any = null;
  /** Live polling interval in milliseconds */
  private readonly LIVE_POLL_INTERVAL = 5000;
  /** Flag to enable/disable live data polling */
  public isLivePolling = false;

  /** Canvas theam flag  */
  public theamFlage = false;

  // related to add dynamic tracks start
  wellboreLogObjects: IWellboreObject[] = [];
  selectedLog: any;
  lstTrackTypes: string[] = [
    'Linear',
    'Logarithimic',
    'Index',
    'Mudlog',
    'Image',
    'Comments',
  ];
  lstLineStyle: ILinePattern[] = [
    { name: Patterns.Solid, style: '___________' },
    { name: Patterns.Dash, style: '---------------' },
    { name: Patterns.Dot, style: '.....................' },
  ];
  anchorTypes: string[] = ['None', 'Left', 'Right', 'Center'];
  lstHourss: number[] = [24, 12, 6, 4, 2, 1];

  /** Canvas theme flag  */
  public isDarkTheme = false;

  // --- Dynamic Width Recalculation ---
  /** Handle for window resize timeout (debouncing) */
  private resizeTimeout: any = null;
  /** Last known container width for change detection */
  private lastContainerWidth: number = 0;
  /** Minimum width threshold to trigger recalculation */
  private readonly WIDTH_CHANGE_THRESHOLD = 50; // 50px minimum change
  /** Resize debounce delay in milliseconds */
  private readonly RESIZE_DEBOUNCE_DELAY = 300;

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
    // console.log('🎨 Generate Canvas Tracks Component initialized');
    // console.log('📊 Input tracks:', this.listOfTracks);
    // Initialize window resize listener for dynamic width adjustment
    // this.initializeWindowResizeListener();
    this.loadLogHeadersAndCreateTracks();
    this.isFirstTimeLoading = true;
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
    // Clean up live polling on destroy
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

    // Detect if this is time-based data
    const isTimeBased = this.detectTimeBasedData();
    console.log(`🔍 Data type detected for header processing: ${isTimeBased ? 'TIME-based' : 'DEPTH-based'}`);

    // Calculate headerMaxDepth from backend endIndex for proper depth limits
    headers?.forEach((h) => {
      // endIndex can be a string number (depth) or a date string (time)
      const endVal = h.endIndex?.['#text'] || h.endIndex;
      
      if (isTimeBased) {
        // For time-based data, convert date to timestamp and use for headerMaxDepth
        try {
          const timestamp = new Date(endVal).getTime();
          if (!isNaN(timestamp) && timestamp > this.headerMaxDepth) {
            this.headerMaxDepth = timestamp;
          }
        } catch (e) {
          console.warn('⚠️ Invalid date format for endIndex:', endVal);
        }
      } else {
        // For depth-based data, parse as number
        const end = parseFloat(String(endVal));
        if (!isNaN(end) && end > this.headerMaxDepth) {
          this.headerMaxDepth = end;
        }
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
    console.log(
      `🔄 ${this.pendingLoads} unique LogId(s) to fetch (chunk size: ${this.CHUNK_SIZE})`
    );

    // Load only the LAST chunk (most recent depth) initially.
    // On scroll up, checkAndLoadChunks will fetch earlier data in chunks.
    const loadPromises: Promise<void>[] = [];
    logIdGroups.forEach(({ header, curves }, logId) => {
      let headerStart: number;
      let headerEnd: number;

      if (isTimeBased) {
        // For time-based data, convert dates to timestamps
        try {
          const startVal = header.startIndex?.['#text'] || header.startIndex;
          const endVal = header.endIndex?.['#text'] || header.endIndex;
          
          headerStart = new Date(startVal).getTime();
          headerEnd = new Date(endVal).getTime();
          
          if (isNaN(headerStart) || isNaN(headerEnd)) {
            console.warn('⚠️ Invalid date format in header, using fallback values');
            headerStart = 0;
            headerEnd = Date.now();
          }
        } catch (e) {
          console.error('❌ Error parsing dates in header:', e);
          headerStart = 0;
          headerEnd = Date.now();
        }
      } else {
        // For depth-based data, parse as numbers
        headerEnd = parseFloat(
          header.endIndex?.['#text'] || header.endIndex || '1000'
        );
        headerStart = parseFloat(
          header.startIndex?.['#text'] || header.startIndex || '0'
        );
      }

      // Load only the last CHUNK_SIZE from the end
      const chunkStart = Math.max(headerStart, headerEnd - this.CHUNK_SIZE);
      const chunkEnd = headerEnd;

      console.log(
        `📦 Loading initial chunk for LogId ${logId}: ${new Date(chunkStart).toISOString()}-${new Date(chunkEnd).toISOString()} (of full range ${new Date(headerStart).toISOString()}-${new Date(headerEnd).toISOString()}, ${curves.length} curves)`
      );
      
      loadPromises.push(
        this.loadLogDataForGroup(
          header,
          curves,
          isTimeBased ? new Date(chunkStart).toISOString() : chunkStart.toString(),
          isTimeBased ? new Date(chunkEnd).toISOString() : chunkEnd.toString()
        )
      );
    });

    // Wait for all data loading to complete before proceeding
    await Promise.all(loadPromises);
    console.log('✅ All LogId data loading completed');
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
   * Handles real backend response format { logs: [{ logData: { data, mnemonicList } }] }
   *
   * @param logData - Log data from backend (full response with logs array)
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

    // Check if this is time-based data by looking at the component's detection
    const isTimeBasedData = this.detectTimeBasedData();
    
    // Determine if index is depth-based or time-based
    const depthMnemonics = ['DEPTH', 'MD', 'TVD', 'BITDEPTH', 'MWD_Depth'];
    const timeMnemonics = ['RIGTIME', 'TIME', 'DATETIME', 'TIMESTAMP'];

    let indexColIdx = -1;
    let isDepthIndex = false;

    // For time-based data, prioritize time mnemonics first
    if (isTimeBasedData) {
      // First try time mnemonics
      for (const tm of timeMnemonics) {
        indexColIdx = mnemonics.findIndex((m: any) => m.trim() === tm);
        if (indexColIdx !== -1) {
          isDepthIndex = false;
          console.log(`🕐 Found time index: ${tm} at position ${indexColIdx}`);
          break;
        }
      }

      // If no time index found, try depth mnemonics as fallback
      if (indexColIdx === -1) {
        for (const dm of depthMnemonics) {
          indexColIdx = mnemonics.findIndex((m: any) => m.trim() === dm);
          if (indexColIdx !== -1) {
            isDepthIndex = true;
            console.log(`📏 Found depth index as fallback: ${dm} at position ${indexColIdx}`);
            break;
          }
        }
      }
    } else {
      // For depth-based data, prioritize depth mnemonics first (original logic)
      for (const dm of depthMnemonics) {
        indexColIdx = mnemonics.findIndex((m: any) => m.trim() === dm);
        if (indexColIdx !== -1) {
          isDepthIndex = true;
          console.log(`📏 Found depth index: ${dm} at position ${indexColIdx}`);
          break;
        }
      }

      // If no depth index found, try time mnemonics
      if (indexColIdx === -1) {
        for (const tm of timeMnemonics) {
          indexColIdx = mnemonics.findIndex((m: any) => m.trim() === tm);
          if (indexColIdx !== -1) {
            isDepthIndex = false;
            console.log(`🕐 Found time index: ${tm} at position ${indexColIdx}`);
            break;
          }
        }
      }
    }

    // Fallback: use first column
    if (indexColIdx === -1) {
      indexColIdx = 0;
      isDepthIndex = isTimeBasedData ? false : true; // Default based on data type
      console.warn(
        `⚠️ No index column found, defaulting to first column as ${isTimeBasedData ? 'time' : 'depth'}`
      );
    }

    console.log(
      `🔍 Parsing ${curve.mnemonicId}: curveIndex=${curveIndex}, indexCol=${indexColIdx}, isDepth=${isDepthIndex}, dataRows=${innerLogData.data.length}`
    );

    if (curveIndex === -1) {
      console.warn(
        '⚠️ Mnemonic not found:',
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

    const indexValues: number[] = [];
    const values: number[] = [];

    innerLogData.data.forEach((dataRow: any) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const value = parseFloat(cols[curveIndex]);
        const indexStr = indexColIdx >= 0 ? cols[indexColIdx] : null;

        let indexValue = NaN;
        if (indexStr) {
          if (isDepthIndex) {
            // Depth-based: parse as a plain number
            indexValue = parseFloat(indexStr);
          } else {
            // Time-based: convert ISO string to timestamp
            try {
              indexValue = new Date(indexStr).getTime();
            } catch (e) {
              console.warn('⚠️ Invalid time format:', indexStr);
            }
          }
        }

        if (!isNaN(value) && !isNaN(indexValue)) {
          indexValues.push(indexValue);
          values.push(value);
        }
      }
    });

    curve.data = values;
    this.curveDepthIndices.set(curve.mnemonicId, indexValues);

    // Track loaded range using actual index values (depth or time)
    if (indexValues.length > 0) {
      this.loadedRanges.set(curve.mnemonicId, {
        min: indexValues[0],
        max: indexValues[indexValues.length - 1],
      });
    }

    console.log(
      `✅ Parsed data for curve: ${curve.mnemonicId} ${values.length} points`,
      indexValues.length > 0
        ? `${isDepthIndex ? 'depth' : 'time'} range: ${indexValues[0]}-${
            indexValues[indexValues.length - 1]
          }`
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
   * Determines if the loaded data is time-based or depth-based.
   * Checks multiple sources to make the best determination:
   * 1. Track configuration (isIndex track marked as non-depth)
   * 2. Log header metadata (indexType contains 'time' or indexCurve contains 'time')
   * 3. Defaults to depth-based if no time indicators found
   *
   * @returns true if data is time-based, false if depth-based
   * @private
   */
  private detectTimeBasedData(): boolean {
    // Check track configuration for time-based index track
    const hasTimeIndexTrack = this.listOfTracks.some((track) => {
      return track.isIndex && !track.isDepth;
    });

    if (hasTimeIndexTrack) {
      console.log(
        '🕐 Time-based data detected from track configuration (isIndex && !isDepth)',
        hasTimeIndexTrack
      );
      return true;
    }

    // Check log header metadata for time indicators
    // if (this.cachedHeaders.length > 0) {
    //   const firstHeader = this.cachedHeaders[0];
    //   const indexTypeHasTime = firstHeader?.indexType
    //     ?.toLowerCase()
    //     .includes('time');
    //   const indexCurveHasTime = firstHeader?.indexCurve
    //     ?.toLowerCase()
    //     .includes('time');

    //   if (indexTypeHasTime || indexCurveHasTime) {
    //     console.log('🕐 Time-based data detected from log header metadata');
    //     console.log(
    //       `   indexType: ${firstHeader?.indexType}, indexCurve: ${firstHeader?.indexCurve}`
    //     );
    //     return true;
    //   }
    // }

    // Default: Assume depth-based if no time indicators found
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
      console.log(
        `🔍 Data type detected: ${isTimeBased ? 'TIME-based' : 'DEPTH-based'}`
      );

      // Create WellLogWidget with dynamic configuration
      this.wellLogWidget = new WellLogWidget({
        indextype: isTimeBased ? IndexType.Time : IndexType.Depth,
        indexunit: isTimeBased ? 's' : 'ft',
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
      // Index depth calculation from backend service not GeoToolkit default
      // This creates index track based on actual loaded data from all tracks
      this.createRealIndexTracksFromBackend();

      // Assign widget to BaseWidgetComponent
      this.widgetComponent.Widget = this.wellLogWidget;
      console.log('✅ Widget assigned to BaseWidgetComponent');

      // Apply track styling following GeoToolkit demo pattern
      this.applyGeoToolkitTheme();

      // Create data tracks
      this.createTracks();

      // Set depth limits, show recent data first, and configure crosshair + scroll listener
      setTimeout(() => {
        try {
          // Validate we have data before proceeding
          const loadedMax = this.getMaxDepth();
          if (loadedMax <= 0 || !isFinite(loadedMax)) {
            console.warn('⚠️ Invalid depth range detected, skipping scene setup');
            return;
          }

          // Use actual depth from loaded data if headerMaxDepth is 0 (e.g. time-based logs)
          const fullMaxDepth =
            this.headerMaxDepth > 0 ? this.headerMaxDepth : loadedMax;
          console.log('📊 Setting depth limits: 0 to', fullMaxDepth);
          
          // Only set depth limits if we have a valid range
          if (fullMaxDepth > 0 && isFinite(fullMaxDepth)) {
            this.wellLogWidget.setDepthLimits(0, fullMaxDepth);
          } else {
            console.warn('⚠️ Invalid max depth, skipping depth limits');
            return;
          }

          const isTimeBased = this.detectTimeBasedData();
          
          if (isTimeBased) {
            // For time-based data: show most recent 4 hours at bottom
            const fourHoursInMs = 4 * 60 * 60 * 1000;
            const recentStart = loadedMax - fourHoursInMs;
            console.log(`🕐 Time-based: showing recent 4 hours: ${new Date(recentStart).toISOString()} - ${new Date(loadedMax).toISOString()}`);
            this.wellLogWidget.setVisibleDepthLimits(recentStart, loadedMax);
          } else if (this.selectedScale > 0 && this.selectedScale < loadedMax) {
            // For depth-based data: use selected scale if available
            const visibleRange = this.selectedScale;
            const recentStart = loadedMax - visibleRange;
            console.log(`📏 Depth-based: showing recent ${visibleRange} units: ${recentStart} - ${loadedMax}`);
            this.wellLogWidget.setVisibleDepthLimits(recentStart, loadedMax);
          } else {
            // Fallback to scale method
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
   * Uses cachedHeaders (populated from wellboreObjects) and
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
    const chunkRequests = new Map<
      string,
      {
        header: IWellboreObject;
        curves: TrackCurve[];
        start: number;
        end: number;
      }
    >();

    // Group curves by LogId using cachedHeaders (now populated from wellboreObjects)
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
        // Match using objectId.includes() (same as processLogHeaders)
        const matchingHeader = this.cachedHeaders.find((h) =>
          h.objectId.includes(curve.LogId)
        );
        const range = this.loadedRanges.get(curve.mnemonicId);
        if (!matchingHeader) return;

        // For curves without existing range, use a default range to allow initial loading
        const effectiveRange = range || { min: 0, max: 0 };
        logIdCurves.set(curve.LogId, {
          header: matchingHeader,
          curves: [curve],
          range: effectiveRange,
        });
      });
    });

    logIdCurves.forEach(({ header, curves, range }, logId) => {
      // For unloaded curves (range.max === 0), load data around visible area
      if (range.max === 0) {
        const chunkStart = Math.max(0, needMin - this.CHUNK_SIZE / 2);
        const chunkEnd = Math.min(
          this.headerMaxDepth,
          needMin + this.CHUNK_SIZE / 2
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
      } else {
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
      }
    });

    if (chunkRequests.size === 0) return;

    console.log(
      `📦 Scroll chunk: ${
        chunkRequests.size
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
      console.log(`  📥 Chunk: ${new Date(start).toISOString()}-${new Date(end).toISOString()} for ${header.objectId}`);

      // Check if this is time-based data for proper formatting
      const isTimeBased = this.detectTimeBasedData();
      const startIndex = isTimeBased ? new Date(start).toISOString() : start.toString();
      const endIndex = isTimeBased ? new Date(end).toISOString() : end.toString();

      this.logHeadersService
        .getLogData({
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
        })
        .subscribe({
          next: (logDataArray: any) => {
            // Convert backend response and append chunk data
            if (
              logDataArray != null &&
              logDataArray.logs &&
              logDataArray.length > 0 &&
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
   * @param logData - New chunk of log data (converted to flat format by convertResponseToLogData)
   * @param curve - Curve to append data to
   * @private
   */
  private appendChunkData(logData: any, curve: TrackCurve): void {
    const mnemonics = logData.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex(
      (m: string) => m.trim() === curve.mnemonicId
    );

    // Find index column: try depth mnemonics first, then time mnemonics
    const depthMnemonics = ['DEPTH', 'MD', 'TVD', 'BITDEPTH', 'MWD_Depth'];
    const timeMnemonics = ['RIGTIME', 'TIME', 'DATETIME', 'TIMESTAMP'];
    let indexIdx = -1;
    let isDepthIdx = false;

    for (const dm of depthMnemonics) {
      indexIdx = mnemonics.findIndex((m: string) => m.trim() === dm);
      if (indexIdx !== -1) {
        isDepthIdx = true;
        break;
      }
    }
    if (indexIdx === -1) {
      for (const tm of timeMnemonics) {
        indexIdx = mnemonics.findIndex((m: string) => m.trim() === tm);
        if (indexIdx !== -1) {
          isDepthIdx = false;
          break;
        }
      }
    }
    if (indexIdx === -1) {
      indexIdx = 0;
      isDepthIdx = true;
    }

    if (curveIndex === -1) return;

    const newDepths: number[] = [];
    const newValues: number[] = [];

    logData.data.forEach((row: string) => {
      const cols = row.split(',');
      let indexValue: number;
      if (isDepthIdx) {
        indexValue = parseFloat(cols[indexIdx]);
      } else {
        try {
          indexValue = new Date(cols[indexIdx]).getTime();
        } catch (e) {
          indexValue = NaN;
        }
      }
      const value = parseFloat(cols[curveIndex]);
      if (!isNaN(indexValue) && !isNaN(value)) {
        newDepths.push(indexValue);
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

    // Check if getTracks method exists in this GeoToolkit version
    if (typeof (this.wellLogWidget as any).getTracks !== 'function') {
      console.warn(
        '⚠️ getTracks() method not available in this GeoToolkit version - skipping index track scale update'
      );
      return;
    }

    // Find the index track - handle different GeoToolkit versions
    let indexTrack = null;

    try {
      // GeoToolkit 4.1.41: getTracks() returns a number (count)
      // GeoToolkit 5.0.58: getTracks() returns an iterable collection
      const tracksResult = (this.wellLogWidget as any).getTracks();

      console.log(
        '🔍 getTracks() returned:',
        typeof tracksResult,
        tracksResult
      );

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
              const trackName =
                track.getName && typeof track.getName === 'function'
                  ? track.getName()
                  : '';
              console.log(`🔍 Track ${i} name: ${trackName}`);

              // Check for various index track names (depth-based and time-based)
              let isIndexTrack =
                trackName === 'Depth' ||
                trackName === 'Time' ||
                trackName === 'Index' ||
                trackName.toLowerCase().includes('depth') ||
                trackName.toLowerCase().includes('time') ||
                trackName.toLowerCase().includes('index');

              // Fallback: check track type properties if available
              if (!isIndexTrack) {
                const trackType =
                  track.getType && typeof track.getType === 'function'
                    ? track.getType()
                    : track.getTrackType &&
                      typeof track.getTrackType === 'function'
                    ? track.getTrackType()
                    : '';
                console.log(`🔍 Track ${i} type: ${trackType}`);

                isIndexTrack =
                  trackType === 'Index' ||
                  trackType === 'IndexTrack' ||
                  trackType.toLowerCase().includes('index');
              }

              // Additional fallback: check if it's an index track by its properties
              if (!isIndexTrack) {
                const isIndexType =
                  track.isIndex ||
                  (track.getIsIndex && typeof track.getIsIndex === 'function'
                    ? track.getIsIndex()
                    : false);
                const isDepthType =
                  track.isDepth ||
                  (track.getIsDepth && typeof track.getIsDepth === 'function'
                    ? track.getIsDepth()
                    : false);
                console.log(
                  `🔍 Track ${i} properties: isIndex=${isIndexType}, isDepth=${isDepthType}`
                );

                isIndexTrack = isIndexType === true;
              }

              if (isIndexTrack) {
                console.log(
                  `✅ Found index track at position ${i}: ${trackName}`
                );
                indexTrack = track;
                break;
              }
            } else {
              console.log(
                `⚠️ Track ${i} is undefined or invalid (type: ${typeof track})`
              );
            }
          } catch (trackError) {
            console.warn(`⚠️ Error getting track ${i}:`, trackError);
          }
        }
      } else if (tracksResult && typeof tracksResult.forEach === 'function') {
        // GeoToolkit 5.0.58+ - getTracks() returns iterable
        console.log('📋 Using GeoToolkit 5.0.58+ approach (forEach)');
        tracksResult.forEach((track: any) => {
          const trackName = track.getName?.() || '';
          if (trackName === 'Depth' || trackName === 'Time') {
            indexTrack = track;
          }
        });
      } else if (Array.isArray(tracksResult)) {
        // Simple array
        console.log('📋 Using array approach');
        for (const track of tracksResult) {
          const trackName = track.getName?.() || '';
          if (trackName === 'Depth' || trackName === 'Time') {
            indexTrack = track;
            break;
          }
        }
      } else {
        console.warn(
          '⚠️ Unknown tracks result type:',
          typeof tracksResult,
          tracksResult
        );
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
    console.log(
      '🔍 Index track methods:',
      Object.getOwnPropertyNames(indexTrack)
    );

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
    if (
      fullMinDepth !== Number.MAX_VALUE &&
      fullMaxDepth !== Number.MIN_VALUE
    ) {
      console.log(
        `📏 Updating index track full scale: ${fullMinDepth} to ${fullMaxDepth}`
      );
      try {
        // Try different methods for setting depth limits based on GeoToolkit version
        if (
          indexTrack.setDepthLimits &&
          typeof indexTrack.setDepthLimits === 'function'
        ) {
          // Standard method
          indexTrack.setDepthLimits(fullMinDepth, fullMaxDepth);
        } else if (
          (indexTrack as any).setLimits &&
          typeof (indexTrack as any).setLimits === 'function'
        ) {
          // Alternative method
          (indexTrack as any).setLimits(fullMinDepth, fullMaxDepth);
        } else if (
          (indexTrack as any).setRange &&
          typeof (indexTrack as any).setRange === 'function'
        ) {
          // Another alternative method
          (indexTrack as any).setRange(fullMinDepth, fullMaxDepth);
        } else {
          console.warn(
            '⚠️ No suitable method found to set depth limits on index track'
          );
          console.log(
            '🔍 Available methods:',
            Object.getOwnPropertyNames(indexTrack)
          );
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

      crossHair.on(
        CrossHairEvents.onPositionChanged,
        (evt: any, sender: any, eventArgs: any) => {
          // Handle crosshair position changes for tooltips
          // You can add tooltip logic here if needed
        }
      );
    } catch (error) {
      console.warn('⚠️ Could not configure CrossHair tool:', error);
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
    const logIdCurves = new Map<
      string,
      { header: IWellboreObject; curves: TrackCurve[]; maxLoaded: number }
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
          maxLoaded: range.max,
        });
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
        startIndex: start.toString(),
        endIndex: end.toString(),
        isGrowing: header.objectGrowing,
        mnemonicList: '',
      };

      this.logHeadersService.getLogData(queryParameter).subscribe({
        next: (response: any) => {
          if (
            response &&
            response.logs &&
            response.logs.length > 0 &&
            response.logs[0].logData?.data?.length > 0
          ) {
            // Convert response to flat LogData format for appendChunkData
            const logData = this.convertResponseToLogData(response.logs[0]);
            curves.forEach((curve) => this.appendChunkData(logData, curve));

            console.log(
              `✅ Live data loaded: ${response.logs[0].logData.data.length} rows for ${logId}`
            );
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

    const maxDepth =
      this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();

    if (scale === 0) {
      // Fit to height - show all data
      this.wellLogWidget.setVisibleDepthLimits(0, maxDepth);
      this.wellLogWidget.fitToHeight();
    } else {
      // Set visible range based on scale - SHOW MOST RECENT DATA WITH BUFFER
      const visibleRange = Math.min(scale, maxDepth);
      const buffer = Math.min(visibleRange * 0.5, 500); // 50% buffer or max 500 units
      const recentStart = Math.max(0, maxDepth - visibleRange - buffer);
      const recentEnd = Math.min(maxDepth, maxDepth + buffer);
      this.wellLogWidget.setVisibleDepthLimits(recentStart, recentEnd);
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
      width: '720px',
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
          track.setWidth(trackInfo.trackWidth || 257);
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

        console.log(
          `🔍 Curve ${curveInfo.mnemonicId}: using ${indexData.length} index values`
        );
        console.log(
          `📊 Index range: ${indexData[0]} to ${
            indexData[indexData.length - 1]
          }`
        );
        console.log(
          `📈 Data range: ${curveInfo.data[0]} to ${
            curveInfo.data[curveInfo.data.length - 1]
          }`
        );

        // Debug: Show sample data values for troubleshooting
        if (curveInfo.mnemonicId === 'ROP') {
          console.log(`🔍 ROP raw data sample:`, curveInfo.data.slice(0, 10));
          console.log(
            `🔍 ROP non-zero values count:`,
            curveInfo.data.filter((v) => v !== 0).length
          );
          console.log(`🔍 ROP unique values:`, [
            ...new Set(curveInfo.data.slice(0, 100)),
          ]);
        }

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

        // Debug curve styling
        console.log(`🎨 Curve ${curveInfo.mnemonicId} styling:`, {
          color: curveInfo.color,
          width: curveInfo.lineWidth,
          displayName: curveInfo.displayName,
        });

        // Set normalization limits - always use auto-scale for better visibility
        if (
          curveInfo.autoScale &&
          curveInfo.min !== undefined &&
          curveInfo.max !== undefined
        ) {
          // For curves with very small ranges, expand the range slightly for visibility
          const dataRange =
            curveInfo.data[curveInfo.data.length - 1] - curveInfo.data[0];
          if (Math.abs(dataRange) < 0.1) {
            const center = (curveInfo.min + curveInfo.max) / 2;
            const expandedRange = 1.0; // Expand small ranges to at least 1.0
            curve.setNormalizationLimits(
              center - expandedRange / 2,
              center + expandedRange / 2
            );
            console.log(
              `🔧 Expanded small range for ${curveInfo.mnemonicId}: ${
                center - expandedRange / 2
              } to ${center + expandedRange / 2}`
            );
          } else {
            curve.setNormalizationLimits(curveInfo.min, curveInfo.max);
          }
        } else {
          // For curves without explicit limits, calculate reasonable limits from data
          if (curveInfo.data && curveInfo.data.length > 0) {
            // Use reduce instead of spread for better performance with large arrays
            const dataMin = curveInfo.data.reduce(
              (min, val) => (val < min ? val : min),
              curveInfo.data[0]
            );
            const dataMax = curveInfo.data.reduce(
              (max, val) => (val > max ? val : max),
              curveInfo.data[0]
            );
            const dataRange = dataMax - dataMin;

            if (Math.abs(dataRange) < 0.1) {
              // Expand small ranges for visibility
              const center = (dataMin + dataMax) / 2;
              const expandedRange = Math.max(1.0, Math.abs(center) * 0.1);
              curve.setNormalizationLimits(
                center - expandedRange / 2,
                center + expandedRange / 2
              );
              console.log(
                `🔧 Auto-expanded range for ${curveInfo.mnemonicId}: ${
                  center - expandedRange / 2
                } to ${center + expandedRange / 2}`
              );
            } else {
              // Use actual data range with 10% padding
              const padding = dataRange * 0.1;
              curve.setNormalizationLimits(
                dataMin - padding,
                dataMax + padding
              );
              console.log(
                `🔧 Auto-scaled range for ${curveInfo.mnemonicId}: ${
                  dataMin - padding
                } to ${dataMax + padding}`
              );
            }
          }
        }

        track.addChild(curve);

        // Register curve in the map for crosshair tooltip lookup
        this.curveMap.set(curveInfo.mnemonicId, {
          logCurve: curve,
          info: curveInfo,
          trackName: trackInfo.trackName,
        });

        console.log(`✅ Curve ${curveInfo.mnemonicId} created successfully`);
        console.log(
          `📊 Curve ${curveInfo.mnemonicId}: ${curveInfo.data.length} points added to track ${trackInfo.trackName}`
        );
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

    // Check if listOfTracks exists and is an array
    if (!this.listOfTracks || !Array.isArray(this.listOfTracks)) {
      console.warn(
        '⚠️ listOfTracks is not available - skipping index track creation'
      );
      return;
    }

    for (const trackInfo of this.listOfTracks) {
      // Add null check for trackInfo
      if (trackInfo && trackInfo.isIndex) {
        isTimeBased = !trackInfo.isDepth;
        indexTrackFound = true;
        console.log(
          `📊 Index track type: ${isTimeBased ? 'Time-based' : 'Depth-based'}`
        );
        break;
      }
    }

    if (!indexTrackFound) {
      console.warn(
        '⚠️ No index track configuration found - using default depth-based'
      );
      isTimeBased = false;
    }

    // Debug: Check actual depth values from backend data
    console.log('🔍 Verifying real backend depth values...');
    for (const trackInfo of this.listOfTracks) {
      // Add null check for trackInfo
      if (
        trackInfo &&
        !trackInfo.isIndex &&
        trackInfo.curves &&
        trackInfo.curves.length > 0
      ) {
        const firstCurve = trackInfo.curves[0];
        // Add null check for firstCurve
        if (firstCurve && firstCurve.mnemonicId) {
          const depthIndices = this.curveDepthIndices.get(
            firstCurve.mnemonicId
          );
          if (depthIndices && depthIndices.length > 0) {
            console.log(
              `📏 Real backend depth values from ${firstCurve.mnemonicId}:`
            );
            console.log(
              `  First depth: ${depthIndices[0]}, Last depth: ${
                depthIndices[depthIndices.length - 1]
              }`
            );
            console.log(`  Total points: ${depthIndices.length}`);
            break;
          }
        }
      }
    }

    // Create real index track - GeoToolkit will automatically use depth/time from data tracks
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    indexTrack.setWidth(120);
    indexTrack.setName(isTimeBased ? 'Time' : 'Depth');

    // Configure time-based index track formatting
    if (isTimeBased) {
      try {
        // Set time-based formatting for the widget (not indexTrack)
        this.wellLogWidget.setIndexType('time', 'ms');
        
        console.log('🕐 Configured time-based widget');
      } catch (e) {
        console.warn('⚠️ Could not set time formatting:', e);
      }
    }

    // Configure index track to show full scale instead of just visible range
    // Get the full depth range from ALL loaded data (FIXED: check all tracks, not just first)
    let fullMinDepth = Number.MAX_VALUE;
    let fullMaxDepth = Number.MIN_VALUE;

    // ================================================
    // FIXED: Calculate depth range from ALL tracks to prevent scrolling issues
    // Previous version only checked first track which caused other tracks to become invisible
    // ================================================
    for (const trackInfo of this.listOfTracks) {
      // Add null check for trackInfo
      if (
        trackInfo &&
        !trackInfo.isIndex &&
        trackInfo.curves &&
        trackInfo.curves.length > 0
      ) {
        for (const curve of trackInfo.curves) {
          // Add null check for curve
          if (curve && curve.mnemonicId) {
            const depthIndices = this.curveDepthIndices.get(curve.mnemonicId);
            if (depthIndices && depthIndices.length > 0) {
              fullMinDepth = Math.min(fullMinDepth, depthIndices[0]);
              fullMaxDepth = Math.max(
                fullMaxDepth,
                depthIndices[depthIndices.length - 1]
              );
              console.log(
                `📏 Track ${trackInfo.trackName}, Curve ${
                  curve.mnemonicId
                }: depth range ${depthIndices[0]}-${
                  depthIndices[depthIndices.length - 1]
                }`
              );
            }
          }
        }
      }
    }

    // Set the index track to show the full scale
    if (
      fullMinDepth !== Number.MAX_VALUE &&
      fullMaxDepth !== Number.MIN_VALUE
    ) {
      console.log(
        `📏 Setting index track full scale from ALL tracks: ${fullMinDepth} to ${fullMaxDepth}`
      );
      // Configure the index track to show full scale
      indexTrack.setDepthLimits(fullMinDepth, fullMaxDepth);
    } else {
      console.warn(
        '⚠️ No depth data found for index track scale - using default behavior'
      );
    }

    console.log(
      `✅ Created real ${
        isTimeBased ? 'time-based' : 'depth-based'
      } index track from backend data`
    );
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
  /**
   * Toggles between light and dark theme.
   */
  toggleTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;
    console.log('🎨 Theme toggled to:', this.isDarkTheme ? 'dark' : 'light');

    // Apply theme to GeoToolkit headers and tracks
    this.applyGeoToolkitTheme();
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
      console.log(
        '🎨 Applying GeoToolkit theme:',
        this.isDarkTheme ? 'dark' : 'light'
      );

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

  /**
   * Initializes window resize listener for dynamic width adjustment.
   * Sets up debounced resize handling to optimize performance.
   *
   * @private
   */
  private initializeWindowResizeListener(): void {
    console.log(
      '🔄 Initializing window resize listener for dynamic width adjustment'
    );

    // Add window resize event listener
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Initialize last container width with fallback
    setTimeout(() => {
      this.lastContainerWidth = this.getContainerWidth();
      // Fallback: use window width if container measurement fails
      if (this.lastContainerWidth === 0) {
        this.lastContainerWidth = window.innerWidth;
        console.log(
          '🔧 Using window.innerWidth as fallback:',
          this.lastContainerWidth
        );
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
    console.log('🔍 Debug - onWindowResize() called');

    // Clear existing timeout to debounce rapid resize events
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    // Debounce resize handling to improve performance
    this.resizeTimeout = setTimeout(() => {
      console.log('🔍 Debug - Debounced resize handler executing');
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
    console.log('🔍 Debug - handleResize() called');

    if (!this.wellLogWidget) {
      console.log('⏳ Widget not ready for resize handling');
      return;
    }

    const currentContainerWidth = this.getContainerWidth();
    const widthDifference = Math.abs(
      currentContainerWidth - this.lastContainerWidth
    );

    console.log(
      `📏 Resize detected: ${this.lastContainerWidth}px → ${currentContainerWidth}px (diff: ${widthDifference}px)`
    );
    console.log(`🔍 Debug - Width threshold: ${this.WIDTH_CHANGE_THRESHOLD}px`);

    // Only recalculate if width change exceeds threshold
    if (widthDifference > this.WIDTH_CHANGE_THRESHOLD) {
      console.log(
        '🔄 Significant width change detected - recalculating track widths'
      );
      this.recalculateTrackWidths();
      this.lastContainerWidth = currentContainerWidth;
    } else {
      console.log('⏭️ Width change too small - skipping recalculation');
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

      console.log(
        `📊 Container: ${containerWidth}px, Non-index tracks: ${nonIndexTrackCount}`
      );

      if (nonIndexTrackCount === 0) {
        console.log('⏭️ No non-index tracks to resize');
        return;
      }

      // Calculate new responsive widths based on current container size
      const newWidths = this.calculateDynamicWidths(
        containerWidth,
        nonIndexTrackCount
      );

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
      const containerElement =
        this.widgetComponent?.['ContainerElement']?.nativeElement;

      console.log(
        '🔍 Debug - Canvas element:',
        !!canvasElement,
        'Container element:',
        !!containerElement
      );

      // Try canvas element first, then container element
      let width =
        canvasElement?.clientWidth ||
        containerElement?.clientWidth ||
        this.widgetComponent?.Canvas?.nativeElement?.clientWidth ||
        0;

      // Fallback: use window width if container measurement fails
      if (width === 0) {
        width = window.innerWidth;
        console.log('🔧 Using window.innerWidth as fallback:', width);
      }

      console.log('🔍 Debug - Measured width:', width);
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
    return this.listOfTracks.filter((track) => !track.isIndex).length;
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
  private calculateDynamicWidths(
    containerWidth: number,
    trackCount: number
  ): number[] {
    console.log(
      `📏 Calculating dynamic widths for ${trackCount} tracks in ${containerWidth}px container`
    );

    // Reserve space for index track (depth/time)
    const indexTrackWidth = 60; // Standard depth track width
    const availableWidth = containerWidth - indexTrackWidth;

    console.log(
      `📊 Available width for tracks: ${availableWidth}px (after ${indexTrackWidth}px index track)`
    );

    // Calculate base width per track
    const baseWidth = Math.floor(availableWidth / trackCount);

    // Apply minimum and maximum constraints
    const minWidth = 200; // Minimum readable width
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

    console.log(`📏 Final calculated width per track: ${finalWidth}px`);

    // Return array with same width for all tracks (can be customized for different strategies)
    return Array(trackCount).fill(finalWidth);
  }

  /**
   * Applies calculated widths to the actual GeoToolkit tracks.
   * Updates each non-index track with its new width and logs the changes.
   * Handles different GeoToolkit versions for track access.
   *
   * @param widths - Array of new widths for tracks
   * @private
   */
  private applyTrackWidths(widths: number[]): void {
    console.log('🔄 Applying new track widths to GeoToolkit tracks');

    if (!this.wellLogWidget) {
      console.warn('⚠️ WellLogWidget not available for width application');
      return;
    }

    // Check if getTracks method exists in this GeoToolkit version
    if (typeof (this.wellLogWidget as any).getTracks !== 'function') {
      console.warn(
        '⚠️ getTracks() method not available - trying alternative methods'
      );

      // Try alternative methods for different GeoToolkit versions
      if (typeof (this.wellLogWidget as any).getTrackCount === 'function') {
        const trackCount = (this.wellLogWidget as any).getTrackCount();
        console.log(
          `📋 Using getTrackCount() approach: found ${trackCount} tracks`
        );

        let trackIndex = 0;
        Array.from({ length: trackCount }).forEach((_, i) => {
          try {
            const track = (this.wellLogWidget as any).getTrack(i);
            if (track && typeof track === 'object') {
              const trackName = track.getName?.() || '';

              // Find matching track configuration to determine if it's an index track
              const trackConfig = this.listOfTracks.find(
                (config) => config.trackName === trackName
              );

              if (trackConfig?.isIndex) {
                console.log(`⏭️ Skipping index track: ${trackName}`);
                return;
              }

              if (trackIndex >= widths.length) {
                console.warn(
                  `⚠️ Width array index out of bounds for track ${trackIndex}`
                );
                return;
              }

              const oldWidth = track.getWidth?.() || 'unknown';
              const newWidth = widths[trackIndex];

              track.setWidth(newWidth);

              console.log(
                `📏 Track ${trackName}: ${oldWidth}px → ${newWidth}px`
              );
              trackIndex++;
            }
          } catch (trackError) {
            console.warn(`⚠️ Error applying width to track ${i}:`, trackError);
          }
        });
        return;
      }

      // Try direct iteration with numeric access
      console.warn(
        '⚠️ No track access methods available - width adjustment not supported in this GeoToolkit version'
      );
      return;
    }

    try {
      // GeoToolkit 4.1.41: getTracks() returns a number (count)
      // GeoToolkit 5.0.58: getTracks() returns an iterable collection
      const tracksResult = (this.wellLogWidget as any).getTracks();

      console.log(
        '🔍 getTracks() returned for width application:',
        typeof tracksResult,
        tracksResult
      );
      console.log(
        '🔍 tracksResult constructor:',
        tracksResult?.constructor?.name
      );
      console.log(
        '🔍 tracksResult methods:',
        tracksResult
          ? Object.getOwnPropertyNames(tracksResult)
          : 'null/undefined'
      );

      let trackIndex = 0;

      if (typeof tracksResult === 'number') {
        // GeoToolkit 4.1.41 - getTracks() returns count, access tracks by index
        console.log(
          '📋 Using GeoToolkit 4.1.41 approach for width application (count:',
          tracksResult,
          ')'
        );

        // Create array from count and use forEach for consistency
        Array.from({ length: tracksResult }).forEach((_, i) => {
          try {
            const track = (this.wellLogWidget as any).getTrack(i);
            if (track && typeof track === 'object') {
              const trackName = track.getName?.() || '';

              // Find matching track configuration to determine if it's an index track
              const trackConfig = this.listOfTracks.find(
                (config) => config.trackName === trackName
              );

              if (trackConfig?.isIndex) {
                console.log(`⏭️ Skipping index track: ${trackName}`);
                return;
              }

              if (trackIndex >= widths.length) {
                console.warn(
                  `⚠️ Width array index out of bounds for track ${trackIndex}`
                );
                return;
              }

              const oldWidth = track.getWidth?.() || 'unknown';
              const newWidth = widths[trackIndex];

              track.setWidth(newWidth);

              console.log(
                `📏 Track ${trackName}: ${oldWidth}px → ${newWidth}px`
              );
              trackIndex++;
            } else {
              console.warn(
                `⚠️ Track ${i} is undefined or invalid (type: ${typeof track})`
              );
            }
          } catch (trackError) {
            console.warn(`⚠️ Error applying width to track ${i}:`, trackError);
          }
        });
      } else if (tracksResult && typeof tracksResult.forEach === 'function') {
        // GeoToolkit 5.0.58+ - getTracks() returns iterable
        console.log(
          '📋 Using GeoToolkit 5.0.58+ approach for width application (forEach)'
        );

        tracksResult.forEach((track: any, index: number) => {
          const trackName = track.getName?.() || '';

          // Find matching track configuration to determine if it's an index track
          const trackConfig = this.listOfTracks.find(
            (config) => config.trackName === trackName
          );

          if (trackConfig?.isIndex) {
            console.log(`⏭️ Skipping index track: ${trackName}`);
            return;
          }

          if (trackIndex >= widths.length) {
            console.warn(
              `⚠️ Width array index out of bounds for track ${trackIndex}`
            );
            return;
          }

          try {
            const oldWidth = track.getWidth?.() || 'unknown';
            const newWidth = widths[trackIndex];

            track.setWidth(newWidth);

            console.log(`📏 Track ${trackName}: ${oldWidth}px → ${newWidth}px`);
            trackIndex++;
          } catch (error) {
            console.warn(
              `⚠️ Error applying width to track ${trackName}:`,
              error
            );
          }
        });
      } else if (Array.isArray(tracksResult)) {
        // Simple array
        console.log('📋 Using array approach for width application');

        tracksResult.forEach((track: any, i: number) => {
          const trackName = track.getName?.() || '';

          // Find matching track configuration to determine if it's an index track
          const trackConfig = this.listOfTracks.find(
            (config) => config.trackName === trackName
          );

          if (trackConfig?.isIndex) {
            console.log(`⏭️ Skipping index track: ${trackName}`);
            return;
          }

          if (trackIndex >= widths.length) {
            console.warn(
              `⚠️ Width array index out of bounds for track ${trackIndex}`
            );
            return;
          }

          try {
            const oldWidth = track.getWidth?.() || 'unknown';
            const newWidth = widths[trackIndex];

            track.setWidth(newWidth);

            console.log(`📏 Track ${trackName}: ${oldWidth}px → ${newWidth}px`);
            trackIndex++;
          } catch (error) {
            console.warn(
              `⚠️ Error applying width to track ${trackName}:`,
              error
            );
          }
        });
      } else {
        console.warn(
          '⚠️ Unknown tracks result type for width application:',
          typeof tracksResult,
          tracksResult
        );
        return;
      }

      console.log('✅ Track width application completed');
    } catch (error) {
      console.warn('⚠️ Error applying track widths:', error);
    }
  }
}
