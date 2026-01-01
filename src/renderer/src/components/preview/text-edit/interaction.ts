// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title or a shape under the pointer in the preview (SnippStudio
// YAZI2-PLAN.md, 2.2–2.5): what a press starts, what the pointer shows, what a
// drag writes, what the arrow keys move, and what is drawn over the picture.
// The thin layer between the store and the pure parts beside it (hit.ts,
// handles.ts, guides.ts, layout.ts, inline.ts); PreviewCanvas.tsx only calls
// in here. Every edit goes through the store's own actions (one gesture, one
// undo step: the caller arms and ends it).
import { useStore, type EditorState } from '../../../state/store'
import { captionMotionAt } from '../../../playback/render'
import { captionsByLayer } from '../../../playback/draw/captions'
import type { Caption, Project } from '../../../types'
import { HANDLE_ACCENT, drawAngleTag, drawTag, resizeBox, turnCursor, turnFrom, type Pt } from '../../../ui/handles'
import { fmtPct } from '../../../ui/format'
import { captionAngle, manualCaptionBox, screenToWorld, worldToScreen, type ViewXform } from '../geometry'
import type { DragState } from '../drag-state'
import { SAFE_INSETS } from '../pv-ui'
import { drawGuides, drawHoverOutline, drawSelection, drawTyping } from './draw'
import { boxTargets, frameTargets, snapMove, type GuideLine } from './guides'
import { HANDLE_DIR, boundsOf, boxKnob, boxLocal, boxPoint, handleCursor, insideBox, middleAfterWidth, sizeByHandle, snapTurn, widthByHandle, type HandleId, type TurnedBox } from './handles'
import { BODY_SLACK, hitTest, outlineOf, type ScreenItem } from './hit'
import { caretTo, selectWord } from './inline'
import { WRAP_MIN, caretAt, indexAt, selectionRects, wrapForWidth, wrapWidths } from './layout'
import { captionLayout, captionSpec, draftProject, endTyping, setTyping, startTyping, typable, typing, useTextEdit } from './session'

/** A title or shape on screen now: on the frame and on the screen. */
interface Live {
  cap: Caption
  world: TurnedBox
  item: ScreenItem
}

type Sel = Pick<EditorState, 'currentTime' | 'selectedCaptionIds'>

const onScreen = (b: TurnedBox, xf: ViewXform): TurnedBox => {
  const [cx, cy] = worldToScreen(xf, b.cx, b.cy)
  return { cx, cy, w: b.w * xf.k, h: b.h * xf.k, rot: b.rot }
}

/** A caption's box on the frame, turned as it is drawn. */
export function worldBox(project: Project, cap: Caption, time: number): TurnedBox {
  const b = manualCaptionBox(project, cap, time)
  return { cx: (b.l + b.r) / 2, cy: (b.t + b.b) / 2, w: b.r - b.l, h: b.b - b.t, rot: captionAngle(project, cap, time) }
}

/** The titles and shapes under the playhead, in drawing order (the last is on top). */
function liveTexts(project: Project, s: Sel, xf: ViewXform): Live[] {
  const out: Live[] = []
  for (const cap of captionsByLayer(project.captions)) {
    if (!cap.manual || s.currentTime < cap.start || s.currentTime >= cap.end) continue
    const world = worldBox(project, cap, s.currentTime)
    out.push({ cap, world, item: { id: cap.id, box: onScreen(world, xf), selected: s.selectedCaptionIds.includes(cap.id), shape: !!cap.shape } })
  }
  return out
}

/** A held box's middle with the words' own height: the words grow down and
 *  up round their own middle line as they wrap, the held box with them. */
function heldMiddle(held: TurnedBox, words: TurnedBox): { cx: number; cy: number } {
  // Along the box's own up-down axis the middle is the words'; along its
  // width it is the held box's.
  const [lx] = boxLocal(words, held.cx, held.cy)
  const [cx, cy] = boxPoint(words, lx, 0)
  return { cx, cy }
}

