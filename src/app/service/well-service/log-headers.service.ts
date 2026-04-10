import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

/**
 * Interface representing curve information within a log header.
 * Contains metadata about individual measurement curves.
 */
export interface LogCurveInfo {
  /** Unique identifier for the curve */
  '@uid': string;
  /** Mnemonic/short name for the curve (e.g., 'GR', 'RT') */
  mnemonic: string;
  /** Index classification for the curve */
  classIndex: string;
  /** Unit of measurement for the curve values */
  unit: string;
}

/**
 * Interface representing a log header containing metadata about a well log.
 * Contains information about the well, wellbore, and available curves.
 */
export interface LogHeader {
  /** Unique identifier for the well */
  '@uidWell': string;
  /** Unique identifier for the wellbore */
  '@uidWellbore': string;
  /** Human-readable well name */
  nameWell: string;
  /** Human-readable wellbore name */
  nameWellbore: string;
  /** Date/time when the log was created */
  creationDate: string;
  /** Character used to delimit data values */
  dataDelimiter: string;
  /** Direction of index values (increasing/decreasing) */
  direction: string;
  /** Optional end index with unit and value */
  endIndex?: {
    '@uom': string;
    '#text': string;
  };
  /** Name of the index curve (e.g., 'DEPTH', 'TIME') */
  indexCurve: string;
  /** Type of index (e.g., 'measured depth', 'date time') */
  indexType: string;
  /** Array of curve information for this log */
  logCurveInfo: LogCurveInfo[];
  /** Display name for the log */
  name: string;
  /** Optional null value representation */
  nullValue?: string;
  /** Indicates if the log object is growing */
  objectGrowing: string;
  /** Optional start index with unit and value */
  startIndex?: {
    '@uom': string;
    '#text': string;
  };
  /** Unique identifier for this log header */
  uid: string;
  /** Alias for uid used in some query contexts */
  objectId?: string;
  /** Alias for name used in some query contexts */
  objectName?: string;
  /** Optional end date/time index */
  endDateTimeIndex?: string;
  /** Optional start date/time index */
  startDateTimeIndex?: string;
  /** Optional pass identifier */
  pass?: string;
  /** Optional run number */
  runNumber?: string;
}

/**
 * Interface representing actual log data values.
 * Contains the measurement data and associated metadata.
 */
export interface LogData {
  /** Unique identifier for the well */
  uidWell: string;
  /** Unique identifier for the wellbore */
  uidWellbore: string;
  /** Start index information with unit and value */
  startIndex: {
    '@uom': string;
    '#text': string;
  };
  /** End index information with unit and value */
  endIndex: {
    '@uom': string;
    '#text': string;
  };
  /** Comma-separated list of curve mnemonics */
  mnemonicList: string;
  /** Comma-separated list of curve units */
  unitList: string;
  /** Array of data rows, each containing comma-separated values */
  data: string[];
  /** Unique identifier for this log data */
  uid: string;
}

/**
 * Interface for log data query parameters.
 */
export interface ILogDataQueryParameter {
  wellUid: string;
  logUid: string;
  wellboreUid: string;
  logName?: string;
  indexType?: string;
  indexCurve?: string;
  startIndex: number | string;
  endIndex: number | string;
  isGrowing?: boolean;
  mnemonicList?: string;
}

/**
 * Service for fetching log headers and log data from the mock API.
 * Provides methods to retrieve well log information for display in the WellLogWidget.
 * 
 * @remarks
 * This service communicates with a json-server mock API running on localhost:3004.
 * Due to json-server limitations, filtering is performed client-side rather than server-side.
 */
@Injectable({
  providedIn: 'root'
})
export class LogHeadersService {
  /** Base URL for the mock API */
  private baseUrl = 'http://localhost:3000';

  /**
   * Creates an instance of LogHeadersService.
   * @param http - Angular HttpClient for making HTTP requests
   */
  constructor(private http: HttpClient) { }

