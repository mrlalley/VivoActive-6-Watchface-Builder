// monkey.jungle configuration generation.

const { DEVICE_ID } = require('../../src/constants/device');

function generateJungle() {
  return `project.manifest = manifest.xml

base.sourcePath = source
base.resourcePath = resources

${DEVICE_ID}.resourcePath = $(base.resourcePath)
${DEVICE_ID}.sourcePath = $(base.sourcePath)
`;
}

module.exports = { generateJungle };
