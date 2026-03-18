import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  ViewChild,
  AfterViewInit,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { BaseWidgetComponent } from '../../../components/core/basewidget/basewidget.component';
import { TimeBasedLogService } from './time-based-log.service';
import { TimeBasedThemeService } from './time-based-theme.service';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { LogTrack } from '@int/geotoolkit/welllog/LogTrack';
import { LogCurve } from '@int/geotoolkit/welllog/LogCurve';
import { TimeBasedToolbarComponent } from './time-based-toolbar/time-based-toolbar.component';
import { AdaptiveTickGenerator } from '@int/geotoolkit/axis/AdaptiveTickGenerator';
import { LogAxis } from '@int/geotoolkit/welllog/LogAxis';
import { LogData as GeoLogData } from '@int/geotoolkit/welllog/data/LogData';
import { TrackType } from '@int/geotoolkit/welllog/TrackType';
import { ITracks } from '../../../models/chart/tracks';
import { WellDataService } from '../../../service/well-service/well.service';
import {
  ILogDataQueryParameter,
  IWellboreObject,
} from '../../../models/wellbore/wellbore-object';

export interface ITimeCurve {
  mnemonicId: string;
  mnemonic?: string;
  data: number[];
  color?: string;
  lineWidth?: number;
  visible?: boolean;
  LogId?: string;
}

export interface ITimeTrack {
  trackNo: number;
  trackName: string;
  trackTitle: string;
  trackType: string;
  curves: ITimeCurve[];
  width?: number;
  isIndex?: boolean;
}

export interface ITimeWellboreObject {
  uid: string;
  name: string;
  wellId: string;
  wellboreId: string;
  indexType: string;
  indexCurve: string;
  startIndex: any;
  endIndex: any;
  indexUnit: string;
  isGrowing: boolean;
  mnemonicList: string;
  objectInfo: ITimeCurve[];
  isDepth?: boolean;
}
export interface ILogDataResponse {
  mnemonicList: string;
  data: string[];
}

export interface PrintOptions {
  range: 'visible' | 'all' | 'range';
  scale: string;
  twoInchLog: boolean;
  useSinglePageScale: boolean;
  print: boolean;
  header: 'none' | 'top' | 'bottom' | 'top-and-bottom';
}

