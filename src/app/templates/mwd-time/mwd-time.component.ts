import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimeBasedTracksComponent } from '../../components/time-based-tracks/time-based-tracks.component';
import { ITracks } from 'src/app/models/tracks.model';

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
  template: `
    <div class="mwd-time-container">
      
      
      <!-- Time-Based Canvas Tracks Component -->
      <app-time-based-tracks 
         [listOfTracks]="combinedTracks"
         [well]="well"
         [wellbore]="wellbore">
      </app-time-based-tracks>
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
export class MwdTimeComponent implements OnInit {
  /** Unique identifier for the well */
    @Input() well: string = '';
    /** Unique identifier for the wellbore */
    @Input() wellbore: string = '';
    /** Array of MWD track configurations */
    @Input() lstOfTrack: ITracks[] = [];
    /** Array of Density track configurations */
    @Input() lstOfTrack1: ITracks[] = [];
    /** Array of Image track configurations */
    @Input() lstOfTrack2: ITracks[] = [];
  
    /** Combined track configurations in TrackInfo format */
    combinedTracks: ITracks[] = [];
  
    /**
     * Angular lifecycle hook called after component initialization.
     * Initializes track data and combines configurations for rendering.
     */
    ngOnInit(): void {
      console.log('� MWD Time Component initialized');
      console.log('📊 Input tracks:', this.lstOfTrack);
      console.log('📊 Input tracks1:', this.lstOfTrack1);
      
      this.initializeTracks();
      this.combineTracks();
    }
  
    /**
     * Initializes default track configurations if none are provided.
     * Sets up default MWD and Density tracks with standard configurations.
     * 
     * @private
     */
    private initializeTracks(): void {
      // Initialize default MWD Density tracks if none provided
      if (this.lstOfTrack.length === 0) {
        this.lstOfTrack = this.getDefaultMWDTracks();
      }
      
      if (this.lstOfTrack1.length === 0) {
        this.lstOfTrack1 = this.getDefaultDensityTracks();
      }

      // Initialize default Image tracks if none provided
      if (this.lstOfTrack2.length === 0) {
        this.lstOfTrack2 = this.getDefaultImageTracks();
      }
    }
  
    /**
     * Creates default MWD track configurations.
     * Returns standard MWD Gamma Ray and Resistivity tracks with predefined settings.
     * 
     * @returns Array of default MWD track configurations
     * @private
     */
    private getDefaultMWDTracks(): ITracks[] {
      return [
        {
          trackNo: 1,
          trackName: 'MWD Gamma Ray',
          trackType: 'Linear',
          trackWidth: 100,
          isIndex: false,
          isDepth: false,
          curves: [
            {
              mnemonicId: 'GR',
              displayName: 'Gamma Ray',
              color: '#FF6B6B',
              lineStyle: 'solid',
              lineWidth: 2,
              min: 0,
              max: 150,
              autoScale: true, // Enable auto-scaling for better visibility
              show: true,
              LogId: 'Surface_Time',
              data: [],
              mnemonicLst: []
            }
          ]
        },
        {
          trackNo: 2,
          trackName: 'MWD Resistivity',
          trackType: 'Linear',
          trackWidth: 100,
          isIndex: false,
          isDepth: false,
          curves: [
            {
              mnemonicId: 'RT',
              displayName: 'Resistivity',
              color: '#4ECDC4',
              lineStyle: 'solid',
              lineWidth: 2,
              min: 0.1,
              max: 100,
              autoScale: true, // Enable auto-scaling for better visibility
              show: true,
              LogId: 'Surface_Time',
              data: [],
              mnemonicLst: []
            }
          ]
        }
      ];
     }
  
    /**
     * Creates default Density track configurations.
     * Returns standard Bulk Density and Photoelectric Factor tracks with predefined settings.
     * 
     * @returns Array of default Density track configurations
     * @private
     */
    private getDefaultDensityTracks(): ITracks[] {
      return [
        {
          trackNo: 3,
          trackName: 'Bulk Density',
          trackType: 'Linear',
          trackWidth: 100,
          isIndex: false,
          isDepth: false,
          curves: [
            {
              mnemonicId: 'RHOB',
              displayName: 'Bulk Density',
              color: '#45B7D1',
              lineStyle: 'solid',
              lineWidth: 2,
              min: 2.0,
              max: 3.0,
              autoScale: true, // Enable auto-scaling for better visibility
              show: true,
              LogId: 'Surface_Time',
              data: [],
              mnemonicLst: []
            }
          ]
        },
        {
          trackNo: 4,
          trackName: 'Neutron Porosity',
          trackType: 'Linear',
          trackWidth: 100,
          isIndex: false,
          isDepth: false,
          curves: [
            {
              mnemonicId: 'NPHI',
              displayName: 'Neutron Porosity',
              color: '#96CEB4',
              lineStyle: 'solid',
              lineWidth: 2,
              min: -0.05,
              max: 0.6,
              autoScale: true, // Enable auto-scaling for better visibility
              show: true,
              LogId: 'Surface_Time',
              data: [],
              mnemonicLst: []
            }
          ]
        },
        {
          trackNo: 5,
          trackName: 'Photoelectric Factor',
          trackType: 'Linear',
          trackWidth: 100,
          isIndex: false,
          isDepth: false,
          curves: [
            {
              mnemonicId: 'PEF',
              displayName: 'Photoelectric Factor',
              color: '#FFA07A',
              lineStyle: 'solid',
              lineWidth: 2,
              min: 1.0,
              max: 10.0,
              autoScale: true, // Enable auto-scaling for better visibility
              show: true,
              LogId: 'Surface_Time',
              data: [],
              mnemonicLst: []
            }
          ]
        }
      ];
    }
  
    /**
     * Creates default Image track configuration for formation imaging.
     * Returns an image track for displaying Log2DVisual formation data.
     * 
     * @returns Array of default Image track configurations
     * @private
     */
    private getDefaultImageTracks(): ITracks[] {
      return [
        {
          trackNo: 5,
          trackName: 'Formation Image',
          trackType: 'Image',
          trackWidth: 300,
          isIndex: false,
          isDepth: false,
          curves: []
        }
      ];
    }
  
    /**
     * Combines all track configurations into a single array for rendering.
     * Merges MWD, Density, and Image tracks into one unified collection.
     * 
     * @private
     */
    private combineTracks(): void {
      this.combinedTracks = [
        ...this.lstOfTrack,
        ...this.lstOfTrack1,
        ...this.lstOfTrack2
      ];
      
      console.log('🔗 Combined tracks for display:', this.combinedTracks);
    }
  
    /**
     * Public method to update tracks dynamically.
     * Allows external components to update track configurations and recombine them.
     * 
     * @param newTracks - New MWD track configurations
     * @param newTracks1 - New Density track configurations (optional)
     */
    public updateTracks(newTracks: ITracks[], newTracks1: ITracks[] = []): void {
      this.lstOfTrack = newTracks;
      this.lstOfTrack1 = newTracks1;
      this.combineTracks();
    }
  
    // Public method to get current track configuration
    public getTrackConfiguration(): { lstOfTrack: ITracks[], lstOfTrack1: ITracks[] } {
      return {
        lstOfTrack: this.lstOfTrack,
        lstOfTrack1: this.lstOfTrack1
      };
    }
}
