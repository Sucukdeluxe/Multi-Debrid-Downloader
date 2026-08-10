const path = require("path");
const { rcedit } = require("rcedit");

module.exports = async function afterPack(context) {
  const productFilename = context.packager?.appInfo?.productFilename;
  const productName = context.packager?.appInfo?.productName;
  const version = context.packager?.appInfo?.version;
  if (!productFilename) {
    throw new Error("rcedit: productFilename not available");
  }
  if (!productName) {
    throw new Error("rcedit: productName not available");
  }
  if (!version) {
    throw new Error("rcedit: version not available");
  }
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.resolve(__dirname, "..", "assets", "app_icon.ico");
  console.log(`  • rcedit: patching metadata and icon → ${exePath}`);
  await rcedit(exePath, {
    icon: iconPath,
    "file-version": version,
    "product-version": version,
    "version-string": {
      CompanyName: "Sucukdeluxe",
      FileDescription: "Multi-Debrid-Downloader",
      InternalFilename: productFilename,
      OriginalFilename: `${productFilename}.exe`,
      ProductName: productName,
    },
  });
};
