/**
 * Canvas.tsx — the react-konva drawing surface.
 *
 * Coordinate spaces
 * -----------------
 * The board is an unbounded plane. The Stage carries a pan/zoom transform
 * (`view`), so there are two coordinate spaces in play:
 *
 *   world  — the board's own coordinates. Shapes, cursors and hit-tests all
 *            live here, which is what lets two people at different zoom levels
 *            point at the same thing.
 *   screen — container pixels. Only the DOM overlays (text editor, spotlight,
 *            eraser ring, HUD) work in this space.
 *
 * `stage.getRelativePointerPosition()` maps screen -> world; the small helpers
 * at the bottom of this file map world -> screen for the overlays.
 *
 * Responsibilities:
 *   - render every non-deleted shape in stacking order
 *   - draw new shapes (down-drag-up) and commit them on release
 *   - select / move / rotate / resize existing shapes (Konva Transformer)
 *   - erase, paint-bucket, spotlight, and in-place text editing
 *   - pan + zoom the viewport, and export the board as a PNG
 *   - broadcast the local cursor and render remote users' cursors
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  Stage,
  Layer,
  Rect,
  Line,
  Text,
  Group,
  Transformer,
  Circle,
} from 'react-konva';
import type Konva from 'konva';
import type { Shape, ShapeChanges, ShapeType } from '@shared/protocol';
import type { BoardStore, Snapshot } from '../lib/store';
import { styleFor, type DrawStyle, type Tool } from '../lib/tools';
import {
  contentBounds,
  distanceToShape,
  isPointShape,
  isTextShape,
  scalePoints,
  shapeAt,
  type Box,
} from '../lib/geometry';
import {
  finalizeDraft,
  growDraft,
  isDraftValid,
  makeDraft,
  NOTE_SIZE,
  TEXT_WIDTH,
} from '../lib/drafts';
import { ShapeNode } from './ShapeNode';
import { throttle } from '../lib/throttle';

/** Imperative hooks the toolbar/keyboard need to reach into the viewport. */
export interface CanvasApi {
  exportPng: () => void;
  fitToContent: () => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
}

interface Props {
  store: BoardStore;
  tool: Tool;
  onToolChange: (t: Tool) => void;
  snapshot: Snapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  draw: DrawStyle;
  showGrid: boolean;
  roomId: string;
  apiRef: MutableRefObject<CanvasApi | null>;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

interface Editing {
  /**
   * Unique per editing session, used as the editor's React key. Two successive
   * sessions can both have `id: null` (two new text boxes in a row), and
   * without this React would treat the second as an update of the first —
   * leaving the field unmounted-but-reused, and therefore never focused.
   */
  token: string;
  /** null while composing a brand-new text box. */
  id: string | null;
  type: 'text' | 'note';
  world: { x: number; y: number };
  width: number;
  height: number;
  fontSize: number;
  value: string;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
/** World units between grid lines at 100% zoom. */
const GRID = 24;
/** Eraser brush radius in *screen* pixels, so it feels the same at any zoom. */
const ERASER_RADIUS = 14;
/** Tools that stay active after a stroke, because you rarely draw just one. */
const STICKY_TOOLS: Tool[] = ['pen', 'highlight', 'eraser', 'fill', 'hand'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function Canvas({
  store,
  tool,
  onToolChange,
  snapshot,
  selectedId,
  onSelect,
  draw,
  showGrid,
  roomId,
  apiRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const overlayRef = useRef<Konva.Layer>(null);
  const exportBgRef = useRef<Konva.Rect>(null);
  const nodeRefs = useRef(new Map<string, Konva.Group>());

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

  // --- live cursor broadcast (throttled, in world coordinates) -------------
  const sendCursor = useMemo(
    () => throttle((x: number, y: number) => store.moveCursor(x, y), 40),
    [store],
  );

  // --- interaction state ----------------------------------------------------
  const drafting = useRef<{ startX: number; startY: number } | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);

  const erasing = useRef(false);
  /** Shapes already removed by the current eraser stroke — never re-delete. */
  const erasedThisStroke = useRef(new Set<string>());
  const [brush, setBrush] = useState<{ x: number; y: number } | null>(null);

  const spotStart = useRef<{ x: number; y: number } | null>(null);
  const [spotlight, setSpotlight] = useState<Box | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  /** Token of the editing session already committed — see commitEditor. */
  const committedToken = useRef<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const selected = useMemo(
    () => snapshot.shapes.find((s) => s.id === selectedId) ?? null,
    [snapshot.shapes, selectedId],
  );

  const selectMode = tool === 'select';
  const panMode = tool === 'hand' || spaceDown;

  // --- viewport -------------------------------------------------------------

  /** Zoom about a screen-space anchor (defaults to the viewport centre). */
  const zoomTo = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      setView((v) => {
        const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
        const ax = anchor?.x ?? size.width / 2;
        const ay = anchor?.y ?? size.height / 2;
        // Keep the world point under the anchor pinned to the anchor.
        const wx = (ax - v.x) / v.scale;
        const wy = (ay - v.y) / v.scale;
        return { scale, x: ax - wx * scale, y: ay - wy * scale };
      });
    },
    [size.width, size.height],
  );

