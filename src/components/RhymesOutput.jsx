import { useMemo } from "react";
import Token from "./Token";

// Renders the original text verbatim, painting only the word spans the
// analysis marked with a family. Offsets into the original string preserve
// spacing, punctuation, capitalisation and line breaks exactly as received.
const RhymesOutput = ({ text, tokens, colors, selectedFamilyId, dimUnselected, onSelectFamily }) => {
  const segments = useMemo(() => {
    const out = [];
    let cursor = 0;
    tokens.forEach((token, index) => {
      if (token.start > cursor) {
        out.push({ key: `t${index}`, type: "text", text: text.slice(cursor, token.start) });
      }
      out.push({ key: `w${index}`, type: "token", index, token });
      cursor = token.end;
    });
    if (cursor < text.length) {
      out.push({ key: "tail", type: "text", text: text.slice(cursor) });
    }
    return out;
  }, [text, tokens]);

  return (
    <div className="lyrics">
      {segments.map((segment) =>
        segment.type === "text" ? (
          <span key={segment.key} className="lyrics__raw">
            {segment.text}
          </span>
        ) : (
          <Token
            key={segment.key}
            id={`token-${segment.index}`}
            token={segment.token}
            color={segment.token.familyId ? colors.get(segment.token.familyId) : null}
            active={Boolean(selectedFamilyId) && segment.token.familyId === selectedFamilyId}
            muted={dimUnselected && Boolean(segment.token.familyId) && segment.token.familyId !== selectedFamilyId}
            onClick={segment.token.familyId ? () => onSelectFamily(segment.token.familyId) : undefined}
          />
        )
      )}
    </div>
  );
};

export default RhymesOutput;
