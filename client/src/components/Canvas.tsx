/**
 * Canvas.tsx — the react-konva drawing surface.
 *
 * Responsibilities:
 *   - render every non-deleted shape (rect / ellipse / line / pen / text)
 *   - draw new shapes (mouse down-drag-up) and commit them to the store on release
 *   - select / move / resize / delete existing shapes (via Konva Transformer)
 *   - broadcast the local cursor and render remote users' cursors
 *
 * Konva-specific note: every shape is wrapped in a <Group> whose (x, y) is the
 * shape's position. Moving = translating the group; resizing = baking the
 * group's transform back into width/height. This keeps move/resize uniform
 * across shape types.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Stage,
  Layer,
  Rect,
  Ellipse,
  Line,
  Text,
  Group,
  Transformer,
  Circle,
} from 'react-konva';
import type Konva from 'konva';
import type { Shape, ShapeType } from '@shared/protocol';
import type { BoardStore, Snapshot } from '../lib/store';
import type { Tool } from '../lib/tools';
import { defaultStyle } from '../lib/tools';
import { throttle } from '../lib/throttle';

interface Props {
  store: BoardStore;
  tool: Tool;
  snapshot: Snapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** Shape types the Transformer is allowed to resize. */
const RESIZABLE: ShapeType[] = ['rect', 'ellipse'];

export function Canvas({ store, tool, snapshot, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  // Keep the Konva stage the same size as its container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- live cursor broadcast (throttled) -----------------------------------
  const sendCursor = useMemo(
    () => throttle((x: number, y: number) => store.moveCursor(x, y), 40),
    [store],
  );

  // --- drawing state --------------------------------------------------------
  const drafting = useRef<{ startX: number; startY: number } | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Group>());

  // Attach the Transformer to the selected (resizable) node.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const selected = snapshot.shapes.find((s) => s.id === selectedId);
    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    if (node && selected && RESIZABLE.includes(selected.type)) {
      tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, snapshot.shapes, tool]);

  // --- pointer handlers -----------------------------------------------------

  const pointer = () => stageRef.current?.getPointerPosition() ?? null;

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = pointer();
    if (!pos) return;

    if (tool === 'select') {
      // Clicking empty canvas clears the selection.
      if (e.target === e.target.getStage()) onSelect(null);
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Text:');
      if (text) {
        store.createShape({
          id: crypto.randomUUID(),
          type: 'text',
          x: pos.x,
          y: pos.y,
          text,
          style: defaultStyle('text'),
        });
      }
      return;
    }

    // Start drawing a rect / ellipse / line / pen.
    drafting.current = { startX: pos.x, startY: pos.y };
    setDraft(makeDraft(tool as ShapeType, pos.x, pos.y));
  };

  const handleMouseMove = () => {
    const pos = pointer();
    if (!pos) return;
    sendCursor(pos.x, pos.y);

    const start = drafting.current;
    if (!start || !draft) return;
    setDraft(growDraft(draft, start.startX, start.startY, pos.x, pos.y));
  };

  const handleMouseUp = () => {
    const start = drafting.current;
    drafting.current = null;
    if (start && draft && isDraftValid(draft)) {
      const { version, deleted, ...base } = draft; // eslint-disable-line @typescript-eslint/no-unused-vars
      store.createShape(base);
    }
    setDraft(null);
  };

  // --- selected-node editing handlers --------------------------------------

  const registerNode = (id: string) => (node: Konva.Group | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  const handleDragMove = throttle((id: string, node: Konva.Group) => {
    store.updateShape(id, { x: node.x(), y: node.y() });
  }, 40);

  const handleDragEnd = (id: string, node: Konva.Group) => {
    store.updateShape(id, { x: node.x(), y: node.y() });
  };

  const handleTransformEnd = (shape: Shape, node: Konva.Group) => {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    store.updateShape(shape.id, {
      x: node.x(),
      y: node.y(),
      width: Math.max(5, (shape.width ?? 0) * scaleX),
      height: Math.max(5, (shape.height ?? 0) * scaleY),
    });
  };

  const editText = (shape: Shape) => {
    const next = window.prompt('Edit text:', shape.text ?? '');
    if (next != null) store.updateShape(shape.id, { text: next });
  };

  const selectMode = tool === 'select';

  return (
    <div ref={containerRef} className="canvas-container">
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ cursor: selectMode ? 'default' : 'crosshair' }}
      >
        {/* Shapes */}
        <Layer>
          {snapshot.shapes.map((shape) => (
            <ShapeNode
              key={shape.id}
              shape={shape}
              draggable={selectMode}
              registerRef={registerNode(shape.id)}
              onSelect={() => selectMode && onSelect(shape.id)}
              onDragMove={(node) => handleDragMove(shape.id, node)}
              onDragEnd={(node) => handleDragEnd(shape.id, node)}
              onTransformEnd={(node) => handleTransformEnd(shape, node)}
              onDblClick={() => shape.type === 'text' && editText(shape)}
            />
          ))}
          {draft && <ShapeNode shape={draft} draggable={false} listening={false} />}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            ignoreStroke
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
            }
          />
        </Layer>

        {/* Remote cursors */}
        <Layer listening={false}>
          {snapshot.presence.map((p) => (
            <Group key={p.clientId} x={p.cursor.x} y={p.cursor.y}>
              <Circle radius={5} fill={p.color} />
              <Rect
                x={6}
                y={-8}
                width={p.name.length * 7 + 12}
                height={18}
                fill={p.color}
                cornerRadius={4}
              />
              <Text text={p.name} x={12} y={-5} fontSize={12} fill="#fff" />
            </Group>
          ))}
        </Layer>
      </Stage>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single shape rendered inside a positioned Group.
