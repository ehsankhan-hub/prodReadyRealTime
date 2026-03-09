const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Read database
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));

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
  
  const filteredHeaders = db.timeLogHeaders.filter(header => 
    header['@uidWell'] === well && header['@uidWellbore'] === wellbore
  );
  
  console.log(`📊 Found ${filteredHeaders.length} time headers for ${well}/${wellbore}`);
  
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
  let timeLogEntry = db.timeLogData.find(log => 
    log.wellUid === wellUid && 
    log.logUid === logUid && 
    log.wellboreUid === wellboreUid
  );
  
  // If not found, try matching by id field (some data uses id instead of logUid)
  if (!timeLogEntry) {
    console.log(`🔍 Trying alternative match with id field...`);
    timeLogEntry = db.timeLogData.find(log => 
      log.wellUid === wellUid && 
      log.id === `${wellUid}_${wellboreUid}` && 
      log.wellboreUid === wellboreUid
    );
  }
  
  // If still not found, try matching by name field
  if (!timeLogEntry) {
    console.log(`🔍 Trying alternative match with name field...`);
    timeLogEntry = db.timeLogData.find(log => 
      log.wellUid === wellUid && 
      log.logName === logUid && 
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
    const startTime = parseInt(startIndex);
    const endTime = parseInt(endIndex);
    
    console.log(`🔍 Filtering data from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
    
    filteredData = timeLogEntry.data.filter(row => {
      const timestamp = parseInt(row.split(',')[0]); // First column is TIME
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
  
  // Generate mnemonic list from header or use fallback
  let mnemonicList = 'TIME,GR,RT,NPHI,RHOB,ROP,WOB,RPM'; // fallback
  if (timeLogHeader && timeLogHeader.logCurveInfo) {
    mnemonicList = timeLogHeader.logCurveInfo.map(curve => curve.mnemonic).join(',');
  }
  
  // Return the time log data in expected format
  const responseData = {
    logs: [{
      logData: {
        mnemonicList: mnemonicList,
        data: filteredData
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
  console.log(`   GET http://localhost:${port}/timeLogHeaders/:well/:wellbore`);
  console.log(`   GET http://localhost:${port}/timeLogData`);
  console.log(`   GET http://localhost:${port}/logData`);
  console.log(`🏠 Home: http://localhost:${port}`);
});
