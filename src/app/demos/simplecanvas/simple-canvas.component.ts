import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTabChangeEvent } from '@angular/material/tabs';
import { LogHeadersService, LogHeader, LogData } from '../../services/log-headers.service';
import { HttpClientModule } from '@angular/common/http';
import { MwdDensityComponent } from '../../templates/mwd-density/mwd-density.component';
import { MwdTimeComponent } from '../../templates/mwd-time/mwd-time.component';
import { TimeBaseTrackNativeGeoComponent } from '../../components/time-base-track-native-geo/time-base-track-native-geo.component';
import { SimpleLog2dDemoComponent } from '../../components/simple-log2d-demo/simple-log2d-demo.component';
import { ITracks } from '../../models/tracks.model';
import { ITimeTrack, ITimeCurve, IWellboreObject } from '../../components/time-based-tracks/time-based-tracks.component';
import { MudLogComponent } from '../../components/mud-log/mud-log.component';

/**
 * Main demo component for displaying MWD Density well log visualization.
 * Serves as the entry point for the well log display with track configurations.
 * 
 * @remarks
 * This component:
 * - Provides track configurations for MWD and Density data
 * - Initializes the MWD Density component with well and wellbore information
 * - Manages the overall layout and footer display
 * - Contains drilling parameter information in the footer
 */
@Component({
  selector: 'app-simple-canvas',
  standalone: true,
  imports: [CommonModule, HttpClientModule, MatTabsModule, MwdDensityComponent, MwdTimeComponent, TimeBaseTrackNativeGeoComponent, SimpleLog2dDemoComponent, MudLogComponent],
  providers: [LogHeadersService],
  templateUrl: './simple-canvas.component.html',
  styleUrls: ['./simple-canvas.component.css']
})
export class SimpleCanvasComponent implements OnInit, AfterViewInit {
  /** Cached log headers from the service */
  private logHeaders: LogHeader[] = [];
  /** MWD track configurations */
  mwdTracks: ITracks[] = [];
  /** Density track configurations */
  densityTracks: ITracks[] = [];
  /** Surface Time track configurations */
  surfaceTimeTracks: ITracks[] = [];
  /** Active tab index for conditional rendering */
  activeTab: number = 0;
  /** Converted time tracks for native geo component */
  timeTracks: ITimeTrack[] = [];

  /**
   * Creates an instance of SimpleCanvasComponent.
   * @param logHeadersService - Service for fetching log headers and data
   */
  constructor(private logHeadersService: LogHeadersService) { }

  /**
   * Angular lifecycle hook called after component initialization.
   * Initializes track data and loads log headers.
   */
  ngOnInit(): void {
    console.log(' Simple Canvas Component initialized');
    this.initializeTrackData();
    this.convertToTimeTracks();
    this.loadLogHeaders();
  }

  /**
   * Initializes track configurations for MWD and Density data.
   * Sets up default track definitions with proper curve configurations.
   * 
   * @private
   */
  private initializeTrackData(): void {
    // Initialize MWD tracks - each track has its own curve (standard well log practice)
    this.mwdTracks = [
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
            LogId: 'MWD_Depth_SLB',
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
            LogId: 'MWD_Depth_SLB',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 3,
        trackName: 'Index',
        trackType: 'Index',
        trackWidth: 60,
        isIndex: true,
        isDepth: true, // Depth-based index track
        curves: []
      }
    ];

    // Initialize Density tracks - density curves grouped together (industry standard)
    this.densityTracks = [
      {
        trackNo: 4,
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
            LogId: 'MWD_Depth_SLB',
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
            LogId: 'MWD_Depth_SLB',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 6,
        trackName: 'Mud Log',
        trackType: 'MudLog',
        trackWidth: 150,
        isIndex: false,
        isDepth: true,
        curves: [
          {
            mnemonicId: 'LITHOLOGY',
            displayName: 'Lithology',
            color: '#8B4513',
            lineStyle: 'solid',
            lineWidth: 1,
            min: 0,
            max: 100,
            autoScale: false,
            show: true,
            LogId: 'MWD_MudLog_SLB',
            data: [],
            mnemonicLst: []
          }
        ]
      }
    ];

