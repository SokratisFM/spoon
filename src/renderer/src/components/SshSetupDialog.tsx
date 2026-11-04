// SSH setup for GitHub, for people who've never needed it: repositories like MainLib are downloaded
// over SSH, which takes a key on this computer that the GitHub account knows. One checklist finds or
// makes the key, trusts github.com, gets the key onto the account (by itself when Spoon's GitHub
// sign-in allows it, else by copying it and opening GitHub's page for it) and checks the result.
// A key with a passphrase is unlocked rather than replaced, and a changed GitHub host key is only
// replaced when the user says so (it could be someone in between).
import { useEffect, useState } from 'react'
import type { DeviceCode, SshStatus } from '../../../shared/types'
import { useAppInfo } from '../appinfo'
import { cleanError } from '../hooks'
import { isMac } from '../platform'
import { getSettings } from '../settings'
import { requestSshSetup, sshTrouble } from '../sshHelp'
import { confirm } from '../dialogs'
import { Modal } from './Modal'
import { CheckIcon } from './Icons'

const NEW_KEY_PAGE = 'https://github.com/settings/ssh/new'
const DOCS = 'https://docs.github.com/en/authentication/connecting-to-github-with-ssh'

type Row = 'done' | 'todo' | 'working' | 'failed'

export function SshSetupDialog({ onClose: close }: { onClose: () => void }) {
  // Whatever was waiting on SSH access (Clone's warning) looks again.
  const onClose = (): void => {
    window.dispatchEvent(new Event('spoon:sshChanged'))
    close()
  }
  const [status, setStatus] = useState<SshStatus | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Shown once Spoon can't add the key itself: the steps to add it on GitHub.
  const [manual, setManual] = useState(false)
  // Signing in to GitHub with permission to add the key (only asked for here).
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const appInfo = useAppInfo()
  const clientId = getSettings().githubClientId || appInfo?.githubClientId || ''

  const refresh = async (): Promise<SshStatus> => {
    const s = await window.spoon.sshStatus()
    setStatus(s)
    return s
  }
  useEffect(() => {
    refresh().catch((e) => setError(cleanError(e)))
  }, [])

  const ok = status?.auth.state === 'ok'
  const key = status?.key ?? null
  const title = (k: string): string => k.split(/\s+/).slice(2).join(' ') || 'Spoon'
  const copy = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }
  const unlockCommand = key ? `ssh-add ${isMac ? '--apple-use-keychain ' : ''}${key.path}` : ''

  /** Every step that's still needed, in order, stopping at the first that fails or needs the user. */
  const setUp = async (): Promise<void> => {
    setError(null)
    try {
      let s = status ?? (await refresh())
      if (s.auth.state === 'ok') return
      if (s.hostStale) return // replacing the host key waits for the user (below)
      if (s.key?.locked) return // unlocking waits for the user (below)
      if (!s.key) {
        setWorking('key')
        await window.spoon.sshCreateKey()
        s = await refresh()
      }
      if (!s.knownHost) {
        setWorking('host')
        await window.spoon.sshTrustGitHub()
        s = await refresh()
      }
      if (s.auth.state === 'denied' && s.key?.publicKey) {
        if (s.canUpload) {
          setWorking('account')
          await window.spoon.sshUploadKey(title(s.key.publicKey))
          s = await refresh()
        }
        if (s.auth.state !== 'ok') {
          setManual(true)
          if (s.key?.publicKey) await copy(s.key.publicKey)
        }
      }
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setWorking(null)
    }
  }
  const checkAgain = async (): Promise<void> => {
    setError(null)
    setWorking('check')
    try {
      await refresh()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setWorking(null)
    }
  }
  const replaceHostKey = async (): Promise<void> => {
    const yes = await confirm({
      message: 'Replace the saved GitHub server key?',
      detail:
        'This computer has a key for GitHub’s server that GitHub doesn’t use (any more). GitHub changed its key in 2023, so an old one is the usual reason. ' +
        'But if you’re on a network you don’t trust (a café or hotel), someone could be in between: then don’t replace it, and try again from another network.',
      confirmLabel: 'Replace with GitHub’s Key',
      risky: true
    })
    if (!yes) return
    setWorking('host')
    setError(null)
    try {
      await window.spoon.sshReplaceHostKey()
      await refresh()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setWorking(null)
    }
  }
  /** Signs in to GitHub with permission to add SSH keys, then adds this one. */
  const signInToAdd = async (): Promise<void> => {
    if (!clientId || !key?.publicKey) return
    setError(null)
    try {
      const code = await window.spoon.ghDeviceStart(clientId, true)
      setDevice(code)
      await navigator.clipboard.writeText(code.userCode)
      window.spoon.openExternal(code.verificationUri)
      await window.spoon.ghDeviceWait(clientId, code)
      setDevice(null)
      setWorking('account')
      await window.spoon.sshUploadKey(title(key.publicKey))
      await refresh()
    } catch (e) {
      setDevice(null)
      setError(cleanError(e))
    } finally {
      setWorking(null)
    }
  }

  const row = (state: Row, label: React.ReactNode, detail?: React.ReactNode) => (
    <div className={`ml-progress ${state}`}>
      <span className="ml-state">{state === 'done' ? <CheckIcon /> : state === 'working' ? <span className="spinner" /> : state === 'failed' ? '!' : ''}</span>
      <span>
        {label}
        {detail && <span className="muted ssh-detail">{detail}</span>}
      </span>
    </div>
  )
  const stateOf = (step: string, done: boolean): Row => (done ? 'done' : working === step ? 'working' : 'todo')
  const auth = status?.auth
  const user = auth?.state === 'ok' ? auth.user : ''
  const waitingOnUser = !!status && (status.hostStale || !!key?.locked)

  return (
    <Modal
      title="Set Up SSH for GitHub"
      onClose={onClose}
      onSubmit={ok ? onClose : setUp}
      wide
      footer={
        <>
          <a href="#" className="ssh-docs" onClick={(e) => (e.preventDefault(), window.spoon.openExternal(DOCS))}>
            GitHub’s guide
          </a>
          {ok ? (
            <button className="btn primary" onClick={onClose} autoFocus>
              Done
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Close
              </button>
              {manual || waitingOnUser ? (
                <button className="btn primary" onClick={checkAgain} disabled={!!working}>
                  {working === 'check' ? 'Checking…' : 'Check Again'}
                </button>
              ) : (
                <button className="btn primary" onClick={setUp} disabled={!status || !!working} autoFocus>
                  {working ? 'Setting Up…' : 'Set Up'}
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <p className="hint ssh-intro">
        Some repositories (like MainLib) are downloaded over SSH. That needs a key on this {isMac ? 'Mac' : 'computer'} which the GitHub
        account knows about. Spoon can set it up for you.
      </p>
      {!status && !error && <p className="muted">Checking this {isMac ? 'Mac' : 'computer'}…</p>}
      {status && (
        <div className="ssh-steps">
          {row(
            key?.locked ? 'failed' : stateOf('key', !!key || ok),
            key ? (key.locked ? 'Your SSH key has a passphrase' : 'There’s an SSH key on this computer') : ok ? 'Your SSH agent has a key GitHub accepts' : 'Make an SSH key for this computer',
            key ? key.path : !ok && 'A new key, kept in your user folder’s .ssh folder.'
          )}
          {row(
            status.hostStale ? 'failed' : stateOf('host', status.knownHost && auth?.state !== 'unknown-host'),
            status.hostStale ? 'The saved key for GitHub’s server isn’t GitHub’s' : status.knownHost ? 'GitHub is a trusted server' : 'Trust GitHub’s server',
            !status.knownHost && 'Using the server keys GitHub publishes.'
          )}
          {row(
            ok ? 'done' : working === 'account' || working === 'check' ? 'working' : auth?.state === 'error' ? 'failed' : 'todo',
            ok ? (
              <>
                GitHub knows this key: it signs in as <b>@{user}</b>
              </>
            ) : status.canUpload ? (
              <>Add the key to @{status.login} on GitHub</>
            ) : (
              'Add the key to the GitHub account'
            ),
            auth?.state === 'error' ? auth.message : undefined
          )}
        </div>
      )}

      {status?.hostStale && !ok && (
        <div className="ssh-manual">
          <b>GitHub’s server key changed, or this isn’t GitHub</b>
          <p className="hint">
            ssh refuses to connect because the key it saved for GitHub’s server isn’t one GitHub uses now. Spoon won’t replace it without asking.
          </p>
          <button className="btn" onClick={replaceHostKey} disabled={!!working}>
            Replace It with GitHub’s Key…
          </button>
        </div>
      )}

      {key?.locked && !ok && (
        <div className="ssh-manual">
          <b>Unlock the key once</b>
          <p className="hint">
            ssh can’t use it until it knows the passphrase. Run this in Terminal and type the passphrase{isMac ? '; your Mac remembers it from then on' : ''}:
          </p>
          <code className="ssh-key">{unlockCommand}</code>
          <p>
            <button className="btn" onClick={() => copy(unlockCommand)}>
              {copied ? 'Copied' : 'Copy Command'}
            </button>
            <span className="muted"> Then click Check Again.</span>
          </p>
        </div>
      )}

      {manual && !ok && key?.publicKey && (
        <div className="ssh-manual">
          <b>Add the key on GitHub</b>
          {status?.source !== 'gh' && status?.source !== 'token' && clientId && (
            <p>
              <button className="btn" onClick={signInToAdd} disabled={!!working || !!device}>
                Let Spoon Add It…
              </button>
              <span className="muted"> — sign in to GitHub (with the team’s account) and allow Spoon to add SSH keys.</span>
            </p>
          )}
          {device && (
            <p className="hint">
              Enter <b className="mono">{device.userCode}</b> on the GitHub page that opened (it’s copied). Waiting for GitHub…
            </p>
          )}
          {status?.source === 'gh' && (
            <p className="hint">
              Or let the GitHub CLI do it: <span className="mono">gh auth refresh -h github.com -s admin:public_key</span> in Terminal, then Check Again.
            </p>
          )}
          <p className="muted">Or add it yourself:</p>
          <ol>
            <li>
              <span>The key is copied. </span>
              <button className="btn" onClick={() => copy(key.publicKey)}>
                {copied ? 'Copy Again' : 'Copy Key'}
              </button>
            </li>
            <li>
              <button className="btn" onClick={() => window.spoon.openExternal(NEW_KEY_PAGE)}>
                Open GitHub’s New SSH Key Page
              </button>
              <span className="muted"> — sign in with the team’s GitHub account if it asks.</span>
            </li>
            <li>
              Type a <b>Title</b> (like “{title(key.publicKey)}”), paste the key into <b>Key</b> ({isMac ? '⌘V' : 'Ctrl+V'}) and click <b>Add SSH key</b>.
            </li>
            <li>Come back here and click <b>Check Again</b>.</li>
          </ol>
          <code className="ssh-key" title="This computer's public key">
            {key.publicKey}
          </code>
        </div>
      )}

      {ok && (
        <p className="ssh-ok">
          All set. Try again what failed. If a repository still can’t be reached, @{user} may not have access to it on GitHub.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      <details className="ssh-commands">
        <summary>Rather use Terminal?</summary>
        <pre className="git-output">{`ssh-keygen -t ed25519 -C "${isMac ? 'your-mac' : 'your-computer'}"
${isMac ? 'pbcopy < ~/.ssh/id_ed25519.pub' : 'type %USERPROFILE%\\.ssh\\id_ed25519.pub | clip'}
# paste it at ${NEW_KEY_PAGE}
ssh -T git@github.com`}</pre>
      </details>
    </Modal>
  )
}

/** Under an error about SSH access: a button that opens the setup. */
export function SshHint({ message }: { message: string | null | undefined }) {
  if (!message || !sshTrouble(message)) return null
  return (
    <p className="ssh-hint">
      This looks like missing SSH access to GitHub.{' '}
      <button className="btn" onClick={requestSshSetup}>
        Set Up SSH Key…
      </button>
    </p>
  )
}
