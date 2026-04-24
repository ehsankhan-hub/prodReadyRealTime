import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { LogMudLogSection } from '@int/geotoolkit/welllog/LogMudLogSection';
import { ITracks } from '../models/chart/tracks';

export type RemarksDataSourceLike = {
  getDepths(): number[] | undefined;
  getValues(): any[] | undefined;
};

export type RemarkBinding<TDataSource extends RemarksDataSourceLike> = {
  track: LogTrack;
  dataSource: TDataSource;
  remarksSection: LogMudLogSection;
};

export class DynamicTrackRemarksHelper {
  /**
   * Remarks must use LogTrack (not LinearTrack): LogAnnotation / depth-indexed
   * children share the widget depth model. LinearTrack uses a different layout
   * model, so annotations at real timestamps often never appear (same data, "created" logs).
   */
  public createRemarksLogTrack(
    wellLogWidget: WellLogWidget,
    trackInfo: ITracks
  ): LogTrack {
    const track = wellLogWidget.addTrack(TrackType.LogTrack);
    track.setName(trackInfo.trackName || 'Remarks');
    track.setWidth(trackInfo.trackWidth || 160);
    track.setProperty('show-grid', false);
    track.setProperty('show-title', true);
    return track;
  }

  public createSmartDataSource<TDataSource>(
    factory: () => TDataSource
  ): TDataSource {
    return factory();
  }

  public syncRemarksAnnotations<TDataSource extends RemarksDataSourceLike>(
    wellLogWidget: WellLogWidget,
    remarkBindings: Array<RemarkBinding<TDataSource>>
  ): void {
    if (!remarkBindings.length || !wellLogWidget) return;
    const limits = wellLogWidget.getVisibleDepthLimits?.();
    if (!limits) return;

    const low = limits.getLow();
    const high = limits.getHigh();
    const span = Math.max(1, high - low);
    console.log('[REMARKS] sync start', {
      low,
      high,
      span,
      bindings: remarkBindings.length,
    });

    remarkBindings.forEach((binding) => {
      const rows = this.buildVisibleRemarkRows(
        binding,
        low,
        high,
        span
      );
      const depths = rows.map((r) => r.depth);
      const values = rows.map((r) => r.text);
      binding.remarksSection.setDepthsAndValues(depths, values);
      console.log('[REMARKS] binding annotations created', {
        trackName: binding.track.getName?.() || '(no-name)',
        created: values.length,
      });
      binding.track.invalidate(undefined, true);
    });

    wellLogWidget.updateLayout();
  }

  private makeRemarkRenderKey(depth: number, text: string): string {
    return `${Math.round(depth)}|${text}`;
  }

  private buildVisibleRemarkRows<TDataSource extends RemarksDataSourceLike>(
    binding: RemarkBinding<TDataSource>,
    low: number,
    high: number,
    span: number
  ): Array<{ depth: number; text: string }> {
    const depths = binding.dataSource.getDepths() || [];
    const values = binding.dataSource.getValues() || [];
    console.log('[REMARKS] binding datasource', {
      trackName: binding.track.getName?.() || '(no-name)',
      depthsCount: depths.length,
      valuesCount: values.length,
      firstDepth: depths[0],
      lastDepth: depths[depths.length - 1],
      firstValue: values[0],
    });
    if (!depths.length) return [];

    const renderedRemarkKeys = new Set<string>();
    const rows: Array<{ depth: number; text: string }> = [];
    for (let i = 0; i < depths.length; i++) {
      const d = depths[i];
      if (!Number.isFinite(d) || d < low - span || d > high + span) continue;
      const text = String(values[i] ?? '').trim();
      if (!text) continue;
      const remarkKey = this.makeRemarkRenderKey(d, text);
      if (renderedRemarkKeys.has(remarkKey)) continue;
      renderedRemarkKeys.add(remarkKey);
      rows.push({ depth: d, text });
    }

    return rows;
  }
}
