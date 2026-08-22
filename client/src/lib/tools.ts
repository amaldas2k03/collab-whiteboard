import type { ShapeType } from '@shared/protocol';

export type Tool = 'select' | ShapeType;

export const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select / Move', icon: '⤢' },
  { id: 'rect', label: 'Rectangle', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯' },
  { id: 'line', label: 'Line', icon: '╱' },
  { id: 'pen', label: 'Pen', icon: '✎' },
  { id: 'text', label: 'Text', icon: 'T' },
];

/** Sensible default styling per shape type (styling beyond this is out of scope). */
export function defaultStyle(type: ShapeType) {
  switch (type) {
    case 'text':
      return { stroke: '#1e1e1e', fill: '#1e1e1e', strokeWidth: 1 };
    case 'line':
    case 'pen':
      return { stroke: '#4f46e5', fill: 'transparent', strokeWidth: 3 };
    default:
      return { stroke: '#4f46e5', fill: 'rgba(79,70,229,0.12)', strokeWidth: 2 };
  }
}