const styleOf = (project: Project, cap: Caption): Project['captionStyle'] => cap.style ?? project.captionStyle
const keyed = (cap: Caption): boolean => (cap.kfs?.length ?? 0) > 0
const localTime = (cap: Caption, time: number): number => Math.min(Math.max(0, time - cap.start), Math.max(0, cap.end - cap.start))
const clampPos = (v: number): number => Math.min(1.5, Math.max(-0.5, v))

/** The place in a typed title's words nearest to a frame point. */
function indexUnder(project: Project, t: Live, wx: number, wy: number, time: number): number {
  const scale = Math.max(0.02, captionMotionAt(t.cap, time - t.cap.start).scale)
  const [lx, ly] = boxLocal(t.world, wx, wy)
  return indexAt(captionLayout(project, t.cap), lx / scale, ly / scale)
}

/**
 * A press on the preview at (sx, sy) screen px. Returns the drag it starts;
 * 'taken' when the press was a title's own and starts nothing; null when no
 * title or shape is there (the press is for something else). A press outside
 * a title being typed in ends the typing first.
 */
export function pressText(xf: ViewXform, sx: number, sy: number, mods: { shift: boolean }): DragState | 'taken' | null {
  let s = useStore.getState()
  const [wx, wy] = screenToWorld(xf, sx, sy)
  const session = typing()
  if (session) {
    const project = draftProject(s.project)
    const me = liveTexts(project, s, xf).find((t) => t.cap.id === session.id)
    if (me && insideBox(outlineOf(me.item), sx, sy, BODY_SLACK)) {
      // In its own words: the caret goes there; a drag selects.
      setTyping(caretTo(session, indexUnder(project, me, wx, wy, s.currentTime), mods.shift))
      return { kind: 'caption-caret', captionId: session.id, startWorld: { x: wx, y: wy }, cursor: 'text' }
    }
    endTyping()
    s = useStore.getState()
  }
  const project = s.project
  const texts = liveTexts(project, s, xf)
  const hit = hitTest(texts.map((t) => t.item), sx, sy, xf.ch)
  if (!hit) return null
  const t = texts.find((x) => x.cap.id === hit.id)!
  const { cap } = t
  const style = styleOf(project, cap)
  const motion = captionMotionAt(cap, localTime(cap, s.currentTime))
  const common = {
    captionId: cap.id,
    startWorld: { x: wx, y: wy },
    startBox: t.world,
    startCapPos: { x: style.posX ?? 0.5, y: style.posY },
    // Keyframed: the drag writes the animated value at the playhead, not the
    // static one the animation is applied on top of.
    startMotion: keyed(cap) ? motion : undefined,
    startMotionScale: motion.scale
  }
  if (hit.kind === 'knob') {
    s.armGesture()
    return { ...common, kind: 'caption-rotate', startAngle: Math.atan2(wy - t.world.cy, wx - t.world.cx), startRotation: keyed(cap) ? motion.rot : style.rotate ?? 0, startScaleCenter: { x: t.world.cx, y: t.world.cy }, cursor: 'grabbing' }
  }
  if (hit.kind === 'handle') {
    const cursor = handleCursor(hit.handle, t.world.rot)
    s.armGesture()
    if (cap.shape) return { ...common, kind: 'shape-resize', textHandle: hit.handle, startShape: { w: cap.shape.w, h: cap.shape.h }, cursor }
    if (hit.handle === 'e' || hit.handle === 'w') {
      const { spec, measure } = captionSpec(project, cap)
      return { ...common, kind: 'caption-width', textHandle: hit.handle, wrap: { widths: wrapWidths(spec, measure), scale: Math.max(0.02, motion.scale), fit: spec.fitWidth }, cursor }
    }
    return { ...common, kind: 'caption-scale', textHandle: hit.handle, cursor }
  }
  // Its body: it is the selection (Shift adds it to one, or takes it out),
  // and a drag moves everything selected with it.
  const was = s.selectedCaptionIds
  if (mods.shift && was.includes(cap.id) && was.length > 1) {
    s.selectCaptions(was.filter((id) => id !== cap.id))
    return 'taken'
  }
  if (mods.shift) s.selectCaptions([...was.filter((id) => id !== cap.id), cap.id])
  else if (!was.includes(cap.id)) s.selectCaptions([cap.id])
  if (s.selectedClipIds.length) s.selectClip(null)
  const picked = useStore.getState().selectedCaptionIds
  const group = texts
    .filter((x) => picked.includes(x.cap.id))
    .map((x) => {
      const st = styleOf(project, x.cap)
      return { id: x.cap.id, pos: { x: st.posX ?? 0.5, y: st.posY }, motion: keyed(x.cap) ? captionMotionAt(x.cap, localTime(x.cap, s.currentTime)) : undefined }
    })
  s.armGesture()
  return { ...common, kind: 'caption-move', group, cursor: 'move' }
}

