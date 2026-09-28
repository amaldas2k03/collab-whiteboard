/**
 * StylePanel.tsx — stroke color, fill color, weight and opacity.
 *
 * The panel always edits the *current draw style* (what the next shape will
 * use). When something is selected it additionally pushes each change onto
 * that shape, which is the behaviour people expect from a drawing app: pick a
 * color with a shape selected and the shape changes too.
 */

import { useId } from 'react';
import type { Shape, ShapeStyle } from '@shared/protocol';
import {
  FILL_PALETTE,
  STROKE_PALETTE,
  STROKE_WIDTHS,
  type DrawStyle,
} from '../lib/tools';

interface Props {
  draw: DrawStyle;
  onDrawChange: (next: DrawStyle) => void;
  /** The selected shape, if any — changes are mirrored onto it. */
  selected: Shape | null;
  onSelectedStyleChange: (patch: Partial<ShapeStyle>) => void;
}

export function StylePanel({
  draw,
  onDrawChange,
  selected,
  onSelectedStyleChange,
}: Props) {
  const customId = useId();

  const setStroke = (stroke: string) => {
    onDrawChange({ ...draw, stroke });
    // Text is painted with `fill`, so the ink color has to move both fields.
    if (selected?.type === 'text') onSelectedStyleChange({ stroke, fill: stroke });
    else if (selected) onSelectedStyleChange({ stroke });
  };

  const setFill = (fill: string) => {
    onDrawChange({ ...draw, fill });
    if (selected && selected.type !== 'text') onSelectedStyleChange({ fill });
  };

  const setWidth = (strokeWidth: number) => {
    onDrawChange({ ...draw, strokeWidth });
    if (selected) onSelectedStyleChange({ strokeWidth });
  };

  const setDash = (dash: boolean) => {
    onDrawChange({ ...draw, dash });
    if (selected) onSelectedStyleChange({ dash });
  };

  const setOpacity = (opacity: number) => {
    onDrawChange({ ...draw, opacity });
    if (selected) onSelectedStyleChange({ opacity });
  };

  return (
    <aside className="style-panel" aria-label="Style">
      <section className="style-group">
        <h3 className="style-title">Stroke</h3>
        <div className="swatches">
          {STROKE_PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${draw.stroke === c ? 'active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Stroke ${c}`}
              onClick={() => setStroke(c)}
            />
          ))}
          <label
            className="swatch swatch-custom"
            title="Custom stroke color"
            htmlFor={`${customId}-stroke`}
            style={{ background: draw.stroke }}
          >
            <input
              id={`${customId}-stroke`}
              type="color"
              value={normalizeHex(draw.stroke)}
              onChange={(e) => setStroke(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="style-group">
        <h3 className="style-title">Fill</h3>
        <div className="swatches">
          {FILL_PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${draw.fill === c ? 'active' : ''} ${
                c === 'transparent' ? 'swatch-none' : ''
              }`}
              style={c === 'transparent' ? undefined : { background: c }}
              title={c === 'transparent' ? 'No fill' : c}
              aria-label={c === 'transparent' ? 'No fill' : `Fill ${c}`}
              onClick={() => setFill(c)}
            />
          ))}
          <label
            className="swatch swatch-custom"
            title="Custom fill color"
            htmlFor={`${customId}-fill`}
            style={{ background: draw.fill === 'transparent' ? '#fff' : draw.fill }}
          >
            <input
              id={`${customId}-fill`}
              type="color"
              value={normalizeHex(draw.fill === 'transparent' ? '#ffffff' : draw.fill)}
              onChange={(e) => setFill(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="style-group">
        <h3 className="style-title">Weight</h3>
        <div className="weights">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              className={`weight ${draw.strokeWidth === w ? 'active' : ''}`}
              title={`${w}px`}
              aria-label={`Stroke weight ${w}`}
              onClick={() => setWidth(w)}
            >
              <span
                className="weight-bar"
                style={{ height: Math.min(w, 10), background: draw.stroke }}
              />
            </button>
          ))}
        </div>
      </section>

      <section className="style-group">
        <h3 className="style-title">Line style</h3>
        <div className="weights">
          <button
            className={`weight wide ${!draw.dash ? 'active' : ''}`}
            aria-pressed={!draw.dash}
            onClick={() => setDash(false)}
          >
            <span className="weight-bar" style={{ height: 3, background: draw.stroke }} />
          </button>
          <button
            className={`weight wide ${draw.dash ? 'active' : ''}`}
            aria-pressed={draw.dash}
            title="Dashed"
            onClick={() => setDash(true)}
          >
            <span
              className="weight-bar dashed"
              style={{ height: 3, backgroundImage: `linear-gradient(90deg, ${draw.stroke} 60%, transparent 60%)` }}
            />
          </button>
        </div>
      </section>

      <section className="style-group">
        <h3 className="style-title">
          Opacity <span className="style-value">{Math.round(draw.opacity * 100)}%</span>
        </h3>
        <input
          className="slider"
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(draw.opacity * 100)}
          aria-label="Opacity"
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
        />
      </section>
    </aside>
  );
}

/**
 * `<input type="color">` only accepts `#rrggbb`. Palette entries already are,
 * but a shape can carry `rgba(...)` or `transparent` from an older style.
 */
function normalizeHex(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
}
