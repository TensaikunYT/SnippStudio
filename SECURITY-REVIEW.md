# Security review

Last review: 23 November 2026 (three independent audits of the source and of a packaged build, the security patch described below, an audit on 22 November and a final one before the public release on 23 November). This file says what the app defends against, what was tried against it and held, what the patch closed, and what is knowingly left open. It is not a guarantee: finding no known hole does not show there is none.

## What the app is

A local video editor (Electron, React, TypeScript). It opens no connection to anywhere. Three parts of it deal with content or programs it does not control:

- **Code clips.** A code clip is a web page in a folder (`index.html`), run inside the editor to draw frames. The page may come from anywhere: an agent wrote it, or it arrived with a project.
- **The agent server.** When the user switches it on, an AI agent the user runs on the same computer (Claude Code, Codex, OpenCode) reaches the open project through MCP tools over HTTP on `127.0.0.1`. The user adds the app to the agent once (a command the user runs; Settings → Agent connection) and works from the agent's own chat. Since 21 November 2026 the app has no embedded terminal and never starts an agent program (below, "Removed").
- **Project files and media.** A `.snipp` file is JSON from anywhere; media files are decoded by Chromium.

## Threat model

1. **Content run inside the app.** A code clip's page is hostile: it tries to reach the network, the user's files, the user's media, another clip's folder, the editor's own page and its bridge to the main process.
2. **A project file from somewhere else.** It names paths, sizes and text of the attacker's choosing, and may arrive in a folder that holds other files (programs, links, pages).
3. **Other things on the same computer.** A web page in the user's browser, or a program without special rights, tries to reach the agent server, to start the app with arguments, or to drive it through a debugging port.
4. **A misled agent.** Text in the project (a subtitle, a note, a file name) talks the agent into doing something the user did not ask for.

Out of scope: a program already running as the user with free access to the user's files (it can read the profile, the token and the projects directly), an administrator, physical access, and unknown faults of Chromium's own decoders and sandbox.

## What was tried, and held

Tried on a build of the app in an off-screen window with a throw-away profile, with harmless markers; a local listener counted every request that got out.

