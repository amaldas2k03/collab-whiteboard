import { useRef } from 'react';
import { TOOLS, type Tool } from '../lib/tools';
import { Icon, type IconName } from './Icon';

interface Props {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  hasSelection: boolean;
  /** Lock state of the selection; meaningless without one. */
  selectionLocked: boolean;
  onToggleLock: () => void;
  importing: boolean;
  onImportPhoto: (file: File) => void;
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
  selectionLocked,
  onToggleLock,
  importing,
  onImportPhoto,
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
  const fileRef = useRef<HTMLInputElement>(null);
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
        title="Import a photo of a whiteboard or notes"
        aria-label="Import photo"
        disabled={importing}
        aria-busy={importing}
        onClick={() => fileRef.current?.click()}
      >
        <Icon name="camera" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same photo again still fires a change.
          e.target.value = '';
          if (file) onImportPhoto(file);
        }}
      />

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
        className={`tool-btn ${hasSelection && selectionLocked ? 'active' : ''}`}
        title={selectionLocked ? 'Unlock selected' : 'Lock selected in place'}
        aria-label={selectionLocked ? 'Unlock selected' : 'Lock selected'}
        aria-pressed={hasSelection && selectionLocked}
        disabled={!hasSelection}
        onClick={onToggleLock}
      >
        <Icon name={selectionLocked ? 'lock' : 'unlock'} />
      </button>
      <button
        className="tool-btn danger"
        title="Delete selected — Del"
        aria-label="Delete selected"
        disabled={!hasSelection || selectionLocked}
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
