const FRAME: any = { fill: 'none', stroke: '#F5B700', 'stroke-width': '7' };
const PLAY: any = { fill: '#E8EAF0', stroke: '#E8EAF0', 'stroke-width': '4', 'stroke-linejoin': 'round' };
const HOLES = [23, 35, 47, 59, 71];

/** OMP logo, variant D (film frame with play). */
export function Logo(p: { size?: number; tile?: boolean }) {
  const size = p.size || 64;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" class="logo">
      {p.tile && <rect x="0" y="0" width="100" height="100" rx="20" fill="#181B22"></rect>}
      <rect x="14" y="22" width="72" height="56" rx="10" {...FRAME}></rect>
      {HOLES.map((x) => <rect key={'t' + x} x={x} y="29" width="6" height="5" rx="1.5" fill="#F5B700"></rect>)}
      {HOLES.map((x) => <rect key={'b' + x} x={x} y="66" width="6" height="5" rx="1.5" fill="#F5B700"></rect>)}
      <path d="M44 41 L59 50 L44 59 Z" {...PLAY}></path>
    </svg>
  );
}
