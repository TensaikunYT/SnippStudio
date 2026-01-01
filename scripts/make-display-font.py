# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 SnippStudio contributors
"""Builds Snipp Display: a heavy, wide, geometric all-caps face with softly
rounded corners — the big-number, big-word type of explainer videos.

Every glyph is drawn here from a few shapes (straight strokes, stacked
ellipse rings, parts of rings), unioned, and its corners rounded a little.
No outside font is used or copied.

    python scripts/make-display-font.py

writes src/renderer/src/assets/fonts/SnippDisplay.ttf (and, with
--proof=<png>, a proof sheet there).
"""

import math
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

UPM = 1000
CAP = 720
S = 194  # vertical stems
H = 158  # horizontal bars
OV = 12  # round shapes reach a little past the flat ones
SB = 38  # side bearing
ROUND = 15  # how soft the corners are

FLAT = 2  # shapely cap/join styles
MITRE = 2


def rect(x0, y0, x1, y1):
    return box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def ellipse(cx, cy, rx, ry):
    return affinity.translate(affinity.scale(Point(0, 0).buffer(1, resolution=96), rx, ry, origin=(0, 0)), cx, cy)


def ring(cx, cy, rx, ry, tx=S, ty=H):
    return ellipse(cx, cy, rx, ry).difference(ellipse(cx, cy, rx - tx, ry - ty))


def sector(cx, cy, a0, a1, r=3000):
    """The wedge from angle a0 to a1 (degrees, counter-clockwise, 0 = right)."""
    if a1 < a0:
        a1 += 360
    pts = [(cx, cy)]
    n = max(2, int((a1 - a0) / 3))
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return Polygon(pts)


def arc(cx, cy, rx, ry, a0, a1, tx=S, ty=H):
    return ring(cx, cy, rx, ry, tx, ty).intersection(sector(cx, cy, a0, a1))


def stroke(pts, w=S * 0.96):
    return LineString(pts).buffer(w / 2, cap_style=FLAT, join_style=MITRE, mitre_limit=6)


def within(g, lo=0, hi=CAP):
    return g.intersection(box(-2000, lo, 4000, hi))


def U(*gs):
    return unary_union([g for g in gs if g is not None and not g.is_empty])


def soften(g):
    g = g.buffer(0)
    g = g.buffer(-ROUND, join_style=1).buffer(ROUND, join_style=1)
    return g.buffer(6, join_style=1).buffer(-6, join_style=1)


# -- the glyphs -------------------------------------------------------------------
# Each returns (shape, width); the shape spans x 0..width (bearings added later).

G = {}


def glyph(*names):
    def deco(fn):
        for n in names:
            G[n] = fn
        return fn

    return deco


MID = CAP * 0.5


@glyph('A')
def g_A():
    # A flat top, two legs of one width, a bar low down; the counter and
    # the gap between the legs cut out along the legs' inner edges.
    w = 760
    top = S * 1.2
    leg = S * 1.3
    k = (w / 2 - top / 2) / CAP
    outer = Polygon([(0, 0), (w / 2 - top / 2, CAP), (w / 2 + top / 2, CAP), (w, 0)])
    apex_y = (w - 2 * leg) / (2 * k)
    inner = Polygon([(leg - k * 200, -200), (w - leg + k * 200, -200), (w / 2, apex_y)])
    bar0 = CAP * 0.2
    bar1 = bar0 + H * 0.95
    cut = U(inner.intersection(rect(-10, bar1, w + 10, CAP)), inner.intersection(rect(-10, -300, w + 10, bar0)))
    return outer.difference(cut), w


@glyph('B')
def g_B():
    w = 610
    ry1 = (CAP * 0.46 + H * 0.5) / 2
    ry2 = (CAP * 0.54 + H * 0.5) / 2
    top = CAP - ry1
    bot = ry2
    rx1, rx2 = ry1 * 1.02, ry2 * 1.02
    outer = U(rect(0, 0, w - rx2, CAP * 0.5), rect(0, CAP * 0.5, w - rx1 - 20, CAP),
              ellipse(w - rx1 - 20, top, rx1, ry1).intersection(rect(w - rx1 - 20, 0, w, CAP)),
              ellipse(w - rx2, bot, rx2, ry2).intersection(rect(w - rx2, 0, w, CAP)))
    inner = U(rect(S, H, w - rx2, CAP * 0.5 - H * 0.45), ellipse(w - rx2, bot, rx2 - S, ry2 - H).intersection(rect(w - rx2, 0, w, CAP)),
              rect(S, CAP * 0.5 + H * 0.45, w - rx1 - 20, CAP - H), ellipse(w - rx1 - 20, top, rx1 - S, ry1 - H).intersection(rect(w - rx1 - 20, 0, w, CAP)))
    return outer.difference(inner), w


