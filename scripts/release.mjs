// Builds a Spoon release into dist.noindex/release/<version>/, ready to upload to GitHub Releases.
//
// Almost all of an installer is Electron (~250 MB unpacked); Spoon's own code is a few MB. So a
// release only carries full installers when Electron changed since the last one (a "full" release):
//   Spoon-<v>-mac-arm64.zip           Apple Silicon app, ad-hoc signed (no Intel build)
//   Spoon-<v>-win-x64-setup.exe       per-user NSIS installer
// Every release carries Spoon's code on its own, which is all an update needs while Electron stays:
//   Spoon-<v>-mac-arm64-code.zip      Contents/Resources + Info.plist
//   Spoon-<v>-win-x64-code.zip        resources/
// plus latest.json (update manifest, signed with your release key; see scripts/keygen.mjs),
// INSTALLERS (where the full installers are, and this release's code, for the install scripts),
// SHA256SUMS, install.sh and install.ps1.
//
// Usage: npm version <patch|minor|major> --no-git-tag-version, then
//        npm run release -- --notes "What changed" [--full] [--skip-win] [--skip-mac] [--prev latest.json]
// --full forces full installers; --prev reads the previous manifest from a file instead of GitHub.
// Nothing is uploaded; the command to publish is printed at the end.
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const config = JSON.parse(readFileSync(join(root, 'spoon.config.json'), 'utf8'))
const version = pkg.version
const notes = option('--notes') ?? (option('--notes-file') ? readFileSync(option('--notes-file'), 'utf8') : '')
const keyFile = process.env.SPOON_RELEASE_KEY ?? join(homedir(), '.config', 'spoon', 'release-signing-key.pem')
const repo = config.updateRepo || 'OWNER/REPO'
const out = join(root, 'dist.noindex', 'release', version)
const work = join(out, 'build')

if (!existsSync(keyFile)) {
  console.error(`No release signing key at ${keyFile}. Run: npm run keygen`)
  process.exit(1)
}
if (!config.updateRepo) console.warn('spoon.config.json has no updateRepo yet: install scripts will say OWNER/REPO.')

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' })
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const electron = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
const downloadUrl = (tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`

// The previous release's manifest says which Electron it ran on and where its installers are.
async function previousRelease() {
  try {
    const text = option('--prev')
      ? readFileSync(option('--prev'), 'utf8')
      : await (await fetch(`https://github.com/${repo}/releases/latest/download/latest.json`)).text()
    return JSON.parse(JSON.parse(text).payload)
  } catch {
    return null
  }
}
const prev = await previousRelease()
const full = flag('--full') || !prev?.full || prev.electron !== electron
if (!full) console.log(`Electron ${electron} is unchanged since ${prev.version}: code-only release, installers stay in ${prev.version}.`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
run(npx, ['electron-vite', 'build'])

const builder = (platformArgs) =>
  run(npx, ['electron-builder', ...platformArgs, '--publish', 'never', `-c.directories.output=${work}`])

const describe = (path, url) => {
  const data = readFileSync(path)
  return { file: path.split(/[\\/]/).pop(), url, sha256: createHash('sha256').update(data).digest('hex'), size: data.length }
}
// Full installers per platform (in this release, or carried over from the last full one) and code.
const installers = full ? {} : { ...prev.full }
const code = {}
const keep = (src) => copyFileSync(src, join(out, src.split(/[\\/]/).pop()))
const zipCode = (key, dir) => {
  const zip = join(out, `Spoon-${version}-${key === 'win32-x64' ? 'win-x64' : 'mac-arm64'}-code.zip`)
  execFileSync('ditto', ['-c', '-k', dir, zip])
  code[key] = describe(zip, downloadUrl(`v${version}`, zip.split('/').pop()))
}

if (!flag('--skip-mac')) {
  builder(['--mac', ...(full ? ['zip'] : ['dir']), '--arm64'])
  const app = join(work, 'mac-arm64', 'Spoon.app')
  const stage = join(work, 'mac-code')
  cpSync(join(app, 'Contents', 'Resources'), join(stage, 'Resources'), { recursive: true, verbatimSymlinks: true })
  copyFileSync(join(app, 'Contents', 'Info.plist'), join(stage, 'Info.plist'))
  zipCode('darwin-arm64', stage)
  if (full) {
    const zip = join(work, `Spoon-${version}-mac-arm64.zip`)
    keep(zip)
    installers['darwin-arm64'] = describe(zip, downloadUrl(`v${version}`, zip.split('/').pop()))
  }
}
if (!flag('--skip-win')) {
  builder(['--win', ...(full ? ['nsis'] : ['dir']), '--x64'])
  const stage = join(work, 'win-code')
  cpSync(join(work, 'win-unpacked', 'resources'), join(stage, 'resources'), { recursive: true })
  zipCode('win32-x64', stage)
  if (full) {
    const exe = join(work, `Spoon-${version}-win-x64-setup.exe`)
    keep(exe)
    installers['win32-x64'] = describe(exe, downloadUrl(`v${version}`, exe.split(/[\\/]/).pop()))
  }
}

// Signed manifest: the app only installs updates whose payload verifies against its public key.
// `assets` is what Spoon 0.31.0 and older read: file names in this release, so only full releases
// have them. Newer versions read `full` (absolute links) and `code`, and take the code alone when
// they run the same Electron.
const assets = full ? Object.fromEntries(Object.entries(installers).map(([k, a]) => [k, { file: a.file, sha256: a.sha256, size: a.size }])) : {}
const payload = JSON.stringify({ version, date: new Date().toISOString(), notes, electron, assets, full: installers, code })
const signature = sign(null, Buffer.from(payload), createPrivateKey(readFileSync(keyFile))).toString('base64')
writeFileSync(join(out, 'latest.json'), JSON.stringify({ payload, signature }, null, 2))

// For the install scripts: "<sha256>  <url>" per file. A first install takes the full installer and,
// in a code-only release, lays this release's code over it.
const lines = Object.values(installers).map((a) => `${a.sha256}  ${a.url}`)
if (!full) lines.push(...Object.values(code).map((a) => `${a.sha256}  ${a.url}`))
writeFileSync(join(out, 'INSTALLERS'), lines.join('\n') + '\n')

for (const script of ['install.sh', 'install.ps1']) {
  writeFileSync(join(out, script), readFileSync(join(root, 'scripts', script), 'utf8').replaceAll('__REPO__', repo))
}

rmSync(work, { recursive: true, force: true })
const files = readdirSync(out).filter((f) => f !== 'SHA256SUMS').sort()
const sums = files.map((f) => `${createHash('sha256').update(readFileSync(join(out, f))).digest('hex')}  ${f}`)
writeFileSync(join(out, 'SHA256SUMS'), sums.join('\n') + '\n')

console.log(`\nRelease ${version} is in ${out}`)
for (const f of [...files, 'SHA256SUMS']) console.log(`  ${f.padEnd(34)} ${(statSync(join(out, f)).size / 1048576).toFixed(1)} MB`)
console.log(`\nTo publish (when ready):\n  gh release create v${version} --repo ${repo} --title "Spoon ${version}" --notes ${JSON.stringify(notes || `Spoon ${version}`)} ${join(out, '*')}`)
console.log(`\nInstall commands:\n  macOS:   curl -fsSL https://github.com/${repo}/releases/latest/download/install.sh | sh`)
console.log(`  Windows: irm https://github.com/${repo}/releases/latest/download/install.ps1 | iex`)
