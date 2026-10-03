import { formatPercent } from "../util/metricsDisplay";

// Section-level inspection: stanzas are the blank-line-separated blocks of the
// text (verses, choruses, bridges…). Selecting one scrolls it into view and
// dims the rest, and each row shows that section's own measurements so the
// pattern can be compared against the song-level numbers.
const SectionNavigator = ({ sections, selectedIndex, onSelect }) => {
  if (!sections || sections.length < 2) {
    return null;
  }
  return (
    <details className="sections">
      <summary>
        Sections
        <span className="patterns__sample">{sections.length} stanzas in this text</span>
      </summary>
      <ul className="sections__list">
        {sections.map((section) => {
          const selected = selectedIndex === section.index;
          return (
            <li key={section.index}>
              <button
                type="button"
                className={`sections__item${selected ? " sections__item--selected" : ""}`}
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : section.index)}
              >
                <span className="sections__name">Section {section.index + 1}</span>
                <span className="sections__meta">
                  lines {section.lineStart}–{section.lineEnd} · {section.metrics.wordCount} words ·{" "}
                  {formatPercent(section.metrics.rhymeDensity)} rhyme
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selectedIndex != null && (
        <button type="button" className="link-button" onClick={() => onSelect(null)}>
          Clear section selection
        </button>
      )}
    </details>
  );
};

export default SectionNavigator;
