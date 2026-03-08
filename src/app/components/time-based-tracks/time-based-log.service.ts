import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { IndexType } from '@int/geotoolkit/welllog/IndexType';
import { ILogDataQueryParameter } from './time-based-tracks.component'; 

@Injectable({
  providedIn: 'root'
})
export class TimeBasedLogService {
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
          ? headers.filter((header: any) => 
              header['@uidWell'] === wellId && header['@uidWellbore'] === wellboreId
            )
          : headers;

        return filteredHeaders.map((header: any) => ({
          uid: header['@uidWell'] + '_' + header['@uidWellbore'], // Create unique ID
          name: header.nameWellbore || 'MWD Time Log',
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
   * Fetches time-based log data
   */
  getLogData(queryParameter: ILogDataQueryParameter): Observable<any> {
    return this.http.get<any>(this.TIME_DB_URL).pipe(
      map((response: any) => {
        const dataList = response.timeLogData || response;
        return this.findAndTransformData(dataList, queryParameter);
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

  

  private findAndTransformData(dataList: any[], queryParameter: ILogDataQueryParameter): any {
    // Find data by logUid (which should be the wellbore ID like 'HWYH_1389_HWYH_1389_0')
    const matchingData = dataList.find(data => 
      data.logUid === queryParameter.logUid || 
      data.id === queryParameter.logUid ||
      data.wellboreUid === queryParameter.wellboreUid
    );
    
    if (!matchingData) {
      console.warn(`⚠️ No data found for logUid: ${queryParameter.logUid}`);
      console.log('🔍 Available data entries:', dataList.map(d => ({ id: d.id, logUid: d.logUid, wellboreUid: d.wellboreUid })));
      throw new Error(`No data found for logUid: ${queryParameter.logUid}`);
    }

    console.log(`✅ Found data for LogId: ${queryParameter.logUid}, processing ${matchingData.data?.length || 0} rows`);

    // Parse mnemonicList from queryParameter to get the correct order
    const mnemonicOrder = queryParameter.mnemonicList?.split(',').map(m => m.trim()) || [];
    console.log('🔍 Mnemonic order from header:', mnemonicOrder);

    return {
      indexData: matchingData.data.map((row: string) => {
        const values = row.split(',');
        return parseInt(values[0]); // First column is TIME timestamp
      }),
      curveData: this.parseCurveData(matchingData.data, mnemonicOrder)
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
          if (mnemonic === 'TIME') {
            // TIME should be parsed as integer timestamp
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
