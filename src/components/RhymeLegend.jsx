// Legend of rhyme families. Colour is only one cue: each chip also carries the
// family label and example words, so the legend stays readable for anyone who
// cannot distinguish the background colours.
const RhymeLegend = ({ families, colors, selectedFamilyId, onSelectFamily }) => (
  <ul className="legend" aria-label="Rhyme families">
    {families.map((family) => {
      const color = colors.get(family.id);
      const selected = selectedFamilyId === family.id;
      return (
        <li key={family.id}>
          <button
            type="button"
            className={`legend__chip${selected ? " legend__chip--selected" : ""}`}
            aria-pressed={selected}
            onClick={() => onSelectFamily(selected ? null : family.id)}
          >
            <span className="legend__swatch" style={{ backgroundColor: color?.background }} aria-hidden="true" />
            <span className="legend__label">{family.label}</span>
            <span className="legend__examples">{family.examples.join(", ")}</span>
            <span className="legend__count" aria-label={`${family.count} occurrences`}>
              ×{family.count}
            </span>
          </button>
        </li>
      );
    })}
  </ul>
);

export default RhymeLegend;
