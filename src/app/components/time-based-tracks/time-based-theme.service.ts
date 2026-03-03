import { Injectable } from '@angular/core';
import { WellLogWidget } from '@int/geotoolkit/welllog/widgets/WellLogWidget';
import { CssStyle } from '@int/geotoolkit/css/CssStyle';

@Injectable({
  providedIn: 'root'
})
export class TimeBasedThemeService {
  
  /**
   * Applies theme to time-based GeoToolkit widget
   */
  applyGeoToolkitTheme(widget: WellLogWidget, isDarkTheme: boolean): void {
    if (!widget) {
      console.warn('⚠️ WellLogWidget not available for theme application');
      return;
    }

    try {
      console.log('🎨 Applying time-based GeoToolkit theme:', isDarkTheme ? 'dark' : 'light');
      
      // Define theme colors for time-based data
      const theme = isDarkTheme ? {
        headerBg: 'transparent',
        headerText: '#e2e8f0',
        headerBorder: '#4a5568',
        trackBg: '#233045',
        trackBorder: '#4a5568',
        gridLines: '#4a5568',
        axisText: '#e2e8f0',
        timeAxisText: '#9ca3af',
        curveColors: ['#63b3ed', '#f687b3', '#68d391', '#fbb6ce', '#90cdf4']
      } : {
        headerBg: 'transparent',
        headerText: '#2d3748',
        headerBorder: '#4a5568',
        trackBg: '#fcf8f7ff',
        trackBorder: '#e0cfcbff',
        gridLines: '#4a5568',
        axisText: '#4a5568',
        timeAxisText: '#6b7280',
        curveColors: ['#3182ce', '#d53f8c', '#38a169', '#ed64a6', '#2b6cb0']
      };

      // Create comprehensive CSS for time-based GeoToolkit elements
      const geoToolkitCSS = new CssStyle({
        css: [
          /* Header styles */
          '.geotoolkit.welllog.header.Header {',
          `  fillstyle: ${theme.headerBg};`,
          `  textstyle-color: ${theme.headerText};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Track container styles */
          '.geotoolkit.welllog.LogTrack {',
          `  fillstyle: ${theme.trackBg};`,
          `  linestyle-color: ${theme.trackBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Index track styles */
          '.geotoolkit.welllog.IndexTrack {',
          `  fillstyle: ${theme.trackBg};`,
          `  linestyle-color: ${theme.trackBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Index track headers */
          '.geotoolkit.welllog.IndexTrack .geotoolkit.welllog.header.Header,',
          '.geotoolkit.welllog.IndexTrack .geotoolkit.welllog.header.ScaleHeader,',
          '.geotoolkit.welllog.IndexTrack .geotoolkit.welllog.header.TitleHeader {',
          `  fillstyle: ${theme.headerBg};`,
          `  textstyle-color: ${theme.headerText};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Grid lines */
          '.geotoolkit.welllog.grid.Grid {',
          `  linestyle-color: ${theme.gridLines};`,
          '  linestyle-width: 0.5;',
          '}',
          
          /* Axis labels and text */
          '.geotoolkit.welllog.axis.Axis {',
          `  textstyle-color: ${theme.axisText};`,
          `  linestyle-color: ${theme.gridLines};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Time axis specific styling */
          '.geotoolkit.welllog.axis.Axis.time {',
          `  textstyle-color: ${theme.timeAxisText};`,
          `  linestyle-color: ${theme.gridLines};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Time grid lines */
          '.geotoolkit.welllog.grid.Grid.time {',
          `  linestyle-color: ${theme.gridLines};`,
          '  linestyle-width: 0.3;',
          '  linestyle-style: dashed;',
          '}',
          
          /* Curve visual headers */
          '.geotoolkit.welllog.header.AdaptiveLogCurveVisualHeader {',
          `  textstyle-color: ${theme.headerText};`,
          `  fillstyle: ${theme.headerBg};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Track title headers */
          '.geotoolkit.welllog.header.TitleHeader {',
          `  textstyle-color: ${theme.headerText};`,
          `  fillstyle: ${theme.headerBg};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Time scale headers */
          '.geotoolkit.welllog.header.ScaleHeader {',
          `  textstyle-color: ${theme.headerText};`,
          `  fillstyle: ${theme.headerBg};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}',
          
          /* Cross-hair tool for time-based data */
          '.geotoolkit.controls.tools.CrossHair {',
          `  linestyle-color: ${theme.axisText};`,
          '  linestyle-width: 1;',
          `  textstyle-color: ${theme.axisText};`,
          '}',
          
          /* Time-based selection box */
          '.geotoolkit.controls.tools.SelectionBox {',
          `  linestyle-color: ${theme.curveColors[0]};`,
          '  linestyle-width: 2;',
          `  fillstyle: ${theme.curveColors[0]}20;`, // Semi-transparent
          '}',
          
          /* Time marker styling */
          '.geotoolkit.welllog.marker.TimeMarker {',
          `  linestyle-color: ${theme.curveColors[1]};`,
          '  linestyle-width: 2;',
          `  fillstyle: ${theme.curveColors[1]}40;`,
          '}',
          
          /* Live data indicator */
          '.geotoolkit.welllog.indicator.LiveDataIndicator {',
          `  fillstyle: ${theme.curveColors[2]};`,
          `  textstyle-color: ${theme.headerText};`,
          '}',
          
          /* Time range selector */
          '.geotoolkit.controls.TimeRangeSelector {',
          `  fillstyle: ${theme.trackBg};`,
          `  linestyle-color: ${theme.trackBorder};`,
          `  textstyle-color: ${theme.axisText};`,
          '}',
          
          /* Time-based tooltip */
          '.geotoolkit.controls.Tooltip.time {',
          `  fillstyle: ${isDarkTheme ? '#1a202c' : '#ffffff'};`,
          `  textstyle-color: ${theme.headerText};`,
          `  linestyle-color: ${theme.headerBorder};`,
          '  linestyle-width: 1;',
          '}'
        ].join('\n')
      });

      // Apply the CSS to the widget
      widget.setCss(geoToolkitCSS);
      console.log('✅ Time-based GeoToolkit theme applied successfully');
      
    } catch (error) {
      console.error('❌ Error applying time-based GeoToolkit theme:', error);
    }
  }

  /**
   * Gets curve color for time-based tracks
   */
  getCurveColor(trackIndex: number): string {
    const colors = [
      '#3182ce', // Blue
      '#d53f8c', // Pink
      '#38a169', // Green
      '#ed64a6', // Purple
      '#2b6cb0', // Dark Blue
      '#dd6b20', // Orange
      '#319795', // Teal
      '#805ad5', // Violet
    ];
    
    return colors[trackIndex % colors.length];
  }

  /**
   * Gets time-based axis configuration
   */
  getTimeAxisConfig(isDarkTheme: boolean): any {
    const theme = isDarkTheme ? {
      textColor: '#e2e8f0',
      gridColor: '#4a5568',
      majorGridColor: '#718096',
      minorGridColor: '#2d3748'
    } : {
      textColor: '#4a5568',
      gridColor: '#cbd5e0',
      majorGridColor: '#a0aec0',
      minorGridColor: '#e2e8f0'
    };

    return {
      type: 'time',
      format: 'datetime',
      textColor: theme.textColor,
      majorGrid: {
        color: theme.majorGridColor,
        width: 1,
        step: 3600000 // 1 hour
      },
      minorGrid: {
        color: theme.minorGridColor,
        width: 0.5,
        step: 600000, // 10 minutes
        style: 'dashed'
      },
      label: {
        format: 'HH:mm',
        rotation: 0
      }
    };
  }

  /**
   * Gets time-based track styling
   */
  getTimeTrackStyling(isDarkTheme: boolean, trackType: string): any {
    const theme = isDarkTheme ? {
      backgroundColor: '#233045',
      borderColor: '#4a5568',
      headerColor: '#e2e8f0'
    } : {
      backgroundColor: '#fcf8f7ff',
      borderColor: '#e0cfcbff',
      headerColor: '#2d3748'
    };

    const baseStyling = {
      backgroundColor: theme.backgroundColor,
      borderColor: theme.borderColor,
      borderWidth: 1
    };

    switch (trackType) {
      case 'drilling':
        return {
          ...baseStyling,
          accentColor: '#3182ce',
          curveColors: ['#3182ce', '#2b6cb0', '#2c5282']
        };
      case 'gas':
        return {
          ...baseStyling,
          accentColor: '#38a169',
          curveColors: ['#38a169', '#48bb78', '#2f855a']
        };
      case 'time':
        return {
          ...baseStyling,
          accentColor: '#805ad5',
          curveColors: ['#805ad5', '#9f7aea', '#6b46c1']
        };
      default:
        return {
          ...baseStyling,
          accentColor: '#4a5568',
          curveColors: ['#4a5568', '#718096', '#2d3748']
        };
    }
  }

  /**
   * Updates theme for live data indicators
   */
  updateLiveDataIndicators(widget: WellLogWidget, isLive: boolean, isDarkTheme: boolean): void {
    try {
      const indicatorColor = isLive ? '#38a169' : '#718096';
      const indicatorCSS = new CssStyle({
        css: [
          '.geotoolkit.welllog.indicator.LiveDataIndicator {',
          `  fillstyle: ${indicatorColor};`,
          `  textstyle-color: ${isDarkTheme ? '#e2e8f0' : '#2d3748'};`,
          '}'
        ].join('\n')
      });
      
      widget.setCss(indicatorCSS);
      console.log(`✅ Live data indicator updated: ${isLive ? 'active' : 'inactive'}`);
      
    } catch (error) {
      console.error('❌ Error updating live data indicator:', error);
    }
  }
}
