import { useMemo, useState } from "react";
import { songsSharingRhymeWords } from "../util/analysisIndex";

const formatPercent = (value) => (value == null ? "—" : `${Math.round(value * 100)}%`);
const formatCount = (value) => (value == null ? "—" : String(value));
const formatSpacing = (value) => (value == null ? "—" : `${value.toFixed(1)} words`);

const METRICS = [
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

// Writing-pattern measurements for the open text, with song-to-song comparison
// against the analysed-songs index. Every number is inspectable: open either
// song to read the highlighted lyrics the measurement came from.
const WritingPatterns = ({ songId, song, analysis, index, onOpenSong }) => {
  const metrics = analysis?.metrics;
  const [compareId, setCompareId] = useState("");
  const others = index.filter((entry) => entry.id !== songId);
  const compareEntry = others.find((entry) => entry.id === compareId) ?? null;

  const sharedSounds = useMemo(() => {
    if (!analysis?.families) {
      return [];
    }
    return analysis.families
      .map((family) => ({ family, matches: songsSharingRhymeWords(family, index, songId) }))
      .filter((item) => item.matches.length > 0);
  }, [analysis, index, songId]);

  if (!metrics) {
    return null;
  }
  const songTitle = song?.title ?? "This song";

  return (
    <details className="patterns">
      <summary>
        Writing patterns
        <span className="patterns__sample">measured from {metrics.wordCount} words in this text</span>
      </summary>

      <dl className="patterns__grid">
        {METRICS.map((metric) => (
          <div key={metric.key} className="patterns__cell">
            <dt title={metric.description}>{metric.label}</dt>
            <dd>{metric.format(metrics[metric.key])}</dd>
          </div>
        ))}
      </dl>

      {others.length > 0 && (
        <div className="patterns__compare">
          <label htmlFor="patterns-compare">Compare with</label>
          <select id="patterns-compare" value={compareId} onChange={(event) => setCompareId(event.target.value)}>
            <option value="">Choose a song…</option>
            {others.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title} — {entry.artistNames}
              </option>
            ))}
          </select>
          {compareEntry && (
            <>
              <table className="patterns__table">
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col">{songTitle}</th>
                    <th scope="col">{compareEntry.title}</th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((metric) => (
                    <tr key={metric.key}>
                      <th scope="row">{metric.label}</th>
                      <td>{metric.format(metrics[metric.key])}</td>
                      <td>{metric.format(compareEntry.metrics?.[metric.key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="link-button"
                onClick={() => onOpenSong(compareEntry.id, compareEntry.artistId)}
              >
                Open “{compareEntry.title}” to inspect its lyrics →
              </button>
            </>
          )}
        </div>
      )}

      {sharedSounds.length > 0 && (
        <div className="patterns__shared">
          <h4>Rhyme sounds shared with other analysed songs</h4>
          <ul>
            {sharedSounds.map(({ family, matches }) => (
              <li key={family.id}>
                <strong>Family {family.label}</strong> ({family.examples.join(", ")}) shares rhyming words with{" "}
                {matches.map((match, matchIndex) => (
                  <span key={match.entry.id}>
                    {matchIndex > 0 && ", "}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpenSong(match.entry.id, match.entry.artistId)}
                    >
                      {match.entry.title}
                    </button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="results__hint">
            Sharing a rhyme sound is not a claim of overall similarity — open a song to inspect the lines.
          </p>
        </div>
      )}
    </details>
  );
};

export default WritingPatterns;
