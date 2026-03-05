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
  private readonly USE_MOCK_DATA = false; // Use real server data

  constructor(private http: HttpClient) {}

  /**
   * Creates a WellLogWidget configured for time-based data
   */
  createWellLogWidget(container: HTMLElement): WellLogWidget {
    try {
      console.log('🎯 Creating time-based WellLogWidget...');
      
      const widget = new WellLogWidget({
        indextype: IndexType.Time,
        indexunit: 'ms',
        horizontalscrollable: false,
        verticalscrollable: true,
        header: {
          visible: true,
          height: 80
        },
        viewcache: true,
        trackcontainer: {
          border: { visible: true }
        }
      });

      // Set layout style like the working example
      widget.setLayoutStyle({
        left: 0, top: 0, right: 0, bottom: 0
      });

      console.log('✅ Time-based WellLogWidget created successfully');
      return widget;

    } catch (error) {
      console.error('❌ Error creating time-based WellLogWidget:', error);
      throw error;
    }
  }

  /**
   * Fetches time-based log headers
   */
  getTimeLogHeaders(wellId?: string, wellboreId?: string): Observable<any> {
    console.log(`📋 Fetching time-based log headers for well: ${wellId}, wellbore: ${wellboreId}`);
    
    if (this.USE_MOCK_DATA) {
      console.log('📋 Using mock data for headers');
      return new Observable(observer => {
        setTimeout(() => {
          const mockHeaders = this.generateMockHeaders();
          observer.next(mockHeaders);
          observer.complete();
        }, 500); // Simulate network delay
      });
    }
    
    if (wellId && wellboreId) {
      // Filter by specific well and wellbore - match actual database structure
      return this.http.get<any[]>(this.TIME_HEADERS_URL).pipe(
        map((headers: any[]) => {
          return headers.filter((header: any) => 
            header['@uidWell'] === wellId && header['@uidWellbore'] === wellboreId
          ).map((header: any) => ({
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
    
    // Return all headers if no filter specified
    return this.http.get<any[]>(this.TIME_HEADERS_URL).pipe(
      map((headers: any[]) => {
        return headers.map((header: any) => ({
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
    console.log('🔄 Fetching time-based log data:', queryParameter);
    
    if (this.USE_MOCK_DATA) {
      console.log('🔄 Using mock data for log data');
      return new Observable(observer => {
        setTimeout(() => {
          const mockData = this.generateMockLogData(queryParameter);
          observer.next(mockData);
          observer.complete();
        }, 300); // Simulate network delay
      });
    }
    
    // Use GET request instead of POST to avoid JSON server creating new records
    return this.http.get<any[]>(this.TIME_DB_URL).pipe(
      map((dataList: any[]) => {
        // Find the data that matches our query parameters
        const matchingData = dataList.find(data => 
          data.wellUid === queryParameter.wellUid && 
          data.logUid === queryParameter.logUid
        );
        
        if (matchingData) {
          return {
            indexData: matchingData.data.map((row: string) => {
              const values = row.split(',');
              return parseInt(values[0]); // Return timestamp as index
            }),
            curveData: this.parseCurveData(matchingData.data)
          };
        } else {
          throw new Error(`No data found for wellUid: ${queryParameter.wellUid}, logUid: ${queryParameter.logUid}`);
        }
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

  
  /**
   * Parses curve data from CSV format to curve objects
   */
  private parseCurveData(data: string[]): { [key: string]: number[] } {
    const curveData: { [key: string]: number[] } = {
      'TIME': [],
      'GR': [],
      'RT': [],
      'NPHI': [],
      'RHOB': [],
      'ROP': [],
      'WOB': [],
      'RPM': []
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
  
  /**
   * Generates mock headers for testing
   */
  private generateMockHeaders(): any[] {
    const now = new Date();
    const startTime = new Date(now.getTime() - 24 * 3600000); // 24 hours ago
    
    return [
      {
        uid: 'MWD_Time',
        name: 'MWD Time Log',
        wellId: 'HWYH_1389',
        wellboreId: 'HWYH_1389_0',
        indexType: 'TIME',
        indexCurve: 'TIME',
        startIndex: { '#text': startTime.toISOString() },
        endIndex: { '#text': now.toISOString() },
        indexUnit: 'ms',
        isGrowing: true,
        mnemonicList: 'TIME,GR,RT,NPHI,RHOB,ROP,WOB,RPM'
      }
    ];
  }
  
  /**
   * Generates mock log data for testing
   */
  private generateMockLogData(queryParameter: ILogDataQueryParameter): any {
    const { startIndex, endIndex } = queryParameter;
    const startTime = new Date(startIndex).getTime();
    const endTime = new Date(endIndex).getTime();
    const duration = endTime - startTime;
    const dataPoints = Math.min(100, Math.max(10, duration / (5 * 60000))); // One point per 5 minutes
    
    const data: string[] = [];
    
    for (let i = 0; i < dataPoints; i++) {
      const time = startTime + (i * duration / (dataPoints - 1));
      // Generate realistic-looking data
      const gr = (30 + Math.random() * 70 + Math.sin(i / 10) * 10).toFixed(1); // 30-100 API
      const rt = (1 + Math.random() * 79 + Math.cos(i / 8) * 5).toFixed(1); // 1-80 ohm.m
      const nphi = (1000 + Math.random() * 19000 + Math.sin(i / 12) * 2000).toFixed(0); // 1000-20000 PU
      const rhob = (15 + Math.random() * 45 + Math.cos(i / 15) * 3).toFixed(2); // 15-60 g/cm3
      const rop = (5 + Math.random() * 45 + Math.sin(i / 20) * 5).toFixed(1); // 5-50 m/hr
      const wob = (5 + Math.random() * 45 + Math.cos(i / 18) * 4).toFixed(1); // 5-50 klbs
      const rpm = (60 + Math.random() * 140 + Math.sin(i / 25) * 10).toFixed(0); // 60-200 rpm
      
      // Format as CSV string matching expected format
      data.push(`${time},${gr},${rt},${nphi},${rhob},${rop},${wob},${rpm}`);
    }
    
    // Return in the format expected by processLogDataResponse
    return {
      logs: [{
        logData: {
          data: data,
          mnemonicList: 'TIME,GR,RT,NPHI,RHOB,ROP,WOB,RPM',
          unitList: 'ms,API,ohm.m,v/v,g/cm3,m/hr,klbs,rpm',
          startIndex: startIndex,
          endIndex: endIndex,
          endDateTimeIndex: new Date(endTime).toISOString()
        }
      }]
    };
  }
}
