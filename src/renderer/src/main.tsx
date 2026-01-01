// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary, snapshotForRecovery } from './components/ErrorBoundary'
import { isBenignWindowError, rateGate } from './ui/crash-guard'
import { loadBundledFonts } from './fonts'
import { loadLuts } from './luts'
import { useStore } from './state/store'
import { BRANCH, CHANNEL, windowTitle } from './channel'
// The design values first (one definition: ui/tokens.css), then the page and
// its elements, the type faces and the focus ring (ui/base.css), then the
// panel language and each area's own sheet. (styles.css went in phase 3c.4b.)
import './ui/tokens.css'
import './ui/base.css'
import './ui/panel.css'
import './notes/notes.css'
import './ui/kit.css'
import './components/shell.css'
import './components/dock.css'
import './components/panels.css'
import './components/preview/preview.css'
import './components/timeline/timeline.css'
import './components/inspector/inspector.css'
import './components/agent/agent.css'
import './components/windows.css'
import './components/home.css'
import './components/outputs.css'
import './components/toolbar.css'
import './components/cila-s.css'
import './components/codevalues/codevalues.css'
import { api } from './platform'
import { getLang, subscribeLang } from './ui/strings'
import { loggingCheck, setModelCheck } from './model/check-hook'
import { setFreezeResults } from './state/cow'
import { tellInheritedProfile } from './profile-notice'
import { mountTrustFolderAsk } from './components/security/TrustFolderAsk'
import { mountCodeValues } from './components/codevalues/CodeValuesPanel'
import { installMotion } from './ui/motion'

// Whether the interface's own motion runs (Settings → General → Animations):
// the class on <html>, before the first paint.
installMotion()

void loadBundledFonts()
void loadLuts()

// A dev copy's window says which copy and branch it is (channel.ts); a
// release keeps the plain title.
document.title = windowTitle(CHANNEL, BRANCH)

// The main process's dialogs speak the page's language (phase 9b): told now
// and whenever the person changes it (File → Language).
api?.setUiLang?.(getLang())
subscribeLang(() => api?.setUiLang?.(getLang()))

// The timeline's tempo strip is gone (2026-10-09): its settings go with it.
try {
  localStorage.removeItem('snipp-tempo')
  localStorage.removeItem('snipp-tempo-limit')
} catch {
  /* storage blocked: nothing to clear */
}

// Hooks for driving the editor from automated tests: in a source build and in
// a packaged copy under the e2e gate only. The packaged product installs none
// (security patch, item 3, B-G4: ready-made export, film and project
// functions for whoever reached the page). The main process says which copy
// this is (preload: api.testHooks).
if (api?.testHooks === true) {
  const w = window as unknown as Record<string, unknown>
  w.__store = useStore
  // The timeline's view (lane height, zoom): its height lives in Settings now
  // (DENEME-3), so a test sets it here rather than with a toolbar button.
  void import('./components/timeline/view-state').then((m) => (w.__timelineView = m.useTimelineView))
  void import('./playback/engine').then((m) => (w.__engine = m.engine))
  // Frame/MP4 rendering without the save dialog, so a test can check what an
  // export actually draws (the preview is not proof of that).
  w.__exporter = () => import('./export/exporter')
  // A candidate project for the preview (playback/candidate.ts): set, show
  // ('live' / 'candidate'), clear, state. And the commands, to make one.
  void import('./playback/candidate').then((m) => (w.__candidate = m.candidate))
  w.__commands = () => import('./commands')
  // Code films (CODE-FILM-CLIP-PLAN.md): their pages, and the import a film
  // tool uses (api.codeFilm.register a folder, then codeFilmImport it).
  w.__codeFilm = () => Promise.all([import('./media/codefilm'), import('./media/import'), import('./playback/render')])
  // The frame renderer, to time and probe it directly.
  w.__render = () => import('./playback/render')
  // The decoders' frame sources, so a timing (npm run perf) can hand
  // renderFrame its frames ready and time the drawing alone.
  w.__sources = () => import('./media/sources')
  w.__media = () => Promise.all([import('./media/import'), import('./subtitles/srt')])
  // Transcription and its timing, to check subtitles against a known voice.
  w.__subs = () => Promise.all([import('./subtitles/transcribe'), import('./subtitles/timing'), import('./export/audio')])
  // The export window's job runner, to drive an export (and its Cancel)
  // without the save dialog.
  w.__exportJob = () => Promise.all([import('./export/run-job'), import('./export/job')])
  // The export's sound window by window (phase Ç3b), to compare windows.
  w.__audioStream = () => import('./export/audio-stream')
  // The project model's helpers (flattenClips: a compound clip's children).
  w.__types = () => import('./types')
}

