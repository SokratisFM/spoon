// Builds a Spoon release into dist.noindex/release/<version>/, ready to upload to GitHub Releases:
//   Spoon-<v>-mac-arm64.zip       Apple Silicon, and -mac-x64 for Intel; ad-hoc signed
//   Spoon-<v>-win-x64-setup.exe   per-user NSIS installer
//   latest.json                   update manifest, signed with your release key (scripts/keygen.mjs)
//   SHA256SUMS, install.sh, install.ps1
// One file per platform: the install scripts find theirs in SHA256SUMS and the updater in
// latest.json, so no copies under fixed names and no DMGs (the install command doesn't need them).
//
// Usage: npm version <patch|minor|major> --no-git-tag-version, then
//        npm run release -- --notes "What changed" [--skip-win] [--skip-mac]
// Nothing is uploaded; the command to publish is printed at the end.
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
run(npx, ['electron-vite', 'build'])

const builder = (platformArgs) =>
  run(npx, ['electron-builder', ...platformArgs, '--publish', 'never', `-c.directories.output=${work}`])

const assets = {}
const add = (key, src) => {
  const file = src.split(/[\\/]/).pop()
  copyFileSync(src, join(out, file))
  if (key) {
    const data = readFileSync(src)
    assets[key] = { file, sha256: createHash('sha256').update(data).digest('hex'), size: data.length }
  }
}

if (!flag('--skip-mac')) {
  // One build per chip: each download is half the size of a universal app.
  builder(['--mac', 'zip', '--arm64', '--x64'])
  for (const arch of ['arm64', 'x64']) add(`darwin-${arch}`, join(work, `Spoon-${version}-mac-${arch}.zip`))
}
if (!flag('--skip-win')) {
  builder(['--win', 'nsis', '--x64'])
  add('win32-x64', join(work, `Spoon-${version}-win-x64-setup.exe`))
}

// Signed manifest: the app only installs updates whose payload verifies against its public key.
const payload = JSON.stringify({ version, date: new Date().toISOString(), notes, assets })
const signature = sign(null, Buffer.from(payload), createPrivateKey(readFileSync(keyFile))).toString('base64')
writeFileSync(join(out, 'latest.json'), JSON.stringify({ payload, signature }, null, 2))

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
