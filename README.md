# Spoon

A Fork-style git client with a modern UI that scales: every element and font can be resized.

## Run

```bash
npm install
npm run dev      # hot-reloading dev build
npm run build && npx electron .   # production build
```

## Install as a Mac app

```bash
npm run install:mac
```

Builds `Spoon.app` and copies it to `/Applications`, so it opens from Spotlight, Launchpad or the Dock.
Run it again after pulling changes to update the installed app. The app is ad-hoc signed (no Apple
certificate needed); the build copy goes to `dist.noindex/` so Spotlight lists only the installed one.

To change the icon, edit `build/icon.svg` and run `npm run icon`.

## Releasing

Spoon updates itself without an Apple Developer ID or a Windows code-signing certificate:
releases are signed with your own ed25519 key, and the app verifies every update before installing it.

One-time setup:

1. `npm run keygen` creates the signing key at `~/.config/spoon/release-signing-key.pem` (back it up:
   without it, installed copies can't verify new updates) and writes the public key into the app.
2. In `spoon.config.json`, set `updateRepo` to the GitHub repo whose Releases host Spoon (`owner/name`,
   public) and `githubClientId` to the Spoon OAuth app (Settings → Developer settings → OAuth Apps,
   with Device Flow enabled).

Each release:

```bash
npm version minor --no-git-tag-version
npm run release -- --notes "What changed"
```

This builds into `dist.noindex/release/<version>/`: Mac zips and DMGs for Apple Silicon and Intel,
the Windows installer, `latest.json` (the signed update manifest), `SHA256SUMS` and the install scripts.
It prints the `gh release create` command to publish them; nothing is uploaded automatically.

Installing for the first time:

- macOS: `curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | sh`
- Windows (PowerShell): `irm https://github.com/<owner>/<repo>/releases/latest/download/install.ps1 | iex`

Both verify checksums and avoid the "unidentified developer" / SmartScreen prompts that browser
downloads of unsigned apps get. A DMG downloaded in a browser works too, after **Open Anyway** once in
System Settings → Privacy & Security.

From then on Spoon checks every few hours, downloads updates in the background, and shows
**Restart to update**. Settings → About shows the version and has **Check now**.

## Resizing the UI

- **⌘+ / ⌘− / ⌘0** scale the whole interface (80%–200%).
- The **Aa** button (top right) has sliders for interface size and diff font size, plus row spacing and theme.
- Panel sizes are stored in `rem`, so sidebars grow with the text instead of truncating it.

## Layout

- `src/main/git.ts`: all git access. Shells out to the `git` CLI with machine-readable output, so LFS, hooks and credentials behave as in the terminal.
- `src/main/index.ts`: window, menu and IPC handlers.
- `src/preload/index.ts`: the `window.spoon` API exposed to the UI.
- `src/renderer/src/`: React UI. `settings.ts` holds scaling, `graph.ts` lays out the commit graph, `styles.css` holds the theme tokens.

## Finding projects (Tab)

Press **Tab** anywhere outside a text field (or click the search icon in the title bar) to open a
Spotlight-style switcher. It lists every project Spoon has opened, plus git repos in your scan folder
that you haven't opened yet (Settings → Projects: folder, depth, and whether to include repos inside
other repos). Type to fuzzy-search, ↵ to open, ⌘⌫ to forget a project.

Spoon remembers every project it opens. If one has been moved or deleted, opening it offers
**Remove from Spoon** or **Locate…**, like Fork; Settings → Projects can also remove all missing ones.

## GitHub

Settings → Accounts connects GitHub in one of three ways:

- **GitHub CLI**: reuses `gh`'s sign-in; Spoon asks `gh` for the token whenever it needs one.
- **Browser sign-in** (like Fork): needs a one-time OAuth app. On GitHub open Settings → Developer
  settings → OAuth Apps → New OAuth App (any name; homepage and callback URL can both be
  `https://github.com`), tick **Enable Device Flow**, register, and paste the **Client ID** into Spoon.
  No client secret is needed.
- **Personal access token** with `repo` and `read:org`, stored in the macOS Keychain.

Repos with a GitHub remote get **Pull Requests** in the sidebar (review requested / yours / others).
A pull request opens with Conversation, Commits and Files changed. Hover a diff line and click **+**
(⇧-click a second line for a range) to add comments to a pending review, tick files as viewed, then
**Review changes** to submit as Comment, Approve or Request changes. Pending comments are saved until
you submit. **Check out branch** switches to the PR's branch (forks become `pr-<number>`).

## Settings (⌘,)

- **Appearance**: interface size, diff font size, row spacing and theme: System, Spoon Dark/Light,
  Discord Dark, Claude (follows macOS light/dark) or Custom.
- **Theme colors**: pick a color for every element. Editing any color switches to Custom, starting from the
  current theme; hover, selection and diff backgrounds are derived from these colors automatically.
- **Author colors**: map author names (or emails) to colors; their commits get a colored dot, avatar
  and row tint. "Add all authors from this repository" fills the list in one click.

Everything (settings, tabs, projects, review drafts) is saved to
`~/Library/Application Support/Spoon/spoon-state.json` as you go, so it survives rebuilds, updates and
force-quits. Sidebar sections can be reordered or hidden in Settings → Appearance.

## Everyday use

- **Local Changes**: double-click or press Enter to stage/unstage; ⌘-click and ⇧-click select several files; right-click for more.
  **Stage hunk / Unstage hunk** buttons sit on each hunk header in the diff.
- **Commit**: summary + description, Amend, ⌘Enter. The draft is kept per repository.
- **Fetch / Pull / Push** in the toolbar (⇧⌘F, ⇧⌘L, ⇧⌘P). Pull can rebase and autostash; Push can set the upstream and push tags.
  Badges show how many commits you are behind/ahead.
- **Checkout**: double-click a branch, remote branch or tag in the sidebar, or right-click a commit.
  Checking out a remote branch creates (or switches to) the matching local tracking branch.

- **Submodules**: inside a submodule, a **← parent** chip takes you back. The header chip lists every submodule and its state (up to date, modified, out of date,
  not initialized), with Update and Open; the sidebar has the same list. Double-click opens one in a new tab.
- **Stale branches**: the sidebar's Stale section lists local branches whose origin branch was deleted
  ("gone") or that match origin exactly ("synced"). Tick and delete; branches with commits found nowhere
  else ask for confirmation first. Fetch prunes deleted remote branches so this list stays current.

Git errors (rejected pushes, conflicts, hooks) are shown in full, exactly as git printed them.

## Next

New branch / delete / rename, merge & rebase, stash & discard changes, conflict resolution.
