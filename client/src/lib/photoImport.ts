/**
 * photoImport.ts — the client half of "photo -> living notes".
 *
 * Shrinks the photo in the browser (a phone camera shot is far bigger than
 * the model needs), posts it to the server, and returns the validated result.
 * Turning that into shapes is shared/photoImport.ts; creating them is the
 * store's job, so this file never touches board state.
 */

import { parsePhotoImport, type PhotoImport } from '@shared/photoImport';
import { HTTP_BASE } from './connection';

const MAX_SIDE = 2000;

export interface PreparedPhoto {
  blob: Blob;
  /** The same JPEG as a data: URL, for the faded reference layer. */
  dataUrl: string;
  width: number;
  height: number;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error("That file isn't an image.");
  let bmp: ImageBitmap;
  try {
    // Applies the EXIF rotation, so portrait phone shots come out upright.
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. HEIC photos may need converting to JPEG first.");
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * k);
  const height = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, dataUrl, width, height };
}

export async function requestImport(blob: Blob): Promise<PhotoImport> {
  let res: Response;
  try {
    res = await fetch(`${HTTP_BASE}/api/import-photo`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Photo import failed (HTTP ${res.status}).`);
  return parsePhotoImport(body);
}

/** True when the model found nothing worth putting on the board. */
export function isEmptyImport(data: PhotoImport): boolean {
  return data.text.length + data.math.length + data.shapes.length === 0;
}