def bowl_c(w, cut=38, top_cut=None):
    cx, cy = w / 2, CAP / 2
    r = ring(cx, cy, w / 2, CAP / 2 + OV, S * 1.02, H)
    hi = top_cut if top_cut is not None else cut
    return r.difference(sector(cx, cy, -cut, hi)), cx, cy


@glyph('C')
def g_C():
    w = 700
    g, _, _ = bowl_c(w, 36)
    return g, w


@glyph('D')
def g_D():
    w = 680
    ry = CAP / 2
    rx = ry * 0.98
    outer = U(rect(0, 0, w - rx, CAP), ellipse(w - rx, ry, rx, ry + 2).intersection(rect(w - rx, -50, w + 50, CAP + 50)))
    inner = U(rect(S, H, w - rx, CAP - H), ellipse(w - rx, ry, rx - S * 1.02, ry - H).intersection(rect(w - rx, -50, w + 50, CAP + 50)))
    return within(outer).difference(inner), w


@glyph('E')
def g_E():
    w = 540
    return U(rect(0, 0, S, CAP), rect(0, CAP - H, w, CAP), rect(0, MID - H / 2, w * 0.9, MID + H / 2), rect(0, 0, w, H)), w


@glyph('F')
def g_F():
    w = 520
    return U(rect(0, 0, S, CAP), rect(0, CAP - H, w, CAP), rect(0, MID - H / 2 - 20, w * 0.9, MID + H / 2 - 20)), w


@glyph('G')
def g_G():
    w = 720
    cx, cy = w / 2, CAP / 2
    r = ring(cx, cy, w / 2, CAP / 2 + OV, S * 1.02, H).difference(sector(cx, cy, -2, 34))
    spur = U(rect(w * 0.5, CAP * 0.36, w, CAP * 0.36 + H * 0.95), rect(w - S * 1.02, 0, w, CAP * 0.36 + H * 0.95)).intersection(ellipse(cx, cy, w / 2, CAP / 2 + OV))
    return U(r, spur), w


@glyph('H')
def g_H():
    w = 640
    return U(rect(0, 0, S, CAP), rect(w - S, 0, w, CAP), rect(0, MID - H / 2, w, MID + H / 2)), w


@glyph('I')
def g_I():
    return rect(0, 0, S, CAP), S


@glyph('J')
def g_J():
    w = 560
    rx = w / 2
    ry = rx * 0.95
    hook = arc(rx, ry, rx, ry + OV, 180, 360, S * 1.02, H)
    hook = hook.difference(rect(-10, ry * 0.62, S + 10, 2000))
    return U(rect(w - S * 1.02, ry, w, CAP), hook), w


@glyph('K')
def g_K():
    w = 660
    stem = rect(0, 0, S, CAP)
    up = within(stroke([(S * 0.6, CAP * 0.25), (w + 60, CAP + 120)], S * 1.02))
    down = within(stroke([(S * 1.25 + 40, CAP * 0.56), (w + 40, -150)], S * 1.02))
    return U(stem, up, down).intersection(rect(0, 0, w, CAP)), w


@glyph('L')
def g_L():
    w = 500
    return U(rect(0, 0, S, CAP), rect(0, 0, w, H)), w


@glyph('M')
def g_M():
    w = 820
    v = within(stroke([(S * 0.5, CAP + 150), (w / 2, CAP * 0.1), (w - S * 0.5, CAP + 150)], S * 0.98), CAP * 0.1 - 400, CAP)
    return U(rect(0, 0, S, CAP), rect(w - S, 0, w, CAP), v).intersection(rect(0, 0, w, CAP)), w


@glyph('N')
def g_N():
    w = 660
    diag = Polygon([(0, CAP), (S * 1.3, CAP), (w, 0), (w - S * 1.3, 0)])
    return U(rect(0, 0, S, CAP), rect(w - S, 0, w, CAP), diag), w


