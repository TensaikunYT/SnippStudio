// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * GPU implementation of the per-pixel clip effects (chroma key, LUT, duotone,
 * sharpen, vignette, grain, chromatic aberration; since "cila" part D also
 * exposure / tint / highlights / shadows, mosaic, colour isolate, glow and
 * halation).
 *
 * This is a drop-in replacement for the CPU ImageData loop: same inputs, same
 * output canvas. Crucially BOTH the live preview and the exporter call the
 * same `applyPixelFx`, so moving the maths onto the GPU keeps preview and
 * export pixel-identical to each other — the CPU path stays as a fallback for
 * machines where WebGL2 is unavailable.
 *
 * The CPU version allocated a fresh ~2 MB ImageData every frame per clip and
 * ran a JS loop over every pixel with `willReadFrequently` forcing the canvas
 * out of GPU memory. That was the main source of preview stalls.
 *
 * The arithmetic is written twice: here and in draw/fx-math.ts (the CPU
 * path, which the unit tests run). A change to one is a change to both.
 */

import { BLUR_TAPS, BLUR_WEIGHTS, HALATION_THRESHOLD, blurBufferSize, cbcr, chromaDir, gradeIsNeutral, hasLightPass } from './draw/fx-math'
import type { FxParams } from './draw/fx-math'
export { VIDEO_FX_INDEX } from './draw/fx-math'
export type { FxParams } from './draw/fx-math'

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// Mirrors the CPU pipeline order exactly (draw/fx-math.ts pixelPassCpu): the
// source through the mosaic and the despill, chromatic aberration, then
// sharpen (which overwrites all three channels, as on the CPU), colour,
// duotone, LUT, colour isolate, vignette, grain, the whole look, and finally
// the key's alpha from the SOURCE colour.
const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform sampler3D u_lut;
uniform vec2 u_res;
uniform int u_chromaOn;
uniform vec3 u_key;
uniform float u_sim;
uniform float u_smooth;
uniform vec2 u_keyC;
uniform vec2 u_keyDir;
uniform float u_spill;
uniform int u_lutOn;
uniform float u_lutN;
uniform float u_lutAmt;
uniform int u_gradeOn;
uniform vec4 u_grade;
uniform int u_duoOn;
uniform vec3 u_duoDark;
uniform vec3 u_duoLight;
uniform float u_sharpen;
uniform float u_vig;
uniform float u_grain;
uniform float u_cab;
uniform float u_time;
uniform int u_fx;
uniform float u_fxAmt;
uniform float u_mosaic;
uniform int u_isoOn;
uniform vec2 u_isoDir;
uniform float u_isoRange;
uniform float u_isoAmt;

