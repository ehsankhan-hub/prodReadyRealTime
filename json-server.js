const fs = require("fs");

const start = new Date("2025-02-11T06:13:15.000Z");
const seconds = 3 * 24 * 60 * 60; // change to 48 * 60 * 60 if needed

const values = [
"47.8,13.6,0.174,2.42,13.5,16.1,83",
"59.3,16.8,0.141,2.36,10.7,13.2,105",
"44.9,12.9,0.187,2.44,14.2,17.5,76",
"56.7,15.5,0.153,2.38,12.3,15.1,97",
"51.4,14.2,0.169,2.41,11.9,14.6,88",
"48.2,13.8,0.176,2.35,13.8,16.8,82",
"54.9,15.7,0.148,2.43,10.5,12.9,94",
"42.7,12.1,0.182,2.37,14.9,17.8,71",
"60.8,17.1,0.135,2.46,11.2,13.7,108",
"46.3,13.4,0.191,2.33,13.5,15.4,85"
];

let output = "";

for (let i = 0; i < seconds; i++) {

    const t = new Date(start.getTime() + i * 1000);

    const row = `"${t.toISOString()},${values[i % values.length]}",\n`;

    output += row;
}

fs.writeFileSync("well-data.csv", output);

console.log("File created: well-data.csv");