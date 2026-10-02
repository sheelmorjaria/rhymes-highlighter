// The exploration trail: songs the user has opened recently. Clicking one
// reopens it (restoring its artist context when we know it).
const RecentlyOpened = ({ items, onOpen }) => {
  if (!items.length) {
    return null;
  }
  return (
    <section className="recent" aria-label="Recently opened">
      <h3 className="results__heading">Recently opened</h3>
      <ul className="recent__list">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="recent__item" onClick={() => onOpen(item)}>
              <span className="recent__title">{item.title}</span>
              <span className="recent__artist">{item.artistNames}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default RecentlyOpened;