/** A double-click: typing starts in the title there (all of it selected); in
 *  the one already typed in, the word there is selected. True when a title or
 *  a shape was there (a shape has no words: nothing opens). */
export function doubleClickText(xf: ViewXform, sx: number, sy: number): boolean {
  const s = useStore.getState()
  const [wx, wy] = screenToWorld(xf, sx, sy)
  const session = typing()
  const project = draftProject(s.project)
  const texts = liveTexts(project, s, xf)
  if (session) {
    const me = texts.find((t) => t.cap.id === session.id)
    if (me && insideBox(outlineOf(me.item), sx, sy, BODY_SLACK)) {
      setTyping(selectWord(session, indexUnder(project, me, wx, wy, s.currentTime)))
      return true
    }
  }
  const hit = hitTest(texts.map((t) => t.item), sx, sy, xf.ch, false)
  if (!hit) return false
  const cap = texts.find((t) => t.cap.id === hit.id)!.cap
  if (typable(cap)) startTyping(cap.id, 'all')
  return true
}

/** What the pointer is on: the title or shape (its outline shows), the
 *  handle (lit), the cursor. Null when it is on none. */
export function hoverText(xf: ViewXform, sx: number, sy: number): { hit: string; hot: string; cursor: string } | null {
  const s = useStore.getState()
  const session = typing()
  const project = draftProject(s.project)
  const texts = liveTexts(project, s, xf)
  if (session) {
    const me = texts.find((t) => t.cap.id === session.id)
    if (me && insideBox(outlineOf(me.item), sx, sy, BODY_SLACK)) return { hit: session.id, hot: '', cursor: 'text' }
  }
  const hit = hitTest(texts.filter((t) => t.cap.id !== session?.id).map((t) => t.item), sx, sy, xf.ch)
  if (!hit) return null
  const t = texts.find((x) => x.cap.id === hit.id)!
  if (hit.kind === 'knob') {
    const o = outlineOf(t.item)
    const { knob } = boxKnob(o, xf.ch)
    return { hit: hit.id, hot: `cap:${hit.id}:knob`, cursor: turnCursor(Math.atan2(knob[1] - o.cy, knob[0] - o.cx) + Math.PI / 2) }
  }
  if (hit.kind === 'handle') return { hit: hit.id, hot: `cap:${hit.id}:${hit.handle}`, cursor: handleCursor(hit.handle, t.world.rot) }
  return { hit: hit.id, hot: '', cursor: 'move' }
}

/** A title or shape put `dx`, `dy` (frame px) from where it stood at the
 *  press, with whatever else the drag sets: keyframed, at the playhead. */
function place(s: EditorState, id: string, start: { pos: { x: number; y: number }; motion?: { x: number; y: number } }, dx: number, dy: number, motion?: { scale?: number }, style?: { maxLineChars?: number }): void {
  const { width: W, height: H } = s.project.settings
  if (start.motion) {
    s.setCaptionMotion(id, { x: start.motion.x + dx, y: start.motion.y + dy, ...motion })
    if (style) s.setCaptionOwnStyle(id, style)
    return
  }
  if (motion) s.setCaptionMotion(id, motion)
  s.setCaptionOwnStyle(id, { posX: clampPos(start.pos.x + dx / W), posY: clampPos(start.pos.y + dy / H), ...style })
}

