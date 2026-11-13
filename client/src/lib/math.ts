/**
 * math.ts — typeset LaTeX into an image Konva can draw.
 *
 * KaTeX emits MathML here rather than its HTML+CSS output: browsers render
 * MathML natively with system math fonts, so it survives being wrapped in an
 * SVG <foreignObject> and loaded as an image (which may not fetch the
 * KaTeX webfonts or stylesheet). The SVG stays vector, so it is crisp at any
 * zoom.
 */

import katex from 'katex';

export interface MathImage {
  src: string;
  width: number;
  height: number;
}

const FONT_PX = 32;
const cache = new Map<string, MathImage>();

export function renderLatex(latex: string): MathImage {
  const hit = cache.get(latex);
  if (hit) return hit;

  const el = document.createElement('div');
  el.innerHTML = katex.renderToString(latex, {
    output: 'mathml',
    displayMode: true,
    throwOnError: false,
  });
  el.style.cssText = `display:inline-block;white-space:nowrap;font-size:${FONT_PX}px;color:#1e1e1e;margin:0`;

  // Measure off-screen with the same styles the SVG will use.
  const probe = el.cloneNode(true) as HTMLDivElement;
  probe.style.position = 'absolute';
  probe.style.left = '-99999px';
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const width = Math.max(1, Math.ceil(rect.width) + 4);
  const height = Math.max(1, Math.ceil(rect.height) + 4);
  // XMLSerializer gives well-formed XHTML (with its namespace), which is what
  // foreignObject content inside an SVG image must be.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="2" y="2" width="100%" height="100%">${new XMLSerializer().serializeToString(el)}</foreignObject></svg>`;
  const out = { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width, height };
  cache.set(latex, out);
  return out;
}
