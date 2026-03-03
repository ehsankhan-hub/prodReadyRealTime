import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimeBasedTracksComponent, ITimeWellboreObject, ITimeTrack } from './time-based-tracks.component';

@Component({
  selector: 'app-time-based-example',
  standalone: true,
  imports: [CommonModule, FormsModule, TimeBasedTracksComponent],
  template: `
    <div class="example-container">
      <h2>Time-Based Well Log Example</h2>
      <div class="well-selector">
        <label>Well ID:</label>
        <input [(ngModel)]="wellId" placeholder="Enter Well ID">
        <label>Wellbore ID:</label>
        <input [(ngModel)]="wellboreId" placeholder="Enter Wellbore ID">
        <button (click)="loadWellData()">Load Data</button>
      </div>
      <app-time-based-tracks
        [wellId]="wellId"
        [wellboreId]="wellboreId"
        [listOfTracks]="listOfTracks"
        [selectedScale]="selectedScale"
        [isDarkTheme]="isDarkTheme"
        [selectedHour]="selectedHour"
        (scaleChange)="onScaleChange($event)"
        (themeChange)="onThemeChange($event)"
        (headersLoaded)="onHeadersLoaded($event)"
      ></app-time-based-tracks>
    </div>
  `,
  styles: [`
    .example-container {
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    h2 {
      padding: 16px;
      margin: 0;
      background: #f8f9fa;
      border-bottom: 1px solid #dee2e6;
    }
    .well-selector {
      padding: 16px;
      background: #ffffff;
      border-bottom: 1px solid #dee2e6;
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .well-selector label {
      font-weight: 500;
      color: #495057;
    }
    .well-selector input {
      padding: 6px 12px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 14px;
    }
    .well-selector button {
      padding: 6px 16px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .well-selector button:hover {
      background: #0056b3;
    }
  `]
})
export class TimeBasedExampleComponent implements OnInit {
  
  // Well identification
  wellId: string = 'WELL_001';
  wellboreId: string = 'WELLBORE_001';

  // Track configuration
  listOfTracks: ITimeTrack[] = [
    {
      trackName: 'TIME_INDEX',
      trackTitle: 'Time Index',
      trackType: 'Index',
      isIndex: true,
      curves: []
    },
    {
      trackName: 'DRILLING_TRACK',
      trackTitle: 'Drilling Parameters',
      trackType: 'Linear',
      isIndex: false,
      curves: [
        {
          mnemonicId: 'ROP',
          mnemonic: 'ROP',
          data: [],
          color: '#63b3ed',
          lineWidth: 1,
          visible: true
        },
        {
          mnemonicId: 'WOB',
          mnemonic: 'WOB',
          data: [],
          color: '#f687b3',
          lineWidth: 1,
          visible: true
        },
        {
          mnemonicId: 'RPM',
          mnemonic: 'RPM',
          data: [],
          color: '#68d391',
          lineWidth: 1,
          visible: true
        }
      ]
    },
    {
      trackName: 'GAS_TRACK',
      trackTitle: 'Gas Analysis',
      trackType: 'Linear',
      isIndex: false,
      curves: [
        {
          mnemonicId: 'GAS_TOTAL',
          mnemonic: 'GAS_TOTAL',
          data: [],
          color: '#fbb6ce',
          lineWidth: 1,
          visible: true
        },
        {
          mnemonicId: 'GAS_C1',
          mnemonic: 'GAS_C1',
          data: [],
          color: '#90cdf4',
          lineWidth: 1,
          visible: true
        },
        {
          mnemonicId: 'GAS_C2',
          mnemonic: 'GAS_C2',
          data: [],
          color: '#2b6cb0',
          lineWidth: 1,
          visible: true
        }
      ]
    }
  ];

  // Component state
  selectedScale: string = '1000'; // 1000ms default
  isDarkTheme: boolean = false;
  selectedHour: number = 24;

  constructor() {}

  ngOnInit(): void {
    console.log('🚀 Time-based example component initialized');
  }

  // Event handlers
  onScaleChange(scale: string): void {
    this.selectedScale = scale;
    console.log('📏 Scale changed to:', scale);
  }

  onThemeChange(isDark: boolean): void {
    this.isDarkTheme = isDark;
    console.log('🎨 Theme changed to:', isDark ? 'dark' : 'light');
  }

  onHeadersLoaded(headers: ITimeWellboreObject[]): void {
    console.log('📋 Headers loaded:', headers);
  }

  loadWellData(): void {
    console.log('🔄 Loading well data for:', this.wellId, this.wellboreId);
    // The component will automatically fetch headers when wellId/wellboreId change
  }
}
