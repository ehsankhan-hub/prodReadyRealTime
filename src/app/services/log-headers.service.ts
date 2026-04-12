import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { AuthService } from './authentication/auth.service';
import { ILogDataQueryParameter } from '../models/wellbore/wellbore-object';

/**
 * Interface representing curve information within a log header.
 */
export interface LogCurveInfo {
  '@uid': string;
  mnemonic: string;
  classIndex: string;
  unit: string;
}

/**
 * Interface representing a log header containing metadata about a well log.
 */
export interface LogHeader {
  '@uidWell': string;
  '@uidWellbore': string;
  nameWell: string;
  nameWellbore: string;
  creationDate: string;
  dataDelimiter: string;
  direction: string;
  endIndex?: {
    '@uom': string;
    '#text': string;
  };
  indexCurve: string;
  indexType: string;
  logCurveInfo: LogCurveInfo[];
  name: string;
  nullValue?: string;
  objectGrowing: string;
  startIndex?: {
    '@uom': string;
    '#text': string;
  };
  uid: string;
  endDateTimeIndex?: string;
  startDateTimeIndex?: string;
  pass?: string;
  runNumber?: string;
}

/**
 *parsedRows to prevent redundant string processing and date parsing.
 */
export interface LogData {
  '@uidWell': string;
  '@uidWellbore': string;
  logData: {
    mnemonicList: string;
    unitList: string;
    data: string[] | any[][]; // Raw strings OR numeric matrix
  };
  uid: string;
  isPreParsed?: boolean; // Flag for components
  startDateTimeIndex?: string;
  endDateTimeIndex?: string;
  /** Pre-parsed numeric matrix: [row][column]. Time is always converted to ms timestamp. */
  parsedRows?: any[][];
}

@Injectable({
  providedIn: 'root',
})
export class LogHeadersService {
  private baseUrl = 'http://localhost:3000';
  private URL = "https://exrtvt01/neolink_api/api";

  /** In-memory cache of all logData, keyed by "well|wellbore|logId" */
  private logDataCache = new Map<string, LogData[]>();
  /** Tracks if a fetch is already in progress for a cache key */
  private logDataFetchInProgress = new Map<string, Observable<LogData[]>>();

  constructor(private http: HttpClient, private authService: AuthService) { }

  /**
   * Retrieves time-based log headers for a specific well and wellbore.
   */
  getTimeLogHeaders(well: string, wellbore: string): Observable<LogHeader[]> {
    return this.http
      .get<LogHeader[]>(`${this.baseUrl}/timeLogHeaders`)
      .pipe(
        map((headers: LogHeader[]) =>
          headers.filter(
            (header) =>
              header['@uidWell'] === well && header['@uidWellbore'] === wellbore
          )
        )
      );
  }

  /**
   * Clears the log data cache to force a fresh fetch.
   */
  public clearCache(): void {
    console.log('🧹 Clearing LogHeadersService cache');
    this.logDataCache.clear();
    this.logDataFetchInProgress.clear();
  }

  /**
   * Retrieves time-based log data via POST request with authentication.
   * Optimized: Pre-parses raw string data into a numeric matrix upon initial fetch.
   */
  getTimeLogData(params: ILogDataQueryParameter): Observable<any> {
    const { wellUid, logUid, wellboreUid, indexCurve } = params;
    const startIndex = params.startIndex ?? '';
    const endIndex = params.endIndex ?? '';
    const cacheKey = `${wellUid}|${wellboreUid}|${logUid}|time|${startIndex}|${endIndex}`;

    const headers = new HttpHeaders({
      Authorization: `Bearer ${String(this.authService.getToken())}`,
    });

    // Serve from cache if available and range matches cached data
    if (this.logDataCache.has(cacheKey)) {
      const cached = this.logDataCache.get(cacheKey)!;
      const cachedData = cached[0];

      if (cachedData && this.isRangeInCache(cachedData, startIndex, endIndex)) {
        console.log(`✅ Cache Hit for ${logUid}: Range ${startIndex}-${endIndex}`);
        return of({ logs: this.sliceLogData(cached, startIndex, endIndex, indexCurve) });
      }
    }

    // Piggyback if already fetching
    if (this.logDataFetchInProgress.has(cacheKey)) {
      console.log(`⏳ Piggybacking in-flight fetch for ${logUid}`);
      return this.logDataFetchInProgress.get(cacheKey)!.pipe(
        map((filtered) => ({ logs: this.sliceLogData(filtered, startIndex, endIndex, indexCurve) }))
      );
    }

    console.log(`🌐 Fetching FRESH time logData for ${logUid} via POST...`);
    const shared$ = this.http.post(`${this.URL}/wells/logdata`, params, { headers }).pipe(
      map((response: any) => {
        const backendLog = response.logs?.[0];
        const logData: LogData = {
          '@uidWell': wellUid,
          '@uidWellbore': wellboreUid,
          uid: logUid,
          startDateTimeIndex: backendLog?.startDateTimeIndex || String(startIndex),
          endDateTimeIndex: backendLog?.endDateTimeIndex || String(endIndex),
          logData: {
            mnemonicList: backendLog?.logData?.mnemonicList || '',
            unitList: backendLog?.logData?.unitList || '',
            data: backendLog?.logData?.data || []
          }
        };

        // PERFORMANCE OPTIMIZATION: Parse numeric matrix once now so slice() is O(1) string work
        this.preParseLogData(logData, indexCurve);

        const fullDataset = [logData];
        this.logDataCache.set(cacheKey, fullDataset);
        this.logDataFetchInProgress.delete(cacheKey);

        console.log(`✅ Cached & Pre-parsed ${logData.logData.data?.length || 0} rows for ${logUid}`);
        return fullDataset;
      }),
      shareReplay(1)
    );

    this.logDataFetchInProgress.set(cacheKey, shared$);

    return shared$.pipe(
      map((filtered) => ({ logs: this.sliceLogData(filtered, startIndex, endIndex, indexCurve) }))
    );
  }