@Component({
  selector: 'app-time-based-tracks',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatSnackBarModule,
    BaseWidgetComponent,
    TimeBasedToolbarComponent,
  ],
  providers: [TimeBasedLogService, TimeBasedThemeService],
  templateUrl: './time-based-tracks.component.html',
  styleUrls: ['./time-based-tracks.component.css'],
})
export class TimeBasedTracksComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  @Input() well: string = '';
  @Input() wellbore: string = '';
  @Input() listOfTracks: ITracks[] = [];

  /** Internal component state - accessible by template */
  protected selectedScale: string = '1000';
  protected isDarkTheme: boolean = false;
  protected selectedHour: number = 24;

  @ViewChild('widgetComponent') widgetComponent!: BaseWidgetComponent;

  constructor(
    private timeBasedLogService: TimeBasedLogService,
    private timeBasedThemeService: TimeBasedThemeService,
    private welldataService: WellDataService,
    private ngZone: NgZone,
    private snackBar: MatSnackBar
  ) {}
  matchedHeaders: any | null = null;
  wellLogWidget: WellLogWidget | null = null;
  wellboreObjects: IWellboreObject[] = [];
  showLoading = false;
  isLiveTracking = false;
  indexCurveTime: number[] = [];
  latestTimestamp: number = 0;

  // Print modal properties
  showPrintModal = false;
  printOptions: PrintOptions = {
    range: 'visible',
    scale: '0',
    twoInchLog: false,
    useSinglePageScale: false,
    print: true,
    header: 'top-and-bottom',
  };

  private curveTimeIndices: Map<string, number[]> = new Map();
  private trackMap: Map<number, LogTrack> = new Map();
  private scrollPollHandle: any = null;
  private lastVisibleMin = -1;
  private lastVisibleMax = -1;
  private subscriptions: any[] = [];
  private scrollDebounceHandle: any = null;

  ngOnInit(): void {
    console.log('🎯 TimeBasedTracksComponent initialized', {
      well: this.well,
      wellbore: this.wellbore,
    });
    this.fetchLogHeaders();
  }

  ngAfterViewInit(): void {
    this.tryInitializeWidget();
  }

  ngOnDestroy(): void {
    this.stopScrollPolling();
    if (this.scrollDebounceHandle) {
      clearTimeout(this.scrollDebounceHandle);
      this.scrollDebounceHandle = null;
    }
    if (this.wellLogWidget) {
      try {
        this.wellLogWidget.dispose();
      } catch (_) {}
      this.wellLogWidget = null;
    }
    this.subscriptions.forEach((sub) => sub?.unsubscribe?.());
    this.subscriptions = [];
  }

  private tryInitializeWidget(): void {
    if (
      !this.widgetComponent ||
      !this.wellboreObjects.length ||
      this.wellLogWidget
    )
      return;
    this.initializeWidget();
  }

  private async fetchLogHeaders(): Promise<void> {
    this.showLoading = true;
    try {
      const headers: IWellboreObject[] =
        await this.welldataService.getLogHeader(this.well, this.wellbore);
      this.showLoading = false;
      if (headers?.length) {
        this.wellboreObjects = headers.map((header) => {
          const wellboreObject: IWellboreObject = {
            ...header,
            isDepth: false,
            objectInfo: this.generateCurveInfo(header),
          };

          // Set the LogId from the first curve that has one (or use header uid as fallback)
          const firstCurveWithLogId = this.listOfTracks
            .flatMap((track) => track.curves)
            .find((curve) => curve.LogId);

          if (firstCurveWithLogId) {
            console.log();
            wellboreObject.objectName = firstCurveWithLogId.LogId!;
          }
          //  console.log('this.wellboreObjects --fetchLogHeaders',wellboreObject)

          return wellboreObject;
        });
        this.tryInitializeWidget();
      } else {
        console.warn('⚠️ No time-based headers found');
      }
    } catch (error) {
      console.error('❌ Error fetching time-based log headers:', error);
      this.showLoading = false;
    }
  }
  private generateCurveInfo(header: IWellboreObject): ITimeCurve[] {
    if (!header.mnemonicList) {
      return [];
    }
    return header.mnemonicList?.split(',').map((mnemonic: string) => {
      // Find the curve in listOfTracks to get its LogId
      let curveLogId = header.objectId; // Default to header uid
      for (const track of this.listOfTracks) {
        const curve = track.curves.find(
          (c) => c.mnemonicId === mnemonic.trim()
        );
        if (curve && curve.LogId) {
          curveLogId = curve.LogId;
          break;
        }
      }

      return {
        mnemonicId: mnemonic.trim(),
        data: [],
        color: this.timeBasedThemeService.getCurveColor(0),
        lineWidth: 1,
        visible: true,
        LogId: curveLogId,
      };
    });
  }

  private initializeWidget(): void {
    if (!this.widgetComponent) return;

    try {
      this.wellLogWidget = this.timeBasedLogService.createWellLogWidget(
        this.widgetComponent.Canvas.nativeElement
      );
      this.widgetComponent.Widget = this.wellLogWidget;
      this.timeBasedThemeService.applyGeoToolkitTheme(
        this.wellLogWidget,
        this.isDarkTheme
      );
      this.createTracks();
      this.loadData();
    } catch (error) {
      console.error('❌ Error initializing widget:', error);
    }
  }

  private createTracks(): void {
    if (!this.wellLogWidget) return;

    const indexTrack = this.wellLogWidget.addTrack(TrackType.IndexTrack);
    if (indexTrack) {
      indexTrack.setName('Time Index');
      indexTrack.setWidth(150);

      // Find the existing axis on the index track and replace its tick generator
      const childCount = indexTrack.getChildrenCount();
      for (let i = 0; i < childCount; i++) {
        const child = indexTrack.getChild(i);
        if (child instanceof LogAxis) {
          const tickGen = new AdaptiveTickGenerator({
            spacing: 3 * 3600000, // 2 hours in milliseconds
          });
          tickGen.setFormatLabelHandler(
            (
              tickGenerator: any,
              parent: any,
              orientation: any,
              tickInfo: any,
              tickIndex: number,
              value: number
            ) => {
              const date = new Date(value);
              if (isNaN(date.getTime())) return '';
              let hours = date.getHours();
              const minutes = date.getMinutes();
              const ampm = hours >= 12 ? 'PM' : 'AM';
              hours = hours % 12;
              hours = hours ? hours : 12;
              const min = minutes.toString().padStart(2, '0');
              const monthNames = [
                'Jan',
                'Feb',
                'Mar',
                'Apr',
                'May',
                'Jun',
                'Jul',
                'Aug',
                'Sep',
                'Oct',
                'Nov',
                'Dec',
              ];
              const month = monthNames[date.getMonth()];
              const day = date.getDate();
              return `${month} ${day} ${hours}:${min} ${ampm}`;
            }
          );
          child.setTickGenerator(tickGen);
          break;
        }
      }
    }

    // Sort tracks by trackNo to ensure proper ordering
    const sortedTracks = [...this.listOfTracks].sort(
      (a, b) => a.trackNo - b.trackNo
    );

    sortedTracks.forEach((trackInfo) => {
      try {
        const logTrack = this.wellLogWidget!.addTrack(TrackType.LinearTrack);
        if (logTrack) {
          logTrack.setName(trackInfo.trackName);
          logTrack.setWidth(100);
          this.trackMap.set(trackInfo.trackNo, logTrack);
        }
      } catch (error) {
        console.error(
          `❌ Error creating track ${trackInfo.trackName} (trackNo: ${trackInfo.trackNo}):`,
          error
        );
      }
    });
  }

  private loadData(): void {
    if (!this.wellLogWidget || !this.wellboreObjects.length) return;

    // Group curves by LogId from static template (same pattern as dynamic track generator)
    const logIdCurves = new Map<string, ITimeCurve[]>();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve: ITimeCurve) => {
        if (!logIdCurves.has(curve.LogId!)) {
          logIdCurves.set(curve.LogId!, []);
        }
        logIdCurves.get(curve.LogId!)!.push(curve);
      });
    });

    console.log(
      `📊 Found ${logIdCurves.size} unique LogIds from template:`,
      Array.from(logIdCurves.keys())
    );

    // For each LogId, find matching backend header and load data
    logIdCurves.forEach((curves, logId) => {
      // Extract base names by removing suffixes (e.g., Surface_Time_SB -> Surface_Time)
      const logIdBase = logId.replace(/_[A-Z]+$/, '');

      // Match using base name comparison only (ignoring suffixes like _SB, _SLB, etc.)
      const matchingHeader = this.wellboreObjects.find((h) => {
        const headerBase = h.objectId.replace(/_[A-Z]+$/, '');
        return headerBase === logIdBase; // Base name match only
      });

      if (!matchingHeader) {
        console.warn(
          `⚠️ No backend header found for LogId: ${logId} (base: ${logIdBase})`
        );
        console.log(
          '🔍 Available backend headers:',
          this.wellboreObjects.map((h) => h.objectId)
        );
        return;
      }

      console.log(
        `✅ Loading data for LogId: ${logId} -> matched to header: ${matchingHeader.objectId}`
      );
      this.loadLogData(matchingHeader, curves);
    });
  }

  // --- Memory Management Properties ---

  private loadLogData(header: IWellboreObject, curves: ITimeCurve[]): void {
    // Direct access to header properties (no extractDateValues needed)
    const startTime = header.startIndex;
    const endTime = header.endIndex;
    console.error('start and end date values:', { startTime, endTime });
    if (!startTime || !endTime) {
      console.error('❌ Missing date values:', { startTime, endTime });
      return;
    }

    // Parse timestamps
    const parsedEndTime = new Date(endTime).getTime();
    const parsedStartTime = new Date(startTime).getTime();

    if (!parsedEndTime || !parsedStartTime) return;

    // Load 4-hour window initially (most recent data) for better performance
    const loadEndTime = parsedEndTime;
    const loadStartTime = parsedEndTime - 4 * 3600000; // 4 hours before end

    console.log(
      `🔧 Loading initial 4-hour window: ${new Date(
        loadStartTime
      ).toISOString()} to ${new Date(loadEndTime).toISOString()}`
    );

    // Create query parameters
    const queryParameter: ILogDataQueryParameter = {
      wellUid: this.well,
      logUid: header.objectId,
      wellboreUid: this.wellbore,
      logName: header.objectId,
      indexType: header.indexType,
      indexCurve: header.indexCurve,
      // 👇 USE THE 4-HOUR WINDOW 👇
      startIndex: new Date(loadStartTime).toISOString(),
      endIndex: new Date(loadEndTime).toISOString(),
      isGrowing: header.objectGrowing,
      mnemonicList: '',
    };

    console.log(
      ' new Date(loadStartTime).toISOString()',
      new Date(loadStartTime).toISOString()
    );
    console.log(
      ' new Date(loadEndTime).toISOString()',
      new Date(loadEndTime).toISOString()
    );

    console.log(`🔧 Loading data for LogId: ${header.uid}`);

    this.welldataService.getLogData(queryParameter).subscribe(
      (response: any) => this.processLogDataResponse(response, curves),
      (error) => console.error('❌ Error loading log data:', error)
    );
  }
  private maxMemoryHours = 8; // Keep maximum 8 hours of data in memory (reduced for performance)
  private cleanupThreshold = 6; // Start cleanup after 6 hours of data (earlier cleanup)

  // --- Memory Management Methods ---

  /**
   * Check if memory cleanup is needed and perform cleanup
   */
  private checkAndCleanupMemory(visibleRange?: {
    min: number;
    max: number;
  }): void {
    const totalDataHours = this.getTotalDataHours();

    if (totalDataHours > this.cleanupThreshold) {
      console.log(
        `🧹 Memory cleanup triggered: ${totalDataHours.toFixed(1)}h > ${
          this.cleanupThreshold
        }h threshold`
      );
      this.cleanupOldData(visibleRange);
    }
  }

  /**
   * Calculate total hours of data currently in memory
   */
  private getTotalDataHours(): number {
    for (const times of this.curveTimeIndices.values()) {
      if (times.length >= 2) {
        const timeSpan = times[times.length - 1] - times[0];
        return timeSpan / 3600000; // Convert to hours
      }
    }
    return 0;
  }

  /**
   * Clean up old data outside visible range to free memory
   */
  private cleanupOldData(visibleRange?: { min: number; max: number }): void {
    const keepBufferHours = 2; // Keep 2 hours buffer around visible data
    const cleanupCount = { before: 0, after: 0 };

    for (const [mnemonic, times] of this.curveTimeIndices.entries()) {
      if (times.length === 0) continue;

      let keepStartIndex = 0;
      let keepEndIndex = times.length - 1;

      if (visibleRange) {
        const keepStartTime = visibleRange.min - keepBufferHours * 3600000;
        const keepEndTime = visibleRange.max + keepBufferHours * 3600000;

        // Find indices to keep using binary search (fast)
        keepStartIndex = this.binarySearchForTime(times, keepStartTime);
        keepEndIndex = this.binarySearchForTime(times, keepEndTime);

        // Clamp to array bounds
        keepStartIndex = Math.max(0, keepStartIndex);
        keepEndIndex = Math.min(times.length - 1, keepEndIndex);
      } else {
        // If no visible range, keep only the most recent maxMemoryHours
        const cutoffTime =
          times[times.length - 1] - this.maxMemoryHours * 3600000;
        keepStartIndex = this.binarySearchForTime(times, cutoffTime);
        keepStartIndex = Math.max(0, keepStartIndex);
      }

      // Count how much we're removing
      cleanupCount.before += keepStartIndex;
      cleanupCount.after += times.length - 1 - keepEndIndex;

      // Keep only the relevant portion
      if (keepEndIndex > keepStartIndex) {
        const filteredTimes = times.slice(keepStartIndex, keepEndIndex + 1);
        this.curveTimeIndices.set(mnemonic, filteredTimes);

        // Also clean up curve data
        const curve = this.findCurveByMnemonic(mnemonic);

        if (curve && curve.data) {
          curve.data = curve.data.slice(keepStartIndex, keepEndIndex + 1);
        }
      }
    }

    console.log(
      `🧹 Memory cleanup completed: removed ${cleanupCount.before} points from start, ${cleanupCount.after} from end`
    );

    // Force garbage collection hint (only available in Chrome DevTools)
    if ((window as any).gc) {
      (window as any).gc();
    }
  }

  /**
   * Binary search for time index (O(log n) performance)
   */
  private binarySearchForTime(
    sortedTimes: number[],
    targetTime: number
  ): number {
    let left = 0;
    let right = sortedTimes.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (sortedTimes[mid] === targetTime) {
        return mid;
      } else if (sortedTimes[mid] < targetTime) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return left; // Returns insertion point
  }

  /**
   * Find curve by mnemonic ID
   */
  private findCurveByMnemonic(mnemonicId: string): ITimeCurve | undefined {
    for (const track of this.listOfTracks) {
      const curve = track.curves.find((c) => c.mnemonicId === mnemonicId);
      if (curve) return curve;
    }
    return undefined;
  }

  
  /**
   * Parses timestamp string to number, handling both Unix timestamps and ISO dates
   */
  private parseTimestamp(
    dateValue: string,
    type: 'start' | 'end'
  ): number | null {
    if (!dateValue) {
      console.error(`❌ ${type}DateValue is undefined`);
      return null;
    }

    let timestamp: number;

    if (!isNaN(Number(dateValue))) {
      timestamp = Number(dateValue);
    } else {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) {
        console.error(`❌ Invalid ${type} date format:`, dateValue);
        return null;
      }
      timestamp = date.getTime();
    }

    return timestamp;
  }

  private async processLogDataResponse(
    response: any,
    curves: ITimeCurve[]
  ): Promise<void> {
    console.log('🔧 Received response from service:', response);

    // Handle the actual server response structure: { logs: [{ logData: { mnemonicList, data } }] }
    if (
      !response ||
      !response.logs ||
      !response.logs[0] ||
      !response.logs[0].logData
    ) {
      console.error(
        '❌ Invalid response structure - expected logs[0].logData:',
        response
      );
      return;
    }

    const logDataResponse = response.logs[0].logData;
    const rawData = logDataResponse.data;
    const mnemonicList = logDataResponse.mnemonicList;

    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.error(
        '❌ Invalid data structure - expected array in logData.data:',
        rawData
      );
      return;
    }

    console.log(`🔧 Received ${rawData.length} data rows`);
    console.log('🔧 Server mnemonic list:', mnemonicList);

    // Create the logData structure expected by parseCurveData
    const logData: ILogDataResponse = {
      mnemonicList: mnemonicList,
      data: rawData,
    };

    // Process each curve with batch processing
    console.log(`🔄 Starting batch processing for ${curves.length} curves`);
    for (const curve of curves) {
      console.log(`🔧 Processing curve: ${curve.mnemonicId}`);
      await this.parseCurveData(logData, curve);
    }

    this.addCurvesToWidget();
    console.log(`✅ All curves processed and added to widget`);
  }

  private async parseCurveData(
    logData: ILogDataResponse,
    curve: ITimeCurve
  ): Promise<void> {
    const mnemonics = logData.mnemonicList.split(',');
    console.log('Server mnemonics ', mnemonics);
    console.log('Looking for  ', curve.mnemonicId);

    const curveIndex = mnemonics.findIndex(
      (m: string) => m.trim() === curve.mnemonicId
    );
    console.log('Found at index  ', curveIndex);
    const timeIndex = mnemonics.findIndex(
      (m: string) => m.trim() === 'RIGTIME'
    );
    console.log('Found at timeIndex  ', timeIndex);
    if (curveIndex === -1) {
      console.warn(`⚠️ Mnemonic not found: ${curve.mnemonicId}`);
      return;
    }

    // Debug logging
    console.log(
      `🔍 Debug: curve=${curve.mnemonicId}, curveIndex=${curveIndex}, timeIndex=${timeIndex}`
    );
    console.log(`🔍 Debug: mnemonics=`, mnemonics);
    console.log(`🔍 Debug: totalRows=${logData.data.length}`);
    if (logData.data.length > 0) {
      console.log(`🔍 Debug: first data row=`, logData.data[0]);
    }

    const times: number[] = [];
    const values: number[] = [];
    const batchSize = 250; // Process 250 rows at a time for better responsiveness
    const totalRows = logData.data.length;

    console.log(
      `🔄 Starting batch processing for ${curve.mnemonicId}: ${totalRows} rows`
    );

    // Process data in batches to prevent UI freezing
    for (let i = 0; i < totalRows; i += batchSize) {
      const batch = logData.data.slice(i, i + batchSize);

      // Process this batch
      batch.forEach((dataRow: string) => {
        const cols = dataRow.split(',');
        if (cols.length > curveIndex && cols[curveIndex]) {
          const value = parseFloat(cols[curveIndex]);

          let time: number;
          if (timeIndex >= 0) {
            const timeStr = cols[timeIndex];

            // Check if it's an ISO timestamp string
            if (timeStr.includes('T') && timeStr.includes('-')) {
              time = new Date(timeStr).getTime();
            } else {
              const parsedTime = parseFloat(timeStr);
              // Check if it's in years (like 2026) vs milliseconds (like 1738692795000)
              if (parsedTime < 10000) {
                time = new Date(parsedTime, 0, 1).getTime();
              } else {
                time = parsedTime;
              }
            }
          } else {
            time = NaN;
          }

          if (!isNaN(value) && !isNaN(time)) {
            times.push(time);
            values.push(value);
          }
        }
      });

      // Allow UI to breathe between batches
      if (i + batchSize < totalRows) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        console.log(
          `🔄 Processed ${Math.min(
            i + batchSize,
            totalRows
          )}/${totalRows} rows for ${curve.mnemonicId}`
        );
      }
    }

    console.log(
      `✅ Parsed ${times.length} points for curve ${curve.mnemonicId}`
    );
    // Debug: Show what was actually parsed
    console.log(`🔍 Debug: Final parsed data for ${curve.mnemonicId}:`);
    console.log(`   - Times count: ${times.length}`);
    console.log(`   - Values count: ${values.length}`);
    if (times.length > 0) {
      console.log(`   - First 3 times:`, times.slice(0, 3));
      console.log(`   - First 3 values:`, values.slice(0, 3));
      console.log(`   - Last 3 times:`, times.slice(-3));
      console.log(`   - Last 3 values:`, values.slice(-3));
    }

    curve.data = values;
    this.curveTimeIndices.set(curve.mnemonicId, times);
  }

  private addCurvesToWidget(): void {
    if (!this.wellLogWidget) return;

    // Sort tracks by trackNo to ensure proper ordering
    const sortedTracks = [...this.listOfTracks].sort(
      (a, b) => a.trackNo - b.trackNo
    );

    console.log('🔍 Debug: Adding curves to widget');
    console.log(
      '🔍 Debug: sortedTracks:',
      sortedTracks.map((t) => ({
        trackNo: t.trackNo,
        trackName: t.trackName,
        curvesCount: t.curves.length,
      }))
    );
    console.log(
      '🔍 Debug: trackMap entries:',
      Array.from(this.trackMap.keys())
    );

    let totalCurvesAdded = 0;
    let totalCurvesSkipped = 0;

    sortedTracks.forEach((trackInfo) => {
      console.log(
        `🔍 Processing track: ${trackInfo.trackName} (trackNo: ${trackInfo.trackNo})`
      );
      const track = this.trackMap.get(trackInfo.trackNo);
      if (!track) {
        console.warn(
          `⚠️ Track not found for trackNo: ${trackInfo.trackNo}, trackName: ${trackInfo.trackName}`
        );
        return;
      }

      trackInfo.curves.forEach((curveInfo: ITimeCurve) => {
        console.log(
          `🔍 Processing curve: ${curveInfo.mnemonicId}, data length: ${
            curveInfo.data?.length || 0
          }`
        );

        // Skip curves with no data
        if (!curveInfo.data?.length) {
          console.warn(
            `⚠️ No data for curve ${curveInfo.mnemonicId} in track ${trackInfo.trackNo} - skipping`
          );
          totalCurvesSkipped++;
          return;
        }

        // Also check if we have time indices for this curve
        const indexData = this.curveTimeIndices.get(curveInfo.mnemonicId);
        if (!indexData?.length) {
          console.warn(
            `⚠️ No time indices for curve ${curveInfo.mnemonicId} in track ${trackInfo.trackNo} - skipping`
          );
          totalCurvesSkipped++;
          return;
        }

        try {
          console.log(`🔍 Debug: Creating curve ${curveInfo.mnemonicId}:`);
          console.log(`   - Index data count: ${indexData.length}`);
          console.log(`   - Curve data count: ${curveInfo.data.length}`);
          if (indexData.length > 0) {
            console.log(
              `   - First index: ${indexData[0]}, Last index: ${
                indexData[indexData.length - 1]
              }`
            );
            console.log(
              `   - First value: ${curveInfo.data[0]}, Last value: ${
                curveInfo.data[curveInfo.data.length - 1]
              }`
            );
          }

          const geoLogData = new GeoLogData(curveInfo.mnemonicId);
          geoLogData.setValues(indexData, curveInfo.data);

          const curve = new LogCurve(geoLogData);
          curve.setLineStyle({
            color: curveInfo.color || '#63b3ed',
            width: curveInfo.lineWidth || 1,
          });
          curve.setName(curveInfo.mnemonicId);
          track.addChild(curve);

          totalCurvesAdded++;
          console.log(
            `✅ Added curve ${curveInfo.mnemonicId} to track ${trackInfo.trackName} (${indexData.length} points)`
          );
        } catch (error) {
          console.error(
            `❌ Error adding curve ${curveInfo.mnemonicId}:`,
            error
          );
          totalCurvesSkipped++;
        }
      });
    });

    console.log(
      `📊 Curve Summary: Added ${totalCurvesAdded} curves, skipped ${totalCurvesSkipped} curves`
    );

    // Only configure widget limits if we actually added some curves
    if (totalCurvesAdded > 0) {
      this.configureWidgetLimits();
    } else {
      console.warn('⚠️ No curves were added - skipping widget configuration');
    }
  }

  // private configureWidgetLimits(): void {
  //   if (!this.wellLogWidget) return;

  //   // Check if we have any actual data before configuring limits
  //   const actualDataRange = this.getTimeRange();
  //   if (!actualDataRange || actualDataRange.minTime === 0 || actualDataRange.maxTime === 0) {
  //     console.warn('⚠️ No data available for widget configuration - skipping');
  //     return;
  //   }

  //   console.log(
  //     `📊 Using actual data range: ${new Date(
  //       actualDataRange.minTime
  //     ).toISOString()} to ${new Date(actualDataRange.maxTime).toISOString()}`
  //   );

  //   // Get header range for widget limits - use actual data range as fallback
  //   let headerMinTime = actualDataRange.minTime;
  //   let headerMaxTime = actualDataRange.maxTime;

  //   // Try to get header range from wellbore objects
  //   for (const wo of this.wellboreObjects) {
  //     if (!this.matchedHeaders?.has(wo.objectId)) {
  //       continue;
  //     }
  //     const { startDateValue, endDateValue } = this.extractDateValues(wo);
  //     if (startDateValue && endDateValue) {
  //       const startTime = this.parseTimestamp(startDateValue, 'start');
  //       const endTime = this.parseTimestamp(endDateValue, 'end');
  //       if (startTime && endTime) {
  //         if (headerMinTime === 0 || startTime < headerMinTime) headerMinTime = startTime;
  //         if (headerMaxTime === 0 || endTime > headerMaxTime) headerMaxTime = endTime;
  //       }
  //     }
  //   }

  //   // // If still using epoch times, fall back to actual data range
  //   if (headerMinTime <= 1000000000000 || headerMaxTime <= 1000000000000) {
  //     console.warn('⚠️ Header times invalid, using actual data range as fallback');
  //     headerMinTime = actualDataRange.minTime;
  //     headerMaxTime = actualDataRange.maxTime;
  //   }

  //   // Configure widget for time-based data
  //   this.wellLogWidget.setIndexType('time', 'ms');

  //   // Set widget limits using HEADER range (start to end index)
  //   // TODO: Replace hardcoded range with actual header range from getLogHeaders()
  //   // Temporary hardcoded range for testing - includes actual data period
  //   const testDataStart = new Date('2026-01-13T12:16:24.095Z').getTime(); // Start of January 2026
  //   const testDataEnd = new Date('2026-02-10T06:46:46Z').getTime();   // End of January 2026
  //   console.log(`🔧 Testing with hardcoded range: ${new Date(testDataStart).toISOString()} to ${new Date(testDataEnd).toISOString()}`);
  //   this.wellLogWidget.setDepthLimits(testDataStart, testDataEnd);

  //   // Set visible range to 4 hours centered around actual data
  //   const fourHoursMs = 4 * 3600000; // 4 hours in milliseconds

  //   // Center the 4-hour window around the actual data period
  //   const actualDataCenter = (actualDataRange.minTime + actualDataRange.maxTime) / 2;
  //   const visibleMin = actualDataCenter - (fourHoursMs / 2); // 2 hours before center
  //   const visibleMax = actualDataCenter + (fourHoursMs / 2); // 2 hours after center

  //   // Ensure visible range is within widget bounds
  //   const finalVisibleMin = Math.max(testDataStart, visibleMin);
  //   const finalVisibleMax = Math.min(testDataEnd, visibleMax);

  //   console.log(`📊 Visible range: ${new Date(finalVisibleMin).toISOString()} to ${new Date(finalVisibleMax).toISOString()}`);

  //   this.wellLogWidget.setVisibleDepthLimits(finalVisibleMin, finalVisibleMax);

  //   // Update layout after all configurations
  //   this.wellLogWidget.updateLayout();

  //   // Initialize scroll tracking and start polling
  //   this.lastVisibleMin = finalVisibleMin;
  //   this.lastVisibleMax = finalVisibleMax;
  //   this.startScrollPolling();

  //   console.log(
  //     `📊 Widget limits: ${new Date(headerMinTime).toISOString()} to ${new Date(
  //       headerMaxTime
  //     ).toISOString()}, visible: ${new Date(finalVisibleMin).toISOString()} to ${new Date(
  //       finalVisibleMax
  //     ).toISOString()}, showing 4h window for scrolling`
  //   );
  // }

  //Update method for fix

  private configureWidgetLimits(): void {
    if (!this.wellLogWidget) return;

    // Check if we have any actual data before configuring limits
    const actualDataRange = this.getTimeRange();
    if (
      !actualDataRange ||
      actualDataRange.minTime === 0 ||
      actualDataRange.maxTime === 0
    ) {
      console.warn('⚠️ No data available for widget configuration - skipping');
      return;
    }

    // 👇 SIMPLIFIED HEADER EXTRACTION - NO extractDateValues() NEEDED 👇
    let headerMinTime = Infinity;
    let headerMaxTime = 0;

    this.wellboreObjects.forEach((header) => {
      // Direct access to header properties
      const startTime = header.startDateTimeIndex;
      const endTime = header.endDateTimeIndex;
      console.log(' header.startDateTimeIndex ', header.startDateTimeIndex);
      console.log(' header.endDateTimeIndex ', header.endDateTimeIndex);
      if (startTime && endTime) {
        const parsedStart = new Date(startTime).getTime();
        const parsedEnd = new Date(endTime).getTime();

        if (!isNaN(parsedStart) && !isNaN(parsedEnd)) {
          headerMinTime = Math.min(headerMinTime, parsedStart);
          headerMaxTime = Math.max(headerMaxTime, parsedEnd);
          console.log(
            `📅 Header ${header.objectId}: ${startTime} to ${endTime}`
          );
        }
      }
    });
    // 👇 END OF SIMPLIFIED EXTRACTION 👇

    // Use actual header range for widget limits
    if (headerMinTime !== Infinity && headerMaxTime !== 0) {
      console.log(
        `📊 Header range: ${new Date(
          headerMinTime
        ).toISOString()} to ${new Date(headerMaxTime).toISOString()}`
      );
      this.wellLogWidget.setDepthLimits(headerMinTime, headerMaxTime);
    } else {
      console.warn(
        '⚠️ No valid header time range found, using actual data range as fallback'
      );
      headerMinTime = actualDataRange.minTime;
      headerMaxTime = actualDataRange.maxTime;
      this.wellLogWidget.setDepthLimits(headerMinTime, headerMaxTime);
    }

    // Configure widget for time-based data
    this.wellLogWidget.setIndexType('time', 'ms');

    // Set initial visible range to show current data at bottom (most recent)
    const fourHoursMs = 4 * 3600000; // 4 hours in milliseconds
    const visibleMin = Math.max(headerMaxTime - fourHoursMs, headerMinTime);
    const visibleMax = headerMaxTime;

    console.log(
      `📊 Initial visible range: ${new Date(
        visibleMin
      ).toISOString()} to ${new Date(visibleMax).toISOString()}`
    );
    console.log(`📊 Scroll positioned at current data bottom (most recent)`);

    this.wellLogWidget.setVisibleDepthLimits(visibleMin, visibleMax);

    // Update layout after all configurations
    this.wellLogWidget.updateLayout();

    // Initialize scroll tracking and start polling
    this.lastVisibleMin = visibleMin;
    this.lastVisibleMax = visibleMax;
    this.startScrollPolling();

    console.log(
      `📊 Widget configured: Header range ${new Date(
        headerMinTime
      ).toISOString()} to ${new Date(
        headerMaxTime
      ).toISOString()}, showing 4h window at bottom for scrolling`
    );
  }

  private getTimeRange(): { minTime: number; maxTime: number } {
    let minTime = 0;
    let maxTime = 0;

    // Find the global min and max times across all curves
    for (const times of this.curveTimeIndices.values()) {
      if (times.length > 0) {
        const curveMin = Math.min(...times);
        const curveMax = Math.max(...times);

        if (minTime === 0 || curveMin < minTime) {
          minTime = curveMin;
        }
        if (maxTime === 0 || curveMax > maxTime) {
          maxTime = curveMax;
        }
      }
    }

    return { minTime, maxTime };
  }

  // --- Template event handlers ---

  onScaleChange(newScale: string): void {
    this.selectedScale = newScale;
    console.log('🕐 Scale changed internally to:', newScale);

    if (!this.wellLogWidget) return;

    const { minTime, maxTime } = this.getTimeRange();
    if (minTime === 0 || maxTime === 0) return;

    const scaleHours = parseFloat(newScale);

    if (scaleHours === 0) {
      // Fit to full data range
      this.wellLogWidget.setVisibleDepthLimits(minTime, maxTime);
    } else {
      // Show selected hours ending at the most recent data
      const windowMs = scaleHours * 3600000; // Convert hours to milliseconds
      const visibleMin = Math.max(maxTime - windowMs, minTime);
      this.wellLogWidget.setVisibleDepthLimits(visibleMin, maxTime);
    }

    this.wellLogWidget.updateLayout();
    console.log(
      `🕐 Scale changed to ${scaleHours} hours, visible range: ${new Date(
        maxTime - scaleHours * 3600000
      ).toISOString()} to ${new Date(maxTime).toISOString()}`
    );
  }

  onThemeChange(isDark: boolean): void {
    this.isDarkTheme = isDark;
    console.log('🕐 Theme changed internally to:', isDark ? 'dark' : 'light');
    if (this.wellLogWidget) {
      this.timeBasedThemeService.applyGeoToolkitTheme(
        this.wellLogWidget,
        isDark
      );
    }
  }

  toggleTheme(): void {
    this.onThemeChange(!this.isDarkTheme);
  }

  startLivePolling(): void {
    this.isLiveTracking = true;
    // TODO: Implement live polling logic
  }

  stopLivePolling(): void {
    this.isLiveTracking = false;
    // TODO: Implement stop polling logic
  }

  // --- Toolbar methods ---

  onResetView(): void {
    if (!this.wellLogWidget) return;
    const { minTime, maxTime } = this.getTimeRange();
    if (minTime === 0 || maxTime === 0) return;

    // Show centered window for better scrollbar visibility
    const scaleDays = parseFloat(this.selectedScale) || 1;
    const windowMs = scaleDays * 24 * 3600000; // Convert days to milliseconds
    const totalRange = maxTime - minTime;

    // Position the visible window in the middle-upper portion (70% from start)
    const visibleMin = Math.min(
      minTime + (totalRange - windowMs) * 0.7,
      maxTime - windowMs
    );
    const visibleMax = visibleMin + windowMs;

    this.wellLogWidget.setVisibleDepthLimits(visibleMin, visibleMax);
    this.wellLogWidget.updateLayout();
  }

  onScrollToLatest(): void {
    if (!this.wellLogWidget) return;
    const { minTime, maxTime } = this.getTimeRange();
    if (minTime === 0 || maxTime === 0) return;
    const scaleDays = parseFloat(this.selectedScale) || 1;
    const windowMs = scaleDays * 24 * 3600000; // Convert days to milliseconds
    const visibleMin = Math.max(maxTime - windowMs, minTime);
    this.wellLogWidget.setVisibleDepthLimits(visibleMin, maxTime);
    this.wellLogWidget.updateLayout();
  }

  onZoomIn(): void {
    if (!this.wellLogWidget) return;

    // Get current scale and make it larger (more detail)
    const currentScale = this.wellLogWidget.getDepthScale();
    const newScale = currentScale * 1.5; // 50% zoom in

    // Set maximum scale limit to prevent over-zooming
    const maxScale = 100000; // Maximum time units per pixel (adjust as needed)
    const finalScale = Math.min(newScale, maxScale);

    this.wellLogWidget.setDepthScale(finalScale);
    this.wellLogWidget.updateLayout();
    console.log('🔍 Zoomed in:', {
      oldScale: currentScale,
      newScale: finalScale,
      maxScale,
    });
  }

  onZoomOut(): void {
    if (!this.wellLogWidget) return;

    // Get current scale and make it smaller (less detail)
    const currentScale = this.wellLogWidget.getDepthScale();
    const newScale = currentScale * 0.67; // 33% zoom out

    // Set minimum scale limit to prevent over-shrinking
    const minScale = 1000; // Minimum time units per pixel (adjust as needed)
    const finalScale = Math.max(newScale, minScale);

    this.wellLogWidget.setDepthScale(finalScale);
    this.wellLogWidget.updateLayout();
    console.log('🔍 Zoomed out:', {
      oldScale: currentScale,
      newScale: finalScale,
      minScale,
    });
  }

  onEditToggle(enabled: boolean): void {
    console.log('✏️ Edit mode:', enabled);
    // TODO: Enable/disable annotation tool on the widget
  }

  onToolbarColorChange(color: string): void {
    console.log('🎨 Color changed:', color);
    // TODO: Apply color to selected track/curve
  }

  onRigTimeToggle(enabled: boolean): void {
    console.log('🕐 Rig Time:', enabled);
    // TODO: Toggle rig time display
  }

  onTimeRangeChange(range: { start: string; end: string }): void {
    // Handle custom time range from toolbar
    console.log('📅 Custom time range:', range);
    this.applyCustomTimeRange(range.start, range.end);
  }

  private stopScrollPolling(): void {
    if (this.scrollPollHandle) {
      clearInterval(this.scrollPollHandle);
      this.scrollPollHandle = null;
      console.log('⏹️ Stopped scroll polling');
    }
  }

  private startScrollPolling(): void {
    this.stopScrollPolling();
    console.log('▶️ Started scroll polling for dynamic loading');

    this.scrollPollHandle = setInterval(() => {
      this.checkScrollAndLoadData();
    }, 200); // Check scroll every 200ms for more responsive loading
  }

  private checkScrollAndLoadData(): void {
    if (!this.wellLogWidget) return;

    try {
      const visibleLimits = this.wellLogWidget.getVisibleDepthLimits();
      if (!visibleLimits) return;

      const currentVisibleMin = visibleLimits.getLow();
      const currentVisibleMax = visibleLimits.getHigh();

      // Check if user scrolled to load more data (with 5min buffer for earlier loading)
      const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
      const needsLoadEarlier =
        currentVisibleMin < this.lastVisibleMin - bufferMs;
      const needsLoadLater = currentVisibleMax > this.lastVisibleMax + bufferMs;

      if (needsLoadEarlier || needsLoadLater) {
        console.log(
          `🔄 Scroll detected: ${new Date(
            currentVisibleMin
          ).toISOString()} to ${new Date(currentVisibleMax).toISOString()}`
        );

        // Debounce scroll events to reduce excessive network calls
        if (this.scrollDebounceHandle) {
          clearTimeout(this.scrollDebounceHandle);
        }

        this.scrollDebounceHandle = setTimeout(() => {
          this.loadAdditionalData(
            currentVisibleMin,
            currentVisibleMax,
            needsLoadEarlier
          );
          this.lastVisibleMin = currentVisibleMin;
          this.lastVisibleMax = currentVisibleMax;
        }, 140); // 150ms debounce delay
      }
    } catch (error) {
      console.error('❌ Error checking scroll:', error);
    }
  }

  private loadAdditionalData(
    visibleMin: number,
    visibleMax: number,
    isScrollingUp: boolean = false
  ): void {
    // Group curves by LogId from static template (same pattern as loadData)
    const logIdCurves = new Map<string, ITimeCurve[]>();
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curve: ITimeCurve) => {
        if (!logIdCurves.has(curve.LogId!)) {
          logIdCurves.set(curve.LogId!, []);
        }
        logIdCurves.get(curve.LogId!)!.push(curve);
      });
    });

    console.log(
      `🔄 Loading additional data for ${
        logIdCurves.size
      } LogIds in range: ${new Date(visibleMin).toISOString()} to ${new Date(
        visibleMax
      ).toISOString()}`
    );

    // For each LogId, find matching backend header and load data
    logIdCurves.forEach((curves, logId) => {
      // Extract base names by removing suffixes (e.g., Surface_Time_SB -> Surface_Time)
      const logIdBase = logId.replace(/_[A-Z]+$/, '');

      // Match using base name comparison only (ignoring suffixes like _SB, _SLB, etc.)
      const matchingHeader = this.wellboreObjects.find((h) => {
        const headerBase = h.objectId.replace(/_[A-Z]+$/, '');
        return headerBase === logIdBase; // Base name match only
      });

      if (!matchingHeader) {
        console.warn(
          `⚠️ No backend header found for LogId: ${logId} (base: ${logIdBase})`
        );
        return;
      }

      console.log(
        `✅ Loading additional data for LogId: ${logId} -> matched to header: ${matchingHeader.objectId}`
      );
      this.loadAdditionalLogData(
        matchingHeader,
        curves,
        visibleMin,
        visibleMax,
        isScrollingUp
      );
    });
  }

  private loadAdditionalLogData(
    header: IWellboreObject,
    curves: ITimeCurve[],
    visibleMin: number,
    visibleMax: number,
    isScrollingUp: boolean = false
  ): void {
    // Defer memory cleanup to avoid blocking scroll performance
    setTimeout(() => {
      this.checkAndCleanupMemory({ min: visibleMin, max: visibleMax });
    }, 100);

    // Direct access to header properties (no extractDateValues needed)
    const startTime = header.startIndex;
    const endTime = header.endIndex;

    if (!startTime || !endTime) {
      console.error('❌ Missing date values in loadAdditionalLogData');
      return;
    }

    const headerStartTime = new Date(startTime).getTime();
    const headerEndTime = new Date(endTime).getTime();

    if (!headerStartTime || !headerEndTime) return;

    // Calculate load range based on scroll direction - use 4-hour chunks
    let loadMin: number;
    let loadMax: number;

    if (isScrollingUp) {
      // When scrolling up: load 4 hours before current visibleMin
      const fourHoursMs = 4 * 3600000;
      loadMin = Math.max(headerStartTime, visibleMin - fourHoursMs);
      loadMax = visibleMin; // Load up to current visible position
    } else {
      // Normal scrolling: load 4 hours beyond current visible range
      const fourHoursMs = 4 * 3600000;
      loadMin = Math.max(headerStartTime, visibleMax - fourHoursMs);
      loadMax = Math.min(headerEndTime, visibleMax + fourHoursMs);
    }

    console.log(
      `🔧 ${
        isScrollingUp ? 'Scroll up' : 'Normal'
      }: Loading 4h chunk ${new Date(loadMin).toISOString()} to ${new Date(
        loadMax
      ).toISOString()}`
    );
    console.log(
      `📊 Current memory usage: ${this.getTotalDataHours().toFixed(
        1
      )} hours of data`
    );

    // Check if we already have this data loaded
    const currentDataMin = this.getCurrentDataMinTime();
    const currentDataMax = this.getCurrentDataMaxTime();

    if (loadMin >= currentDataMin && loadMax <= currentDataMax) {
      console.log('📊 Data already loaded for this range');
      return;
    }

    console.log(
      `📥 Loading additional 4h chunk: ${new Date(
        loadMin
      ).toISOString()} to ${new Date(loadMax).toISOString()}`
    );

    const queryParameter: ILogDataQueryParameter = {
      wellUid: this.well,
      logUid: header.objectId,
      wellboreUid: this.wellbore,
      logName: header.objectId,
      indexType: header.indexType,
      indexCurve: header.indexCurve,
      startIndex: new Date(loadMin).toISOString(),
      endIndex: new Date(loadMax).toISOString(),
      isGrowing: false,
      mnemonicList: '',
    };

    this.welldataService.getLogData(queryParameter).subscribe(
      (response: any) => this.processAdditionalDataResponse(response),
      (error) => console.error('❌ Error loading additional data:', error)
    );
  }

  private getCurrentDataMinTime(): number {
    let minTime = Infinity;
    for (const times of this.curveTimeIndices.values()) {
      if (times.length > 0) {
        minTime = Math.min(minTime, times[0]);
      }
    }
    return minTime === Infinity ? 0 : minTime;
  }

  private getCurrentDataMaxTime(): number {
    let maxTime = 0;
    for (const times of this.curveTimeIndices.values()) {
      if (times.length > 0) {
        maxTime = Math.max(maxTime, times[times.length - 1]);
      }
    }
    return maxTime;
  }

  private processAdditionalDataResponse(response: any): void {
    console.log('📥 Processing additional data response');
    console.log('🔍 Full response structure:', response);

    // Handle the actual server response structure
    if (!response || !response.logs || !response.logs[0]) {
      console.error(
        '❌ Invalid additional data response - missing logs array:',
        response
      );
      return;
    }

    const logEntry = response.logs[0] || response.logs;
    console.log('🔍 Log entry structure:', logEntry);

    // Check for logData in the response
    if (!logEntry.logData) {
      console.error(
        '❌ Invalid additional data response - missing logData:',
        logEntry
      );
      return;
    }

    const logData = logEntry.logData;
    const rawData = logData.data;
    const mnemonicList = logData.mnemonicList;

    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.error(
        '❌ Invalid data structure - expected array in logData.data:',
        rawData
      );
      return;
    }

    if (!mnemonicList) {
      console.error(
        '❌ Invalid data structure - missing mnemonicList:',
        logData
      );
      return;
    }

    console.log(`📥 Processing ${rawData.length} additional data rows`);
    console.log('📥 Server mnemonic list:', mnemonicList);

    // Create the logData structure expected by parseAdditionalCurveData
    const formattedLogData: ILogDataResponse = {
      mnemonicList: mnemonicList,
      data: rawData,
    };

    // Find curves that need additional data
    this.listOfTracks.forEach((trackInfo) => {
      trackInfo.curves.forEach((curveInfo: ITimeCurve) => {
        const mnemonics = mnemonicList.split(',');
        const curveIndex = mnemonics.findIndex(
          (m: string) => m.trim() === curveInfo.mnemonicId
        );
        const timeIndex = mnemonics.findIndex(
          (m: string) => m.trim() === 'RIGTIME'
        );

        if (curveIndex !== -1 && timeIndex !== -1) {
          this.parseAdditionalCurveData(
            formattedLogData,
            curveInfo,
            curveIndex,
            timeIndex
          );
        }
      });
    });

    // Update curves with new data
    this.updateCurvesWithAdditionalData();
    console.log('✅ Additional data loaded and curves updated');
  }

  private parseAdditionalCurveData(
    logData: any,
    curve: ITimeCurve,
    curveIndex: number,
    timeIndex: number
  ): void {
    const existingTimes = this.curveTimeIndices.get(curve.mnemonicId) || [];
    const existingValues = curve.data || [];

    const newTimes: number[] = [];
    const newValues: number[] = [];

    logData.data.forEach((dataRow: string) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const value = parseFloat(cols[curveIndex]);
        const timeStr = cols[timeIndex];

        let time: number;
        if (timeStr.includes('T') && timeStr.includes('-')) {
          time = new Date(timeStr).getTime();
        } else {
          const parsedTime = parseFloat(timeStr);
          if (parsedTime < 10000) {
            time = new Date(parsedTime, 0, 1).getTime();
          } else {
            time = parsedTime;
          }
        }

        if (!isNaN(value) && !isNaN(time)) {
          // Only add if not already present
          if (!existingTimes.includes(time)) {
            newTimes.push(time);
            newValues.push(value);
          }
        }
      }
    });

    // Merge with existing data
    const allTimes = [...existingTimes, ...newTimes].sort((a, b) => a - b);
    const allValues = this.mergeValuesByTime(
      existingTimes,
      existingValues,
      newTimes,
      newValues
    );

    this.curveTimeIndices.set(curve.mnemonicId, allTimes);
    curve.data = allValues;
  }

  private mergeValuesByTime(
    existingTimes: number[],
    existingValues: number[],
    newTimes: number[],
    newValues: number[]
  ): number[] {
    const timeToValue = new Map<number, number>();

    // Add existing data
    existingTimes.forEach((time, index) => {
      timeToValue.set(time, existingValues[index]);
    });

    // Add new data
    newTimes.forEach((time, index) => {
      timeToValue.set(time, newValues[index]);
    });

    // Return values sorted by time
    return Array.from(timeToValue.entries())
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1]);
  }

  private updateCurvesWithAdditionalData(): void {
    if (!this.wellLogWidget) return;

    this.listOfTracks.forEach((trackInfo) => {
      const track = this.trackMap.get(trackInfo.trackNo);
      if (!track) return;

      trackInfo.curves.forEach((curveInfo: ITimeCurve) => {
        const indexData = this.curveTimeIndices.get(curveInfo.mnemonicId) || [];

        // Remove existing curve and add new one with updated data
        const existingCurves = track
          .getChildren()
          .filter(
            (child: any) =>
              child.getName && child.getName() === curveInfo.mnemonicId
          );
        existingCurves.forEach((curve: any) => track.removeChild(curve));

        const geoLogData = new GeoLogData(curveInfo.mnemonicId);
        geoLogData.setValues(indexData, curveInfo.data);

        const newCurve = new LogCurve(geoLogData);
        newCurve.setLineStyle({
          color: curveInfo.color || '#63b3ed',
          width: curveInfo.lineWidth || 1,
        });
        newCurve.setName(curveInfo.mnemonicId);
        track.addChild(newCurve);
      });
    });

    this.wellLogWidget.updateLayout();
  }

  // --- Template utility methods ---
  // private updateCurvesWithAdditionalData(): void {
  //   if (!this.wellLogWidget) return;

  //   this.listOfTracks.forEach(trackInfo => {
  //     const track = this.trackMap.get(trackInfo.trackNo);
  //     if (!track) return;

  //     trackInfo.curves.forEach((curveInfo: ITimeCurve) => {

  //       const indexData = this.curveTimeIndices.get(curveInfo.mnemonicId) || [];
  //       let existingCurve: any = null;

  //       // GeoToolkit iterator
  //       const iterator: any = track.getChildren();
  //       let node = iterator.next();

  //       while (!node.done) {
  //         const curve = node.value;

  //         if (curve && curve.getName && curve.getName() === curveInfo.mnemonicId) {
  //           existingCurve = curve;
  //           break;
  //         }

  //         node = iterator.next();
  //       }

  //       if (existingCurve) {

  //         const geoLogData = existingCurve.getLogData();

  //         if (geoLogData) {
  //           geoLogData.setValues(indexData, curveInfo.data);

  //           console.log(
  //             `✅ Updated existing curve ${curveInfo.mnemonicId} with ${indexData.length} points`
  //           );
  //         }

  //       } else {

  //         const geoLogData = new GeoLogData(curveInfo.mnemonicId);
  //         geoLogData.setValues(indexData, curveInfo.data);

  //         const newCurve = new LogCurve(geoLogData);

  //         newCurve.setLineStyle({
  //           color: curveInfo.color || '#63b3ed',
  //           width: curveInfo.lineWidth || 1
  //         });

  //         newCurve.setName(curveInfo.mnemonicId);

  //         track.addChild(newCurve);

  //         console.log(
  //           `✅ Created new curve ${curveInfo.mnemonicId} with ${indexData.length} points`
  //         );
  //       }

  //     });
  //   });

  //   this.wellLogWidget.updateLayout();
  //      // Start pre-loading adjacent chunks after current data is loaded
  //   //this.preloadAdjacentChunks();

  // }
  formatDateTimeForInput(date: Date | number): string {
    if (!date) return '';
    const dateObj = typeof date === 'number' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  calculateDuration(): string {
    if (this.indexCurveTime.length < 2) return '0:00:00';
    const duration =
      this.indexCurveTime[this.indexCurveTime.length - 1] -
      this.indexCurveTime[0];
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  calculateDataPointsPerHour(): number {
    if (this.indexCurveTime.length < 2) return 0;
    const durationHours =
      (this.indexCurveTime[this.indexCurveTime.length - 1] -
        this.indexCurveTime[0]) /
      3600000;
    return Math.round(this.indexCurveTime.length / durationHours);
  }

  applyCustomTimeRange(startTime: string, endTime: string): void {
    if (!startTime || !endTime) return;

    const start = this.parseTimestamp(startTime, 'start');
    const end = this.parseTimestamp(endTime, 'end');

    if (!start || !end || start >= end) return;

    this.wellLogWidget?.setVisibleDepthLimits(start, end);
  }

  getCurveColor(trackIndex: number): string {
    return this.timeBasedThemeService.getCurveColor(trackIndex);
  }
}