float luma709(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
vec2 cbcr(vec3 c) {
  float y = luma709(c);
  return vec2((c.b - y) * 0.5389, (c.r - y) * 0.635);
}

vec4 rawAt(vec2 p) {
  vec2 c = clamp(p, vec2(0.0), u_res - 1.0);
  return texture(u_tex, (floor(c) + 0.5) / u_res);
}
// A texel by its image position (row 0 at the top, as the CPU counts).
vec4 imgAt(vec2 ip) {
  vec2 f = clamp(floor(ip), vec2(0.0), u_res - 1.0);
  return rawAt(vec2(f.x, u_res.y - 1.0 - f.y));
}
// The source: the picture itself, or its mosaic cell (four taps, rounded).
vec4 srcAt(vec2 p) {
  if (u_mosaic < 1.5) return rawAt(p);
  vec2 q = clamp(floor(p), vec2(0.0), u_res - 1.0);
  vec2 img = vec2(q.x, u_res.y - 1.0 - q.y);
  // (A pixel belongs to the cell its CENTRE lies in: asked of its corner, a
  // pixel on a cell's first row or column sits exactly on the boundary, and
  // a GPU that divides by multiplying with 1 / cell puts some of them in the
  // cell before.)
  vec2 ctr = (floor((img + 0.5) / u_mosaic) + 0.5) * u_mosaic;
  float o = u_mosaic * 0.25;
  vec4 s = imgAt(ctr + vec2(-o, -o)) + imgAt(ctr + vec2(o, -o)) + imgAt(ctr + vec2(-o, o)) + imgAt(ctr + vec2(o, o));
  return floor(s * 0.25 * 255.0 + 0.5) / 255.0;
}
// The key colour's cast taken off (the chroma keyer): draw/fx-math.ts despill.
vec3 despill(vec3 c) {
  float y = luma709(c);
  vec2 cc = vec2((c.b - y) * 0.5389, (c.r - y) * 0.635);
  float along = dot(cc, u_keyDir);
  if (along <= 0.0) return c;
  vec2 perp = cc - along * u_keyDir;
  float kept = along + (min(along, length(perp)) - along) * u_spill;
  vec2 c2 = perp + kept * u_keyDir;
  float r2 = y + c2.y / 0.635;
  float b2 = y + c2.x / 0.5389;
  return vec3(r2, (y - 0.2126 * r2 - 0.0722 * b2) / 0.7152, b2);
}
// What every effect reads: the source, despilled when the chroma keyer asks.
vec4 texelAt(vec2 p) {
  vec4 s = srcAt(p);
  if (u_chromaOn == 2 && u_spill > 0.001) s.rgb = floor(clamp(despill(s.rgb), 0.0, 1.0) * 255.0 + 0.5) / 255.0;
  return s;
}

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Exposure, tint, highlights, shadows: draw/fx-math.ts gradeColor.
vec3 gradeColor(vec3 v) {
  float e = u_grade.x;
  if (e != 0.0) {
    float k = pow(2.0, e);
    float kp = pow(k, 1.0 / 2.2);
    v = pow(pow(v, vec3(2.2)) * k, vec3(1.0 / 2.2));
    if (e > 0.0) {
      float t = 1.0 - 0.25 * min(1.0, e);
      float p = (kp - t) / (1.0 - t);
      vec3 u = clamp((v - t) / (kp - t), 0.0, 1.0);
      v = mix(v, t + (1.0 - t) * (1.0 - pow(1.0 - u, vec3(p))), step(t, v));
    }
  }
  float tint = u_grade.y;
  if (tint != 0.0) v *= vec3(1.0 + 0.1 * tint, 1.0 - 0.2 * tint, 1.0 + 0.1 * tint);
  float hi = u_grade.z;
  float sh = u_grade.w;
  if (hi != 0.0 || sh != 0.0) {
    float l = clamp(luma709(v), 0.0, 1.0);
    float hw = 4.0 * l * l * (1.0 - l);
    float sw = 4.0 * l * (1.0 - l) * (1.0 - l);
    float d = (hi > 0.0 ? 0.24 : 0.5) * hi * hw + (sh > 0.0 ? 0.5 : 0.24) * sh * sw;
    v *= (l + d + 0.05) / (l + 0.05);
  }
  return v;
}

// How much of its colour a pixel keeps: draw/fx-math.ts isolateKeep.
float isolateKeep(vec3 c) {
  vec2 cc = cbcr(c);
  float mag = length(cc);
  float cosang = clamp(dot(cc, u_isoDir) / max(mag, 1e-5), -1.0, 1.0);
  float ang = acos(cosang) / 3.141592653589793;
  float soft = max(0.03, u_isoRange * 0.5);
  return (1.0 - smoothstep(u_isoRange, u_isoRange + soft, ang)) * smoothstep(0.015, 0.05, mag);
}

void main() {
  vec2 px = floor(v_uv * u_res);
  // GL counts rows from the bottom; the CPU reference indexes image rows from
  // the top. Geometry-dependent effects must use the image-space row or they
  // come out vertically mirrored.
  vec2 imgPx = vec2(px.x, u_res.y - 1.0 - px.y);
  vec4 src = srcAt(px);
  vec4 base = texelAt(px);
  vec3 orig = base.rgb * 255.0;
  vec3 c = orig;

  if (u_cab > 0.0) {
    c.r = texelAt(vec2(px.x - u_cab, px.y)).r * 255.0;
    c.b = texelAt(vec2(px.x + u_cab, px.y)).b * 255.0;
  }
  if (u_sharpen > 0.01) {
    float k = u_sharpen * 0.8;
    vec3 avg = (texelAt(px + vec2(-1.0, 0.0)).rgb + texelAt(px + vec2(1.0, 0.0)).rgb +
                texelAt(px + vec2(0.0, -1.0)).rgb + texelAt(px + vec2(0.0, 1.0)).rgb) * 255.0 / 4.0;
    c = orig + (orig - avg) * k * 2.0;
  }
  if (u_gradeOn == 1) {
    c = gradeColor(clamp(c / 255.0, 0.0, 1.0)) * 255.0;
  }
  float keep = 1.0;
  if (u_isoOn == 1) keep = isolateKeep(clamp(c / 255.0, 0.0, 1.0));
  if (u_duoOn == 1) {
    float lum = dot(c, vec3(0.299, 0.587, 0.114)) / 255.0;
    c = mix(u_duoDark, u_duoLight, lum);
  }
  if (u_lutOn == 1) {
    // Between the eight entries around the colour (trilinear), each fetched
    // exactly: draw/fx-math.ts lutTrilinear.
    float n = u_lutN;
    vec3 c0 = clamp(c, 0.0, 255.0);
    vec3 q = c0 / 255.0 * (n - 1.0);
    vec3 i0 = min(floor(q), n - 2.0);
    vec3 f = q - i0;
    ivec3 i = ivec3(i0);
    vec3 x00 = mix(texelFetch(u_lut, i, 0).rgb, texelFetch(u_lut, i + ivec3(1, 0, 0), 0).rgb, f.r);
    vec3 x10 = mix(texelFetch(u_lut, i + ivec3(0, 1, 0), 0).rgb, texelFetch(u_lut, i + ivec3(1, 1, 0), 0).rgb, f.r);
    vec3 x01 = mix(texelFetch(u_lut, i + ivec3(0, 0, 1), 0).rgb, texelFetch(u_lut, i + ivec3(1, 0, 1), 0).rgb, f.r);
    vec3 x11 = mix(texelFetch(u_lut, i + ivec3(0, 1, 1), 0).rgb, texelFetch(u_lut, i + ivec3(1, 1, 1), 0).rgb, f.r);
    vec3 graded = mix(mix(x00, x10, f.g), mix(x01, x11, f.g), f.b) * 255.0;
    c = c0 + (graded - c0) * u_lutAmt;
  }
  if (u_isoOn == 1) {
    c = mix(c, vec3(luma709(c)), (1.0 - keep) * u_isoAmt);
  }
  if (u_vig > 0.01) {
    vec2 ctr = u_res * 0.5;
    float dist = length(imgPx - ctr) / length(ctr);
    c *= 1.0 - u_vig * max(0.0, dist - 0.35) * 1.6;
  }
  if (u_grain > 0.01) {
    float nz = (hash(vec3(imgPx, floor(u_time * 1000.0))) * 512.0 - 256.0) * u_grain * 0.4;
    c += nz;
  }

  // ---- Whole looks. One at a time; see VideoFxStyle. --------------------
  if (u_fx > 0 && u_fxAmt > 0.001) {
    float k = u_fxAmt;
    // Analogue picture noise runs at its own rate, not the frame rate: static
    // that changes every frame reads as digital, static that HOLDS for a
    // couple of frames reads as a signal.
    float tick = floor(u_time * 14.0);
    if (u_fx == 2) {
      // Retro TV: scanlines, a shadow-mask tint per column triple, a soft
      // corner falloff and a little colour fringing.
      float line = mod(imgPx.y, 3.0);
      c *= mix(1.0, line < 1.0 ? 0.62 : 1.06, k);
      float col = mod(imgPx.x, 3.0);
      vec3 mask = col < 1.0 ? vec3(1.06, 0.97, 0.97) : (col < 2.0 ? vec3(0.97, 1.06, 0.97) : vec3(0.97, 0.97, 1.06));
      c *= mix(vec3(1.0), mask, k);
      float fr = k * 1.5;
      c.r = mix(c.r, texelAt(vec2(px.x - fr, px.y)).r * 255.0, 0.7);
      c.b = mix(c.b, texelAt(vec2(px.x + fr, px.y)).b * 255.0, 0.7);
      vec2 ctr2 = u_res * 0.5;
      float d2 = length((imgPx - ctr2) / ctr2);
      c *= 1.0 - k * 0.5 * max(0.0, d2 - 0.45);
      c += k * 6.0;
    } else if (u_fx == 3) {
      // VHS: rows wander, colour lags behind luma, and every so often a band
      // of tape drops out and goes bright.
      float band = floor(imgPx.y / 3.0);
      float wob = (hash(vec3(band, tick, 7.0)) - 0.5) * k * 14.0;
      vec3 shifted = texelAt(vec2(px.x + wob, px.y)).rgb * 255.0;
      c = mix(c, shifted, 0.85);
      float lag = k * 4.0;
      c.r = texelAt(vec2(px.x + wob - lag, px.y)).r * 255.0;
      c.b = texelAt(vec2(px.x + wob + lag * 0.6, px.y)).b * 255.0;
      float drop = hash(vec3(band * 0.37, floor(u_time * 6.0), 21.0));
      if (drop > 1.0 - k * 0.035) c += 90.0 * k;
      c *= 1.0 - k * 0.06 * hash(vec3(imgPx.y, tick, 3.0));
    } else if (u_fx == 4) {
      // Halftone: one ink dot per cell, sized by how dark the cell is.
      float cell = mix(2.0, 9.0, k);
      vec2 cellPx = floor(imgPx / cell) * cell + cell * 0.5;
      vec2 imgToGl = vec2(cellPx.x, u_res.y - 1.0 - cellPx.y);
      vec3 cc = texelAt(imgToGl).rgb * 255.0;
      float lum = dot(cc, vec3(0.299, 0.587, 0.114)) / 255.0;
      float r = (1.0 - lum) * cell * 0.72;
      float dist = length(imgPx - cellPx);
      float ink = smoothstep(r + 0.7, r - 0.7, dist);
      vec3 dotted = mix(vec3(255.0), cc * 0.25 + vec3(12.0), ink);
      c = mix(c, dotted, k);
    } else if (u_fx == 5) {
      // Posterize: fewer levels, and a touch more contrast so the bands sit
      // where the eye expects them.
      float levels = max(2.0, floor(mix(24.0, 3.0, k)));
      vec3 q = clamp(c, 0.0, 255.0) / 255.0;
      q = clamp((q - 0.5) * (1.0 + k * 0.35) + 0.5, 0.0, 1.0);
      c = floor(q * levels + 0.5) / levels * 255.0;
    }
  }

  float a = base.a;
  if (u_chromaOn == 1) {
    // The first keyer: the source colour's distance in RGB.
    float d = distance(src.rgb * 255.0, u_key);
    if (d < u_sim) a = 0.0;
    else if (d < u_sim + u_smooth) a *= (d - u_sim) / u_smooth;
  } else if (u_chromaOn == 2) {
    // The chroma keyer: its distance on the CbCr plane (fx-math.ts keyAlpha).
    a = floor(a * 255.0 * smoothstep(0.0, 1.0, (length(cbcr(src.rgb) - u_keyC) - u_sim) / u_smooth) + 0.5) / 255.0;
  }
  outColor = vec4(clamp(c, 0.0, 255.0) / 255.0, a);
}`

// The bright parts of the first pass's picture into the small blur buffer
// (16 taps a pixel): draw/fx-math.ts brightBlur, first loop.
const FRAG_BRIGHT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_src;
uniform vec2 u_dst;
uniform float u_threshold;
void main() {
  vec2 foot = u_src / u_dst;
  vec2 ctr = v_uv * u_src;
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 sp = ctr + ((vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5) * foot;
      vec4 t = texture(u_tex, sp / u_src);
      float w = smoothstep(u_threshold - 0.1, u_threshold + 0.1, dot(t.rgb, vec3(0.2126, 0.7152, 0.0722))) * t.a;
      sum += t.rgb * w;
    }
  }
  outColor = vec4(sum / 16.0, 1.0);
}`

// One direction of the blur (17 taps): draw/fx-math.ts brightBlur, second loop.
const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_dst;
uniform vec2 u_step;
uniform float u_w[${2 * BLUR_TAPS + 1}];
void main() {
  vec2 p = v_uv * u_dst;
  vec3 s = vec3(0.0);
  for (int i = 0; i < ${2 * BLUR_TAPS + 1}; i++) {
    s += texture(u_tex, (p + float(i - ${BLUR_TAPS}) * u_step) / u_dst).rgb * u_w[i];
  }
  outColor = vec4(s, 1.0);
}`

// The glow and the halation laid on the first pass's picture, screen-blended:
// draw/fx-math.ts compositeLight.
const FRAG_LIGHT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform sampler2D u_glow;
uniform sampler2D u_hal;
uniform int u_glowOn;
uniform int u_halOn;
uniform float u_glowAmt;
uniform float u_halAmt;
void main() {
  vec4 b = texture(u_tex, v_uv);
  vec3 c = b.rgb;
  if (u_glowOn == 1) {
    vec3 g = min(vec3(1.0), texture(u_glow, v_uv).rgb * u_glowAmt);
    c = 1.0 - (1.0 - c) * (1.0 - g);
  }
  if (u_halOn == 1) {
    float k = min(1.0, dot(texture(u_hal, v_uv).rgb, vec3(0.2126, 0.7152, 0.0722)) * u_halAmt * 1.6) * (1.0 - clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0));
    c = 1.0 - (1.0 - c) * (1.0 - vec3(1.0, 0.32, 0.12) * k);
  }
  outColor = vec4(c, b.a);
}`

interface Prog {
  program: WebGLProgram
  uni: Record<string, WebGLUniformLocation | null>
}
/** A texture the passes draw into, with its framebuffer. */
interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

let canvas: HTMLCanvasElement | null = null
let gl: WebGL2RenderingContext | null = null
let main: Prog | null = null
let bright: Prog | null = null
let blur: Prog | null = null
let light: Prog | null = null
let srcTex: WebGLTexture | null = null
/** The LUTs on the GPU, by id (the last few used: a frame with two graded
 *  clips, or the looks' hover, does not upload a table again each time). */
let lutTexs = new Map<string, WebGLTexture>()
const LUT_TEX_MAX = 4
/** The first pass's picture and the blur buffers (made when first needed). */
let targets: Record<string, Target> = {}
let failed = false
/** Tests only: the GPU path refuses, so the CPU path draws. */
let cpuOnly = false
/**
 * Context loss. A GPU reset (a driver timeout, sleep and resume, a long
 * WebGPU job in the same GPU process) loses every WebGL context, and a lost
 * one silently draws nothing: every clip with a LUT, grain, vignette, chroma
 * key, sharpen or a look turned invisible, in the preview and in an export,
 * until the app was restarted. Now a lost context is dropped and a fresh one
 * built on the next call; until one can be made, the CPU path draws the
 * effects. Retries are spaced out, and after several failed ones (the
 * browser can block WebGL after repeated GPU crashes) the CPU path stays.
 */
let losses = 0
/** Lost and not built again yet. */
let recovering = false
let retries = 0
let retryAt = 0
const RETRY_MS = 2000
const MAX_RETRIES = 5

/** Forgets the context and everything made in it; the next init builds anew. */
function dropContext(): void {
  gl = null
  main = null
  bright = null
  blur = null
  light = null
  srcTex = null
  lutTexs = new Map()
  targets = {}
  canvas = null
}

function lost(): void {
  dropContext()
  losses++
  recovering = true
  retries = 0
  retryAt = performance.now() + RETRY_MS
}

/** How many times the context has been lost (for the tests). */
export const pixelFxContextLosses = (): number => losses

/** Tests only: make the GPU path refuse (the CPU path then draws), or allow it again. */
export function setPixelFxCpuOnly(on: boolean): void {
  cpuOnly = on
}

let gpuFrames = 0
/** How many passes the GPU has drawn (the tests tell the two paths apart by it). */
export const pixelFxGpuFrames = (): number => gpuFrames

function compile(g: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const sh = g.createShader(type)
  if (!sh) return null
  g.shaderSource(sh, source)
  g.compileShader(sh)
  if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
    console.error('fx shader compile failed:', g.getShaderInfoLog(sh))
    g.deleteShader(sh)
    return null
  }
  return sh
}

