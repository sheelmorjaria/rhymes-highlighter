import { useEffect, useMemo, useState } from "react";
import PasteLyricsBox from "./PasteLyricsBox";
import RhymeLegend from "./RhymeLegend";
import RhymesOutput from "./RhymesOutput";
import { assignFamilyColors } from "../util/familyColors";

// The lyric reader. It shows the selected song's identity immediately, keeps
// the text readable while rhyme analysis is still running, and distinguishes
// "lyrics unavailable", "analysis failed" and "no rhymes found" from each other.
const LyricsReader = ({ meta, lyrics, analysis, onRetrySong, onRetryAnalysis, onPasteText }) => {
  const [viewMode, setViewMode] = useState("all"); // "all" | "family" | "plain"
  const [selectedFamilyId, setSelectedFamilyId] = useState(null);
  const [occurrenceIndex, setOccurrenceIndex] = useState(0);

  const families = useMemo(() => analysis?.families ?? [], [analysis]);
  const tokens = analysis?.tokens ?? null;
  const colors = useMemo(() => assignFamilyColors(families), [families]);
  const analysisUsable = Boolean(tokens) && (analysis.status === "ready" || analysis.status === "partial");

  const occurrencesByFamily = useMemo(() => {
    const map = new Map();
    if (!tokens) {
      return map;
    }
    tokens.forEach((token, index) => {
      if (!token.familyId) {
        return;
      }
      const list = map.get(token.familyId) || [];
      list.push(index);
      map.set(token.familyId, list);
    });
    return map;
  }, [tokens]);

  const occurrences = useMemo(
    () => (selectedFamilyId ? occurrencesByFamily.get(selectedFamilyId) ?? [] : []),
    [selectedFamilyId, occurrencesByFamily]
  );

  useEffect(() => {
    setOccurrenceIndex(0);
  }, [selectedFamilyId]);

  useEffect(() => {
    if (viewMode !== "family" || occurrences.length === 0) {
      return;
    }
    const tokenIndex = occurrences[Math.min(occurrenceIndex, occurrences.length - 1)];
    document.getElementById(`token-${tokenIndex}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [viewMode, selectedFamilyId, occurrenceIndex, occurrences]);

  const selectFamily = (familyId) => {
    setSelectedFamilyId(familyId);
    setViewMode(familyId ? "family" : "all");
  };

  const selectedFamily = families.find((family) => family.id === selectedFamilyId) ?? null;

  const renderHeader = () => {
    if (meta?.status === "loading") {
      return <h2 className="reader__title reader__title--loading">Loading song…</h2>;
    }
    if (meta?.status === "unavailable") {
      return (
        <>
          <h2 className="reader__title">Song</h2>
          <p className="reader__note reader__note--warn">
            Song details are unavailable because the Genius catalogue is not configured on this server
            (missing GENIUS_ACCESS_TOKEN). You can still paste the lyrics below.
          </p>
        </>
      );
    }
    if (meta?.status === "error") {
      return (
        <>
          <h2 className="reader__title">Song</h2>
          <p className="reader__note reader__note--error">
            Could not load song details: {meta.error}{" "}
            <button type="button" className="link-button" onClick={onRetrySong}>
              Retry
            </button>
          </p>
        </>
      );
    }
    const song = meta?.song;
    return (
      <>
        <h2 className="reader__title">{song?.title ?? "Your pasted lyrics"}</h2>
        <p className="reader__subtitle">
          {song?.artistNames}
          {song?.sourceUrl && (
            <>
              {" · "}
              <a href={song.sourceUrl} target="_blank" rel="noreferrer">
                View on Genius
              </a>
            </>
          )}
        </p>
      </>
    );
  };

  const renderLyricsPanel = () => {
    if (lyrics.status === "loading" || lyrics.status === "idle") {
      return <p className="status status--loading">Fetching lyrics…</p>;
    }
    if (lyrics.status === "unavailable") {
      return (
        <div className="panel">
          <p className="panel__message">
            No lyrics were found for this song in our lyrics source. Paste the lyrics yourself to get
            rhyme highlighting.
          </p>
          <PasteLyricsBox onAnalyze={onPasteText} submitLabel="Highlight pasted lyrics" />
        </div>
      );
    }
    if (lyrics.status === "error") {
      return (
        <div className="panel">
          <p className="panel__message panel__message--error">
            Could not load lyrics: {lyrics.error}{" "}
            <button type="button" className="link-button" onClick={onRetrySong}>
              Retry
            </button>
          </p>
          <PasteLyricsBox onAnalyze={onPasteText} submitLabel="Highlight pasted lyrics" />
        </div>
      );
    }
    return null;
  };

  const renderAnalysisChip = () => {
    if (analysis?.status === "loading" || analysis?.status === "idle") {
      return (
        <p className="status status--loading" aria-live="polite">
          Analysing rhymes — you can read the lyrics while this runs…
        </p>
      );
    }
    if (analysis?.status === "failed") {
      return (
        <p className="status status--error" aria-live="polite">
          Rhyme analysis failed: {analysis.error || "unknown error"}{" "}
          <button type="button" className="link-button" onClick={onRetryAnalysis}>
            Retry
          </button>
        </p>
      );
    }
    if (analysis?.status === "partial") {
      return (
        <p className="status status--warn" aria-live="polite">
          Partial analysis — some rhyme lookups failed, so a few rhymes may be missing.
        </p>
      );
    }
    if (analysis?.status === "empty" || (analysisUsable && families.length === 0)) {
      return (
        <p className="status status--info" aria-live="polite">
          No rhyme families were found in this text.
        </p>
      );
    }
    return null;
  };

  const renderBody = () => {
    const lyricsPanel = renderLyricsPanel();
    if (lyricsPanel) {
      return lyricsPanel;
    }
    if (!lyrics.text) {
      return null;
    }

    const analysisChip = renderAnalysisChip();
    if (!analysisUsable || families.length === 0) {
      return (
        <>
          {analysisChip}
          <div className="lyrics lyrics--plain">{lyrics.text}</div>
        </>
      );
    }

    return (
      <>
        {analysisChip}
        <div className="view-toolbar" role="group" aria-label="Lyrics view">
          <button
            type="button"
            className="button button--toggle"
            aria-pressed={viewMode === "all"}
            onClick={() => selectFamily(null)}
          >
            All rhymes
          </button>
          <button
            type="button"
            className="button button--toggle"
            aria-pressed={viewMode === "family"}
            onClick={() => {
              setSelectedFamilyId((current) => current ?? families[0].id);
              setViewMode("family");
            }}
          >
            Selected family
          </button>
          <button
            type="button"
            className="button button--toggle"
            aria-pressed={viewMode === "plain"}
            onClick={() => setViewMode("plain")}
          >
            Plain lyrics
          </button>
        </div>

        {viewMode === "family" && (
          <div className="occurrences">
            {selectedFamily && (
              <span className="occurrences__label">
                Family {selectedFamily.label} · {selectedFamily.examples.join(", ")}
              </span>
            )}
            <span className="occurrences__position">
              {occurrences.length > 0 ? `${Math.min(occurrenceIndex, occurrences.length - 1) + 1} / ${occurrences.length}` : "0 / 0"}
            </span>
            <button
              type="button"
              className="button button--small"
              onClick={() => setOccurrenceIndex((current) => (current - 1 + occurrences.length) % occurrences.length)}
              disabled={occurrences.length === 0}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => setOccurrenceIndex((current) => (current + 1) % occurrences.length)}
              disabled={occurrences.length === 0}
            >
              Next ›
            </button>
            <button type="button" className="link-button" onClick={() => selectFamily(null)}>
              Clear
            </button>
          </div>
        )}

        {viewMode !== "plain" && (
          <RhymeLegend
            families={families}
            colors={colors}
            selectedFamilyId={viewMode === "family" ? selectedFamilyId : null}
            onSelectFamily={selectFamily}
          />
        )}

        {viewMode === "plain" ? (
          <div className="lyrics lyrics--plain">{lyrics.text}</div>
        ) : (
          <RhymesOutput
            text={lyrics.text}
            tokens={tokens}
            colors={colors}
            selectedFamilyId={viewMode === "family" ? selectedFamilyId : null}
            dimUnselected={viewMode === "family"}
            onSelectFamily={selectFamily}
          />
        )}
      </>
    );
  };

  return (
    <article className="reader" aria-label="Lyric reader">
      <header className="reader__header">{renderHeader()}</header>
      {renderBody()}
    </article>
  );
};

export default LyricsReader;
