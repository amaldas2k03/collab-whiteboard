/**
 * importPhoto.ts — POST /api/import-photo.
 *
 * Body: the raw image bytes (Content-Type image/jpeg|png|webp).
 * 200:  a validated `PhotoImport` (see shared/photoImport.ts).
 * 4xx/5xx: `{ error }` with a message fit to show the user.
 *
 * The route never touches board state: the client maps the result to shapes
 * and creates them through the ordinary ws ops, so the import syncs, merges
 * and undoes like any other edit.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { parsePhotoImport } from '@shared/photoImport';
import { getVisionProvider, VisionError, type ImageType } from './vision.js';

export const IMPORT_PATH = '/api/import-photo';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);

/** Each import is a paid model call, so cap how often one address can run it. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6;
// shortcut: per-process memory, reset on restart; move to a shared store if the server is ever scaled out.
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 10_000) hits.clear();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_MAX;
}

/** Client address. Hosts like Render proxy us, so trust the hop they appended (the last). */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const last = (Array.isArray(fwd) ? fwd.join(',') : fwd ?? '').split(',').pop()?.trim();
  return last || req.socket.remoteAddress || 'unknown';
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function tooLarge(res: ServerResponse): void {
  send(res, 413, { error: 'Photo too large — the limit is 5 MB.' });
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleImportPhoto(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // The client is served from another origin (Vercel), so answer CORS.
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });

  const type = (req.headers['content-type'] ?? '').split(';')[0].trim();
  if (!TYPES.has(type)) return send(res, 415, { error: 'Upload a JPEG, PNG or WebP photo.' });
  if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) return tooLarge(res);
  if (rateLimited(clientIp(req))) {
    return send(res, 429, { error: 'Too many imports — wait a minute and try again.' });
  }

  const provider = getVisionProvider();
  if (!provider) return send(res, 503, { error: 'Photo import is not configured on this server.' });

  try {
    const image = await readBody(req);
    if (!image) return tooLarge(res);
    if (image.length === 0) return send(res, 400, { error: 'The upload was empty.' });

    // One retry: a malformed answer is usually a one-off.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await provider.extract(image, type as ImageType);
      try {
        return send(res, 200, parsePhotoImport(raw));
      } catch (err) {
        console.warn(`[import] attempt ${attempt}: ${(err as Error).message}`);
      }
    }
    send(res, 502, {
      error: "The model's answer couldn't be read, even after a retry. Try a sharper, closer photo.",
    });
  } catch (err) {
    if (err instanceof VisionError) return send(res, err.status, { error: err.message });
    console.error('[import] failed', err);
    if (!res.headersSent) send(res, 500, { error: 'Photo import failed on the server.' });
  }
}