/** The lines a moved title can rest on: the frame's, the safe areas', and
 *  those of every other text and shape on screen. */
function moveTargets(s: EditorState, moving: readonly string[]): ReturnType<typeof frameTargets> {
  const { project } = s
  const { width: W, height: H } = project.settings
  const o = { centres: project.snap.snapCenters, edges: project.snap.snapEdges }
  const out = frameTargets(W, H, { ...o, safe: o.edges ? SAFE_INSETS : [] })
  for (const c of project.captions) {
    if (moving.includes(c.id) || s.currentTime < c.start || s.currentTime >= c.end) continue
    out.push(...boxTargets(boundsOf(worldBox(project, c, s.currentTime)), o))
  }
  return out
}

/**
 * A drag's move applied: (sx, sy) is the pointer on screen. Returns false
 * when the drag is not a title's or a shape's. `guides` gets the lines to show.
 */
export function dragText(drag: DragState, xf: ViewXform, sx: number, sy: number, shift: boolean, alt: boolean, guides: { current: GuideLine[] }): boolean {
  const kinds: DragState['kind'][] = ['caption-move', 'caption-scale', 'caption-width', 'caption-rotate', 'caption-caret', 'shape-resize']
  if (!kinds.includes(drag.kind) || !drag.captionId) return false
  const s = useStore.getState()
  const [wx, wy] = screenToWorld(xf, sx, sy)
  const id = drag.captionId
  if (drag.kind === 'caption-caret') {
    const session = typing()
    if (!session) return true
    const project = draftProject(s.project)
    const me = liveTexts(project, s, xf).find((t) => t.cap.id === session.id)
    if (me) setTyping(caretTo(session, indexUnder(project, me, wx, wy, s.currentTime), true))
    return true
  }
  const box = drag.startBox
  if (!box) return true
  const from: Pt = [drag.startWorld.x, drag.startWorld.y]
  const to: Pt = [wx, wy]
  const start = { pos: drag.startCapPos ?? { x: 0.5, y: 0.5 }, motion: drag.startMotion }
  if (drag.kind === 'caption-move') {
    let dx = wx - from[0]
    let dy = wy - from[1]
    // Shift keeps to one axis (the one gone further along); Alt catches on nothing.
    const lock = shift ? (Math.abs(dx) >= Math.abs(dy) ? 'y' : 'x') : undefined
    if (lock === 'y') dy = 0
    if (lock === 'x') dx = 0
    guides.current = []
    if (!alt && s.project.snap.enabled) {
      drag.targets ??= moveTargets(s, (drag.group ?? []).map((g) => g.id))
      const b = boundsOf({ ...box, cx: box.cx + dx, cy: box.cy + dy })
      const snap = snapMove(b, drag.targets, s.project.snap.distance / xf.k, lock)
      dx += snap.dx
      dy += snap.dy
      guides.current = snap.guides
    }
    for (const g of drag.group ?? []) place(s, g.id, g, dx, dy)
    return true
  }
  if (drag.kind === 'caption-rotate' && drag.startScaleCenter && drag.startAngle !== undefined) {
    const c = drag.startScaleCenter
    const rot = snapTurn(turnFrom([c.x, c.y], from, to, drag.startRotation ?? 0, (drag.turn ??= { sum: 0 })), shift)
    if (drag.startMotion) s.setCaptionMotion(id, { rot })
    else s.setCaptionOwnStyle(id, { rotate: rot })
    return true
  }
  if (drag.kind === 'caption-scale' && drag.textHandle) {
    const s0 = Math.max(0.02, drag.startMotionScale ?? 1)
    const r = sizeByHandle(box, drag.textHandle, from, to, alt, 0.05 / s0, 4 / s0)
    place(s, id, start, r.cx - box.cx, r.cy - box.cy, { scale: s0 * r.ratio })
    return true
  }
  if (drag.kind === 'caption-width' && drag.wrap && (drag.textHandle === 'e' || drag.textHandle === 'w')) {
    const h = drag.textHandle
    const { widths, scale, fit } = drag.wrap
    const target = widthByHandle(box, h, from, to, alt)
    const n = wrapForWidth(widths, target / scale)
    // The block as it will be drawn: never under the box's own least, and
    // (fitted to a width) never over that.
    let w = Math.max(20, widths[n - WRAP_MIN])
    if (fit > 0) w = Math.min(w, Math.max(20, fit))
    const [cx, cy] = middleAfterWidth(box, h, w * scale, alt)
    place(s, id, start, cx - box.cx, cy - box.cy, undefined, { maxLineChars: n })
    // The box as it is held: its pulled side at the pointer (the words wrap
    // by whole words inside it; its line does not jump with them), never
    // narrower than the words. At the release the box sits on the words again.
    const held = Math.max(target, w * scale)
    const [hx, hy] = middleAfterWidth(box, h, held, alt)
    drag.heldBox = { cx: hx, cy: hy, w: held, h: box.h, rot: box.rot }
    return true
  }
  if (drag.kind === 'shape-resize' && drag.textHandle && drag.startShape) {
    // In the shape's own frame, so a turned box is sized along its own sides.
    const { width: W, height: H } = s.project.settings
    const scale = Math.max(0.02, drag.startMotionScale ?? 1)
    const dir = HANDLE_DIR[drag.textHandle]
    const [mx, my] = boxLocal({ ...box, cx: 0, cy: 0 }, wx - from[0], wy - from[1])
    const halfW = (drag.startShape.w * W) / 2
    const halfH = (drag.startShape.h * H) / 2
    // The opposite side stays put; Shift keeps the shape's proportions, Alt
    // works from its middle (ui/handles.ts resizeBox, the same rule everywhere).
    const b = resizeBox({ l: -halfW, r: halfW, t: -halfH, b: halfH }, drag.textHandle, dir[0] * halfW + mx / scale, dir[1] * halfH + my / scale, shift, 4, alt)
    s.setCaptionShape(id, { w: Math.max(0.004, Math.min(2, (b.r - b.l) / W)), h: Math.max(0.003, Math.min(2, (b.b - b.t) / H)) })
    // Its middle goes half of what the pulled side went.
    const [ox, oy] = boxPoint({ ...box, cx: 0, cy: 0 }, ((b.l + b.r) / 2) * scale, ((b.t + b.b) / 2) * scale)
    place(s, id, start, ox, oy)
    return true
  }
  return true
}