  const zoomBy = useCallback(
    (factor: number) => setView((v) => {
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const cx = size.width / 2;
      const cy = size.height / 2;
      const wx = (cx - v.x) / v.scale;
      const wy = (cy - v.y) / v.scale;
      return { scale, x: cx - wx * scale, y: cy - wy * scale };
    }),
    [size.width, size.height],
  );

  const resetZoom = useCallback(() => zoomTo(1), [zoomTo]);

  const fitToContent = useCallback(() => {
    const box = contentBounds(snapshot.shapes);
    if (!box || size.width === 0) return resetZoom();
    const pad = 64;
    const scale = clamp(
      Math.min(
        (size.width - pad * 2) / Math.max(box.width, 1),
        (size.height - pad * 2) / Math.max(box.height, 1),
      ),
      MIN_SCALE,
      // Don't blow a single tiny shape up to 8x — 100% is close enough.
      1,
    );
    setView({
      scale,
      x: size.width / 2 - (box.x + box.width / 2) * scale,
      y: size.height / 2 - (box.y + box.height / 2) * scale,
    });
  }, [snapshot.shapes, size.width, size.height, resetZoom]);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pos = stageRef.current?.getPointerPosition() ?? undefined;
    // Ctrl/Cmd + wheel is the universal zoom gesture, and trackpad pinch
    // arrives as a ctrl-wheel too. A plain wheel scrolls the board instead.
    if (e.evt.ctrlKey || e.evt.metaKey) {
      zoomTo(view.scale * Math.exp(-e.evt.deltaY * 0.0015), pos);
    } else {
      setView((v) => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY }));
    }
  };

  // --- export ---------------------------------------------------------------

  const exportPng = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = contentBounds(snapshot.shapes);
    if (!box) return;

    const pad = 32;
    const s = view.scale;
    // Konva re-renders the scene graph into a fresh canvas for this rect, so
    // content scrolled off-screen is still captured.
    const rect = {
      x: view.x + (box.x - pad) * s,
      y: view.y + (box.y - pad) * s,
      width: (box.width + pad * 2) * s,
      height: (box.height + pad * 2) * s,
    };
    // Aim for ~2x world resolution, but never ask for an absurd bitmap.
    const ratio = clamp(2 / s, 0.5, 4);
    const capped = Math.min(ratio, 8000 / Math.max(rect.width, rect.height, 1));

    overlayRef.current?.hide();
    exportBgRef.current?.show();
    let url: string;
    try {
      url = stage.toDataURL({ ...rect, pixelRatio: Math.max(0.25, capped) });
    } finally {
      exportBgRef.current?.hide();
      overlayRef.current?.show();
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${roomId}.png`;
    a.click();
  }, [snapshot.shapes, view.x, view.y, view.scale, roomId]);

  // Publish the imperative API for the toolbar and the keyboard shortcuts.
  useLayoutEffect(() => {
    apiRef.current = { exportPng, fitToContent, zoomBy, resetZoom };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, exportPng, fitToContent, zoomBy, resetZoom]);

  // --- keyboard: zoom, space-to-pan, escape --------------------------------

  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !typing(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (e.key === 'Escape') {
        setSpotlight(null);
        spotStart.current = null;
        return;
      }
      if (typing(e.target)) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomBy(1.25);
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          zoomBy(0.8);
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        }
      } else if (e.key === '1') {
        resetZoom();
      } else if (e.key === '2') {
        fitToContent();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    // A lost window focus would otherwise leave us stuck in pan mode.
    const onBlur = () => setSpaceDown(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [zoomBy, resetZoom, fitToContent]);

  // --- transformer ----------------------------------------------------------

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    // Everything is resizable now, but only while the select tool is active
    // and the shape is not currently being retyped.
    tr.nodes(node && selected && selectMode && !editing ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, selected, snapshot.shapes, selectMode, editing]);

  // --- pointer --------------------------------------------------------------

  /** Pointer position in world coordinates. */
  const worldPointer = () =>
    stageRef.current?.getRelativePointerPosition() ?? null;

  const eraseAt = (wx: number, wy: number) => {
    const radius = ERASER_RADIUS / view.scale;
    const hits = snapshot.shapes.filter(
      (s) =>
        !erasedThisStroke.current.has(s.id) &&
        distanceToShape(s, wx, wy) <= radius,
    );
    if (hits.length === 0) return;
    hits.forEach((s) => erasedThisStroke.current.add(s.id));
    store.deleteShapes(hits.map((s) => s.id));
    if (selectedId && hits.some((s) => s.id === selectedId)) onSelect(null);
  };

  /** Paint bucket: recolor whatever is under the click. */
  const bucketFill = (shape: Shape) => {
    if (isPointShape(shape.type)) {
      // Strokes have no interior, so the bucket recolors the ink instead.
      store.updateStyle(shape.id, { stroke: draw.stroke });
    } else if (shape.type === 'text') {
      store.updateStyle(shape.id, { fill: draw.stroke, stroke: draw.stroke });
    } else {
      store.updateStyle(shape.id, { fill: draw.fill });
    }
  };

  const openEditor = (shape: Shape) => {
    if (!isTextShape(shape.type)) return;
    setEditing({
      token: crypto.randomUUID(),
      id: shape.id,
      type: shape.type as 'text' | 'note',
      world: { x: shape.x, y: shape.y },
      width: shape.width ?? (shape.type === 'note' ? NOTE_SIZE.width : TEXT_WIDTH),
      height: shape.height ?? 0,
      fontSize: shape.style.fontSize ?? (shape.type === 'note' ? 15 : 18),
      value: shape.text ?? '',
    });
  };

  /**
   * Finish an editing session. Two things can ask for this on the same click —
   * the pointer-down handler that is opening the *next* editor, and the field's
   * own blur — so it is keyed on the session token and runs at most once.
   * Without the guard a click-away could commit the same new text box twice,
   * creating two shapes.
   */
  const commitEditor = (next: Editing | null) => {
    const current = next ?? editing;
    if (!current) return;
    if (committedToken.current === current.token) return;
    committedToken.current = current.token;

    setEditing(null);
    const text = current.value.trim();

    if (current.id) {
      const existing = store.getShape(current.id);
      if (!existing) return;
      // A text box emptied out is a deletion; an emptied sticky note keeps its
      // card, because the card itself is the artefact people move around.
      if (!text && current.type === 'text') store.deleteShape(current.id);
      else if (text !== (existing.text ?? '')) {
        store.updateShape(current.id, { text });
      }
      return;
    }

    if (!text) return;
    const shape = store.createShape({
      id: crypto.randomUUID(),
      type: current.type,
      x: current.world.x,
      y: current.world.y,
      width: current.width,
      ...(current.type === 'note' ? { height: current.height } : {}),
      text,
      // Same resolver the rest of the tools use, so a note picks up its
      // fallback paper color instead of committing as an invisible outline.
      style: { ...styleFor(current.type, draw), fontSize: current.fontSize },
    });
    onSelect(shape.id);
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (panMode) return; // the Stage's own drag handles panning
    const pos = worldPointer();
    if (!pos) return;
    const onEmptyCanvas = e.target === e.target.getStage();

    if (editing) commitEditor(null);

    switch (tool) {
      case 'select':
        if (onEmptyCanvas) onSelect(null);
        return;

      case 'eraser':
        erasing.current = true;
        erasedThisStroke.current = new Set();
        eraseAt(pos.x, pos.y);
        return;

      case 'fill': {
        // `solid`: clicking inside an un-filled outline is how you fill it.
        const hit = shapeAt(snapshot.shapes, pos.x, pos.y, 0, true);
        if (hit) bucketFill(hit);
        return;
      }

      case 'spotlight':
        spotStart.current = { x: pos.x, y: pos.y };
        setSpotlight({ x: pos.x, y: pos.y, width: 0, height: 0 });
        return;

      case 'text':
        // Suppress the default focus shift: without this the browser moves
        // focus to the stage on mouse-up, blurring the editor we are about to
        // mount and committing it empty before a key is ever pressed.
        e.evt?.preventDefault?.();
        setEditing({
          token: crypto.randomUUID(),
          id: null,
          type: 'text',
          world: { x: pos.x, y: pos.y },
          width: TEXT_WIDTH,
          height: 0,
          fontSize: 18,
          value: '',
        });
        return;

      case 'note': {
        e.evt?.preventDefault?.();
        setEditing({
          token: crypto.randomUUID(),
          id: null,
          type: 'note',
          world: { x: pos.x - NOTE_SIZE.width / 2, y: pos.y - NOTE_SIZE.height / 2 },
          width: NOTE_SIZE.width,
          height: NOTE_SIZE.height,
          fontSize: 15,
          value: '',
        });
        return;
      }

      default:
        drafting.current = { startX: pos.x, startY: pos.y };
        setDraft(makeDraft(tool as ShapeType, pos.x, pos.y, draw));
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = worldPointer();
    if (!pos) return;
    sendCursor(pos.x, pos.y);

    if (tool === 'eraser') {
      setBrush(stageRef.current?.getPointerPosition() ?? null);
      if (erasing.current) eraseAt(pos.x, pos.y);
      return;
    }

    if (spotStart.current) {
      const s = spotStart.current;
      setSpotlight({
        x: Math.min(s.x, pos.x),
        y: Math.min(s.y, pos.y),
        width: Math.abs(pos.x - s.x),
        height: Math.abs(pos.y - s.y),
      });
      return;
    }

    const start = drafting.current;
    if (!start || !draft) return;
    setDraft(growDraft(draft, start.startX, start.startY, pos.x, pos.y, e.evt?.shiftKey));
  };

  const handleMouseUp = () => {
    if (erasing.current) {
      erasing.current = false;
      erasedThisStroke.current.clear();
      store.sealHistory();
      return;
    }

    if (spotStart.current) {
      spotStart.current = null;
      // A click rather than a drag means "clear the spotlight".
      setSpotlight((box) =>
        box && box.width > 20 && box.height > 20 ? box : null,
      );
      return;
    }

    const start = drafting.current;
    drafting.current = null;
    if (start && draft && isDraftValid(draft)) {
      const shape = store.createShape(finalizeDraft(draft));
      // One-shot tools hand the board back to Select with the new shape live,
      // so the obvious next move (nudge it, restyle it) just works.
      if (!STICKY_TOOLS.includes(tool)) {
        onSelect(shape.id);
        onToolChange('select');
      }
    }
    setDraft(null);
    store.sealHistory();
  };

  // --- selected-node editing handlers --------------------------------------

  const registerNode = (id: string) => (node: Konva.Group | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  // Reads the node's position when it *fires*, not when it was queued, so a
  // trailing call can never send a stale position.
  const dragMove = useMemo(
    () =>
      throttle((id: string, node: Konva.Group) => {
        store.updateShape(id, { x: node.x(), y: node.y() }, `drag:${id}`);
      }, 40),
    [store],
  );

  const handleDragEnd = (id: string, node: Konva.Group) => {
    // Drop any queued frame first: this write is the authoritative one, and a
    // late duplicate would also tack a no-op step onto the undo history.
    dragMove.cancel();
    store.updateShape(id, { x: node.x(), y: node.y() }, `drag:${id}`);
    store.sealHistory();
  };

  const handleTransformEnd = (shape: Shape, node: Konva.Group) => {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    // Konva expresses the resize as a node scale; bake it into the shape's own
    // geometry and reset the scale so the next transform starts from 1.
    node.scaleX(1);
    node.scaleY(1);

    const changes: ShapeChanges = {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
    };

    if (isPointShape(shape.type)) {
      changes.points = scalePoints(shape.points ?? [], scaleX, scaleY);
    } else {
      changes.width = Math.max(4, (shape.width ?? 0) * scaleX);
      changes.height = Math.max(4, (shape.height ?? 0) * scaleY);
    }

    if (shape.type === 'text') {
      // Text reflows to the new width; scale the glyphs by the vertical factor
      // so dragging a corner reads as "make this bigger".
      changes.style = {
        ...shape.style,
        fontSize: Math.max(6, (shape.style.fontSize ?? 18) * scaleY),
      };
      changes.height = undefined;
    }

    store.updateShape(shape.id, changes);
    store.sealHistory();
  };

  /** Drag the curve's control point to change how it bows. */
  const handleCurveControl = (shape: Shape, node: Konva.Circle) => {
    const pts = shape.points ?? [];
    if (pts.length < 6) return;
    store.updateShape(
      shape.id,
      { points: [pts[0], pts[1], node.x(), node.y(), pts[4], pts[5]] },
      `curve:${shape.id}`,
    );
  };

  const cursor = panMode
    ? spaceDown && tool !== 'hand'
      ? 'grab'
      : 'grab'
    : tool === 'select'
      ? 'default'
      : tool === 'eraser'
        ? 'none'
        : tool === 'text' || tool === 'note'
          ? 'text'
          : 'crosshair';

  const curveSelected =
    selected?.type === 'curve' && selectMode && (selected.points?.length ?? 0) >= 6
      ? selected
      : null;

  // Drop grid tiers as they stop being legible — a 2px lattice zoomed far out
  // is just a grey wash, so the minor lines go first and then the major ones.
  const minorPx = GRID * view.scale;
  const majorPx = minorPx * 5;
  // Both tiers when the fine lattice is still legible; only the coarse one once
  // it isn't; nothing at all when even that would be a grey wash.
  const gridClass = !showGrid
    ? ''
    : minorPx >= 9
      ? 'with-grid-major'
      : majorPx >= 9
        ? 'with-grid'
        : '';

  return (
    <div
      ref={containerRef}
      className={`canvas-container ${gridClass}`}
      style={
        {
          // In the coarse-only tier the single-grid rule draws `--grid-size`,
          // so hand it the major spacing.
          '--grid-size': `${gridClass === 'with-grid' ? majorPx : minorPx}px`,
          '--grid-major': `${majorPx}px`,
          '--grid-x': `${view.x}px`,
          '--grid-y': `${view.y}px`,
        } as React.CSSProperties
      }
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={panMode}
        onDragEnd={(e) => {
          if (e.target !== e.target.getStage()) return;
          const stage = e.target as Konva.Stage;
          setView((v) => ({ ...v, x: stage.x(), y: stage.y() }));
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setBrush(null);
          handleMouseUp();
        }}
        onTouchStart={(e) =>
          handleMouseDown(e as unknown as Konva.KonvaEventObject<MouseEvent>)
        }
        onTouchMove={(e) =>
          handleMouseMove(e as unknown as Konva.KonvaEventObject<MouseEvent>)
        }
        onTouchEnd={handleMouseUp}
        style={{ cursor }}
      >
        {/* Opaque backdrop, shown only while rasterising a PNG export. */}
        <Layer listening={false}>
          <Rect
            ref={exportBgRef}
            x={-500000}
            y={-500000}
            width={1000000}
            height={1000000}
            fill="#ffffff"
            visible={false}
          />
        </Layer>

        {/* Shapes */}
        <Layer>
          {snapshot.shapes.map((shape) => (
            <ShapeNode
              key={shape.id}
              shape={shape}
              draggable={selectMode}
              // Hide the original while its text is being edited in the
              // overlay, so the two don't double up on screen.
              listening={editing?.id !== shape.id}
              registerRef={registerNode(shape.id)}
              onSelect={() => selectMode && onSelect(shape.id)}
              onDragMove={(node) => dragMove(shape.id, node)}
              onDragEnd={(node) => handleDragEnd(shape.id, node)}
              onTransformEnd={(node) => handleTransformEnd(shape, node)}
              onDblClick={() => selectMode && openEditor(shape)}
            />
          ))}
          {draft && <ShapeNode shape={draft} draggable={false} listening={false} />}
          <Transformer
            ref={trRef}
            rotateEnabled
            flipEnabled={false}
            ignoreStroke
            // Anchors live in world space, so divide by the zoom to keep them a
            // constant size on screen.
            anchorSize={8 / view.scale}
            anchorStrokeWidth={1 / view.scale}
            borderStrokeWidth={1 / view.scale}
            rotateAnchorOffset={24 / view.scale}
            anchorStroke="#4f46e5"
            borderStroke="#4f46e5"
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
            }
          />
        </Layer>

        {/* Overlay: curve handle + remote cursors. Hidden during export. */}
        <Layer ref={overlayRef}>
          {curveSelected && (
            <CurveHandle
              shape={curveSelected}
              scale={view.scale}
              onDragMove={(node) => handleCurveControl(curveSelected, node)}
              onDragEnd={() => store.sealHistory()}
            />
          )}

          {snapshot.presence.map((p) => (
            // Counter-scale so the cursor badge stays a constant size however
            // far the viewer is zoomed in or out.
            <Group
              key={p.clientId}
              x={p.cursor.x}
              y={p.cursor.y}
              scaleX={1 / view.scale}
              scaleY={1 / view.scale}
              listening={false}
            >
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

      {/* --- DOM overlays (screen space) ----------------------------------- */}

      {spotlight && (
        <div
          className="spotlight"
          style={worldRectToScreen(spotlight, view)}
          aria-hidden="true"
        />
      )}

      {tool === 'eraser' && brush && (
        <div
          className="eraser-brush"
          style={{
            left: brush.x,
            top: brush.y,
            width: ERASER_RADIUS * 2,
            height: ERASER_RADIUS * 2,
          }}
          aria-hidden="true"
        />
      )}

      {editing && (
        <TextEditor
          key={editing.token}
          editing={editing}
          view={view}
          color={editing.type === 'note' ? '#1f2937' : draw.stroke}
          background={
            editing.type === 'note'
              ? draw.fill === 'transparent'
                ? '#fef08a'
                : draw.fill
              : // A plain text box has no card behind it, so give the editor a
                // near-opaque sheet to stay readable over whatever it covers.
                'rgba(255,255,255,0.94)'
          }
          onChange={(value) => setEditing((s) => (s ? { ...s, value } : s))}
          onCommit={(value) => commitEditor({ ...editing, value })}
        />
      )}

      {spotlight && (
        <div className="focus-banner">
          Focus mode — drag to re-frame, <kbd>Esc</kbd> to clear
        </div>
      )}

      <div className="hud">
        <button
          className="hud-btn"
          title="Zoom out — Ctrl+-"
          aria-label="Zoom out"
          onClick={() => zoomBy(0.8)}
        >
          −
        </button>
        <button
          className="hud-zoom"
          title="Reset to 100% — 1"
          onClick={resetZoom}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          className="hud-btn"
          title="Zoom in — Ctrl+="
          aria-label="Zoom in"
          onClick={() => zoomBy(1.25)}
        >
          +
        </button>
        <span className="hud-sep" />
        <button
          className="hud-btn wide"
          title="Zoom to fit everything — 2"
          onClick={fitToContent}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curve control handle
// ---------------------------------------------------------------------------

function CurveHandle({
  shape,
  scale,
  onDragMove,
  onDragEnd,
}: {
  shape: Shape;
  scale: number;
  onDragMove: (node: Konva.Circle) => void;
  onDragEnd: () => void;
}) {
  const pts = shape.points ?? [];
  const [x0, y0, cx, cy, x1, y1] = pts;
  return (
    <Group x={shape.x} y={shape.y} rotation={shape.rotation ?? 0}>
      <Line
        points={[x0, y0, cx, cy, x1, y1]}
        stroke="#4f46e5"
        strokeWidth={1 / scale}
        dash={[4 / scale, 4 / scale]}
        opacity={0.6}
        listening={false}
      />
      <Circle
        x={cx}
        y={cy}
        radius={7 / scale}
        fill="#ffffff"
        stroke="#4f46e5"
        strokeWidth={2 / scale}
        draggable
        onDragMove={(e) => onDragMove(e.target as Konva.Circle)}
        onDragEnd={onDragEnd}
      />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// In-place text editor
// ---------------------------------------------------------------------------

function TextEditor({
  editing,
  view,
  color,
  background,
  onChange,
  onCommit,
}: {
  editing: Editing;
  view: View;
  color: string;
  background: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Guards the blur handler: never commit before the field ever had focus. */
  const focused = useRef(false);

  // Focus synchronously during commit rather than from a timer or an animation
  // frame: both are throttled in a backgrounded tab, which would leave the
  // field open but dead. Safe to do here because the mousedown that opens the
  // editor calls preventDefault, so nothing steals focus back afterwards.
  // The caller gives each editing session its own key, so this runs per open.
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const isNote = editing.type === 'note';
  const pad = isNote ? 12 : 0;

  return (
    <textarea
      ref={ref}
      className={`text-editor ${isNote ? 'as-note' : ''}`}
      value={editing.value}
      spellCheck={false}
      style={{
        left: view.x + editing.world.x * view.scale,
        top: view.y + editing.world.y * view.scale,
        width: editing.width * view.scale,
        height: isNote ? editing.height * view.scale : undefined,
        padding: pad * view.scale,
        fontSize: editing.fontSize * view.scale,
        lineHeight: isNote ? 1.35 : 1.3,
        color,
        background,
      }}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(e) => {
        if (focused.current) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        // Enter adds a line; Escape and Ctrl/Cmd+Enter both finish the edit.
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.stopPropagation();
          onCommit(e.currentTarget.value);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------

/** World-space box -> absolutely-positioned screen rect for a DOM overlay. */
function worldRectToScreen(box: Box, view: View): React.CSSProperties {
  return {
    left: view.x + box.x * view.scale,
    top: view.y + box.y * view.scale,
    width: box.width * view.scale,
    height: box.height * view.scale,
  };
}
