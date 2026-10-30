# Changelog

Each version starts with `## <version> — <date>`. Each line starts with **New:**, **Improved:** or
**Fixed:**, which Spoon shows as a tag; the rest is Markdown. Spoon shows these notes in its
What's New popup, and `npm run release` uses a version's section as its release notes.

## 0.35.1 — 2026-10-30

- **New:** What's New: every version's changes, in Spoon. It opens by itself after an update (new versions get a dot), and anytime from Settings → About or the Spoon menu.
- **New:** `⌘Z` reopens the tabs you closed, however you closed them (`⌘W`, the ✕, Close Other Tabs, Close Tabs to the Right), in their old place. In a text field, `⌘Z` is still that field's undo.
- **New:** Open any file in Spoon (`⌘E`, or right-click → Open in Spoon…) to view, edit and save it, with the same syntax colors as your diffs. From a commit, flip to that commit's version and restore it if you need to.
- **New:** Right-click a commit's changed files: open, view that version, compare with your working copy or any file, restore, reveal in Finder, copy the path or hash. Only what's possible for that file is offered.

## 0.33.3 — 2026-10-29

- **Improved:** Fast-forwarding several behind branches moves the ones it can and names the ones it can't, instead of failing them all.
- **Improved:** Every open pull request is listed (not just 100), and review requests to your teams count as awaiting your review.
- **Fixed:** JSON errors in Text Compare point at the right spot.
- **Fixed:** Graph dots past the 14th lane, remotes with a `/` in their name, Backspace after clicking a tag or stash, the "can't be found" screen on the wrong tab, and Settings checks rerunning on every search.
- **Fixed:** Tag names are checked against all of git's rules, and Windows copies that can't update their own files get the full installer.

## 0.33.2 — 2026-10-29

- **Improved:** Switching tabs during a push, pull or other operation keeps its progress, Cancel and any error.
- **Improved:** Create Pull Request, New Tag and New Branch stay open and keep what you typed when they fail.
- **Improved:** Pull request reviews hold back comments written before the latest push, keep comment ranges inside one hunk, and show threads on unchanged lines.
- **Fixed:** Bead-style squish shows a bead for each side of a merge.
- **Fixed:** Text Compare tabs forget their text when closed; a settings edit just before closing Settings or quitting is kept; custom themes follow your accent and background colors.
- **Fixed:** Checking out a pull request picks the right remote; Cancel also stops submodule fetches; the sidebar stays fast with thousands of remote branches.

## 0.33.1 — 2026-10-29

- **New:** Unity exports (sidebar → Exports): edits made in Xcode or Android Studio to an exported project's native code come back into Assets by themselves, as unstaged changes. Never over your own uncommitted edits, and never for manifests or Gradle files that Unity rewrites when it exports.
- **New:** Relink turns an export's copies into links to Assets, so later edits go straight into the repository.
- **Improved:** Hunk staging and discarding work whatever your git config says about diffs.
- **Fixed:** Reword keeps message lines that start with `#`; Amend survives switching views; only one Spoon runs at a time; the Update MainLib dialog can be closed after a failed step.

## 0.32.0 — 2026-10-29

- **Improved:** Updates download only Spoon's own code (about 2 MB) while Electron stays the same, instead of the whole app.
- **Improved:** The Mac build is for Apple Silicon only.

## 0.31.0 — 2026-10-29

- **New:** New branch from a Jira ticket (`⌘N`, or the branch icon at the top right): paste a ticket link (a copied one is filled in) and type, dev, ticket and description are filled in as separate, editable parts. The pattern is in Settings → Accounts.
- **New:** When local changes stop a checkout, Spoon lists the files and offers to discard some of them, or all of them and check out.
- **Improved:** Enter presses Discard in the discard confirmation.
- **Improved:** Settings shows Spoon's version at the top right.
- **Improved:** Releases are smaller: one download per platform.
- **Fixed:** With Squish branches on, a push or commit no longer hides the selected commit and its branch spotlight.

## 0.30.3 — 2026-10-29

- **New:** Spoon is on GitHub: updates come from its releases, and a one-line install command sets it up on a Mac or PC.

## 0.30.2 — 2026-10-29

- **New:** ← and → fold and unfold folders in Local Changes' folder view, and the selected commit's branch run in the history.