  /**
   * Helper to parse comma-separated string data into a numeric matrix once.
   * Converts ISO date strings to numeric timestamps immediately.
   */
  private preParseLogData(log: LogData, indexCurve?: string): void {
    if (!log.logData.data || log.logData.data.length === 0) return;

    const mnemonics = log.logData.mnemonicList.split(',').map(m => m.trim());
    const timeMnemonics = [indexCurve, 'RIGTIME', 'TIME', 'DATE', 'DATETIME', 'TIMESTAMP', 'Time'].filter(Boolean) as string[];

    let timeCol = -1;
    for (const tm of timeMnemonics) {
      timeCol = mnemonics.indexOf(tm);
      if (timeCol !== -1) break;
    }
    if (timeCol === -1) timeCol = 0;

    console.log(`🚀 Pre-parsing ${log.logData.data.length} rows for ${log.uid}. Time index: ${mnemonics[timeCol]}`);

    log.parsedRows = (log.logData.data as string[]).map(row => {
      const cols = row.split(',');
      return cols.map((val, idx) => {
        const trimmed = val?.trim();
        if (!trimmed) return null;

        // If this is the time column, parse as timestamp once
        if (idx === timeCol) {
          return trimmed.match(/^\d+$/) ? parseInt(trimmed) : new Date(trimmed).getTime();
        }

        // Otherwise try parsing as number, fallback to string if not numeric (e.g. MudLog text)
        const num = parseFloat(trimmed);
        return isNaN(num) ? trimmed : num;
      });
    });
  }

  /**
   * Checks if range is available using optimized pre-parsed data.
   */
  private isRangeInCache(cachedData: LogData, startIndex: number | string, endIndex: number | string): boolean {
    if (!cachedData || !cachedData.logData) return false;

    // Use parsedRows if available for speed
    const rows = cachedData.parsedRows || [];
    if (rows.length === 0) return false;

    // Time is always in parsedRows[row][indexCol]
    const mnemonics = cachedData.logData.mnemonicList.split(',').map(m => m.trim());
    const timeIdx = mnemonics.indexOf('RIGTIME');
    const idx = timeIdx !== -1 ? timeIdx : 0;

    const firstTime = rows[0][idx];
    const lastTime = rows[rows.length - 1][idx];

    const startNum = typeof startIndex === 'string' ? new Date(startIndex).getTime() : startIndex;
    const endNum = typeof endIndex === 'string' ? new Date(endIndex).getTime() : endIndex;

    return startNum >= firstTime && endNum <= lastTime;
  }

  /**
   * Optimized slicing logic: Uses numeric matrix (parsedRows) instead of raw strings.
   */
  private sliceLogData(logDataArr: LogData[], startIndex: number | string, endIndex: number | string, indexCurve?: string): LogData[] {
    return logDataArr.map(log => {
      const rows = log.parsedRows;
      if (!rows || rows.length === 0) return log;

      const mnemonics = log.logData.mnemonicList.split(',').map(m => m.trim());
      const timeMnemonics = [indexCurve, 'RIGTIME', 'TIME', 'DATE', 'DATETIME', 'TIMESTAMP', 'Time'].filter(Boolean) as string[];

      let indexCol = -1;
      for (const tm of timeMnemonics) {
        indexCol = mnemonics.indexOf(tm);
        if (indexCol !== -1) break;
      }
      if (indexCol === -1) indexCol = 0;

      const startTs = typeof startIndex === 'string' ? new Date(startIndex).getTime() : startIndex as number;
      const endTs = typeof endIndex === 'string' ? new Date(endIndex).getTime() : endIndex as number;

      // Slice the numeric matrix - much faster than string splitting in a filter loop
      const slicedParsedRows = rows.filter(row => {
        const ts = row[indexCol];
        return ts !== null && ts >= startTs && ts <= endTs;
      });

      console.log(`🕐 Slicing [${log.uid}]: Returned ${slicedParsedRows.length} rows (from ${rows.length} total)`);

      return {
        ...log,
        logData: {
          ...log.logData,
          data: slicedParsedRows
        },
        isPreParsed: true,
        parsedRows: slicedParsedRows 
      } as LogData;
    });
  }
}
