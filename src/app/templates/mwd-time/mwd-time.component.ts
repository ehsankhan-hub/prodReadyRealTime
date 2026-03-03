import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ITracks, ICurve } from '../../models/tracks.model';
import { TimeBasedTracksComponent, ITimeTrack } from '../../components/time-based-tracks';
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

  /** Combined track configurations */
  combinedTracks: ITracks[] = [];
  
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
    this.initializeTracks();
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
        trackName: 'LOG_TRACK',
        trackTitle: 'Log Data',
        trackType: 'Linear',
        isIndex: false,
        curves: [
          {
            mnemonicId: 'GR',
            mnemonic: 'GR',
            data: [],
            color: '#fbb6ce',
            lineWidth: 1,
            visible: true
          },
          {
            mnemonicId: 'RT',
            mnemonic: 'RT',
            data: [],
            color: '#90cdf4',
            lineWidth: 1,
            visible: true
          },
          {
            mnemonicId: 'NPHI',
            mnemonic: 'NPHI',
            data: [],
            color: '#2b6cb0',
            lineWidth: 1,
            visible: true
          }
        ]
      }
    ];
    
    console.log('🕐 Time-based tracks initialized:', this.timeBasedTracks.length, 'tracks');
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

  private initializeTracks(): void {
    this.combinedTracks = [
      {
        trackNo: 0,
        trackName: 'Time',
        trackType: 'Index',
        trackWidth: 120, // Optimized width for time-based index track (MM/DD/YYYY HH:MM:SS)
        isIndex: true,
        isDepth: false,  // false = time-based, true = depth-based
        curves: []
      },
      {
        trackNo: 1,
        trackName: 'GR',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'GR',
            displayName: 'Gamma Ray',
            color: '#E74C3C',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 100,
            autoScale: true,  // Enable autoScale for time-based data
            show: true,
            LogId: 'MWD_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 2,
        trackName: 'RT',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'RT',
            displayName: 'Resistivity',
            color: '#2ECC71',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 80,
            autoScale: true,  // Enable autoScale for time-based data
            show: true,
            LogId: 'MWD_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 3,
        trackName: 'NPHI',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'NPHI',
            displayName: 'Neutron Porosity',
            color: '#3498DB',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 20000,
            autoScale: true,  // Enable autoScale for time-based data
            show: true,
            LogId: 'MWD_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 4,
        trackName: 'RHOB',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'RHOB',
            displayName: 'Bulk Density',
            color: '#9B59B6',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 60,
            autoScale: true,  // Enable autoScale for time-based data
            show: true,
            LogId: 'MWD_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 5,
        trackName: 'PEF',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'PEF',
            displayName: 'Photoelectric Factor',
            color: '#F39C12',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 250,
            autoScale: true,  // Enable autoScale for time-based data
            show: true,
            LogId: 'MWD_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      }
    ];
    
    console.log('🕐 MWD Time tracks initialized:', this.combinedTracks.length, 'tracks');
    console.log('🕐 Track configuration:');
    this.combinedTracks.forEach(track => {
      console.log(`  - Track ${track.trackNo}: ${track.trackName} (${track.trackType}, ${track.trackWidth}px)`);
      if (track.curves.length > 0) {
        track.curves.forEach((curve: ICurve) => {
          console.log(`    * ${curve.mnemonicId}: ${curve.displayName}`);
        });
      }
    });
  }
  
  /**
   * Updates track visibility for performance optimization
   * @param trackNo Track number to show/hide
   * @param visible Whether the track should be visible
   */
  public setTrackVisibility(trackNo: number, visible: boolean): void {
    const track = this.combinedTracks.find(t => t.trackNo === trackNo);
    if (track) {
      track.curves.forEach((curve: ICurve) => {
        curve.show = visible;
      });
      console.log(`🕐 Track ${trackNo} visibility set to: ${visible}`);
    }
  }
  
  /**
   * Gets the current track configuration
   * @returns Array of ITracks objects
   */
  public getTracks(): ITracks[] {
    return this.combinedTracks;
  }
  
  /**
   * Validates that all tracks are properly configured for time-based data
   * @returns boolean indicating if configuration is valid
   */
  public validateTimeConfiguration(): boolean {
    const indexTrack = this.combinedTracks.find(t => t.isIndex);
    if (!indexTrack) {
      console.error('❌ No index track found in MWD Time configuration');
      return false;
    }
    
    if (indexTrack.isDepth !== false) {
      console.error('❌ Index track is not properly configured for time-based data');
      return false;
    }
    
    const allTimeBased = this.combinedTracks.every(t => t.isDepth === false);
    if (!allTimeBased) {
      console.error('❌ Some tracks are configured as depth-based in time component');
      return false;
    }
    
    console.log('✅ MWD Time configuration validation passed');
    return true;
  }
}
