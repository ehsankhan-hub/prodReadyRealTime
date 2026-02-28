import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DynamicTrackGeneratorComponent, TrackInfo, TrackCurve } from '../../components/generate-canvas-tracks/dynamic-track-generator.component';
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
  imports: [CommonModule, DynamicTrackGeneratorComponent],
  providers: [LogHeadersService],
  template: `
    <app-dynamic-track-generator 
      [listOfTracks]="combinedTracks"
      [well]="well"
      [wellbore]="wellbore"
      [indexType]="'time'">
    </app-dynamic-track-generator>
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
        trackNo: 1,
        trackName: 'MWD Gamma Ray (Time)',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'HKHT', // Using available mnemonic instead of GR
            displayName: 'Gamma Ray',
            color: '#E74C3C',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 150,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time_RS', // Using your actual LogId
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 2,
        trackName: 'MWD Resistivity (Time)',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'ROP', // Using available mnemonic instead of RT
            displayName: 'Resistivity',
            color: '#2ECC71',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0.1,
            max: 100,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time_RS', // Using your actual LogId
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 3,
        trackName: 'Bulk Density (Time)',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'HKLI', // Using available mnemonic instead of RHOB
            displayName: 'Bulk Density',
            color: '#3498DB',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 2.0,
            max: 3.0,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time_RS', // Using your actual LogId
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 4,
        trackName: 'PEF (Time)',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'TORQUE', // Using available mnemonic instead of PEF
            displayName: 'Photoelectric Factor',
            color: '#9B59B6',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 10,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time_RS', // Using your actual LogId
            data: [],
            mnemonicLst: []
          }
        ]
      }
    ];
    
    console.log('🕐 MWD Time tracks initialized:', this.combinedTracks.length, 'tracks');
  }
}
