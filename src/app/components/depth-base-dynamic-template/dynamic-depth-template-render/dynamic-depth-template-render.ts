import {
  Component,
  Input,
  input,
  OnInit,
  AfterViewInit,
  ViewChild,
  OnDestroy,
  NgZone,
  ElementRef,
  ChangeDetectorRef,
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

import { BaseWidgetComponent } from '../../../components/core/basewidget/basewidget.component';
import {
  CrossTooltipComponent,
  CrossTooltipData,
  TooltipCurveValue,
} from '../cross-tooltip/cross-tooltip.component';
import { AddDynamicTracksDialogComponent } from '../add-dynamic-tracks-dialog/add-dynamic-tracks-dialog.component';
import {
  PrintPropertiesDialogComponent,
  PrintPropertiesData,
  PrintPropertiesResult,
} from '../../../components/core/basewidget/print-properties-dialog/print-properties-dialog.component';
import {
  SmartRemoteLogCurveDataSource,
  INDEX_DISPLAY_UTC_OFFSET_MINUTES,
  INITIAL_VIEW_RANGE_MS,
  INITIAL_VIEW_RANGE_DEPTH,
} from './data/remotedatasource';

import { WellDataService } from '../../../service/well-service/well.service';
import { WellLogCategoryCode } from '../../../service/well-service/well-log-category-code';
import { WellLogMnemonicsList } from '../../../service/well-service/well-log-mnemonics-list';
import { LogHeadersService } from '../../../service/log-headers.service';
import { StaticTemplateSharedService } from '../../staticTemplate/static-template-shared-service';
import { Observable, forkJoin, of, Subject, fromEvent } from 'rxjs';
import {
  catchError,
  map,
  debounceTime,
  mergeWith,
  takeUntil,
  take,
  mergeMap,
  tap,
  delay,
} from 'rxjs/operators';
import { PatternFactory } from '@int/geotoolkit/attributes/PatternFactory';
import { AdaptiveTickGenerator } from '@int/geotoolkit/axis/AdaptiveTickGenerator';
import { AnchorType } from '@int/geotoolkit/util/AnchorType';
import { Rect } from '@int/geotoolkit/util/Rect';
import { NodeOrder } from '@int/geotoolkit/scene/CompositeNode';
import moment from 'moment';
import { LogCurveDataSource } from '@int/geotoolkit/welllog/data/LogCurveDataSource';
import { RequestOrchestrator } from './engine/request.orchestrator';
import { ViewportEngine } from './engine/viewport.engine';
import {
  DynamicTemplateRendererUtils,
  wellSignal,
  listOfTracksSignal,
  wellboreSignal,
  startIndexSignal,
  endIndexSignal,
  fetchingData,
  fetchingDataString,
  queryParam,
} from './dynamic-template-renderer.utils';

import { ITracks, Curve } from '../../../models/chart/tracks';
import {
  IWellLogDataUnifiedQueryParameter,
  IWellLogDataUnified,
  IWellLogDataUnifiedData,
  IWellboreObject,
  RawSensor,
  IWellLogFetchNextDataParameter,
} from '../../../models/wellbore/wellbore-object';
import { TrackCurve } from '../../../models/wellbore/dynamic-template-render';
import { ILinePattern } from '../../../models/chart/linePattern';
import { MockupService } from '../../../designer-dashboard/services/mockup.service';

import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { CompositeLog2DVisualHeader } from '@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader';
import { Log2DVisual, PlotTypes } from '@int/geotoolkit/welllog/Log2DVisual';
import { TextStyle } from '@int/geotoolkit/attributes/TextStyle';
import { LogAxis } from '@int/geotoolkit/welllog/LogAxis';
import { LogVisualHeaderProvider } from '@int/geotoolkit/welllog/header/LogVisualHeaderProvider';
import {
  LogAxisVisualHeader,
  HeaderType,
} from '@int/geotoolkit/welllog/header/LogAxisVisualHeader';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { Log2DVisualData } from '@int/geotoolkit/welllog/data/Log2DVisualData';
import { Log2DDataRow } from '@int/geotoolkit/welllog/data/Log2DDataRow';
import { DefaultColorProvider } from '@int/geotoolkit/util/DefaultColorProvider';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { Orientation } from '@int/geotoolkit/util/Orientation';
import { StackedLogFill } from '@int/geotoolkit/welllog/StackedLogFill';
import {
  DiscreteStackedFillVisualHeader,
  BoxVisibility,
} from '@int/geotoolkit/welllog/header/DiscreteStackedFillVisualHeader';
import { DiscreteFillDisplayType } from '@int/geotoolkit/welllog/header/AdaptiveDiscreteFillVisualHeader';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
import { IndexType as GeoIndexType } from '@int/geotoolkit/welllog/IndexType';
import { InterpolationType } from '@int/geotoolkit/data/DataStepInterpolation';

import {
  Events as PanningEvents,
  Panning,
} from '@int/geotoolkit/controls/tools/Panning';
import { PanningEventArgs } from '@int/geotoolkit/controls/tools/PanningEventArgs';
import { Events as AbstractScrollEvents } from '@int/geotoolkit/controls/tools/scroll/AbstractScroll';
import { Patterns } from '@int/geotoolkit/attributes/LineStyle';
import { Range } from '@int/geotoolkit/util/Range';
import { LogAnnotation } from '@int/geotoolkit/welllog/LogAnnotation';
import { Events as WellLogWidgetEvents } from '@int/geotoolkit/welllog/widgets/Events';
import { AdaptiveDateTimeTickGenerator } from '@int/geotoolkit/axis/AdaptiveDateTimeTickGenerator';
import { Subscription } from 'rxjs';
import { DepthSymbolType } from '../symbols';
import {
  FillMode,
  LogMudLogSection,
  SymbolPosition,
  TextOrientation,
  WrapMode,
} from '@int/geotoolkit/welllog/LogMudLogSection';
import { SvgPainter } from '@int/geotoolkit/svg/SvgPainter';
import { from } from '@int/geotoolkit/selection/from';
import { AbstractNode } from '@int/geotoolkit/scene/AbstractNode';
import { SymbolShape } from '@int/geotoolkit/scene/shapes/SymbolShape';
import { TemplateCloneDialogComponent } from '../../../components/template-clone-dialog/template-clone-dialog.component';
import { TemplateService } from '../../../service/template.service';
import { LoaderService } from '../../../service/loader.service';
import { SnackBarService } from '../../../service/snack-bar.service';
import { Store } from '@ngrx/store';
import { loadTemplateSuccess } from '../../../store/actions/well-log-template.action';
import { selectTemplateBykey } from '../../../store/selectors/well-log-template.selectors';

// Interface for log data item
interface LogDataItem {
  depth: number;
  values: number[];
  angles: number[];
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

export interface QueryParam {
  logId: string;
  code: string;
  mnemonics: string[];
}

@Component({
  selector: 'app-dynamic-depth-template-render',
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
  templateUrl: './dynamic-depth-template-render.html',
  styleUrl: './dynamic-depth-template-render.scss',
})
export class DynamicDepthTemplateRender
  implements OnInit, AfterViewInit, OnDestroy
{
  /** Array of track configurations to display */
  @Input() listOfTracks: ITracks[] = [];
  /** Unique identifier for the well */
  @Input() well: string = '';
  /** Unique identifier for the wellbore */
  @Input() wellbore: string = '';
  /** Index type: 'depth' or 'time' */
  @Input() wellIndexType: 'depth' | 'time' = 'depth';
  @Input() categoryCode?: string = '';
  @Input() callingFrom?: string = '';
  @Input() template: any;

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

  /** GeoToolkit WellLogWidget instance for rendering tracks and curves */
  private wellLogWidget!: WellLogWidget;
  /** Refresh index header and top time annotation when the visible window changes (scroll / zoom). */
  private readonly onVisibleDepthLimitsForHeaderRefresh = (): void => {
    this.syncIndexTopTimeAnnotation();
    this.wellLogWidget?.updateLayout();
  };
  private depthMnemonics = ['DEPTH', 'MD', 'TVD', 'BITDEPTH', 'MWD_Depth'];
  /** Flag indicating if the component view is ready */
  private sceneReady = false;
  private requestOrchestrator!: RequestOrchestrator;
  private viewportEngine!: ViewportEngine;
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
  public isFirstTimeLoading = true;
  /** Canvas theme flag  */
  public isDarkTheme = true;
  plot: any;
  windowResize: boolean = false;
  private subscriptions: Subscription[] = [];
  surveyMarker: any;
  private destroy$ = new Subject();
  fetchingData = fetchingData;
  fetchingDataString = fetchingDataString;
  /** Currently selected depth scale value */
  selectedScale: number = 1000;
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
  ];
  lstLineStyle: ILinePattern[] = [
    { name: Patterns.Solid, style: '___________' },
    { name: Patterns.Dash, style: '---------------' },
    { name: Patterns.Dot, style: '.....................' },
  ];
  anchorTypes: string[] = ['None', 'Left', 'Right', 'Center'];
  lstHourss: number[] = [24, 12, 6, 4, 2, 1];
  isCrossHairConfigured: boolean = false;
  isMouseHoverTooltipConfigured: any;
  storeSessionID: Map<string, string> = new Map();
  firstPageLoadData: { [category: string]: IWellLogDataUnified } = {};
  horizontalOrientaion: boolean = false;
  private autoWidthTracks: LogTrack[] = [];
  private indexTrackRef: LogTrack | null = null;
  /**
   * Creates an instance of GenerateCanvasTracksComponent.
   * @param logHeadersService - Service for fetching log headers and data
   */
  constructor(
    private logHeadersService: LogHeadersService,
    private wellLogData: WellDataService,
    private wellLogCategoryCode: WellLogCategoryCode,
    private wellLogMnemonicsList: WellLogMnemonicsList,
    private dialog: MatDialog,
    private ngZone: NgZone,
    private mockupService: MockupService,
    private http: HttpClient,
    private staticTemplateSharedService: StaticTemplateSharedService,
    private templateService: TemplateService,
    private loaderService: LoaderService,
    private snackBarService: SnackBarService,
    private store: Store,
    private cdr: ChangeDetectorRef
  ) {}

  /**
   * Angular lifecycle hook called after component initialization.
   * Initiates the process of loading log headers and creating tracks.
   */
  ngOnInit(): void {
    this.registerLithologyPatterns();
  }

  /**
   * Angular lifecycle hook called after the component view has been initialized.
   * Sets the scene ready flag and waits for data to load before creating scene.
   */
  ngAfterViewInit(): void {
    this.horizontalOrientaion =
      this.staticTemplateSharedService.horizontalOrientation;
    this.wellLogData.getDirectionalSvg().subscribe((response) => {
      this.directionalSVG = response;
    });
    listOfTracksSignal.set(this.listOfTracks);
    wellSignal.set(this.well);
    wellboreSignal.set(this.wellbore);
    queryParam.set(
      DynamicTemplateRendererUtils.createQueryParams(
        this.wellLogCategoryCode,
        this.depthMnemonics
      )
    );
    this.processLogHeaders();
    if (this.isLivePolling) {
      this.startLivePolling();
    }
    this.sceneReady = true;
    console.log('🔧 Scene ready - waiting for data to load');
    this.setupResizeHandler();
  }

  /**
   * Angular lifecycle hook called before component destruction.
   * Cleans up all subscriptions to prevent memory leaks.
   */
  ngOnDestroy(): void {
    this.subscriptions.forEach((subscription) => {
      if (subscription) {
        subscription.unsubscribe();
      }
    });
    this.destroy$.next(null);
    this.destroy$.complete();
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
      const widget = this.widgetComponent.Widget;
      if (!widget || this.isFirstTimeLoading) {
        return;
      }
      this.viewportEngine.init(
        this.well,
        this.wellbore,
        this.headerMinDepth.toString(),
        this.headerMaxDepth.toString()
      );
      this.wellLogWidget.setVisibleDepthLimits(
        this.headerMinDepth,
        this.headerMaxDepth
      );
      this.applyEqualTrackWidths();
      this.wellLogWidget.updateLayout();
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

  /**
   * Processes loaded log headers and initiates data loading.
   * Groups curves by LogId to avoid duplicate API calls — one call per unique LogId.
   *
   * @param headers - Array of loaded log headers
   * @private
   */
  private async processLogHeaders(): Promise<void> {
    const minIndex = 0;
    const maxIndex = 1000;

    if (minIndex < this.headerMinDepth) this.headerMinDepth = minIndex;
    if (maxIndex > this.headerMaxDepth) this.headerMaxDepth = maxIndex;

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
        'assets/data/mudLogData.json'
      )
      .pipe(
        map((mudLogData) => {
          // Keep full {depth, value} objects so parseMudLogData can extract lithology codes.
          curve.data = mudLogData;
          const entry = this.curveMap.get(curve.mnemonicId);
          if (entry && entry.logCurve instanceof StackedLogFill) {
            //  console.log( `🔄 Reactively updating MudLog visual for ${curve.displayName}`);
            this.wellLogWidget?.updateLayout();
          }
          return curve.data;
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
      this.isCrossHairConfigured = false;
      this.autoWidthTracks = [];
      this.indexTrackRef = null;
      // Create WellLogWidget for Time-based display
      this.wellLogWidget = new WellLogWidget({
        indextype: GeoIndexType.Depth,
        indexunit: 'm',
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
      const handleScroll = () => {
        const depthLimits = this.wellLogWidget.getVisibleDepthLimits();
        startIndexSignal.set(Math.round(depthLimits.getLow()).toString());
        endIndexSignal.set(Math.round(depthLimits.getHigh()).toString());
        indexTrack.removeChild(this.surveyMarker);
        this.surveyMarker = this.AddSurveyMarker();
        indexTrack.addChild(this.surveyMarker);
        this.isLoadingChunk = true;
        this.viewportEngine = new ViewportEngine(
          this.widgetComponent.Widget,
          this.requestOrchestrator
        );
        this.viewportEngine.init(
          this.well,
          this.wellbore,
          startIndexSignal(),
          endIndexSignal()
        );
      };
      const panningEnd$ = fromEvent(
        this.wellLogWidget.getToolByName('TrackPanning'),
        PanningEvents.onPanningEnd
      );
      const scrollEnd$ = fromEvent(
        this.wellLogWidget.getToolByName('TrackPlotVerticalScroll'),
        AbstractScrollEvents.onScrollEnd
      );
      const debouncedHandleScroll$ = panningEnd$.pipe(
        mergeWith(scrollEnd$),
        debounceTime(1000)
      );

      debouncedHandleScroll$.subscribe(() => handleScroll());

      this.wellLogWidget.getToolByName('rubberband').setEnabled(true);
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
      this.logHeadersService.applyGeoToolkitTheme(
        this.wellLogWidget,
        this.isDarkTheme
      );
      headerProvider.registerHeaderProvider(
        Log2DVisual.getClassName(),
        log2DHeader
      );
      // Mirror MudLogComponent: register the discrete-stacked legend so MudLog tracks
      // get a proper category header (lithology swatches + labels) instead of a blank band.
      headerProvider.registerHeaderProvider(
        StackedLogFill.getClassName(),
        new DiscreteStackedFillVisualHeader()
          .setDiscreteDisplayType(DiscreteFillDisplayType.FlexBox)
          .setBoxVisibility(BoxVisibility.Visible)
      );
      const INDEX_HEADER_TEXT_STYLE = new TextStyle({
        color: 'white',
      });
      // Index axis header: template name + visible span + date (no default "1: in: ..." scale line)
      this.applyCustomLogAxisStyle(headerProvider, INDEX_HEADER_TEXT_STYLE);
      // Create index track first to ensure it's always visible
      const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
      const indexCfg = this.listOfTracks.find((tr) => tr.isIndex);
      const indexColWidth = indexCfg?.trackWidth ?? 150;
      indexTrack.setWidth(indexColWidth);
      this.indexTrackRef = indexTrack;
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
      this.indexTopTimeAnnotation = new LogAnnotation(new Rect(0, 0, 1, 1), '')
        .setTextStyle(new TextStyle({ color: 'white' }))
        //.setFillStyle('rgba(15, 23, 42, 0.88)')
        .setTextPosition(AnchorType.TopCenter)
        .setFixedHeight(false);
      indexTrack.addChild(this.indexTopTimeAnnotation);
      indexTrack.changeChildOrder(this.indexTopTimeAnnotation, NodeOrder.Last);
      this.requestOrchestrator = new RequestOrchestrator(
        this.wellLogData,
        this.curveMapStore,
        this.staticTemplateSharedService,
        { parent: this }
      );
      if (queryParam() && queryParam().length > 0) {
        const apiCalls = queryParam()
          .filter((param: QueryParam | null) => param !== null)
          .map((param: QueryParam) => {
            const key = this.createKey(
              this.well,
              this.wellbore,
              this.callingFrom ? this.callingFrom : 'Data',
              param.code
            );
            let queryParameter: IWellLogDataUnifiedQueryParameter = {
              well: this.well,
              wellbore: this.wellbore,
              category: param.code,
              requestedMnemonics: param.mnemonics,
              pageSize:
                this.selectedScale !== 0
                  ? this.selectedScale
                  : Math.round(this.headerMaxDepth),
            };
            return this.store.select(selectTemplateBykey(key)).pipe(
              take(1),
              mergeMap((cachedData: any) => {
                if (cachedData) {
                  return of({
                    ...cachedData,
                    fromCache: true,
                    categoryCode: param.code,
                  }).pipe(
                    delay(100),
                    tap(() => {
                      this.isFirstTimeLoading = false;
                      this.cdr.detectChanges();
                    })
                  );
                } else {
                  return this.wellLogData
                    .getLogDataUnified(queryParameter)
                    .pipe(
                      tap((result: IWellLogDataUnified | null | any) => {
                        if (result) {
                          if (result?.code) {
                            return;
                          }
                          this.store.dispatch(
                            loadTemplateSuccess({
                              key,
                              data: result,
                            })
                          );
                        }
                      }),
                      catchError((error: any) => {
                        console.log(
                          `Error occurred for logId: ${param.logId}`,
                          error
                        );
                        return of(null); // Return null if an error occurs
                      })
                    );
                }
              })
            );
          });
        const subscription = forkJoin(apiCalls).subscribe({
          next: (results: (IWellLogDataUnified | null)[]) => {
            const sessionIds = new Map<string, string>();
            let minDepth = 0;
            let maxDepth = 0;
            results.forEach(
              (result: IWellLogDataUnified | null | any, index: number) => {
                if (result?.code) {
                  return;
                }
                if (result) {
                  const category = queryParam()?.[index]?.code;
                  if (category) {
                    sessionIds.set(category, result.SessionId);
                    if (result.Header.MinIndex < minDepth) {
                      minDepth = result.Header.MinIndex;
                    }
                    if (result.Header.MaxIndex > maxDepth) {
                      maxDepth = result.Header.MaxIndex;
                    }
                    this.firstPageLoadData[category] = result;
                    this.requestOrchestrator.setSession(
                      category,
                      result.SessionId
                    );
                  }
                }
              }
            );
            this.storeSessionID = sessionIds;
            this.headerMinDepth = minDepth;
            this.headerMaxDepth = maxDepth;
            this.wellLogWidget?.setDepthLimits(
              this.headerMinDepth,
              this.headerMaxDepth
            );
            const scrollTarget = this.headerMaxDepth;
            const defaultViewRange = INITIAL_VIEW_RANGE_DEPTH;
            const viewScale =
              this.selectedScale > 0 ? this.selectedScale : defaultViewRange;
            const recentStart = Math.max(
              this.headerMinDepth,
              scrollTarget - viewScale
            );
            this.createTracks();
            this.applyEqualTrackWidths();
            results.forEach(
              (result: IWellLogDataUnified | null | any, index: number) => {
                if (result?.code) {
                  return;
                }
                if (result) {
                  const category = queryParam()?.[index]?.code;
                  if (category) {
                    this.requestOrchestrator.processInitial(category, result);
                    this.viewportEngine = new ViewportEngine(
                      this.widgetComponent.Widget,
                      this.requestOrchestrator
                    );
                  }
                }
              }
            );
            if (
              startIndexSignal() !== '' &&
              minDepth > Number(startIndexSignal())
            ) {
              this.headerMinDepth = Number(startIndexSignal());
              this.wellLogWidget?.setDepthLimits(
                this.headerMinDepth,
                this.headerMaxDepth
              );
            }
            // console.log( `📏 Setting initial viewport: ${new Date(recentStart).toISOString()} to ${new Date(scrollTarget).toISOString()}`);
            this.wellLogWidget.setVisibleDepthLimits(recentStart, scrollTarget);
            endIndexSignal.set(scrollTarget.toString());
            // Force an initial layout update to ensure horizontal factor fitting
            this.wellLogWidget.updateLayout();
          },
          error: (error: Error) => {
            this.isFirstTimeLoading = false;
            console.log(
              '❌ Error loading log data for LogId:',
              this.categoryCode,
              error
            );
          },
          complete: () => {
            this.isFirstTimeLoading = false;
            this.surveyMarker = this.AddSurveyMarker();
            indexTrack.addChild(this.surveyMarker);
          },
        });
        this.subscriptions.push(subscription);
      }
      // Create data tracks
      // Assign widget to BaseWidgetComponent
      this.ChangeOrientation();
      this.widgetComponent.Widget = this.wellLogWidget;
      const track = this.wellLogWidget
        .getChildren()
        .toArray()
        .find((child) => child.getSceneTransform);
      track?.on('visibleDepthLimitsChanged', () => {
        console.log('Viewport Changed');
      });
      this.wellLogWidget.on(
        WellLogWidgetEvents.VisibleDepthLimitsChanged,
        this.onVisibleDepthLimitsForHeaderRefresh
      );
      // Set depth limits, show recent data first, and configure crosshair + scroll listener
      // setTimeout(() => {
      try {
        const minTime = this.headerMinDepth;
        const maxTime = this.headerMaxDepth > 0 ? this.headerMaxDepth : 1000;
        //     console.log(`📊 Setting time limits: ${new Date(minTime).toISOString()} to ${new Date(maxTime).toISOString()}`);
        this.wellLogWidget.setDepthLimits(minTime, maxTime);
        // Show recent data (e.g. last 4 hours) or fit to height
        const scrollTarget = maxTime;
        const defaultViewRange = INITIAL_VIEW_RANGE_DEPTH;
        const viewScale =
          this.selectedScale > 0 ? this.selectedScale : defaultViewRange;
        const recentStart = Math.max(minTime, scrollTarget - viewScale);
        // console.log( `📏 Setting initial viewport: ${new Date(recentStart).toISOString()} to ${new Date(scrollTarget).toISOString()}`);
        if (this.selectedScale === 0) {
          this.wellLogWidget.setVisibleDepthLimits(recentStart, scrollTarget);
          this.wellLogWidget.fitToHeight();
        } else {
          this.wellLogWidget.setVisibleDepthLimits(recentStart, scrollTarget);
        }
        // Force an initial layout update to ensure horizontal factor fitting
        this.wellLogWidget.updateLayout();
        this.syncIndexTopTimeAnnotation();
        // Configure crosshair for tooltip
        this.configureCrossHair();
        this.attachMouseHoverTooltipTracking();
        //        console.log('✅ Scene created with data successfully');
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
      this.viewportEngine.init(
        this.well,
        this.wellbore,
        minDepth.toString(),
        maxDepth.toString()
      );
      this.wellLogWidget.setVisibleDepthLimits(minDepth, maxDepth);
      this.wellLogWidget.fitToHeight();
    } else {
      // Set visible range based on scale
      const visibleRange = Math.min(scale, maxDepth - minDepth);
      const scrollStart = Math.max(minDepth, maxDepth - visibleRange);
      this.viewportEngine.init(
        this.well,
        this.wellbore,
        scrollStart.toString(),
        maxDepth.toString()
      );
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
    this.viewportEngine.init(
      this.well,
      this.wellbore,
      (center - newRange / 2).toString(),
      (center + newRange / 2).toString()
    );
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
    this.viewportEngine.init(
      this.well,
      this.wellbore,
      start.toString(),
      end.toString()
    );
    this.wellLogWidget.setVisibleDepthLimits(start, end);
    this.wellLogWidget.updateLayout();
    // console.log('🔍 Zoomed Out:', start.toFixed(1), '-', end.toFixed(1));
  }
  resetView(): void {
    // console.log('🔄 Resetting view to default scale (1:1000)');
    console.log(this.selectedScale);
    this.selectedScale = this.scaleOptions[3].value;
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
        this.pollLatestChanges();
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

  private pollLatestChanges(): void {
    const limits = this.wellLogWidget.getVisibleDepthLimits();
    if (limits.getHigh() >= this.headerMaxDepth) {
      const startIndex = limits.getLow();
      const endIndex = limits.getHigh() + this.CHUNK_SIZE;
      this.viewportEngine.init(
        this.well,
        this.wellbore,
        limits.getHigh().toString(),
        endIndex.toString()
      );
      const endIndexValue = Number(endIndexSignal());
      this.wellLogWidget.setVisibleDepthLimits(startIndex, endIndexValue);
      this.wellLogWidget.updateLayout();
    }
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
        //   console.log( `📊 Creating track ${trackIndex + 1}: ${trackInfo.trackName}`);
        let track: LogTrack;
        if (trackInfo.isIndex) {
          // Skip index track creation - it's already created in createScene
          //     console.log('⚠️ Skipping index track creation - already created in createScene');
          return;
        } else if (trackInfo.trackType === 'MudLog') {
          // Create MudLog track using dedicated method
          track = this.createMudLogTrack(trackInfo);
        } else if (trackInfo.trackType === 'Log2D') {
          // Create Log2D track using dedicated method
          track = this.createLog2DTrack(trackInfo);
        } else {
          // Create regular track/Liner or LogTrack/logarithimic
          const trackType =
            trackInfo.trackType === 'Logarithimic'
              ? TrackType.LogTrack
              : TrackType.LinearTrack;
          track = this.wellLogWidget.addTrack(trackType);
          track.setName(trackInfo.trackName);
          // Converting pixel width to factor (weight) for proportional scaling
          (track as any).setLayoutStyle({
            factor: trackInfo.trackWidth || 130,
          });
        }
        this.autoWidthTracks.push(track);
        // Create curves for this track
        DynamicTemplateRendererUtils.configureTrackHeaderTitle(
          track,
          trackInfo,
          this.wellLogWidget
        );
        if (trackInfo.trackType === 'MudLog') {
          this.createMudLogCurves(track, trackInfo);
        } else if (trackInfo.trackType === 'Log2D') {
          this.createLog2DCurves(track, trackInfo);
        } else {
          this.newCreateTracks(track, trackInfo);
        }
      } catch (error) {
        console.error(`❌ Error creating track ${trackInfo.trackName}:`, error);
      }
    });
  }

  trajectoryUnits = [
    {
      mnemonicId: 'azi',
      unit: 'dega',
    },
    {
      mnemonicId: 'incl',
      unit: 'dega',
    },
    {
      mnemonicId: 'tvd',
      unit: 'ft',
    },
    {
      mnemonicId: 'dls',
      unit: 'dega/100ft',
    },
  ];
  curveMapStore = new Map<string, { trackType: string; ds: any }>();
  private newCreateTracks(track: LogTrack, trackInfo: ITracks): void {
    trackInfo.curves.forEach((curveInfo, curveIndex) => {
      if (!curveInfo.show) {
        //  console.warn(`⚠️ Skipping curve ${curveInfo.mnemonicId} - curve hidden`);
        return;
      }

      if (!curveInfo.data || curveInfo.data.length === 0) {
        //  console.log( `ℹ️ Creating empty curve header for ${curveInfo.mnemonicId} (no data)`);
      }
      let catergoryCode = this.wellLogCategoryCode.findLogCategoryListByLogId(
        curveInfo.LogId
      );
      if (trackInfo.trackType === 'Image') {
        const log2dData = new Log2DVisualData({
          name: curveInfo.mnemonicId.toUpperCase(),
        });
        if (catergoryCode) {
          const curveData = this.firstPageLoadData[catergoryCode].Data.find(
            (item) => item.RawMnemonic === curveInfo.mnemonicId.toUpperCase()
          );
          if (curveData) {
            curveData.Data.forEach((val) => {
              const rowValues = val.Value.toString().split(' ').map(Number);
              const angles = rowValues.map(
                (_: number, i: number) => (i * 360) / rowValues.length
              );
              log2dData
                .getRows()
                .push(new Log2DDataRow(Number(val.Index), rowValues, angles));
            });
          }
        }
        log2dData.updateLimits();
        const minVal =
          log2dData.getMinValue() === Infinity ? 0 : log2dData.getMinValue();
        const maxVal =
          log2dData.getMaxValue() === Infinity ? 0 : log2dData.getMaxValue();
        const delta = (maxVal - minVal) / 4;
        const colorProvider = new DefaultColorProvider()
          .addColor(minVal, '#FFFACD') // Lemon Chiffon (Lightest)
          .addColor(minVal + delta, '#FFD700') // Gold
          .addColor(minVal + 2 * delta, '#D2691E') // Chocolate
          .addColor(minVal + 3 * delta, '#8B4513') // Saddle Brown
          .addColor(maxVal, '#3B0000');
        const visual = new Log2DVisual();
        visual.setName(curveInfo.displayName);
        (visual as any).setData(log2dData);
        visual.setColorProvider(colorProvider);
        visual.setMicroPosition(0, 1);
        this.curveMapStore.set(curveInfo.mnemonicId.toUpperCase(), {
          trackType: trackInfo.trackType,
          ds: visual,
        });
        track.addChild(visual);
      } else {
        const ds = new LogCurveDataSource({
          name: curveInfo.mnemonicId.toUpperCase(),
        });

        this.curveMapStore.set(curveInfo.mnemonicId.toUpperCase(), {
          trackType: trackInfo.trackType,
          ds: ds,
        });
        const curve = new LogCurve(ds);
        curve.setLineStyle({
          color: curveInfo.color,
          width: curveInfo.lineWidth,
        });
        this.wellLogMnemonicsList
          .findMnemonicUnit(
            curveInfo.mnemonicId,
            catergoryCode ? catergoryCode : ''
          )
          .pipe(takeUntil(this.destroy$))
          .subscribe((unitVal) => {
            const unit = unitVal !== null ? unitVal : 'unitless';
            curve.setName(unit);
            const displayName = String(
              curveInfo.displayName || curveInfo.mnemonicId || ''
            ).trim();
            const normalizedUnit = (unit ?? '').trim();
            curve.setDescription(
              displayName
                ? `${displayName} (${normalizedUnit})`
                : normalizedUnit
            );
            // Set normalization limits if not auto scale
            if (
              !curveInfo.autoScale &&
              curveInfo.min !== undefined &&
              curveInfo.max !== undefined
            ) {
              curve.setNormalizationLimits(curveInfo.min, curveInfo.max);
            }
            track.addChild(curve);
          });
      }
    });
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
    this.logHeadersService.applyGeoToolkitTheme(
      this.wellLogWidget,
      this.isDarkTheme
    );
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

    // Mirror MudLogComponent: use TrackType.LogTrack so the StackedLogFill renders
    // its lithology bars and the discrete legend header on the track frame correctly.
    const mudLogTrack = this.wellLogWidget.addTrack(TrackType.LogTrack);
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
          const pattern =
            PatternFactory.getInstance().getPattern(
              this.LITHOLOGY_PATTERNS[i].pattern
            ) || undefined;
          stackedFill.setCurveOptions(i, {
            fillstyle: {
              pattern,
              color: this.LITHOLOGY_PATTERNS[i].color,
            },
            linestyle: this.LITHOLOGY_PATTERNS[i].color,
            // Mirror standalone MudLogComponent: fill only when a pattern is registered;
            // otherwise fall back to the line-only outline so empty assets do not produce a blank fill.
            displaymode: pattern ? ['line', 'fill'] : ['line'],
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
            const parts = (dataPoint as string).split(',');
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

  /**
   * Name for the time index track from static track list (`isIndex`), when present.
   */
  private getIndexTrackTitleFromTemplate(): string {
    const t = this.listOfTracks.find((tr) => tr.isIndex);
    return (t?.trackName && t.trackName.trim()) || 'Time';
  }

  /**
   * Visible span label for the index header (e.g. "4 hours"), aligned with scale presets when possible.
   */
  private formatVisibleTimeSpanLabel(spanMs: number): string {
    const preset = this.scaleOptions.find(
      (o) => o.value > 0 && Math.abs(o.value - spanMs) < 2000
    );
    if (preset) {
      return preset.label
        .replace(/\bHours\b/g, 'hours')
        .replace(/\bHour\b/g, 'hour')
        .replace(/\bMinutes\b/g, 'minutes')
        .replace(/\bMinute\b/g, 'minute');
    }
    const hours = spanMs / 3600000;
    if (hours >= 1) {
      const h = Math.round(hours * 100) / 100;
      return Number.isInteger(h)
        ? `${h} hour${h === 1 ? '' : 's'}`
        : `${hours.toFixed(1)} hours`;
    }
    const minutes = spanMs / 60000;
    if (minutes >= 1) {
      const m = Math.round(minutes);
      return `${m} minute${m === 1 ? '' : 's'}`;
    }
    const sec = Math.max(1, Math.round(spanMs / 1000));
    return `${sec} second${sec === 1 ? '' : 's'}`;
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
   * Applies LogAxis header used by the index track: custom 3-line header (no default time-scale line).
   */
  public applyCustomLogAxisStyle(
    headerProvider: LogVisualHeaderProvider,
    textStyle: TextStyle
  ) {
    // Get the current header for LogAxis
    const currentHeader = headerProvider.getHeaderProvider(
      LogAxis.getClassName()
    ) as LogAxisVisualHeader | null;

    if (currentHeader) {
      // Clone, apply style, and re-register
      const styledHeader = currentHeader
        .clone()
        .setTextStyle(textStyle)
        .setDisplayValueTextStyle(textStyle);
      headerProvider.registerHeaderProvider(
        LogAxis.getClassName(),
        styledHeader
      );
    } else {
      console.warn('No LogAxisVisualHeader found to style.');
    }
  }
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
    this.loadingIndexDepthLabel = indexDepth.toFixed(2);
  }

  // Declaring these static parameters for OpenCardConfiguration method using to Edit properties
  selectedHour: number = 4;
  selectedDepth: number = 500;
  hideHeader: boolean = false;
  swtichToTvd: boolean = false;
  showSurvey: boolean = false;
  isFitToheight: boolean = false;
  isAutoScroll: boolean = true;
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
                indexLabel: this.wellIndexType === 'time' ? 'Time' : 'Depth',
                indexText: undefined,
                indexUnit: this.wellIndexType === 'time' ? '' : 'm',
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
                  deviceLimits?.getY?.() ?? deviceLimits?.getTop?.() ?? 0;
                const height =
                  deviceLimits?.getHeight?.() ??
                  Math.max(1, (deviceLimits?.getBottom?.() ?? top + 1) - top);
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
              depth:
                this.wellIndexType === 'time' ? hoverMoment.unix() : depthValue,
              indexLabel: this.wellIndexType === 'time' ? 'Time' : 'Depth',
              indexText:
                this.wellIndexType === 'time'
                  ? hoverTimeText
                  : `${depthValue.toFixed(1)} m`,
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
    const container = this.trackContainer?.nativeElement as
      | HTMLElement
      | undefined;
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
    const container = this.trackContainer?.nativeElement as
      | HTMLElement
      | undefined;
    if (container) {
      container.removeEventListener('mousemove', this.onTrackMouseMove);
      container.removeEventListener('mouseleave', this.onTrackMouseLeave);
    }
    this.isMouseHoverTooltipConfigured = false;
  }

  private readonly onTrackMouseMove = (evt: MouseEvent): void => {
    if (!this.wellLogWidget || this.wellIndexType !== 'depth') {
      return;
    }
    const limits = this.wellLogWidget.getVisibleDepthLimits?.();
    const container = this.trackContainer?.nativeElement as
      | HTMLElement
      | undefined;
    if (!limits || !container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const y = evt.clientY - rect.top;
    // Header band carries no depth context; suppress the pill while the cursor is over it.
    if (y < this.wellLogHeaderHeightPx) {
      if (this.tooltipData?.visible) {
        this.ngZone.run(() => {
          this.tooltipData = { ...this.tooltipData!, visible: false };
        });
      }
      return;
    }
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
        depth: this.wellIndexType === 'time' ? hoverMoment.unix() : depthValue,
        indexLabel: this.wellIndexType === 'time' ? 'Time' : 'Depth',
        indexText:
          this.wellIndexType === 'time'
            ? hoverTimeText
            : `${depthValue.toFixed(1)} m`,
        indexUnit: this.wellIndexType === 'time' ? '' : 'm',
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

  ChangeOrientation() {
    this.staticTemplateSharedService.horizontalOrientation =
      this.horizontalOrientaion;
    if (this.horizontalOrientaion) {
      this.wellLogWidget.setOrientation(Orientation.Horizontal);
    } else {
      this.wellLogWidget.setOrientation(Orientation.Vertical);
    }
  }
  /**
   * Explicitly split remaining width across all non-index tracks.
   * This is more reliable than factors alone when templates/tabs are shown
   * after GeoToolkit has already calculated layout.
   */
  private applyEqualTrackWidths(): void {
    const container = this.trackContainer?.nativeElement as
      | HTMLElement
      | undefined;
    if (!container || this.autoWidthTracks.length === 0) {
      return;
    }

    const containerWidth =
      container.getBoundingClientRect().width || container.clientWidth;
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
      return;
    }

    const indexWidth = this.indexTrackRef
      ? this.listOfTracks.find((track) => track.isIndex)?.trackWidth ?? 150
      : 0;
    const availableWidth = Math.max(1, containerWidth - indexWidth);
    const trackWidth = availableWidth / this.autoWidthTracks.length;

    this.autoWidthTracks.forEach((track) => {
      track.setWidth(trackWidth);
    });
  }

  AddSurveyMarker() {
    const visibleDepthLimits = this.wellLogWidget.getVisibleDepthLimits();
    const minDepth = visibleDepthLimits.getLow();
    const maxDepth = visibleDepthLimits.getHigh();

    let SurveyIncl: number[] = [];
    let md: number[] = [];
    let tvd: number[] = [];
    let data: any[] =
      this.staticTemplateSharedService.surveyData.trajectoryStation;
    let values: DepthSymbolType[] = [];
    let dpethSurvey: number[] = [];

    // Filter the survey data to only include points within the visible depth limits
    data = data.filter((val) => val.md >= minDepth && val.md <= maxDepth);

    data.forEach((val) => {
      SurveyIncl.push(Number(parseFloat(val.incl).toFixed(2)));
      md.push(val.md);
      tvd.push(val.tvd);
    });

    this.AddSurveyValues(md, dpethSurvey, values, SurveyIncl);

    const mudLog = new LogMudLogSection<DepthSymbolType>()
      .setFillMode(FillMode.SymbolOnly)
      .setSymbolPosition(SymbolPosition.Left)
      .setSymbolMarginsStyle({
        left: '2mm',
      })
      .setPaddingStyle('1mm')
      .setDepthsAndValues(dpethSurvey, values);

    // Cache the rendered survey markers
    const cachedSymbols: Record<number, SymbolShape> = {};

    mudLog.setSymbols((_modelTop: number, value: any, index: any) => {
      if (cachedSymbols[index]) {
        return cachedSymbols[index];
      }

      const svgPrototype = this.getSvgSymbolPrototype(
        value['symbol'],
        value['value']['direction']
      );
      if (svgPrototype == null || svgPrototype.getSvg() == null) {
        return null;
      }

      const symbolValue = value['value'];
      const properties: Record<string, any> = {};
      for (const name in symbolValue) {
        if (symbolValue.hasOwnProperty(name)) {
          const prop = symbolValue[name];
          properties[name] = {
            text: typeof prop === 'string' ? prop : prop.toFixed(1),
          };
        }
      }

      const SVGPainter = this.processTemplate(svgPrototype.clone(), properties);
      const symbol = this.getSVGSymbol(SVGPainter);
      cachedSymbols[index] = symbol;
      return symbol;
    });

    return mudLog;
  }

  AddSurveyValues(
    surveyData: number[],
    dpethSurvey: number[],
    values: DepthSymbolType[],
    SurveyIncl: any[]
  ) {
    surveyData.forEach((val, index) => {
      dpethSurvey.push(Math.round(val));
      values.push({
        symbol: 'directional',
        value: {
          direction: SurveyIncl[index],
        },
      });
    });
  }

  directionalSVG = '';

  getSvgSymbolPrototype(symbolType: string, angle: number) {
    let SVG_FILES: Record<string, string> = {
      directional: this.directionalSVG,
    };
    let angleCurve = angle / 10;
    let angleCurve1 = -1 * (angleCurve + 1);

    //if (this._symbolPrototypes[symbolType] == null) {
    let finalSVG = SVG_FILES[symbolType].replace('{angle}', '-' + angle);
    finalSVG = finalSVG.replaceAll('{angleCurve}', angleCurve.toString());
    finalSVG = finalSVG.replace('{angleCurve1}', angleCurve1.toString());
    const svgPainter = new SvgPainter({ xml: finalSVG });

    //  this._symbolPrototypes[symbolType] = svgPainter;
    //}

    return svgPainter;
  }

  processTemplate(painter: SvgPainter, json: Record<string, any>) {
    from(painter)
      .where((node) => node instanceof AbstractNode && node.getId() !== null)
      .execute((node) => {
        const properties = json[node.getId()];
        if (properties != null) {
          node.setProperties(properties);
        }
      });
    return painter;
  }

  getSVGSymbol(symbolXMl: string | SvgPainter, size?: number): SymbolShape {
    const svgPainter =
      symbolXMl instanceof SvgPainter ? symbolXMl : new SvgPainter(symbolXMl);
    const geometry: any = svgPainter.getGeometry();
    return new SymbolShape({
      cache: true,
      width: size || geometry.getModelLimits().getWidth(),
      height: size || geometry.getModelLimits().getHeight(),
      alignment: AnchorType.Center,
      sizeisindevicespace: true,
      painter: svgPainter,
    });
  }

  cloneToPrivate() {
    if (this.listOfTracks?.length) {
      const tracksList = this.listOfTracks.map((track: any) => {
        // if (!track.curves?.length) return [];
        return {
          ...track,
          comments: [],
          curves: track.curves.map((curve: any) => ({
            ...curve,
            LogId: curve.staticLogId ?? curve.LogId,
            data: [],
            mnemonicLst: [],
          })),
        };
      });
      let contentPayload: any = {
        tracksList,
      };
      contentPayload = JSON.stringify(contentPayload);
      this.openDialog(contentPayload);
    }
  }

  openDialog(contentPayload: any) {
    const dialogRef = this.dialog.open(TemplateCloneDialogComponent, {
      data: { templateName: '' },
      width: '350px',
      disableClose: true,
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (!result.templateName) {
        return;
      }
      if (result.templateName) {
        let parentTemplateName = this.callingFrom ?? '';
        this.loaderService.show();
        this.templateService
          .saveTemplates(
            result.templateName,
            parentTemplateName,
            contentPayload,
            'N'
          )
          .subscribe({
            next: (response) => {
              this.getUserSelectedDisplays();
            },
            error: (error) => {
              this.loaderService.hide();
            },
          });
      }
    });
  }

  updatePrivateDisplay(templateId: any) {
    if (this.listOfTracks?.length && templateId) {
      const tracksList = this.listOfTracks.map((track: any) => {
        // if (!track.curves?.length) return [];
        return {
          ...track,
          comments: [],
          curves: track.curves.map((curve: any) => ({
            ...curve,
            LogId: curve.staticLogId ?? curve.LogId,
            data: [],
            mnemonicLst: [],
          })),
        };
      });
      let contentPayload: any = {
        tracksList,
      };
      contentPayload = JSON.stringify(contentPayload);
      this.loaderService.show();
      this.templateService
        .updatePrivateTemplateContent(contentPayload, templateId)
        .subscribe({
          next: (response) => {
            this.getUserSelectedDisplays();
            this.snackBarService.open('Successfully updated template.');
          },
          error: (error) => {
            this.loaderService.hide();
            this.snackBarService.open('Template update failed.');
          },
        });
    }
  }

  getUserSelectedDisplays() {
    this.templateService.getUserSelectedDisplays().subscribe({
      next: (response) => {
        this.templateService.updateUserSelectedDisplays(response);
        this.loaderService.hide();
      },
      error: (error) => {
        this.loaderService.hide();
      },
    });
  }
  createKey(
    well: string,
    wellbore: string,
    template: string,
    categoryCode: string
  ): string {
    return `${well}_${wellbore}_${template}_${categoryCode}`;
  }

  private async waitForWidgetToLoad(): Promise<void> {
    while (!this.widgetComponent || !this.widgetComponent.Widget) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