/** The arrow keys: the selected titles and shapes under the playhead go by
 *  (dx, dy) frame px. False when there is none. */
export function nudgeText(dx: number, dy: number): boolean {
  const s = useStore.getState()
  const caps = s.selectedCaptionIds.map((id) => s.project.captions.find((c) => c.id === id)).filter((c): c is Caption => !!c && !!c.manual && s.currentTime >= c.start && s.currentTime < c.end)
  if (!caps.length) return false
  for (const cap of caps) {
    const st = styleOf(s.project, cap)
    place(s, cap.id, { pos: { x: st.posX ?? 0.5, y: st.posY }, motion: keyed(cap) ? captionMotionAt(cap, localTime(cap, s.currentTime)) : undefined }, dx, dy)
  }
  return true
}

/** Enter with the preview in focus: typing starts in the one selected title. */
export function typeSelected(): boolean {
  const s = useStore.getState()
  if (s.selectedCaptionIds.length !== 1) return false
  const cap = s.project.captions.find((c) => c.id === s.selectedCaptionIds[0])
  if (!typable(cap) || s.currentTime < cap.start || s.currentTime >= cap.end) return false
  return startTyping(cap.id, 'all')
}

/** What of the typing the paused preview's picture depends on (drawn again
 *  when it changes): the draft, the selection, the caret's blink. */