@glyph('O')
def g_O():
    w = 760
    return ring(w / 2, CAP / 2, w / 2, CAP / 2 + OV, S * 1.04, H), w


def bowl_top(w, y0):
    """P and R: a bowl from y0 up to the cap on a stem."""
    ry = (CAP - y0) / 2
    rx = ry * 1.02
    cy = y0 + ry
    outer = U(rect(0, 0, w - rx, CAP), ellipse(w - rx, cy, rx, ry).intersection(rect(w - rx, y0, w + 10, CAP)))
    inner = U(rect(S, y0 + H, w - rx, CAP - H), ellipse(w - rx, cy, rx - S, ry - H).intersection(rect(w - rx, y0, w + 10, CAP)))
    return outer.difference(inner).difference(rect(S, -10, w + 10, y0))


@glyph('P')
def g_P():
    w = 620
    return bowl_top(w, CAP * 0.3), w


@glyph('Q')
def g_Q():
    w = 760
    o = ring(w / 2, CAP / 2, w / 2, CAP / 2 + OV, S * 1.04, H)
    tail = within(stroke([(w * 0.56, CAP * 0.3), (w * 0.98, -60)], S * 0.9), -40, CAP)
    return U(o, tail), w


@glyph('R')
def g_R():
    w = 640
    b = bowl_top(w - 20, CAP * 0.33)
    leg = within(stroke([(w * 0.42, CAP * 0.4), (w + 30, -150)], S * 1.02))
    return U(b, leg).intersection(rect(0, 0, w, CAP)), w


def stacked(w, top_keep, bot_keep, top_w=None):
    """Two rings one on the other (S, 3, 8…), each kept over an angle range."""
    ry = (CAP + H) / 4 + OV / 2
    tw = top_w or w
    t = arc(w / 2, CAP + OV - ry, tw / 2, ry, top_keep[0], top_keep[1], S * 1.0, H) if top_keep else ring(w / 2, CAP + OV - ry, tw / 2, ry, S * 1.0, H)
    b = arc(w / 2, ry - OV, w / 2, ry, bot_keep[0], bot_keep[1], S * 1.02, H) if bot_keep else ring(w / 2, ry - OV, w / 2, ry, S * 1.02, H)
    return U(t, b)


@glyph('S')
def g_S():
    w = 640
    return stacked(w, (28, 270), (-152, 90)), w


@glyph('T')
def g_T():
    w = 620
    return U(rect(0, CAP - H, w, CAP), rect(w / 2 - S / 2, 0, w / 2 + S / 2, CAP)), w


@glyph('U')
def g_U():
    w = 660
    rx = w / 2
    ry = rx * 0.92
    bottom = arc(rx, ry, rx, ry + OV, 180, 360, S, H)
    return U(rect(0, ry, S, CAP), rect(w - S, ry, w, CAP), bottom), w


@glyph('V')
def g_V():
    w = 720
    return within(stroke([(S * 0.5, CAP + 200), (w / 2, -130), (w - S * 0.5, CAP + 200)], S * 1.0)).intersection(rect(0, 0, w, CAP)), w


@glyph('W')
def g_W():
    w = 1040
    return within(stroke([(S * 0.45, CAP + 200), (w * 0.28, -120), (w / 2, CAP + 110), (w * 0.72, -120), (w - S * 0.45, CAP + 200)], S * 0.95)).intersection(rect(0, 0, w, CAP)), w


@glyph('X')
def g_X():
    w = 690
    a = stroke([(-40, CAP + 160), (w + 40, -160)], S * 1.02)
    b = stroke([(w + 40, CAP + 160), (-40, -160)], S * 1.02)
    return within(U(a, b)).intersection(rect(0, 0, w, CAP)), w


@glyph('Y')
def g_Y():
    w = 690
    v = stroke([(S * 0.35, CAP + 200), (w / 2, CAP * 0.36), (w - S * 0.35, CAP + 200)], S * 1.0)
    return within(U(v.intersection(rect(0, CAP * 0.3, w, CAP)), rect(w / 2 - S / 2, 0, w / 2 + S / 2, CAP * 0.42))).intersection(rect(0, 0, w, CAP)), w


@glyph('Z')
def g_Z():
    w = 600
    diag = Polygon([(w - S * 1.35, CAP - H), (w, CAP - H), (S * 1.35, H), (0, H)])
    return U(rect(0, CAP - H, w, CAP), rect(0, 0, w, H), diag), w


