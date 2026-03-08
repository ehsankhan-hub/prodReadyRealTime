import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimeBasedTracksComponent, ITimeTrack } from '../../components/time-based-tracks/time-based-tracks.component';
import { LogHeadersService } from '../../services/log-headers.service';
import { Subscription } from 'rxjs';

/**
 * Component for displaying MWD Time-based well log data.
 * Uses dynamic track generator with real backend data.
 * 
 * @remarks
 * This component serves as a time-based template that:
 * - Provides MWD track configurations for time-based display
 * - Uses time-based track configurations for real-time data loading
 * - Connects to backend WITSML data sources
 * - Supports automatic time-based data detection
 * - Optimized for time-based index tracks with proper width
 */
@Component({
  selector: 'app-mwd-time',
  standalone: true,
  imports: [CommonModule,  TimeBasedTracksComponent],
  providers: [LogHeadersService],
  template: `
    <div class="mwd-time-container">
      <!-- Toggle between old and new time-based components -->
      <div class="component-toggle">
        <button 
          [class]="'toggle-btn ' + (useNewComponent ? 'active' : 'inactive')"
          (click)="useNewComponent = true"
        >
          New Time-Based Tracks
        </button>
        <button 
          [class]="'toggle-btn ' + (!useNewComponent ? 'active' : 'inactive')"
          (click)="useNewComponent = false"
        >
          Original Dynamic Tracks
        </button>
      </div>
      
      <!-- New Time-Based Tracks Component -->
      <app-time-based-tracks 
        *ngIf="useNewComponent"
        [wellId]="well"
        [wellboreId]="wellbore"
        [listOfTracks]="timeBasedTracks"
        [selectedScale]="selectedScale"
        [isDarkTheme]="isDarkTheme"
        [selectedHour]="selectedHour"
        (scaleChange)="onScaleChange($event)"
        (themeChange)="onThemeChange($event)"
        (headersLoaded)="onHeadersLoaded($event)">
      </app-time-based-tracks>
      
      <!-- Original Generate Canvas Tracks Component -->
    
      
    </div>
  `,
  styles: [`
    :host { 
      display: block; 
      width: 100%; 
      height: 100%; 
    }
    .mwd-time-container {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .component-toggle {
      display: flex;
      gap: 8px;
      padding: 8px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
    }
    .toggle-btn {
      padding: 8px 16px;
      border: 1px solid #ccc;
      background: white;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.2s ease;
    }
    .toggle-btn.active {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }
    .toggle-btn.inactive:hover {
      background: #f8f9fa;
    }
  `]
})
export class MwdTimeComponent implements OnInit, OnDestroy {
  /** Unique identifier for the well */
  @Input() well: string = 'HWYH_1389';
  /** Unique identifier for the wellbore */
  @Input() wellbore: string = 'HWYH_1389_0';

  /** Time-based track configurations for new component */
  timeBasedTracks: ITimeTrack[] = [];
  
  /** Toggle between old and new components */
  useNewComponent: boolean = true;
  
  /** Settings for time-based component */
  selectedScale: string = '1000'; // 1000ms default
  isDarkTheme: boolean = false;
  selectedHour: number = 24;
  
  /** Subscription for cleanup */
  private subscription: Subscription | null = null;

  ngOnInit(): void {
    console.log('🕐 MWD Time Component initialized');
    console.log('🕐 Time-based configuration detected');
    console.log('🕐 Well:', this.well, 'Wellbore:', this.wellbore);
    this.initializeTimeBasedTracks();
    this.validateTimeConfiguration();
  }
  
  ngOnDestroy(): void {
    // Clean up subscriptions to prevent memory leaks
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    console.log('🕐 MWD Time Component destroyed');
  }
  