    // Add Surface_Time tracks for comparison
    this.surfaceTimeTracks = [
      {
        trackNo: 7,
        trackName: 'Surface Gamma Ray',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'GR',
            displayName: 'Gamma Ray (Surface)',
            color: '#FF6B6B',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0,
            max: 150,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 7,
        trackName: 'Surface Resistivity',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'RT',
            displayName: 'Resistivity (Surface)',
            color: '#4ECDC4',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 0.1,
            max: 100,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 8,
        trackName: 'Surface Bulk Density',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'RHOB',
            displayName: 'Bulk Density (Surface)',
            color: '#45B7D1',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 2.0,
            max: 3.0,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 9,
        trackName: 'Surface Neutron Porosity',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'NPHI',
            displayName: 'Neutron Porosity (Surface)',
            color: '#96CEB4',
            lineStyle: 'solid',
            lineWidth: 2,
            min: -0.05,
            max: 0.6,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      },
      {
        trackNo: 10,
        trackName: 'Surface Photoelectric Factor',
        trackType: 'Linear',
        trackWidth: 100,
        isIndex: false,
        isDepth: false,
        curves: [
          {
            mnemonicId: 'PEF',
            displayName: 'Photoelectric Factor (Surface)',
            color: '#FFA07A',
            lineStyle: 'solid',
            lineWidth: 2,
            min: 1.0,
            max: 10.0,
            autoScale: false,
            show: true,
            LogId: 'Surface_Time',
            data: [],
            mnemonicLst: []
          }
        ]
      }
    ];

    console.log(' MWD Tracks initialized:', this.mwdTracks);
    console.log(' Density Tracks initialized:', this.densityTracks);
    console.log(' Surface Time Tracks initialized:', this.surfaceTimeTracks);
  }

  /**
   * Converts ITracks[] to ITimeTrack[] for compatibility with time-based components.
   * Maps track properties and converts curve data structures.
   * 
   * @private
   */
  private convertToTimeTracks(): void {
    this.timeTracks = this.mwdTracks.map((track: ITracks): ITimeTrack => ({
      trackNo: track.trackNo,
      trackName: track.trackName,
      trackTitle: track.trackName, // Use trackName as trackTitle
      trackType: track.trackType,
      curves: track.curves.map((curve): ITimeCurve => ({
        mnemonicId: curve.mnemonicId,
        mnemonic: curve.displayName,
        data: curve.data,
        color: curve.color,
        lineWidth: curve.lineWidth,
        visible: curve.show,
        LogId: curve.LogId
      })),
      width: track.trackWidth,
      isIndex: track.isIndex
    }));
    
    // Add an image track for testing
    this.timeTracks.push({
      trackNo: 99,
      trackName: 'Core Image',
      trackTitle: 'Core Image',
      trackType: 'image',
      curves: [],
      width: 200,
      isIndex: false
    });
    
    console.log(' Converted to time tracks:', this.timeTracks);
  }

  /**
   * Loads log headers from the service for the specified well and wellbore.
   * Caches the headers for potential future use.
   * 
   * @private
   */
  private loadLogHeaders(): void {
    const well = 'HWYH_1389';
    const wellbore = 'HWYH_1389_0';
    
    this.logHeadersService.getLogHeaders(well, wellbore).subscribe({
      next: (headers) => {
        this.logHeaders = headers;
        console.log(' Log headers loaded:', headers);
      },
      error: (err) => {
        console.error(' Error loading log headers:', err);
      }
    });
  }

  /**
   * Angular lifecycle hook called after the component view has been initialized.
   * Logs component initialization completion.
   */
  ngAfterViewInit(): void {
    console.log(' Simple Canvas Component view initialized');
    // WellLogWidget is now handled by MWD Density component
    // No need to initialize the old widget since we're using the new template
  }

  /**
   * Handles tab change events to enable conditional rendering
   * @param event - MatTabChangeEvent containing the new tab index
   */
  onTabChange(event: MatTabChangeEvent): void {
    this.activeTab = event.index;
    const tabNames = ['MWD Depth', 'MWD_Time', 'MWD_Time Native', 'Log2D Demo'];
    console.log(` Tab changed to: ${tabNames[event.index] || 'Unknown'}`);
  }

  // Old WellLogWidget methods removed - now using MWD Density component
}
