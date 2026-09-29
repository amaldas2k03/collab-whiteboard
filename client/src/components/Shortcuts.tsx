import { TOOLS } from '../lib/tools';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
}

const GENERAL: [string, string][] = [
  ['Ctrl / ⌘ + Z', 'Undo'],
  ['Ctrl / ⌘ + Shift + Z', 'Redo'],
  ['Ctrl / ⌘ + D', 'Duplicate selection'],
  ['Delete / Backspace', 'Delete selection'],
  ['[  /  ]', 'Send to back / bring to front'],
  ['G', 'Toggle the grid'],
  ['Esc', 'Deselect, clear focus, back to Select'],
];

const VIEW: [string, string][] = [
  ['Ctrl / ⌘ + wheel', 'Zoom around the pointer'],
  ['Wheel / trackpad', 'Pan the board'],
  ['Space + drag', 'Pan from any tool'],
  ['Ctrl / ⌘ + + / −', 'Zoom in / out'],
  ['1', 'Reset to 100%'],
  ['2', 'Zoom to fit everything'],
];

const DRAWING: [string, string][] = [
  ['Shift while drawing', 'Square boxes, 45° lines'],
  ['Double-click text / note', 'Edit it in place'],
  ['Ctrl / ⌘ + Enter', 'Finish editing text'],
  ['Drag the dot on a curve', 'Change how it bows'],
];

export function Shortcuts({ onClose }: Props) {
  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="modal-body">
          <section>
            <h3>Tools</h3>
            <dl>
              {TOOLS.map((t) => (
                <div key={t.id} className="shortcut-row">
                  <dt>
                    <kbd>{t.key.toUpperCase()}</kbd>
                  </dt>
                  <dd>{t.label}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3>Editing</h3>
            <dl>
              {GENERAL.map(([k, v]) => (
                <div key={k} className="shortcut-row">
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>

            <h3>Drawing</h3>
            <dl>
              {DRAWING.map(([k, v]) => (
                <div key={k} className="shortcut-row">
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3>View</h3>
            <dl>
              {VIEW.map(([k, v]) => (
                <div key={k} className="shortcut-row">
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