**Code clip sandbox** (about 45 probes, each from the page, from a child frame and from workers made from `blob:` and `data:`, in all three ways a clip is drawn: the editor's own frame, the clock layer, the hidden drawing window): 0 requests reached the listener, 0 files outside the clip's own folder were read.

| Tried | Result |
|---|---|
| `fetch` (cors, no-cors), WebSocket, EventSource, `sendBeacon`, images, CSS `@import` / `@font-face` / `url()`, `<link>` prefetch / preload / preconnect, frames, form posts, to loopback and to the internet | refused by the page's policy; with the policy switched off (a test-only switch), refused by the main process's request filter alone |
| The agent server from inside a clip (`POST` to its loopback port) | refused |
| The user's media (`media://`), listed and unlisted | refused: the request filter judges who asks, and the protocol handler serves only what the filter stamped |
| Another clip's folder (fetch, `import()`, frame) | refused; frame navigation is held to the clip's own folder |
| `file://` (fetch, image, frame) | refused |
| Climbing out of the folder: `..`, `%2e%2e`, `%5c`, a drive letter, UNC, `::$DATA`, trailing dots and spaces, 8.3 short names, a junction to another folder | refused (403 / 404); links are resolved before a file is served |
| `window.open`, `top.location`, `top.document`, the bridge (`window.api`) | no window, no navigation, no access; a clip's frame has no preload at all |
| Permissions: microphone, screen, notifications, location, clipboard, full screen, persistent storage | all refused |
| Service worker, shared worker, a worker loaded from the folder | refused or not started |
| Downloads | prevented in every session |
| The clip runs in a process of its own (an out-of-process frame, or its own window): an engine fault there is not the editor's process | observed |

**The agent server** (raw HTTP against a running instance):

| Tried | Result |
|---|---|
| Reaching it from another address (`[::1]`, the LAN address) | connection refused: it listens on `127.0.0.1` only, and on nothing while it is switched off |
| No token, a wrong token, a prefix of the token | 401; the token is 32 random bytes, compared in constant time; no path answers without it |
| A browser page: any `Origin` header, even with the right token; a preflight; a plain form post | 403, and no CORS header is ever sent |
| DNS rebinding: a foreign `Host`, a `Host` without the port | 403; no `Host` at all: 400 |
| A made-up session id | 404 |
| Tool arguments: `..\x`, `C:\x`, UNC, `file:///`, device names, over-long and NUL-holding names for a new clip's folder; a path smuggled into an edit; internal commands | all refused before anything is made; the tools have no file, shell or network access and cannot save or export |
| A misled agent's worst outcome with the app's tools | a draft the user must accept; a direct edit is one undo step with a restore point written first |

**The shell and the package:**

| Tried | Result |
|---|---|
| `--inspect`, `NODE_OPTIONS=--inspect`, `ELECTRON_RUN_AS_NODE=1` on the packaged program | no port opened, no Node: the fuses hold (table below) |
| The test hooks' IPC in a packaged program started with `--e2e` | "No handler registered" |
| Ports while running | none while the agent server is off; with it on, `127.0.0.1` and its one port; no UDP, no outgoing connection |
| Every window (editor, export worker, clip drawing window) | sandboxed, context-isolated, no Node integration; new windows denied; navigation and redirects held to the app's own page; `webview` refused |
| HTTP(S) and loopback HTTP from the packaged editor | refused |
| Project text: `<script>` and `<img onerror>` in names, subtitles, notes | shown as text; the editor has no HTML or `eval` sink |
| Project file: `__proto__` keys; `http:`, `javascript:` and UNC addresses for media | no pollution; addresses are rebuilt by the main process, UNC and device paths are "missing" (no SMB request) |

ffmpeg and ffprobe are not part of the product (export is WebCodecs), so their argument and playlist attack surface does not exist.

## What the security patch closed

No critical finding. The holes were in how an agent is started and in layers of defence. Each item below has a test that showed the hole before the repair (`src/test/security-patch-<n>.test.ts`, end-to-end scenarios `96`–`98` in `scripts/e2e/scenarios`).

| # | Severity | What | Repair |
|---|---|---|---|
| 1 | High | An agent started in the project folder ran a program planted there: an npm shim (`codex.cmd`, an older `claude.cmd`) names `node` without a path, and `cmd.exe` looks in the current folder first. A project folder holding `node.bat` ran it with the user's rights. | Every process the app starts for an agent gets `NoDefaultCurrentDirectoryInExePath=1`; the "run in your own terminal" line names the agent by its full path and sets the same switch. Tested with planted `claude.bat`, `claude.cmd`, `codex.cmd`, `node.bat`, `node.cmd`, `node.exe`, `claude.exe` in the embedded terminal, the system terminal, the copied line and the version query. |
| 2 | Medium | System tools were started by bare name (`taskkill`): Node looks in the app's current folder first. | One helper gives the full path under `%SystemRoot%\System32`; a scan test finds any bare start in the main process; tools start outside the project folder. |
| 3 | Medium | The packaged program accepted `--remote-debugging-port`: any local program could then drive the whole editor. DevTools and the test hooks (`window.__store` …) were available in the package. | A packaged copy started with `--remote-debugging-port`, `--remote-debugging-pipe`, `--inspect*` or `--load-extension` (in any spelling Chromium reads) exits with code 64 before anything opens; it has no DevTools and installs no test hook. The one exception is the packaged test run: a marker file in the program's own folder plus `--e2e` plus its own profile folder. |
| 4 | Medium | The editor page could read any file on the disk over `file://`. | The main process's request filter passes `file:` only inside the folder the app's own page is served from; the page's policy no longer lets `fetch` / `XMLHttpRequest` reach a `file:` address, which a worker made from a blob inherits. See the known limit below. |
| 5 | Medium | A junction planted as `anim\<name>` in a project folder made the agent's "create a code clip" write outside the project. | The folder's real path (links resolved) must lie inside the project folder, before and after it is made; the same for the template copy, the version keeper and its `.surumler` folder. |
| 6 | Medium | A project file could name any local folder holding an `index.html`, and the app ran it as a code clip on open, unasked; `--code-film=<folder>` from another program did the same. That page could read every file of that folder. | Trusted folders. A folder runs unasked only when it lies strictly inside the project's own folder, or the user brought it in by hand on this computer (kept in the profile). Any other folder waits: the clip stays empty and the user is asked once, "Run the code in this folder" / "Don't run". |
| 7 | Medium | The page was handed the agent server's token (unused by the interface). | The token never leaves the main process and the profile's files. Only the window that started the agent's terminal can type into it (tested with a second window). |
| 8 | Low | A half-sent request was kept open for 86 s; no connection limit; a body over 1 MB got a dropped connection instead of 413. | Ten seconds to send a whole request; at most 64 connections; 413 reaches the client. |
| 9 | Low | A project file with a 1e9-pixel canvas, 1e9 frames a second or a 1e308-second clip opened as it was. | Values beyond what a project can hold are brought back to a limit when the file is read, and the user is told. |
| 10 | Low | `CONIN$`, `CONOUT$`, `con .txt` passed as local file paths. | Refused, with the other device names Windows keeps. |

## Closed on 22 November 2026

Found by an audit of the code written after the patch; both are layers of defence (no way to run a script inside the editor page is known). End-to-end scenario `security-chosen-paths`, unit test `src/test/d22-b-files.test.ts`.

| What | Repair |
|---|---|
| **A dropped file's path came from the page as text** (`project:register-dropped`, added on 21 November; `media:register-dropped` and `media:register-dropped-folder` from the start). A script in the editor page could name any `.snipp` / `.autocut` file on the disk as "dropped" and then save over it, rename it or move it to the bin, with no window asked. | The page hands the bridge the dropped `File` object; the preload takes its path itself (`webUtils.getPathForFile`). A `File` a script made has no path, and text is not a `File`. The same for a dropped **code clip folder** (`codefilm:register-dropped`). A folder the page names by its path (`codefilm:register`) is registered only when it may run already (inside the window's own project folder, or on the profile's trusted list: the folders the app itself made and handed to the page, a template's copy and the agent's new clip, are trusted where they are made), and that call trusts nothing new. Before, it put whatever folder the page named on the trusted list for good, although item 6 says the page cannot trust a folder of its choosing. End-to-end scenario `security-trusted-folder`. |
| **An export's other outputs were made writable unasked.** The save window's answer also opened the files of the same name with another extension beside the chosen one ("siblings": any output type, `.snipp`, `.json` and `.txt` too). The system's "replace it?" covers the chosen file alone, so a `name.wav` beside the chosen `name.mp4` was written over without a question, and the cover picture was approved with "replace" already set. | The save window opens the one file chosen in it. Every other file of an export goes through `export:approve`: a folder the user chose in a system window, plain file names with a sound, picture or video extension, and the files already there are named back to the window, which asks once before any is replaced. |
| **A GIF export (23 November, KOLAY-PLAN.md).** `.gif` joined the export file types (`shared/export-place.ts` EXPORT_EXTENSIONS, `main/security.ts` OUTPUT_EXTENSIONS). | Nothing else is opened: a GIF is written only through `export:approve` (a folder the user chose, a plain name, a file already there asked about) or the save window, into `<name>.gif.part` and put in place, as the sound alone is. The writer is the app's own code (`renderer/src/export/gif.ts`), no new package. |

## Closed on 23 November 2026 (final audit before the public release)

Everything added since the 20 November review was read again (the connection wizard, the export place and GIF, the voice-over, the agent's regions, labels and plan, dropped files), and the agent server was tried from outside with raw HTTP: end-to-end scenario `security-agent-door` (only `127.0.0.1` listens; 401 for no, a wrong, a shorter, a longer, a Basic or a case-changed key; 403 for any `Origin`, `null` included, even with the right key, for a preflight and for a foreign or port-less `Host`; 400 without a `Host`; 405, 404, 413 for a sent or only declared 1.5 MB / 100 MB body; 100 idle connections dropped by the server within its ten seconds, then answered again; an agent's program name, worker label and plan steps holding HTML shown as text; nothing listening with access off). Two findings, both repaired; unit test `src/test/guvenlik-son.test.ts`.

| What | Repair |
|---|---|
| **PowerShell's typographic quotes (G1, low).** The lines the connection wizard copies and the app's own Codex key check put the profile's path (and the agent program's) inside `'…'` and doubled only `'`. PowerShell takes `‘ ’ ‚ ‛` for a quote too: a user folder such as `O’Brien` broke every copied line, and a crafted path ran its own command, also in the check the app runs itself. The path is the user's own (their profile folder), so no outsider chooses it. | `psq` doubles all five quotes; the three lines that quoted by hand use it. The test runs Windows' PowerShell on such a path (it ran `Set-Content` before the repair). |
| **An install line named an unchecked npm package (G2, medium for OpenCode users).** Settings copied `npm install -g @opencode/cli` for OpenCode, a name OpenCode does not publish; whoever registered it would run code on every user who pasted the line. | `npm install -g opencode-ai`, OpenCode's own package; the test pins the four install lines and their pages, so a new one is a deliberate change. |

