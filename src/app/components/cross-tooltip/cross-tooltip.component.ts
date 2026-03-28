import { Component, Input, OnChanges, SimpleChanges, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Represents a single curve value at the current crosshair depth.
 */
export interface TooltipCurveValue {
  /** Curve mnemonic (e.g., 'GR', 'RT') */
  mnemonic: string;
  /** Curve display name */
  displayName: string;
  /** Current value at crosshair depth */
  value: number | string | null;
  /** Unit of measurement */
  unit: string;
  /** Curve color for visual matching */
  color: string;
  /** Track name this curve belongs to */
  trackName: string;
}

/**
 * Simple tooltip data showing all curve values at crosshair depth.
 */
export interface CrossTooltipData {
  /** Current depth at crosshair position */
  depth: number;
  /** All curve values at this depth */
  curveValues: TooltipCurveValue[];
  /** Screen Y position for tooltip vertical placement */
  screenY: number;
  /** Whether the tooltip should be visible */
  visible: boolean;
}

/**
 * CrossTooltip component displays a right-side floating panel
 * showing ALL track curve values at the current crosshair depth.
 * 
 * @remarks
 * Positioned as an absolute overlay on the right side of the canvas wrapper.
 * Follows the crosshair vertically. Shows all curves from all tracks.
 */
@Component({
  selector: 'app-cross-tooltip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="cross-tooltip-panel"
      [class.visible]="data?.visible"
      [style.top.px]="panelTop">
      <div class="tooltip-header">
        <span class="depth-label">Depth:</span>
        <span class="depth-value">{{ data?.depth | number:'1.1-1' }} m</span>
      </div>
      <div class="tooltip-body">
        <div class="curve-row" *ngFor="let cv of data?.curveValues">
          <span class="curve-color" [style.background]="cv.color"></span>
          <span class="curve-name">{{ cv.mnemonic }}</span>
          
          <!-- Handle both numeric and string values -->
          <span class="curve-value" *ngIf="cv.value === null">---</span>
          <span class="curve-value" *ngIf="isNumber(cv.value)">{{ asNumber(cv.value) | number:'1.2-2' }}</span>
          <span class="curve-value" *ngIf="cv.value !== null && !isNumber(cv.value)">{{ cv.value }}</span>
          
          <span class="curve-unit">{{ cv.unit }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      top: 0; right: 0; bottom: 0;
      pointer-events: none;
      z-index: 100;
      width: 0;
    }
    .cross-tooltip-panel {
      position: absolute;
      right: 8px;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid #aaa;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
      padding: 6px 10px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11px;
      min-width: 180px;
      opacity: 0;
      transition: opacity 0.1s;
      pointer-events: none;
    }
    .cross-tooltip-panel.visible {
      opacity: 1;
    }
    .tooltip-header {
      display: flex;
      justify-content: space-between;
      padding-bottom: 4px;
      margin-bottom: 4px;
      border-bottom: 1px solid #ddd;
      font-weight: 700;
      font-size: 12px;
      color: #222;
    }
    .depth-label { color: #666; }
    .depth-value { color: #111; }
    .tooltip-body { display: flex; flex-direction: column; gap: 2px; }
    .curve-row {
      display: flex;
      align-items: center;
      gap: 6px;
      line-height: 1.4;
    }
    .curve-color {
      width: 10px; height: 10px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .curve-name {
      flex: 0 0 50px;
      font-weight: 600;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .curve-value {
      flex: 1;
      text-align: right;
      color: #111;
      font-weight: 500;
    }
    .curve-value.no-data { color: #bbb; }
    .curve-unit {
      flex: 0 0 40px;
      color: #888;
      font-size: 10px;
    }
  `]
})
export class CrossTooltipComponent implements OnChanges {
  @Input() data: CrossTooltipData | null = null;

  panelTop: number = 0;
  private hostHeight: number = 0;

  isNumber(val: any): boolean {
    return typeof val === 'number';
  }

  asNumber(val: any): number {
    return val as number;
  }

  constructor(private el: ElementRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.data) {
      this.updatePosition();
    }
  }

  private updatePosition(): void {
    if (!this.data) return;
    this.hostHeight = this.el.nativeElement.parentElement?.offsetHeight || 600;
    const panelHeight = 120;
    let top = this.data.screenY - panelHeight / 2;
    top = Math.max(4, Math.min(top, this.hostHeight - panelHeight - 4));
    this.panelTop = top;
  }
}
