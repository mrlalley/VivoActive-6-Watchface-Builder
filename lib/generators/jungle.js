// monkey.jungle configuration generation.

function generateJungle() {
  return `project.manifest = manifest.xml

base.sourcePath = source
base.resourcePath = resources

vivoactive6.resourcePath = $(base.resourcePath)
vivoactive6.sourcePath = $(base.sourcePath)
`;
}

module.exports = { generateJungle };