  /**
   * Retrieves time-based log headers for a specific well and wellbore.
   * Fetches from the timeLogHeaders endpoint for time-based data.
   * 
   * @param well - Unique identifier for the well
   * @param wellbore - Unique identifier for the wellbore
   * @returns Observable emitting an array of filtered LogHeader objects
   */
  getTimeLogHeaders(well: string, wellbore: string): Observable<LogHeader[]> {
    return this.http.get<LogHeader[]>(`${this.baseUrl}/timeLogHeaders`).pipe(
      map((headers: LogHeader[]) => headers.filter(header =>
        header['@uidWell'] === well && header['@uidWellbore'] === wellbore
      ))
    );
  }

  /**
   * Retrieves log headers for a specific well and wellbore.
   * Fetches all headers and filters client-side by well and wellbore identifiers.
   * 
   * @param well - Unique identifier for the well
   * @param wellbore - Unique identifier for the wellbore
   * @returns Observable emitting an array of filtered LogHeader objects
   * 
   * @example
   * ```typescript
   * service.getLogHeaders('HWYH_1389', 'HWYH_1389_0')
   *   .subscribe(headers => console.log('Found headers:', headers));
   * ```
   */
  getLogHeaders(well: string, wellbore: string): Observable<LogHeader[]> {
    return this.http.get<LogHeader[]>(`${this.baseUrl}/logHeaders`).pipe(
      map((headers: LogHeader[]) => {
        return headers.filter(header =>
          header['@uidWell'] === well && header['@uidWellbore'] === wellbore
        );
      })
    );
  }

  /**
   * Retrieves log data for a specific well, wellbore, and log ID.
   * Fetches all log data and filters client-side due to json-server query limitations.
   * Supports chunked loading by slicing the data rows to the requested index range.
   * 
   * @param well - Unique identifier for the well
   * @param wellbore - Unique identifier for the wellbore
   * @param logId - Unique identifier for the specific log
   * @param startIndex - Starting depth/index for data range
   * @param endIndex - Ending depth/index for data range
   * @returns Observable emitting an array of filtered LogData objects with data sliced to the requested range
   * 
   * @example
   * ```typescript
   * service.getLogData('HWYH_1389', 'HWYH_1389_0', 'MWD_Time_SLB', 0, 2000)
   *   .subscribe(data => console.log('Log data chunk:', data));
   * ```
   * 
   * @remarks
   * The data rows are sliced client-side to simulate server-side chunked loading.
   * Each data row's first column is the depth index used for range filtering.
   */
  /** In-memory cache of all logData, keyed by "well|wellbore|logId" */
  private logDataCache = new Map<string, LogData[]>();
  /** Tracks if a fetch is already in progress for a cache key (shared observable emitting full filtered data) */
  private logDataFetchInProgress = new Map<string, Observable<LogData[]>>();

  getLogData(well: string, wellbore: string, logId: string, startIndex: number | string, endIndex: number | string): Observable<LogData[]> {
    const cacheKey = `${well}|${wellbore}|${logId}`;

    // Serve from cache if available and range matches cached data
    if (this.logDataCache.has(cacheKey)) {
      console.log(`📋 Cache hit for ${logId}, checking range ${startIndex}-${endIndex}`);
      const cached = this.logDataCache.get(cacheKey)!;
      const cachedData = cached[0];

      // Check if requested range is within cached data
      if (cachedData && this.isRangeInCache(cachedData, startIndex, endIndex)) {
        console.log(`✅ Range available in cache, slicing ${startIndex}-${endIndex}`);
        return of(this.sliceLogData(cached, startIndex, endIndex));
      } else {
        console.log(`🔄 Range not in cache, fetching new chunk ${startIndex}-${endIndex}`);
        return this.fetchChunk(cached, well, wellbore, logId, startIndex, endIndex);
      }
    }

    // If a fetch is already in progress for this key, piggyback on its shared observable
    if (this.logDataFetchInProgress.has(cacheKey)) {
      console.log(`⏳ Fetch already in progress for ${logId}, piggybacking for ${startIndex}-${endIndex}`);
      return this.logDataFetchInProgress.get(cacheKey)!.pipe(
        map((filtered) => this.sliceLogData(filtered, startIndex, endIndex))
      );
    }

    // First fetch — download initial chunk, cache it, share across concurrent subscribers
    console.log(`🌐 Fetching initial chunk for ${logId} (will cache for future chunk requests)`);
    const shared$ = this.http.get(`${this.baseUrl}/logData?uidWell=${well}&uidWellbore=${wellbore}&uid=${logId}&startIndex=${startIndex}&endIndex=${endIndex}`).pipe(
      map((fullData: any) => {
        // Store initial chunk in cache (wrap in array for consistency)
        const fullDataset = [fullData];
        this.logDataCache.set(cacheKey, fullDataset);
        this.logDataFetchInProgress.delete(cacheKey);
        console.log(`✅ Cached ${fullDataset.length} logData entries for ${logId} (${fullData?.data?.length || 0} rows)`);
        return fullDataset;
      }),
      shareReplay(1)
    );

    this.logDataFetchInProgress.set(cacheKey, shared$);
    // Return initial chunk from the shared observable
    return shared$;
  }

