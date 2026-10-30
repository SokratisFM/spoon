// Small stroke icons sized in em, so they scale with the text around them.
import type { ReactNode, SVGProps } from 'react'

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
      {...props}
    >
      {children}
    </svg>
  )
}

type P = SVGProps<SVGSVGElement>

export const BranchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <circle cx="18" cy="7" r="2.2" />
    <path d="M6 7.2v9.6M18 9.2c0 5-6 4-11 7.6" />
  </Icon>
)
export const CloudIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z" />
  </Icon>
)
export const TagIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </Icon>
)
export const StashIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
  </Icon>
)
export const ChangesIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </Icon>
)
export const HistoryIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="2.2" />
    <circle cx="12" cy="19" r="2.2" />
    <path d="M12 7.2v9.6" />
  </Icon>
)
export const CompareIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 5h6v14H4zM14 5h6v14h-6M7 9v6M17 12h0M15.5 12h3" />
  </Icon>
)
export const ListViewIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
)
export const TreeViewIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 5h6M7 5v12a2 2 0 0 0 2 2h3M7 11h5M15 11h5M15 19h5" />
  </Icon>
)
export const FolderIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
)
export const ChevronIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
)
export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Icon>
)
export const RefreshIcon = (p: P) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Icon>
)
export const FetchIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
)
export const PullIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3v13M6 10l6 6 6-6" />
  </Icon>
)
export const PushIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 21V8M6 14l6-6 6 6M5 4h14" />
  </Icon>
)
export const CogIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)
export const NewBranchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <path d="M6 7.2v9.6M17 11c0 4-5 4-10 6.2M17 3.5v6M14 6.5h6" />
  </Icon>
)
export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)
export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)
export const CopyIcon = (p: P) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Icon>
)
export const BoxIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </Icon>
)
export const BroomIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 4l6 6M9.5 8.5l6 6M4 20c2-1 3.5-3.5 5.5-5.5l-1-5L4 14z" />
  </Icon>
)
export const PullRequestIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <circle cx="18" cy="19" r="2.2" />
    <path d="M6 7.2v9.6M18 16.8V9a3 3 0 0 0-3-3h-4M13 3.5L10.5 6 13 8.5" />
  </Icon>
)
export const BackIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
)
export const ChildIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 5v8a3 3 0 0 0 3 3h9M15 13l3 3-3 3" />
  </Icon>
)
export const CheckoutIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 12h11M11 7l5 5-5 5M20 4v16" />
  </Icon>
)
export const PinIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z" />
    <circle cx="12" cy="10.5" r="2.2" />
  </Icon>
)
export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17.5v.01" />
  </Icon>
)
export const JiraIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
)
export const ArrowUpIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
)
export const ArrowDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
)
export const ShieldIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
)
export const CloudOffIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z" />
    <path d="M4 4l16 16" />
  </Icon>
)
/** Claude's spark. */
export const ClaudeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18" strokeWidth={2.1} />
  </Icon>
)
/** A terminal prompt with a clock: the git commands Spoon has run. */
export const TerminalHistoryIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6.5l4 3.5-4 3.5M10 15h3" />
    <circle cx="17.5" cy="15.5" r="4" />
    <path d="M17.5 13.5v2l1.3 1" />
  </Icon>
)
export const LockIcon = (p: P) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9.5" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
)
export const ImageIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 16l-5-5-8.5 8.5" />
  </Icon>
)
export const FileIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M14 3.5v5h5" />
  </Icon>
)
export const ModelIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </Icon>
)
export const AudioIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 18V6l11-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </Icon>
)
export const VideoIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10.5l5-3v9l-5-3z" />
  </Icon>
)
export const CodeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />
  </Icon>
)
export const SceneIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 19l6-8 4 5 3-3.5 5 6.5z" />
    <circle cx="16.5" cy="6.5" r="2" />
  </Icon>
)
export const GridIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
  </Icon>
)
export const LinkIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </Icon>
)
