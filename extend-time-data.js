const fs = require('fs');

function generateTimeLogData() {
    const start = new Date("2025-02-11T06:13:15.000Z").getTime();
    const end = new Date("2025-02-14T06:13:14.000Z").getTime();

    const step = 1000; // 1 second
    const totalSteps = Math.floor((end - start) / step);

    // Start values
    const startValues = [47.8, 13.6, 0.174, 2.42, 13.5, 16.1, 83];

    // End values
    const endValues = [59.3, 16.8, 0.141, 2.36, 10.7, 13.2, 105];

    const data = [];

    for (let i = 0; i <= totalSteps; i++) {
        const currentTime = new Date(start + i * step).toISOString();

        // Linear interpolation
        const values = startValues.map((startVal, index) => {
            const endVal = endValues[index];
            const val = startVal + ((endVal - startVal) * i) / totalSteps;
            return Number(val.toFixed(3));
        });

        const row = `"${currentTime},${values.join(",")}"`;
        data.push(row);
    }

    return data;
}

// Generate data
const timeLogData = generateTimeLogData();

// Save to file
fs.writeFileSync('timeLogData.txt', timeLogData.join(",\n"));

console.log("✅ File generated: timeLogData.txt");
console.log("Total records:", timeLogData.length);