export function typingSignature(): string {
  const { session, touched } = useTextEdit.getState()
  if (!session) return ''
  const lit = Math.floor((performance.now() - touched) / 530) % 2 === 0
  return `${session.id}:${session.text}:${session.anchor}:${session.focus}:${lit ? 1 : 0}`
}

/**
 * Drawn over the picture: the outline of a title the pointer is on, the
 * selection (outline, handles, knob), the values of a drag beside it, the
 * caret and selection of a title being typed in, the lines a drag rests on.
 * `project` is the one the picture was drawn from (the typing's draft in it).
 */
export function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  s: EditorState,
  project: Project,
  xf: ViewXform,
  o: { hover: string | null; hot: string; live: DragState | null; nudged: boolean; guides: readonly GuideLine[] }
): void {
  const texts = liveTexts(project, s, xf)
  const session = typing()
  const hovered = o.hover ? texts.find((t) => t.cap.id === o.hover) : undefined
  if (hovered && !hovered.item.selected) drawHoverOutline(ctx, outlineOf(hovered.item))
  for (const t of texts) {
    if (!t.item.selected) continue
    // (A width pull holds the box at the pointer; its height is the words'.)
    const held = o.live?.kind === 'caption-width' && o.live.captionId === t.cap.id && o.live.moved ? o.live.heldBox : undefined
    const outline = outlineOf(held ? { ...t.item, box: onScreen({ ...held, h: t.world.h, ...heldMiddle(held, t.world) }, xf) } : t.item)
    const typed = session?.id === t.cap.id
    const hot = o.hot.startsWith(`cap:${t.cap.id}:`) ? (o.hot.slice(t.cap.id.length + 5) as HandleId | 'knob') : o.live?.captionId === t.cap.id && o.live.moved ? (o.live.kind === 'caption-rotate' ? 'knob' : o.live.textHandle ?? null) : null
    drawSelection(ctx, outline, { handles: !typed, hot, canvasH: xf.ch })
    if (typed && session) {
      const layout = captionLayout(project, t.cap)
      const scale = Math.max(0.02, captionMotionAt(t.cap, s.currentTime - t.cap.start).scale) * xf.k
      const lit = Math.floor((performance.now() - useTextEdit.getState().touched) / 530) % 2 === 0
      const caret = session.anchor === session.focus && lit ? caretAt(layout, session.focus) : null
      drawTyping(
        ctx,
        () => {
          ctx.translate(t.item.box.cx, t.item.box.cy)
          ctx.rotate(t.item.box.rot)
          ctx.scale(scale, scale)
        },
        1 / scale,
        { rects: selectionRects(layout, session.anchor, session.focus), caret, height: layout.fontSize * 1.12 }
      )
      continue
    }
    const live = o.live?.captionId === t.cap.id && o.live.moved ? o.live : null
    const { knob } = boxKnob(outline, xf.ch)
    if (live?.kind === 'caption-rotate') drawAngleTag(ctx, knob[0], knob[1], t.world.rot, HANDLE_ACCENT)
    else if (live?.kind === 'caption-scale' && live.textHandle) {
      const [dx, dy] = HANDLE_DIR[live.textHandle]
      const [hx, hy] = boxPoint(outline, (dx * outline.w) / 2, (dy * outline.h) / 2)
      drawTag(ctx, hx, hy, fmtPct(captionMotionAt(t.cap, s.currentTime - t.cap.start).scale), HANDLE_ACCENT)
    } else if (!o.live && o.nudged && t.cap.id === s.selectedCaptionIds[0]) {
      drawTag(ctx, outline.cx - 12, outline.cy, `${Math.round(t.world.cx)} , ${Math.round(t.world.cy)}`, HANDLE_ACCENT)
    }
  }
  drawGuides(ctx, o.guides, (x, y) => worldToScreen(xf, x, y))
}
