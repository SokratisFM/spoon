# Changelog

Each version starts with `## <version> — <date>`. Each line starts with **New:**, **Improved:** or
**Fixed:**, which Spoon shows as a tag; the rest is Markdown. Spoon shows these notes in its
What's New popup, and `npm run release` uses a version's section as its release notes.

## 0.53.0 — 2026-11-06

- **New:** Merge branches: right-click a branch in the sidebar or in the history and choose “Merge … into …”. When it would only fast-forward you can still create a merge commit. If it stops on conflicts, a banner lets you commit the merge once they're resolved, or abort it.
- **New:** ⌘0 jumps to the checked-out branch in the history, like clicking its name at the top left. Default Size for the interface moved to ⌥⌘0.
- **Fixed:** New branch: a tag with the same name as the branch you base it on no longer gets used instead.
- **Fixed:** Submodules that couldn't download because you were offline (or GitHub was down) are tried again next time, instead of waiting until the project points them at a new commit.
- **Fixed:** Automatic submodule downloads respect `submodule.active` patterns like `libs/*` (from a clone made with `--recurse-submodules=<pattern>`).
- **Fixed:** Stopping the submodule download after a clone now stays stopped when the projects folder is a link to another folder.
- **Improved:** The welcome tour checks your SSH key only when it reaches the GitHub step, not as soon as it opens.
- **Improved:** Windows setup: Program Files and the Windows folder can't be chosen as the install folder, since setup doesn't ask for administrator rights.

## 0.52.1 — 2026-11-05

- **Improved:** New branch: “Based on” is a field you can type in. It searches branches as you type, and takes any other branch, tag or commit you name.
- **Fixed:** Clicking into a branch field (New branch, Compare Branches) selects its text, so typing replaces it instead of adding to it.

## 0.52.0 — 2026-11-05

- **New:** A welcome tour on the first launch, on Mac and Windows: a few small steps (colors, size and spacing, diffs, history, a few extras, GitHub and SSH, your projects) where every change shows up as you pick it, with a preview beside it. Skip any step, or the whole tour; Help → Welcome Tour (or Settings → About) shows it again.
- **New:** A proper Windows setup wizard, starring a wizard who has put down his fork: welcome, choose where Spoon goes, then open it. It's a single file that installs without internet access and without administrator rights.
- **Fixed:** Restoring an old version of a file from its history no longer writes through a link at the file's current name; restored files keep Git LFS content, line endings and the executable bit; and the current version goes to the Trash first whenever it differs, ignored and skip-worktree files included.
- **Fixed:** Fetch and pull errors no longer show a password or token from the remote's URL, and a merge stopped by a locked file is no longer reported as an unreachable remote.
- **Improved:** Missing submodules: Spoon follows `submodule.active` (and “no”/“off” values), only downloads from the project's own server by itself, and doesn't retry one it couldn't download until the project points it at a new commit. Retrying from the Clone dialog never runs alongside a download already under way.
- **Improved:** Cloning on “the branch with the latest commit” skips bot branches (gh-pages, dependabot, renovate), the Tab search uses your Clone choice, a clone whose branch can't be checked out leaves no half-made folder, and the branch list waits for a complete URL and gives up after 20 seconds.
- **Improved:** File History shows merges that changed the file by hand, reads 300 commits at a time (Show older commits), stops reading when closed, finds a renamed file's current name, and follows a commit picked on another branch.
- **Improved:** Settings → Accounts checks SSH once per opening, the Tab search reuses your GitHub repository list for 10 minutes (⌘R reloads it) and recognises more ways a project's remote can point at GitHub, and browser sign-in rides out a dropped connection.

## 0.51.2 — 2026-11-05

- **Improved:** Downloading missing submodules no longer holds up Fetch, Pull or anything else in the repository. It runs alongside them, with its own line in the toolbar saying which submodule is coming down and how far along it is (“Downloading MainLib (1 of 4) · 64% · 497 MiB”), and its own Cancel.

## 0.51.1 — 2026-11-05

