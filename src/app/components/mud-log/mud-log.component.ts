import { Component, OnInit, AfterViewInit, ViewChild, OnDestroy, NgZone, Input, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { CrossTooltipComponent, CrossTooltipData } from '../cross-tooltip/cross-tooltip.component';

// GeoToolkit Imports
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogMudLogSection } from '@int/geotoolkit/welllog/LogMudLogSection';
import { StackedLogFill } from '@int/geotoolkit/welllog/StackedLogFill';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { InterpolationType } from '@int/geotoolkit/data/DataStepInterpolation';
import { LogDataUtil } from '@int/geotoolkit/welllog/data/LogDataUtil';
import { Range } from '@int/geotoolkit/util/Range';
import { PatternFactory } from '@int/geotoolkit/attributes/PatternFactory';
import { LogData } from '@int/geotoolkit/welllog/data/LogData';
import { Navigation } from '@int/geotoolkit/welllog/widgets/tools/Navigation';
import { RemarksHighlight } from '@int/geotoolkit/welllog/widgets/tools/RemarksHighlight';
import { LineStyle } from '@int/geotoolkit/attributes/LineStyle';
import { Orientation } from '@int/geotoolkit/util/Orientation';
import { MathUtil } from '@int/geotoolkit/util/MathUtil';

// Header Imports
import { LogFill } from '@int/geotoolkit/welllog/LogFill';
import { LogAxis } from '@int/geotoolkit/welllog/LogAxis';
import { DiscreteStackedFillVisualHeader, BoxVisibility } from '@int/geotoolkit/welllog/header/DiscreteStackedFillVisualHeader';
import { DiscreteFillDisplayType } from '@int/geotoolkit/welllog/header/AdaptiveDiscreteFillVisualHeader';
import { LogTrackVisualHeader } from '@int/geotoolkit/welllog/header/LogTrackVisualHeader';
import { LogAxisVisualHeader, HeaderType as LogAxisHeaderType } from '@int/geotoolkit/welllog/header/LogAxisVisualHeader';
import { HeaderType } from '@int/geotoolkit/welllog/header/HeaderType';

