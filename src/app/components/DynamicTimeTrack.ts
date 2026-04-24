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
  import { Observable, forkJoin, of, Subject } from 'rxjs';
  import { catchError, map, debounceTime } from 'rxjs/operators';
  import { BaseWidgetComponent } from '../../../components/core/basewidget/basewidget.component';
  import { LogHeadersService } from '../../../service/log-headers.service';
  import { Log2DVisual, PlotTypes } from '@int/geotoolkit/welllog/Log2DVisual';
  import { Log2DVisualData } from '@int/geotoolkit/welllog/data/Log2DVisualData';
  import { Log2DDataRow } from '@int/geotoolkit/welllog/data/Log2DDataRow';
  import { CompositeLog2DVisualHeader } from '@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader';
  import { DefaultColorProvider } from '@int/geotoolkit/util/DefaultColorProvider';
  import {
    PrintPropertiesDialogComponent,
    PrintPropertiesData,
    PrintPropertiesResult,
  } from '../../../components/core/basewidget/print-properties-dialog/print-properties-dialog.component';
  import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
  import { Events as WellLogWidgetEvents } from '@int/geotoolkit/welllog/widgets/Events';
  import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
  import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
  import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
  import { LogCurveDataSource } from '@int/geotoolkit/welllog/data/LogCurveDataSource';
  import { Range } from '@int/geotoolkit/util/Range';
  import { Rect } from '@int/geotoolkit/util/Rect';
  import { AnchorType } from '@int/geotoolkit/util/AnchorType';
  import { NodeOrder } from '@int/geotoolkit/scene/CompositeNode';
  import { LogAnnotation } from '@int/geotoolkit/welllog/LogAnnotation';
