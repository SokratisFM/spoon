// electron-builder afterPack hook: ad-hoc sign the Mac app before it's zipped or put in a DMG.
// Apple Silicon only runs signed code; an ad-hoc signature is enough for apps that aren't
// distributed through Apple. The per-arch "-temp" builds of a universal build are left unsigned
// so they can be merged; the merged universal app is signed.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || context.appOutDir.includes('-temp')) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
