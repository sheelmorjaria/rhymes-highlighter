import { useMemo } from "react";
import Token from "./Token";

// Renders the original text verbatim, painting only the word spans the
// analysis marked with a family. Offsets into the original string preserve
// spacing, punctuation, capitalisation and line breaks exactly as received.
// When a section is selected, everything outside its token range is dimmed
// (composing with family-selection dimming).
const RhymesOutput = ({
  text,
  tokens,
  colors,
  selectedFamilyId,
  dimUnselected,
  activeSection,
  onSelectFamily,
}) => {
  const segments = useMemo(() => {
    const out = [];
    let cursor = 0;
    tokens.forEach((token, index) => {
      if (token.start > cursor) {
        out.push({ key: `t${index}`, type: "text", text: text.slice(cursor, token.start), index });
      }
      out.push({ key: `w${index}`, type: "token", token, index });
      cursor = token.end;
    });
    if (cursor < text.length) {
      // Tail text belongs to the last token's section.
      out.push({ key: "tail", type: "text", text: text.slice(cursor), index: Math.max(tokens.length - 1, 0) });
    }
    return out;
  }, [text, tokens]);

  const inSection = (tokenIndex) =>
    !activeSection ||
    (tokenIndex >= activeSection.firstTokenIndex && tokenIndex <= activeSection.lastTokenIndex);

  return (
    <div className="lyrics">
      {segments.map((segment) => {
        const sectionMuted = activeSection && !inSection(segment.index);
        if (segment.type === "text") {
          return (
            <span key={segment.key} className={`lyrics__raw${sectionMuted ? " lyrics__raw--muted" : ""}`}>
              {segment.text}
            </span>
          );
        }
        return (
          <Token
            key={segment.key}
            id={`token-${segment.index}`}
            token={segment.token}
            color={segment.token.familyId ? colors.get(segment.token.familyId) : null}
            active={Boolean(selectedFamilyId) && segment.token.familyId === selectedFamilyId}
            muted={
              sectionMuted ||
              Boolean(
                dimUnselected && segment.token.familyId && segment.token.familyId !== selectedFamilyId
              )
            }
            onClick={segment.token.familyId ? () => onSelectFamily(segment.token.familyId) : undefined}
          />
        );
      })}
    </div>
  );
};

export default RhymesOutput;