## 0.30.0 — 2026-10-29

- **New:** Search in Settings: options that don't match hide, matching ones stay usable, grouped by tab with counts. Related words find options by what people call them ("font", "dark", "squash"), and near misses get suggestions.

## 0.29.1 — 2026-10-28

- **Fixed:** The Tab switcher's footer stays on one line, without the Compare link.

## 0.29.0 — 2026-10-28

- **New:** Compare text as well as files: one Compare popup (`⌥⌘D`, or the icon at the top right) for both.
- **New:** Text Compare: paste or type into two sides and see the diff as you go. JSON is detected and can be checked (with Go to error), pretty-printed, compacted, or compared by content.

## 0.28.0 — 2026-10-28

- **New:** Compare any two files: drop them on the window, pick them in File → Compare Files…, or right-click a changed file. They open in a Compare tab that re-reads when either file changes.

## 0.27.1 — 2026-10-26

- **New:** Local Changes can show staged and unstaged files as a folder tree.
- **New:** The branch spotlight can fade the other branches' commits too.
- **Improved:** File badges read + / − / M in green, red and yellow, like Fork.

## 0.26.3 — 2026-10-26

- **Improved:** Updates and installs swap only Spoon's own files, so the next launch takes about half a second instead of over three.
- **Improved:** The app is much smaller (its code went from 19 MB to under 5 MB).

## 0.26.2 — 2026-10-26

- **Fixed:** Stash actions always hit the right stash; New Tag never lands on a stash or fold row and warns when the commit isn't pushed; release notes can't overwrite your edits.
- **Fixed:** Update MainLib backs up commits that would end up on no branch; Atlassian credentials only go to their own site.
- **Improved:** Syntax-colored diffs, squished history and the git command history are faster.

## 0.26.1 — 2026-10-26

- **New:** New Tag can publish a GitHub release in the same step: title, notes GitHub writes from what was merged (editable), latest, pre-release and draft.
- **Improved:** "Popups open" (in the middle or near the top) is first in Settings → Appearance, and right-clicking any popup's title switches it.

## 0.25.0 — 2026-10-26

- **New:** Syntax colors in diffs, by language, in full or subtle, with the changed words within a line highlighted.
- **New:** Use the color scheme of Rider, VS Code or Cursor: Spoon finds the one your IDE uses, or imports a scheme file.
- **New:** Unity scenes, prefabs and assets: object ids fade back, and each hunk names the GameObject and component it's in.

## 0.23.4 — 2026-10-26

- **New:** New Tag (right-click a commit, or `⇧⌘G`): a strip of the graph shows where the tag goes and which branch that is, and a versioned branch suggests the tag's name.
- **New:** Choose whether popups open in the middle of the window or near the top.

## 0.22.1 — 2026-10-26

- **New:** Squish branches (`⇧⌘S`): each straight run of commits shows only its first and latest one, as a fold row or a +N bead; click either to see them again.

## 0.21.1 — 2026-10-26

- **New:** Stashes show in the history, on the commit they were made on, with Apply and Delete.
- **New:** A Behind section lists branches that are only behind their remote, to fast-forward or delete. Stale now means what it means in git: branches whose remote branch was deleted.
- **Improved:** Right-clicking a sidebar item opens that item's own menu.

## 0.20.1 — 2026-10-26

- **New:** Create Pull Request can have Claude review the branch first, and picks up fixes committed after the review.
- **Improved:** Popups keep their top edge and grow downward instead of jumping around.

## 0.19.2 — 2026-10-25

- **Improved:** Review with Claude sends shorter, clearer prompts.

## 0.19.1 — 2026-10-25

- **Improved:** Atlassian API tokens with scopes work.
- **Improved:** Update MainLib leaves the model and effort to the Claude app when you use it.

## 0.19.0 — 2026-10-25

- **New:** Update MainLib: pick a newer MainLib version (with Release Candidate and Shipped labels from the changelog), see its tickets, then switch the submodule, stage it and hand the follow-up to Claude.

## 0.18.3 — 2026-10-25

- **Fixed:** Previews for row spacing, branch graph colors, sidebar sections and author colors.

## 0.18.2 — 2026-10-25

- **Improved:** A setting's preview shows every option side by side; Settings is wider; checkboxes are switches.

## 0.18.1 — 2026-10-25