// ---------------------------------------------------------------------------

interface ShapeNodeProps {
  shape: Shape;
  draggable: boolean;
  listening?: boolean;
  registerRef?: (node: Konva.Group | null) => void;
  onSelect?: () => void;
  onDragMove?: (node: Konva.Group) => void;
  onDragEnd?: (node: Konva.Group) => void;
  onTransformEnd?: (node: Konva.Group) => void;
  onDblClick?: () => void;
}

function ShapeNode({
  shape,
  draggable,
  listening = true,
  registerRef,
  onSelect,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onDblClick,
}: ShapeNodeProps) {
  const { style } = shape;
  return (
    <Group
      ref={registerRef}
      x={shape.x}
      y={shape.y}
      draggable={draggable}
      listening={listening}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragMove={(e) => onDragMove?.(e.target as Konva.Group)}
      onDragEnd={(e) => onDragEnd?.(e.target as Konva.Group)}
      onTransformEnd={(e) => onTransformEnd?.(e.target as Konva.Group)}
    >
      {shape.type === 'rect' && (
        <Rect
          width={shape.width}
          height={shape.height}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
        />
      )}
      {shape.type === 'ellipse' && (
        <Ellipse
          x={(shape.width ?? 0) / 2}
          y={(shape.height ?? 0) / 2}
          radiusX={(shape.width ?? 0) / 2}
          radiusY={(shape.height ?? 0) / 2}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
        />
      )}
      {shape.type === 'line' && (
        <Line
          points={shape.points ?? []}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          lineCap="round"
        />
      )}
      {shape.type === 'pen' && (
        <Line
          points={shape.points ?? []}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {shape.type === 'text' && (
        <Text
          text={shape.text ?? ''}
          fontSize={18}
          fill={style.fill}
          width={shape.width}
        />
      )}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Draft (in-progress) shape helpers.
// ---------------------------------------------------------------------------

function makeDraft(type: ShapeType, x: number, y: number): Shape {
  const base = {
    id: crypto.randomUUID(),
    type,
    style: defaultStyle(type),
    version: { lamport: 0, clientId: 'draft' },
    deleted: false,
  };
  if (type === 'line') return { ...base, x: 0, y: 0, points: [x, y, x, y] };
  if (type === 'pen') return { ...base, x: 0, y: 0, points: [x, y] };
  return { ...base, x, y, width: 0, height: 0 };
}

function growDraft(
  draft: Shape,
  startX: number,
  startY: number,
  curX: number,
  curY: number,
): Shape {
  if (draft.type === 'line') {
    return { ...draft, points: [startX, startY, curX, curY] };
  }
  if (draft.type === 'pen') {
    return { ...draft, points: [...(draft.points ?? []), curX, curY] };
  }
  // rect / ellipse: normalize the bounding box so dragging any direction works
  return {
    ...draft,
    x: Math.min(startX, curX),
    y: Math.min(startY, curY),
    width: Math.abs(curX - startX),
    height: Math.abs(curY - startY),
  };
}

function isDraftValid(draft: Shape): boolean {
  if (draft.type === 'line') {
    const p = draft.points ?? [];
    return Math.hypot(p[2] - p[0], p[3] - p[1]) > 3;
  }
  if (draft.type === 'pen') return (draft.points?.length ?? 0) >= 4;
  return (draft.width ?? 0) > 3 && (draft.height ?? 0) > 3;
}
