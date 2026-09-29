import type { ShapeStyle, ShapeType } from '@shared/protocol';

/**
 * Tools are either a shape type (drawing tools) or one of the modal tools that
 * act on existing content instead of creating it.
 */
export type Tool =
  | 'select'
  | 'hand'
  | 'eraser'
  | 'fill'
  | 'spotlight'
  | ShapeType;

export interface ToolDef {
  id: Tool;
  label: string;
  /** Single-key shortcut. Matched case-insensitively against `event.key`. */
  key: string;
  /** Visual grouping in the toolbar — a separator is drawn between groups. */
  group: number;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select / move', key: 'v', group: 0 },
  { id: 'hand', label: 'Pan the board', key: 'h', group: 0 },

  { id: 'pen', label: 'Pen', key: 'p', group: 1 },
  { id: 'highlight', label: 'Highlighter', key: 'm', group: 1 },
  { id: 'eraser', label: 'Eraser', key: 'e', group: 1 },

  { id: 'line', label: 'Line', key: 'l', group: 2 },
  { id: 'arrow', label: 'Arrow', key: 'a', group: 2 },
  { id: 'curve', label: 'Curve', key: 'c', group: 2 },
  { id: 'rect', label: 'Rectangle', key: 'r', group: 2 },
  { id: 'ellipse', label: 'Ellipse', key: 'o', group: 2 },

  { id: 'text', label: 'Text', key: 't', group: 3 },
  { id: 'note', label: 'Sticky note', key: 'n', group: 3 },

  { id: 'fill', label: 'Fill (paint bucket)', key: 'f', group: 4 },
  { id: 'spotlight', label: 'Spotlight / focus', key: 's', group: 4 },
];

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/** Stroke / ink colors. Ordered light-to-dark within each hue family. */
export const STROKE_PALETTE = [
  '#1e1e1e',
  '#6b7280',
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#4f46e5',
  '#9333ea',
];

/** Fill colors. `transparent` is always first so "no fill" is one click away. */
export const FILL_PALETTE = [
  'transparent',
  '#ffffff',
  '#fee2e2',
  '#ffedd5',
  '#fef9c3',
  '#dcfce7',
  '#cffafe',
  '#dbeafe',
  '#e0e7ff',
  '#f3e8ff',
];

export const STROKE_WIDTHS = [1, 2, 4, 8, 16];

/** The style the user is currently drawing with (owned by App). */
export interface DrawStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  dash: boolean;
}

export const INITIAL_DRAW_STYLE: DrawStyle = {
  stroke: '#4f46e5',
  fill: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  dash: false,
};

/** Sticky notes fall back to this when the current fill is "no fill". */
const NOTE_FALLBACK_FILL = '#fef08a';

/** Highlighter ink is always wide and translucent, whatever the sliders say. */
export const HIGHLIGHT_WIDTH = 18;
export const HIGHLIGHT_OPACITY = 0.4;

/**
 * Resolve the concrete ShapeStyle for a new shape of `type`, given what the
 * user has selected in the style panel. Per-type overrides exist where a raw
 * copy of the draw style would produce something unusable (invisible
 * highlighter, a sticky note with no background, hairline text).
 */
export function styleFor(type: ShapeType, draw: DrawStyle): ShapeStyle {
  switch (type) {
    case 'highlight':
      return {
        stroke: draw.stroke,
        fill: 'transparent',
        strokeWidth: HIGHLIGHT_WIDTH,
        opacity: HIGHLIGHT_OPACITY,
      };
    case 'text':
      return {
        stroke: draw.stroke,
        fill: draw.stroke, // text is painted with `fill`, so track the ink color
        strokeWidth: 1,
        opacity: draw.opacity,
        fontSize: 18,
      };
    case 'note':
      return {
        stroke: 'rgba(0,0,0,0.12)',
        fill: draw.fill === 'transparent' ? NOTE_FALLBACK_FILL : draw.fill,
        strokeWidth: 1,
        opacity: draw.opacity,
        fontSize: 15,
      };
    case 'pen':
      // Freehand ink is never dashed — it would read as a broken stroke.
      return {
        stroke: draw.stroke,
        fill: 'transparent',
        strokeWidth: Math.max(1, draw.strokeWidth),
        opacity: draw.opacity,
      };
    case 'line':
    case 'arrow':
    case 'curve':
      return {
        stroke: draw.stroke,
        fill: 'transparent',
        strokeWidth: Math.max(1, draw.strokeWidth),
        opacity: draw.opacity,
        dash: draw.dash,
      };
    default:
      return {
        stroke: draw.stroke,
        fill: draw.fill,
        strokeWidth: Math.max(1, draw.strokeWidth),
        opacity: draw.opacity,
        dash: draw.dash,
      };
  }
}