- **New:** The Tab search lists your GitHub repositories that aren’t on this computer yet. Pick one and press Enter to clone it right there, next to your other projects, on the branch with the latest commit and with its submodules. ⌘Enter opens the Clone dialog to choose something else. Repositories you already have show up once, as your project. **GitHub only** (⌘G) in the search lists just the GitHub repositories you don’t have yet.

## 0.50.2 — 2026-11-05

- **New:** Missing submodules download by themselves. When you open a repository cloned with another app, or a pull adds a submodule, Spoon downloads the submodules this computer doesn’t have yet (MainLib, say), so Unity finds everything. Submodules you removed on purpose are left alone. You can turn this off in Settings → Projects.
- **New:** Clone Repository asks which branch to check out: the branch with the latest commit (the default), `develop`, or any other branch from the repository’s list.
- **Improved:** Sign in with browser works out of the box, like Fork: approve Spoon on github.com with a short code. There’s nothing to set up, and you don’t need the GitHub CLI or a token.
- **Improved:** Settings → Accounts shows whether SSH to GitHub already works, and for which account, instead of always offering to set it up.

## 0.49.1 — 2026-11-05

- **New:** **Show File History…** (⌥⌘L, or right-click a file in Local Changes, a commit's files or Compare Branches) lists every commit that changed the file, following it back through renames and moves. Pick one to see what it changed in the file, or the whole file as it was then. From there, jump to the commit in the history, compare that version with your working copy, or restore it (your current version goes to the Trash first).

## 0.48.2 — 2026-11-04

- **New:** **Compare Branches** shows everything that differs between two branches in one big window, like a pull request's Files changed on GitHub. The files are listed on the left, and every file's diff is stacked on the right in one scroll. The list follows along as you scroll, and clicking a file jumps to it. Tick **Viewed** to fold a file away as you go. Show only what a branch changed since it split off (like a pull request), or every difference between the two. Open it from Compare (⌥⌘D) → **Branches**, or right-click a branch → **Compare with…**.
- **New:** The branch fields in Compare Branches are searchable: type part of a name to narrow the list, use ↑/↓ and Enter to pick, or type any branch, tag or commit hash and use it as it is.
- **New:** When pulling or fetching fails because this computer has no SSH access to GitHub (as with MainLib), the error offers **Set Up SSH Key…**. Spoon makes a key if there isn't one and trusts github.com using the keys GitHub publishes. It adds the key to your GitHub account itself when Spoon's GitHub sign-in allows it; otherwise it copies the key and opens GitHub's page to paste it in. Then it checks that GitHub recognizes the key and shows which account it signs in as. It's also in Settings → Accounts.
- **New:** Stage or unstage single lines, like Fork. Point at a changed line in Local Changes and click **Stage line** (or **Unstage line** for a staged file). To take several, click or drag down the line numbers (⇧-click for a range, ⌘-click to add or remove one); the hunk's button then stages just those. Works in unified and split diffs. Esc clears the picked lines.
- **New:** **Clone Repository…** on the Welcome screen, the + tab menu, the project switcher and the File menu. Pick one of your GitHub account's repositories (with search) or paste any git URL, choose where it goes (next to your last project, outside any game it belongs to), and Spoon clones it, downloads its submodules and opens it. If a submodule like MainLib can't be downloaded because this computer has no SSH access to GitHub, the clone still opens. Spoon then offers **Set Up SSH Key…** and **Try Again**.
- **Improved:** In Simple Mode, a Unity asset moved or renamed outside Unity's tracking shows as one **Moved** card, so a move can't be half saved. Import settings changed on their own (a sliced sprite sheet's `.meta`) show and are saved with the asset's type, labelled "import settings".
- **Improved:** Double-click a tag's label to check out its commit, and press Enter in the commit list to check out, like a double-click. Double-clicking a remote branch whose local branch is elsewhere asks before switching.
- **Improved:** SSH setup works with keys kept in a password manager or the SSH agent, keys with a passphrase (it shows how to unlock them instead of making another), your SSH config (including GitHub over port 443) and git's own SSH command. It never overwrites an existing key. If the saved key for GitHub's server is outdated, it explains and replaces it only after you confirm. Spoon's GitHub sign-in asks for permission to add SSH keys only when SSH setup needs it.
- **Improved:** When fetching or pulling can't reach a repository, the error says which one: the project itself (and the address it used) or the submodule that failed.
- **Improved:** Compare Branches stays quick with thousands of files and very long or minified diffs, keeps Viewed files when the branches get new commits, and explains when a shallow clone can't find where branches split. Esc in its file filter clears the filter.
- **Fixed:** Staging or unstaging single lines at the end of a file without a final newline could join two lines in what was staged.
- **Fixed:** Staging a hunk or lines of a file that isn't UTF-8 (Windows-1252, say) changed its special characters.
- **Fixed:** If a file changed on disk after its diff was shown, staging picked lines could stage different ones. Spoon now asks you to refresh.
- **Fixed:** Line staging with `diff.suppressBlankEmpty` or `diff.context=0` in your git settings, for deleted and new files, and for renames: unstaging a line no longer undoes the rename, and a file's mode change is no longer staged along with a line.
- **Fixed:** Simple Mode forgot which files you'd unticked after visiting History or another tab, so they were saved and shared anyway. Saving now commits exactly the ticked files, even if something else was staged meanwhile.
- **Fixed:** A branch with the same name as a tag (like `1.2.0`) compared the tag in Compare Branches. Typing a commit id or a name in the branch fields and clicking away now uses what you typed.
- **Fixed:** Stash & Re-apply treated a failing post-checkout hook as a failed checkout, and now says up front when one of your new files is also on the other branch.
- **Fixed:** Clone no longer keeps a user name, password or token typed into the URL, cleans up a clone cut short by quitting, and says when you cancelled downloading the submodules.
- **Fixed:** Closing a parent tab with submodule tabs folded into it also closes those, and "Close Tabs to the Right" no longer closes hidden ones. Folded tabs no longer slide shut when Spoon opens.
- **Fixed:** Files dragged from another Spoon window are no longer staged in this one.

## 0.46.0 — 2026-11-03

- **New:** When local changes block a checkout, **Stash & Re-apply** stashes them, checks out, and puts them back on top. If they clash with the branch, the conflicts are marked in the files and the stash is kept; if they can't be put back at all (the branch has its own copy of a new file), the checkout still happens and they stay safe in the stash. If the checkout itself fails, your changes go straight back where they were.

## 0.45.0 — 2026-11-03

- **New:** Double-click a branch's label in the commit list to check out that branch, even when several branches are on the same commit. Double-clicking elsewhere on the row works as before.
- **Improved:** The commit list's right-click menu no longer lists a Checkout item per branch; double-click the label instead.

## 0.44.1 — 2026-11-03

- **New:** Submodule tabs can collapse into their parent repo's tab while you're in another repo. They slide shut into a count on the parent's tab (+2), where its close button appears when you point at it; opening the parent brings them sliding back. Turn it on in Settings → Appearance, or right-click a tab.

## 0.43.0 — 2026-11-02

- **New:** In Local Changes, drag files between Unstaged and Staged (several at once when they're selected). The grip button next to “as a list / as folders” turns it off.

## 0.42.3 — 2026-11-02

- **Improved:** Simple Mode's “Show” filters list only the file types you have changes of.

## 0.42.2 — 2026-11-02

- **New:** Simple Mode can show your changes in two sections, like git's unstaged and staged files: your changes on the left (or on top), what goes in the save on the right (or below). Drag files across, tick them, or use “Put all in the save”; nothing is in the save until you put it there. Side by side is the new default; the three buttons next to the list/preview switch pick one list, one above the other, or side by side.
- **Improved:** Pointing at Simple Mode's save buttons while they can't be used lights up the description box when that's what's missing.
- **Improved:** The refresh button (and Simple Mode's settings button) are gone from the toolbar: Spoon refreshes by itself, ⌘R still does it, and Simple Mode's settings are in Settings.
- **Improved:** Simple Mode's My changes / History switch sits in the middle of its top bar, where the full view has Fetch, Pull and Push.
- **Improved:** Simple Mode's save bar is one row: when you last saved, then the description, then the buttons.
- **Improved:** Simple Mode's changes start straight with your files: the three-step guide above them is gone, and “Tick all” is now “Select all” / “Deselect all”.
- **Fixed:** Simple Mode's list of changes no longer squashes its rows on top of each other when there are many files.

## 0.41.2 — 2026-11-02

- **New:** Tab colors. Color a repository's or submodule's tab by its name: right-click the tab, or add names (`*` matches any text) in Settings → Appearance. The open tab is tinted; the others get a dotted outline in their color.
- **New:** Tab colors can highlight the open tab with a color of its own (the theme's accent unless you pick one): off, the open tab only, or the open tab plus colors by name.
- **New:** Recents in the sidebar: the last 5 branches you were on in this repository (including outside Spoon). Click to show one, double-click to check it out; right-click the sidebar to hide it.
- **Improved:** Settings → Appearance keeps the color options together at the end: Theme, syntax colors, Tab colors, Branch colors.
- **Improved:** Settings is wider, and its previews fill their space instead of showing a small picture in the middle.
- **Improved:** Backspace on a stash in All Commits asks to delete that stash, as it does for branches.
- **Improved:** New MainLib release with the version bump is one step: if any part fails, nothing is left half-done (no stray branch, no uncommitted version file). It starts from the version on the branch you pick, suggests versions after the newest release branch (including ones only on the remote), won't remake one that's on the remote, and won't bump to the version that's already there.
- **Improved:** “Open Pull Request” matches a branch by its upstream too, and ignores pull requests from forks that happen to use the same branch name. The list is refreshed after a push.
- **Fixed:** Relinking an export whose folder is itself a link into Assets could turn the source file into a broken link. Such files now count as linked, and are never written over.
- **Fixed:** A bring-back from exports that stopped partway (a read-only file) no longer makes Spoon's own earlier writes look like your edits. Read-only sources are found before anything is written.
- **Fixed:** Relinking several files checks them all first: one that differs stops the batch untouched, and missing ones are skipped and listed. On Windows, only a link that can't be made asks for Developer Mode.
- **Fixed:** Native files reached through two paths in Assets pair with their exports again.
- **Fixed:** Removing a missing project that has a Simple Mode PIN keeps its tab when the PIN isn't given, and Locate… keeps its Simple Mode setup and PIN at the new location.
- **Fixed:** “Compare with Working Copy” files are kept with Spoon's data, so macOS no longer clears them from under an open compare tab.
- **Fixed:** The file popup's width now follows zoom (⌘+ / ⌘−).

## 0.40.2 — 2026-11-02

- **Improved:** The file popup widens to fit files with long lines, up to the window's width.

## 0.40.1 — 2026-11-02

- **Fixed:** Dragging a tab past the last one in the tab bar moves it to the end, instead of dropping it back where it was.

## 0.40.0 — 2026-11-02

- **New:** Right-click a commit or branch with an open pull request to open it in Spoon (“Open Pull Request #…”, under “Open … in Jira”). Branches that already have one no longer offer “Create Pull Request”.
- **Improved:** Jira, GitHub and Claude items in right-click menus have their icons.
- **Improved:** Clicking a ticket key in a branch name asks before opening Jira (Enter opens it).
- **Fixed:** Creating a Jira ticket with a description no longer fails with “The field value is not valid Atlassian Document Format (ADF) content”.

## 0.39.0 — 2026-10-30

- **New:** `⇧⌘B` opens New branch too, as in Fork.
- **New:** In the MainLib repository, New branch has a third option, "New MainLib release": type the version (or pick the next patch, minor or major), and Spoon makes `candidates/<version>` from the branch you choose, checks it out and, with "Bump the version and commit" on, writes it into `Version/Resources/mainlib-version.txt` and commits just that as "bumping version to <version>".

## 0.38.3 — 2026-10-30

- **New:** Create the Jira ticket and its branch in one go: in New branch (`⌘N`), pick "Create a new ticket", fill in the project, type (Task, Bug or Defect), title, description (Markdown) and fix version, then the branch is made for the new ticket (a bug or defect makes it a "fix"). Defaults for each live in Settings → Accounts → New tickets. If a ticket type needs fields Spoon can't set, it says so before you create it.
- **Fixed:** When your Atlassian token can't use Jira (one made for Confluence only), Spoon now says so and how to fix it, instead of quietly finding nothing.
- **New:** Settings → Accounts → Atlassian account: Update token replaces the token without disconnecting, and says what the new one can do (the changelog page, Jira, or both). The link for making a token is always there. With tokens that have scopes (each covers one app), add a separate Jira token there: Confluence keeps the first one, Jira uses its own.
- **Fixed:** A ticket description with certain pasted characters (from Slack or the web) could freeze Spoon; a code block with only empty lines, and words with underscores or asterisks (Load_Scene_Async, 2*3*4), now come out right in Jira.
- **Fixed:** Updating the Atlassian token can no longer replace a working Confluence token with a wrong one, a token is only ever sent over https, and a new token takes effect without restarting.
- **Fixed:** New ticket: switching project no longer keeps the last project's type or fix version, required fields left empty are pointed out, the popup can't be closed while the ticket is being created, and the branch uses the new ticket as made (no lookup). Branch names drop fixed text next to an empty part, and project keys with underscores work.
- **Fixed:** Simple Mode's background check for team saves no longer breaks Get latest, prunes branches or touches submodules.
- **Fixed:** Removing a project that's open in a tab keeps its Simple Mode setup and linked exports until the tab closes; removing a PIN-locked one asks for the PIN.
- **Fixed:** Unity exports: links whose source was deleted or moved show as broken; Relink links many files in one go; a read-only source is never overwritten (and a hard-linked one is written in place); a failed relink leaves the copy exactly as it was; automatic failures stay shown until dismissed.
- **Fixed:** Quitting after "Don't Save" only goes on when you were quitting; temporary files a compare tab shows are kept; the description template is saved when Settings closes right after typing.

## 0.37.5 — 2026-10-30

- **Improved:** New branch from ticket: every part of the name is optional. Leave one empty (say, no ticket) and it's left out, slash and all. The type choices (feature, fix) sit under their box, so the boxes stay one line tall; click the chosen one again to leave the type out.

## 0.37.4 — 2026-10-30

- **Fixed:** Quitting with unsaved edits in the file popup and choosing Don't Save now quits, instead of only closing the window.
- **Fixed:** Unity exports: Spoon checks every bring-back, link and add against the pairs it works out itself; adding a file never overwrites one that appeared meanwhile; a failed relink puts the export's own copy back; a bring-back writes the source all at once; links whose source is gone are counted as broken; and files two sources could claim are no longer paired with either.
- **Fixed:** "Open" on an export's source in another repository opens that repository; a source outside any repository can be revealed in the Finder.
- **Fixed:** Simple Mode's background check for the team's saves never makes a save or commit wait.
- **Fixed:** ⌘W on a file popup with edits asks once, not twice; ⌘Z brings back an empty Text compare tab properly and keeps the last thing typed in one; ⌘E right after picking another commit never opens the previous commit's file; and a failed Compare says why.
- **Fixed:** Spoon only reads and writes files inside repositories (including Windows' other names for .git), clears its old temporary files at start, tries a failed preview again later, and forgets a removed project's Simple Mode and Unity export settings.

## 0.37.3 — 2026-10-30

- **Fixed:** Unity exports no longer bring an export's copy back over a source that changed too (a teammate's fix you pulled, say): only when the source is still what it was when the two last matched. Copies still as Unity's export wrote them, and sources with changes of yours (uncommitted, untracked, ignored or outside git), aren't touched by themselves, and every source Spoon overwrites is copied to the Trash first.
- **Fixed:** Unity exports: a bring-back checks the files haven't changed since Spoon looked and waits for git work in their repository; when a repository's status can't be read, nothing in it is overwritten; Unity's own files edited in Android Studio or Xcode are no longer taken for new ones; changing the linked exports watches the new folders; and problems show in the Exports section and as a notice, whichever tab is showing.
- **Fixed:** The file popup doesn't overwrite a file that changed on disk since you opened it (it asks to reload or overwrite), ⌘S does nothing when nothing changed, files that aren't UTF-8 are no longer damaged by saving (they aren't edited there), mixed line endings are pointed out, and big files stay quick to type in.
- **Fixed:** Unsaved edits in the file popup aren't lost by switching tabs, opening another project or closing Spoon: it asks first.
- **Fixed:** The file popup and previews only open files inside the repository (not through a link to somewhere else, or into .git), and old versions of Git LFS files come back as the file, not its pointer. Opening an old version from history only opens documents and media.
- **Fixed:** Restoring an old version of a file copies your uncommitted changes to it to the Trash first.
- **Fixed:** Simple Mode: ⌘↵ pressed on History no longer saves and shares later by itself; Pull and Push shortcuts respect "needs a developer" and the wrong-branch lock; putting back or bringing back a file brings its Unity .meta too; and a change to hundreds of files stays quick (previews made a few at a time, cards shown a page at a time).

## 0.37.2 — 2026-10-30

- **New:** Unity exports: files you make in Android Studio or Xcode show up in the Exports section. Spoon suggests the folder each one belongs in (where the files next to it come from), and Add copies it there with a `.meta` file (copied from a file next to it, with its own GUID) and links the export to it, so it's ready to commit and later edits go straight into the repository. Unity's own files and leftovers from earlier exports aren't listed. With "Bring edits and new files back by themselves" on, a new file whose folder is certain (one folder fits, with a `.meta` to copy) is added by itself and shows up in Local Changes; the rest wait in the list for you to pick a folder. This works whichever tab you're looking at: with the Unity project open in any tab (or a submodule of it, such as MainLib), its exports are watched in the background, and the tab showing the changed files refreshes by itself.

## 0.36.3 — 2026-10-30

- **New:** Simple Mode, for teammates who don't use git themselves, such as artists. A project shows only the files they changed, as preview cards (images, Photoshop files and more), and walks them through it: check your changes, describe them, Save & share. History is a timeline of saves: open any file as it was, or put it back. Turn it on per project in Settings → Simple Mode, where you can also fix the branch to work on, show only one folder (say `Assets/Art`), and lock it with a PIN. The Simple/Full switch in the title bar flips between the two views.
- **New:** In Simple Mode, choose which file types show, from a list of common ones (images, Photoshop files, 3D models, sounds, scenes, prefabs, code…), in Settings or with the toggles above the changed files. Code, shaders, settings files and Unity .meta files are hidden at first. Hidden types aren't saved, but a Unity .meta file always goes along with its asset (a new folder's too).
- **New:** In Simple Mode, Spoon looks for the team's new saves every minute. When there are some, the History tab gets a count, Get latest lights up, and History shows them above "You are here" as what's coming. Spoon also says when your saves are only on your computer, and when the project is on the wrong branch or needs a developer's help.
- **New:** Simple Mode's History puts people first: who saved how many files, with their avatar and previews of what they changed. Your own saves are marked as yours.
- **Improved:** Discord Dark is the default theme.
- **Improved:** In Simple Mode the title bar keeps all its buttons; the ones that don't apply there are turned off.
- **Improved:** Unity exports: files an export uses get a link icon in Local Changes (in a submodule's or package's own tab too), so you can see which changes came from Android Studio or Xcode. When they changed a submodule (such as MainLib) or a local package, the Exports section shows a button that opens it.
- **Fixed:** Unity exports missed native files in folders named like Unity's own (such as `Data`, `build`, `Library`) and files from local packages (`Packages/…` or a `file:` package in the manifest). They're paired now.

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
