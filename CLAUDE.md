# Spoon

Fork-style git client: Electron + React + TypeScript. See README.md for features and releasing.

## Versioning

Every change bumps `version` in package.json before it's built or installed:

- **minor** for new features (`npm version minor --no-git-tag-version`)
- **patch** for fixes (`npm version patch --no-git-tag-version`)

One bump per batch of work; a batch with any new feature is minor. Commit the bump with the change.
The self-updater compares these versions, so never reuse or lower one.

## Working on it

- `npm run typecheck`, `npm run build`, `npm run install:mac` (rebuilds `/Applications/Spoon.app`).
- Test runs must not touch the user's real data: launch with `SPOON_USER_DATA=<temp dir>`
  (the real data lives in `~/Library/Application Support/Spoon`).
- Settings and tabs persist through `src/renderer/src/storage.ts` (spoon-state.json), not localStorage.
