// Creates the ed25519 key pair that signs Spoon releases. The private key stays on this machine
// (never in the repo); the public key is written into the app so it can verify every update.
// Run once: npm run keygen. Back the private key up: losing it means installed copies can no
// longer verify new updates and would need one manual reinstall.
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const keyFile = process.env.SPOON_RELEASE_KEY ?? join(homedir(), '.config', 'spoon', 'release-signing-key.pem')
const publicTs = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'update-key.ts')

if (existsSync(keyFile) && !process.argv.includes('--force')) {
  console.error(`A signing key already exists at ${keyFile}. Use --force to replace it (existing installs would reject new updates).`)
  process.exit(1)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(dirname(keyFile), { recursive: true })
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
writeFileSync(
  publicTs,
  `// Public half of the release signing key (scripts/keygen.mjs). Updates whose manifest isn't signed
// by the matching private key are rejected.
export const UPDATE_PUBLIC_KEY = \`${publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()}\`
`
)
console.log(`Private key: ${keyFile} (keep it safe and backed up)`)
console.log(`Public key:  ${publicTs}`)