import { LogMudLogSection } from '@int/geotoolkit/welllog/LogMudLogSection';
  import { LogAxis } from '@int/geotoolkit/welllog/LogAxis';
  import { AdaptiveTickGenerator } from '@int/geotoolkit/axis/AdaptiveTickGenerator';
  import { AdaptiveDateTimeTickGenerator } from '@int/geotoolkit/axis/AdaptiveDateTimeTickGenerator';
  import moment from 'moment';
  
  /**
   * Canonical Remote Data Source pattern for GeoToolkit-js.
   * This class handles lazy loading of log data when requested by the visual (WellLogWidget).
   */
  const MAX_RETENTION_WINDOW_MS = 6 * 60 * 60 * 1000; // Keep 6 hours of history in memory
  const INITIAL_VIEW_RANGE_MS = 4 * 60 * 60 * 1000; // Initial load: 4 hour
  /**
   * Index values are UTC epoch ms; labels must show Saudi Arabia (AST = UTC+3).
   * Use fixed utcOffset — do not add ms then format with `moment(ms)` in browser local
   * (that double-shifts when the PC is already set to Asia/Riyadh).
   */
  const INDEX_DISPLAY_UTC_OFFSET_MINUTES = 180;
  // Interface for image data response
  /**
   * High-stability remote data source with bounded 4-hour chunk requests.
   * Keeps the original RemoteLogCurveDataSource intact for safe fallback.
   */
  class SmartRemoteLogCurveDataSource extends LogCurveDataSource {
    private inFlightRanges: Set<string> = new Set();
    private loadedRanges: Range[] = [];
    private loadedIntervals: Array<{ low: number; high: number }> = [];
    private emptyChunkKeys: Set<string> = new Set();
    private isMudLog: boolean = false;
    private requestToken = 0;
    private lastRequestCenter: number | null = null;
    private lastRequestSpan: number | null = null;
  
    private static readonly MAX_API_WINDOW_MS = 4 * 60 * 60 * 1000; // backend hard limit
    private static readonly PREFETCH_MS = 30 * 60 * 1000;
    private static readonly SNAP_MS = 60 * 1000; // 1 minute buckets
    private static readonly MIN_SCROLL_DELTA_MS = 2 * 60 * 1000;
    private static readonly TIME_MNEMONIC_KEYS = ['RIGTIME', 'DATETIME', 'DATATIME'];
  
    constructor(
      private service: LogHeadersService,
      private well: string,
      private wellbore: string,
      private header: IWellboreObject,
      private mnemonic: string,
      options: any = {}
    ) {
      super(options);
      this.isMudLog = options.isMudLog || false;
      (this as any)._parentComponent = options.parent;
    }
  
    public pushSimulationData(depths: number[], values: any[]): void {
      const currentDepths = this.getDepths() || [];
      const currentValues = this.getValues() || [];
      this.setData({
        depths: [...currentDepths, ...depths],
        values: [...currentValues, ...values] as any,
      });
      this.notify('GetData', this);
    }
  
    override requestData(
      range: Range,
      scale: number,
      callback?: () => void
    ): void {
      // Keep coverage aligned with what is actually resident in datasource memory.
      this.refreshResidentCoverage();
      const viewportLow = range.getLow();
      const viewportHigh = range.getHigh();
      const viewportCenter = (viewportLow + viewportHigh) / 2;
      const viewportSpan = Math.max(1, viewportHigh - viewportLow);
  
      if (this.shouldSkipSmallMove(viewportCenter, viewportSpan)) {
        if (callback) callback();
        return;
      }
  
      let targetLow = this.snapLow(
        viewportLow - SmartRemoteLogCurveDataSource.PREFETCH_MS
      );
      let targetHigh = this.snapHigh(
        viewportHigh + SmartRemoteLogCurveDataSource.PREFETCH_MS
      );
      if (targetHigh < targetLow) {
        const t = targetLow;
        targetLow = targetHigh;
        targetHigh = t;
      }
  
      if (this.isCovered(targetLow, targetHigh)) {
        if (callback) callback();
        return;
      }
  
      const missing = this.subtractLoaded(targetLow, targetHigh);
      if (missing.length === 0) {
        if (callback) callback();
        return;
      }
  
      const chunks = this.splitToChunks(missing);
      chunks.sort((a, b) => {
        const ca = (a.low + a.high) / 2;
        const cb = (b.low + b.high) / 2;
        return Math.abs(ca - viewportCenter) - Math.abs(cb - viewportCenter);
      });
  
      // console.log(
      //     `📡 [SmartRemoteDS] ${this.mnemonic} requesting ${chunks.length} chunk(s), viewport=${new Date(
      //         viewportLow
      //     ).toISOString()}..${new Date(viewportHigh).toISOString()}, scale=${scale}`
      // );
  
      this.requestToken++;
      const token = this.requestToken;
      this.fetchChunksSequentially(chunks, viewportLow, viewportHigh, token)
        .then(() => {
          if (callback) callback();
        })
        .catch((err) => {
          console.error(
            `❌ [SmartRemoteDS] Fetch queue failed for ${this.mnemonic}:`,
            err
          );
          if (callback) callback();
        });
    }
  
    private shouldSkipSmallMove(center: number, span: number): boolean {
      if (this.lastRequestCenter == null || this.lastRequestSpan == null) {
        this.lastRequestCenter = center;
        this.lastRequestSpan = span;
        return false;
      }
      const delta = Math.abs(center - this.lastRequestCenter);
      const threshold = Math.max(
        SmartRemoteLogCurveDataSource.MIN_SCROLL_DELTA_MS,
        span * 0.05
      );
      if (delta < threshold) {
        return true;
      }
      this.lastRequestCenter = center;
      this.lastRequestSpan = span;
      return false;
    }
  
    private snapLow(ts: number): number {
      const s = SmartRemoteLogCurveDataSource.SNAP_MS;
      return Math.floor(ts / s) * s;
    }
  
    private snapHigh(ts: number): number {
      const s = SmartRemoteLogCurveDataSource.SNAP_MS;
      return Math.ceil(ts / s) * s;
    }
  
    private isCovered(low: number, high: number): boolean {
      return this.loadedIntervals.some((r) => low >= r.low && high <= r.high);
    }
  
    /**
     * Rebuild coverage map from currently resident datasource depths.
     * This prevents stale "covered" intervals after virtualization pruning.
     */
    private refreshResidentCoverage(): void {
      const depths = this.getDepths() || [];
      this.loadedIntervals = [];
      if (depths.length > 0) {
        this.loadedIntervals.push({
          low: depths[0],
          high: depths[depths.length - 1],
        });
      }
    }
  
    private subtractLoaded(
      low: number,
      high: number
    ): Array<{ low: number; high: number }> {
      let missing: Array<{ low: number; high: number }> = [{ low, high }];
      for (const loaded of this.loadedIntervals) {
        const next: Array<{ low: number; high: number }> = [];
        for (const seg of missing) {
          if (loaded.high <= seg.low || loaded.low >= seg.high) {
            next.push(seg);
            continue;
          }
          if (loaded.low > seg.low) {
            next.push({ low: seg.low, high: loaded.low });
          }
          if (loaded.high < seg.high) {
            next.push({ low: loaded.high, high: seg.high });
          }
        }
        missing = next;
        if (missing.length === 0) break;
      }
      return missing;
    }
  
    private splitToChunks(
      segments: Array<{ low: number; high: number }>
    ): Array<{ low: number; high: number }> {
      const max = SmartRemoteLogCurveDataSource.MAX_API_WINDOW_MS;
      const chunks: Array<{ low: number; high: number }> = [];
      for (const seg of segments) {
        let start = seg.low;
        while (start < seg.high) {
          const end = Math.min(start + max, seg.high);
          chunks.push({ low: start, high: end });
          start = end;
        }
      }
      return chunks;
    }
  
    private makeChunkKey(start: number, end: number): string {
      return `${this.header.objectId}|${this.mnemonic}|${start}|${end}`;
    }

    private normalizeMnemonic(name: string): string {
      return (name || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    }

    private findTimeMnemonicIndex(mnemonics: string[]): number {
      const normalized = mnemonics.map((m) => this.normalizeMnemonic(m));
      return normalized.findIndex((m: string) => {
        // Exact known keys
        if (SmartRemoteLogCurveDataSource.TIME_MNEMONIC_KEYS.includes(m)) {
          return true;
        }
        // Accept vendor/tool suffixes like RIGTIME_MLG / RIGTIMEGLG etc.
        if (m.startsWith('RIGTIME')) {
          return true;
        }
        return false;
      });
    }

    private findCurveMnemonicIndex(mnemonics: string[]): number {
      const target = this.normalizeMnemonic(this.mnemonic);
      const normalized = mnemonics.map((m) => this.normalizeMnemonic(m));

      // Exact match first
      let idx = normalized.indexOf(target);
      if (idx !== -1) return idx;

      // Flexible fallback for configured ids that include prefixes/suffixes.
      idx = normalized.findIndex(
        (m) => m.includes(target) || target.includes(m)
      );
      return idx;
    }
  
    private async fetchChunksSequentially(
      chunks: Array<{ low: number; high: number }>,
      viewportLow: number,
      viewportHigh: number,
      token: number
    ): Promise<void> {
      for (const chunk of chunks) {
        if (token !== this.requestToken) {
          return;
        }
        if (this.isCovered(chunk.low, chunk.high)) {
          continue;
        }
        const key = this.makeChunkKey(chunk.low, chunk.high);
        if (this.emptyChunkKeys.has(key) || this.inFlightRanges.has(key)) {
          continue;
        }
        await this.fetchChunk(chunk.low, chunk.high, key);
        if (this.isCovered(viewportLow, viewportHigh)) {
          return;
        }
      }
    }
  
    private fetchChunk(start: number, end: number, key: string): Promise<void> {
      return new Promise((resolve, reject) => {
        (this as any)._parentComponent?.notifyFetchStart?.();
        this.inFlightRanges.add(key);
        const queryParameter: ILogDataQueryParameter = {
          wellUid: this.well,
          logUid: this.header.objectId,
          wellboreUid: this.wellbore,
          logName: this.header.objectName,
          indexType: this.header.indexType,
          indexCurve: this.header.indexCurve,
          startIndex: new Date(start).toISOString(),
          endIndex: new Date(end).toISOString(),
          isGrowing: false,
          mnemonicList: '',
        };
  
        this.service.getTimeLogData(queryParameter).subscribe({
          next: (logDataArray: any) => {
            try {
              if (
                logDataArray != null &&
                logDataArray.logs &&
                logDataArray.logs.length > 0 &&
                logDataArray.logs[0].logData?.data?.length > 0
              ) {
                this.parseAndAppendData(
                  logDataArray.logs[0],
                  new Range(start, end)
                );
              } else {
                this.emptyChunkKeys.add(key);
              }
              this.notify('GetData', this);
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              this.inFlightRanges.delete(key);
              (this as any)._parentComponent?.notifyFetchEnd?.();
            }
          },
          error: (err: any) => {
            this.inFlightRanges.delete(key);
            (this as any)._parentComponent?.notifyFetchEnd?.();
            reject(err);
          },
        });
      });
    }
  
    public parseAndAppendData(response: any, range?: Range): void {
      const mnemonics = response.logData.mnemonicList
        .split(',')
        .map((m: string) => m.trim());
      const curveIdx = this.findCurveMnemonicIndex(mnemonics);
      const timeIdx = this.findTimeMnemonicIndex(mnemonics);
      if (timeIdx === -1) {
        console.log(
          'No time mnemonic found (expected RIGTIME/DateTime/Data Time), returning'
        );
        return;
      }
      if (curveIdx === -1) {
        console.log(
          `No curve mnemonic found for "${this.mnemonic}" in [${mnemonics.join(', ')}], returning`
        );
        return;
      }
  
      const sourceRows = response.parsedRows || response.logData.data;
      const isPreParsed = response.isPreParsed === true || !!response.parsedRows;
  
      const newData: { d: number; v: any }[] = [];
      for (let i = 0; i < sourceRows.length; i++) {
        const row = sourceRows[i];
        const cols = isPreParsed ? row : row.split(',');
        const timeVal = cols[timeIdx];
        if (timeVal === null || timeVal === undefined) continue;
  
        const d = isPreParsed
          ? timeVal
          : timeVal.includes('T') || timeVal.includes('-')
          ? new Date(timeVal).getTime()
          : Number(timeVal);
        if (isNaN(d)) continue;
  
        const v = this.isMudLog
          ? isPreParsed
            ? cols[curveIdx]
            : cols[curveIdx]?.trim() || 'UNKNOWN'
          : isPreParsed
          ? cols[curveIdx]
          : parseFloat(cols[curveIdx]);
  
        newData.push({ d, v });
      }
  
      if (newData.length > 0) {
        const depths = this.getDepths() || [];
        const values = this.getValues() || [];
        const current = depths.map((d, i) => ({ d, v: values[i] }));
  
        const combined = [...current, ...newData].sort((a, b) => a.d - b.d);
        const unique: { d: number; v: any }[] = [];
        const seenKeys = new Set<string>();
        combined.forEach((item) => {
          // Remarks/mudlog rows can repeat across overlapping chunks; dedupe by depth+value.
          // Numeric curves should still dedupe by depth to keep one sample per index.
          const depthKey = this.isMudLog ? Math.round(item.d) : item.d;
          const key = this.isMudLog
            ? `${depthKey}|${String(item.v ?? '').trim()}`
            : `${depthKey}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          unique.push(item);
        });
  
        const viewport = (
          this as any
        )._parentComponent.wellLogWidget?.getVisibleDepthLimits();
        let pruned = unique;
  
        if (viewport) {
          const viewLow = viewport.getLow();
          const viewHigh = viewport.getHigh();
          const viewRange = viewHigh - viewLow;
          const keepRange = Math.max(MAX_RETENTION_WINDOW_MS, viewRange * 2);
          const mid = (viewLow + viewHigh) / 2;
          const lowLimit = mid - keepRange;
          const highLimit = mid + keepRange;
          const newDataMin = Math.min(...newData.map((p: any) => p.d));
          const newDataMax = Math.max(...newData.map((p: any) => p.d));
  
          pruned = unique.filter((c) => {
            const inViewport = c.d >= lowLimit && c.d <= highLimit;
            const followsLatestFetch = c.d >= newDataMin && c.d <= newDataMax;
            return inViewport || followsLatestFetch;
          });
        }
  
        this.setData({
          depths: pruned.map((c) => c.d),
          values: pruned.map((c) => c.v) as any,
        });
        this.refreshResidentCoverage();
  
        (this as any)._parentComponent.totalPointsProcessed += newData.length;
  
        if (range) {
          this.loadedRanges.push(range);
        }
  
        this.notify('GetData', this);
        (this as any)._parentComponent?.syncRemarksAnnotations?.();
      }
    }
  }
  
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
  import { DiscreteFillDisplayType } from '@int/geotoolkit/welllog/header/AdaptiveDiscreteFillVisualHeader';
  import { HttpClient } from '@angular/common/http';
  import { IndexType as GeoIndexType } from '@int/geotoolkit/welllog/IndexType';
  import { TrackType } from '@int/geotoolkit/welllog/TrackType';
  import { PatternFactory } from '@int/geotoolkit/attributes/PatternFactory';
  import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
  import {
    CrossTooltipComponent,
    CrossTooltipData,
    TooltipCurveValue,
  } from '../cross-tooltip/cross-tooltip.component';
  import { StackedLogFill } from '@int/geotoolkit/welllog/StackedLogFill';
  import { WellDataService } from '../../../service/well-service/well.service';
  import {
    ILogDataQueryParameter,
    IWellboreObject,
  } from '../../../models/wellbore/wellbore-object';
  import { ITracks } from '../../../models/chart/tracks';
  import { TextStyle } from '@int/geotoolkit/attributes/TextStyle';
  import { HeaderType } from '@int/geotoolkit/welllog/header/LogAxisVisualHeader';
  import { AddDynamicTracksDialogComponent } from '../add-dynamic-tracks-dialog/add-dynamic-tracks-dialog.component';
  import { ILinePattern } from '../../../../app/models/chart/linePattern';
  import { Patterns } from '@int/geotoolkit/attributes/LineStyle';
  import { MockupService } from '../../../designer-dashboard/services/mockup.service';
import {
  DynamicTrackRemarksHelper,
  RemarkBinding,
} from './dynamic-track-remarks.helper';
  
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
    data: number[] | Array<{ depth: number; value: string }> | string[];
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

  @Component({
    selector: 'app-dynamic-track-time-generator',
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
    templateUrl: './dynamic-track-time-generator.component.html',
    styleUrl: './dynamic-track-time-generator.component.scss',
  })
  export class DynamicTrackTimeGeneratorComponent
    implements OnInit, AfterViewInit, OnDestroy
  {
    /** Array of track configurations to display */
    @Input() listOfTracks: ITracks[] = [];
    /** Unique identifier for the well */
    @Input() well: string = '';
    /** Unique identifier for the wellbore */
    @Input() wellbore: string = '';
    /** Index type: 'depth' or 'time' */
    @Input() wellIndexType: 'depth' | 'time' = 'time';
  
    /** Reference to the base widget component that hosts the canvas */
    @ViewChild('canvasWidget', { static: true })
    private widgetComponent!: BaseWidgetComponent;
  
    /** Reference to the main container for ResizeObserver */
    @ViewChild('trackContainer', { static: true })
    private trackContainer!: ElementRef;
  
    /** Must match `WellLogWidget` `header.height`. */
    private readonly wellLogHeaderHeightPx = 140;
    /** GeoToolkit visual: pinned top-of-viewport time on the index track (no HTML overlay). */
    private indexTopTimeAnnotation: LogAnnotation | null = null;
    private remarkBindings: RemarkBinding<SmartRemoteLogCurveDataSource>[] = [];
    private readonly remarksHelper = new DynamicTrackRemarksHelper();
    private isCrossHairConfigured = false;
    private isMouseHoverTooltipConfigured = false;
  
    /** GeoToolkit WellLogWidget instance for rendering tracks and curves */
    private wellLogWidget!: WellLogWidget;
    /** Refresh pinned top time annotation when the visible window changes (scroll / zoom). */
    private readonly onVisibleDepthLimitsForHeaderRefresh = (): void => {
      this.syncIndexTopTimeAnnotation();
      this.syncRemarksAnnotations();
    };
  
    /** Flag indicating if the component view is ready */
    private sceneReady = false;
  
    /** Live polling state for real-time data appending */
    /** Handle for live data polling interval */
    private livePollHandle: any = null;
    /** Live polling interval in milliseconds */
    private readonly LIVE_POLL_INTERVAL = 10000;
    /** Flag to enable/disable live data polling */
    public isLivePolling = true;
    /** Loading state for chunk fetches */
    isLoadingChunk = false;
    public loadingIndexDepthLabel = '-';
    private activeFetchCount = 0;
    public isFirstTimeLoading = false;
    /** Canvas theme flag  */
    public isDarkTheme = true;
    /** Available time scale options (milliseconds per screen height) */
    scaleOptions = [
      { label: '1 Minute', value: 60000 },
      { label: '5 Minutes', value: 300000 },
      { label: '10 Minutes', value: 600000 },
      { label: '30 Minutes', value: 1800000 },
      { label: '1 Hour', value: 3600000 },
      { label: '4 Hours', value: 14400000 },
      { label: '6 Hours', value: 21600000 },
      { label: '12 Hours', value: 43200000 },
      { label: '24 Hours', value: 86400000 },
      { label: 'Fit to Height', value: 0 },
    ];
  
    /** Currently selected time scale (default 1 hour) */
    selectedScale: number = 14400000;
  
    /** Tooltip data for the cross-tooltip component */
    tooltipData: CrossTooltipData | null = null;
  
    /** Map of curve instances keyed by mnemonicId */
    private curveMap: Map<
      string,
      {
        logCurve: LogCurve | StackedLogFill | any;
        info: TrackCurve;
        trackName: string;
      }
    > = new Map();
  
    // --- Chunked loading state (Cached headers only) ---
    private cachedHeaders: IWellboreObject[] = [];
  
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
      { pattern: 'pattern', color: '#E0E0E0' },
    ];
  
    /** Number of depth rows per chunk */
    private readonly CHUNK_SIZE = 2000;
    /** The overall max depth (time) from headers */
    private headerMaxDepth = 0;
    /** The overall min depth (time) from headers */
    private headerMinDepth = Number.MAX_SAFE_INTEGER;
    /** Observer to handle container resizing for responsive tracks */
    private resizeObserver: ResizeObserver | null = null;
  
    /**
     * --- PERFORMANCE & MEMORY MANAGEMENT ---
     * POINTS_BEFORE_RESET: Counter to trigger engine Hard Reset to prevent ghost memory.
     */
    private readonly POINTS_BEFORE_RESET = 50000;
    private visibleLimits$ = new Subject<void>();
    private totalPointsProcessed = 0;
    private isResetting = false;
    public widget: any;
    selectedLog: any;
    lstTrackTypes: string[] = [
      'Linear',
      'Logarithimic',
      'Index',
      'Mudlog',
      'Image',
      'Comments',
      'Remarks',
    ];
    lstLineStyle: ILinePattern[] = [
      { name: Patterns.Solid, style: '___________' },
      { name: Patterns.Dash, style: '---------------' },
      { name: Patterns.Dot, style: '.....................' },
    ];
    anchorTypes: string[] = ['None', 'Left', 'Right', 'Center'];
    lstHourss: number[] = [24, 12, 6, 4, 2, 1];
    /**
     * Creates an instance of GenerateCanvasTracksComponent.
     * @param logHeadersService - Service for fetching log headers and data
     */
    constructor(
      private logHeadersService: LogHeadersService,
      private wellLogData: WellDataService,
      private dialog: MatDialog,
      private ngZone: NgZone,
      private mockupService: MockupService,
      private http: HttpClient
    ) {}
  
    /**
     * Angular lifecycle hook called after component initialization.
     * Initiates the process of loading log headers and creating tracks.
     */
    ngOnInit(): void {
      this.registerLithologyPatterns();
      this.loadLogHeadersAndCreateTracks();
      if (this.isLivePolling) {
        this.startLivePolling();
      }
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
      // console.log('🧹 Cleaning up component resources');
      this.visibleLimits$.complete();
      this.wellLogWidget?.off(
        WellLogWidgetEvents.VisibleDepthLimitsChanged,
        this.onVisibleDepthLimitsForHeaderRefresh
      );
      this.indexTopTimeAnnotation = null;
      if (this.livePollHandle) {
        clearInterval(this.livePollHandle);
        this.livePollHandle = null;
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      this.detachMouseHoverTooltipTracking();
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
        console.warn(
          '⚠️ Could not find trackContainer native element for ResizeObserver'
        );
        return;
      }
  
      this.resizeObserver = new ResizeObserver(() => {
        this.ngZone.run(() => {
          if (this.wellLogWidget) {
            console.log('📏 Container resized - updating track layout');
            this.wellLogWidget.updateLayout();
            this.syncIndexTopTimeAnnotation();
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
      //console.log('🧱 Registering lithology patterns from assets/data/lithologyPatterns.json...' );
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
              //  console.warn(`⚠️ Skipping pattern "${name}": invalid base64 data`);
              return;
            }
  
            const img = new Image();
            img.onload = () => {
              // Correct signature is addPattern(image, name)
              factory.addPattern(img, name.toLowerCase());
            };
            img.onerror = () =>
              console.error(`❌ Failed to load image for pattern: ${name}`);
            img.src = base64Data;
            count++;
          });
          //  console.log(`✅ ${count} lithology patterns registration initiated`);
        },
        error: (err) =>
          console.error('❌ Failed to load lithology patterns:', err),
      });
    }
  
    /**
     * Loads log headers from the service and initiates track creation process.
     * Validates required parameters and handles loading states.
     *
     * @private
     */
    private wellboreObjects: IWellboreObject[] = [];
    private loadLogHeadersAndCreateTracks(): void {
      this.logHeadersService.clearCache();
      if (!this.well || !this.wellbore) {
        console.error('❌ Well and wellbore parameters are required');
        return;
      }
  
      this.isFirstTimeLoading = true;
      (async () => {
        this.wellboreObjects = await this.wellLogData.getLogHeader(
          this.well,
          this.wellbore
        );
        // Store wellboreObjects as cachedHeaders for chunk loading & live polling
        this.cachedHeaders = this.wellboreObjects;
  
        await this.processLogHeaders(this.cachedHeaders);
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
      // 1. Get the set of LogIds we actually care about from the template
      const configuredLogIds = new Set<string>();
      this.listOfTracks.forEach((track) => {
        track.curves.forEach((curve: any) => {
          if (curve.LogId) {
            configuredLogIds.add(curve.LogId);
          }
        });
      });
  
      // 2. Filter the headers to only include configured ones
      const relevantHeaders = headers.filter((h) =>
        Array.from(configuredLogIds).some((id) => h.objectId.includes(id))
      );
      //  console.log(   `📊 Processing ${relevantHeaders.length}/${headers.length} relevant log headers for time limits`);
  
      // 3. Determine overall time range from relevant headers
      relevantHeaders.forEach((h) => {
        const startStr = h.startIndex;
        const endStr = h.endIndex;
        if (startStr && endStr) {
          const start = new Date(startStr).getTime();
          const end = new Date(endStr).getTime();
  
          if (start < this.headerMinDepth) this.headerMinDepth = start;
          if (end > this.headerMaxDepth) this.headerMaxDepth = end;
        }
      });
  
      if (this.headerMinDepth === Number.MAX_SAFE_INTEGER)
        this.headerMinDepth = 0;
  
      // Handle MudLog and Log2D tracks separately (Synchronized)
      const loaders: Observable<any>[] = [];
      this.listOfTracks.forEach((trackInfo) => {
        if (trackInfo.trackType === 'MudLog') {
          trackInfo.curves.forEach((curve: any) => {
            loaders.push(this.loadMudLogData(curve));
          });
        }
      });
  
      // Wait for all asynchronous assets before creating the scene
      if (loaders.length > 0) {
        //  console.log(`⌛ Waiting for ${loaders.length} async data assets...`);
        forkJoin(loaders).subscribe({
          next: () => {
            //  console.log('✅ All async data loaded - initializing scene');
            this.createSceneWithData();
          },
          error: (err) => {
            console.error('❌ Error loading async data assets:', err);
            this.createSceneWithData(); // Fallback anyway
          },
        });
      } else {
        this.createSceneWithData();
      }
    }
  
    /**
     * Loads MudLog lithology data from the sample data file.
     *
     * @param curve - The MudLog curve to load data for
     * @private
     */
    private loadMudLogData(curve: TrackCurve): Observable<any[]> {
      // console.log(`🪨 Loading MudLog data for curve: ${curve.displayName}`);
  
      return this.http
        .get<Array<{ depth: number; value: string }>>(
          '/assets/data/mudLogTimeData.json'
        )
        .pipe(
          map((mudLogData) => {
            //  console.log(`✅ MudLog data loaded for ${curve.displayName}:`,mudLogData.length,'entries');
            // Store data in curve object
            curve.data = mudLogData;
            // Reactively update visual section if it already exists in the scene
            const entry = this.curveMap.get(curve.mnemonicId);
            if (entry && entry.logCurve instanceof StackedLogFill) {
              //  console.log( `🔄 Reactively updating MudLog visual for ${curve.displayName}`);
              this.wellLogWidget?.updateLayout();
            }
            return mudLogData;
          }),
          catchError((err) => {
            console.error(
              `❌ Error loading MudLog data for ${curve.displayName}:`,
              err
            );
            curve.data = [];
            return of([]);
          })
        );
    }
  
    /**
     * Creates the scene with loaded data and sets proper depth (time) limits.
     * Called after all data has been loaded to ensure data is available.
     *
     * @private
     */
    private async createSceneWithData(): Promise<void> {
      // if (this.wellLogWidget) {
      //   console.log('🛡️ Scene already exists - skipping recreation');
      //   return;
      // }
      try {
        // console.log('🔧 Creating scene with loaded data');
        this.curveMap.clear();
        if (this.wellLogWidget) {
          this.wellLogWidget.off(
            WellLogWidgetEvents.VisibleDepthLimitsChanged,
            this.onVisibleDepthLimitsForHeaderRefresh
          );
        }
        this.indexTopTimeAnnotation = null;
        this.remarkBindings = [];
        this.isCrossHairConfigured = false;
        // Create WellLogWidget for Time-based display
        this.wellLogWidget = new WellLogWidget({
          indextype: GeoIndexType.Time,
          indexunit: 'UTC',
          horizontalscrollable: false,
          verticalscrollable: true,
          header: {
            visible: true,
            height: this.wellLogHeaderHeightPx,
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
        //Register Header Provider for Log2DVisual
        const headerProvider = this.wellLogWidget
          .getHeaderContainer()
          .getHeaderProvider();
        const log2DHeader = new CompositeLog2DVisualHeader();
        // Explicitly set text styles for composite header components
        (log2DHeader as any).setProperties({
          title: { textstyle: { color: 'white' } },
          colorbar: {
            axis: { textstyle: { color: 'white' } },
            title: { textstyle: { color: 'white' } },
          },
        });
        // Apply track styling following GeoToolkit demo pattern
        this.logHeadersService.applyGeoToolkitTheme(this.wellLogWidget);
        headerProvider.registerHeaderProvider(
          Log2DVisual.getClassName(),
          log2DHeader
        );
        const indexAxisHeader = headerProvider.getHeaderProvider(
          LogAxis.getClassName()
        ) as any;
        if (indexAxisHeader) {
          headerProvider.registerHeaderProvider(
            LogAxis.getClassName(),
            indexAxisHeader.clone().setHeaderType(HeaderType.Custom).setFormatHeaderHandler(() => {
              const limits = this.wellLogWidget?.getVisibleDepthLimits?.();
              if (!limits) {
                return `Time\n-\n-`;
              }
              const spanMs = Math.max(0, limits.getHigh() - limits.getLow());
              const hours = spanMs / 3600000;
              const scaleLine =
                hours >= 1
                  ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`
                  : `${Math.max(1, Math.round(spanMs / 60000))} minutes`;
              const dateTimeLine = this.indexDisplayMoment(limits.getHigh()).format(
                'M/D/YYYY HH:mm:ss'
              );
              return `Time\n${scaleLine}\n${dateTimeLine}`;
            })
          );
        }
        // Create index track first to ensure it's always visible
        const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
        const indexCfg = this.listOfTracks.find((tr) => tr.isIndex);
        const indexColWidth = indexCfg?.trackWidth ?? 118;
        indexTrack.setWidth(indexColWidth);
        indexTrack.setName('');
        this.wellLogWidget.getTrackHeader(indexTrack).setVisibleTrackTitle(false);
        let axis: LogAxis | null = null;
        for (let i = 0; i < indexTrack.getChildrenCount(); i++) {
          const child = indexTrack.getChild(i);
          if (child instanceof LogAxis) {
            axis = child;
            break;
          }
        }
        if (axis) {
          // Time index: use toolkit datetime ticks (welllog_widgets demo) so intervals
          // and labels follow zoom/scale — avoids duplicate hour labels from rounding
          // numeric AdaptiveTickGenerator positions.
          if (this.wellIndexType === 'time') {
            const tickGenerator = new AdaptiveDateTimeTickGenerator();
            tickGenerator
              .setLocale('en')
              .setTimeZoneOffset(INDEX_DISPLAY_UTC_OFFSET_MINUTES / 60, 'hours')
              .setVisibleLabelGrade('minor', false);
            axis.setTickGenerator(tickGenerator);
          } else {
            const tickGenerator = new AdaptiveTickGenerator();
            tickGenerator.setVisibleLabelGrade('minor', false);
            axis.setTickGenerator(tickGenerator);
          }
          axis.setTextStyle({ color: 'white' });
        }
  
        this.indexTopTimeAnnotation = new LogAnnotation(
          new Rect(0, 0, 1, 1),
          ''
        )
          .setTextStyle(new TextStyle({ color: 'white' }))
          .setTextPosition(AnchorType.TopCenter)
          .setFixedHeight(false);
        indexTrack.addChild(this.indexTopTimeAnnotation);
        indexTrack.changeChildOrder(this.indexTopTimeAnnotation, NodeOrder.Last);
  
        // Create data tracks
        this.createTracks();
        // Assign widget to BaseWidgetComponent
        this.widgetComponent.Widget = this.wellLogWidget;
        this.wellLogWidget.on(
          WellLogWidgetEvents.VisibleDepthLimitsChanged,
          this.onVisibleDepthLimitsForHeaderRefresh
        );
        // Set depth limits, show recent data first, and configure crosshair + scroll listener
        // setTimeout(() => {
        try {
          const minTime = this.headerMinDepth;
          const maxTime =
            this.headerMaxDepth > 0 ? this.headerMaxDepth : this.getMaxDepth();
          //     console.log(`📊 Setting time limits: ${new Date(minTime).toISOString()} to ${new Date(maxTime).toISOString()}`);
          this.wellLogWidget.setDepthLimits(minTime, maxTime);
          // Show recent data (e.g. last 4 hours) or fit to height
          const scrollTarget = maxTime;
          const defaultViewRange = INITIAL_VIEW_RANGE_MS;
          const viewScale =
            this.selectedScale > 0 ? this.selectedScale : defaultViewRange;
          const recentStart = Math.max(minTime, scrollTarget - viewScale);
          // console.log( `📏 Setting initial viewport: ${new Date(recentStart).toISOString()} to ${new Date(scrollTarget).toISOString()}`);
          this.wellLogWidget.setVisibleDepthLimits(recentStart, scrollTarget);
          // Force an initial layout update to ensure horizontal factor fitting
          this.wellLogWidget.updateLayout();
          this.syncIndexTopTimeAnnotation();
          // Configure crosshair for tooltip
          this.configureCrossHair();
          this.attachMouseHoverTooltipTracking();
          //        console.log('✅ Scene created with data successfully');
          setTimeout(() => {
            this.isFirstTimeLoading = false;
          }, 500);
        } catch (error) {
          console.error('❌ Error setting depth limits:', error);
        }
        // }, 100);
      } catch (error) {
        console.error('❌ Error creating scene with data:', error);
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
      const minDepth = this.headerMinDepth;
      if (scale === 0) {
        // Fit to height - show all data
        this.wellLogWidget.setVisibleDepthLimits(minDepth, maxDepth);
        this.wellLogWidget.fitToHeight();
      } else {
        // Set visible range based on scale
        const visibleRange = Math.min(scale, maxDepth - minDepth);
        const scrollStart = Math.max(minDepth, maxDepth - visibleRange);
        this.wellLogWidget.setVisibleDepthLimits(scrollStart, maxDepth);
      }
      this.wellLogWidget.updateLayout();
      const limits = this.wellLogWidget.getVisibleDepthLimits();
      // console.log('📏 Scale applied:',scale === 0 ? 'Fit to Height' : `1:${scale}`,'| Visible:',limits);
    }
  
    /**
     * Handles scale change from the UI dropdown.
     * Dynamically updates the visible depth limits based on the selected scale.
     *
     * @param scale - New scale value selected by the user
     */
    onScaleChange(scale: number): void {
      this.selectedScale = Number(scale);
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
      this.wellLogWidget.setVisibleDepthLimits(
        center - newRange / 2,
        center + newRange / 2
      );
      this.wellLogWidget.updateLayout();
      // console.log('🔍 Zoomed In:',(center - newRange / 2).toFixed(1), '-',(center + newRange / 2).toFixed(1));
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
      // console.log('🔍 Zoomed Out:', start.toFixed(1), '-', end.toFixed(1));
    }
    resetView(): void {
      // console.log('🔄 Resetting view to default scale (1:1000)');
      console.log(this.selectedScale);
      this.selectedScale = this.scaleOptions[5].value;
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
      console.log(
        `📡 Starting live polling (interval: ${this.LIVE_POLL_INTERVAL}ms)`
      );
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
      const logIdGroups = new Map<
        string,
        { header: IWellboreObject; curves: TrackCurve[]; lastMax: number }
      >();
  
      this.curveMap.forEach((entry, mnemonicId) => {
        let max = 0;
        let hasDataSource = false;
  
        if (entry.logCurve instanceof LogCurve) {
          const dataSource = entry.logCurve.getDataSource();
          if (dataSource instanceof SmartRemoteLogCurveDataSource) {
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
            const header = this.cachedHeaders.find((h) =>
              h.objectId.includes(entry.info.LogId)
            );
            if (header) {
              logIdGroups.set(entry.info.LogId, {
                header,
                curves: [],
                lastMax: max,
              });
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
        // Use current time as endIndex to ensure we catch the latest data tail
        const now = Date.now();
        const endIndex = Math.max(now, startIndex + this.CHUNK_SIZE);
        const queryParameter: ILogDataQueryParameter = {
          wellUid: this.well,
          logUid: group.header.objectId,
          wellboreUid: this.wellbore,
          logName: group.header.objectName,
          indexType: group.header.indexType,
          indexCurve: group.header.indexCurve,
          startIndex: new Date(startIndex).toISOString(),
          endIndex: new Date(endIndex).toISOString(),
          isGrowing: true,
          mnemonicList: '',
        };
        this.logHeadersService.getTimeLogData(queryParameter).subscribe({
          next: (response: any) => {
            if (
              response &&
              response.logs &&
              response.logs.length > 0 &&
              response.logs[0].logData?.data?.length > 0
            ) {
              //  console.log(`📥 [LivePoll] Received ${response.logs[0].logData.data.length} new log rows for ${group.header.objectName}`);
              const logData = response.logs[0];
              const pollRange = new Range(startIndex, endIndex);
  
              group.curves.forEach((c) => {
                const entry = this.curveMap.get(c.mnemonicId);
                if (entry && entry.logCurve.getDataSource instanceof Function) {
                  const ds = entry.logCurve.getDataSource();
                  if (ds instanceof SmartRemoteLogCurveDataSource) {
                    ds.parseAndAppendData(logData, pollRange);
                    // Update global max depth tracker
                    const depths = ds.getDepths();
                    const newMax =
                      depths.length > 0 ? depths[depths.length - 1] : 0;
                    if (newMax > this.headerMaxDepth) {
                      this.headerMaxDepth = newMax;
                      if (this.wellLogWidget) {
                        this.wellLogWidget.setDepthLimits(
                          this.headerMinDepth,
                          this.headerMaxDepth
                        );
                      }
                    }
                  }
                }
              });
  
              if (this.isLivePolling && this.wellLogWidget) {
                // Adaptive "Follow Mode": Proactive anchoring to the data tail
                setTimeout(() => {
                  if (!this.wellLogWidget) return;
                  const fullMaxDepth = this.headerMaxDepth;
                  const currentLimits: any =
                    this.wellLogWidget.getVisibleDepthLimits();
                  if (currentLimits) {
                    const currentRange =
                      currentLimits.getHigh() - currentLimits.getLow();
                    // If user is within 10% of the bottom, keep following
                    const isUserBrowsingHistory =
                      fullMaxDepth - currentLimits.getHigh() > currentRange * 0.1;
                    if (!isUserBrowsingHistory) {
                      const scrollStart = Math.max(
                        0,
                        fullMaxDepth - currentRange
                      );
                      this.wellLogWidget.setVisibleDepthLimits(
                        scrollStart,
                        fullMaxDepth
                      );
                    }
                    // Always refresh layout when new data arrives in live mode
                    this.wellLogWidget.updateLayout();
                  }
                }, 50);
              }
            }
          },
          error: (err: any) => console.warn('⚠️ Polling error:', err),
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
        indexType: this.wellIndexType as any,
        dataMin: this.headerMinDepth,
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
          // console.log('🖨️ Print Properties result:', result);
  
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
          result.headerOption === 'topAndBottom' || result.headerOption === 'top'
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
          //   console.log( `📊 Creating track ${trackIndex + 1}: ${trackInfo.trackName}`);
          let track: LogTrack;
          const trackType = this.normalizeTrackType(trackInfo.trackType);
          if (trackInfo.isIndex) {
            // Skip index track creation - it's already created in createScene
            //     console.log('⚠️ Skipping index track creation - already created in createScene');
            return;
          } else if (trackType === 'mudlog') {
            // Create MudLog track using dedicated method
            track = this.createMudLogTrack(trackInfo);
          } else if (trackType === 'log2d' || trackType === 'image') {
            // Create Log2D track using dedicated method
            track = this.createLog2DTrack(trackInfo);
          } else if (trackType === 'remarks' || trackType === 'comments') {
            // Create Remarks track using static template text annotations
            track = this.createRemarksTrack(trackInfo);
          } else {
            // Create regular track - use setFactor for responsiveness
            track = this.wellLogWidget.addTrack(TrackType.LinearTrack);
            track.setName(trackInfo.trackName);
            // Converting pixel width to factor (weight) for proportional scaling
            (track as any).setLayoutStyle({
              factor: trackInfo.trackWidth || 130,
            });
          }
  
          // Create curves for this track
          if (trackType === 'mudlog') {
            this.createMudLogCurves(track, trackInfo);
          } else if (trackType === 'log2d' || trackType === 'image') {
            this.createLog2DCurves(track, trackInfo);
          } else if (trackType === 'remarks' || trackType === 'comments') {
            this.createRemarksCurves(track, trackInfo);
          } else {
            this.createCurves(track, trackInfo);
          }
        } catch (error) {
          console.error(`❌ Error creating track ${trackInfo.trackName}:`, error);
        }
      });
    }

    private normalizeTrackType(trackType: any): string {
      return String(trackType || '')
        .replace(/\s+/g, '')
        .toLowerCase();
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
          if (!curveInfo.show) {
            //  console.warn(`⚠️ Skipping curve ${curveInfo.mnemonicId} - curve hidden`);
            return;
          }
          if (!curveInfo.data || curveInfo.data.length === 0) {
            //  console.log( `ℹ️ Creating empty curve header for ${curveInfo.mnemonicId} (no data)`);
          }
          //   console.log(`📈 Creating curve: ${curveInfo.mnemonicId}`);
          const header = this.cachedHeaders.find((h) =>
            h.objectId.includes(curveInfo.LogId)
          );
          if (!header) {
            //  console.warn('Header not found for this LogId ',curveInfo.mnemonicId);
            return;
          }
  
          // --- CANONICAL DATA VIRTUALIZATION ---
          // Create specialized RemoteLogCurveDataSource instead of simple GeoLogData
          const dataSource = this.remarksHelper.createSmartDataSource(
            () =>
              new SmartRemoteLogCurveDataSource(
                this.logHeadersService,
                this.well,
                this.wellbore,
                header,
                curveInfo.mnemonicId,
                { parent: this }
              )
          );
  
          // Initial setup for the first chunk already loaded
          if (
            curveInfo.data &&
            Array.isArray(curveInfo.data) &&
            curveInfo.data.length > 0
          ) {
            // Fallback to basic data for initial display if available
            dataSource.setData({
              depths: [],
              values: curveInfo.data as any,
            });
          }
  
          // Create LogCurve with specialized data source
          const curve = new LogCurve(dataSource);
          curve.setLineStyle({
            color: curveInfo.color,
            width: curveInfo.lineWidth,
          });
          curve.setDescription(curveInfo.displayName);
          curve.setName(curveInfo.unit);
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
     * Toggles between light and dark theme.
     */
    toggleTheme(): void {
      this.isDarkTheme = !this.isDarkTheme;
      // console.log('🎨 Theme toggled to:', this.isDarkTheme ? 'dark' : 'light');
  
      // Apply theme to GeoToolkit headers and tracks
      this.logHeadersService.applyGeoToolkitTheme(this.wellLogWidget);
    }
  
    /**
     * Creates a MudLog track with lithology display capabilities.
     * Follows GeoToolkit MudLog track patterns for clean separation.
     *
     * @param trackInfo - Track configuration for MudLog
     * @returns Created MudLog track
     * @private
     */
    private createMudLogTrack(trackInfo: ITracks): LogTrack {
      // console.log(`🪨 Creating MudLog track: ${trackInfo.trackName}`);
  
      // Create MudLog track using TrackType.LinearTrack
      const mudLogTrack = this.wellLogWidget.addTrack(TrackType.LinearTrack);
      mudLogTrack.setName(trackInfo.trackName);
      // Use proportional factor (via layout style) for responsiveness
      (mudLogTrack as any).setLayoutStyle({
        factor: trackInfo.trackWidth || 150,
      });
  
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
    private createMudLogCurves(track: LogTrack, trackInfo: ITracks): void {
      // console.log(`🎨 Creating MudLog curves for track: ${trackInfo.trackName}`);
  
      trackInfo.curves.forEach((curveInfo, curveIndex) => {
        try {
          if (!curveInfo.show) {
            // console.warn(`⚠️ MudLog curve ${curveInfo.displayName} is hidden`);
            return;
          }
          if (!curveInfo.data || curveInfo.data.length === 0) {
            //  console.log(`ℹ️ Creating empty MudLog header for ${curveInfo.displayName} (no data)`);
          }
          // console.log(`🪨 Creating MudLog curve: ${curveInfo.displayName}`);
  
          // Parse MudLog data using dedicated method
          const mudLogData = this.parseMudLogData(curveInfo);
          if (mudLogData.depths.length === 0) {
            //   console.warn( `⚠️ No valid MudLog data parsed for ${curveInfo.displayName}`    );
            return;
          }
  
          // Map lithology values to pattern names via our previous helper
          const lithMap = this.getLithologyPatternMap();
          // Create GeoLogData for each pattern
          const geoLogDatas: GeoLogData[] = this.LITHOLOGY_PATTERNS.map(
            (p) => new GeoLogData(p.pattern)
          );
          // Populate binary values arrays (1 or 0)
          const valuesArrays = geoLogDatas.map(() => [] as number[]);
          mudLogData.lithology.forEach((lith) => {
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
              fillstyle: {
                pattern:
                  PatternFactory.getInstance().getPattern(
                    this.LITHOLOGY_PATTERNS[i].pattern
                  ) || undefined,
                color: this.LITHOLOGY_PATTERNS[i].color,
              },
              linestyle: this.LITHOLOGY_PATTERNS[i].color,
              displaymode: ['line'],
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
  
          //  console.log(`✅ MudLog curve ${curveInfo.displayName} created successfully with ${mudLogData.depths.length} points` );
        } catch (error) {
          console.error(
            `❌ Error creating MudLog curve ${curveInfo.displayName}:`,
            error
          );
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
    private parseMudLogData(curveInfo: TrackCurve): {
      depths: number[];
      lithology: string[];
    } {
      const depths: number[] = [];
      const lithology: string[] = [];
  
      try {
        // Parse data similar to regular curves but for lithology
        if (Array.isArray(curveInfo.data)) {
          curveInfo.data.forEach((dataPoint) => {
            if (
              dataPoint &&
              typeof dataPoint === 'object' &&
              'depth' in dataPoint &&
              'value' in dataPoint
            ) {
              const depth = parseFloat(
                (dataPoint as any).depth?.toString() || '0'
              );
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
  
        //   console.log(`📊 Parsed MudLog data: ${depths.length} points, depth range: ${depths.length > 0 ? Math.min(...depths) : 0 }-${depths.length > 0 ? Math.max(...depths) : 0}`);
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
        SAND: 'sand',
        SANDSTONE: 'sand',
        SHALE: 'shale',
        CLAY: 'shale',
        LIMESTONE: 'lime',
        DOLOMITE: 'dolomite',
        SILT: 'siltstone',
        SILTSTONE: 'siltstone',
        MUD: 'shale',
        MUDSTONE: 'shale',
        COAL: 'pattern',
        ANHYDRITE: 'pattern',
        SALT: 'salt',
        GYPSUM: 'pattern',
        UNKNOWN: 'pattern',
        DEFAULT: 'pattern',
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
    private createLog2DTrack(trackInfo: ITracks): LogTrack {
      //console.log(`🖼️ Creating Log2D track: ${trackInfo.trackName}`);
  
      // Create Log2D track using TrackType.LinearTrack
      const log2DTrack = this.wellLogWidget.addTrack(TrackType.LinearTrack);
      log2DTrack.setName(trackInfo.trackName);
      // Use proportional factor (via layout style) for responsiveness
      (log2DTrack as any).setLayoutStyle({ factor: trackInfo.trackWidth || 150 });
  
      // Configure Log2D-specific properties
      log2DTrack.setProperty('show-grid', false);
      log2DTrack.setProperty('show-title', true);
  
      // Register Log2D header provider
      const headerProvider = this.wellLogWidget
        .getHeaderContainer()
        .getHeaderProvider();
      headerProvider.registerHeaderProvider(
        Log2DVisual.getClassName(),
        new CompositeLog2DVisualHeader()
      );
  
      // console.log(`✅ Log2D track ${trackInfo.trackName} created successfully`);
      return log2DTrack;
    }

    /**
     * Creates a remarks track that displays static text from template configuration.
     */
    private createRemarksTrack(trackInfo: ITracks): LogTrack {
      return this.remarksHelper.createRemarksLogTrack(
        this.wellLogWidget,
        trackInfo
      );
    }

    /**
     * Reads static remark entries from track config and renders them as annotations.
     * Supported item formats:
     *  - { depth: number|string, value|text|remark: string }
     *  - "depth,text"
     */
    private createRemarksCurves(track: LogTrack, trackInfo: ITracks): void {
      let totalRemarks = 0;

      trackInfo.curves.forEach((curveInfo) => {
        if (!curveInfo.show) {
          return;
        }

        const header = this.cachedHeaders.find((h) =>
          h.objectId.includes(curveInfo.LogId)
        );

        // Same architecture as createCurves(): remarks can lazy-load from SmartRemote DS.
        if (header) {
          const dataSource = this.remarksHelper.createSmartDataSource(
            () =>
              new SmartRemoteLogCurveDataSource(
                this.logHeadersService,
                this.well,
                this.wellbore,
                header,
                curveInfo.mnemonicId,
                { parent: this, isMudLog: true }
              )
          );

          // Keep this curve visually hidden; datasource drives annotation text rendering.
          const hiddenCurve = new LogCurve(dataSource);
          hiddenCurve.setLineStyle({ color: 'rgba(0,0,0,0)', width: 0 });
          track.addChild(hiddenCurve);
          const remarksSection = new LogMudLogSection();
          remarksSection.setProperty('ellipsis', true);
          remarksSection.setProperty('padding', 5);
          track.addChild(remarksSection);

          const binding = {
            track,
            dataSource,
            remarksSection,
          };
          this.remarkBindings.push(binding);
          this.curveMap.set(curveInfo.mnemonicId, {
            logCurve: hiddenCurve,
            info: curveInfo,
            trackName: trackInfo.trackName,
          });
        }

        // Static fallback from template payload.
        const remarkItems = this.parseRemarksData(
          Array.isArray(curveInfo.data)
            ? curveInfo.data
            : (curveInfo as any).mnemonicLst
        );
        totalRemarks += remarkItems.length;
        if (remarkItems.length) {
          const staticSection = new LogMudLogSection();
          staticSection.setProperty('ellipsis', true);
          staticSection.setProperty('padding', 5);
          staticSection.setDepthsAndValues(
            remarkItems.map((item) => item.depth),
            remarkItems.map((item) => item.text)
          );
          track.addChild(staticSection);
        }
      });

      // Fallback: some static templates place remarks directly at track level.
      if (totalRemarks === 0) {
        const trackLevelData =
          (trackInfo as any).data ??
          (trackInfo as any).remarks ??
          (trackInfo as any).comments;
        const fallbackRemarks = this.parseRemarksData(trackLevelData);
        if (fallbackRemarks.length) {
          const fallbackSection = new LogMudLogSection();
          fallbackSection.setProperty('ellipsis', true);
          fallbackSection.setProperty('padding', 5);
          fallbackSection.setDepthsAndValues(
            fallbackRemarks.map((item) => item.depth),
            fallbackRemarks.map((item) => item.text)
          );
          track.addChild(fallbackSection);
        }
      }
    }

    private syncRemarksAnnotations(): void {
      this.remarksHelper.syncRemarksAnnotations(
        this.wellLogWidget,
        this.remarkBindings
      );
    }

    private parseRemarksData(data: any): Array<{ depth: number; text: string }> {
      const remarks: Array<{ depth: number; text: string }> = [];
      if (!Array.isArray(data)) {
        return remarks;
      }

      data.forEach((entry) => {
        if (entry == null) return;

        // Format: "depth,text"
        if (typeof entry === 'string') {
          const commaIdx = entry.indexOf(',');
          if (commaIdx > 0) {
            const rawDepth = entry.slice(0, commaIdx).trim();
            const rawText = entry.slice(commaIdx + 1).trim();
            const depth = this.parseRemarkDepth(rawDepth);
            if (Number.isFinite(depth) && rawText) {
              remarks.push({ depth, text: rawText });
            }
          }
          return;
        }

        // Format: { depth|time|index|startIndex, value|text|remark|comment }
        const rawDepth =
          (entry as any).depth ??
          (entry as any).time ??
          (entry as any).index ??
          (entry as any).startIndex;
        const rawText =
          (entry as any).value ??
          (entry as any).text ??
          (entry as any).remark ??
          (entry as any).comment;
        const depth = this.parseRemarkDepth(rawDepth);
        const text = String(rawText ?? '').trim();
        if (Number.isFinite(depth) && text) {
          remarks.push({ depth, text });
        }
      });

      return remarks.sort((a, b) => a.depth - b.depth);
    }

    private parseRemarkDepth(rawDepth: any): number {
      if (rawDepth == null) return Number.NaN;
      if (typeof rawDepth === 'number') {
        // If seconds-based unix timestamp is provided, convert to milliseconds.
        return rawDepth > 0 && rawDepth < 1e12 ? rawDepth * 1000 : rawDepth;
      }
      const asNumber = Number(rawDepth);
      if (Number.isFinite(asNumber)) {
        return asNumber > 0 && asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const asDate = new Date(String(rawDepth)).getTime();
      return Number.isFinite(asDate) ? asDate : Number.NaN;
    }
  
    /**
     * Creates Log2D curves with image data visualization.
     * Loads image data from backend and creates Log2D visual elements.
     *
     * @param track - The Log2D track to add curves to
     * @param trackInfo - Track configuration containing Log2D curve definitions
     * @private
     */
    private createLog2DCurves(track: LogTrack, trackInfo: ITracks): void {
      //  console.log(`🎨 Creating Log2D curves for track: ${trackInfo.trackName}`);
  
      trackInfo.curves.forEach((curveInfo, curveIndex) => {
        try {
          if (!curveInfo.show) {
            //     console.warn(`⚠️ Log2D curve ${curveInfo.displayName} is hidden`);
            return;
          }
  
          //  console.log(`🖼️ Creating Log2D curve: ${curveInfo.displayName}`);
  
          // Load Log2D data from backend
          this.loadLog2DData(curveInfo)
            .then((log2DData) => {
              if (!log2DData || log2DData.getRows().length === 0) {
                //     console.warn( `⚠️ No valid Log2D data loaded for ${curveInfo.displayName}`);
                return;
              }
  
              // Create Log2D visual
              const log2DVisual = this.create2DVisual(
                log2DData,
                curveInfo.displayName,
                0,
                curveInfo.color || '#7cb342'
              );
              log2DVisual.setPlotType(PlotTypes.Linear);
  
              // Add to track
              track.addChild([log2DVisual]);
              //   console.log(`✅ Log2D curve ${curveInfo.displayName} created successfully with ${log2DData.getRows().length} rows`);
            })
            .catch((error) => {
              console.error(
                `❌ Error loading Log2D data for ${curveInfo.displayName}:`,
                error
              );
            });
        } catch (error) {
          console.error(
            `❌ Error creating Log2D curve ${curveInfo.displayName}:`,
            error
          );
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
      // console.log(`📡 Loading Log2D data for curve: ${curveInfo.displayName}`);
  
      // Load image data from backend service (same endpoint as simple-log2d-demo)
      return this.http
        .get<ImageDataResponse>('http://localhost:3000/api/getImageData')
        .toPromise()
        .then((response) => {
          if (!response || !response.imageData) {
            throw new Error(
              'Failed to load Log2D data: No data received from backend'
            );
          }
  
          const log2dData = new Log2DVisualData();
  
          // Get depth range from image data (may be timestamps or depths)
          const rawMinDepth = response.imageData[0]?.depth || 0;
          const rawMaxDepth =
            response.imageData[response.imageData.length - 1]?.depth ||
            rawMinDepth + 1;
  
          // 1:1 Mapping: Remove scaling logic to map raw depths directly
          response.imageData.forEach((item: LogDataItem) => {
            const rawDepth = item.depth;
            const row = new Log2DDataRow(rawDepth, item.values, item.angles);
            log2dData.getRows().push(row);
          });
  
          log2dData.updateLimits();
          // console.log(`✅ Loaded Log2D image data: 1:1 mapping, ${log2dData.getRows().length} rows from depth ${log2dData.getMinDepth()} to ${log2dData.getMaxDepth()}`);
          return log2dData;
        })
        .catch((error) => {
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
  
      // Create color provider: Matching the reference image (Green -> Yellow -> Red)
      const colors = new DefaultColorProvider()
        .addColor(0.0, 'rgba(124, 179, 66, 1)') // Green
        .addColor(0.01, 'rgba(192, 202, 51, 1)') // Yellow-Green
        .addColor(0.02, 'rgba(255, 235, 59, 1)') // Yellow
        .addColor(0.03, 'rgba(255, 152, 0, 1)') // Orange
        .addColor(0.04, 'rgba(244, 67, 54, 1)'); // Red
  
      // Create Log2DVisual
      return new Log2DVisual()
        .setName(name)
        .setData(log2dData)
        .setColorProvider(colors)
        .setOffsets(offset)
        .setMicroPosition(0, 1);
    }
  
    /**
     * Calculates the maximum depth currently available across all data sources.
     */
    private getMaxDepth(): number {
      let max = 0;
      this.curveMap.forEach((entry) => {
        const dataSource = entry.logCurve.getDataSource
          ? entry.logCurve.getDataSource()
          : null;
        if (dataSource instanceof SmartRemoteLogCurveDataSource) {
          const depths = dataSource.getDepths();
          if (depths && depths.length > 0) {
            max = Math.max(max, depths[depths.length - 1]);
          }
        }
      });
  
      return max || this.headerMaxDepth || 1000;
    }
  
    /** UTC instant → same instant, formatted in AST (UTC+3), independent of browser TZ. */
    private indexDisplayMoment(valueMs: number): moment.Moment {
      return moment.utc(valueMs).utcOffset(INDEX_DISPLAY_UTC_OFFSET_MINUTES);
    }
  
    /**
     * Updates {@link indexTopTimeAnnotation} so the visible-range top time stays in a thin band
     * at the top of the index track (model depth = visible low … low + band).
     */
    private syncIndexTopTimeAnnotation(): void {
      const ann = this.indexTopTimeAnnotation;
      if (!ann || !this.wellLogWidget?.getVisibleDepthLimits) {
        return;
      }
      if (this.wellIndexType !== 'time') {
        ann.setText('');
        ann.invalidate(undefined, true);
        return;
      }
      const limits = this.wellLogWidget.getVisibleDepthLimits();
      if (!limits) {
        return;
      }
      const low = limits.getLow();
      const high = limits.getHigh();
      const span = Math.max(high - low, 1);
      const band = Math.min(Math.max(span * 0.09, 120000), span * 0.4);
      const text = this.indexDisplayMoment(low).format('M/D/YYYY HH:mm:ss');
      ann.setRect(new Rect(0, low, 1, low + band));
      ann.setText(text);
      ann.invalidate(undefined, true);
    }

    /**
     * Uses GeoToolkit built-in cross-hair tool and projects pointer Y to model index value.
     * For time-index widgets we expose formatted AST time in the tooltip header.
     */
    private configureCrossHair(): void {
      if (this.isCrossHairConfigured) {
        return;
      }
      try {
        const crossHair: any = this.wellLogWidget?.getToolByName?.('cross-hair');
        if (!crossHair) {
          return;
        }

        const handleCrossHairMove = (_evt: any, _sender: any, eventArgs: any) => {
            this.ngZone.run(() => {
              try {
                const position = eventArgs?.getPosition?.();
                if (!position || !this.wellLogWidget) {
                  this.tooltipData = {
                    depth: 0,
                    curveValues: [],
                    screenY: 0,
                    visible: false,
                  };
                  return;
                }

                let depth = Number.NaN;
                const modelPos = eventArgs?.getModelPosition?.();
                if (modelPos) {
                  depth = modelPos.getY ? modelPos.getY() : modelPos.y;
                }
                const limits = this.wellLogWidget.getVisibleDepthLimits?.();
                if (!Number.isFinite(depth)) {
                  const trackContainer = this.wellLogWidget.getTrackContainer();
                  const sceneTransform = trackContainer?.getSceneTransform?.();
                  if (!sceneTransform) {
                    return;
                  }
                  const pt = sceneTransform.inverseTransformPoint
                    ? sceneTransform.inverseTransformPoint(position)
                    : sceneTransform.transformPoint(position);
                  depth = pt?.getY ? pt.getY() : pt?.y;
                }
                if (!Number.isFinite(depth)) {
                  return;
                }

                const posY = position.getY ? position.getY() : position.y;
                let depthValue = Number(depth);
                if (limits) {
                  const low = limits.getLow();
                  const high = limits.getHigh();
                  const span = Math.max(1, high - low);
                  const clearlyOutOfRange =
                    depthValue < low - span * 2 || depthValue > high + span * 2;

                  // Fallback: map hover device Y linearly to current visible index range.
                  if (!Number.isFinite(depthValue) || clearlyOutOfRange) {
                    const trackContainer = this.wellLogWidget.getTrackContainer?.();
                    const deviceLimits = trackContainer?.getVisibleDeviceLimits?.();
                    const top =
                      deviceLimits?.getY?.() ??
                      deviceLimits?.getTop?.() ??
                      0;
                    const height =
                      deviceLimits?.getHeight?.() ??
                      Math.max(
                        1,
                        (deviceLimits?.getBottom?.() ?? top + 1) - top
                      );
                    const ratio = Math.max(
                      0,
                      Math.min(1, (posY - top) / Math.max(1, height))
                    );
                    depthValue = low + ratio * span;
                  }
                }
                const curveValues: TooltipCurveValue[] = [];
                const hoverMoment = this.indexDisplayMoment(depthValue);
                const hoverTimeText = hoverMoment.isValid()
                  ? hoverMoment.format('M/D/YYYY HH:mm:ss')
                  : '-';

                this.tooltipData = {
                  depth: depthValue,
                  indexLabel: this.wellIndexType === 'time' ? 'Time' : 'Depth',
                  indexText:
                    this.wellIndexType === 'time'
                      ? hoverTimeText
                      : undefined,
                  indexUnit: this.wellIndexType === 'time' ? '' : 'm',
                  curveValues,
                  screenY: posY,
                  visible: true,
                };
              } catch {
                // Never let tooltip failures affect interaction.
              }
            });
          };

        // Bind both enum and raw event name for compatibility across toolkit builds.
        crossHair.on(CrossHairEvents.onPositionChanged, handleCrossHairMove);
        crossHair.on('onPositionChanged', handleCrossHairMove);
        this.isCrossHairConfigured = true;
      } catch {
        // CrossHair might be unavailable for some tool setups; keep silent.
      }
    }

    /**
     * Fallback hover tracking independent from cross-hair events.
     * Keeps tooltip time synced with mouse movement over the track container.
     */
    private attachMouseHoverTooltipTracking(): void {
      if (this.isMouseHoverTooltipConfigured) {
        return;
      }
      const container = this.trackContainer?.nativeElement as HTMLElement | undefined;
      if (!container) {
        return;
      }
      container.addEventListener('mousemove', this.onTrackMouseMove);
      container.addEventListener('mouseleave', this.onTrackMouseLeave);
      this.isMouseHoverTooltipConfigured = true;
    }

    private detachMouseHoverTooltipTracking(): void {
      if (!this.isMouseHoverTooltipConfigured) {
        return;
      }
      const container = this.trackContainer?.nativeElement as HTMLElement | undefined;
      if (container) {
        container.removeEventListener('mousemove', this.onTrackMouseMove);
        container.removeEventListener('mouseleave', this.onTrackMouseLeave);
      }
      this.isMouseHoverTooltipConfigured = false;
    }

    private readonly onTrackMouseMove = (evt: MouseEvent): void => {
      if (!this.wellLogWidget || this.wellIndexType !== 'time') {
        return;
      }
      const limits = this.wellLogWidget.getVisibleDepthLimits?.();
      const container = this.trackContainer?.nativeElement as HTMLElement | undefined;
      if (!limits || !container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const y = evt.clientY - rect.top;
      const ratio = Math.max(0, Math.min(1, y / Math.max(1, rect.height)));
      const low = limits.getLow();
      const high = limits.getHigh();
      const depthValue = low + ratio * Math.max(1, high - low);
      const hoverMoment = this.indexDisplayMoment(depthValue);
      const hoverTimeText = hoverMoment.isValid()
        ? hoverMoment.format('M/D/YYYY HH:mm:ss')
        : '-';

      this.ngZone.run(() => {
        this.tooltipData = {
          depth: depthValue,
          indexLabel: 'Time',
          indexText: hoverTimeText,
          indexUnit: '',
          curveValues: [],
          screenY: y,
          visible: true,
        };
      });
    };

    private readonly onTrackMouseLeave = (): void => {
      this.ngZone.run(() => {
        if (!this.tooltipData) {
          return;
        }
        this.tooltipData = {
          ...this.tooltipData,
          visible: false,
        };
      });
    };
  
    /**
     * Datasource callback hook: call when a lazy-load request starts.
     */
    public notifyFetchStart(): void {
      this.activeFetchCount++;
      if (this.activeFetchCount < 0) this.activeFetchCount = 0;
      this.isLoadingChunk = this.activeFetchCount > 0;
      this.updateLoadingIndexDepthLabel();
    }
  
    /**
     * Datasource callback hook: call when a lazy-load request ends.
     */
    public notifyFetchEnd(): void {
      this.activeFetchCount = Math.max(0, this.activeFetchCount - 1);
      this.isLoadingChunk = this.activeFetchCount > 0;
      if (this.isLoadingChunk) {
        this.updateLoadingIndexDepthLabel();
      }
    }
  
    private updateLoadingIndexDepthLabel(): void {
      const limits: any = this.wellLogWidget?.getVisibleDepthLimits?.();
      if (!limits) {
        this.loadingIndexDepthLabel = '-';
        return;
      }
  
      const indexDepth = limits.getHigh ? limits.getHigh() : 0;
      this.loadingIndexDepthLabel =
        this.wellIndexType === 'time'
          ? this.indexDisplayMoment(indexDepth).format('DD/MM/YYYY HH:mm:ss')
          : indexDepth.toFixed(2);
    }
  
    // Declaring these static parameters for OpenCardConfiguration method using to Edit properties
    selectedHour: number = 4;
    selectedDepth: number = 500;
    hideHeader: boolean = false;
    swtichToTvd: boolean = false;
    showSurvey: boolean = false;
    isFitToheight: boolean = false;
    isAutoScroll: boolean = true;
    horizontalOrientaion: boolean = false;
    IntervalStep: number = 5;
    OpenCardConfiguration() {
      const dialogRef = this.dialog.open(AddDynamicTracksDialogComponent, {
        width: '700px',
        maxWidth: '95vw',
        height: '85vh',
        panelClass: 'custom-dialog-container',
        data: {
          lstOfTrack: JSON.parse(JSON.stringify(this.listOfTracks)), // ✅ deep copy
          selectedLog: this.selectedLog,
          wellboreObjects: this.wellboreObjects,
          lstTrackTypes: this.lstTrackTypes,
          lstLineStyle: this.lstLineStyle,
          anchorTypes: this.anchorTypes,
          selectedHour: this.selectedHour,
          lstHourss: this.lstHourss,
          selectedDepth: this.selectedDepth,
          hideHeader: this.hideHeader,
          swtichToTvd: this.swtichToTvd,
          showSurvey: this.showSurvey,
          isFitToheight: this.isFitToheight,
          isAutoScroll: this.isAutoScroll,
          horizontalOrientaion: this.horizontalOrientaion,
          IntervalStep: this.IntervalStep,
        },
      });
  
      dialogRef.afterClosed().subscribe((result) => {
        if (!result) return; // ✅ Cancel
        this.listOfTracks = result.lstOfTrack;
        this.selectedLog = result.selectedLog;
        this.selectedHour = result.selectedHour;
        this.selectedDepth = result.selectedDepth;
        this.hideHeader = result.hideHeader;
        this.swtichToTvd = result.swtichToTvd;
        this.showSurvey = result.showSurvey;
        this.isFitToheight = result.isFitToheight;
        this.isAutoScroll = result.isAutoScroll;
        this.horizontalOrientaion = result.horizontalOrientaion;
        this.IntervalStep = result.IntervalStep;
        const logplotWidget = { ...this.widget, content: result.tracksList };
        this.mockupService.setLogplotData(logplotWidget);
        this.createSceneWithData();
      });
    }
  }
  