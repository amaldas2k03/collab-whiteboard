/**
 * Icon.tsx — the app's icon set as inline SVG.
 *
 * Emoji and unicode glyphs render inconsistently across platforms (and can't
 * inherit stroke weight), so every icon here is a 24x24 path drawn with
 * `currentColor`. They share one grid and one stroke width, which is what makes
 * the toolbar read as a single set.
 */

export type IconName =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlight'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'curve'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'note'
  | 'fill'
  | 'spotlight'
  | 'trash'
  | 'undo'
  | 'redo'
  | 'front'
  | 'back'
  | 'duplicate'
  | 'download'
  | 'grid'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'help'
  | 'close';

/** Path data only — the wrapper below supplies the shared stroke attributes. */
const PATHS: Record<IconName, JSX.Element> = {
  select: <path d="M5 3 L19 12 L12.5 13.2 L15.8 19.7 L13 21 L9.8 14.5 L5 18 Z" />,
  hand: (
    <>
      <path d="M8 12.5V6.2a1.4 1.4 0 1 1 2.8 0v5" />
      <path d="M10.8 11V4.9a1.4 1.4 0 1 1 2.8 0V11" />
      <path d="M13.6 11.2V6.4a1.4 1.4 0 1 1 2.8 0v7" />
      <path d="M16.4 10.4a1.4 1.4 0 0 1 2.8 0v4.2c0 3.4-2.4 6.4-6 6.4-3.3 0-5-1.6-6.4-4l-2.2-3.8a1.4 1.4 0 0 1 2.3-1.6l1.9 2.4" />
    </>
  ),
  pen: (
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8.4 17.6 4 20l2.4-4.4Z" />
      <path d="M14.5 5.5l3 3" />
    </>
  ),
  highlight: (
    <>
      <path d="M13 4.5 19.5 11l-6.7 6.7H6.3L4 15.4Z" />
      <path d="M9.5 17.7 15 12.2" />
      <path d="M3 21h18" strokeWidth="2.6" />
    </>
  ),
  eraser: (
    <>
      <path d="M8.6 18.9 3.7 14a1.8 1.8 0 0 1 0-2.6l8-8a1.8 1.8 0 0 1 2.6 0l6 6a1.8 1.8 0 0 1 0 2.6l-6.9 6.9Z" />
      <path d="M8.5 7.2 16.8 15.5" />
      <path d="M9 21h12" />
    </>
  ),
  line: <path d="M4 20 20 4" />,
  arrow: (
    <>
      <path d="M4 20 19 5" />
      <path d="M12.5 5H19v6.5" />
    </>
  ),
  curve: (
    <>
      <path d="M3.5 18.5C3.5 9 9 3.5 20.5 5.5" />
      <circle cx="4" cy="18.5" r="1.8" />
      <circle cx="20" cy="5.5" r="1.8" />
    </>
  ),
  rect: <rect x="3.5" y="5.5" width="17" height="13" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  text: (
    <>
      <path d="M5 6V4.5h14V6" />
      <path d="M12 4.5v15" />
      <path d="M8.5 19.5h7" />
    </>
  ),
  note: (
    <>
      <path d="M4.5 4.5h15v9.5l-5.5 5.5h-9.5Z" />
      <path d="M19.5 14H14v5.5" />
      <path d="M8 9h8" />
    </>
  ),
  fill: (
    <>
      <path d="M9 3.5 18.8 13.3a1.5 1.5 0 0 1 0 2.1l-5.4 5.4a1.5 1.5 0 0 1-2.1 0L4 14a1.5 1.5 0 0 1 0-2.1Z" />
      <path d="M6 11.5h13" />
      <path d="M21 16.5c0 1.4-.9 2.5-2 2.5s-2-1.1-2-2.5 2-3.5 2-3.5 2 2.1 2 3.5Z" />
    </>
  ),
  spotlight: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" />
      <path d="M5.2 5.2 6.8 6.8M17.2 17.2l1.6 1.6M18.8 5.2 17.2 6.8M6.8 17.2 5.2 18.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.2h5v2.3" />
      <path d="M6.2 6.5 7 19.4a1.6 1.6 0 0 0 1.6 1.4h6.8A1.6 1.6 0 0 0 17 19.4l.8-12.9" />
      <path d="M10.3 10.5v6M13.7 10.5v6" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9.5h9.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="M8 5 3.5 9.5 8 14" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9.5h-9.5a5.5 5.5 0 0 0 0 11H16" />
      <path d="M16 5l4.5 4.5L16 14" />
    </>
  ),
  front: (
    <>
      <rect x="3.5" y="3.5" width="12" height="12" rx="1.8" />
      <path d="M8.5 20.5h12v-12" strokeDasharray="3 2.5" />
    </>
  ),
  back: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="1.8" />
      <path d="M15.5 3.5h-12v12" strokeDasharray="3 2.5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v12" />
      <path d="M7.5 11 12 15.5 16.5 11" />
      <path d="M4 18.5v1a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: (
    <>
      <path d="M3.5 8.5v-5h5M20.5 8.5v-5h-5M3.5 15.5v5h5M20.5 15.5v5h-5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.8.7-.8 1.2v.6" />
      <path d="M12 17.2v.1" strokeWidth="2.4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 20, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
