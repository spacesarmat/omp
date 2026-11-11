import type { JSX } from 'preact';

export type EditorIconName = 'logo' | 'undo' | 'redo' | 'compare' | 'snapshot' | 'design' | 'logic' | 'play' | 'layers' | 'frame' | 'sidebar' | 'component' | 'button' | 'content' | 'chevron' | 'cursor' | 'hand' | 'minus' | 'plus' | 'fit' | 'eye' | 'eye-off' | 'lock' | 'unlock' | 'copy';

export interface EditorIconProps {
  name: EditorIconName;
  size?: number;
}

export function EditorIcon({ name, size = 16 }: EditorIconProps) {
  const paths: Record<EditorIconName, JSX.Element> = {
    logo: <><path d="M4 3h5v5H4zM11 3h5v5h-5zM4 10h5v5H4z" fill="currentColor" stroke="none" /><path d="M11 10h5v5h-5z" fill="currentColor" stroke="none" opacity=".45" /></>,
    undo: <><path d="M8 5 4 9l4 4" /><path d="M5 9h6a5 5 0 0 1 5 5v1" /></>,
    redo: <><path d="m12 5 4 4-4 4" /><path d="M15 9H9a5 5 0 0 0-5 5v1" /></>,
    compare: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M10 4v12M6 8h1M13 12h1" /></>,
    snapshot: <><path d="M8 5 9.5 3h5L16 5" /><rect x="4" y="5" width="16" height="13" rx="2" /><circle cx="12" cy="11" r="3" /></>,
    design: <><path d="m4 16 9-9 3 3-9 9H4zM14 5l2-2 3 3-2 2M4 20h16" /></>,
    logic: <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="16" y="16" width="5" height="5" rx="1" /><path d="M8 5.5h5a4 4 0 0 1 4 4V16M14 14l3 3 3-3" /></>,
    play: <path d="m9 6 9 6-9 6z" />,
    layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    frame: <><path d="M6 3v18M18 3v18M3 6h18M3 18h18" /><rect x="6" y="6" width="12" height="12" stroke="none" fill="currentColor" opacity=".12" /></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M5.5 8h1M5.5 12h1" /></>,
    component: <><path d="m12 2 4 4-4 4-4-4zM6 10l4 4-4 4-4-4zM18 10l4 4-4 4-4-4zM12 14l4 4-4 4-4-4z" /></>,
    button: <><rect x="3" y="7" width="18" height="10" rx="3" /><path d="M8 12h8" /></>,
    content: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    cursor: <path d="m5 3 13 9-6 1-3 6z" />,
    hand: <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v5c0 4-2 7-6 7h-1c-2 0-3-1-4-3l-4-6a1.5 1.5 0 0 1 2-2l3 2" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M5 12h14M12 5v14" />,
    fit: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /><rect x="7" y="7" width="10" height="10" rx="1" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
    'eye-off': <><path d="M4 4l16 16M10.5 5.2A11 11 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.4M6.6 6.6C3.6 8.4 2 12 2 12s4 7 10 7a10 10 0 0 0 4-.8" /></>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    unlock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.7-1.5" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{paths[name]}</svg>;
}
