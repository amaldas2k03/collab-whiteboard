/**
 * vision.ts — the swappable vision-model adapter behind photo import.
 *
 * The route only ever sees `VisionProvider`: hand it a photo, get back the
 * model's raw JSON text. Validation happens in the route against the shared
 * schema, so a provider never has to be trusted to get the shape right.
 *
 * To add a provider, write a factory that returns a `VisionProvider` (or null
 * when its key is missing) and register it in PROVIDERS; select it with
 * VISION_PROVIDER. API keys are read from the server's env and never leave it.
 */

import Anthropic from '@anthropic-ai/sdk';
import { PHOTO_IMPORT_SCHEMA } from '@shared/photoImport';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface VisionProvider {
  extract(image: Buffer, type: ImageType): Promise<string>;
}

/** A failure worth showing the user as-is, with the HTTP status to send. */
export class VisionError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export const PROMPT = `This is a photo of a whiteboard or handwritten notes. Convert it into structured notes.

Coordinates: every bbox is {x, y, w, h} normalised to the photo, 0..1 on both axes, origin top-left.

- text: each separate block of handwriting or print. Transcribe it faithfully; keep line breaks as \\n.
- math: each formula or equation, as LaTeX without surrounding $ delimiters. Do not repeat it in text.
- shapes: each drawn box (rect), circle/oval (ellipse) or rhombus (diamond) that is part of a diagram. Words written inside a shape are its label, not a separate text block.
- connectors: each arrow or line joining two shapes, with from/to set to their ids (from = the tail end). label is any text written on the arrow, or "".
- links: when one note explicitly refers to another (e.g. "see (2)", a footnote mark, a matching number), a link from the referring note's id to the referenced note's id.

Give every item a short id unique across the whole answer (t1, m1, s1, c1...). Return empty arrays for anything absent. Ignore the board's frame, glare and smudges.`;

function anthropic(): VisionProvider | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const model = process.env.VISION_MODEL || 'claude-opus-5';

  return {
    async extract(image, type) {
      let res: Anthropic.Message;
      try {
        res = await client.messages.create({
          model,
          max_tokens: 16000,
          output_config: { format: { type: 'json_schema', schema: PHOTO_IMPORT_SCHEMA } },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: type, data: image.toString('base64') },
                },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        });
      } catch (err) {
        console.error('[import] anthropic error', err);
        if (err instanceof Anthropic.RateLimitError) {
          throw new VisionError('The vision model is busy right now. Try again in a minute.', 429);
        }
        if (err instanceof Anthropic.AuthenticationError) {
          throw new VisionError('Photo import is misconfigured on the server (bad API key).', 503);
        }
        throw new VisionError('The vision model failed to respond. Try again.');
      }

      if (res.stop_reason === 'refusal') {
        throw new VisionError('The model declined to read this photo.', 422);
      }
      // A truncated answer is just invalid JSON; the route's retry handles it.
      return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    },
  };
}

const PROVIDERS: Record<string, () => VisionProvider | null> = { anthropic };

/** The configured provider, or null when it's unknown or has no key. */
export function getVisionProvider(): VisionProvider | null {
  return PROVIDERS[process.env.VISION_PROVIDER || 'anthropic']?.() ?? null;
}
