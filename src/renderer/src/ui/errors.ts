// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The engine's and the main process's English messages, in the interface's
// language (SnippStudio phase 9b, decision 1; FAZ9-PLAN.md "9b").
//
// The messages stay English where they are made: the main process and the
// workers have no t(), and the agent reads many of the same messages (its
// tool answers are English on purpose). They are put into words where they
// are SHOWN: the toast stack, the export window, the exports list, the sound
// effects line, the projects window. Each rule is one English sentence or
// clause (a regular expression; its groups become the key's parameters);
// a message is translated clause by clause, so a message made of several
// (the export's "not exported. … , then export again.") needs no rule of its
// own. English shows the message as it is. src/test/faz9b-errors.test.ts
// checks that every fixed message of the files the person sees is covered.
import { getLang, t, type Params, type StringKey } from './strings'

interface Rule {
  re: RegExp
  key: StringKey
  /** The groups' parameter names, in order (a group not named is not a parameter). */
  names?: string[]
  /** For counts written as words ("A file" / "3 files"); m[0] is the match, m[1] its first group. */
  params?: (m: string[]) => Params
}

/** A file or folder name inside a message: no colon, no quote, no line break. */
const N = '([^:"\\n]+?)'
const count = (one: string | undefined, n: string | undefined): string => (n ? n : one ? '1' : '1')

