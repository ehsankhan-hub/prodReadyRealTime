import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { ILogDataQueryParameter } from '../../components/time-based-tracks/time-based-tracks.interfaces';

@Injectable({
  providedIn: 'root'
})
export class WellDataService {
  private readonly TIME_DB_URL = 'http://localhost:3004/timeLogData';
  private readonly TIME_HEADERS_URL = 'http://localhost:3004/timeLogHeaders';

  constructor(private http: HttpClient) {}

  /**
   * Creates a WellLogWidget configured for time-based data
   */
  createWellLogWidget(container: HTMLElement): WellLogWidget {
    const widget = new WellLogWidget({
      indextype: IndexType.Time,
      indexunit: 'ms',
      horizontalscrollable: false,
      verticalscrollable: true,
      header: { visible: true, height: 80 },
      viewcache: true,
      trackcontainer: { border: { visible: true } }
    });

    widget.setLayoutStyle({ left: 0, top: 0, right: 0, bottom: 0 });
    return widget;
  }

  /**
   * Fetches time-based log headers
   */
  getTimeLogHeaders(wellId?: string, wellboreId?: string): Observable<any> {
    return this.http.get<any[]>(this.TIME_HEADERS_URL).pipe(
      map((response: any) => {
        const headers = response.timeLogHeaders || response;
        
        const filteredHeaders = wellId && wellboreId
          ? headers.filter((header: any) => {
              const matchesWellbore = header['@uidWell'] === wellId && header['@uidWellbore'] === wellboreId;
              const isTimeRelated = header.uid && header.uid.toLowerCase().includes('time');
              return matchesWellbore && isTimeRelated;
            })
          : headers.filter((header: any) => {
              // If no well/wellbore specified, still filter for time-related headers only
              return header.uid && header.uid.toLowerCase().includes('time');
            });

        return filteredHeaders.map((header: any) => ({
          uid: header['uid'] , //  unique ID
          name: header.nameWellbore || 'Time Log',
          wellId: header['@uidWell'],
          wellboreId: header['@uidWellbore'],
          indexType: header.indexType?.toUpperCase() || 'TIME',
          indexCurve: header.indexCurve,
          startIndex: header.startIndex?.['#text'] || header.startIndex,
          endIndex: header.endIndex?.['#text'] || header.endIndex,
          indexUnit: header.startIndex?.['@uom'] || 'ms',
          isGrowing: header.direction === 'increasing',
          mnemonicList: header.logCurveInfo?.map((curve: any) => curve.mnemonic).join(',') || ''
        }));
      })
    );
  }

  /**
   * Fetches time-based log data in chunks
   */
  getLogDataChunk(queryParameter: ILogDataQueryParameter, chunkSizeDays: number = 2, chunkNumber: number = 1): Observable<any> {
    // Build query string from parameters
    const params = new HttpParams()
      .set('wellUid', queryParameter.wellUid || '')
      .set('logUid', queryParameter.logUid || '')
      .set('wellboreUid', queryParameter.wellboreUid || '')
      .set('startIndex', queryParameter.startIndex || '')
      .set('endIndex', queryParameter.endIndex || '');
    
    console.log('🔧 Sending chunk request with params:', params.toString());
    
    return this.http.get<any>(this.TIME_DB_URL, { params }).pipe(
      map((response: any) => {
        console.log('🔧 Raw server response:', JSON.stringify(response, null, 2));
        const dataList = response.logs || response.timeLogData || response;
        console.log('🔧 Extracted data list type:', typeof dataList);
        console.log('🔧 Extracted data list:', JSON.stringify(dataList, null, 2));
        console.log('🔧 Is data list an array?', Array.isArray(dataList));
        return this.findAndTransformChunkedData(dataList, queryParameter, chunkSizeDays, chunkNumber);
      })
    );
  }

  /**
   * Fetches time-based log data
   */
  getLogData(queryParameter: ILogDataQueryParameter): Observable<any> {
    // Build query string from parameters
    const params = new HttpParams()
      .set('wellUid', queryParameter.wellUid || '')
      .set('logUid', queryParameter.logUid || '')
      .set('wellboreUid', queryParameter.wellboreUid || '')
      .set('startIndex', queryParameter.startIndex || '')
      .set('endIndex', queryParameter.endIndex || '');
    
    return this.http.get<any>(this.TIME_DB_URL, { params }).pipe(
      map((response: any) => {
        // Return the raw server response without transformation
        console.log('🔧 Raw server response:', response);
        return response;
      })
    );
  }

