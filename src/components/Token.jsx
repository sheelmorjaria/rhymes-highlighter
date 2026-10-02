// A single word span in the lyrics. Tokens are click targets for selecting a
// rhyme family, but deliberately not keyboard tab stops — keyboard users reach
// families through the legend and occurrence controls instead, so a long song
// does not become hundreds of tab stops.
const Token = ({ id, token, color, active, muted, onClick }) => {
  const className = [
    "token",
    onClick ? "token--selectable" : "",
    active ? "token--active" : "",
    muted ? "token--muted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = color ? { backgroundColor: color.background, color: color.text } : undefined;
  const props = { id, className, style };
  if (onClick) {
    return (
      <span {...props} onClick={onClick} role="button" tabIndex={-1}>
        {token.text}
      </span>
    );
  }
  return <span {...props}>{token.text}</span>;
};

export default Token;
