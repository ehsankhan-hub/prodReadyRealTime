import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenerateCanvasTracksComponent, TrackInfo, TrackCurve } from '../../components/generate-canvas-tracks/generate-canvas-tracks.component';
import { ITracks } from '../../models/tracks.model';
import { LogHeadersService } from '../../services/log-headers.service';
import { Subscription } from 'rxjs';

/**
 * Component for displaying MWD Time-based well log data.
 * Uses dynamic track generator with real backend data.
 * 
 * @remarks
 * This component serves as a time-based template that:
 * - Provides MWD track configurations for time-based display
 * - Uses GenerateCanvasTracksComponent for real-time data loading
 * - Connects to backend WITSML data sources
 * - Supports automatic time-based data detection
 * - Optimized for time-based index tracks with proper width
 */
@Component({
  selector: 'app-mwd-time',
  standalone: true,
  imports: [CommonModule, GenerateCanvasTracksComponent],
  providers: [LogHeadersService],
  template: `
    <app-generate-canvas-tracks 
      [listOfTracks]="combinedTracks"
      [well]="well"
      [wellbore]="wellbore">
    </app-generate-canvas-tracks>
  `,
  styles: [`:host { display: block; width: 100%; height: 100%; }`]
})
export class MwdTimeComponent implements OnInit, OnDestroy {
  /** Unique identifier for the well */
  @Input() well: string = 'HWYH_1389';
  /** Unique identifier for the wellbore */
  @Input() wellbore: string = 'HWYH_1389_0';

  /** Combined track configurations in TrackInfo format */
  combinedTracks: TrackInfo[] = [];
  
  /** Subscription for cleanup */
  private subscription: Subscription | null = null;

  ngOnInit(): void {
    console.log('🕐 MWD Time Component initialized');
    console.log('🕐 Time-based configuration detected');
    console.log('🕐 Well:', this.well, 'Wellbore:', this.wellbore);
    this.initializeTracks();
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
        track.curves.forEach(curve => {
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
      track.curves.forEach(curve => {
        curve.show = visible;
      });
      console.log(`🕐 Track ${trackNo} visibility set to: ${visible}`);
    }
  }
  
  /**
   * Gets the current track configuration
   * @returns Array of TrackInfo objects
   */
  public getTracks(): TrackInfo[] {
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