function link(g: WebGL2RenderingContext, vs: WebGLShader, frag: string, names: string[]): Prog {
  const fs = compile(g, g.FRAGMENT_SHADER, frag)
  if (!fs) throw new Error('shader compile')
  const p = g.createProgram()!
  g.attachShader(p, vs)
  g.attachShader(p, fs)
  // One vertex buffer for every program: the same attribute slot in each.
  g.bindAttribLocation(p, 0, 'a_pos')
  g.linkProgram(p)
  if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error('link: ' + g.getProgramInfoLog(p))
  const uni: Record<string, WebGLUniformLocation | null> = {}
  for (const name of names) uni[name] = g.getUniformLocation(p, name)
  return { program: p, uni }
}

function init(): boolean {
  if (failed || cpuOnly) return false
  if (gl && gl.isContextLost()) lost()
  if (gl && main) return true
  // Lost a moment ago: give the GPU time to come back before asking again.
  if (recovering && performance.now() < retryAt) return false
  try {
    const cv = document.createElement('canvas')
    canvas = cv
    const g = cv.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false
    })
    if (!g) throw new Error('no webgl2')
    // Told the moment it happens (not only noticed on the next frame). Only
    // the context that is current counts: an old canvas's event is history.
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      if (canvas === cv) lost()
    })
    const vs = compile(g, g.VERTEX_SHADER, VERT)
    if (!vs) throw new Error('shader compile')
    const m = link(g, vs, FRAG, [
      'u_tex', 'u_lut', 'u_res', 'u_chromaOn', 'u_key', 'u_sim', 'u_smooth', 'u_keyC', 'u_keyDir', 'u_spill',
      'u_lutOn', 'u_lutN', 'u_lutAmt', 'u_gradeOn', 'u_grade', 'u_duoOn', 'u_duoDark', 'u_duoLight', 'u_sharpen',
      'u_vig', 'u_grain', 'u_cab', 'u_time', 'u_fx', 'u_fxAmt', 'u_mosaic', 'u_isoOn', 'u_isoDir', 'u_isoRange', 'u_isoAmt'
    ])
    const br = link(g, vs, FRAG_BRIGHT, ['u_tex', 'u_src', 'u_dst', 'u_threshold'])
    const bl = link(g, vs, FRAG_BLUR, ['u_tex', 'u_dst', 'u_step', 'u_w'])
    const li = link(g, vs, FRAG_LIGHT, ['u_tex', 'u_glow', 'u_hal', 'u_glowOn', 'u_halOn', 'u_glowAmt', 'u_halAmt'])

    // Full-screen triangle.
    const buf = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, buf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
    g.enableVertexAttribArray(0)
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)

    srcTex = g.createTexture()
    g.bindTexture(g.TEXTURE_2D, srcTex)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST)

    g.useProgram(m.program)
    g.uniform1i(m.uni.u_tex, 0)
    g.uniform1i(m.uni.u_lut, 1)
    g.useProgram(br.program)
    g.uniform1i(br.uni.u_tex, 0)
    g.useProgram(bl.program)
    g.uniform1i(bl.uni.u_tex, 0)
    g.uniform1fv(bl.uni.u_w, new Float32Array(BLUR_WEIGHTS))
    g.useProgram(li.program)
    g.uniform1i(li.uni.u_tex, 0)
    g.uniform1i(li.uni.u_glow, 2)
    g.uniform1i(li.uni.u_hal, 3)
    g.disable(g.BLEND)
    g.disable(g.DEPTH_TEST)
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true)

    gl = g
    main = m
    bright = br
    blur = bl
    light = li
    recovering = false
    retries = 0
    return true
  } catch (err) {
    dropContext()
    // After a loss, failing to get a context again may be the GPU still
    // coming back: try again in a while, a few times, before giving up.
    if (recovering && ++retries <= MAX_RETRIES) {
      retryAt = performance.now() + RETRY_MS
      return false
    }
    console.warn('WebGL pixel effects unavailable, falling back to CPU:', err)
    failed = true
    return false
  }
}

