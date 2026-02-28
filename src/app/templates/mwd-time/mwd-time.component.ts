import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenerateCanvasTracksComponent, TrackInfo, TrackCurve } from '../../components/generate-canvas-tracks/generate-canvas-tracks.component';
import { ITracks } from '../../models/tracks.model';
import { LogHeadersService } from '../../services/log-headers.service';

/**
 * Component for displaying MWD Time-based well log data.
 * Uses dynamic track generator with real backend data.
 * 
 * @remarks
 * This component serves as a time-based template that:
 * - Provides MWD track configurations for time-based display
 * - Uses DynamicTrackGeneratorComponent for real-time data loading
 * - Connects to backend WITSML data sources
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
export class MwdTimeComponent implements OnInit {
  /** Unique identifier for the well */
  @Input() well: string = '';
  /** Unique identifier for the wellbore */
  @Input() wellbore: string = '';

  /** Combined track configurations in TrackInfo format */
  combinedTracks: TrackInfo[] = [];

  ngOnInit(): void {
    console.log('🕐 MWD Time Component initialized');
    this.initializeTracks();
  }

  private initializeTracks(): void {
    this.combinedTracks = [
      {
        trackNo: 0,
        trackName: 'Time',
        trackType: 'Index',
        trackWidth: 120,
        isIndex: true,
        isDepth: false,  // false = time-based, true = depth-based
        curves: []
      },
      {
        trackNo: 1,
        trackName: 'ROPS (Time)',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'ROPS',
            displayName: 'Rate of Penetration',
            color: '#E74C3C',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 80,
            autoScale: false,
            show: true,
            LogId: 'Calc_Drilling',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 2,
        trackName: 'ROPSmin (Time)',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'ROPSmin',
            displayName: 'ROP Smoothed Min',
            color: '#2ECC71',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 60,
            autoScale: false,
            show: true,
            LogId: 'Calc_Drilling',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 3,
        trackName: 'Depth (Time)',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'Depth',
            displayName: 'Bit Depth',
            color: '#3498DB',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 13000,
            max: 15000,
            autoScale: false,
            show: true,
            LogId: 'Calc_Drilling',
            data: [],
            mnemonicLst: []
          }
        ]
      }
    ];
    
    console.log('🕐 MWD Time tracks initialized:', this.combinedTracks.length, 'tracks');
  }
}
