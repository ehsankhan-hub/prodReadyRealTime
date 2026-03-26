import { Injectable, NgZone } from '@angular/core';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { Events as CrossHairEvents } from '@int/geotoolkit/controls/tools/CrossHair';
import { CssStyle } from '@int/geotoolkit/css/CssStyle';
import { TrackCurve } from './well-log-data-manager.service';

export interface TrackInfo {
  trackNo: number;
  trackName: string;
  trackType: string;
  trackWidth?: number;
  isIndex: boolean;
  isDepth: boolean;
  curves: TrackCurve[];
}

@Injectable({
  providedIn: 'root'
})
export class WellLogVisualService {
  private wellLogWidget: WellLogWidget | null = null;
  private curveMap: Map<string, { logCurve: LogCurve; info: TrackCurve; trackName: string }> = new Map();
  private resizeTimeout: any = null;
  private lastContainerWidth = 0;
  
  constructor(private ngZone: NgZone) {}

  public getWidget(): WellLogWidget | null {
    return this.wellLogWidget;
  }

  public dispose(): void {
    if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
    this.wellLogWidget = null;
    this.curveMap.clear();
  }

  public initializeWidget(isTimeBased: boolean): WellLogWidget {
    this.curveMap.clear();
    this.wellLogWidget = new WellLogWidget({
      indextype: isTimeBased ? IndexType.Time : IndexType.Depth,
      indexunit: isTimeBased ? 's' : 'ft',
      horizontalscrollable: false,
      verticalscrollable: true,
      header: { visible: true, height: 80 },
      viewcache: true,
      trackcontainer: { border: { visible: true } }
    });

    this.wellLogWidget.setLayoutStyle({ left: 0, top: 0, right: 0, bottom: 0 });
    return this.wellLogWidget;
  }

  public applyTheme(isDarkTheme: boolean): void {
    if (!this.wellLogWidget) return;

    const theme = isDarkTheme
      ? {
          headerBg: 'transparent', headerText: '#e2e8f0', headerBorder: '#4a5568',
          trackBg: 'black', trackBorder: 'gray', gridLines: '#2564e0ff',
          axisText: '#e2e8f0', curveColors: ['#40857fff', '#f687b3', '#68d391', '#fbb6ce', '#90cdf4']
        }
      : {
          headerBg: 'transparent', headerText: '#e2e8f0', headerBorder: '#e2e8f0',
          trackBg: '#fcf8f7ff', trackBorder: '#e0cfcbff', gridLines: '#e2e8f0',
          axisText: '#4a5568', curveColors: ['#3182ce', '#d53f8c', '#38a169', '#ed64a6', '#2b6cb0']
        };

    const cssString = [
      '.geotoolkit.welllog.header.Header { fillstyle: ' + theme.headerBg + '; textstyle-color: ' + theme.headerText + '; linestyle-color: ' + theme.headerBorder + '; linestyle-width: 1; }',
      '.geotoolkit.welllog.LogTrack { fillstyle: ' + theme.trackBg + '; linestyle-color: ' + theme.trackBorder + '; linestyle-width: 1; }',
      '.geotoolkit.welllog.IndexTrack { fillstyle: ' + theme.trackBg + '; linestyle-color: ' + theme.trackBorder + '; linestyle-width: 1; }',
      '.geotoolkit.welllog.grid.Grid { linestyle-color: ' + theme.gridLines + '; linestyle-width: 0.5; }',
      '.geotoolkit.welllog.axis.Axis { textstyle-color: ' + theme.axisText + '; linestyle-color: ' + theme.gridLines + '; linestyle-width: 1; }',
      '.geotoolkit.welllog.header.AdaptiveLogCurveVisualHeader { textstyle-color: ' + theme.headerText + '; fillstyle: ' + theme.headerBg + '; linestyle-color: ' + theme.headerBorder + '; linestyle-width: 1; }',
      '.geotoolkit.welllog.header.TitleHeader { textstyle-color: ' + theme.headerText + '; fillstyle: ' + theme.headerBg + '; linestyle-color: ' + theme.headerBorder + '; linestyle-width: 1; }',
      '.geotoolkit.welllog.header.ScaleHeader { textstyle-color: ' + theme.headerText + '; fillstyle: ' + theme.headerBg + '; linestyle-color: ' + theme.headerBorder + '; linestyle-width: 1; }',
      '.geotoolkit.controls.tools.SelectionBox { linestyle-color: ' + theme.curveColors[0] + '; linestyle-width: 2; fillstyle: ' + theme.curveColors[0] + '20; }'
    ].join('\n');

    const geoToolkitCSS = new CssStyle({ css: cssString });
    this.wellLogWidget.setCss(geoToolkitCSS);
  }

  public createIndexTrack(isTimeBased: boolean, fullMinDepth: number, fullMaxDepth: number): void {
    if (!this.wellLogWidget) return;
    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    indexTrack.setWidth(120);
    indexTrack.setName(isTimeBased ? 'Time' : 'Depth');
    if (fullMinDepth !== Number.MAX_VALUE && fullMaxDepth !== Number.MIN_VALUE) {
      indexTrack.setDepthLimits(fullMinDepth, fullMaxDepth);
    }
  }

