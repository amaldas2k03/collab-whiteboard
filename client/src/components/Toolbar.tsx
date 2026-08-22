import { TOOLS, type Tool } from '../lib/tools';

interface Props {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  onDelete: () => void;
  hasSelection: boolean;
}

export function Toolbar({ tool, onToolChange, onDelete, hasSelection }: Props) {
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? 'active' : ''}`}
          title={t.label}
          onClick={() => onToolChange(t.id)}
        >
          <span className="tool-icon">{t.icon}</span>
        </button>
      ))}
      <div className="toolbar-sep" />
      <button
        className="tool-btn danger"
        title="Delete selected (Del)"
        disabled={!hasSelection}
        onClick={onDelete}
      >
        <span className="tool-icon">🗑</span>
      </button>
    </div>
  );
}
