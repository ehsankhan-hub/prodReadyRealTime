const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Read database
// Helper to read database on each request to pick up changes without restart
const getDb = () => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));
    } catch (e) {
        console.error("❌ Error reading db.json:", e);
        return {};
    }
};

// Enable CORS
const enableCORS = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  next();
};

// Custom route for image data
const handleGetImageData = (req, res) => {
  console.log(`🖼️ API Call: getImageData`);
  
  // Read the new time-based image data
  const log2DData = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/assets/data/log2DData.json'), 'utf8'));
  
  if (log2DData && log2DData.length > 0) {
    console.log(`📊 Returning time-based image data: ${log2DData.length} rows`);
    console.log(`� Time range: ${new Date(log2DData[0].depth).toISOString()} to ${new Date(log2DData[log2DData.length-1].depth).toISOString()}`);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      imageData: log2DData
    }));
  } else {
    console.log(`❌ No image data found in log2DData.json`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Image data not found' }));
  }
};

// Custom route for time-based log headers
const handleTimeLogHeaders = (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  
  console.log(`🔍 API Call: timeLogHeaders for path:`, parsedUrl.pathname);
  
  // Handle both /timeLogHeaders/well/wellbore and /timeLogHeaders
  let well, wellbore;
  if (pathParts.length >= 3) {
    well = pathParts[1];
    wellbore = pathParts[2];
  }

  // Placeholder detection: if the user literally requested ':well', return everything
  const isPlaceholder = (well === ':well' || !well);
  if (isPlaceholder) {
    console.log(`🔍 Placeholder detected or well omitted. Returning all time-based headers.`);
  } else {
    console.log(`🔍 API Call: timeLogHeaders for ${well}/${wellbore}`);
  }
  
  // Collect all headers from both possible collections
  const db = getDb();
  const allHeaderSources = [
    { name: 'logHeaders', data: db.logHeaders || [] },
    { name: 'timeLogHeaders', data: db.timeLogHeaders || [] }
  ];

  const filteredHeaders = [];
  allHeaderSources.forEach(source => {
    const matched = source.data.filter(header => {
      // 1. Check if it's time related (by UID name or IndexType)
      const isTimeRelated = (header.uid && header.uid.toLowerCase().includes('time')) || 
                           (header.indexType && header.indexType.toLowerCase().includes('time'));
      
      if (!isTimeRelated) return false;

      // 2. Filter by wellbore if NOT using a placeholder
      if (!isPlaceholder) {
        return header['@uidWell'] === well && header['@uidWellbore'] === wellbore;
      }

      return true; // Match all time headers if placeholder or omitted
    });

    if (matched.length > 0) {
      console.log(`📊 Found ${matched.length} time headers in '${source.name}'`);
      filteredHeaders.push(...matched);
    }
  });
  
  console.log(`📊 Total time headers found: ${filteredHeaders.length}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(filteredHeaders));
};


// Custom route for time-based log data
const handleTimeLogData = (req, res) => {
  const db = getDb();
  const query = url.parse(req.url, true).query;
  console.log(`🔍 API Call: timeLogData with query:`, query);
  
  let { wellUid, logUid, wellboreUid, startIndex, endIndex } = query;

  // Safety check: if parameters are missing, return an error or a fallback
  if (!wellUid || !logUid || !wellboreUid) {
      console.log(`⚠️ Missing required parameters for timeLogData. Checking for fallback...`);
      if (db.timeLogData && db.timeLogData.length > 0) {
          console.log(`💡 Returning first available log as fallback.`);
          const fallbackLog = db.timeLogData[0];
          wellUid = fallbackLog.wellUid;
          wellboreUid = fallbackLog.wellboreUid;
          logUid = fallbackLog.logUid;
      } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing wellUid, logUid, or wellboreUid' }));
          return;
      }
  }

  console.log(`🔍 Looking for time log data with:`);
  console.log(`   wellUid: ${wellUid}`);
  console.log(`   logUid: ${logUid}`);
  console.log(`   wellboreUid: ${wellboreUid}`);

  
  // Debug: Show all available timeLogData entries
  console.log(`🔍 Available timeLogData entries:`);
  db.timeLogData.forEach((entry, index) => {
    console.log(`   ${index}: logUid=${entry.logUid}, logName=${entry.logName || 'N/A'}, wellboreUid=${entry.wellboreUid}`);
  });
  
  let timeLogEntry = db.timeLogData.find(log => 
    log.wellUid === wellUid && 
    log.logUid === logUid && 
    log.wellboreUid === wellboreUid
  );
  
  if (!timeLogEntry) {
    console.log(`🔍 Trying alternative match with id field...`);
    console.log(`   Looking for id: ${wellUid}_${wellboreUid}`);
    timeLogEntry = db.timeLogData.find(log => 
      log.wellUid === wellUid && 
      log.id === `${wellUid}_${wellboreUid}` && 
      log.wellboreUid === wellboreUid
    );
  }
  
  // If still not found, try matching by name field
  if (!timeLogEntry) {
    console.log(`🔍 Trying alternative match with name field...`);
    console.log(`   Available logNames in db: ${db.timeLogData.map(log => log.logName || log.logUid).join(', ')}`);
    timeLogEntry = db.timeLogData.find(log => 
      log.wellUid === wellUid && 
      (log.logName === logUid || log.logUid === logUid) && 
      log.wellboreUid === wellboreUid
    );
  }
  
  // If still not found, try partial matching (in case logUid has extra characters)
  if (!timeLogEntry) {
    console.log(`🔍 Trying partial match on logUid...`);
    timeLogEntry = db.timeLogData.find(log => 
      log.wellUid === wellUid && 
      (log.logUid.includes(logUid) || logUid.includes(log.logUid)) && 
      log.wellboreUid === wellboreUid
    );
  }
  
  if (!timeLogEntry) {
    console.log(`🔍 Trying match by removing suffix numbers...`);
    const cleanLogUid = (logUid || "").replace(/\d+$/, ''); // Remove trailing numbers
    console.log(`   Cleaned logUid: ${cleanLogUid}`);
    timeLogEntry = db.timeLogData.find(log => 
      log.wellUid === wellUid && 
      log.logUid === cleanLogUid && 
      log.wellboreUid === wellboreUid
    );
  }
  
  if (!timeLogEntry) {
    console.log(`❌ No time log data found for ${wellUid}/${wellboreUid}/${logUid}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Time log data not found' }));
    return;
  }
  
  console.log(`📊 Found time log data with ${timeLogEntry.data.length} records`);
  
  // Filter data by time range if startIndex and endIndex are provided
  let filteredData = timeLogEntry.data;
  if (startIndex && endIndex) {
    let startTime, endTime;
    
    // Handle both ISO strings and Unix timestamp strings
    if (startIndex.includes('T') || startIndex.includes('-')) {
      // ISO timestamp string
      startTime = new Date(startIndex).getTime();
      endTime = new Date(endIndex).getTime();
    } else {
      // Unix timestamp string (in milliseconds)
      startTime = parseInt(startIndex);
      endTime = parseInt(endIndex);
    }
    
    console.log(`🔍 Filtering data from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
    console.log(`🔍 Requested range: ${startIndex} to ${endIndex}`);
    console.log(`🔍 Converted to timestamps: ${startTime} to ${endTime}`);
    
    filteredData = timeLogEntry.data.filter(row => {
      const timeStr = row.split(',')[0]; // First column is TIME
      let timestamp;
      
      // Handle both ISO strings and numeric timestamps in data
      if (timeStr.includes('T') || timeStr.includes('-')) {
        // ISO timestamp string
        timestamp = new Date(timeStr).getTime();
      } else {
        // Numeric timestamp
        timestamp = parseInt(timeStr);
      }
      
      return timestamp >= startTime && timestamp <= endTime;
    });
    
    console.log(`📊 Filtered to ${filteredData.length} records in time range`);
  }
  
  // Find matching time log header to get correct mnemonics
  let timeLogHeader = db.timeLogHeaders.find(header => 
    header['@uidWell'] === wellUid && 
    header.uid === logUid && 
    header['@uidWellbore'] === wellboreUid
  );
  
  if (!timeLogHeader) {
      // Fallback to checking normal logHeaders
      timeLogHeader = db.logHeaders.find(header => 
        header['@uidWell'] === wellUid && 
        header.uid === logUid && 
        header['@uidWellbore'] === wellboreUid
      );
  }
  
  console.log(`🔍 Found matching header:`, timeLogHeader ? timeLogHeader.uid : 'None');
  
  // Generate mnemonic list dynamically based on actual data columns
  let mnemonicList = 'TIME,GR,RT,NPHI,RHOB,PEF,EXTRA1,EXTRA2'; // Default fallback
  if (timeLogHeader && timeLogHeader.logCurveInfo) {
    // Use header mnemonics as base
    const headerMnemonics = timeLogHeader.logCurveInfo.map(curve => curve.mnemonic);
    
    // Count actual columns in the first data row
    const firstDataRow = timeLogEntry.data[0];
    const actualColumnCount = firstDataRow.split(',').length;
    
    // Generate mnemonics to match actual column count
    if (actualColumnCount > headerMnemonics.length) {
      // Add extra mnemonics for additional columns
      const extrasNeeded = actualColumnCount - headerMnemonics.length;
      const extraMnemonics = [];
      for (let i = 1; i <= extrasNeeded; i++) {
        extraMnemonics.push(`EXTRA${i}`);
      }
      mnemonicList = [...headerMnemonics, ...extraMnemonics].join(',');
    } else {
      // Use only the needed header mnemonics
      mnemonicList = headerMnemonics.slice(0, actualColumnCount).join(',');
    }
    
    console.log(`🔧 Dynamic mnemonics: ${mnemonicList} (${actualColumnCount} columns)`);
  } else {
    // Fallback: count columns in first data row and generate mnemonics
    const firstDataRow = timeLogEntry.data[0];
    const actualColumnCount = firstDataRow.split(',').length;
    const fallbackMnemonics = ['TIME', 'GR', 'RT', 'NPHI', 'RHOB', 'PEF', 'EXTRA1', 'EXTRA2'];
    mnemonicList = fallbackMnemonics.slice(0, actualColumnCount).join(',');
    console.log(`⚠️ No header found, using dynamic fallback mnemonics: ${mnemonicList} (${actualColumnCount} columns)`);
  }
  
  // Return the time log data in expected format matching the image
  const responseData = {
    logs: [{
      uidWell: wellUid,
      uidWellbore: wellboreUid,
      startDateTimeIndex: timeLogEntry.startIndex, // Use actual data start time
      endDateTimeIndex: timeLogEntry.endIndex,   // Use actual data end time
      uid: logUid,
      logData: {
        data: filteredData,
        mnemonicList: mnemonicList,
        unitList: "ISO,API,ohm.m,v/v,gAPI,PE,unit1,unit2",
        startDateTimeIndex: timeLogEntry.startIndex,
        uid: logUid
      }
    }]
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseData));
};

// Custom route for getLogHeaders
const handleGetLogHeaders = (req, res) => {
  const db = getDb();
  let well, wellbore;
  
  // Check if it's the old format with path parameters
  if (req.url.startsWith('/api/getLogHeaders/')) {
    const pathParts = req.url.split('/');
    well = pathParts[3];
    wellbore = pathParts[4];
    console.log(`🔍 API Call: getLogHeaders for ${well}/${wellbore}`);
  } else {
    // For /logHeaders, return all headers and let Angular filter them
    console.log(`🔍 API Call: getLogHeaders (returning all headers)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.logHeaders));
    return;
  }
  
  const filteredHeaders = db.logHeaders.filter(header => 
    header['@uidWell'] === well && header['@uidWellbore'] === wellbore
  );
  
  console.log(`📊 Found ${filteredHeaders.length} headers for ${well}/${wellbore}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(filteredHeaders));
};

// Custom route for logData
const handleLogData = (req, res) => {
  const db = getDb();
  const query = url.parse(req.url, true).query;
  console.log(`🔍 API Call: logData with query:`, query);
  console.log(`📊 Raw query params: startIndex=${query.startIndex}, endIndex=${query.endIndex}`);
  
  const { uidWell, uidWellbore, uid, startIndex, endIndex } = query;
  
  // Generate proper data based on requested range
  const start = parseFloat(startIndex) || 0;
  const end = parseFloat(endIndex) || 1000;
  console.log(`📏 Parsed range: ${start} to ${end} (range size: ${end - start})`);
  
  const numPoints = Math.floor((end - start) * 2); // 2 points per depth unit
  console.log(`📈 Generating ${numPoints} data points`);
  
  const data = [];
  for (let i = 0; i < numPoints; i++) {
    const depth = start + (i / 2); // 0.5 depth increments
    const gr = 50 + Math.sin(depth / 100) * 20 + Math.random() * 5;
    const rt = 10 + Math.cos(depth / 150) * 5 + Math.random() * 2;
    const nphi = 0.2 + Math.sin(depth / 200) * 0.1 + Math.random() * 0.02;
    const rhob = 2.5 + Math.cos(depth / 180) * 0.3 + Math.random() * 0.05;
    const pef = 1.5 + Math.sin(depth / 120) * 0.5 + Math.random() * 0.1;
    
    data.push(`${depth.toFixed(1)},${gr.toFixed(1)},${rt.toFixed(1)},${nphi.toFixed(2)},${rhob.toFixed(2)},${pef.toFixed(2)}`);
  }
  
  const mockLogData = {
    uidWell,
    uidWellbore,
    uid,
    startIndex: {
      '@uom': 'm',
      '#text': start.toString()
    },
    endIndex: {
      '@uom': 'm', 
      '#text': end.toString()
    },
    mnemonicList: 'DEPTH,GR,RT,NPHI,RHOB,PEF',
    unitList: 'm,API,ohm.m,v/v,gAPI,PE',
    data
  };
  
  console.log(`📊 Generated ${data.length} data points for range ${start}-${end}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(mockLogData));
};

