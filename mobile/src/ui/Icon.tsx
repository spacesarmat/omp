export const ICONS = {
  collapse: 'M6 9l6 6 6-6',
  remote: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4M10 16h4',
  prev: 'M18 6l-9 6 9 6zM6 6v12',
  next: 'M6 6l9 6-9 6zM18 6v12',
  back10: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  fwd10: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l11 7-11 7z',
  tracks: 'M3 6h18v12H3zM7 14h4M13 14h4M7 10h10',
  volume: 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7',
};

export function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
