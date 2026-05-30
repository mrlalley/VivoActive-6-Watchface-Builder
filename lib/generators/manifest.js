// manifest.xml generation for Garmin Connect IQ.

function generateManifest(projectName, permissions) {
  const ts = Date.now().toString(16).padStart(12, '0').slice(-12);
  const permXml = permissions.map(p => `            <iq:uses-permission id="${p}"/>`).join('\n');
  const permBlock = permissions.length
    ? `<iq:permissions>\n${permXml}\n        </iq:permissions>`
    : `<iq:permissions/>`;

  return `<?xml version="1.0"?>
<iq:manifest version="3" xmlns:iq="http://www.garmin.com/xml/connectiq">
    <iq:application id="a3872ef0-6346-4321-abcd-${ts}" type="watchface" name="@Strings.AppName" entry="WatchFaceApp" launcherIcon="@Drawables.LauncherIcon" minApiLevel="4.2.0">
        <iq:products>
            <iq:product id="vivoactive6"/>
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