// Main server
const server = http.createServer((req, res) => {
  // Enable CORS for all requests
  enableCORS(req, res, () => {
    
    // Route handling
    if (req.url.startsWith('/api/getLogHeaders/')) {
      handleGetLogHeaders(req, res);
    } else if (req.url.startsWith('/logHeaders')) {
      handleGetLogHeaders(req, res);
    } else if (req.url.startsWith('/api/getImageData')) {
      handleGetImageData(req, res);
    } else if (req.url.startsWith('/timeLogHeaders')) {
      handleTimeLogHeaders(req, res);
    } else if (req.url.startsWith('/timeLogData')) {
      handleTimeLogData(req, res);
    } else if (req.url.startsWith('/logData')) {
      handleLogData(req, res);
    } else {
      // Default response for other routes
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        message: 'API Server Running',
        endpoints: [
          'GET /api/getLogHeaders/:well/:wellbore',
          'GET /api/getImageData',
          'GET /timeLogHeaders/:well/:wellbore',
          'GET /timeLogData',
          'GET /logData'
        ]
      }));
    }
  });
});

const port = 3000;
server.listen(port, () => {
  console.log(`🚀 Custom API Server running on http://localhost:${port}`);
  console.log(`📡 API Endpoints:`);
  console.log(`   GET http://localhost:${port}/api/getLogHeaders/:well/:wellbore`);
  console.log(`   GET http://localhost:${port}/api/getImageData`);
  console.log(`   GET http://localhost:${port}/timeLogHeaders/:well/:wellbore`);
  console.log(`   GET http://localhost:${port}/timeLogData`);
  console.log(`   GET http://localhost:${port}/logData`);
  console.log(`🏠 Home: http://localhost:${port}`);
});
