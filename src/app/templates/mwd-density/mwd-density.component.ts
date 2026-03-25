import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenerateCanvasTracksComponent, TrackInfo, TrackCurve } from '../../components/generate-canvas-tracks/generate-canvas-tracks.component';
import { ITracks, IMnemonic } from '../../models/tracks.model';
import { LogHeadersService } from '../../services/log-headers.service';

/**
 * Component for displaying MWD (Measurements While Drilling) Density data.
 * Combines MWD and Density track configurations and renders them using the GenerateCanvasTracksComponent.
 * 
 * @remarks
 * This component serves as a wrapper that:
 * - Accepts separate MWD and Density track configurations
 * - Converts them to the unified TrackInfo format
 * - Passes the combined configuration to the canvas tracks renderer
 * - Provides default track configurations if none are provided
 */
@Component({
  selector: 'app-mwd-density',
  standalone: true,
  imports: [CommonModule, GenerateCanvasTracksComponent],
  providers: [LogHeadersService],
  template: `
    <app-dynamic-track-generator 
      [listOfTracks]="combinedTracks"
      [well]="well"
      [wellbore]="wellbore">
    </app-dynamic-track-generator>
  `,
  styles: [`
    .mwd-density-container {
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 10px;
      background-color: #f5f5f5;
      overflow: hidden;
      min-height: 0;
    }
    
    .header {
      text-align: center;
      margin-bottom: 5px;
      flex-shrink: 0;
    }
    
    .header h2 {
      color: #333;
      margin: 0 0 5px 0;
      font-size: 18px;
    }
    
    .header p {
      color: #666;
      margin: 0;
      font-size: 13px;
    }
    
    .tracks-display {
      flex: 1;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      overflow: hidden;
      min-height: 0;
    }
    
    .track-info {
      display: none;
    }
    
    .track-info h3 {
      margin: 0 0 15px 0;
      color: #333;
    }
    
    .track-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .track-item {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 10px 15px;
      background: #f8f9fa;
      border-radius: 6px;
      border-left: 4px solid #007bff;
    }
    
    .track-number {
      background: #007bff;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    }
    
    .track-name {
      flex: 1;
      font-weight: 500;
      color: #333;
    }
    
    .track-curves {
      background: #e9ecef;
      color: #495057;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 12px;
    }
  `]
})
export class MwdDensityComponent implements OnInit {
  /** Unique identifier for the well */
  @Input() well: string = '';
  /** Unique identifier for the wellbore */
  @Input() wellbore: string = '';
  /** Array of MWD track configurations */
  @Input() lstOfTrack: ITracks[] = [];
  /** Array of Density track configurations */
  @Input() lstOfTrack1: ITracks[] = [];

  /** Combined track configurations in TrackInfo format */
  combinedTracks: TrackInfo[] = [];

  /**
   * Angular lifecycle hook called after component initialization.
   * Initializes track data and combines configurations for rendering.
   */
  ngOnInit(): void {
    console.log('🔧 MWD Density Component initialized');
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
        isDepth: true,
        curves: [
          {
            mnemonicId: 'GR',
            displayName: 'Gamma Ray',
            color: '#FF6B6B',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 150,
            autoScale: false,
            show: true,
            LogId: 'MWD_Time_SLB',
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
        isDepth: true,
        curves: [
          {
            mnemonicId: 'RT',
            displayName: 'Resistivity',
            color: '#4ECDC4',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0.1,
            max: 100,
            autoScale: false,
            show: true,
            LogId: 'MWD_Time_SLB',
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
        isDepth: true,
        curves: [
          {
            mnemonicId: 'RHOB',
            displayName: 'Bulk Density',
            color: '#45B7D1',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 2.0,
            max: 3.0,
            autoScale: false,
            show: true,
            LogId: 'MWD_Time_SLB',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 4,
        trackName: 'Photoelectric Factor',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: true,
        curves: [
          {
            mnemonicId: 'PEF',
            displayName: 'Photoelectric Factor',
            color: '#96CEB4',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 10,
            autoScale: false,
            show: true,
            LogId: 'MWD_Time_SLB',
            data: [],
            mnemonicLst: []
          }
        ]
      }
    ];
  }

  /**
   * Combines MWD and Density track configurations into a unified format.
   * Converts ITracks to TrackInfo format and merges them for rendering.
   * 
   * @private
   */
  private combineTracks(): void {
    // Convert ITracks to TrackInfo format
    const convertToTrackInfo = (tracks: ITracks[]): TrackInfo[] => {
      return tracks.map(track => ({
        trackNo: track.trackNo,
        trackName: track.trackName,
        trackType: track.trackType,
        trackWidth: track.trackWidth,
        isIndex: track.isIndex,
        isDepth: track.isDepth,
        curves: track.curves.map(curve => ({
          mnemonicId: curve.mnemonicId,
          displayName: curve.displayName,
          color: curve.color,
          lineStyle: curve.lineStyle,
          lineWidth: curve.lineWidth,
          min: curve.min,
          max: curve.max,
          autoScale: curve.autoScale,
          show: curve.show,
          LogId: curve.LogId,
          data: curve.data,
          mnemonicLst: curve.mnemonicLst
        }))
      }));
    };

    this.combinedTracks = [
      ...convertToTrackInfo(this.lstOfTrack),
      ...convertToTrackInfo(this.lstOfTrack1)
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
