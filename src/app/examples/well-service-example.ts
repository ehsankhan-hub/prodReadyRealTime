import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenerateCanvasTracksComponent, WELL_SERVICE_TOKEN } from '../components/generate-canvas-tracks/generate-canvas-tracks.component';

/**
 * Example of how to provide and use the WellService with GenerateCanvasTracksComponent
 */
@Component({
  selector: 'app-example-usage',
  standalone: true,
  imports: [CommonModule, GenerateCanvasTracksComponent],
  providers: [
    // Provide your actual WellService implementation
    {
      provide: WELL_SERVICE_TOKEN,
      useFactory: () => {
        // Return your actual WellService instance here
        // This could be injected from a parent component or created directly
        return new YourWellService(); // Replace with your actual service
      }
    }
  ],
  template: `
    <div class="example-container">
      <h2>Well Log Visualization</h2>
      <app-generate-canvas-tracks
        [listOfTracks]="tracks"
        [well]="'HWYH_1389'"
        [wellbore]="'HWYH_1389_0'"
        [indexType]="'depth'">
      </app-generate-canvas-tracks>
    </div>
  `
})
export class ExampleUsageComponent {
  tracks = [
    {
      trackNo: 1,
      trackName: 'Gamma Ray',
      trackType: 'Linear',
      trackWidth: 100,
      isIndex: false,
      isDepth: true,
      curves: [
        {
          mnemonicId: 'GR',
          displayName: 'Gamma Ray',
          color: '#FF0000',
          lineStyle: 'solid',
          lineWidth: 2,
          min: 0,
          max: 150,
          autoScale: true,
          show: true,
          LogId: 'MWD_GR_SLB',
          data: [],
          mnemonicLst: []
        }
      ]
    }
  ];
}

/**
 * Example WellService implementation
 * Replace this with your actual WellService
 */
export class YourWellService {
  getLogHeaders(well: string, wellbore: string) {
    // Return Observable that calls your real backend API
    // Example:
    // return this.http.get(`${yourApiUrl}/wells/${well}/wellbores/${wellbore}/logs`);
    throw new Error('Implement your getLogHeaders method');
  }

  getLogData(queryParameter: any) {
    // Return Observable that calls your real backend API with queryParameter
    // Example:
    // return this.http.post(`${yourApiUrl}/logdata`, queryParameter);
    throw new Error('Implement your getLogData method');
  }
}