# -- digits ------------------------------------------------------------------------


@glyph('zero')
def g_0():
    w = 640
    return ring(w / 2, CAP / 2, w / 2, CAP / 2 + OV, S * 1.02, H), w


@glyph('one')
def g_1():
    w = 430
    stem = rect(w - S, 0, w, CAP)
    flag = Polygon([(w - S + 5, CAP), (w - S + 5, CAP - H * 1.55), (0, CAP * 0.62 - H * 0.2), (0, CAP * 0.62 + H * 0.85)])
    return U(stem, flag.intersection(rect(0, 0, w, CAP))), w


@glyph('two')
def g_2():
    w = 620
    ry = CAP * 0.29 + OV
    cy = CAP + OV - ry
    top = arc(w / 2, cy, w / 2, ry, -40, 165, S * 1.0, H)
    diag = within(stroke([(w * 0.86, cy - ry * 0.38), (S * 0.3, H * 0.4)], S * 1.0), 0, cy)
    return U(top, diag, rect(0, 0, w, H)).intersection(rect(0, 0, w, CAP + OV)), w


@glyph('three')
def g_3():
    w = 620
    return stacked(w, (-90, 152), (-152, 90), top_w=w * 0.94), w


@glyph('four')
def g_4():
    w = 670
    stem = rect(w * 0.6, 0, w * 0.6 + S, CAP)
    diag = Polygon([(w * 0.6 + S, CAP), (w * 0.6 - S * 0.75, CAP), (0, CAP * 0.27 + H * 0.2), (S * 1.45, CAP * 0.27 + H * 0.2)])
    bar = rect(0, CAP * 0.2, w, CAP * 0.2 + H)
    return U(stem, diag.intersection(rect(0, CAP * 0.2, w, CAP)), bar), w


@glyph('five')
def g_5():
    w = 620
    ry = CAP * 0.33 + OV
    cy = ry - OV
    bowl = arc(w / 2, cy, w / 2, ry, -150, 118, S * 1.02, H)
    stem = Polygon([(S * 0.1, CAP), (S * 1.05, CAP), (S * 1.1 + 10, cy + ry * 0.55), (S * 0.12, cy + ry * 0.35)])
    return U(bowl, stem, rect(S * 0.1, CAP - H, w * 0.94, CAP)).intersection(rect(0, -OV, w, CAP)), w


@glyph('six')
def g_6():
    w = 640
    ry = CAP * 0.33 + OV
    cy = ry - OV
    bowl = ring(w / 2, cy, w / 2, ry, S * 1.02, H)
    big = arc(w / 2 + w * 0.08, CAP / 2 - 30, w / 2 + w * 0.08, CAP / 2 + OV + 30, 62, 185, S * 1.02, H)
    return U(bowl, big).intersection(rect(0, -OV, w, CAP + OV)), w


@glyph('seven')
def g_7():
    w = 600
    diag = Polygon([(w, CAP - H * 0.6), (w - S * 1.25, CAP - H * 0.6), (S * 0.35, 0), (S * 1.65, 0)])
    return U(rect(0, CAP - H, w, CAP), diag).intersection(rect(0, 0, w, CAP)), w


@glyph('eight')
def g_8():
    w = 640
    return stacked(w, None, None, top_w=w * 0.92), w


@glyph('nine')
def g_9():
    s, w = g_6()
    return affinity.rotate(s, 180, origin=(w / 2, CAP / 2)), w


# -- marks and signs -------------------------------------------------------------------

DOT = S * 0.98


def dot(x, y):
    return rect(x, y, x + DOT, y + DOT)


@glyph('period')
def g_period():
    return dot(0, 0), DOT


@glyph('comma')
def g_comma():
    tail = Polygon([(DOT * 0.25, 0), (DOT, 0), (DOT * 0.55, -DOT * 0.75), (0, -DOT * 0.75)])
    return U(dot(0, 0), tail), DOT


@glyph('colon')
def g_colon():
    return U(dot(0, 0), dot(0, CAP * 0.62)), DOT


@glyph('semicolon')
def g_semicolon():
    c, w = g_comma()
    return U(c, dot(0, CAP * 0.62)), w


@glyph('exclam')
def g_exclam():
    bar = Polygon([(0, CAP), (DOT, CAP), (DOT * 0.86, DOT + 60), (DOT * 0.14, DOT + 60)])
    return U(bar, dot(0, 0)), DOT


