const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/assets/data/log2DData.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

if (data && data.length > 0) {
    const firstStamp = data[0].depth;
    const startDepth = 2000; // Start at 2000 meters
    const interval = 0.5;   // 0.5m spacing

    const newData = data.map((item, index) => ({
        ...item,
        depth: startDepth + (index * interval)
    }));

    fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));
    console.log(`✅ Shifted ${data.length} image rows to start at ${startDepth}m with ${interval}m spacing.`);
} else {
    console.log('❌ No data found in log2DData.json');
}
