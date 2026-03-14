# Image Track Data for GeoToolkit

This directory contains data for image track visualization in your Angular application.

## Files:

### `log2DData.json`
- **Source**: Copied from Vue demo (`d:\GeoToolkit-js\examples\vue\demo\src\demos\welllog\welllog_widgets\data\log2DData.json`)
- **Purpose**: Color-coded formation data for Log2DVisual
- **Format**: Array of objects with `depth`, `values`, and `angles` properties
- **Usage**: Creates the same visual effect as the Vue demo's "Log 2D" track

## Image Track Types:

### 1. **Log2DVisual** (Current Implementation)
- **Purpose**: Color-coded data visualization (like formation images)
- **Data Source**: `log2DData.json` or generated data
- **Visual Effect**: Color gradients that change over time/depth
- **Use Case**: Formation properties, core image analysis, wellbore imaging

### 2. **RasterLog** (Alternative)
- **Purpose**: Actual image files (PNG, JPG)
- **Data Source**: Image files in `src/assets/images/core/`
- **Visual Effect**: Real photographs, scanned core images
- **Use Case**: Core photos, scanned documents, real images

## Data Structure (Log2DData.json):

```json
{
  "depth": 4650.0,
  "values": [0.1, 0.2, 0.3, ...],    // Color values (0-1)
  "angles": [0, 0.7, 1.4, ...]      // Angles for 360-degree coverage
}
```

## Implementation:

The current implementation uses **Log2DVisual** to create the same visual effect as the Vue demo:

```typescript
// Creates color-coded image track
const log2DVisual = new Log2DVisual({
  name: trackInfo.trackName,
  data: await this.loadVueDemoData()
});
```

## Switching Between Approaches:

### To use Log2DVisual (Current):
```typescript
trackType: 'image'  // Uses Log2DVisual with color data
```

### To use RasterLog (Image files):
```typescript
// Change createImageTrack method to use RasterLog
const rasterLog = new RasterLog({
  'formatter': (data) => ('path/to/image-' + data['i'] + 'x' + data['j'] + '.png'),
  'imagesize': new Rect(0, 0, width, height),
  'mapping': [{ 'src': sourceRect, 'dst': destRect }]
});
```

## Visual Result:

Your "Core Image" track will now display:
- ✅ Color-coded gradients (like Vue demo)
- ✅ Smooth transitions between colors
- ✅ Time-based color changes
- ✅ Professional formation visualization

The colors represent different formation properties and change over time, just like the Vue demo's "Log 2D" track!