/** The LUT as an n × n × n float texture (red along x, as the table is
 *  written), kept by id; bound to unit 1. */
function bindLut(g: WebGL2RenderingContext, lut: { n: number; data: Float32Array; id: string }): void {
  g.activeTexture(g.TEXTURE1)
  const had = lutTexs.get(lut.id)
  if (had) {
    // (Used last: put at the end, so the one left longest goes first.)
    lutTexs.delete(lut.id)
    lutTexs.set(lut.id, had)
    g.bindTexture(g.TEXTURE_3D, had)
    return
  }
  if (lutTexs.size >= LUT_TEX_MAX) {
    const oldest = lutTexs.keys().next().value as string
    g.deleteTexture(lutTexs.get(oldest)!)
    lutTexs.delete(oldest)
  }
  const tex = g.createTexture()!
  g.bindTexture(g.TEXTURE_3D, tex)
  g.texParameteri(g.TEXTURE_3D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
  g.texParameteri(g.TEXTURE_3D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
  g.texParameteri(g.TEXTURE_3D, g.TEXTURE_WRAP_R, g.CLAMP_TO_EDGE)
  // Read entry by entry (texelFetch): the interpolation is the shader's own,
  // the same arithmetic as the CPU's.
  g.texParameteri(g.TEXTURE_3D, g.TEXTURE_MIN_FILTER, g.NEAREST)
  g.texParameteri(g.TEXTURE_3D, g.TEXTURE_MAG_FILTER, g.NEAREST)
  // The table is already in its order; the flip flag is for pictures (and a
  // 3D upload refuses it).
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false)
  g.texImage3D(g.TEXTURE_3D, 0, g.RGB32F, lut.n, lut.n, lut.n, 0, g.RGB, g.FLOAT, lut.data)
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true)
  lutTexs.set(lut.id, tex)
}