const RULES: Rule[] = [
  // ---- projects (main process: project-ipc, recents-ipc, index) --------------
  { re: /This project is already open in another (.+?) window\./, key: 'err.projectOpenElsewhere', names: ['app'] },
  { re: /Project is open in another (.+?) window\./, key: 'err.projectOpenElsewhere', names: ['app'] },
  { re: /Could not read project file\./, key: 'err.projectUnreadable' },
  { re: /Project file is not valid JSON\./, key: 'err.projectNotJson' },
  { re: /Network paths are disabled in offline mode\./, key: 'err.networkPath' },
  { re: /Only local drive paths are supported in offline mode/, key: 'err.localOnly' },

  // ---- writing a file (main process: file-ipc, safe-write, project-ipc) -----
  { re: new RegExp(`The film is finished, but ${N} could not be replaced \\(it is open in another program\\?\\)\\. The finished film is saved as (.+?)\\. Close the other program and rename it, or export again\\.`), key: 'err.filmNotReplaced', names: ['name', 'part'] },
  { re: new RegExp(`${N} is open in another program \\(a video player\\?\\)\\. Close it there, then export again\\.`), key: 'err.openElsewhereExport', names: ['name'] },
  { re: new RegExp(`${N} could not be replaced \\(it is open in another program\\?\\)\\. Close it there, then export again\\.`), key: 'err.notReplaced', names: ['name'] },
  { re: new RegExp(`The file is written, but ${N} could not be put in place\\. It is saved as (.+?): rename it, or export again\\.`), key: 'err.writtenNotPlaced', names: ['name', 'part'] },
  { re: new RegExp(`(\\S+) could not put ${N} back after checking it; it is now ${N}\\.`), key: 'err.putBack', names: ['app', 'name', 'probe'] },
  { re: /Unsupported output path or file type|Unsupported output file type|Unsupported output path/, key: 'err.badOutput' },
  { re: /Unsupported media type/, key: 'err.badMediaType' },
  { re: /ENOSPC: no space left on device(?:, \w+)?/, key: 'err.diskFull' },
  { re: /\bno folder chosen\b/, key: 'err.noFolderChosen' },
  { re: /\bsource missing\b/, key: 'err.sourceMissing' },
  { re: /\bcould not write the cleaned file\b/, key: 'err.cleanedNotWritten' },
  { re: /\bcould not write file\b/, key: 'err.notWritten' },
  { re: /^not saved$/, key: 'err.notSaved' },

  // ---- code films and code templates (main process) -------------------------
  { re: /\bsave the project first\b/, key: 'err.saveFirst' },
  { re: /^unknown template$/, key: 'err.unknownTemplate' },
  { re: /template (\S+) has no index\.html/, key: 'err.templateNoIndex', names: ['id'] },
  { re: /the folder is a link that leads outside the project folder: nothing was written/, key: 'err.outsideProject' },
  { re: /\bno free folder name\b/, key: 'err.noFolderName' },
  { re: /^(?:there is )?nothing to keep$/, key: 'err.nothingToKeep' },
  { re: /there is no earlier version/, key: 'err.noEarlierVersion' },
  { re: /the version could not be read/, key: 'err.versionUnreadable' },
  { re: /there is nothing to write/, key: 'err.nothingToWrite' },
  { re: /none of the changes has a place in the files any more/, key: 'err.noPlaceLeft' },
  { re: /a file changed while its values were being written: nothing more was written/, key: 'err.valuesFileChanged' },
  { re: /the files as they are now are over the 2 MB a version keeps: /, key: 'err.overVersionLimit' },
  { re: /\bnothing was put back\b/, key: 'err.nothingPutBack' },
  { re: /\bnothing was written\b/, key: 'err.nothingWritten' },
  { re: /name: letters, digits, - and _ \(at most 64\)/, key: 'err.animName' },
  { re: /name: a name Windows keeps for devices/, key: 'err.animNameDevice' },
  { re: /not a code clip folder whose versions are kept/, key: 'err.noVersionsFolder' },
  { re: /not a code clip folder/, key: 'err.notCodeClip' },
  { re: /The app could not run its clock in this page\./, key: 'err.clockFailed' },
  { re: /The film page did not finish loading in 2 minutes\./, key: 'err.filmLoadSlow' },
  { re: /The film page was not ready in 2 minutes \(window\.READY never became true\)\./, key: 'err.filmNotReady' },
  { re: /The film's WebGL context was lost\./, key: 'err.webglLost' },
  { re: /The film page shows nothing: it has no canvas with a picture\./, key: 'err.filmBlank' },
  { re: /The picture of the page did not arrive\./, key: 'err.pagePicture' },
  { re: /The film page could not be opened: /, key: 'err.filmOpen' },
  { re: / The page said: /, key: 'err.pageSaid' },
  { re: /\bcould not load: /, key: 'err.couldNotLoad' },
  { re: new RegExp(`The code film "${N}" cannot be opened \\(its folder is missing\\)\\.`), key: 'err.filmFolderMissing', names: ['name'] },
  { re: new RegExp(`The code film "${N}" could not draw ([\\d.]+) s: `), key: 'err.filmDraw', names: ['name', 't'] },
  { re: new RegExp(`The code film "${N}" can't be found \\(its folder was moved or deleted\\) — relink it or take it off the timeline`), key: 'err.filmGone', names: ['name'] },
  { re: new RegExp(`The code film "${N}" did not start: `), key: 'err.filmStart', names: ['name'] },
  { re: new RegExp(`The code film "${N}" was closed\\.`), key: 'err.filmClosed', names: ['name'] },
  { re: new RegExp(`The code film "${N}" did not draw ([\\d.]+) s within a minute\\.`), key: 'err.filmDrawSlow', names: ['name', 't'] },
  { re: /The film page sent a frame of the wrong size\./, key: 'err.filmFrameSize' },
  { re: /An export is running; check the clip after it\./, key: 'err.exportRunningCheck' },
  { re: /Its code kept changing while it was checked: check it again once it is written\./, key: 'err.codeChanging' },

  // ---- the export (renderer: exporter, encoder, file-target, render workers)
  { re: /The MP3 encoder could not be started \((.+?)\)\. M4A or WAV still work\./, key: 'err.mp3', names: ['why'] },
  { re: /Export produced no data\./, key: 'err.noData' },
  { re: /The timeline is empty — add some clips first\./, key: 'err.timelineEmpty' },
  { re: /The selected range is empty\./, key: 'err.rangeEmpty' },
  { re: /This computer's video encoder does not take (H\.264|VP9) at (\d+) × (\d+), ([\d.]+) fps, ([\d.]+) Mbps \(neither its hardware nor its software encoder\)/, key: 'err.encoderRefuses', names: ['codec', 'w', 'h', 'fps', 'mbps'] },
  { re: /: choose another size, frame rate or quality\./, key: 'err.chooseOther' },
  { re: /this computer's hardware encoder does not take (H\.264|VP9) at (\d+) × (\d+), ([\d.]+) fps; the software encoder made it \(slower, the same picture\)/, key: 'err.softwareMade', names: ['codec', 'w', 'h', 'fps'] },
  { re: /the render processes did not start in time/, key: 'err.lanesLate' },
  { re: /Short (\d+) of (\d+) \((.+?)\): /, key: 'err.p.short', names: ['i', 'n', 'name'] },
  {
    re: /(A file|(\d+) files) used in the video can't be found: (.+?)\. (?:It was|They were) moved, renamed or deleted since the project was opened — relink (?:it|them) in the Media panel \(or take (?:it|them) off the timeline\)/,
    key: 'err.filesMissing',
    params: (m) => ({ n: count(m[1], m[2]), names: m[3] })
  },
  {
    re: /(A file|(\d+) files) can't be read \(damaged, or a format (\S+) doesn't open\): (.+?) — replace (?:it|them)/,
    key: 'err.filesUnreadable',
    params: (m) => ({ n: count(m[1], m[2]), app: m[3], names: m[4] })
  },
  {
    re: /(A picture|(\d+) pictures) did not load in time, so the video was not exported: (.+?)\. Check that (?:the file is|the files are) still there and can be opened, then export again\./,
    key: 'err.picturesLate',
    params: (m) => ({ n: count(m[1], m[2]), names: m[3] })
  },
  { re: /(a picture|(\d+) pictures) could not be read and (?:is|are) missing from the video: /, key: 'err.picturesBroken', params: (m) => ({ n: count(m[1], m[2]) }) },
  {
    re: new RegExp(`a frame of "${N}" could not be read \\((.+?)\\), so that (reversed|freeze-frame) clip is missing from ([\\d.]+) s`),
    key: 'err.frameUnread',
    params: (m) => ({ name: m[1], why: m[2], kind: t(m[3] === 'reversed' ? 'err.frameUnread.reversed' : 'err.frameUnread.freeze'), t: m[4] })
  },
  { re: /Loading the pictures: (\d+) left/, key: 'err.loadingPictures', names: ['n'] },
  { re: /The video was not exported\. /, key: 'err.notExported' },
  { re: /, then export again\./, key: 'err.thenExportAgain' },
  { re: / and (\d+) more\b/, key: 'err.andMore', names: ['n'] },
  { re: /Export cancelled/, key: 'err.exportCancelled' },
  { re: /\bthe export was stopped\b/, key: 'err.exportCancelled' },
  { re: /Could not create a drawing context\./, key: 'err.drawContext' },
  { re: /This window cannot write a file as it exports\./, key: 'err.windowCannotStream' },
  { re: /This window cannot write the file\./, key: 'err.windowCannotWrite' },
  { re: /the stretch could not be handed over \((.+?)\)/, key: 'err.stretchHandover', names: ['why'] },
  { re: /the render window stopped \((.+?)\)/, key: 'err.renderWindowStopped', names: ['why'] },
  { re: /the stretch's file could not be made \((.+?)\)/, key: 'err.stretchFile', names: ['why'] },
  { re: /\[hardware encoder\] /, key: 'err.hardwareEncoder' },

  // ---- media (renderer: import, proxy, LUT, sound effects; mediabunny) ------
  { re: /Input has an unsupported or unrecognizable format\./, key: 'err.unrecognizedFormat' },
  { re: /The file is empty\./, key: 'err.emptyFile' },
  { re: /: unsupported or unreadable file\b/, key: 'err.unreadableFile' },
  { re: /: no media in that folder\b/, key: 'err.noMediaInFolder' },
  { re: /: unsupported file type\b/, key: 'err.unsupportedFileType' },
  { re: /Could not read this audio file\./, key: 'err.audioUnreadable' },
  { re: /Could not load image/, key: 'err.imageUnreadable' },
  { re: /The sample clip produced no data\./, key: 'err.sampleNoData' },
  { re: /The sample clip could not be written\./, key: 'err.sampleNotWritten' },
  { re: /No video track found\./, key: 'err.noVideoTrack' },
  { re: /Proxy encode produced no data\./, key: 'err.proxyNoData' },
  { re: /1D LUTs are not supported — use a 3D \.cube/, key: 'err.lut1d' },
  { re: /Not a valid 3D \.cube LUT/, key: 'err.lutInvalid' },

  // ---- progress lines (the export window, the transcription line) ---------
  { re: /Loading the pictures and fonts/, key: 'err.p.picturesFonts' },
  { re: /Drawing it again in this window alone/, key: 'err.p.drawAgain' },
  { re: /Saving the three files/, key: 'err.p.saveThree' },
  { re: /Saving the SRT file/, key: 'err.p.saveSrt' },
  { re: /Saving the file/, key: 'err.p.saveFile' },
  { re: /Writing the subtitles/, key: 'err.p.writeSubs' },
  { re: /Getting the MP3 encoder ready/, key: 'err.p.mp3Ready' },
  { re: /Writing the (\w+) file/, key: 'err.p.writeFile', names: ['ext'] },
  { re: /Starting the code films/, key: 'err.p.startFilms' },
  { re: /Checking the media files/, key: 'err.p.checkMedia' },
  { re: /Drawing frame (\d+) of (\d+) \((\d+) at once\)/, key: 'err.p.frameLanes', names: ['i', 'n', 'lanes'] },
  { re: /Drawing frame (\d+) of (\d+)/, key: 'err.p.frame', names: ['i', 'n'] },
  { re: /Encoding the sound/, key: 'err.p.encodeSound' },
  { re: /Joining the video: (\d+) of (\d+)/, key: 'err.p.join', names: ['k', 'n'] },
  { re: /^Starting…$/, key: 'err.p.starting' },
  { re: /Loading local model… (\d+)%/, key: 'err.p.loadingLocal', names: ['pct'] },
  { re: /Loading model…/, key: 'err.p.loadingModel' },
  { re: /Loading Whisper (.+?) \((WebGPU|CPU)\)…/, key: 'err.p.loadingWhisper', names: ['model', 'where'] },
  { re: /Warming up Whisper \(first run, (.+?)\)…/, key: 'err.p.warming', names: ['where'] },
  { re: /Transcribing… part (\d+) of (\d+)/, key: 'err.p.transcribePart', names: ['k', 'n'] },
  { re: /Transcribing \((.+?)\)…/, key: 'err.p.transcribingOn', names: ['where'] },
  { re: /Transcribing…/, key: 'err.p.transcribing' },
  { re: /Finishing…/, key: 'err.p.finishing' },
  { re: /Extracting timeline audio…/, key: 'err.p.extractTimeline' },
  { re: /Extracting audio for the marked range…/, key: 'err.p.extractRange' },
  { re: /Transcription failed — trying again on the CPU with fewer threads…/, key: 'err.p.retryFewer' },
  { re: /Still failing — trying again with one CPU thread \(slow, but light\)…/, key: 'err.p.retryOne' },
  { re: /\bCPU model\b/, key: 'err.p.cpuModel' },

  // ---- transcription (renderer: transcribe, the speech worker) --------------
  { re: /A transcription is already running\./, key: 'err.transcribeRunning' },
  { re: /The timeline has no audible audio to transcribe\./, key: 'err.noAudioTimeline' },
  { re: /The marked range has no audible audio\./, key: 'err.noAudioRange' },
  { re: /Transcription failed even on one CPU thread: /, key: 'err.failedOneThread' },
  { re: /Transcription cancelled\./, key: 'err.transcribeCancelled' },
  { re: /Could not read the model file (\S+) from disk\./, key: 'err.modelFileUnread', names: ['file'] },
  { re: /The speech model changed during transcription\. Please retry\./, key: 'err.modelChanged' },
  { re: /Multilingual Whisper Medium is not installed in resources\/models\. Reinstall the complete model build\./, key: 'err.modelMissing' },
  { re: /The English Whisper model is not installed in resources\/models\./, key: 'err.modelMissing' },
  { re: /Whisper (.+?) is incomplete in resources\/models \(missing [^)]*\)\./, key: 'err.modelIncomplete', names: ['model'] },
  { re: /Transcription needs WebGPU, which this machine\/driver does not expose\. Update the graphics driver \(or run on the discrete GPU\) and try again\./, key: 'err.noWebGpu' },
  { re: /The speech model failed to load on the (GPU|CPU): /, key: 'err.modelLoadFailed', names: ['where'] },
  { re: /Speech model not found\. Everything else works — only Auto captions needs it\. .*$/, key: 'err.modelNotFound' },
  { re: /The local multilingual model returned unusable word and phrase timing\. No subtitles were added; try a shorter audio selection\./, key: 'err.badTiming' }
]

/** Every rule's key (for the test: each one has its words). */
export const ERROR_KEYS: readonly StringKey[] = [...new Set(RULES.map((r) => r.key))]

/** A message in the interface's language: each known English clause put into
 *  words; what no rule knows (a file name, a library's own words) stays. */
export function localizeMessage(text: string): string {
  if (getLang() === 'en' || !text) return text
  let out = text
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g')
    out = out.replace(re, (...args: unknown[]) => {
      const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : undefined)) as string[]
      const params: Params = rule.params ? rule.params([String(args[0]), ...groups]) : {}
      if (!rule.params) rule.names?.forEach((n, i) => { if (groups[i] !== undefined) params[n] = groups[i] })
      return t(rule.key, params)
    })
  }
  return out
}

/** An error, thrown or returned, as the words a toast shows. */
export function errorText(err: unknown): string {
  return localizeMessage(err instanceof Error ? err.message : String(err))
}
