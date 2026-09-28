/**
 * ShapeNode.tsx — renders one board shape.
 *
 * Every shape is wrapped in a <Group> carrying its position, rotation and
 * opacity. That uniformity is what lets move / rotate / resize work the same
 * way for a rectangle and for a freehand stroke: the interaction always talks
 * to the Group, and the commit bakes the Group's transform back into the
 * shape's own geometry (see Canvas.handleTransformEnd).
 */

import { Rect, Ellipse, Line, Arrow, Text, Group } from 'react-konva';
import type Konva from 'konva';
import type { Shape } from '@shared/protocol';
import { quadraticToCubic } from '../lib/geometry';

export interface ShapeNodeProps {
  shape: Shape;
  draggable: boolean;
  listening?: boolean;
  registerRef?: (node: Konva.Group | null) => void;
  onSelect?: () => void;
  onDragStart?: () => void;
  onDragMove?: (node: Konva.Group) => void;
  onDragEnd?: (node: Konva.Group) => void;
  onTransformEnd?: (node: Konva.Group) => void;
  onDblClick?: () => void;
}

/** Sticky-note text is always dark: the note itself supplies the color. */
const NOTE_TEXT = '#1f2937';
const NOTE_PADDING = 12;

export function ShapeNode({
  shape,
  draggable,
  listening = true,
  registerRef,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onDblClick,
}: ShapeNodeProps) {
  const { style } = shape;
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;
  const points = shape.points ?? [];

  return (
    <Group
      ref={registerRef}
      x={shape.x}
      y={shape.y}
      rotation={shape.rotation ?? 0}
      opacity={style.opacity ?? 1}
      draggable={draggable}
      listening={listening}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragStart={onDragStart}
      onDragMove={(e) => onDragMove?.(e.target as Konva.Group)}
      onDragEnd={(e) => onDragEnd?.(e.target as Konva.Group)}
      onTransformEnd={(e) => onTransformEnd?.(e.target as Konva.Group)}
    >
      {shape.type === 'rect' && (
        <Rect
          width={width}
          height={height}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          cornerRadius={2}
          dash={style.dash ? [8, 6] : undefined}
        />
      )}

      {shape.type === 'ellipse' && (
        <Ellipse
          x={width / 2}
          y={height / 2}
          radiusX={width / 2}
          radiusY={height / 2}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          dash={style.dash ? [8, 6] : undefined}
        />
      )}

      {shape.type === 'line' && (
        <Line
          points={points}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          lineCap="round"
          dash={style.dash ? [8, 6] : undefined}
          // Give thin lines a fatter invisible hit area so they stay clickable.
          hitStrokeWidth={Math.max(12, style.strokeWidth)}
        />
      )}

      {shape.type === 'arrow' && (
        <Arrow
          points={points}
          stroke={style.stroke}
          fill={style.stroke}
          strokeWidth={style.strokeWidth}
          pointerLength={Math.max(9, style.strokeWidth * 3)}
          pointerWidth={Math.max(9, style.strokeWidth * 3)}
          lineCap="round"
          dash={style.dash ? [8, 6] : undefined}
          hitStrokeWidth={Math.max(12, style.strokeWidth)}
        />
      )}

      {shape.type === 'curve' && points.length >= 6 && (
        <Line
          points={quadraticToCubic(points)}
          bezier
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          lineCap="round"
          dash={style.dash ? [8, 6] : undefined}
          hitStrokeWidth={Math.max(12, style.strokeWidth)}
        />
      )}

      {shape.type === 'pen' && (
        <Line
          points={points}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(12, style.strokeWidth)}
        />
      )}

      {shape.type === 'highlight' && (
        <Line
          points={points}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          tension={0.3}
          lineCap="round"
          lineJoin="round"
          // Multiply is what makes overlapping marker strokes darken the way a
          // real highlighter does, instead of stacking flat alpha.
          globalCompositeOperation="multiply"
          hitStrokeWidth={Math.max(12, style.strokeWidth)}
        />
      )}

      {shape.type === 'text' && (
        <Text
          text={shape.text ?? ''}
          fontSize={style.fontSize ?? 18}
          fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
          lineHeight={1.3}
          fill={style.fill}
          width={shape.width}
        />
      )}

      {shape.type === 'note' && (
        <>
          <Rect
            width={width}
            height={height}
            fill={style.fill}
            stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            cornerRadius={3}
            shadowColor="rgba(15,23,42,0.22)"
            shadowBlur={12}
            shadowOffsetY={4}
            shadowOpacity={1}
          />
          <Text
            text={shape.text ?? ''}
            x={NOTE_PADDING}
            y={NOTE_PADDING}
            width={Math.max(0, width - NOTE_PADDING * 2)}
            height={Math.max(0, height - NOTE_PADDING * 2)}
            fontSize={style.fontSize ?? 15}
            fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
            lineHeight={1.35}
            fill={NOTE_TEXT}
            listening={false}
          />
        </>
      )}
    </Group>
  );
}
