# Reference frames

Byte-for-byte proof that a change which should not change the picture or the
sound does not. Made for the clean-product phase (SnippStudio `TEMIZLIK-PLAN.md`)
and kept for the refactors after it.

What it draws: small projects built in the page with fixed ids (`refs.mjs`):
video with transitions and their sounds, word-animated subtitles, a text and two
shapes; moving pictures (a push-in and picture moves); a code film clip
(`film-demo/`); two templates over subtitles; a backdrop under the camera look;
Shorts; every template kind alone (`tpl-blocks.json`, the blocks the Templates
panel made, saved once so changes to its sample data do not move the reference);
and a sound-only project of the templates that make sounds. Frames are drawn by
`exportFramePng` and, for some, by the export's own `frameDrawer`; sound is the
WAV export. Each one's SHA-256 is written down.

```
node make-media.mjs <mediaDir>                       # once (ffmpeg test sources)
electron.exe . --remote-debugging-port=9333 --show-inactive=offscreen --user-data-dir=<temp>\profile
node refs.mjs before.json <pngsBefore> <mediaDir>
# ... the change, a build, the window again ...
node refs.mjs after.json <pngsAfter> <mediaDir>
node cmp.mjs before.json after.json <pngsBefore> <pngsAfter>
```

Since SnippStudio phase 2B this is part of `npm run e2e -- --frames`: a
window of its own started with `--disable-accelerated-2d-canvas`, compared
with `testdata\referans\baseline` (`--frames-baseline` writes a new one). The
software rasterizer is deterministic; the GPU one's antialiased edges depend on
what it drew before, which was the cause of the "flaky" template frames below
(none of them differs in a software run).

The pixel pass ("cila" part D) has frames of its own: `fx-gpu` and `fx-cpu`,
the same project (a LUT at three strengths, both keyers, vignette and grain,
the colour dials, glow, halation, mosaic, colour isolate, several at once)
drawn by the shader and by the CPU path. Their picture, `fx.png`, is written
pixel by pixel by `make-fx-media.mjs` (`refs.mjs` makes it when it is not
there). The shader's frames are the same from run to run on one machine and
driver; another GPU may round differently, and then a new baseline of those
frames is that machine's.

New frames are ADDED to the baseline, never by writing it again:
`ONLY='^fx-' node refs.mjs new.json newPngs <mediaDir>` draws only the new
projects, and `node add-frames.mjs new.json newPngs` adds the entries the
baseline does not hold yet (an entry it already holds is left as it is). A
branch keeps its new frames beside the baseline until it is merged: a
baseline holding frames the tree does not draw fails every other run with
MISSING.

`cmp.mjs` counts the pixels of any frame whose hash differs. A few template
frames (`FLAKY` in `cmp.mjs`) already wobble by a handful of pixels from one run
to the next with no change at all; they are reported apart. `ONLY=<regex>`
limits a run to some projects. A template kind the product no longer has fails
to draw and shows as different: pass a skip pattern to `cmp.mjs` for it.
