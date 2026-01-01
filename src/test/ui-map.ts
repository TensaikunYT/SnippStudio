// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Round 10 (the interface, redesigned): every place of the old interface
// and where it is now. `src/test/ui-reach.test.ts` checks each `find` text
// is in its `file` (paths under src/renderer/src), so a later change that
// drops one of them fails a test instead of losing a feature quietly.

export interface UiMove {
  /** What it does. */
  action: string
  /** Where it was before round 10. */
  old: string
  /** Where it is now. */
  now: string
  /** The file that holds it now, and a text that only it has there. */
  file: string
  find: string
}

const TOP = 'components/TopBar.tsx'
const INS = 'components/Inspector.tsx'
/** The Project tab's parts (split out of Inspector.tsx in SnippStudio phase 2B). */
const INS_PROJECT = 'components/inspector/project-tab.tsx'
const DOCK = 'components/WorkspaceDock.tsx'
const PTB = 'components/PreviewToolbar.tsx'
const TRB = 'components/TransportBar.tsx'
/** A track's header and a clip on the timeline (split out of Timeline.tsx in SnippStudio phase 2B). */
const TL_HEADER = 'components/timeline/track-header.tsx'

export const UI_MOVES: UiMove[] = [
  // The top bar.
  { action: 'Recent projects', old: '☰ Project → ▦ Projects', now: '☰ File → Projects…', file: TOP, find: "t('top.file.projects')" },
  { action: 'New project 16:9', old: '☰ Project → New ▾ → 16:9', now: '☰ File → New project → 16:9 Landscape', file: TOP, find: "t('top.file.new169')" },
  { action: 'New project 9:16', old: '☰ Project → New ▾ → 9:16', now: '☰ File → New project → 9:16 Vertical / Shorts', file: TOP, find: "t('top.file.new916')" },
  { action: 'New project 1:1', old: '☰ Project → New ▾ → 1:1', now: '☰ File → New project → 1:1 Square', file: TOP, find: "t('top.file.new11')" },
  { action: 'Open a project', old: '☰ Project → ↗ Open project', now: '☰ File → Open…', file: TOP, find: "t('top.file.open')" },
  { action: 'New window', old: '☰ Project → ＋ New window', now: '☰ File → New window', file: TOP, find: "t('top.file.newWindow')" },
  { action: 'Undo several steps', old: '☰ Project → ↩ History', now: '▾ beside Undo, under the preview', file: TRB, find: "t('transport.history'" },
  { action: 'Keyboard shortcuts', old: '☰ Project → ⌨ Shortcuts', now: '☰ File → Keyboard shortcuts', file: TOP, find: "t('top.file.shortcuts')" },
  { action: 'Automation', old: 'Top bar → ✨ Automation', now: 'Media → select pictures → Fit to voice (cila O)', file: 'components/MediaBin.tsx', find: "t('fit.open.count'" },
  { action: 'Save (asks where)', old: 'Top bar → ⌑ Save', now: '☰ File → Save as…', file: TOP, find: "t('top.file.saveAs')" },
  { action: 'Save to its file', old: 'Ctrl+S only', now: '☰ File → Save (Ctrl+S), or click the project name', file: TOP, find: "label: t('top.file.save'), shortcut: 'ctrl+s'" },
  { action: 'Saved or not', old: 'Top bar: the project name (text)', now: 'Top bar: the project name, ● unsaved / ✓ saved (a button that saves)', file: TOP, find: 'tb-name-dot' },
  { action: 'Change the canvas and background', old: 'Top bar → Canvas ▾', now: 'Top bar → Canvas ▾ (unchanged)', file: TOP, find: "t('top.canvas.title')" },
  { action: 'Export subtitles (.srt)', old: 'Top bar → ⬇ SRT', now: '☰ File → Subtitles (.srt)… and Export ▾ → Subtitles', file: TOP, find: "t('top.export.srt')" },
  { action: 'Export the video or sound', old: 'Top bar → ⬇ Export MP4', now: 'Top bar → ⬇ Export (and ☰ File / Export ▾ → Video or sound…)', file: TOP, find: "t('top.export')" },
  { action: 'Save this frame as a PNG', old: 'Under the preview → 📸', now: 'Under the preview → 📸 (unchanged), and ☰ File / Export ▾ → This frame (PNG)…', file: TOP, find: "t('top.export.frame')" },
  { action: 'Archive the project', old: 'Right panel → Project → Archive', now: 'Right panel → Project → ⚙ Settings → Archive, and ☰ File → Archive project…', file: TOP, find: "focusInspector('archive')" },
  { action: 'Transcription progress and Cancel', old: 'Top bar (while transcribing)', now: 'Top bar (unchanged)', file: TOP, find: "t('top.transcribe.stop')" },
  { action: 'Long or short help texts', old: '(every help text in full)', now: '☰ File → Long explanations (off: one line each, hover or click for the rest)', file: TOP, find: "t('top.file.longText')" },
  // The right panel.
  { action: 'The selected clip', old: 'Right panel → Clip', now: 'Right panel → Clip', file: INS, find: "{ value: 'clip', label: t('insp.tab.clip')" },
  { action: 'Music ducking under the voice', old: 'Right panel → Audio', now: 'Right panel → Project → 🔊 Sound', file: INS_PROJECT, find: "part === 'sound' && <AudioTab />" },
  { action: 'Colour and camera look', old: 'Right panel → Look', now: 'Right panel → Look', file: INS, find: "{ value: 'fx', label: t('insp.tab.look')" },
  { action: 'Subtitles and texts', old: 'Right panel → Subs', now: 'Right panel → Subs', file: INS, find: "{ value: 'subs', label: t('insp.tab.subs')" },
  { action: 'The transcript', old: 'Right panel → Script', now: 'Right panel → Project → ≡ Script', file: INS_PROJECT, find: "part === 'script' && <TranscriptPanel />" },
  { action: 'A template block (G lane)', old: 'Right panel → Tmpl (with templates)', now: 'Right panel → Template (with templates)', file: INS, find: "{ value: 'tmpl' as Tab, label: t('insp.tab.tmpl')" },
  { action: 'Background, size, frame rate, snapping, render queue, chapters, archive', old: 'Right panel → Project', now: 'Right panel → Project → ⚙ Settings', file: INS_PROJECT, find: "part === 'settings' && <ProjectTab />" },
  // The left dock.
  { action: 'Imported media', old: 'Left dock → Media', now: 'Left panel → Media', file: DOCK, find: "['media', 'image', 'dock.cat.media'" },
  { action: 'Sound effects library', old: 'Left dock → SFX', now: 'Left panel → Audio', file: DOCK, find: "['sounds', 'eighth-notes', 'dock.cat.audio'" },
  { action: 'Effects for many clips', old: 'Left dock → Effects', now: 'Left panel → Effects (motion)', file: DOCK, find: "['effects', 'sparkles', 'dock.cat.effects'" },
  { action: 'Transitions for many cuts', old: 'Left dock → Effects → Cuts', now: 'Left panel → Transitions', file: DOCK, find: "['transitions', 'blend', 'dock.cat.transitions'" },
  { action: 'Templates', old: 'Left dock → Templates', now: 'Left panel → Text', file: DOCK, find: "['templates', 'type', 'dock.cat.text'" },
  { action: 'Add a shape or a highlight', old: 'Left panel → Effects → Shapes', now: 'Left panel → Text → Shapes and highlights (YAZI-PANELI-PLAN.md §5)', file: 'components/TextPage.tsx', find: '<ShapesTab show=' },
  { action: 'Code films and code templates', old: 'Left dock → Media → <> / Templates', now: 'Left panel → Code', file: DOCK, find: "['code', 'code', 'dock.cat.code'" },
  // Over and under the preview.
  { action: 'Cut silence', old: 'Preview toolbar → ✂ Cut silence', now: 'Preview toolbar → ✂ Cut silence (the icon alone when narrow)', file: PTB, find: "label={t('preview.silence')}" },
  { action: 'Add a text', old: 'Preview toolbar → ＋ Text', now: 'Left panel → Text → Add text (DENEME-3, item 4: no longer over the preview)', file: 'components/TextPage.tsx', find: 'testid="dock.text.add"' },
  { action: 'Shorts mode, trackers, guides', old: 'Preview toolbar → ⋯ More', now: 'Preview toolbar → ⋯ More', file: PTB, find: "label={t('preview.shorts')}" },
  { action: 'Preview zoom and fit', old: 'Preview toolbar → − % ＋ Fit', now: 'Preview toolbar → − % ＋ Fit', file: PTB, find: "label={t('preview.fit')}" },
  { action: 'Preview quality', old: 'Preview toolbar → quality', now: 'Preview toolbar → quality', file: PTB, find: "label={t('preview.quality')}" },
  { action: 'Undo and redo', old: 'Under the preview → ↶ ↷', now: 'Under the preview → ↶ ▾ ↷', file: TRB, find: "label={t('transport.redo')}" },
  { action: 'Play, go to start, the clock', old: 'Under the preview', now: 'Under the preview (unchanged)', file: TRB, find: "label={t('transport.start')}" },
  // The timeline.
  { action: 'Select, Split, Snap, Keyframe', old: 'Timeline toolbar', now: 'Timeline toolbar (icons alone when narrow)', file: 'components/timeline/toolbar.tsx', find: '<span className="tb-label">{t(\'timeline.tool.keyframe.short\')}</span>' },
  { action: 'Split tool, Slip, Cutter, Compound, Follow, Link, Adjustment, Ripple delete, Group, +V +A', old: 'Timeline toolbar → ⋯ Tools', now: 'Timeline toolbar → ⋯ Tools', file: 'components/CustomToolbar.tsx', find: "t('toolbar.more.title')" },
  { action: 'Timeline zoom', old: 'Timeline toolbar → Zoom', now: 'Timeline toolbar → Zoom (the number box stays when the slider folds away)', file: 'components/timeline/view-controls.tsx', find: 'trackTestid="timeline.zoom"' },
  { action: 'Track show, mute, solo, pack, more', old: 'Track headers', now: 'Track headers (unchanged)', file: TL_HEADER, find: 'track-more-btn' },
  { action: 'Trim a clip', old: 'Clip edges', now: 'Clip edges, with where the edge is and the new length shown beside the edge while dragging', file: 'components/timeline/overlays.tsx', find: 'tl-trim-tip' }
]
