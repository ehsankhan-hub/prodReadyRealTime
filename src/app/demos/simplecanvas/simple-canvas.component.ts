import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { LogHeadersService, LogHeader, LogData } from '../../services/log-headers.service';
import { HttpClientModule } from '@angular/common/http';
import { MwdDensityComponent } from '../../templates/mwd-density/mwd-density.component';
import { MwdTimeComponent } from '../../templates/mwd-time/mwd-time.component';
import { ITracks } from '../../models/tracks.model';

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
  imports: [CommonModule, HttpClientModule, MatTabsModule, MwdDensityComponent, MwdTimeComponent],
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
            LogId: 'MWD_Time_SLB',
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
            LogId: 'MWD_Time_SLB',
            data: [],
            mnemonicLst: []
          }
        ]
      }
    ];

    console.log(' MWD Tracks initialized:', this.mwdTracks);
    console.log(' Density Tracks initialized:', this.densityTracks);
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

  // Old WellLogWidget methods removed - now using MWD Density component
}