  /**
   * Clears the log data cache to force a fresh fetch on the next request.
   */
  public clearCache(): void {
    console.log('🧹 Clearing LogHeadersService cache');
    this.logDataCache.clear();
    this.logDataFetchInProgress.clear();
  }

  getTimeLogData(params: ILogDataQueryParameter): Observable<LogData[]> {
    const { wellUid, logUid, wellboreUid, startIndex, endIndex } = params;
    const cacheKey = `${wellUid}|${wellboreUid}|${logUid}|time`;

    // First fetch — download full dataset, cache it, share across concurrent subscribers
    console.log(`🌐 Fetching FULL time logData for ${logUid} (will cache for future chunk requests)`);
    const shared$ = this.http.get(`${this.baseUrl}/timeLogData?wellUid=${wellUid}&logUid=${logUid}&wellboreUid=${wellboreUid}&startIndex=${startIndex}&endIndex=${endIndex}`).pipe(
      map((response: any) => {
        // Convert time log response format to LogData format
        const logData: LogData = {
          uidWell: wellUid,
          uidWellbore: wellboreUid,
          uid: logUid,
          mnemonicList: response.logs?.[0]?.logData?.mnemonicList || '',
          unitList: '',
          startIndex: { '@uom': 's', '#text': '0' },
          endIndex: { '@uom': 's', '#text': '10000' },
          data: response.logs?.[0]?.logData?.data || []
        };

        // Store full dataset in cache (wrap in array for consistency)
        const fullDataset = [logData];
        this.logDataCache.set(cacheKey, fullDataset);
        this.logDataFetchInProgress.delete(cacheKey);
        console.log(`✅ Cached ${fullDataset.length} time logData entries for ${logUid} (${logData.data?.length || 0} rows)`);
        return fullDataset;
      }),
      shareReplay(1)
    );

    this.logDataFetchInProgress.set(cacheKey, shared$);
    // Return sliced chunk from the shared observable
    return shared$.pipe(
      map((filtered) => this.sliceTimeLogData(filtered, params))
    );
  }

  /**
   * Fetches a specific chunk of log data for the requested range.
   * 
   * @param logDataArr - Cached logData array (may not contain the requested range)
   * @param startIndex - Start depth
   * @param endIndex - End depth
   * @returns Observable that fetches the specific chunk
   */
  private fetchChunk(logDataArr: LogData[], well: string, wellbore: string, logId: string, startIndex: number | string, endIndex: number | string): Observable<LogData[]> {
    console.log(`🔄 Fetching new chunk for ${logId}: ${startIndex}-${endIndex}`);

    return this.http.get(`${this.baseUrl}/logData?uidWell=${well}&uidWellbore=${wellbore}&uid=${logId}&startIndex=${startIndex}&endIndex=${endIndex}`).pipe(
      map((chunkData: any) => {
        console.log(`✅ Fetched chunk for ${logId}: ${chunkData?.data?.length || 0} rows`);
        return [chunkData];
      })
    );
  }

