const fs = require('fs');
const path = require('path');

// Generate realistic well log data
function generateWellLogData() {
  const wellLogs = [];
  
  for (let wellIndex = 0; wellIndex < 3; wellIndex++) {
    const depths = [];
    const grValues = [];
    const rhobValues = [];
    const nphiValues = [];
    const rtValues = [];
    
    // Generate 2000 data points from 4000-4300m
    for (let i = 0; i < 2000; i++) {
      const depth = 4000 + (i * 0.1524); // 6-inch increments
      
      // Realistic well log patterns
      const gr = 50 + Math.sin(depth * 0.01) * 30 + Math.random() * 20;
      const rhob = 2.3 + Math.cos(depth * 0.005) * 0.3 + Math.random() * 0.2;
      const nphi = 0.25 + Math.sin(depth * 0.02) * 0.15 + Math.random() * 0.05;
      const rt = 10 + Math.exp(depth * 0.0001) + Math.random() * 50;
      
      depths.push(depth.toFixed(2));
      grValues.push(gr.toFixed(1));
      rhobValues.push(rhob.toFixed(2));
      nphiValues.push(nphi.toFixed(3));
      rtValues.push(rt.toFixed(1));
    }
    
    // Convert to CSV format
    const data = depths.map((depth, i) => 
      `${depth},${grValues[i]},${rhobValues[i]},${nphiValues[i]},${rtValues[i]}`
    );
    
    wellLogs.push({
      "wellId": `well-00${wellIndex + 1}`,
      "wellboreId": `wellbore-00${wellIndex + 1}`,
      "objectId": `log-00${wellIndex + 1}`,
      "objectName": `WELL_${wellIndex + 1}_LOG`,
      "indexType": "depth",
      "indexCurve": "DEPTH",
      "startIndex": 4000,
      "endIndex": 4300,
      "isGrowing": true,
      "logData": {
        "data": data,
        "unitList": "m,GAPI,kg/m3,V/V,ohmm",
        "mnemonicList": "DEPTH,GR,RHOB,NPHI,RT"
      }
    });
  }
  
  return { wellLogs };
}

// Generate and save data
const wellLogData = generateWellLogData();
fs.writeFileSync(
  path.join(__dirname, 'db.json'),
  JSON.stringify(wellLogData, null, 2)
);

console.log('Generated well log data with', wellLogData.wellLogs.length, 'wells');
console.log('Each well has', wellLogData.wellLogs[0].logData.data.length, 'data points');
