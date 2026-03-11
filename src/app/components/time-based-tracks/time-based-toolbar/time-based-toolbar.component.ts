import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-time-based-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './time-based-toolbar.component.html',
  styleUrls: ['./time-based-toolbar.component.css']
})
export class TimeBasedToolbarComponent {
  @Input() selectedScale: string = '1000';
  @Input() isDarkTheme: boolean = false;
  @Input() isLiveTracking: boolean = false;
  @Input() latestTimestamp: number = 0;
  @Input() showLoading: boolean = false;

  @Output() scaleChange = new EventEmitter<string>();
  @Output() themeChange = new EventEmitter<boolean>();
  @Output() liveTrackingToggle = new EventEmitter<boolean>();
  @Output() resetView = new EventEmitter<void>();
  @Output() scrollToLatest = new EventEmitter<void>();
  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() editToggle = new EventEmitter<boolean>();
  @Output() colorChange = new EventEmitter<string>();
  @Output() rigTimeToggle = new EventEmitter<boolean>();
  @Output() timeRangeChange = new EventEmitter<{start: string, end: string}>();
  @Output() printClick = new EventEmitter<void>();

  scaleOptions = [
    { value: '0', label: 'Fit to Data' },
    { value: '0.5', label: '30 min' },
    { value: '1', label: '1 hour' },
    { value: '2', label: '2 hours' },
    { value: '4', label: '4 hours' },
    { value: '6', label: '6 hours' },
    { value: '12', label: '12 hours' },
    { value: '24', label: '24 hours' }
  ];

  customStartTime: string = '';
  customEndTime: string = '';
  showCustomRange: boolean = false;

  onScaleChange(newScale: string): void {
    this.scaleChange.emit(newScale);
  }

  onThemeChange(): void {
    this.themeChange.emit(!this.isDarkTheme);
  }

  onLiveTrackingToggle(): void {
    this.liveTrackingToggle.emit(!this.isLiveTracking);
  }

  onResetView(): void {
    this.resetView.emit();
  }

  onScrollToLatest(): void {
    this.scrollToLatest.emit();
  }

  onZoomIn(): void {
    this.zoomIn.emit();
  }

  onZoomOut(): void {
    this.zoomOut.emit();
  }

  onEditToggle(enabled: boolean): void {
    this.editToggle.emit(enabled);
  }

  onColorChange(color: string): void {
    this.colorChange.emit(color);
  }

  onRigTimeToggle(): void {
    this.rigTimeToggle.emit(!this.rigTimeToggle);
  }

  toggleCustomRange(): void {
    this.showCustomRange = !this.showCustomRange;
  }

  applyCustomRange(): void {
    if (this.customStartTime && this.customEndTime) {
      this.timeRangeChange.emit({
        start: this.customStartTime,
        end: this.customEndTime
      });
    }
  }

  formatLatestTimestamp(): string {
    if (!this.latestTimestamp) return '';
    return new Date(this.latestTimestamp).toLocaleString();
  }

  onPrintClick(): void {
    this.printClick.emit();
  }
}
