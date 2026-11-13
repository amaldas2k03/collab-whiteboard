import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhotoImport, photoImportToShapes } from '@shared/photoImport';

const sample = {
  text: [{ id: 't1', text: 'see (2)', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 } }],
  math: [{ id: 'm1', latex: 'E=mc^2', bbox: { x: 0.5, y: 0.1, w: 0.2, h: 0.1 } }],
  shapes: [
    { id: 's1', kind: 'rect', label: 'A', bbox: { x: 0, y: 0.5, w: 0.2, h: 0.2 } },
    { id: 's2', kind: 'diamond', label: '', bbox: { x: 0.6, y: 0.5, w: 0.2, h: 0.2 } },
  ],
  connectors: [
    { id: 'c1', from: 's1', to: 's2', label: '' },
    { id: 'c2', from: 's1', to: 'nope', label: '' },
  ],
  links: [{ fromId: 't1', toId: 'm1' }],
};

test('parsePhotoImport validates and drops dangling refs', () => {
  const data = parsePhotoImport(JSON.stringify(sample));
  assert.equal(data.connectors.length, 1);
  assert.throws(() => parsePhotoImport('{"text": 1}'), /invalid import/);
  assert.throws(() => parsePhotoImport('not json'), /not JSON/);
  assert.throws(
    () => parsePhotoImport({ ...sample, shapes: [{ ...sample.shapes[0], kind: 'star' }] }),
    /kind/,
  );
});

test('photoImportToShapes places, rewires ids and links', () => {
  let n = 0;
  const shapes = photoImportToShapes(
    parsePhotoImport(sample),
    { x: 100, y: 200, width: 1000, height: 500 },
    'data:image/jpeg;base64,xx',
    () => `id${n++}`,
  );
  assert.equal(shapes[0].type, 'image');
  const rect = shapes.find((s) => s.type === 'rect')!;
  assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [100, 450, 200, 100]);
  const arrow = shapes.find((s) => s.type === 'arrow')!;
  assert.equal(arrow.from, rect.id);
  // Arrow leaves the rect's right edge (x = 300) and lands on the diamond's left (x = 700).
  assert.deepEqual([arrow.x, arrow.x + arrow.points![2]], [300, 700]);
  const text = shapes.find((s) => s.type === 'text')!;
  assert.equal(text.link, shapes.find((s) => s.type === 'math')!.id);
});