  /**
   * Checks if the requested depth range is available in the cached data.
   * 
   * @param cachedData - Cached log data
   * @param startIndex - Requested start depth
   * @param endIndex - Requested end depth
   * @returns True if range is available in cache
   */
  private isRangeInCache(cachedData: LogData, startIndex: number | string, endIndex: number | string): boolean {
    if (!cachedData || !cachedData.data || cachedData.data.length === 0) {
      return false;
    }

    // Get the depth range from cached data
    const mnemonics = cachedData.mnemonicList?.split(',').map(m => m.trim());
    const depthIndex = mnemonics?.indexOf('DEPTH') ?? 0;

    const firstRow = cachedData.data[0].split(',');
    const lastRow = cachedData.data[cachedData.data.length - 1].split(',');

    const firstDepth = parseFloat(firstRow[depthIndex]?.trim());
    const lastDepth = parseFloat(lastRow[depthIndex]?.trim());

    // Normalize requested indices to numbers for cache range check
    const startNum = typeof startIndex === 'string' ? new Date(startIndex).getTime() : startIndex;
    const endNum = typeof endIndex === 'string' ? new Date(endIndex).getTime() : endIndex;

    return startNum >= firstDepth && endNum <= lastDepth;
  }

  /**
   * Dedicated depth-based slicing logic.
   */
  private sliceLogData(logDataArr: LogData[], startIndex: number | string, endIndex: number | string): LogData[] {
    return logDataArr.map(logData => {
      const mnemonics = logData.mnemonicList?.split(',').map(m => m.trim());
      const depthMnemonics = ['DEPTH', 'MD', 'TVD', 'BITDEPTH', 'MWD_Depth'];

      let indexCol = -1;
      for (const dm of depthMnemonics) {
        indexCol = mnemonics?.indexOf(dm);
        if (indexCol !== -1) break;
      }
      if (indexCol === -1) indexCol = 0; // Fallback to first column

      const startNum = typeof startIndex === 'string' ? parseFloat(startIndex) : startIndex;
      const endNum = typeof endIndex === 'string' ? parseFloat(endIndex) : endIndex;

      const slicedRows = logData.data?.filter(row => {
        const cols = row.split(',');
        const depthVal = parseFloat(cols[indexCol]?.trim());
        return !isNaN(depthVal) && depthVal >= startNum && depthVal <= endNum;
      });

      return {
        ...logData,
        data: slicedRows
      };
    });
  }

  /**
   * Dedicated time-based slicing logic for time logs.
   * Handles ISO date strings and numeric timestamps.
   */
  private sliceTimeLogData(logDataArr: LogData[], params: ILogDataQueryParameter): LogData[] {
    const { startIndex, endIndex, indexCurve, logUid } = params;
    
    return logDataArr.map(logData => {
      const mnemonics = logData.mnemonicList?.split(',').map(m => m.trim());
      // Prioritize the requested index curve or common time mnemonics
      const timeMnemonics = [indexCurve, 'RIGTIME', 'TIME', 'DATE', 'DATETIME', 'TIMESTAMP'].filter(Boolean) as string[];
      
      let indexCol = -1;
      for (const tm of timeMnemonics) {
        indexCol = mnemonics.indexOf(tm);
        if (indexCol !== -1) break;
      }

      if (indexCol === -1) {
        console.warn(`⚠️ No time index found for ${logUid}. Available: ${logData.mnemonicList}`);
        return logData;
      }

      const startTs = typeof startIndex === 'string' ? new Date(startIndex).getTime() : startIndex as number;
      const endTs = typeof endIndex === 'string' ? new Date(endIndex).getTime() : endIndex as number;

      const slicedRows = logData.data?.filter(row => {
        const cols = row.split(',');
        const colStr = cols[indexCol]?.trim();
        if (!colStr) return false;

        const ts = colStr.match(/^\d+$/) ? parseInt(colStr) : new Date(colStr).getTime();
        return !isNaN(ts) && ts >= startTs && ts <= endTs;
      });

      console.log(`🕐 Time slicing for ${logUid}: Found ${slicedRows?.length} rows in requested range`);

      return {
        ...logData,
        data: slicedRows
      };
    });
  }
}
