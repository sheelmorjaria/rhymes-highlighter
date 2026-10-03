// The analysed-songs index: a local record of every song this browser has
// analysed, kept in localStorage so song-to-song comparisons and rhyme-sound
// searches survive reloads. Entries carry the metrics shown in the UI plus the
// member words of each family (for sound matching) — not the lyrics themselves.
const STORAGE_KEY = "rhymes.analysisIndex";
const MAX_ENTRIES = 50;

export function loadAnalysisIndex() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => entry && typeof entry.id === "string" && entry.metrics);
  } catch {
    return [];
  }
}

export function persistAnalysisIndex(entries) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage unavailable — the index just won't persist.
  }
}

export function upsertAnalysisEntry(entries, entry) {
  return [entry, ...entries.filter((item) => item.id !== entry.id)].slice(0, MAX_ENTRIES);
}

// Songs whose rhyme families contain the same words as this family. Precise by
// construction: a match means the two songs literally share rhyming words.
// Sharing a sound is explicitly not a claim of overall similarity.
export function songsSharingRhymeWords(family, entries, excludeId) {
  const results = [];
  for (const entry of entries) {
    if (entry.id === excludeId) {
      continue;
    }
    const shared = (family.words ?? []).filter((word) =>
      (entry.families ?? []).some((entryFamily) => (entryFamily.words ?? []).includes(word))
    );
    if (shared.length > 0) {
      results.push({ entry, sharedWords: shared });
    }
  }
  return results.sort((a, b) => b.sharedWords.length - a.sharedWords.length);
}