  public createTracks(listOfTracks: TrackInfo[], curveDepthIndices: Map<string, number[]>): void {
    if (!this.wellLogWidget) return;

    listOfTracks.forEach((trackInfo) => {
      if (trackInfo.isIndex) return;

      const track = this.wellLogWidget!.addTrack(TrackType.LinearTrack);
      track.setName(trackInfo.trackName);
      track.setWidth(trackInfo.trackWidth || 257);

      trackInfo.curves.forEach((curveInfo: TrackCurve) => {
        if (!curveInfo.show || !curveInfo.data || curveInfo.data.length === 0) return;

        const indexData = curveDepthIndices.get(curveInfo.mnemonicId) || Array.from({ length: curveInfo.data.length }, (_, i) => i * 1);
        
        const geoLogData = new GeoLogData(curveInfo.displayName);
        geoLogData.setValues(indexData, curveInfo.data);

        const curve = new LogCurve(geoLogData);
        curve.setLineStyle({ color: curveInfo.color, width: curveInfo.lineWidth });
        curve.setName(curveInfo.displayName);

        if (curveInfo.autoScale && curveInfo.min !== undefined && curveInfo.max !== undefined) {
          const dataRange = curveInfo.data[curveInfo.data.length - 1] - curveInfo.data[0];
          if (Math.abs(dataRange) < 0.1) {
            const center = (curveInfo.min + curveInfo.max) / 2;
            curve.setNormalizationLimits(center - 0.5, center + 0.5);
          } else {
            curve.setNormalizationLimits(curveInfo.min, curveInfo.max);
          }
        } else if (curveInfo.data && curveInfo.data.length > 0) {
          const dataMin = curveInfo.data.reduce((min: number, val: number) => val < min ? val : min, curveInfo.data[0]);
          const dataMax = curveInfo.data.reduce((max: number, val: number) => val > max ? val : max, curveInfo.data[0]);
          const dataRange = dataMax - dataMin;
          if (Math.abs(dataRange) < 0.1) {
            const center = (dataMin + dataMax) / 2;
            const expanded = Math.max(1.0, Math.abs(center) * 0.1);
            curve.setNormalizationLimits(center - expanded / 2, center + expanded / 2);
          } else {
            const padding = dataRange * 0.1;
            curve.setNormalizationLimits(dataMin - padding, dataMax + padding);
          }
        }

        track.addChild(curve);
        this.curveMap.set(curveInfo.mnemonicId, { logCurve: curve, info: curveInfo, trackName: trackInfo.trackName });
      });
    });
  }

  public updateCurveData(mnemonicId: string, depths: number[], values: number[]): void {
    if (!this.wellLogWidget) return;
    const entry = this.curveMap.get(mnemonicId);
    if (!entry) return;

    try {
      const geoLogData = new GeoLogData(entry.info.displayName);
      geoLogData.setValues(depths, values);
      entry.logCurve.setData(geoLogData);
      this.wellLogWidget.updateLayout();
    } catch (e) {
      console.warn('Could not update curve metadata for', mnemonicId, e);
    }
  }

  public updateIndexTrackScale(curveDepthIndices: Map<string, number[]>): void {
    if (!this.wellLogWidget) return;
    let indexTrack = null;

    try {
      const tracksResult = (this.wellLogWidget as any).getTracks();
      if (typeof tracksResult === 'number') {
        for (let i = 0; i < tracksResult; i++) {
          const track = (this.wellLogWidget as any).getTrack(i);
          if (track && track.getName) {
            const name = track.getName().toLowerCase();
            if (name.includes('depth') || name.includes('time') || name.includes('index')) {
              indexTrack = track;
              break;
            }
          }
        }
      } else if (tracksResult && typeof tracksResult.forEach === 'function') {
        tracksResult.forEach((track: any) => {
          const name = (track.getName?.() || '').toLowerCase();
          if (name.includes('depth') || name.includes('time')) indexTrack = track;
        });
      } else if (Array.isArray(tracksResult)) {
        for (const track of tracksResult) {
          const name = (track.getName?.() || '').toLowerCase();
          if (name.includes('depth') || name.includes('time')) {
            indexTrack = track;
            break;
          }
        }
      }
    } catch (e) {}

    if (!indexTrack) return;

    let fullMin = Number.MAX_VALUE;
    let fullMax = Number.MIN_VALUE;

    for (const depths of curveDepthIndices.values()) {
      if (depths && depths.length > 0) {
        fullMin = Math.min(fullMin, depths[0]);
        fullMax = Math.max(fullMax, depths[depths.length - 1]);
      }
    }

    if (fullMin !== Number.MAX_VALUE) {
      if (indexTrack.setDepthLimits) indexTrack.setDepthLimits(fullMin, fullMax);
      else if ((indexTrack as any).setLimits) (indexTrack as any).setLimits(fullMin, fullMax);
    }
  }
}
