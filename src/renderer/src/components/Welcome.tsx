import { CloseIcon, FolderIcon } from './Icons'

interface Props {
  recents: string[]
  onPick: () => void
  onOpen: (path: string) => void
  onForget: (path: string) => void
}

export function Welcome({ recents, onPick, onOpen, onForget }: Props) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Spoon</h1>
        <p className="muted">Open a git repository to get started.</p>
        <button className="btn primary large" onClick={onPick}>
          <FolderIcon /> Open Repository… <kbd>⌘O</kbd>
        </button>

        {recents.length > 0 && (
          <>
            <h2>Recent</h2>
            <ul className="recents">
              {recents.map((p) => (
                <li key={p} onClick={() => onOpen(p)}>
                  <FolderIcon />
                  <div className="recent-text">
                    <span className="recent-name">{p.split('/').pop()}</span>
                    <span className="recent-path">{p}</span>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="Remove from recents"
                    onClick={(e) => {
                      e.stopPropagation()
                      onForget(p)
                    }}
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