/** A texture to draw into, of this size (made, or made again when the size changed). */
function target(g: WebGL2RenderingContext, name: string, w: number, h: number): Target {
  let t = targets[name]
  if (!t) {
    const tex = g.createTexture()!
    g.bindTexture(g.TEXTURE_2D, tex)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
    t = targets[name] = { tex, fbo: g.createFramebuffer()!, w: 0, h: 0 }
  }
  if (t.w !== w || t.h !== h) {
    g.bindTexture(g.TEXTURE_2D, t.tex)
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null)
    g.bindFramebuffer(g.FRAMEBUFFER, t.fbo)
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t.tex, 0)
    t.w = w
    t.h = h
  }
  return t
}

/** The bright parts of `from` blurred into the buffer `name` (through `tmp`). */
function brightBlurGL(g: WebGL2RenderingContext, from: Target, name: string, threshold: number, radius: number): Target {
  const { bw, bh, rb } = blurBufferSize(from.w, from.h, radius)
  const tmp = target(g, 'tmp:' + name, bw, bh)
  const out = target(g, name, bw, bh)
  g.viewport(0, 0, bw, bh)
  g.activeTexture(g.TEXTURE0)
  // Bright pass: the first pass's picture → out.
  g.useProgram(bright!.program)
  g.bindFramebuffer(g.FRAMEBUFFER, out.fbo)
  g.bindTexture(g.TEXTURE_2D, from.tex)
  g.uniform2f(bright!.uni.u_src, from.w, from.h)
  g.uniform2f(bright!.uni.u_dst, bw, bh)
  g.uniform1f(bright!.uni.u_threshold, threshold)
  g.drawArrays(g.TRIANGLES, 0, 3)
  // Across: out → tmp. Down: tmp → out.
  g.useProgram(blur!.program)
  g.uniform2f(blur!.uni.u_dst, bw, bh)
  const step = rb / BLUR_TAPS
  g.bindFramebuffer(g.FRAMEBUFFER, tmp.fbo)
  g.bindTexture(g.TEXTURE_2D, out.tex)
  g.uniform2f(blur!.uni.u_step, step, 0)
  g.drawArrays(g.TRIANGLES, 0, 3)
  g.bindFramebuffer(g.FRAMEBUFFER, out.fbo)
  g.bindTexture(g.TEXTURE_2D, tmp.tex)
  g.uniform2f(blur!.uni.u_step, 0, step)
  g.drawArrays(g.TRIANGLES, 0, 3)
  return out
}

