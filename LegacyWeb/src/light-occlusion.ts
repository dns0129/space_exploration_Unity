/** Fraction of a finite stellar disk visible behind a circular occluder.
 * Angular radii and separation use radians; partial eclipses remain continuous.
 */
export function stellarDiskVisibility(sourceRadius: number, blockerRadius: number, separation: number) {
  const r = Math.max(sourceRadius, 1e-9), R = Math.max(blockerRadius, 0), d = Math.max(separation, 0);
  if (d >= r + R) return 1;
  if (d <= Math.abs(R - r)) return R >= r ? 0 : 1 - R * R / (r * r);
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const sourceArc = Math.acos(clamp((d * d + r * r - R * R) / (2 * d * r)));
  const blockerArc = Math.acos(clamp((d * d + R * R - r * r) / (2 * d * R)));
  const triangle = Math.sqrt(Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)));
  const overlap = r * r * sourceArc + R * R * blockerArc - triangle * 0.5;
  return Math.max(0, Math.min(1, 1 - overlap / (Math.PI * r * r)));
}
