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
  private baseUrl = 'http://localhost:3004';

  /**
   * Creates an instance of LogHeadersService.
   * @param http - Angular HttpClient for making HTTP requests
   */
  constructor(private http: HttpClient) { }

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
      map((headers: LogHeader[]) => headers.filter(header => 
        header['@uidWell'] === well && header['@uidWellbore'] === wellbore
      ))
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

  getLogData(well: string, wellbore: string, logId: string, startIndex: number, endIndex: number): Observable<LogData[]> {
    const cacheKey = `${well}|${wellbore}|${logId}`;

    // Serve from cache if available
    if (this.logDataCache.has(cacheKey)) {
      console.log(`📋 Cache hit for ${logId}, slicing ${startIndex}-${endIndex}`);
      const cached = this.logDataCache.get(cacheKey)!;
      return of(this.sliceLogData(cached, startIndex, endIndex));
    }

    // If a fetch is already in progress for this key, piggyback on its shared observable
    if (this.logDataFetchInProgress.has(cacheKey)) {
      console.log(`⏳ Fetch already in progress for ${logId}, piggybacking for ${startIndex}-${endIndex}`);
      return this.logDataFetchInProgress.get(cacheKey)!.pipe(
        map((filtered) => this.sliceLogData(filtered, startIndex, endIndex))
      );
    }

    // First fetch — download full dataset, cache it, share across concurrent subscribers
    console.log(`🌐 Fetching FULL logData for ${logId} (will cache for future chunk requests)`);
    const shared$ = this.http.get(`${this.baseUrl}/logData`).pipe(
      map((allData: any) => {
        const filtered = allData.filter((d: LogData) =>
          d.uidWell === well && d.uidWellbore === wellbore && d.uid === logId
        );
        // Store full dataset in cache
        this.logDataCache.set(cacheKey, filtered);
        this.logDataFetchInProgress.delete(cacheKey);
        console.log(`✅ Cached ${filtered.length} logData entries for ${logId} (${filtered[0]?.data?.length || 0} rows)`);
        return filtered;
      }),
      shareReplay(1)
    );

    this.logDataFetchInProgress.set(cacheKey, shared$);
    // Return sliced chunk from the shared observable
    return shared$.pipe(
      map((filtered) => this.sliceLogData(filtered, startIndex, endIndex))
    );
  }

  /**
   * Slices cached logData rows to the requested depth range.
   * 
   * @param logDataArr - Full cached logData array
   * @param startIndex - Start depth
   * @param endIndex - End depth
   * @returns LogData array with data rows filtered to the requested range
   */
  private sliceLogData(logDataArr: LogData[], startIndex: number, endIndex: number): LogData[] {
    return logDataArr.map(logData => {
      // Detect if time-based by checking mnemonicList for time columns
      const mnemonics = logData.mnemonicList.split(',').map(m => m.trim());
      const timeMnemonics = ['RIGTIME', 'TIME', 'DATETIME', 'TIMESTAMP', 'Time'];
      const depthMnemonics = ['DEPTH', 'MD', 'TVD', 'BITDEPTH', 'MWD_Depth'];
      
      let indexCol = -1;
      let isTimeBased = false;
      
      // Try depth mnemonics first
      for (const dm of depthMnemonics) {
        indexCol = mnemonics.indexOf(dm);
        if (indexCol !== -1) { isTimeBased = false; break; }
      }
      // If no depth, try time mnemonics
      if (indexCol === -1) {
        for (const tm of timeMnemonics) {
          indexCol = mnemonics.indexOf(tm);
          if (indexCol !== -1) { isTimeBased = true; break; }
        }
      }
      // Fallback to first column as depth
      if (indexCol === -1) { indexCol = 0; isTimeBased = false; }
      
      // Debug: Show the range being requested vs available data
      if (!isTimeBased && logData.data.length > 0) {
        const firstRow = logData.data[0].split(',');
        const lastRow = logData.data[logData.data.length - 1].split(',');
        const firstDepth = parseFloat(firstRow[indexCol]?.trim());
        const lastDepth = parseFloat(lastRow[indexCol]?.trim());
        console.log(`� Depth slicing for ${logData.uid}:`);
        console.log(`   Requested: ${startIndex} to ${endIndex}`);
        console.log(`   Available: ${firstDepth} to ${lastDepth}`);
        console.log(`   Index column: ${mnemonics[indexCol]} at position ${indexCol}`);
        console.log(`   Total rows: ${logData.data.length}`);
      }
      
      const slicedRows = logData.data.filter(row => {
        const cols = row.split(',');
        const colStr = cols[indexCol]?.trim();
        if (!colStr) return false;
        
        if (isTimeBased) {
          const ts = new Date(colStr).getTime();
          return !isNaN(ts) && ts >= startIndex && ts <= endIndex;
        } else {
          const depthVal = parseFloat(colStr);
          return !isNaN(depthVal) && depthVal >= startIndex && depthVal <= endIndex;
        }
      });
      
      if (isTimeBased) {
        console.log(`🕐 Time slicing result: ${slicedRows.length} rows from ${logData.data.length} total`);
      } else {
        console.log(`📏 Depth slicing result: ${slicedRows.length} rows from ${logData.data.length} total`);
      }
      
      // Handle office system data format - create startIndex/endIndex if they don't exist
      const startIndexObj = logData.startIndex || { '@uom': 'm', '#text': String(startIndex) };
      const endIndexObj = logData.endIndex || { '@uom': 'm', '#text': String(endIndex) };
      
      return {
        ...logData,
        data: slicedRows,
        startIndex: startIndexObj,
        endIndex: endIndexObj,
      };
    });
  }
}
