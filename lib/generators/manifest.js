// manifest.xml generation for Garmin Connect IQ.

const crypto = require('crypto');
const { DEVICE_ID, MIN_API_LEVEL } = require('../../src/constants/device');

function generateManifest(projectName, permissions) {
  // Use a fully random RFC 4122 v4 UUID so every export gets a unique application
  // identity. A timestamp-only suffix caused UUID collisions for same-millisecond
  // exports (e.g. concurrent builds, automated tests).
  const appId = crypto.randomUUID();
  const permXml = permissions.map(p => `            <iq:uses-permission id="${p}"/>`).join('\n');
  const permBlock = permissions.length
    ? `<iq:permissions>\n${permXml}\n        </iq:permissions>`
    : `<iq:permissions/>`;

  return `<?xml version="1.0"?>
<iq:manifest version="3" xmlns:iq="http://www.garmin.com/xml/connectiq">
    <iq:application id="${appId}" type="watchface" name="@Strings.AppName" entry="WatchFaceApp" launcherIcon="@Drawables.LauncherIcon" minApiLevel="${MIN_API_LEVEL}">
        <iq:products>
            <iq:product id="${DEVICE_ID}"/>
        </iq:products>
        ${permBlock}
        <iq:languages>
            <iq:language>eng</iq:language>
        </iq:languages>
        <iq:barrels/>
    </iq:application>
</iq:manifest>
`;
}

module.exports = { generateManifest };
