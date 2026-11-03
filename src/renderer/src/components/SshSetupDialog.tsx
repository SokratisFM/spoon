// SSH setup for GitHub, for people who've never needed it: repositories like MainLib are downloaded
// over SSH, which takes a key on this computer that the GitHub account knows. One checklist finds or
// makes the key, trusts github.com, gets the key onto the account (by itself when Spoon's GitHub
// sign-in allows it, else by copying it and opening GitHub's page for it) and checks the result.
import { useEffect, useState } from 'react'
import type { SshStatus } from '../../../shared/types'
import { cleanError } from '../hooks'
import { isMac } from '../platform'
import { requestSshSetup, sshTrouble } from '../sshHelp'
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

  const refresh = async (): Promise<SshStatus> => {
    const s = await window.spoon.sshStatus()
    setStatus(s)
    return s
  }
  useEffect(() => {
    refresh().catch((e) => setError(cleanError(e)))
  }, [])

  const ok = status?.auth.state === 'ok'
  const title = (key: string): string => key.split(/\s+/).slice(2).join(' ') || 'Spoon'
  const copyKey = async (): Promise<void> => {
    if (!status?.key) return
    await navigator.clipboard.writeText(status.key.publicKey)
    setCopied(true)
  }

  /** Every step that's still needed, in order, stopping at the first that fails. */
  const setUp = async (): Promise<void> => {
    setError(null)
    try {
      let s = status ?? (await refresh())
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
      if (s.auth.state === 'denied') {
        if (s.canUpload && s.key) {
          setWorking('account')
          await window.spoon.sshUploadKey(title(s.key.publicKey))
          s = await refresh()
        }
        if (s.auth.state !== 'ok') {
          setManual(true)
          if (s.key) {
            await navigator.clipboard.writeText(s.key.publicKey)
            setCopied(true)
          }
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
              {manual ? (
                <button className="btn primary" onClick={checkAgain} disabled={!!working}>
                  {working === 'check' ? 'Checking…' : 'I’ve Added It — Check Again'}
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
            stateOf('key', !!status.key),
            status.key ? 'There’s an SSH key on this computer' : 'Make an SSH key for this computer',
            status.key ? status.key.path : 'A new key, kept in your user folder’s .ssh folder.'
          )}
          {row(
            stateOf('host', status.knownHost),
            status.knownHost ? 'github.com is a trusted server' : 'Trust github.com',
            !status.knownHost && 'Using the server keys GitHub publishes.'
          )}
          {row(
            ok ? 'done' : working === 'account' || working === 'check' ? 'working' : auth?.state === 'error' ? 'failed' : 'todo',
            ok ? (
              <>
                GitHub knows this key: it signs in as <b>@{(auth as { user: string }).user}</b>
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

      {manual && !ok && status?.key && (
        <div className="ssh-manual">
          <b>Add the key on GitHub</b>
          <ol>
            <li>
              <span>The key is copied. </span>
              <button className="btn" onClick={copyKey}>
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
              Type a <b>Title</b> (like “{title(status.key.publicKey)}”), paste the key into <b>Key</b> (⌘V) and click <b>Add SSH key</b>.
            </li>
            <li>Come back here and click <b>Check Again</b>.</li>
          </ol>
          <code className="ssh-key" title="This computer's public key">
            {status.key.publicKey}
          </code>
        </div>
      )}

      {ok && (
        <p className="ssh-ok">
          All set. Try again what failed. If a repository still can’t be reached, @{(auth as { user: string }).user} may not have access to
          it on GitHub.
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
