const fs = require('fs');

// Read the current db.json
const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));

// Find the Calc_Drilling log
const calcDrillingLog = db.logData.find(log => log.uid === 'Calc_Drilling');
if (!calcDrillingLog) {
    console.error('Calc_Drilling log not found');
    process.exit(1);
}

// Generate additional historical data extending back 12 more hours
const existingData = calcDrillingLog.data;
const startTime = new Date('2026-02-21T09:52:12.000Z');
const newStartTime = new Date(startTime.getTime() - 12 * 60 * 60 * 1000); // 12 hours earlier

console.log(`Extending data from ${newStartTime.toISOString()} to ${startTime.toISOString()}`);

// Generate 2160 additional data points (12 hours * 60 minutes * 3 points per minute = 2160)
const additionalData = [];
let currentTime = new Date(newStartTime);
let currentDepth = 13130.91 - (12 * 60 * 0.5); // Start depth 12 hours earlier

while (currentTime < startTime) {
    // Generate realistic drilling data with variations
    const baseRops = 35 + Math.sin(currentTime.getTime() / 300000) * 15; // Base ROPS with variation
    const rops = Math.max(10, Math.min(80, baseRops + (Math.random() - 0.5) * 10));
    const ropsmin = Math.max(10, Math.min(60, rops * 0.8 + (Math.random() - 0.5) * 5));
    const depth = currentDepth + (Math.random() - 0.5) * 0.2; // Small depth variation
    
    additionalData.push(`${rops.toFixed(2)},${currentTime.toISOString()},${ropsmin.toFixed(2)},${depth.toFixed(2)}`);
    
    // Increment time by 20 seconds (3 points per minute)
    currentTime = new Date(currentTime.getTime() + 20000);
    currentDepth += 0.5; // Drill 0.5 ft every 20 seconds
}

// Update the start time in the header
calcDrillingLog.startDateTimeIndex = newStartTime.toISOString();

// Prepend the new data to existing data
calcDrillingLog.data = [...additionalData, ...existingData];

console.log(`Added ${additionalData.length} new data points`);
console.log(`Total data points: ${calcDrillingLog.data.length}`);
console.log(`New time range: ${calcDrillingLog.startDateTimeIndex} to ${calcDrillingLog.endDateTimeIndex}`);

// Write back to db.json
fs.writeFileSync('db.json', JSON.stringify(db, null, 2));
console.log('db.json updated successfully');