@glyph('question')
def g_question():
    w = 580
    ry = CAP * 0.28 + OV
    cy = CAP + OV - ry
    top = arc(w / 2, cy, w / 2, ry, -80, 165, S * 0.98, H)
    stem = rect(w / 2 - DOT / 2, DOT + 60, w / 2 + DOT / 2, cy - ry + H * 0.8)
    return U(top, stem, dot(w / 2 - DOT / 2, 0)).intersection(rect(0, 0, w, CAP + OV)), w


@glyph('hyphen')
def g_hyphen():
    return rect(0, MID - H / 2 - 20, 380, MID + H / 2 - 20), 380


@glyph('endash')
def g_endash():
    return rect(0, MID - H / 2 - 20, 560, MID + H / 2 - 20), 560


@glyph('quotesingle', 'quoteright', 'quoteleft')
def g_quote():
    return Polygon([(0, CAP + 20), (DOT * 0.9, CAP + 20), (DOT * 0.75, CAP * 0.58), (DOT * 0.15, CAP * 0.58)]), DOT * 0.9


@glyph('quotedbl', 'quotedblleft', 'quotedblright')
def g_quotedbl():
    q, w = g_quote()
    return U(q, affinity.translate(q, w + 60)), w * 2 + 60


@glyph('parenleft')
def g_parenleft():
    w = 300
    return arc(w * 1.35, CAP / 2 - 20, w * 1.35, CAP * 0.66, 118, 242, S * 0.92, H).intersection(rect(0, -300, w, 1200)), w


@glyph('parenright')
def g_parenright():
    s, w = g_parenleft()
    return affinity.scale(s, -1, 1, origin=(w / 2, 0)), w


@glyph('slash')
def g_slash():
    w = 420
    return within(stroke([(0, -60), (w, CAP + 60)], S * 0.86), -60, CAP + 60).intersection(rect(0, -60, w, CAP + 60)), w


@glyph('percent')
def g_percent():
    w = 860
    a = ring(160, CAP - 170, 160, 170, S * 0.72, H * 0.72)
    b = ring(w - 160, 170, 160, 170, S * 0.72, H * 0.72)
    sl = within(stroke([(w * 0.22, -20), (w * 0.78, CAP + 20)], S * 0.72))
    return U(a, b, sl), w


@glyph('plus')
def g_plus():
    w = 560
    return U(rect(0, MID - H / 2 - 20, w, MID + H / 2 - 20), rect(w / 2 - S * 0.47, MID - 20 - w / 2, w / 2 + S * 0.47, MID - 20 + w / 2)), w


@glyph('equal')
def g_equal():
    w = 560
    return U(rect(0, MID + 30, w, MID + 30 + H * 0.85), rect(0, MID - 70 - H * 0.85, w, MID - 70)), w


@glyph('numbersign')
def g_hash():
    w = 700
    v1 = Polygon([(w * 0.2, 0), (w * 0.2 + S * 0.8, 0), (w * 0.42 + S * 0.8, CAP), (w * 0.42, CAP)])
    v2 = affinity.translate(v1, w * 0.36)
    h1 = rect(0, CAP * 0.62, w, CAP * 0.62 + H * 0.8)
    h2 = rect(0, CAP * 0.25, w, CAP * 0.25 + H * 0.8)
    return U(v1, v2, h1, h2).intersection(rect(0, 0, w, CAP)), w


@glyph('dollar')
def g_dollar():
    s, w = g_S()
    return U(s, rect(w / 2 - S * 0.3, -110, w / 2 + S * 0.3, CAP + 110)), w


@glyph('asterisk')
def g_asterisk():
    w = 440
    arms = [stroke([(w / 2, CAP * 0.72), (w / 2 + math.cos(math.radians(a)) * 230, CAP * 0.72 + math.sin(math.radians(a)) * 230)], S * 0.62) for a in (90, 90 + 72, 90 + 144, 90 + 216, 90 + 288)]
    return U(*arms), w


@glyph('euro')
def g_euro():
    c, w = g_C()
    bars = U(rect(-60, CAP * 0.52, w * 0.62, CAP * 0.52 + H * 0.7), rect(-60, CAP * 0.3, w * 0.58, CAP * 0.3 + H * 0.7))
    return U(affinity.translate(c, 60), bars.intersection(ellipse(w / 2 + 60, CAP / 2, w / 2 + 120, CAP))).intersection(rect(-60, -OV, w + 60, CAP + OV)), w + 60


