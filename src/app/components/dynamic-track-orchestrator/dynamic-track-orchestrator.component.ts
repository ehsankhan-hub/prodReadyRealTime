import { Component, Input, OnInit, AfterViewInit, OnDestroy, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { BaseWidgetComponent } from '../../../components/core/basewidget/basewidget.component';
import { Subscription } from 'rxjs';

import { WellLogDataManagerService, TrackCurve } from '../../../services/well-log-data-manager.service';
import { WellLogVisualService } from '../../../services/well-log-visual.service';
import { PrintPropertiesDialogComponent, PrintPropertiesData, PrintPropertiesResult } from '../../../components/core/basewidget/print-properties-dialog/print-properties-dialog.component';

export interface TrackInfo {
  trackNo: number;
  trackName: string;
  trackType: string;
  trackWidth?: number;
  isIndex: boolean;
  isDepth: boolean;
  curves: TrackCurve[];
}

@Component({
  selector: 'app-dynamic-track-orchestrator',
  standalone: true,
  imports: [
    CommonModule, FormsModule, HttpClientModule,
    MatDialogModule, MatButtonModule, MatIconModule, MatSlideToggleModule,
    BaseWidgetComponent
  ],
  templateUrl: './dynamic-track-orchestrator.component.html',
  styleUrls: ['./dynamic-track-orchestrator.component.scss']
})
export class DynamicTrackOrchestratorComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() listOfTracks: TrackInfo[] = [];
  @Input() well: string = '';
  @Input() wellbore: string = '';
  @Input() indexType: 'depth' | 'time' = 'depth';

  @ViewChild('canvasWidget', { static: true }) private widgetComponent!: BaseWidgetComponent;

  isLoading = true;
  isLoadingChunk = false;
  isFirstTimeLoading = true;
  isDarkTheme = false;

  scaleOptions = [
    { label: '1:100', value: 100 }, { label: '1:200', value: 200 },
    { label: '1:500', value: 500 }, { label: '1:1,000', value: 1000 },
    { label: '1:2,000', value: 2000 }, { label: 'Fit to Height', value: 0 }
  ];
  selectedScale: number = 1000;

  private sceneReady = false;
  private subs: Subscription[] = [];
  private scrollPollHandle: any = null;
  private lastVisibleMin = -1;
  private lastVisibleMax = -1;

  constructor(
    private dataManager: WellLogDataManagerService,
    private visualService: WellLogVisualService,
    private dialog: MatDialog,
    private ngZone: NgZone
  ) { }

  ngOnInit() {
    this.subs.push(
      this.dataManager.initialLoadComplete$.subscribe(() => {
        this.isLoading = false;
        if (this.sceneReady) this.createScene();
      }),
      this.dataManager.dataUpdated$.subscribe(update => {
        if (!update.isInitialLoad) {
          this.visualService.updateCurveData(update.mnemonicId, update.depths, update.values);
          this.visualService.updateIndexTrackScale(this.dataManager.getCurveDepthIndices());
        }
      })
    );

    const hasTimeIndexTrack = this.listOfTracks.some(t => t.isIndex && !t.isDepth);
    this.dataManager.loadLogHeaders(this.well, this.wellbore, this.getAllCurves(), hasTimeIndexTrack);
  }

  ngAfterViewInit() {
    this.sceneReady = true;
    if (!this.isLoading) this.createScene();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.visualService.dispose();
    this.dataManager.reset();
    if (this.scrollPollHandle) clearInterval(this.scrollPollHandle);
  }

  private getAllCurves(): TrackCurve[] {
    return this.listOfTracks.flatMap(t => t.curves);
  }

  private createScene() {
    const hasTimeIndexTrack = this.listOfTracks.some(t => t.isIndex && !t.isDepth);
    const widget = this.visualService.initializeWidget(hasTimeIndexTrack);

    // Create actual Tracks & Themes
    this.visualService.applyTheme(this.isDarkTheme);

    let fullMinDepth = Number.MAX_VALUE;
    let fullMaxDepth = Number.MIN_VALUE;
    const depthsMap = this.dataManager.getCurveDepthIndices();

    for (const depths of depthsMap.values()) {
      if (depths.length > 0) {
        fullMinDepth = Math.min(fullMinDepth, depths[0]);
        fullMaxDepth = Math.max(fullMaxDepth, depths[depths.length - 1]);
      }
    }

    this.visualService.createIndexTrack(hasTimeIndexTrack, fullMinDepth, fullMaxDepth);
    this.visualService.createTracks(this.listOfTracks, this.dataManager.getCurveDepthIndices());

    this.widgetComponent.Widget = widget;

    setTimeout(() => {
      widget.setDepthLimits(0, this.dataManager.getHeaderMaxDepth() || fullMaxDepth);
      if (this.selectedScale > 0) {
        const visibleRange = this.selectedScale;
        widget.setVisibleDepthLimits(Math.max(0, fullMaxDepth - visibleRange), fullMaxDepth);
      } else {
        widget.setVisibleDepthLimits(0, fullMaxDepth);
      }
      widget.updateLayout();
      this.configureScrollLazyLoad();
    }, 100);
  }

  private configureScrollLazyLoad() {
    this.scrollPollHandle = setInterval(() => {
      const widget = this.visualService.getWidget();
      if (!widget) return;

      const visibleLimits: any = widget.getVisibleDepthLimits();
      if (!visibleLimits) return;

      const vMin = visibleLimits.getLow ? visibleLimits.getLow() : 0;
      const vMax = visibleLimits.getHigh ? visibleLimits.getHigh() : 0;

      if (Math.abs(vMin - this.lastVisibleMin) > 1 || Math.abs(vMax - this.lastVisibleMax) > 1) {
        this.lastVisibleMin = vMin;
        this.lastVisibleMax = vMax;

        const hasTimeIndexTrack = this.listOfTracks.some(t => t.isIndex && !t.isDepth);
        this.isLoadingChunk = true;
        this.dataManager.checkAndLoadChunks(this.well, this.wellbore, this.getAllCurves(), hasTimeIndexTrack, vMin, vMax)
          .finally(() => this.isLoadingChunk = false);
      }
    }, 300);
  }

  get isLivePolling(): boolean {
    return this.dataManager.isLivePolling;
  }

  toggleLivePolling() {
    if (this.dataManager.isLivePolling) {
      this.dataManager.stopLivePolling();
    } else {
      const hasTimeIndexTrack = this.listOfTracks.some(t => t.isIndex && !t.isDepth);
      this.dataManager.startLivePolling(this.well, this.wellbore, this.getAllCurves(), hasTimeIndexTrack);
    }
  }

  toggleTheme() {
    this.isDarkTheme = !this.isDarkTheme;
    this.visualService.applyTheme(this.isDarkTheme);
  }

  onScaleChange(scale: number) {
    this.selectedScale = Number(scale);
    const widget = this.visualService.getWidget();
    if (!widget) return;

    const maxDepth = this.dataManager.getHeaderMaxDepth() || 1000;
    if (this.selectedScale === 0) {
      widget.setVisibleDepthLimits(0, maxDepth);
      widget.fitToHeight();
    } else {
      const visibleRange = Math.min(this.selectedScale, maxDepth);
      const buffer = Math.min(visibleRange * 0.5, 500);
      const recentStart = Math.max(0, maxDepth - visibleRange - buffer);
      widget.setVisibleDepthLimits(recentStart, Math.min(maxDepth, maxDepth + buffer));
    }
    widget.updateLayout();
  }

  openPrintProperties() {
    const dialogData: PrintPropertiesData = {
      indexType: this.indexType,
      dataMin: 0,
      dataMax: this.dataManager.getHeaderMaxDepth() || 1000,
      visibleMin: this.lastVisibleMin,
      visibleMax: this.lastVisibleMax,
      currentScale: this.selectedScale,
      scaleOptions: this.scaleOptions,
    };

    const dialogRef = this.dialog.open(PrintPropertiesDialogComponent, { width: '720px', data: dialogData });
    dialogRef.afterClosed().subscribe((result: PrintPropertiesResult | null) => {
      if (!result) return;
      if (result.scale !== this.selectedScale) this.onScaleChange(result.scale);

      const widget = this.visualService.getWidget();
      if (!widget) return;

      if (result.printRange === 'all') {
        widget.setVisibleDepthLimits(0, dialogData.dataMax);
        widget.fitToHeight();
        widget.updateLayout();
      } else if (result.printRange === 'range') {
        widget.setVisibleDepthLimits(result.rangeFrom!, result.rangeTo!);
        widget.updateLayout();
      }

      if (result.print) {
        this.printCanvas(result);
      }
    });
  }

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
          result.printRange === 'all' ? 'All' : result.printRange === 'visible' ? 'Visible Range' : `${result.rangeFrom} - ${result.rangeTo}`
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
          ${result.headerOption === 'topAndBottom' || result.headerOption === 'top' ? headerHtml : ''}
          <img src="${dataUrl}" style="max-width:100%;" />
          ${result.headerOption === 'topAndBottom' || result.headerOption === 'bottom' ? headerHtml : ''}
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


  refreshTracks() {
    const hasTimeIndexTrack = this.listOfTracks.some(t => t.isIndex && !t.isDepth);
    this.isLoading = true;
    this.dataManager.loadLogHeaders(this.well, this.wellbore, this.getAllCurves(), hasTimeIndexTrack);
  }
}
