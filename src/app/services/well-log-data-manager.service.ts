import { Injectable, NgZone } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { WellDataService } from './well-service/well.service';
import {
  ILogDataQueryParameter,
  IWellboreObject,
  IWellboreLogData,
} from '../models/wellbore/wellbore-object';

export interface TrackCurve {
  mnemonicId: string;
  displayName: string;
  color: string;
  lineStyle: string;
  lineWidth: number;
  min: number;
  max: number;
  autoScale: boolean;
  show: boolean;
  LogId: string;
  data: number[];
  mnemonicLst: any[];
}

export interface CurveDataUpdate {
  mnemonicId: string;
  depths: number[];
  values: number[];
  isInitialLoad: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class WellLogDataManagerService {
  private readonly CHUNK_SIZE = 2000;
  private readonly LIVE_POLL_INTERVAL = 5000;

  private cachedHeaders: IWellboreObject[] = [];
  public headerMaxDepth = 0;
  private loadedRanges: Map<string, { min: number; max: number }> = new Map();
  private curveDepthIndices: Map<string, number[]> = new Map();
  private inFlightRanges: Set<string> = new Set();
  
  private livePollHandle: any = null;
  public isLivePolling = false;

  // Emits when a chunk of data is loaded for a specific curve
  public dataUpdated$ = new Subject<CurveDataUpdate>();
  
  // Emits when all initial unique LogId groups have finished loading
  public initialLoadComplete$ = new Subject<void>();

  constructor(
    private logHeadersService: WellDataService,
    private ngZone: NgZone
  ) {}

  public getCurveDepthIndices(): Map<string, number[]> {
    return this.curveDepthIndices;
  }

  public getCachedHeaders(): IWellboreObject[] {
    return this.cachedHeaders;
  }

  public getHeaderMaxDepth(): number {
    return this.headerMaxDepth;
  }

  public reset(): void {
    this.cachedHeaders = [];
    this.headerMaxDepth = 0;
    this.loadedRanges.clear();
    this.curveDepthIndices.clear();
    this.inFlightRanges.clear();
    this.stopLivePolling();
  }

  /**
   * Loads log headers and begins initial chunk loading for tracks.
   */
  public async loadLogHeaders(well: string, wellbore: string, curves: TrackCurve[], hasTimeIndexTrack: boolean): Promise<void> {
    this.reset();
    
    this.cachedHeaders = await this.logHeadersService.getLogHeader(well, wellbore);
    
    // Calculate global header max depth based on depth vs time
    this.cachedHeaders?.forEach((h) => {
      const endVal = h.endIndex?.['#text'] || h.endIndex;
      if (hasTimeIndexTrack) {
        try {
          const timestamp = new Date(endVal).getTime();
          if (!isNaN(timestamp) && timestamp > this.headerMaxDepth) {
            this.headerMaxDepth = timestamp;
          }
        } catch (e) {
          console.warn('⚠️ Invalid date format for endIndex:', endVal);
        }
      } else {
        const end = parseFloat(String(endVal));
        if (!isNaN(end) && end > this.headerMaxDepth) {
          this.headerMaxDepth = end;
        }
      }
    });

    // Group curves by LogId
    const logIdGroups = new Map<string, { header: IWellboreObject; curves: TrackCurve[] }>();
    curves.forEach((curve) => {
      const matchingHeader = this.cachedHeaders.find((h) => h.objectId.includes(curve.LogId));
      if (matchingHeader) {
        if (!logIdGroups.has(curve.LogId)) {
          logIdGroups.set(curve.LogId, { header: matchingHeader, curves: [] });
        }
        logIdGroups.get(curve.LogId)!.curves.push(curve);
      }
    });

    let pendingLoads = logIdGroups.size;
    if (pendingLoads === 0) {
      this.initialLoadComplete$.next();
      return;
    }

    const loadPromises: Promise<void>[] = [];
    
    logIdGroups.forEach(({ header, curves }, logId) => {
      let headerStart: number;
      let headerEnd: number;

      if (hasTimeIndexTrack) {
        const startVal = header.startIndex?.['#text'] || header.startIndex;
        const endVal = header.endIndex?.['#text'] || header.endIndex;
        headerStart = new Date(startVal).getTime() || 0;
        headerEnd = new Date(endVal).getTime() || Date.now();
      } else {
        headerEnd = parseFloat(header.endIndex?.['#text'] || header.endIndex || '1000');
        headerStart = parseFloat(header.startIndex?.['#text'] || header.startIndex || '0');
      }

      const chunkStart = Math.max(headerStart, headerEnd - this.CHUNK_SIZE);
      const chunkEnd = headerEnd;

      const startIndexStr = hasTimeIndexTrack ? new Date(chunkStart).toISOString() : chunkStart.toString();
      const endIndexStr = hasTimeIndexTrack ? new Date(chunkEnd).toISOString() : chunkEnd.toString();

      loadPromises.push(
        this.fetchChunkData(well, wellbore, header, curves, startIndexStr, endIndexStr, true)
          .finally(() => {
            pendingLoads--;
            if (pendingLoads <= 0) {
              this.initialLoadComplete$.next();
            }
          })
      );
    });

    await Promise.all(loadPromises);
  }

  private fetchChunkData(
    well: string,
    wellbore: string,
    header: IWellboreObject,
    curves: TrackCurve[],
    startIndex: string,
    endIndex: string,
    isInitialLoad: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const queryParameter: ILogDataQueryParameter = {
        wellUid: well,
        logUid: header.objectId,
        wellboreUid: wellbore,
        logName: header.objectName,
        indexType: header.indexType,
        indexCurve: header.indexCurve,
        startIndex: startIndex,
        endIndex: endIndex,
        isGrowing: header.objectGrowing,
        mnemonicList: '',
      };

      const result = this.logHeadersService.getLogData(queryParameter);

      if (result && typeof result.subscribe === 'function') {
        (result as any).subscribe({
          next: (logDataArray: any) => {
            if (logDataArray) {
              curves.forEach((curve) => this.parseAndEmitCurveData(logDataArray, curve, isInitialLoad));
            }
            resolve();
          },
          error: (err: any) => reject(err),
        });
      } else {
        try {
          if (result) {
            curves.forEach((curve) => this.parseAndEmitCurveData(result, curve, isInitialLoad));
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    });
  }

  private parseAndEmitCurveData(logDataArray: any, curve: TrackCurve, isInitialLoad: boolean): void {
    // Standard response format vs chunked format
    let dataObj;
    if (logDataArray?.logs?.[0]?.logData) {
      dataObj = logDataArray.logs[0].logData;
    } else {
      dataObj = logDataArray;
    }

    if (!dataObj || !dataObj.data || !dataObj.mnemonicList) return;

    const mnemonics = dataObj.mnemonicList.split(',');
    const curveIndex = mnemonics.findIndex((m: string) => m.trim() === curve.mnemonicId);
    if (curveIndex === -1) return;

    const depthMnemonics = ['DEPTH', 'MD', 'TVD', 'BITDEPTH', 'MWD_Depth'];
    const timeMnemonics = ['RIGTIME', 'TIME', 'DATETIME', 'TIMESTAMP'];

    let indexColIdx = depthMnemonics.reduce((res, m) => res !== -1 ? res : mnemonics.findIndex((x: any) => x.trim() === m), -1);
    let isDepthIndex = indexColIdx !== -1;

    if (indexColIdx === -1) {
      indexColIdx = timeMnemonics.reduce((res, m) => res !== -1 ? res : mnemonics.findIndex((x: any) => x.trim() === m), -1);
      if (indexColIdx !== -1) isDepthIndex = false;
    }
    if (indexColIdx === -1) {
      indexColIdx = 0;
      isDepthIndex = true;
    }

    const newDepths: number[] = [];
    const newValues: number[] = [];

    dataObj.data.forEach((dataRow: string) => {
      const cols = dataRow.split(',');
      if (cols.length > curveIndex && cols[curveIndex]) {
        const val = parseFloat(cols[curveIndex]);
        const idxStr = cols[indexColIdx];

        let idxVal = NaN;
        if (isDepthIndex) {
          idxVal = parseFloat(idxStr);
        } else {
          idxVal = new Date(idxStr).getTime();
        }

        if (!isNaN(val) && !isNaN(idxVal)) {
          newDepths.push(idxVal);
          newValues.push(val);
        }
      }
    });

    if (newDepths.length === 0) return;

    // Merge logic
    const existingDepths = this.curveDepthIndices.get(curve.mnemonicId) || [];
    const existingValues = curve.data || [];

    const depthValueMap = new Map<number, number>();
    for (let i = 0; i < existingDepths.length; i++) depthValueMap.set(existingDepths[i], existingValues[i]);
    for (let i = 0; i < newDepths.length; i++) depthValueMap.set(newDepths[i], newValues[i]);

    const sortedEntries = Array.from(depthValueMap.entries()).sort((a, b) => a[0] - b[0]);
    const mergedDepths = sortedEntries.map(e => e[0]);
    const mergedValues = sortedEntries.map(e => e[1]);

    curve.data = mergedValues;
    this.curveDepthIndices.set(curve.mnemonicId, mergedDepths);

    this.loadedRanges.set(curve.mnemonicId, {
      min: mergedDepths[0],
      max: mergedDepths[mergedDepths.length - 1]
    });

    this.dataUpdated$.next({
      mnemonicId: curve.mnemonicId,
      depths: mergedDepths,
      values: mergedValues,
      isInitialLoad
    });
  }

  public checkAndLoadChunks(well: string, wellbore: string, curves: TrackCurve[], hasTimeIndexTrack: boolean, vMin: number, vMax: number): Promise<void> {
    if (this.inFlightRanges.size >= 2) return Promise.resolve();

    const buffer = this.CHUNK_SIZE / 2;
    const needMin = Math.max(0, vMin - buffer);
    const needMax = Math.min(this.headerMaxDepth, vMax + buffer);

    const chunkRequests = new Map<string, { header: IWellboreObject; curves: TrackCurve[]; start: number; end: number }>();
    const logIdCurves = new Map<string, { header: IWellboreObject; curves: TrackCurve[]; range: { min: number; max: number } }>();

    curves.forEach((curve) => {
      if (logIdCurves.has(curve.LogId)) {
        logIdCurves.get(curve.LogId)!.curves.push(curve);
        return;
      }
      const matchingHeader = this.cachedHeaders.find((h) => h.objectId.includes(curve.LogId));
      if (!matchingHeader) return;
      
      const range = this.loadedRanges.get(curve.mnemonicId) || { min: 0, max: 0 };
      logIdCurves.set(curve.LogId, { header: matchingHeader, curves: [curve], range });
    });

    logIdCurves.forEach(({ header, curves, range }, logId) => {
      if (range.max === 0) {
        const chunkStart = Math.max(0, needMin - this.CHUNK_SIZE / 2);
        const chunkEnd = Math.min(this.headerMaxDepth, needMin + this.CHUNK_SIZE / 2);
        const key = `${logId}_${chunkStart}_${chunkEnd}`;
        if (!this.inFlightRanges.has(key)) chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
      } else {
        if (needMin < range.min && range.min > 0) {
          const chunkEnd = range.min;
          const chunkStart = Math.max(0, chunkEnd - this.CHUNK_SIZE);
          const key = `${logId}_${chunkStart}_${chunkEnd}`;
          if (!this.inFlightRanges.has(key)) chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
        }
        if (needMax > range.max && range.max < this.headerMaxDepth) {
          const chunkStart = range.max;
          const chunkEnd = Math.min(this.headerMaxDepth, chunkStart + this.CHUNK_SIZE);
          const key = `${logId}_${chunkStart}_${chunkEnd}`;
          if (!this.inFlightRanges.has(key)) chunkRequests.set(key, { header, curves, start: chunkStart, end: chunkEnd });
        }
      }
    });

    if (chunkRequests.size === 0) return Promise.resolve();

    const promises: Promise<void>[] = [];
    chunkRequests.forEach(({ header, curves, start, end }, key) => {
      this.inFlightRanges.add(key);
      const startIndex = hasTimeIndexTrack ? new Date(start).toISOString() : start.toString();
      const endIndex = hasTimeIndexTrack ? new Date(end).toISOString() : end.toString();
      
      promises.push(
        this.fetchChunkData(well, wellbore, header, curves, startIndex, endIndex, false)
          .finally(() => this.inFlightRanges.delete(key))
      );
    });

    return Promise.all(promises).then(() => {});
  }

  public startLivePolling(well: string, wellbore: string, curves: TrackCurve[], hasTimeIndexTrack: boolean): void {
    this.stopLivePolling();
    this.isLivePolling = true;

    this.livePollHandle = setInterval(() => {
      this.ngZone.run(() => {
        if (!this.isLivePolling) return;
        
        const logIdCurves = new Map<string, { header: IWellboreObject; curves: TrackCurve[]; maxLoaded: number }>();
        curves.forEach((curve) => {
          if (logIdCurves.has(curve.LogId)) {
            logIdCurves.get(curve.LogId)!.curves.push(curve);
            return;
          }
          const matchingHeader = this.cachedHeaders.find((h) => h.objectId.includes(curve.LogId));
          const range = this.loadedRanges.get(curve.mnemonicId);
          if (!matchingHeader || !range) return;
          logIdCurves.set(curve.LogId, { header: matchingHeader, curves: [curve], maxLoaded: range.max });
        });

        logIdCurves.forEach(({ header, curves, maxLoaded }, logId) => {
          const start = maxLoaded + 1;
          const end = start + this.CHUNK_SIZE;
          const key = `live_${logId}_${start}_${end}`;

          if (this.inFlightRanges.has(key)) return;
          this.inFlightRanges.add(key);

          const startIndex = hasTimeIndexTrack ? new Date(start).toISOString() : start.toString();
          const endIndex = hasTimeIndexTrack ? new Date(end).toISOString() : end.toString();

          this.fetchChunkData(well, wellbore, header, curves, startIndex, endIndex, false)
            .finally(() => this.inFlightRanges.delete(key));
        });
      });
    }, this.LIVE_POLL_INTERVAL);
  }

  public stopLivePolling(): void {
    if (this.livePollHandle) {
      clearInterval(this.livePollHandle);
      this.livePollHandle = null;
    }
    this.isLivePolling = false;
  }
}