# -- Turkish letters -------------------------------------------------------------------

ACC = CAP + 70


def with_dots(base, w, n=2):
    if n == 1:
        return U(base, dot(w / 2 - DOT / 2, ACC)), w
    gap = min(w * 0.18, 90)
    return U(base, dot(w / 2 - gap / 2 - DOT, ACC), dot(w / 2 + gap / 2, ACC)), w


def with_cedilla(base, w):
    hook = U(rect(w / 2 - S * 0.3, -110, w / 2 + S * 0.3, 10), arc(w / 2 + 20, -150, 90, 70, -120, 110, S * 0.55, H * 0.6))
    return U(base, hook), w


@glyph('Odieresis')
def g_Odi():
    return with_dots(*g_O())


@glyph('Udieresis')
def g_Udi():
    return with_dots(*g_U())


@glyph('Idotaccent')
def g_Idot():
    return with_dots(*g_I(), n=1)


@glyph('Ccedilla')
def g_Cced():
    return with_cedilla(*g_C())


@glyph('Scedilla')
def g_Sced():
    return with_cedilla(*g_S())


@glyph('Gbreve')
def g_Gbreve():
    s, w = g_G()
    br = arc(w / 2, ACC + 150, 190, 130, 190, 350, S * 0.62, H * 0.62).intersection(rect(0, ACC - 10, w, ACC + 200))
    return U(s, br), w


# -- the font --------------------------------------------------------------------------

UNI = {
    **{chr(c): chr(c) for c in range(ord('A'), ord('Z') + 1)},
    **{chr(c): chr(c - 32) for c in range(ord('a'), ord('z') + 1)},
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '.': 'period', ',': 'comma', ':': 'colon', ';': 'semicolon', '!': 'exclam', '?': 'question', '-': 'hyphen', '–': 'endash', '—': 'endash',
    "'": 'quotesingle', '’': 'quoteright', '‘': 'quoteleft', '"': 'quotedbl', '“': 'quotedblleft', '”': 'quotedblright',
    '(': 'parenleft', ')': 'parenright', '/': 'slash', '%': 'percent', '+': 'plus', '=': 'equal', '#': 'numbersign', '$': 'dollar', '*': 'asterisk', '€': 'euro',
    'Ö': 'Odieresis', 'ö': 'Odieresis', 'Ü': 'Udieresis', 'ü': 'Udieresis', 'İ': 'Idotaccent', 'ı': 'I', 'Ç': 'Ccedilla', 'ç': 'Ccedilla', 'Ş': 'Scedilla', 'ş': 'Scedilla', 'Ğ': 'Gbreve', 'ğ': 'Gbreve',
}


def to_glyph(shape, advance_inner):
    pen = TTGlyphPen(None)
    shape = soften(shape)
    polys = [shape] if isinstance(shape, Polygon) else list(getattr(shape, 'geoms', []))
    for p in polys:
        if not isinstance(p, Polygon) or p.is_empty or p.area < 50:
            continue
        p = orient(p.simplify(0.8), sign=-1.0)
        for ring_ in [p.exterior, *p.interiors]:
            pts = [(round(x + SB), round(y)) for x, y in ring_.coords[:-1]]
            clean = [pt for i, pt in enumerate(pts) if pt != pts[i - 1]]
            if len(clean) < 3:
                continue
            pen.moveTo(clean[0])
            for pt in clean[1:]:
                pen.lineTo(pt)
            pen.closePath()
    return pen.glyph(), round(advance_inner + SB * 2)


# Pairs that would otherwise gape: diagonals and overhangs against each other.
KERN = {
    ('A', 'V'): -70, ('A', 'W'): -50, ('A', 'Y'): -80, ('A', 'T'): -70, ('A', 'quoteright'): -60,
    ('V', 'A'): -70, ('W', 'A'): -50, ('Y', 'A'): -80, ('T', 'A'): -70,
    ('K', 'A'): -30, ('X', 'A'): -30, ('A', 'X'): -30,
    ('L', 'T'): -80, ('L', 'V'): -70, ('L', 'W'): -50, ('L', 'Y'): -85, ('L', 'quoteright'): -80,
    ('F', 'A'): -45, ('P', 'A'): -55, ('F', 'period'): -90, ('P', 'period'): -100, ('F', 'comma'): -90, ('P', 'comma'): -100,
    ('T', 'period'): -90, ('T', 'comma'): -90, ('V', 'period'): -90, ('V', 'comma'): -90, ('W', 'period'): -70, ('W', 'comma'): -70, ('Y', 'period'): -100, ('Y', 'comma'): -100,
    ('T', 'O'): -20, ('O', 'T'): -20, ('V', 'O'): -20, ('O', 'V'): -20, ('Y', 'O'): -30, ('O', 'Y'): -30, ('O', 'A'): -25, ('A', 'O'): -25,
    ('T', 'J'): -60, ('Y', 'J'): -60, ('one', 'one'): -40, ('seven', 'period'): -80, ('seven', 'four'): -50,
}


