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
  sort: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  'view-large': 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  'view-small': 'M3 3h5v5H3zM9.5 3h5v5h-5zM16 3h5v5h-5zM3 10h5v5H3zM9.5 10h5v5h-5zM16 10h5v5h-5zM3 17h5v4H3zM9.5 17h5v4h-5zM16 17h5v4h-5z',
  'view-list': 'M3 5h4v4H3zM10 6h11M10 8h7M3 15h4v4H3zM10 16h11M10 18h7',
  'view-compact': 'M3 6h18M3 12h18M3 18h18',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
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
