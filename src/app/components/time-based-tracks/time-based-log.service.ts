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
      map((headers: any[]) => {
        const filteredHeaders = wellId && wellboreId
          ? headers.filter((header: any) => 
              header['@uidWell'] === wellId && header['@uidWellbore'] === wellboreId
            )
          : headers;

        return filteredHeaders.map((header: any) => ({
          uid: header['@uidWell'] + '_' + header['@uidWellbore'],
          name: header.nameWell + ' - ' + header.nameWellbore,
          wellId: header['@uidWell'],
          wellboreId: header['@uidWellbore'],
          indexType: header.indexType?.toUpperCase() || 'TIME',
          indexCurve: header.indexCurve,
          startIndex: header.startIndex,
          endIndex: header.endIndex,
          indexUnit: header.endIndex?.['@uom'] || 'ms',
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
    return this.http.get<any[]>(this.TIME_DB_URL).pipe(
      map((dataList: any[]) => this.findAndTransformData(dataList, queryParameter))
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
    const matchingData = dataList.find(data => 
      data.wellUid === queryParameter.wellUid && 
      data.logUid === queryParameter.logUid
    );
    
    if (!matchingData) {
      throw new Error(`No data found for wellUid: ${queryParameter.wellUid}, logUid: ${queryParameter.logUid}`);
    }

    return {
      indexData: matchingData.data.map((row: string) => {
        const values = row.split(',');
        return parseInt(values[0]);
      }),
      curveData: this.parseCurveData(matchingData.data)
    };
  }

  private parseCurveData(data: string[]): { [key: string]: number[] } {
    const curveData: { [key: string]: number[] } = {
      'TIME': [], 'GR': [], 'RT': [], 'NPHI': [], 'RHOB': [], 'ROP': [], 'WOB': [], 'RPM': []
    };
    
    data.forEach((row: string) => {
      const values = row.split(',');
      if (values.length >= 8) {
        curveData['TIME'].push(parseInt(values[0]));
        curveData['GR'].push(parseFloat(values[1]));
        curveData['RT'].push(parseFloat(values[2]));
        curveData['NPHI'].push(parseFloat(values[3]));
        curveData['RHOB'].push(parseFloat(values[4]));
        curveData['ROP'].push(parseFloat(values[5]));
        curveData['WOB'].push(parseFloat(values[6]));
        curveData['RPM'].push(parseFloat(values[7]));
      }
    });
    
    return curveData;
  }
  
}
