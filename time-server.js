const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('timedb.json');
const middlewares = jsonServer.defaults();

// Custom routes for time-based data
server.use(middlewares);

// Handle time-based log headers
server.get('/timeLogHeaders', (req, res) => {
  console.log('📋 Serving time-based log headers...');
  const db = router.db;
  const headers = db.get('timeLogHeaders').value();
  res.json(headers);
});

// Handle time-based log data with POST requests (like your existing API)
server.post('/timeLogData', (req, res) => {
  console.log('📊 Processing time-based log data request:', req.body);
  
  const { logUid, startIndex, endIndex, mnemonicList } = req.body;
  const db = router.db;
  
  // Find the log data
  const logData = db.get('timeLogData').find({ logId: logUid }).value();
  
  if (!logData) {
    return res.status(404).json({
      code: '404',
      message: `No data found for log ID: ${logUid}`
    });
  }
  
  // Filter data based on time range
  const filteredData = logData.data.filter(item => {
    const itemTime = new Date(item.time);
    const startTime = new Date(startIndex);
    const endTime = new Date(endIndex);
    return itemTime >= startTime && itemTime <= endTime;
  });
  
  // Format response like your existing API
  const response = {
    logs: [{
      logId: logUid,
      endDateTimeIndex: endIndex,
      logData: {
        data: filteredData.map(item => {
          // Convert object to comma-separated string format
          return `${item.time},${item.depth},${item.rop || ''},${item.wob || ''},${item.rpm || ''},${item.gas_total || ''},${item.gas_c1 || ''},${item.gas_c2 || ''}`;
        }),
        mnemonicList: 'TIME,DEPTH,ROP,WOB,RPM,GAS_TOTAL,GAS_C1,GAS_C2',
        unitList: 'datetime,m,m/hr,klbs,rpm,units,units,units'
      }
    }]
  };
  
  console.log(`✅ Returned ${filteredData.length} data points for time range ${startIndex} to ${endIndex}`);
  res.json(response);
});

// Default JSON server routes
server.use(router);

// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Time-based data server running on http://localhost:${PORT}`);
  console.log('📋 Available endpoints:');
  console.log('  GET  /timeLogHeaders - Get time-based log headers');
  console.log('  POST /timeLogData   - Get time-based log data');
});