  /**
   * Initializes time-based track configurations for the new TimeBasedTracksComponent
   * @private
   */
  private initializeTimeBasedTracks(): void {
    this.timeBasedTracks = [
      {
        trackNo: 0,
        trackName: 'TIME_INDEX',
        trackTitle: 'Time Index',
        trackType: 'Index',
        isIndex: true,
        curves: []
      },
      {
        trackNo: 1,
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
            visible: true,
            LogId: 'MWD_Time_SLB'
          },
          {
            mnemonicId: 'WOB',
            mnemonic: 'WOB',
            data: [],
            color: '#f687b3',
            lineWidth: 1,
            visible: true,
            LogId: 'MWD_Time_SLB'
          },
          {
            mnemonicId: 'RPM',
            mnemonic: 'RPM',
            data: [],
            color: '#68d391',
            lineWidth: 1,
            visible: true,
            LogId: 'MWD_Time_SLB'
          }
        ]
      },
      {
        trackNo: 2,
        trackName: 'GR_TRACK',
        trackTitle: 'Gamma Ray',
        trackType: 'Linear',
        isIndex: false,
        curves: [
          {
            mnemonicId: 'GR',
            mnemonic: 'GR',
            data: [],
            color: '#fbb6ce',
            lineWidth: 2,
            visible: true,
            LogId: 'MWD_Time_SLB'
          }
        ]
      },
      {
        trackNo: 3,
        trackName: 'RT_TRACK',
        trackTitle: 'Resistivity',
        trackType: 'Linear',
        isIndex: false,
        curves: [
          {
            mnemonicId: 'RT',
            mnemonic: 'RT',
            data: [],
            color: '#90cdf4',
            lineWidth: 2,
            visible: true,
            LogId: 'MWD_Time_SLB'
          }
        ]
      },
      {
        trackNo: 4,
        trackName: 'NPHI_TRACK',
        trackTitle: 'Neutron Porosity',
        trackType: 'Linear',
        isIndex: false,
        curves: [
          {
            mnemonicId: 'NPHI',
            mnemonic: 'NPHI',
            data: [],
            color: '#FF6347', // Bright red color for better visibility
            lineWidth: 2, // Thicker line for visibility
            visible: true,
            LogId: 'MWD_Time_SLB'
          }
        ]
      },
      {
        trackNo: 5,
        trackName: 'RHOB_TRACK',
        trackTitle: 'Bulk Density',
        trackType: 'Linear',
        isIndex: false,
        curves: [
          {
            mnemonicId: 'RHOB',
            mnemonic: 'RHOB',
            data: [],
            color: '#45B7D1',
            lineWidth: 2,
            visible: true,
            LogId: 'MWD_Time_SLB'
          }
        ]
      },
      {
        trackNo: 6,
        trackName: 'PEF_TRACK',
        trackTitle: 'Photoelectric Factor',
        trackType: 'Linear',
        isIndex: false,
        curves: [
          {
            mnemonicId: 'PEF',
            mnemonic: 'PEF',
            data: [],
            color: '#96CEB4',
            lineWidth: 2,
            visible: true,
            LogId: 'MWD_Time_SLB'
          }
        ]
      }
    ];
    
    console.log('🕐 Time-based tracks initialized:', this.timeBasedTracks.length, 'tracks');
    console.log('🕐 Track order verification:');
    this.timeBasedTracks.forEach(track => {
      console.log(`  - Track ${track.trackNo}: ${track.trackTitle} (${track.trackType})`);
    });
  }
  
  /**
   * Event handler for scale changes from TimeBasedTracksComponent
   */
  onScaleChange(scale: string): void {
    this.selectedScale = scale;
    console.log('🕐 Scale changed to:', scale);
  }
  
  /**
   * Event handler for theme changes from TimeBasedTracksComponent
   */
  onThemeChange(isDark: boolean): void {
    this.isDarkTheme = isDark;
    console.log('🕐 Theme changed to:', isDark ? 'dark' : 'light');
  }
  
  /**
   * Event handler for headers loaded from TimeBasedTracksComponent
   */
  onHeadersLoaded(headers: any[]): void {
    console.log('🕐 Headers loaded:', headers);
  }

  /**
   * Validates the time-based configuration
   * @returns boolean indicating if configuration is valid
   */
  public validateTimeConfiguration(): boolean {
    const indexTrack = this.timeBasedTracks.find(t => t.isIndex);
    if (!indexTrack) {
      console.error('❌ No index track found in MWD Time configuration');
      return false;
    }

    const drillingTrack = this.timeBasedTracks.find(t => t.trackName === 'DRILLING_TRACK');
    if (!drillingTrack || drillingTrack.curves.length !== 3) {
      console.error('❌ Drilling track not found or has incorrect number of curves');
      return false;
    }
    
    console.log('✅ MWD Time configuration validation passed');
    return true;
  }
}
