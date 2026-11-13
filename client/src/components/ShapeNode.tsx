/**
 * ShapeNode.tsx — renders one board shape.
 *
 * Every shape is wrapped in a <Group> carrying its position, rotation and
 * opacity. That uniformity is what lets move / rotate / resize work the same
 * way for a rectangle and for a freehand stroke: the interaction always talks
 * to the Group, and the commit bakes the Group's transform back into the
 * shape's own geometry (see Canvas.handleTransformEnd).
 */

import { useEffect, useMemo, useState } from 'react';
import { Rect, Ellipse, Line, Arrow, Text, Group, Image } from 'react-konva';
import type Konva from 'konva';
import type { Shape } from '@shared/protocol';
import { localBounds, quadraticToCubic } from '../lib/geometry';
import { renderLatex } from '../lib/math';

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
  /** Follow `shape.link`. The badge only renders when this is given. */
  onLinkClick?: () => void;
}

/** Sticky-note text is always dark: the note itself supplies the color. */
const NOTE_TEXT = '#1f2937';
const NOTE_PADDING = 12;
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
/** Shapes that draw `text` centred inside themselves as a label. */
const LABELLED = new Set(['rect', 'ellipse', 'diamond']);

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
  onLinkClick,
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

      {shape.type === 'diamond' && (
        <Line
          points={[width / 2, 0, width, height / 2, width / 2, height, 0, height / 2]}
          closed
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          lineJoin="round"
          dash={style.dash ? [8, 6] : undefined}
        />
      )}

      {LABELLED.has(shape.type) && shape.text && (
        <Text
          text={shape.text}
          width={width}
          height={height}
          padding={6}
          align="center"
          verticalAlign="middle"
          fontSize={style.fontSize ?? 16}
          fontFamily={FONT}
          fill={style.stroke}
          listening={false}
        />
      )}

      {shape.type === 'image' && <BitmapNode src={shape.src} width={width} height={height} />}

      {shape.type === 'math' && <MathNode latex={shape.text ?? ''} width={width} height={height} />}

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

      {shape.type === 'arrow' && shape.text && points.length >= 4 && (
        <Text
          text={shape.text}
          x={(points[0] + points[2]) / 2 - 100}
          y={(points[1] + points[3]) / 2 - 20}
          width={200}
          align="center"
          fontSize={14}
          fontFamily={FONT}
          fill={style.stroke}
          listening={false}
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
          fontFamily={FONT}
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
            fontFamily={FONT}
            lineHeight={1.35}
            fill={NOTE_TEXT}
            listening={false}
          />
        </>
      )}

      {shape.link && onLinkClick && <LinkBadge shape={shape} onClick={onLinkClick} />}
    </Group>
  );
}

/** Load a bitmap for a Konva <Image>; null until it has decoded. */
function useLoadedImage(src: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!src) return;
    const el = new window.Image();
    el.onload = () => setImg(el);
    el.src = src;
    return () => {
      el.onload = null;
    };
  }, [src]);
  return img;
}

function BitmapNode({ src, width, height }: { src?: string; width: number; height: number }) {
  const img = useLoadedImage(src);
  // The placeholder keeps the photo selectable while it decodes.
  return img ? (
    <Image image={img} width={width} height={height} />
  ) : (
    <Rect width={width} height={height} fill="rgba(0,0,0,0.05)" />
  );
}

/** Typeset LaTeX, fitted inside the box without distorting it. */
function MathNode({ latex, width, height }: { latex: string; width: number; height: number }) {
  const math = useMemo(() => renderLatex(latex), [latex]);
  const img = useLoadedImage(math.src);
  const k = Math.min(width / math.width, height / math.height);
  return (
    <>
      {/* Near-transparent hit area, so the whole box is grabbable, not just the ink. */}
      <Rect width={width} height={height} fill="rgba(0,0,0,0.001)" />
      {img && (
        <Image image={img} width={math.width * k} height={math.height * k} listening={false} />
      )}
    </>
  );
}

/** The jump link in a linked note's top-right corner. */
function LinkBadge({ shape, onClick }: { shape: Shape; onClick: () => void }) {
  const b = localBounds(shape);
  const stop = (e: Konva.KonvaEventObject<Event>) => {
    // Don't let the press select or start dragging the note underneath.
    e.cancelBubble = true;
  };
  return (
    <Group
      x={b.x + b.width + 4}
      y={b.y - 20}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={onClick}
      onTap={onClick}
    >
      <Rect width={20} height={20} cornerRadius={10} fill="#4f46e5" />
      <Text
        text="↗"
        width={20}
        height={20}
        align="center"
        verticalAlign="middle"
        fontSize={13}
        fill="#fff"
        listening={false}
      />
    </Group>
  );
}