- **New:** An eye next to each setting previews its other choices.

## 0.18.0 — 2026-10-25

- **New:** Git Command History (`⇧⌘H`): every git command Spoon ran, live, with how long it took and how it went; click one to copy it.
- **Improved:** The commit column shows 9 characters, and clicking it copies the full hash.

## 0.17.1 — 2026-10-25

- **Fixed:** Discard keeps everything it overwrites in one Trash folder and undoes only the staged part of a staged file.
- **Fixed:** Shortcuts no longer act on another tab or under an open dialog, and Enter never confirms a risky action.

## 0.17.0 — 2026-10-25

- **New:** Branch spotlight: the selected or hovered commit's branch line lights up and the others dim.
- **New:** Create Pull Request from a branch's right-click menu: title, Jira link, target branch, assignee and reviewers filled in, and the branch pushed first if needed.
- **New:** Review with Claude (`⇧⌘R`): hands a review of your changes or a commit to the Claude app or to Claude Code in Terminal.
- **Improved:** Right-click menus are Spoon's own: themed, keyboard-friendly, with shortcuts shown.

## 0.16.1 — 2026-10-25

- **New:** Hold ⌥ to turn Commit into Commit and Push (also `⌥⌘↵`).

## 0.16.0 — 2026-10-24

- **New:** Discard selected changes (`⇧⌘D`, or right-click): new files go to the Trash, conflicted ones are left alone.

## 0.15.0 — 2026-10-24

- **New:** Optional playful toolbar animations while fetching, pulling and pushing.
- **Improved:** The Fetch, Pull and Push arrows glide while they work.

## 0.14.0 — 2026-10-24

- **New:** `⌘F` filters the commit history.
- **Improved:** Branches whose remote was deleted are marked in the history; Refresh spins while it works.
- **Fixed:** Accent text in the Discord theme is easier to read.

## 0.13.0 — 2026-10-24

- **New:** Hovering a setting previews it.
- **Improved:** Confirmations are Spoon's own dialogs instead of system boxes.

## 0.12.1 — 2026-10-24

- **Improved:** Switching tabs is near-instant: open tabs load in the background.

## 0.12.0 — 2026-10-24

- **New:** Cancel for fetch, pull, push and other long git operations.
- **Improved:** Force push is never on by default, and lists the commits it would drop.
- **Improved:** Warnings when amending a pushed commit or staging files with conflict markers.

## 0.11.0 — 2026-10-24

- **New:** Updating or resetting a submodule explains what will happen first, with a backup branch for commits that would end up on no branch.

## 0.10.0 — 2026-10-24

- **New:** Rebase onto a branch, plainly or interactively: reorder, reword, edit, squash, fixup and drop commits in place.
- **New:** Force push with lease when a branch has diverged from its remote.

## 0.9.1 — 2026-10-24

- **New:** Double-click a commit to check it out; Backspace deletes the selected branch (optionally on the remote too).
- **New:** Branch labels take their graph line's color, and colors can be reserved for branch prefixes.
- **New:** Jira ticket keys in branch names and commit messages link to Jira.
- **Improved:** Fetch, Pull and Push show their progress; the commit details pane can be collapsed.

## 0.4.0 — 2026-10-24

- **New:** The checked-out commit stands out, in one of three styles.

## 0.3.0 — 2026-10-24

- **New:** Right-click menus for tabs, the sidebar and pull requests; the commit details and file list can be resized.

## 0.2.1 — 2026-10-24

- **Fixed:** Dropdowns fit their text.

## 0.2.0 — 2026-10-24

- **New:** `⌃Tab` and `⌃⇧Tab` cycle through tabs.

## 0.1.0 — 2026-10-23

- **New:** Spoon: a Fork-style git client. Tabs for repositories, a branch graph, commit details and diffs, staging files and single hunks, commit and amend, fetch, pull, push and checkout. The whole interface scales.
- **New:** Themes, author colors, submodules and stale branches.
- **New:** A project switcher (Tab) with every repository you've opened and others it finds.
- **New:** GitHub pull requests: review the conversation, commits and files, comment on lines and ranges, approve or request changes, check one out.
- **New:** Side-by-side diffs, self-updating releases, and Windows support.
- **Improved:** Tabs can be dragged, and the window remembers its size and place.
