import { useEffect, useRef } from 'react'
import { SizeControls, ThemeSelect } from './SettingsWindow'
import { keys } from '../platform'

/** Quick appearance controls from the title bar; everything else lives in the Settings window. */
export function SettingsPopover({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest('.titlebar-right')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="popover settings" ref={ref}>
      <h3>Appearance</h3>
      <SizeControls />
      <div className="field">
        <span className="field-label">Theme</span>
        <ThemeSelect />
      </div>
      <button className="btn more-settings" onClick={onMore}>
        All settings… <kbd>{keys('⌘,')}</kbd>
      </button>
    </div>
  )
}
