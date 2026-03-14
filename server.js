const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Read database
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db_backup.json'), 'utf8'));

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
  console.log(`🔍 Path parts:`, pathParts);
  
  // Handle both /timeLogHeaders/well/wellbore and /timeLogHeaders
  let well, wellbore;
  if (pathParts.length >= 3) {
    well = pathParts[1];
    wellbore = pathParts[2];
  } else {
    // Return all time headers if no specific well/wellbore provided
    console.log(`📊 Returning all time log headers`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.timeLogHeaders));
    return;
  }
  
  console.log(`🔍 API Call: timeLogHeaders for ${well}/${wellbore}`);
  
  // Filter for headers that contain 'time' (case-insensitive)
  const filteredHeaders = db.timeLogHeaders.filter(header => {
    const matchesWellbore = header['@uidWell'] === well && header['@uidWellbore'] === wellbore;
    const isTimeRelated = header.uid && header.uid.toLowerCase().includes('time');
    return matchesWellbore && isTimeRelated;
  });
  
  console.log(`📊 Found ${filteredHeaders.length} time headers for ${well}/${wellbore}`);
  console.log(`🔍 Time templates matched:`, filteredHeaders.map(h => h.uid));
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(filteredHeaders));
};

// Custom route for time-based log data
const handleTimeLogData = (req, res) => {
  const query = url.parse(req.url, true).query;
  console.log(`🔍 API Call: timeLogData with query:`, query);
  console.log(`🔍 Full URL: ${req.url}`);
  console.log(`🔍 Query string: ${url.parse(req.url).query}`);
  
  const { wellUid, logUid, wellboreUid, startIndex, endIndex } = query;
  
  // Find matching time log data - try multiple field combinations
  console.log(`🔍 Looking for time log data with:`);
  console.log(`   wellUid: ${wellUid}`);
  console.log(`   logUid: ${logUid}`);
  console.log(`   wellboreUid: ${wellboreUid}`);
  
  let timeLogEntry = db.timeLogData.find(log => 
    log.wellUid === wellUid && 
    log.logUid === logUid && 
    log.wellboreUid === wellboreUid
  );
  
  // If not found, try matching by id field (some data uses id instead of logUid)
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
    console.log(`   Available logNames in db: ${db.timeLogData.map(log => log.logName).join(', ')}`);
    timeLogEntry = db.timeLogData.find(log => 
      log.wellUid === wellUid && 
      log.logName === logUid && 
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
  
  // If still not found, try matching by removing any suffix numbers
  if (!timeLogEntry) {
    console.log(`🔍 Trying match by removing suffix numbers...`);
    const cleanLogUid = logUid.replace(/\d+$/, ''); // Remove trailing numbers
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
  const timeLogHeader = db.timeLogHeaders.find(header => 
    header['@uidWell'] === wellUid && 
    header.uid === logUid && 
    header['@uidWellbore'] === wellboreUid
  );
  
  // Generate mnemonic list from header or use fallback matching the image
  let mnemonicList = 'RIGTIME,BITDEPTH,CHKP,DEPTH,DIFF_PRESS,FLWOUT,FLWPMP5,HKHT,HKLI,HOOK_SPEED,PVT1,PVT10,PVT11,PVT2,PVT3,PVT4,PVT5,PVT6,PVT7,PVT8,PVT9,ROP,RPM,ROT,SLIPS_INDICATOR,SPM1,SPM2,SPM3,SPP,STKC,TORQUE,TORQUE_RO';
  if (timeLogHeader && timeLogHeader.logCurveInfo) {
    mnemonicList = timeLogHeader.logCurveInfo.map(curve => curve.mnemonic).join(',');
  }
  
  // Return the time log data in expected format matching the image
  const responseData = {
    logs: [{
      uidWell: wellUid,
      uidWellbore: wellboreUid,
      startDateTimeIndex: "2026-02-07T11:43:31+03:00",
      endDateTimeIndex: "2026-02-07T15:43:31+03:00",
      uid: logUid,
      logData: {
        data: filteredData,
        mnemonicList: mnemonicList,
        unitList: "s,ft,psi,ft,psi,%,galUS/min,ft,klbf,ft/min,bbl,bbl,bbl,bbl,bbl,bbl,bbl,bbl,bbl,ft/h,rpm,rpm,Status,spm,spm,spm,psi,unitless,kft.lbf,kft.lbf",
        startDateTimeIndex: "2026-02-07T11:43:31+03:00",
        uid: logUid
      }
    }]
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseData));
};

// Custom route for getLogHeaders
const handleGetLogHeaders = (req, res) => {
  const pathParts = req.url.split('/');
  const well = pathParts[3];
  const wellbore = pathParts[4];
  
  console.log(`🔍 API Call: getLogHeaders for ${well}/${wellbore}`);
  
  const filteredHeaders = db.logHeaders.filter(header => 
    header['@uidWell'] === well && header['@uidWellbore'] === wellbore
  );
  
  console.log(`📊 Found ${filteredHeaders.length} headers for ${well}/${wellbore}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(filteredHeaders));
};

// Custom route for logData
const handleLogData = (req, res) => {
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

const port = 3004;
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
