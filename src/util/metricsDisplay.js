// Shared metric display definitions — used by the per-song Writing patterns
// panel, the section navigator, and the artist-level summary. One definition
// keeps the labels and explanations consistent everywhere a number appears.
export const formatPercent = (value) => (value == null ? "—" : `${Math.round(value * 100)}%`);
export const formatCount = (value) => (value == null ? "—" : String(value));
export const formatSpacing = (value) => (value == null ? "—" : `${value.toFixed(1)} words`);

export const METRICS = [
  {
    key: "rhymeDensity",
    label: "Rhyme density",
    format: formatPercent,
    description: "Share of word occurrences belonging to a rhyme family",
  },
  {
    key: "internalRhymeCount",
    label: "Internal rhymes",
    format: formatCount,
    description: "Rhyming words inside lines",
  },
  {
    key: "lineEndRhymeCount",
    label: "Line-end rhymes",
    format: formatCount,
    description: "Rhyming words at line ends",
  },
  {
    key: "avgRhymeSpacing",
    label: "Avg. rhyme spacing",
    format: formatSpacing,
    description: "Mean distance between consecutive occurrences of the same family",
  },
  {
    key: "recurringFamilyShare",
    label: "Recurring families",
    format: formatPercent,
    description: "Families that appear on two or more lines",
  },
  {
    key: "repetitionRate",
    label: "Repeated words",
    format: formatPercent,
    description: "Occurrences that repeat an earlier word (choruses, hooks)",
  },
];
