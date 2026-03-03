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
  
  const { wellUid, logUid, wellboreUid, startIndex, endIndex } = query;
  
  // Find matching time log data
  const timeLogEntry = db.timeLogData.find(log => 
    log.wellUid === wellUid && 
    log.logUid === logUid && 
    log.wellboreUid === wellboreUid
  );
  
  if (!timeLogEntry) {
    console.log(`❌ No time log data found for ${wellUid}/${wellboreUid}/${logUid}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Time log data not found' }));
    return;
  }
  
  console.log(`📊 Found time log data with ${timeLogEntry.data.length} records`);
  
  // Return the time log data in expected format
  const responseData = {
    logs: [{
      logData: {
        mnemonicList: 'TIME,GR,RT,NPHI,RHOB,ROP,WOB,RPM',
        data: timeLogEntry.data
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
  
  const { uidWell, uidWellbore, uid, startIndex, endIndex } = query;
  const mockLogData = {
    uidWell,
    uidWellbore,
    uid,
    startIndex: {
      '@uom': 'm',
      '#text': startIndex || '0'
    },
    endIndex: {
      '@uom': 'm', 
      '#text': endIndex || '1000'
    },
    mnemonicList: 'GR,RT,NPHI,RHOB,PEF',
    unitList: 'API,ohm.m,v/v,gAPI,PE',
    data: [
      '50,10,0.2,2.5,1.5',
      '55,12,0.22,2.6,1.6',
      '60,15,0.25,2.7,1.7',
      '58,14,0.23,2.65,1.65',
      '62,16,0.26,2.8,1.8'
    ]
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify([mockLogData]));
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