def kerning():
    lines = ['languagesystem DFLT dflt;', 'languagesystem latn dflt;', 'feature kern {']
    for (a, b), v in KERN.items():
        if a in G or a in ('space',):
            if b in G:
                lines.append(f'  pos {a} {b} {v};')
    # The Turkish letters kern as their bases do.
    same = {'Odieresis': 'O', 'Idotaccent': 'I', 'Ccedilla': 'C', 'Scedilla': 'S', 'Gbreve': 'G', 'Udieresis': 'U'}
    for acc, base in same.items():
        for (a, b), v in KERN.items():
            if a == base and b in G:
                lines.append(f'  pos {acc} {b} {v};')
            if b == base and a in G:
                lines.append(f'  pos {a} {acc} {v};')
    lines.append('} kern;')
    return chr(10).join(lines)


def build(path):
    order = ['.notdef', 'space']
    glyphs = {}
    metrics = {}
    empty = TTGlyphPen(None).glyph()
    nd = TTGlyphPen(None)
    for r in [[(60, 0), (60, CAP), (440, CAP), (440, 0)], [(120, 60), (380, 60), (380, CAP - 60), (120, CAP - 60)]]:
        nd.moveTo(r[0])
        for pt in r[1:]:
            nd.lineTo(pt)
        nd.closePath()
    glyphs['.notdef'] = nd.glyph()
    metrics['.notdef'] = (500, 60)
    glyphs['space'] = empty
    metrics['space'] = (260, 0)
    for name, fn in G.items():
        shape, w = fn()
        gl, adv = to_glyph(shape, w)
        glyphs[name] = gl
        order.append(name)
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    cmap = {ord(' '): 'space', 0xA0: 'space'}
    for ch, name in UNI.items():
        if name in G:
            cmap[ord(ch)] = name
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    glyf = fb.font['glyf']
    for name in order:
        if name in ('.notdef', 'space'):
            continue
        g = glyf[name]
        g.recalcBounds(glyf)
        _, w = G[name]()
        metrics[name] = (round(w + SB * 2), getattr(g, 'xMin', 0))
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=940, descent=-260)
    fb.setupNameTable({'familyName': 'Snipp Display', 'styleName': 'Regular', 'uniqueFontIdentifier': 'SnippDisplay-Regular', 'fullName': 'Snipp Display', 'psName': 'SnippDisplay-Regular', 'version': 'Version 1.000', 'copyright': 'Drawn in code for Snipp'})
    fb.setupOS2(sTypoAscender=940, sTypoDescender=-260, sTypoLineGap=0, usWinAscent=1000, usWinDescent=300, sCapHeight=CAP, sxHeight=CAP, usWeightClass=900, achVendID='SNPP', fsType=0)
    fb.setupPost()
    fb.addOpenTypeFeatures(kerning())
    fb.save(path)
    return order


if __name__ == '__main__':
    out = 'src/renderer/src/assets/fonts/SnippDisplay.ttf'
    order = build(out)
    print('glyphs', len(order), '->', out)
    proof = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--proof=')), None)
    if proof:
        from PIL import Image, ImageDraw, ImageFont

        f = ImageFont.truetype(out, 110)
        lines = ['300 81 TWENTY', 'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789 %$€', 'ÇĞİÖŞÜ .,:;!?-()"\'#+=*/', 'BİR GÜNDE 1.250 KİŞİ!']
        im = Image.new('RGB', (1800, 150 * len(lines) + 40), 'white')
        d = ImageDraw.Draw(im)
        for i, ln in enumerate(lines):
            d.text((30, 20 + i * 150), ln, font=f, fill='black')
        im.save(proof)
