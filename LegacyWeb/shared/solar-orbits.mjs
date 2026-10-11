/** Static circular orbit schematic: the ecliptic is XZ, north is +Y.
 * Longitude increases from +X towards +Z; angles are in degrees.
 * The argument is measured in the orbit plane from its ascending node.
 */
export function orbitPosition(radius, longitudeDeg, inclinationDeg, ascendingNodeDeg) {
  const radians = Math.PI / 180;
  const node = ascendingNodeDeg * radians;
  const argument = (longitudeDeg - ascendingNodeDeg) * radians;
  const inclination = inclinationDeg * radians;
  const x = radius * Math.cos(argument);
  const z = radius * Math.sin(argument);
  return [
    Math.cos(node) * x - Math.sin(node) * Math.cos(inclination) * z,
    Math.sin(inclination) * z,
    Math.sin(node) * x + Math.cos(node) * Math.cos(inclination) * z,
  ];
}
