// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/** Resize a uniformly-scaled clip from a corner while its opposite corner
 * stays fixed. The pointer offset at the initial press is preserved, so a
 * generous hit target never makes the picture jump on the first move. */
export function scaleClipFromCorner(
  start: { x: number; y: number; scale: number; rotation: number },
  halfWidth: number,
  halfHeight: number,
  cornerX: -1 | 1,
  cornerY: -1 | 1,
  pointerStart: { x: number; y: number },
  pointerNow: { x: number; y: number }
): { x: number; y: number; scale: number } {
  const cos = Math.cos(start.rotation)
  const sin = Math.sin(start.rotation)
  const rx = cornerX * halfWidth * cos - cornerY * halfHeight * sin
  const ry = cornerX * halfWidth * sin + cornerY * halfHeight * cos
  const anchorX = start.x - rx
  const anchorY = start.y - ry
  const desiredX = start.x + rx + pointerNow.x - pointerStart.x - anchorX
  const desiredY = start.y + ry + pointerNow.y - pointerStart.y - anchorY
  const diagonalX = 2 * rx
  const diagonalY = 2 * ry
  const factor = Math.max(0.02 / Math.max(start.scale, 1e-6),
    (desiredX * diagonalX + desiredY * diagonalY) / Math.max(1e-6, diagonalX ** 2 + diagonalY ** 2))
  return { x: anchorX + rx * factor, y: anchorY + ry * factor, scale: start.scale * factor }
}

/** The same pull, round the clip's middle (Alt): the middle stays where it
 * is and every corner moves with the one held. The pointer's offset at the
 * press is kept here too. */
export function scaleClipFromCentre(
  start: { x: number; y: number; scale: number; rotation: number },
  halfWidth: number,
  halfHeight: number,
  cornerX: -1 | 1,
  cornerY: -1 | 1,
  pointerStart: { x: number; y: number },
  pointerNow: { x: number; y: number }
): { x: number; y: number; scale: number } {
  const cos = Math.cos(start.rotation)
  const sin = Math.sin(start.rotation)
  const rx = cornerX * halfWidth * cos - cornerY * halfHeight * sin
  const ry = cornerX * halfWidth * sin + cornerY * halfHeight * cos
  const desiredX = rx + pointerNow.x - pointerStart.x
  const desiredY = ry + pointerNow.y - pointerStart.y
  const factor = Math.max(0.02 / Math.max(start.scale, 1e-6),
    (desiredX * rx + desiredY * ry) / Math.max(1e-6, rx ** 2 + ry ** 2))
  return { x: start.x, y: start.y, scale: start.scale * factor }
}