## Fuses of the packaged program

Read from the packaged program with `electron-fuses read` (Electron 43.8.12):

| Fuse | State | What it means here |
|---|---|---|
| RunAsNode | off | `ELECTRON_RUN_AS_NODE` does not turn the program into a plain Node |
| EnableNodeOptionsEnvironmentVariable | off | `NODE_OPTIONS` is ignored |
| EnableNodeCliInspectArguments | off | `--inspect` opens no debugger (and the app exits on it anyway: item 3) |
| EnableEmbeddedAsarIntegrityValidation | on | a changed `app.asar` is not loaded |
| OnlyLoadAppFromAsar | on | no loose `app` folder is loaded in its place |
| EnableCookieEncryption | off | the app keeps no cookies |
| LoadBrowserProcessSpecificV8Snapshot | off | not used |
| GrantFileProtocolExtraPrivileges | **on** | the page is served from `file://` and needs it; see the first known limit |

The remote debugging port has no fuse: item 3 is the app's own refusal. Started with any of the refused switches, the packaged program ended with exit code 64 in 0.4–5.8 s, and its port did not answer once, before or after.

## Dependencies

`npm audit` before the patch: 13 advisories (6 high, 7 moderate, 0 critical). After: 8 (2 high, 6 moderate, 0 critical).

