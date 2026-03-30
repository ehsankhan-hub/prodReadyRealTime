import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { Log2DVisual, PlotTypes } from '@int/geotoolkit/welllog/Log2DVisual';
import { Log2DVisualData } from '@int/geotoolkit/welllog/data/Log2DVisualData';
import { Log2DDataRow } from '@int/geotoolkit/welllog/data/Log2DDataRow';
import { CompositeLog2DVisualHeader } from '@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader';
import { DefaultColorProvider } from '@int/geotoolkit/util/DefaultColorProvider';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { HeaderType } from '@int/geotoolkit/welllog/header/LogAxisVisualHeader';
import { Orientation } from '@int/geotoolkit/util/Orientation';
import { HttpClient } from '@angular/common/http';

// Interface for image data response
interface ImageDataResponse {
  wellId: string;
  wellboreId: string;
  objectId: string;
  startIndex: number;
  endIndex: number;
  imageData: Array<{
    depth: number;
    values: number[];
    angles: number[];
  }>;
}

// Interface for log data item
interface LogDataItem {
  depth: number;
  values: number[];
  angles: number[];
}

@Component({
  selector: 'app-simple-log2d-demo',
  standalone: true,
  imports: [CommonModule, BaseWidgetComponent],
  templateUrl: './simple-log2d-demo.component.html',
  styleUrls: ['./simple-log2d-demo.component.css']
})
export class SimpleLog2dDemoComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(BaseWidgetComponent) baseWidget!: BaseWidgetComponent;
  @ViewChild('timeBaseWidget', { read: BaseWidgetComponent }) timeBaseWidget!: BaseWidgetComponent;

  depthWidget: WellLogWidget | null = null;
  timeWidget: WellLogWidget | null = null;

  constructor(private http: HttpClient) { }

  ngOnInit(): void {
    console.log('SimpleLog2dDemoComponent initialized');
  }

  ngAfterViewInit(): void {
    this.initializeWidget();
  }

  ngOnDestroy(): void {
    // Plot is disposed by BaseWidgetComponent
    this.depthWidget = null;
    this.timeWidget = null;
  }

  private initializeWidget(): void {
    if (!this.baseWidget || !this.timeBaseWidget) {
      console.error('BaseWidget components not available');
      return;
    }

    // Load real data from JSON file
    this.loadRealData().then(data => {
      // Create depth-based widget
      this.createDepthWidget(data);

      // Create time-based widget  
      this.createTimeWidget(data);

      console.log('✅ Both Log2D demos initialized successfully with real data');
    }).catch(error => {
      console.error('Failed to load real data:', error);
    });
  }

  private createDepthWidget(data: Log2DVisualData): void {
    // Create WellLogWidget for depth-based display
    const widget = new WellLogWidget({
      'horizontalscrollable': false,
      'verticalscrollable': true,
      'trackcontainer': {
        'border': { 'visible': false }
      },
      'footer': {
        'visible': 'none'
      },
      'header': {
        'border': { 'visible': false }
      },
      'border': {
        'visible': false
      }
    });

    // Set orientation and header type
    widget.setOrientation(Orientation.Vertical)
      .setAxisHeaderType(HeaderType.Simple);

    // Register header provider for Log2DVisual
    const headerProvider = widget.getHeaderContainer().getHeaderProvider();
    headerProvider.registerHeaderProvider(Log2DVisual.getClassName(), new CompositeLog2DVisualHeader());

    // Add index track
    widget.addTrack(TrackType.IndexTrack);

    // Add linear track with Log2DVisual
    const track = widget.addTrack(TrackType.LinearTrack);

    // Create Log2DVisual with real data
    const log2DVisual = this.create2DVisual(data, 'Depth-based Log2D', 0, '#7cb342');
    log2DVisual.setPlotType(PlotTypes.Linear);

    track.addChild([log2DVisual]);

    // Add another index track for spacing
    widget.addTrack(TrackType.IndexTrack);

    // Set depth limits based on actual loaded data
    widget.setDepthLimits(data.getMinDepth(), data.getMaxDepth());
    widget.setVisibleDepthLimits(data.getMinDepth(), data.getMaxDepth());

    // Set widget on base component
    this.baseWidget.Widget = widget;
    this.depthWidget = widget;

    // Fit to height
    widget.fitToHeight();
  }

  private createTimeWidget(data: Log2DVisualData): void {
    // Create WellLogWidget for time-based display
    const widget = new WellLogWidget({
      'horizontalscrollable': false,
      'verticalscrollable': true,
      'trackcontainer': {
        'border': { 'visible': false }
      },
      'footer': {
        'visible': 'none'
      },
      'header': {
        'border': { 'visible': false }
      },
      'border': {
        'visible': false
      }
    });

    // Set orientation and header type
    widget.setOrientation(Orientation.Vertical)
      .setAxisHeaderType(HeaderType.Simple);

    // Set index type to time for proper timestamp formatting
    widget.setIndexType('time');

    // Register header provider for Log2DVisual
    const headerProvider = widget.getHeaderContainer().getHeaderProvider();
    headerProvider.registerHeaderProvider(Log2DVisual.getClassName(), new CompositeLog2DVisualHeader());

    // Add index track
    widget.addTrack(TrackType.IndexTrack);

    // Add linear track with Log2DVisual
    const track = widget.addTrack(TrackType.LinearTrack);

    // Convert depth data to time data (depth * 100 = time in milliseconds)
    const timeData = this.convertDepthToTime(data);

    // Create Log2DVisual with time-based data
    const log2DVisual = this.create2DVisual(timeData, 'Time-based Log2D', 0, '#ff6b6b');
    log2DVisual.setPlotType(PlotTypes.Linear);

    track.addChild([log2DVisual]);

    // Add another index track for spacing
    widget.addTrack(TrackType.IndexTrack);

    // Set time limits based on converted data
    widget.setDepthLimits(timeData.getMinDepth(), timeData.getMaxDepth());
    widget.setVisibleDepthLimits(timeData.getMinDepth(), timeData.getMaxDepth());

    // Set widget on base component
    this.timeBaseWidget.Widget = widget;
    this.timeWidget = widget;

    // Fit to height
    widget.fitToHeight();
  }

  private convertDepthToTime(depthData: Log2DVisualData): Log2DVisualData {
    const timeData = new Log2DVisualData();

    // Use a base timestamp (e.g., start of 2023) and add depth as seconds
    const baseTimestamp = new Date('2023-01-01T00:00:00Z').getTime();

    // Convert each depth row to timestamp
    depthData.getRows().forEach(row => {
      // Convert depth to seconds and add to base timestamp
      const timestamp = baseTimestamp + (row.getDepth() * 1000); // depth in seconds
      const timeRow = new Log2DDataRow(timestamp, row.getValues(), row.getAngles());
      timeData.getRows().push(timeRow);
    });

    timeData.updateLimits();
    console.log(`✅ Converted depth data to timestamps: ${timeData.getRows().length} rows`);

    return timeData;
  }

  private loadRealData(): Promise<Log2DVisualData> {
    // Load image data from backend service
    return this.http.get<ImageDataResponse>('http://localhost:3000/api/getImageData').toPromise()
      .then(response => {
        if (!response || !response.imageData) {
          throw new Error('Failed to load image data: No data received from backend');
        }

        const log2dData = new Log2DVisualData();

        // Parse image data and create Log2DDataRow objects
        response.imageData.forEach((item: LogDataItem) => {
          const row = new Log2DDataRow(item.depth, item.values, item.angles);
          log2dData.getRows().push(row);
        });

        log2dData.updateLimits();
        console.log(`✅ Loaded real image data: ${log2dData.getRows().length} rows from depth ${response.imageData[0]?.depth} to ${response.imageData[response.imageData.length - 1]?.depth}`);

        return log2dData;
      })
      .catch(error => {
        console.error('Error fetching data from backend:', error);
        throw error;
      });
  }

  private create2DVisual(
    log2dData: Log2DVisualData,
    name: string,
    offset: number,
    zeroColor: string
  ): Log2DVisual {
    const min = log2dData.getMinValue();
    const max = log2dData.getMaxValue();
    const delta = (max - min) / 3;

    // Create color provider
    const colors = new DefaultColorProvider()
      .addColor(min, zeroColor)
      .addColor(min + delta, 'yellow')
      .addColor(min + 2 * delta, 'orange')
      .addColor(max, 'red');

    // Create Log2DVisual
    return new Log2DVisual()
      .setName(name)
      .setData(log2dData)
      .setColorProvider(colors)
      .setOffsets(offset)
      .setMicroPosition(0, 1);
  }
}
