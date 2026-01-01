# Security policy

## Reporting a vulnerability

<!-- To be filled in by the maintainer: where to report (a private e-mail
     address or the repository's private vulnerability reporting), what to
     include, and how soon to expect an answer. -->

Please do not report a security problem in a public issue.

## Supported versions

Only the latest release gets security fixes. There are no automatic updates:
the app does not go online, so a fixed version has to be downloaded by hand.

## What the app defends against

SnippStudio is a local video editor (Electron). It opens no connection to the
internet. Three parts of it handle content or programs it does not control,
and each is held behind its own fence:

- **Code clips** (a web page in a folder, drawn as a clip) run in a sandboxed
  frame or window with no network, no access to the user's files or media
  outside the clip's own folder, no other clip's folder, no permissions and no
  bridge to the main process. A folder outside the project runs only after the
  user agrees once.
- **The agent server**, when the user turns it on, listens on `127.0.0.1` only
  and needs a 32-byte token compared in constant time; requests carrying a
  browser `Origin`, a foreign `Host` or no token are refused. The agent's tools
  have no file, shell or network access, cannot save or export, and by default
  only fill a draft the user accepts or rejects.
- **Project files** are JSON from anywhere: paths are rebuilt by the main
  process, network and device paths are treated as missing, and sizes, rates
  and times beyond what a project can hold are brought back to a limit.

The packaged program refuses debugging switches (`--remote-debugging-port`,
`--inspect`…), opens no DevTools, and has its Electron fuses set (no
`ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, asar integrity checked). Its test
hooks (used by the end-to-end tests to answer file dialogs and drive the
page) are compiled in but off: they turn on, together with DevTools and the
debugging switches, only when the program is started with `--e2e` and its own
`--user-data-dir` **and** a marker file `resources\e2e-test-hooks` sits in the
program's folder. Only the test runner writes that file, for the length of a
run; a built package never holds it (the package check refuses one). Whoever
can write into the program's folder could replace the program itself, so the
marker gives no new power.
Processes it starts for an agent do not search the current folder for
programs.

## Known limits

The main ones (the full list, with what was tried and how, is in
[`SECURITY-REVIEW.md`](SECURITY-REVIEW.md)):

- The editor page is served from `file://`. If a script ever ran inside it (no
  way to make one run is known) and a `.js` file of the attacker's lay on the
  disk at a known path, a worker started from that file could read local
  files. It could not send them anywhere: the app has no network.
- The agent token changes only when the user renews it (Settings → Agent
  connection → Renew key). With Codex it is in the environment of the terminal
  Codex is started from;
  with Antigravity (experimental) it is in Antigravity's own settings file as
  plain text.
- The installer is not code-signed.
- Not tried: the installer itself and the install folder's permissions,
  macOS and Linux, real Codex, OpenCode and Antigravity installs.

Electron 43 leaves upstream support in January 2027; moving to a newer major
line is planned as separate work.