Updated inside their major lines, from the official npm registry only, without `--force`: Electron 43.1.1 → 43.8.12 (the Chromium and Node fixes of the 43 line; its binary is checked against the checksums its npm package carries), Vite 7.3.6 → 7.3.8, undici, fast-uri, source-map-js, and electron-builder's own packages 26.15.3 → 26.18.1. No package gained an install script.

What is left needs a major version and was not done: `@huggingface/transformers` 3 → 4 (the advisory comes through `sharp`, which the app never loads and the package does not contain: the app runs onnxruntime-web), and the electron-builder chain (`minimatch` and others: build tools, not part of the package).

## Known limits

- **A worker started from a `.js` file on the disk can read files (item 4, not fully closed).** The editor page is served from `file://`. For such a page Chromium asks neither the app's request filter nor a protocol handler about what a *worker* loads, and a worker started from a file has no policy of its own. So if a script ever ran inside the editor page (no way to make one run is known: the editor has no HTML or `eval` sink) **and** a `.js` file of the attacker's lay on the disk at a path the script knows (inside a project folder, say), it could start that file as a worker (`new Worker`, `SharedWorker`, `importScripts` from a blob worker) and read local files from there. It still could not send them anywhere: the app has no network. Everything that needs no planted file is refused (end-to-end scenario `98`: 17 ways). The cure is to serve the app from a scheme of its own and switch the `GrantFileProtocolExtraPrivileges` fuse off; that moves the page to another origin, and the settings, shortcuts, imported fonts and caches kept under the `file://` origin would have to be carried over. It is a piece of work of its own. (Tried on the packaged program: with that fuse switched off and nothing else changed, the editor does not load at all, since a `file://` page may then not load its own module scripts; the fuse was switched back on.)
- **Removed on 21 November 2026: "if the editor page were taken over, the agent bridge reaches the user's shell".** The page could start the installed agent in an embedded terminal (node-pty) and type into it. That terminal, its bridge (start, type, read, resize, send), the system-terminal and copied connect line of "way D", and the native module are gone (TERMINAL-YOK-PLAN.md): the page's bridge can now only turn agent access on or off, read the connection's state, ask an installed agent its version or how it has the app registered (`claude mcp get`, `codex mcp get --json`: read only, the verdict alone reaches the page), ask Windows whether the user's Codex variable holds this profile's key (`codexEnv`; since 22 November, SIHIRBAZ-PLAN.md: it starts Windows' own PowerShell by its full path, in System32, with the app's environment minus every key variable (`agentEnv`), and a fixed command that reads the variable and the profile's `agent.json` and compares them inside PowerShell; `Same`, `Different` or `Missing` is all that comes back, never a value; neither value is on its command line or in a log), and get the lines the user runs (none holds the key). The end-to-end scenario `98-security-agent-key` checks every one of those answers and the clipboard for the key.
- **The microphone (voice-over, REF-AB, 21 November 2026).** It is the one permission the app grants (`src/main/voiceover.ts`, the rules in `voiceover-permission.ts`, every refusal unit-tested in `src/test/ref-s.test.ts`). A request is granted only when all of these hold: it is `media` for sound alone (no camera, no screen), from the top frame of an editor window showing the app's own page, and that page said "about to record" (`voiceover:arm`, sent by the Record button's press) less than 15 s earlier; the arm is used up by the grant. A code clip's frame, the clip drawing window, any other page, a second request without a new press: refused. The permission check answers yes only for that window's microphone once it was granted (so the page may read the microphones' names) or while it is armed; device permissions stay refused. What is left: a script running inside the editor page (none is known to run: no HTML or `eval` sink) could press Record for itself and listen while the microphone is open; Windows shows its microphone light for as long as it is. The take is written by the main process into the window's own project folder (`Voiceover\`, its real path checked to lie inside that folder) or, for a project never saved, into the profile; the page hands over only the bytes (checked to be a 16-bit mono PCM WAV, at most about 31 minutes), never a path. The e2e uses Chromium's fake audio device (`--use-fake-device-for-media-stream`, only on that test's command line) and not the fake permission UI, so the real handler is what is tested.
- **The agent token is not rotated by itself.** It is made once per profile and kept in `agent.json` (readable by the user's own programs). A token pasted into a chat or a screenshot stays valid until the user renews it (Settings → Agent connection → Renew key, asked twice: the server starts again with the new one, the old one gets 401) or deletes the profile's file. Claude Code keeps it in its own user settings (`claude mcp add --header`).
- **With Codex, the token is in the environment** of the terminal Codex is started from (`SNIPPSTUDIO_TOKEN`, `SNIPPSTUDIO_DEV_TOKEN` for the development copy; Codex's settings name only the variable: `codex mcp add --bearer-token-env-var`) and so of every command Codex runs. Since 21 November 2026 Settings also offers, on Windows, a line that keeps the variable **in the user's own environment for good** (`[Environment]::SetEnvironmentVariable(…, 'User')`). Run, it puts the key in the environment of every program the user starts afterwards, not only Codex and what Codex runs, and it stays there when the app is closed or removed. After "Renew key" that variable still holds the OLD key until the user runs the line again (Codex gets 401 until then): since 22 November the connection wizard's check compares the variable with this profile's key (above) and says "The key is old" with a button that copies the line again (until then it asked only whether the variable was set: audit A9c, K12a). The server also keeps, in memory, the time of the latest request refused for its key (401) or for a session it no longer knows (404), and each agent program's MCP client name with the time of its last active session; only these names and times reach the page (`agentLink:status`), never a key, a header or a session id. The line reads the key from the profile's file in the user's own terminal; it passes neither the page nor the clipboard.
- **With Antigravity (experimental), the token is in Antigravity's own config file** (`.agents/mcp_config.json` or `~/.gemini/config/mcp_config.json`) as plain text: its MCP headers take no environment variable. The app never writes that file and never puts the token on the clipboard or in the page; it copies a PowerShell command that reads the token from the profile's `agent.json` and prints the entry in the user's own terminal, and the user merges it in.
- **Sending from the app to the agent (21 November 2026, GONDER-PLAN.md).** The user's notes, a job typed in the command box and their answer on the draft card go to the agent's inbox, which the agent's `wait` call returns. The inbox lives in the editor page's memory; only the interface writes to it, on the user's press (a unit test checks that no agent tool and no main-process file sends to it), so an agent cannot queue work for itself. What is sent reaches the agent as data, the user's own request; the app runs nothing from it and gains no new bridge (no new IPC: a wait is an ordinary tool call, ended in the page when the agent cancels it or its connection closes). A misled agent could still read a typed job as an instruction: that is the user's own instruction, as in its chat.
- **A misled agent** can fill the draft with unwanted edits. The user sees the draft before anything changes; the agent's own shell and its permission system are the agent's.
- **The clip drawing window's frame has no `sandbox` attribute.** A clip there shares an origin with the app's small host page and can forge that page's messages to the editor; the editor clamps every value, so the effect is a broken or oversized clip, not an escape.
- **An unpackaged run (`electron .`)** has no DNS block for prefetch hints; the packaged app has.
- **Test hooks set in `App.tsx`** (`window.__autosaveNow`, `window.__exportShorts`) are still installed in every build; the others are not (item 3).
- **If the editor page were taken over (no way is known), three more things it could do** (final audit, 23 November 2026; layers of defence, not holes anyone can reach today): open any video or sound file of the disk with its own program, since the Renders panel's status file it writes names the output (`renders:write`, then `renders:open`); make any project file of the recents list "the window's project" (`project:set-current`), so a code clip folder inside that project's folder would run without the question; read any media-type file by naming it in a recovery snapshot it wrote (`recovery:write`, then `recovery:read`), as opening a project file it saved can. Not changed: each needs a script in the editor page first, and the repair (the main process keeping these paths itself) is a piece of work of its own. A YouTube text beside a chosen video (`<name>.youtube.txt`) is also written over without a question, by design of that button.
- **Keyframe values and transform numbers** in a project file are not held to limits yet (item 9 holds sizes, rates, times and speeds).
- **Trusted folders are per profile, and "inside the project folder" is trusted.** A project folder that brings its own clips with it runs them without a question; that is the intended unit (a clip reads only its own folder). The question is asked for a folder outside it.
- **Electron 43 leaves support in January 2027.** A move to a newer major line is a separate job.
- **Not tried:** the installer and the install folder's permissions, Windows firewall rules, macOS and Linux (the path and launch rules have branches for them, tested on Windows only), a real browser against the agent server (its headers were imitated), real Codex and OpenCode installs (their npm shim pattern was reproduced).

## Reporting a vulnerability

See [`SECURITY.md`](SECURITY.md).