@Component({
  selector: 'app-mud-log',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    BaseWidgetComponent,
    CrossTooltipComponent
  ],
  templateUrl: './mud-log.component.html',
  styleUrls: ['./mud-log.component.css']
})
export class MudLogComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() well: string = '';
  @Input() wellbore: string = '';

  @ViewChild('mainWidget') mainWidgetComponent!: BaseWidgetComponent;
  @ViewChild('navWidget') navWidgetComponent!: BaseWidgetComponent;

  isLoading = true;
  selectedScale = 1000;
  scaleOptions = [
    { label: '1:100', value: 100 },
    { label: '1:500', value: 500 },
    { label: '1:1,000', value: 1000 },
    { label: '1:5,000', value: 5000 },
    { label: 'Fit to Height', value: 0 }
  ];

  tooltipData: CrossTooltipData | null = null;

  private wellLogWidget!: WellLogWidget;
  private navigationWidget!: WellLogWidget;
  private navigationTool!: Navigation;
  private mudLogData: any[] = [];

  constructor(
    private http: HttpClient,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    console.log('💎 MudLog Component initialized');
    this.registerPatterns();
  }

  ngAfterViewInit(): void {
    this.initializeWidgets();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.wellLogWidget?.dispose();
    this.navigationWidget?.dispose();
  }

  private registerPatterns(): void {
    this.http.get('assets/data/lithologyPatterns.json').subscribe({
      next: (patterns: any) => {
        Object.keys(patterns).forEach((name) => {
          const img = new Image();
          img.onload = () => {
            PatternFactory.getInstance().addPattern(img, name);
            this.cdr.markForCheck(); // Safer than detectChanges
          };
          img.onerror = () => console.error(`❌ Failed to load pattern image: ${name}`);
          img.src = patterns[name];
        });
        console.log('🖼️ Lithology patterns registration started');
      },
      error: (err) => {
        console.error('❌ Failed to load patterns JSON:', err);
        this.cdr.detectChanges();
      }
    });
  }

  private initializeWidgets(): void {
    // 1. Create Main WellLog Widget
    this.wellLogWidget = new WellLogWidget({
      indextype: IndexType.Depth,
      indexunit: 'ft',
      horizontalscrollable: false,
      verticalscrollable: true,
      header: { visible: true, height: 100 },
      track: { header: { visibletracktitle: false } },
      trackcontainer: { border: { visible: true } }
    });
    this.mainWidgetComponent.Widget = this.wellLogWidget;

    // 2. Create Navigation Widget
    this.navigationWidget = new WellLogWidget({
        horizontalscrollable: false,
        verticalscrollable: false,
        trackcontainer: { border: { visible: false } },
        header: { visible: false },
        border: { visible: true }
    });
    this.navWidgetComponent.Widget = this.navigationWidget;

    // 3. Configure Layout
    this.wellLogWidget.setLayoutStyle({ left: 0, top: 0, right: 0, bottom: 0 });
    this.navigationWidget.setLayoutStyle({ left: 0, top: 0, right: 0, bottom: 0 });

    // 4. Configure Headers
    this.configureHeaders();

    // 5. Setup Tools
    this.configureTools();
  }

  private configureHeaders(): void {
    const headerProvider = this.wellLogWidget.getHeaderContainer().getHeaderProvider();
    
    // Register StackedLogFill Header for Legend
    headerProvider.registerHeaderProvider(
        StackedLogFill.getClassName(),
        new DiscreteStackedFillVisualHeader()
            .setDiscreteDisplayType(DiscreteFillDisplayType.FlexBox)
            .setBoxVisibility(BoxVisibility.Visible)
    );

    /* Re-enable Curve and Fill headers by not registering them as null */

    // Configure Track Header
    let trackVisualHeader = headerProvider.getHeaderProvider(LogTrack.getClassName()) as LogTrackVisualHeader;
    if (trackVisualHeader) {
        trackVisualHeader = trackVisualHeader.clone()
            .setAutoLabelRotation(false)
            .setShowEllipsis(true);
        headerProvider.registerHeaderProvider(LogTrack.getClassName(), trackVisualHeader);
    }

    // Customize Axis Header
    const logAxisHeader = new LogAxisVisualHeader({
        headertype: LogAxisHeaderType.Simple,
        labelrotationangle: Math.PI / 2
    });
    headerProvider.registerHeaderProvider(LogAxis.getClassName(), logAxisHeader);
  }

  private configureTools(): void {
    // Crosshair Tool
    const crossHair: any = this.wellLogWidget.getToolByName('cross-hair');
    if (crossHair) {
      crossHair.on('onPositionChanged', (evt: any, sender: any, eventArgs: any) => {
        this.ngZone.run(() => this.updateTooltip(eventArgs));
      });
    }

    // Remarks Highlight Tool
    if (crossHair) {
        const remarksTool: any = new RemarksHighlight(crossHair.getManipulatorLayer());
        remarksTool.on('onExpand', (evt: any, sender: any, eventArgs: any) => {
            console.log('Remarks highlighted:', eventArgs.getTextValue());
        });
        (this.wellLogWidget.getTool() as any).insert(0, remarksTool);
    }

    // Navigation Tool
    const navCrossHair: any = this.navigationWidget.getToolByName('cross-hair');
    if (navCrossHair) {
        this.navigationTool = new Navigation(navCrossHair.getManipulatorLayer());
        
        const adjustVisibleLimits = () => {
            const trackContainer: any = (this.wellLogWidget as any).getTrackContainer();
            if (!trackContainer) return;
            const trackLimits = trackContainer.getVisibleDeviceLimits();
            const parent = trackContainer.getParent();
            if (!parent) return;
            const availableSpace = parent.getVisibleDeviceLimits();
            if (this.wellLogWidget.getOrientation() === Orientation.Vertical) {
                if (availableSpace.getHeight() > (trackLimits.getHeight() + MathUtil.epsilon)) {
                    this.wellLogWidget.fitToHeight();
                }
            }
        };

        this.navigationTool
            .on('NavigationStart', adjustVisibleLimits)
            .on('NavigationEnd', adjustVisibleLimits)
            .on('DepthRangeChanged', (evt: any, sender: any, eventArgs: any) => {
                this.wellLogWidget.setVisibleDepthLimits(eventArgs.getLimits());
            });

        // VisibleDepthLimitsChanged
        this.wellLogWidget.on('VisibleDepthLimitsChanged', () => {
            this.navigationTool.setVisibleDepthLimits(this.wellLogWidget.getVisibleDepthLimits());
        });

        (this.navigationWidget as any).getTool().add(this.navigationTool);
    }
  }

  private loadData(): void {
    // isLoading is true by default now to avoid NG0100
    this.http.get<any[]>('assets/data/mudLogData.json').subscribe({
      next: (data) => {
        this.mudLogData = data;
        this.createComplexTracks();
        setTimeout(() => {
          this.isLoading = false;
          this.cdr.markForCheck();
        });
      },
      error: (err) => {
        console.error('❌ Error loading data:', err);
        setTimeout(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
          // Fallback to demo tracks even if data load fails
          this.createComplexTracks();
        });
      }
    });
  }

  private createComplexTracks(): void {
    // 1. Setup Depth Range
    const depthsStr = '11400,11401,13395'; // Simplified range
    const minDepth = 11400;
    const maxDepth = 13395;

    // 2. Add Tracks (Matching React Order)
    
    // Rate of Penetration
    this.addTrackWithCurve('Rate of Penetration 0-15 (min/Ft)', 200, '#DC143C', [0, 15], InterpolationType.MiddleStep);
    
    // Depth Track
    const depthTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    depthTrack.setWidth(60).setName('Depth (ft)');

    // Lithology Track
    this.addLogLithology(200);

    // MudLog Track
    this.addMudLogTrack(200);

    // POR, Fluor, CUT
    this.addTrackWithCurve('POR (0-25)', 70, '#DC143C', [0, 25], InterpolationType.MiddleStep);
    this.addTrackWithCurve('Fluor (0-100)', 70, '#FFA500', [0, 100], InterpolationType.MiddleStep);
    this.addTrackWithCurve('CUT (1-3)', 70, '#000000', [0, 3], InterpolationType.MiddleStep);

    // Total Gas
    this.addGasTrack(200);

    // 3. Setup Navigation Widget
    this.setupNavigationWidget(minDepth, maxDepth);

    // 4. Finalize Layout
    this.wellLogWidget.setDepthLimits(minDepth, maxDepth);
    this.wellLogWidget.setVisibleDepthLimits(minDepth, minDepth + 500);
    
    // Force a re-layout
    setTimeout(() => {
        this.wellLogWidget.updateLayout();
        this.navigationWidget.fitToHeight();
        this.navigationTool.setVisibleDepthLimits(this.wellLogWidget.getVisibleDepthLimits());
    }, 100);
  }

  private addTrackWithCurve(name: string, width: number, color: string, range: [number, number], interpolation?: any): void {
    const track = this.wellLogWidget.addTrack(TrackType.LogTrack);
    track.setName(name).setWidth(width);
    
    const curve = new LogCurve();
    // Simulate some data
    const depths: number[] = [];
    const values: number[] = [];
    for (let d = 11400; d <= 13400; d += 10) {
        depths.push(d);
        values.push(range[0] + Math.random() * (range[1] - range[0]));
    }
    const data = new LogData(name).setValues(depths, values);
    if (interpolation !== undefined) {
        // data.setInterpolationType(interpolation); // If supported in this version
    }
    curve.setData(data).setLineStyle(new LineStyle({ color: color, width: 1.5 }));
    track.addChild(curve);
  }

  private addLogLithology(width: number): void {
    const track = this.wellLogWidget.addTrack(TrackType.LogTrack);
    track.setName('Track # 1').setWidth(width);

    const categories = [
        { name: 'CHERT', color: 'crimson', pattern: 'chert' },
        { name: 'LIME', color: 'lightgreen', pattern: 'lime' },
        { name: 'DOLO', color: '#DDA0DD', pattern: 'dolomite' },
        { name: 'SALT', color: '#afeeee', pattern: 'salt' },
        { name: 'SAND', color: '#cf33e1', pattern: 'sand' },
        { name: 'SHALE', color: 'yellow', pattern: 'shale' }
    ];

    const depths: number[] = [];
    for (let d = 11400; d <= 13400; d += 20) depths.push(d);

    const dataSources = categories.map((cat, i) => {
        // Localize data to specific depth ranges to demonstrate adaptive header
        const start = 11400 + i * 300;
        const end = start + 400;
        const values = depths.map((d) => (d >= start && d <= end) ? 1 : 0);
        return new LogData(cat.name).setValues(depths, values);
    });

    const stackedFill = new StackedLogFill(dataSources);
    stackedFill.setInterpolationType(InterpolationType.EndStep);
    categories.forEach((cat, i) => {
        const pattern = PatternFactory.getInstance().getPattern(cat.pattern);
        (stackedFill as any).setCurveOptions(i, {
            'fillstyle': {
                'pattern': pattern ?? undefined,
                'color': cat.color
            },
            'linestyle': cat.color,
            'displaymode': pattern ? ['line', 'fill'] : ['line']
        });
    });
    track.addChild(stackedFill);
  }

  private addMudLogTrack(width: number): void {
    const track = this.wellLogWidget.addTrack(TrackType.LogTrack);
    track.setName('Track # 2').setWidth(width);
    
    const remarksSection = new LogMudLogSection();
    const texts = [
        "LS: WH-CM-BF,OPQ,PRED CHKY- MOD DNS",
        "CHT: X LT GY-V LT BN,BLKY-SBBLKY ANG-IRREG",
        "SS: BF,TRS GY-LT BN(ARG) CLUS",
        "LS-OFFWH BUF CRM TN MOT VF-FX CHKY-DNS"
    ];
    const remarkDepths: number[] = [];
    const remarkValues: string[] = [];
    for (let d = 11400; d <= 13400; d += 100) {
        remarkDepths.push(d);
        remarkValues.push(texts[Math.floor(Math.random() * texts.length)]);
    }
    
    remarksSection.setDepthsAndValues(remarkDepths, remarkValues);
    remarksSection.setProperty('ellipsis', true);
    remarksSection.setProperty('padding', 5);
    track.addChild(remarksSection);
  }

  private addGasTrack(width: number): void {
    const track = this.wellLogWidget.addTrack(TrackType.LogTrack);
    track.setName('Total Gas/Chromatograph (Units)').setWidth(width);

    const gasCurves = [
        { name: 'Hot Wire', color: 'crimson' },
        { name: 'Ethan', color: 'forestgreen' },
        { name: 'Propane', color: 'orange' },
        { name: 'Butanes', color: 'blue' },
        { name: 'Pentanes', color: 'black' }
    ];

    gasCurves.forEach(gc => {
        const curve = new LogCurve();
        const depths: number[] = [];
        const values: number[] = [];
        for (let d = 11400; d <= 13400; d += 10) {
            depths.push(d);
            values.push(Math.random() * 300);
        }
        curve.setData(new LogData(gc.name).setValues(depths, values));
        curve.setLineStyle(new LineStyle({ color: gc.color, width: 1 }));
        track.addChild(curve);
    });
  }

  private setupNavigationWidget(minDepth: number, maxDepth: number): void {
    this.navigationWidget.setDepthLimits(minDepth, maxDepth);
    const navIndexTrack = this.navigationWidget.addTrack(TrackType.IndexTrack).setWidth(40);
    const navCurve = new LogCurve();
    navIndexTrack.addChild(navCurve);
    
    if (this.navigationTool) {
        this.navigationTool.setVisibleDepthLimits(this.wellLogWidget.getVisibleDepthLimits());
    }
    this.navigationWidget.fitToHeight();
  }

  private updateTooltip(eventArgs: any): void {
    if (!eventArgs || !this.wellLogWidget) return;
    const position = eventArgs.getPosition();
    if (!position) {
        this.tooltipData = null;
        return;
    }

    const trackContainer: any = this.wellLogWidget.getTrackContainer();
    if (!trackContainer) return;
    const sceneTransform = trackContainer.getSceneTransform();
    if (!sceneTransform) return;
    const pt = sceneTransform.transformPoint(position);
    const depth = pt.getY();

    if (this.mudLogData.length === 0) {
        // Fallback for tooltip if data is simulated
        this.tooltipData = {
            depth: depth,
            curveValues: [{
                mnemonic: 'DEPTH',
                displayName: 'Depth',
                value: depth.toFixed(2),
                unit: 'ft',
                color: '#333',
                trackName: 'MudLog'
            }],
            screenY: position.getY(),
            visible: true
        };
        return;
    }

    const closest = this.mudLogData.reduce((prev, curr) => 
        Math.abs(curr.depth - depth) < Math.abs(prev.depth - depth) ? curr : prev
    );

    if (Math.abs(closest.depth - depth) < 5) {
        this.tooltipData = {
            depth: depth,
            curveValues: [{
                mnemonic: 'LITH',
                displayName: 'Lithology',
                value: closest.value,
                unit: '',
                color: '#333',
                trackName: 'MudLog'
            }],
            screenY: position.getY(),
            visible: true
        };
    }
  }

  onScaleChange(scale: number): void {
    if (!this.wellLogWidget) return;
    if (scale === 0) {
        this.wellLogWidget.fitToHeight();
    } else {
        const limits: any = this.wellLogWidget.getVisibleDepthLimits();
        if (limits) {
            this.wellLogWidget.setVisibleDepthLimits(limits.getLow(), limits.getLow() + scale);
        }
    }
    this.wellLogWidget.updateLayout();
  }
}
