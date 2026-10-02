// Presentation colours for rhyme families.
//
// The analysis data identifies families by stable id (family-1, family-2, …);
// colour is only presentation, assigned here in a fixed order so the same text
// always renders with the same colours, and a re-render never reshuffles them.
// Every pair is a light background with the same dark text (contrast well
// above WCAG AA). The palette is finite: colours are reused with a different
// family label and examples, which the legend always shows alongside colour.

export const FAMILY_PALETTE = [
  { background: "#FDE68A", text: "#111827" }, // amber
  { background: "#BAE6FD", text: "#111827" }, // sky
  { background: "#FECDD3", text: "#111827" }, // rose
  { background: "#DDD6FE", text: "#111827" }, // violet
  { background: "#99F6E4", text: "#111827" }, // teal
  { background: "#FED7AA", text: "#111827" }, // orange
  { background: "#D9F99D", text: "#111827" }, // lime
  { background: "#F5D0FE", text: "#111827" }, // fuchsia
  { background: "#A5F3FC", text: "#111827" }, // cyan
  { background: "#A7F3D0", text: "#111827" }, // emerald
  { background: "#FECACA", text: "#111827" }, // red
  { background: "#C7D2FE", text: "#111827" }, // indigo
  { background: "#FEF08A", text: "#111827" }, // yellow
  { background: "#E9D5FF", text: "#111827" }, // purple
];

// familyId -> palette entry, in the order the analysis reported the families.
export function assignFamilyColors(families) {
  const colors = new Map();
  families.forEach((family, index) => {
    colors.set(family.id, FAMILY_PALETTE[index % FAMILY_PALETTE.length]);
  });
  return colors;
}
