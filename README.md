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

## Resizing the UI

- **⌘+ / ⌘− / ⌘0** scale the whole interface (80%–200%).
- The **Aa** button (top right) has sliders for interface size and diff font size, plus row spacing and theme.
- Panel sizes are stored in `rem`, so sidebars grow with the text instead of truncating it.

## Layout

- `src/main/git.ts`: all git access. Shells out to the `git` CLI with machine-readable output, so LFS, hooks and credentials behave as in the terminal.
- `src/main/index.ts`: window, menu and IPC handlers.
- `src/preload/index.ts`: the `window.spoon` API exposed to the UI.
- `src/renderer/src/`: React UI. `settings.ts` holds scaling, `graph.ts` lays out the commit graph, `styles.css` holds the theme tokens.

## Settings (⌘,)

- **Appearance**: interface size, diff font size, row spacing and theme: System, Spoon Dark/Light,
  Discord Dark, Claude (follows macOS light/dark) or Custom.
- **Theme colors**: pick a color for every element. Editing any color switches to Custom, starting from the
  current theme; hover, selection and diff backgrounds are derived from these colors automatically.
- **Author colors**: map author names (or emails) to colors; their commits get a colored dot, avatar
  and row tint. "Add all authors from this repository" fills the list in one click.

## Everyday use

- **Local Changes**: double-click or press Enter to stage/unstage; ⌘-click and ⇧-click select several files; right-click for more.
  **Stage hunk / Unstage hunk** buttons sit on each hunk header in the diff.
- **Commit**: summary + description, Amend, ⌘Enter. The draft is kept per repository.
- **Fetch / Pull / Push** in the toolbar (⇧⌘F, ⇧⌘L, ⇧⌘P). Pull can rebase and autostash; Push can set the upstream and push tags.
  Badges show how many commits you are behind/ahead.
- **Checkout**: double-click a branch, remote branch or tag in the sidebar, or right-click a commit.
  Checking out a remote branch creates (or switches to) the matching local tracking branch.

- **Submodules**: the header chip lists every submodule and its state (up to date, modified, out of date,
  not initialized), with Update and Open; the sidebar has the same list. Double-click opens one in a new tab.
- **Stale branches**: the sidebar's Stale section lists local branches whose origin branch was deleted
  ("gone") or that match origin exactly ("synced"). Tick and delete; branches with commits found nowhere
  else ask for confirmation first. Fetch prunes deleted remote branches so this list stays current.

Git errors (rejected pushes, conflicts, hooks) are shown in full, exactly as git printed them.

## Next

New branch / delete / rename, merge & rebase, stash & discard changes, conflict resolution.
