import { TOOLS, type Tool } from '../lib/tools';
import { Icon, type IconName } from './Icon';

interface Props {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  hasSelection: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onClear: () => void;
  onHelp: () => void;
}

export function Toolbar({
  tool,
  onToolChange,
  hasSelection,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExport,
  onClear,
  onHelp,
}: Props) {
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOLS.map((t, i) => {
        const newGroup = i > 0 && TOOLS[i - 1].group !== t.group;
        return (
          <div key={t.id} className="toolbar-item">
            {newGroup && <div className="toolbar-sep" />}
            <button
              className={`tool-btn ${tool === t.id ? 'active' : ''}`}
              title={`${t.label} — ${t.key.toUpperCase()}`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => onToolChange(t.id)}
            >
              <Icon name={t.id as IconName} />
              <span className="tool-key">{t.key.toUpperCase()}</span>
            </button>
          </div>
        );
      })}

      <div className="toolbar-sep" />

      <button
        className="tool-btn"
        title="Undo — Ctrl+Z"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Icon name="undo" />
      </button>
      <button
        className="tool-btn"
        title="Redo — Ctrl+Shift+Z"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Icon name="redo" />
      </button>

      <div className="toolbar-sep" />

      <button
        className="tool-btn"
        title="Duplicate selected — Ctrl+D"
        aria-label="Duplicate selected"
        disabled={!hasSelection}
        onClick={onDuplicate}
      >
        <Icon name="duplicate" />
      </button>
      <button
        className="tool-btn"
        title="Bring to front — ]"
        aria-label="Bring to front"
        disabled={!hasSelection}
        onClick={onBringToFront}
      >
        <Icon name="front" />
      </button>
      <button
        className="tool-btn"
        title="Send to back — ["
        aria-label="Send to back"
        disabled={!hasSelection}
        onClick={onSendToBack}
      >
        <Icon name="back" />
      </button>
      <button
        className="tool-btn danger"
        title="Delete selected — Del"
        aria-label="Delete selected"
        disabled={!hasSelection}
        onClick={onDelete}
      >
        <Icon name="trash" />
      </button>

      <div className="toolbar-spacer" />

      <button
        className="tool-btn"
        title="Export board as PNG"
        aria-label="Export board as PNG"
        onClick={onExport}
      >
        <Icon name="download" />
      </button>
      <button
        className="tool-btn danger"
        title="Clear the whole board"
        aria-label="Clear the whole board"
        onClick={onClear}
      >
        <Icon name="close" />
      </button>
      <button
        className="tool-btn"
        title="Keyboard shortcuts — ?"
        aria-label="Keyboard shortcuts"
        onClick={onHelp}
      >
        <Icon name="help" />
      </button>
    </nav>
  );
}
