// strings.xml generation for Garmin Connect IQ.

function generateStrings(projectName) {
  return `<?xml version="1.0"?>
<strings>
  <string id="AppName">${projectName}</string>
</strings>
`;
}

module.exports = { generateStrings };