/**
 * The editor window only: an error nothing caught (an event handler, a timer,
 * a promise nobody awaited) is logged, and while there is unsaved work a
 * recovery snapshot is written, at most once a minute. A render error inside a
 * panel is the error boundaries' (components/ErrorBoundary.tsx).
 */
function watchUncaughtErrors(): void {
  const gate = rateGate(60_000)
  const caught = (kind: string, err: unknown): void => {
    console.error(`[snipp] ${kind}:`, err)
    if (!useStore.getState().dirty) return
    snapshotForRecovery(kind, gate)
  }
  window.addEventListener('error', (e) => {
    if (isBenignWindowError(e.message ?? '')) return
    caught('uncaught error', e.error ?? e.message)
  })
  window.addEventListener('unhandledrejection', (e) => caught('unhandled promise rejection', e.reason))
}

// A render process's hidden window (the parallel export: main/render-workers.ts,
// export/render-worker.ts): the same page, no editor in it.
if (location.hash === '#render-worker') void import('./export/render-worker').then((m) => m.startRenderWorker())
else if (location.hash === '#ui-kit') void openBuildingBlocks()
else startEditor()

/** The model check after every edit (model/check.ts, phase Ç2a.1): in a
 *  development build, and in an e2e window (a source build started with
 *  --e2e and its own profile); never in the packaged app. What it finds is
 *  logged and kept in `window.__modelProblems`. */
function installModelCheck(): void {
  const install = (): void => {
    // (And the projects an edit makes are frozen: the undo history keeps
    // them by reference, state/history.ts.)
    setFreezeResults(true)
    const found: unknown[] = []
    ;(window as unknown as Record<string, unknown>).__modelProblems = found
    setModelCheck(loggingCheck((problems, what) => void found.push({ what, problems })))
  }
  if (import.meta.env.DEV) return install()
  void Promise.resolve(api?.testE2e?.())
    .catch(() => false)
    .then((on) => {
      if (on === true) install()
    })
}

function startEditor(): void {
  watchUncaughtErrors()
  installModelCheck()
  // An agent's tool calls for this window's project (agent/host.ts). Nothing
  // arrives unless the user turned agent access on.
  void import('./agent/host').then((m) => m.startAgentHost())
  // Settings copied from the older app on this first start: one notice.
  tellInheritedProfile()
  // "Run the code in this folder?" for a code clip's folder the app does not
  // trust yet (security patch, item 6).
  mountTrustFolderAsk()
  // Cila K: the "code values" side panel (its own small root, opened from the
  // Inspector's code clip part).
  mountCodeValues()
  // The whole editor inside one boundary (and each big panel inside its own,
  // App.tsx): an exception while rendering no longer blanks the window.
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary name="editor" variant="app">
      <App />
    </ErrorBoundary>
  )
}

/** The building blocks page (ui/kit/KitPage.tsx, SnippStudio phase 3a): only
 *  in a build that is not packaged (the main process answers test:ui-kit only
 *  then); anywhere else the address opens the editor. */
async function openBuildingBlocks(): Promise<void> {
  const allowed = await Promise.resolve(api?.testUiKit?.()).catch(() => false)
  if (allowed !== true) return startEditor()
  const [{ KitPage }] = await Promise.all([import('./ui/kit/KitPage'), import('./ui/kit/kit-page.css')])
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary name="editor" variant="app">
      <KitPage />
    </ErrorBoundary>
  )
}
