export default function ViewToggle({ activeView, onToggle }) {
  return (
    <div className="nav-links">
      <button
        className={`nav-tab ${activeView === 'publisher' ? 'active' : ''}`}
        onClick={() => onToggle('publisher')}
      >
        Owner Panel
      </button>
      <button
        className={`nav-tab ${activeView === 'demo' ? 'active' : ''}`}
        onClick={() => onToggle('demo')}
      >
        Live Demo
      </button>
    </div>
  );
}
