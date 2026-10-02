import { useId, useState } from "react";

const PasteLyricsBox = ({ onAnalyze, submitLabel = "Highlight rhymes", busy = false }) => {
  const [text, setText] = useState("");
  const textareaId = useId();
  const disabled = busy || !text.trim();

  return (
    <form
      className="paste-box"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) {
          onAnalyze(text);
        }
      }}
    >
      <label htmlFor={textareaId}>Paste lyrics</label>
      <textarea
        id={textareaId}
        rows={6}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste the lyrics you want to analyse…"
      />
      <button type="submit" className="button" disabled={disabled}>
        {busy ? "Analysing…" : submitLabel}
      </button>
    </form>
  );
};

export default PasteLyricsBox;
