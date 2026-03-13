# TimeBaseTrackNativeGeo Component

## Overview
`TimeBaseTrackNativeGeo` is an Angular component that leverages GeoToolkit's native data management capabilities for efficient time-based well log visualization. This component provides automatic scroll-based data loading, intelligent data merging, and optimized memory management without manual intervention.

## Key Features

### ✅ GeoToolkit Native Approach
- **Automatic Data Loading**: Uses GeoToolkit's `LogData` with automatic data appending
- **Scroll-Based Loading**: Detects scroll events and loads data on-demand with 30-minute buffer
- **Smart Range Tracking**: Tracks loaded data ranges to avoid duplicate requests
- **Efficient Merging**: Automatically merges overlapping time ranges

### ✅ Dynamic Track & Curve Creation
- **Multiple LogIds**: Supports multiple LogIds with different curves
- **One LogId, Multiple Curves**: Each LogId can contain multiple curves
- **Automatic Matching**: Matches frontend LogIds to backend headers using base name matching

### ✅ Performance Optimizations
- **Initial 4-Hour Window**: Loads most recent 4 hours on initialization
- **2-Hour Buffer**: Loads 2 hours beyond visible range for smooth scrolling
- **Range Merging**: Merges adjacent/overlapping loaded ranges to minimize memory
- **No Manual Cleanup**: GeoToolkit handles memory management internally

## Usage

### Basic Setup

```typescript
import { TimeBaseTrackNativeGeoComponent } from './components/time-base-track-native-geo/time-base-track-native-geo.component';

// In your component template
<app-time-base-track-native-geo
  [well]="wellId"
  [wellbore]="wellboreId"
  [listOfTracks]="trackConfiguration">
</app-time-base-track-native-geo>
```

### Track Configuration

```typescript
listOfTracks: ITracks[] = [
  {
    trackNo: 1,
    trackName: 'Drilling Parameters',
    trackType: 'linear',
    trackWidth: 150,
    isIndex: false,
    isDepth: false,
    curves: [
      {
        mnemonicId: 'ROP',
        displayName: 'Rate of Penetration',
        color: '#3182ce',
        lineStyle: 'solid',
        lineWidth: 1,
        min: 0,
        max: 100,
        autoScale: true,
        show: true,
        LogId: 'MWD_Time_SLB',
        data: [],
        mnemonicLst: []
      },
      {
        mnemonicId: 'WOB',
        displayName: 'Weight on Bit',
        color: '#d53f8c',
        lineStyle: 'solid',
        lineWidth: 1,
        min: 0,
        max: 50,
        autoScale: true,
        show: true,
        LogId: 'MWD_Time_SLB', // Same LogId, different curve
        data: [],
        mnemonicLst: []
      }
    ]
  }
];
```

## Architecture

### Data Flow
1. **Initialization**: Fetches log headers from backend
2. **Widget Setup**: Creates GeoToolkit widget with tracks and curves
3. **Initial Load**: Loads most recent 4-hour window for each LogId
4. **Scroll Detection**: Monitors visible range every 500ms
5. **Dynamic Loading**: Loads missing data ranges when scrolling
6. **Data Appending**: Merges new data with existing using GeoToolkit's `LogData.setValues()`

### Key Methods

#### `setupGeoToolkitNativeLoading()`
- Groups curves by LogId
- Matches LogIds to backend headers
- Creates GeoLogData instances for each curve
- Initiates initial data load

#### `checkScrollAndLoadData()`
- Monitors visible range changes
- Checks if additional data is needed
- Triggers data loading for missing ranges

#### `checkIfNeedsData()`
- Compares visible range with loaded ranges
- Calculates missing data segments
- Returns range to load or null if covered

#### `appendDataResponse()`
- Parses API response
- Merges new data with existing data
- Updates GeoLogData instances
- Refreshes widget display

## API Requirements

### Headers Endpoint
```
GET /timeLogHeaders?well={wellId}&wellbore={wellboreId}
```

Response:
```json
[
  {
    "uid": "MWD_Time_SLB",
    "name": "MWD Time Log",
    "indexType": "date time",
    "indexCurve": "TIME",
    "startIndex": "2024-01-01T00:00:00Z",
    "endIndex": "2024-01-02T00:00:00Z",
    "mnemonicList": "TIME,ROP,WOB,RPM"
  }
]
```

### Data Endpoint
```
POST /timeLogData
```

Request:
```json
{
  "wellUid": "well-123",
  "logUid": "MWD_Time_SLB",
  "wellboreUid": "wellbore-456",
  "startIndex": "2024-01-01T00:00:00Z",
  "endIndex": "2024-01-01T04:00:00Z"
}
```

Response:
```json
{
  "logs": [{
    "logData": {
      "mnemonicList": "TIME,ROP,WOB,RPM",
      "data": [
        "2024-01-01T00:00:00Z,45.5,25.3,120",
        "2024-01-01T00:01:00Z,46.2,26.1,125"
      ]
    }
  }]
}
```

## Differences from Original Component

| Feature | Original | Native Geo |
|---------|----------|------------|
| Data Loading | Manual polling | Scroll-based |
| Memory Management | Manual cleanup | Automatic |
| Data Merging | Manual array merging | GeoToolkit LogData |
| Scroll Detection | setInterval polling | Event-based |
| Range Tracking | Simple min/max | Range segments |
| Performance | Good | Excellent |

## Configuration Options

### Time Scale Options
- 4 hours (default)
- 8 hours
- 12 hours
- 24 hours
- All data

### Toolbar Features
- Theme toggle (light/dark)
- Zoom in/out
- Reset view
- Scroll to latest
- Custom time range selection

## Performance Tips

1. **Initial Window**: Keep initial load to 4 hours for fast startup
2. **Buffer Size**: 30-minute buffer prevents frequent API calls
3. **Range Merging**: Automatically reduces memory fragmentation
4. **Lazy Loading**: Only loads data when user scrolls to it

## Troubleshooting

### No Data Displayed
- Check that LogIds match between frontend config and backend headers
- Verify TIME or RIGTIME column exists in data
- Check browser console for API errors

### Scroll Loading Not Working
- Ensure scroll listener is initialized (check console logs)
- Verify loaded ranges are being tracked
- Check that `isLoadingData` flag is not stuck

### Performance Issues
- Reduce initial time window
- Increase scroll buffer to reduce API calls
- Check for memory leaks in browser DevTools

## Browser Compatibility
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Dependencies
- @int/geotoolkit/welllog
- Angular 14+
- RxJS 7+

## License
Proprietary - GeoToolkit License Required