/**
 * Runs the effect chain on the GPU and returns the canvas holding the result,
 * or null if WebGL2 is not usable (caller should fall back to the CPU path).
 */
export function applyPixelFxGL(
  src: CanvasImageSource,
  pw: number,
  ph: number,
  p: FxParams,
  /** Read the source with linear filtering (the preview, when it works
   *  smaller than the source). Point sampling there dropped whole rows and
   *  columns and shifted the picture by half a source pixel, so pointing at
   *  a LUT made a still look as if it moved (DENEME-1, P5). A final frame
   *  keeps point sampling: the export's pixels do not change. */
  smooth = false
): HTMLCanvasElement | null {
  if (!init() || !gl || !canvas || !main) return null
  const g = gl
  const uni = main.uni
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  // Glow and halation read the first pass's picture: it is drawn into a
  // texture then, and the last pass lays them on. Without them: one pass
  // straight onto the canvas, as before.
  const lit = hasLightPass(p)
  const first = lit ? target(g, 'main', pw, ph) : null
  g.useProgram(main.program)
  g.bindFramebuffer(g.FRAMEBUFFER, first ? first.fbo : null)
  g.viewport(0, 0, pw, ph)

  g.activeTexture(g.TEXTURE0)
  g.bindTexture(g.TEXTURE_2D, srcTex)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, smooth ? g.LINEAR : g.NEAREST)
  try {
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src as TexImageSource)
  } catch {
    // Frame not decodable yet (e.g. a video with no current frame).
    g.bindFramebuffer(g.FRAMEBUFFER, null)
    return null
  }

  if (p.lut) {
    bindLut(g, p.lut)
    g.activeTexture(g.TEXTURE0)
  }

  g.uniform2f(uni.u_res, pw, ph)
  g.uniform1i(uni.u_fx, p.fx ?? 0)
  g.uniform1f(uni.u_fxAmt, p.fxAmount ?? 0)
  const keyer = !!p.chroma && p.chroma.mode === 1
  g.uniform1i(uni.u_chromaOn, p.chroma ? (keyer ? 2 : 1) : 0)
  if (p.chroma) {
    g.uniform3f(uni.u_key, p.chroma.key[0], p.chroma.key[1], p.chroma.key[2])
    g.uniform1f(uni.u_sim, p.chroma.sim)
    g.uniform1f(uni.u_smooth, p.chroma.smooth)
    if (keyer) {
      const [kcb, kcr] = cbcr(p.chroma.key[0] / 255, p.chroma.key[1] / 255, p.chroma.key[2] / 255)
      const dir = chromaDir(p.chroma.key)
      g.uniform2f(uni.u_keyC, kcb, kcr)
      g.uniform2f(uni.u_keyDir, dir[0], dir[1])
      // (A grey key has no direction: nothing to take off.)
      g.uniform1f(uni.u_spill, dir[0] === 0 && dir[1] === 0 ? 0 : (p.chroma.spill ?? 0))
    }
  }
  g.uniform1i(uni.u_lutOn, p.lut ? 1 : 0)
  g.uniform1f(uni.u_lutN, p.lut?.n ?? 2)
  g.uniform1f(uni.u_lutAmt, p.lutAmount ?? 1)
  const grade = gradeIsNeutral(p.grade) ? null : p.grade!
  g.uniform1i(uni.u_gradeOn, grade ? 1 : 0)
  if (grade) g.uniform4f(uni.u_grade, grade.exposure, grade.tint, grade.highlights, grade.shadows)
  g.uniform1i(uni.u_duoOn, p.duotone ? 1 : 0)
  if (p.duotone) {
    g.uniform3f(uni.u_duoDark, p.duotone.dark[0], p.duotone.dark[1], p.duotone.dark[2])
    g.uniform3f(uni.u_duoLight, p.duotone.light[0], p.duotone.light[1], p.duotone.light[2])
  }
  g.uniform1f(uni.u_sharpen, p.sharpen)
  g.uniform1f(uni.u_vig, p.vignette)
  g.uniform1f(uni.u_grain, p.grain)
  g.uniform1f(uni.u_cab, p.cab)
  g.uniform1f(uni.u_time, p.time)
  g.uniform1f(uni.u_mosaic, p.mosaic ?? 0)
  const iso = p.isolate && p.isolate.amount > 0.001 ? p.isolate : null
  g.uniform1i(uni.u_isoOn, iso ? 1 : 0)
  if (iso) {
    const dir = chromaDir(iso.key)
    g.uniform2f(uni.u_isoDir, dir[0], dir[1])
    g.uniform1f(uni.u_isoRange, iso.range)
    g.uniform1f(uni.u_isoAmt, iso.amount)
  }

  g.clearColor(0, 0, 0, 0)
  g.clear(g.COLOR_BUFFER_BIT)
  g.drawArrays(g.TRIANGLES, 0, 3)

  if (first) {
    const glow = p.bloom && p.bloom.amount > 0.001 ? brightBlurGL(g, first, 'glow', p.bloom.threshold, p.bloom.radius) : null
    const hal = p.halation && p.halation.amount > 0.001 ? brightBlurGL(g, first, 'hal', HALATION_THRESHOLD, p.halation.radius) : null
    g.useProgram(light!.program)
    g.bindFramebuffer(g.FRAMEBUFFER, null)
    g.viewport(0, 0, pw, ph)
    g.activeTexture(g.TEXTURE2)
    g.bindTexture(g.TEXTURE_2D, glow ? glow.tex : null)
    g.activeTexture(g.TEXTURE3)
    g.bindTexture(g.TEXTURE_2D, hal ? hal.tex : null)
    g.activeTexture(g.TEXTURE0)
    g.bindTexture(g.TEXTURE_2D, first.tex)
    g.uniform1i(light!.uni.u_glowOn, glow ? 1 : 0)
    g.uniform1i(light!.uni.u_halOn, hal ? 1 : 0)
    g.uniform1f(light!.uni.u_glowAmt, p.bloom?.amount ?? 0)
    g.uniform1f(light!.uni.u_halAmt, p.halation?.amount ?? 0)
    g.clear(g.COLOR_BUFFER_BIT)
    g.drawArrays(g.TRIANGLES, 0, 3)
  }
  // Lost while drawing: what it holds is nothing. The CPU path draws this one.
  if (g.isContextLost()) {
    lost()
    return null
  }
  gpuFrames++
  return canvas
}
