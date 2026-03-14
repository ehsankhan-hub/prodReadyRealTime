import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseWidgetComponent } from '../../basewidget/basewidget.component';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { Log2DVisual, PlotTypes, ColumnAlignment, RowAlignment } from '@int/geotoolkit/welllog/Log2DVisual';
import { Log2DVisualData } from '@int/geotoolkit/welllog/data/Log2DVisualData';
import { Log2DDataRow } from '@int/geotoolkit/welllog/data/Log2DDataRow';
import { CompositeLog2DVisualHeader } from '@int/geotoolkit/welllog/header/CompositeLog2DVisualHeader';
import { DefaultColorProvider } from '@int/geotoolkit/util/DefaultColorProvider';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { HeaderType } from '@int/geotoolkit/welllog/header/LogAxisVisualHeader';
import { Orientation } from '@int/geotoolkit/util/Orientation';
import { Range } from '@int/geotoolkit/util/Range';
import { Plot } from '@int/geotoolkit/plot/Plot';
import { Group } from '@int/geotoolkit/scene/Group';
import { CssLayout } from '@int/geotoolkit/layout/CssLayout';

@Component({
  selector: 'app-simple-log2d-demo',
  standalone: true,
  imports: [CommonModule, BaseWidgetComponent],
  templateUrl: './simple-log2d-demo.component.html',
  styleUrls: ['./simple-log2d-demo.component.css']
})
export class SimpleLog2dDemoComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(BaseWidgetComponent) baseWidget!: BaseWidgetComponent;
  
  widget: WellLogWidget | null = null;

  constructor() {}

  ngOnInit(): void {
    console.log('SimpleLog2dDemoComponent initialized');
  }

  ngAfterViewInit(): void {
    this.initializeWidget();
  }

  ngOnDestroy(): void {
    // Plot is disposed by BaseWidgetComponent
    this.widget = null;
  }

  private initializeWidget(): void {
    if (!this.baseWidget) {
      console.error('BaseWidget not available');
      return;
    }

    // Generate sample data similar to Vue demo
    const data = this.generateSampleData();
    
    // Create WellLogWidget with basic configuration
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
    
    // Create Log2DVisual with sample data
    const log2DVisual = this.create2DVisual(data, 'Sample Dataset', 0, '#7cb342');
    log2DVisual.setPlotType(PlotTypes.Linear);
    
    track.addChild([log2DVisual]);

    // Add another index track for spacing
    widget.addTrack(TrackType.IndexTrack);

    // Set depth limits based on data
    widget.setDepthLimits(data.getMinDepth(), data.getMaxDepth());
    widget.setVisibleDepthLimits(data.getMinDepth(), data.getMaxDepth());

    // Set widget on base component (this will also set it on the existing Plot)
    this.baseWidget.Widget = widget;
    this.widget = widget;

    // Fit to height
    widget.fitToHeight();

    console.log('✅ Simple Log2D demo initialized successfully');
  }

  private generateSampleData(): Log2DVisualData {
    const log2dData = new Log2DVisualData();
    
    // Generate sample data similar to Vue demo
    // Depth range from 4780 to 5040 (like Vue demo)
    const startDepth = 4780;
    const endDepth = 5040;
    const numPoints = 50;
    const numAngles = 36;
    
    for (let i = 0; i < numPoints; i++) {
      const depth = startDepth + (i * (endDepth - startDepth) / numPoints);
      const values: number[] = [];
      const angles: number[] = [];
      
      for (let j = 0; j < numAngles; j++) {
        const angle = (j * 2 * Math.PI) / numAngles;
        angles.push(angle);
        
        // Create sample values that vary with depth and angle
        const depthFactor = i / numPoints;
        const angleFactor = j / numAngles;
        const value = 0.5 + 0.5 * Math.sin(depthFactor * Math.PI * 2) * Math.cos(angleFactor * Math.PI);
        values.push(value);
      }
      
      log2dData.getRows().push(new Log2DDataRow(depth, values, angles));
    }
    
    log2dData.updateLimits();
    console.log(`✅ Generated sample Log2D data: ${log2dData.getRows().length} rows from depth ${startDepth} to ${endDepth}`);
    
    return log2dData;
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
