'use strict'

/**
 * A Mac app with no signature at all, or one broken by packing, is refused as
 * "damaged" with no way past it. Signed ad hoc (no Apple account needed) it
 * opens after one "Open Anyway" in Privacy & Security, the first time only.
 * A real Developer ID (CSC_LINK in CI) replaces this whenever the studio has one.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