  /**
   * Calculates time range for scaling
   */
  calculateTimeRange(scaleHours: number, endTime: Date): { start: Date, end: Date } {
    const startTime = new Date(endTime.getTime() - (scaleHours * 3600000));
    return { start: startTime, end: endTime };
  }

  private findAndTransformChunkedData(dataList: any[], queryParameter: ILogDataQueryParameter, chunkSizeDays: number, chunkNumber: number): any {
    // Handle the new server response format
    const logEntry = dataList.find(data => data.logData);
    
    if (!logEntry || !logEntry.logData) {
      console.warn(`⚠️ No logData found in response`);
      console.log('🔍 Available data entries:', dataList.map(d => ({ hasLogData: !!d.logData })));
      throw new Error('No logData found in response');
    }

    const matchingData = logEntry.logData;
    console.log(`✅ Found data for LogId: ${queryParameter.logUid}, processing ${matchingData.data?.length || 0} rows`);

    // Get the full time range
    const allTimestamps = matchingData.data.map((row: string) => parseInt(row.split(',')[0]));
    const minTime = Math.min(...allTimestamps);
    const maxTime = Math.max(...allTimestamps);
    
    // Calculate chunk size in milliseconds
    const chunkSizeMs = chunkSizeDays * 24 * 3600000;
    
    // Use the provided time range from query parameters
    const chunkStartTime = String(queryParameter.startIndex || '');
    const chunkEndTime = String(queryParameter.endIndex || '');
    
    console.log(`🔧 Service chunk parameters: startIndex=${chunkStartTime} (${new Date(parseInt(chunkStartTime)).toISOString()}), endIndex=${chunkEndTime} (${new Date(parseInt(chunkEndTime)).toISOString()})`);
    
    // Filter data for the current chunk
    const chunkData = matchingData.data.filter((row: string) => {
      const timestamp = parseInt(row.split(',')[0]);
      return timestamp >= parseInt(chunkStartTime) && timestamp <= parseInt(chunkEndTime);
    });

    console.log(`📦 Loading chunk: ${new Date(parseInt(chunkStartTime)).toISOString()} to ${new Date(parseInt(chunkEndTime)).toISOString()} (${chunkData.length} points)`);

    // Parse mnemonicList from queryParameter to get the correct order
    const mnemonicOrder = queryParameter.mnemonicList?.split(',').map(m => m.trim()) || [];
    console.log('🔍 Mnemonic order from header:', mnemonicOrder);

    return {
      indexData: chunkData.map((row: string) => {
        const values = row.split(',');
        return parseInt(values[0]); // First column is TIME timestamp
      }),
      curveData: this.parseCurveData(chunkData, mnemonicOrder),
      chunkInfo: {
        startTime: parseInt(chunkStartTime),
        endTime: parseInt(chunkEndTime),
        totalStartTime: minTime,
        totalEndTime: maxTime,
        chunkSize: chunkData.length,
        totalSize: matchingData.data.length,
        chunkNumber: chunkNumber,
        totalChunks: Math.ceil((maxTime - minTime) / chunkSizeMs)
      }
    };
  }

  private parseCurveData(data: string[], mnemonicOrder: string[]): { [key: string]: number[] } {
    // Initialize curveData object dynamically based on mnemonic order
    const curveData: { [key: string]: number[] } = {};
    mnemonicOrder.forEach(mnemonic => {
      curveData[mnemonic] = [];
    });
    
    data.forEach((row: string) => {
      const values = row.split(',');
      
      // Parse each column according to the mnemonic order
      mnemonicOrder.forEach((mnemonic, index) => {
        if (index < values.length && values[index]) {
          if (mnemonic === 'TIME' || mnemonic === 'RIGTIME') {
            // TIME and RIGTIME should be parsed as integer timestamp
            const timestamp = parseInt(values[index]);
            curveData[mnemonic].push(isNaN(timestamp) ? 0 : timestamp);
          } else {
            // Other curves should be parsed as float values
            const value = parseFloat(values[index]);
            curveData[mnemonic].push(isNaN(value) ? 0 : value);
          }
        } else {
          // Handle missing columns - push 0 or default value
          curveData[mnemonic].push(0);
        }
      });
    });
    
    console.log('📊 Parsed curve data:', Object.entries(curveData).map(([key, values]) => `${key}: ${values.length} points`));
    
    return curveData;
  }
}
