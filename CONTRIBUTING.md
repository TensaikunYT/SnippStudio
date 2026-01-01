# Contributing to SnippStudio

Thank you for helping. This file says how the work is organised and which
rules a change has to keep. Questions and bug reports go to the issue tracker;
security problems do not (see [`SECURITY.md`](SECURITY.md)).

## Branches and pull requests

- `main` is the published branch. Work on a branch of your own and open a pull
  request against `main`.
- Keep a pull request to one subject. Say what it changes for the user, how you
  tried it, and which tests cover it.
- By contributing you agree that your contribution is licensed under
  GPL-3.0-or-later, like the rest of the project. There is no separate
  contributor agreement.

## Before you open a pull request

```bash
npm ci
npx tsc --noEmit         # types
npm test                 # unit tests; delete out-test/ first if you removed a test
npm run build
```

- `npm test` compiles the tests into `out-test/` and runs whatever is there, so
  a deleted test's old compiled copy would still run: remove the folder first.
- Tests that need the speech model (`models/`, see the README) or the private
  test footage are skipped with a reason when those are not present. A new
  test must do the same rather than fail on a fresh clone.
- `npm run e2e -- --only=<regex>` opens the built app off-screen with a
  throw-away profile and runs end-to-end scenarios over the Chrome DevTools
  Protocol. It never touches your own profile. Run the scenarios of the area
  you changed. Elements are found only by `data-testid` or by role and name;
  a new part of the interface that a scenario needs gets a `data-testid`.
- A change that should not change what is drawn is checked with the reference
  frames (`scripts/qa/reference/README.md`): the same hashes before and after.

## Rules the code keeps

1. **No hidden features.** Something is in the product or it is not: never add
   a flag or an edition that hides a feature.
2. **The interface is built only from `src/renderer/src/ui/`.** Its building
   blocks (`ui/index.ts`: `Button`, `IconButton`, `Icon`, `Slider`,
   `NumberField`, `TextField`, `Select`, `Field`, `Toggle`, `Checkbox`,
   `Segmented`, `Tabs`, `Menu`, `Dialog`, `Tooltip`, `notify()`, `Chip`), its
   values only from `ui/tokens.css`. A new icon is added through
   `scripts/icons/make.mjs` (Lucide).
3. **Every word the user sees comes from `t()`**, in English and Turkish
   (`ui/strings*.ts`: key → `{ en, tr }`). Tests reject plain text in
   components (JSX text, `title`, `aria-label`, `placeholder`, toasts), emoji
   used as icons, and a key without both languages. The default language is
   English. Write the product's name as the `{app}` parameter, never as text.
4. **The app never steers how an agent animates.** Tool definitions, tool
   answers, project files and instructions carry no visual or style advice:
   no "draw it like this", no preferred fonts, colours or layouts, no
   mandatory template. The agent, and the user's own skills, write an
   animation the way they always do; making that page play in the preview is
   the app's job. Templates come in only when the user picks them.
5. **Edits are commands.** `src/renderer/src/commands/` holds pure edits
   (`defineCommand`): a command never reads the selection, the playhead, the
   DOM or `localStorage`, and gets randomness, the clock and text measuring
   through its `env` (a test enforces it). The store's actions wrap them, and
   every action's undo behaviour is locked by a test.
6. **The agent's tools are declared once** (`src/renderer/src/agent/tools.ts`)
   and their definitions stay small: a test keeps `initialize` +
   `tools/list` within a character budget.
7. **The app stays offline.** No request leaves the computer; the main
   process refuses every non-local one. Do not add a dependency that phones
   home, and no telemetry.
8. **Every source file starts with the licence header**
   (`node scripts/yayin/spdx.mjs --write` adds it; a test checks it):

   ```
   // SPDX-License-Identifier: GPL-3.0-or-later
   // Copyright (C) 2026 SnippStudio contributors
   ```

## Dependencies

- A new production dependency needs a licence compatible with
  GPL-3.0-or-later. `node scripts/yayin/notices.mjs` rewrites
  `THIRD-PARTY-NOTICES.md` from `package-lock.json` and fails on an unknown or
  incompatible licence, and writes `licenses/node-packages.txt` (the licence
  file of every package whose code ships; the package puts `licenses/` beside
  the program); `npm test` runs its check. After a dependency change, run it
  and commit both files.
- Prefer no new dependency. The renderer is bundled; the package carries no
  run-time module at all (`electron-builder.config.cjs`).

## Personal material

Do not commit your own footage, voice recordings, projects, paths or keys.
`node scripts/yayin/tara.mjs --tree --no-names` scans the tracked files for
user folder paths, e-mail addresses, key shapes, large binaries and media
files, and reports where it found them without copying what it found (with
`--names=<file>` instead, it also looks for the names on your own list, kept
outside the repository).

## Comments that name planning notes

Many comments name the phase a decision was made in and its notes
(`FAZ…-PLAN.md`, `ANA-PLAN.md`, `tarifler/`, `haritalar/`, `tasarim/TASARIM.md`,
`SOZLUK.md`). Those are the maintainers' working notes, kept beside the
repository and not published; the comment itself says what was decided, and
the code and its tests are the reference. Tests that compare with those notes
skip when they are not there.

## Code of conduct

Be kind and specific. Criticise code, not people.
