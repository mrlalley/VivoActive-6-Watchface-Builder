// strings.xml generation for Garmin Connect IQ.

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateStrings(projectName) {
  return `<?xml version="1.0"?>
<strings>
  <string id="AppName">${xmlEscape(projectName)}</string>
</strings>
`;
}

module.exports = { generateStrings };
