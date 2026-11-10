import { linkStatus, nowPlaying, sendCmd } from '../tv/playerLink';
import { volume } from '../tv/tvClient';
import { native } from '../platform/native';
import { linksFromDrop } from './drop';
import { desktopHotkey } from './hotkeys';
import { installWheelScroll } from './wheel';

const PIP_KEY = 'omp.desktop.pip';

function placeMenu(event: MouseEvent): void {
  const root = document.documentElement;
  const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 336));
  const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 80));
  root.style.setProperty('--omp-menu-x', x + 'px');
  root.style.setProperty('--omp-menu-y', y + 'px');
  root.classList.add('omp-context');
}

async function readFile(file: File): Promise<{ name: string; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, bytes };
}

function floatMini(on: boolean): void {
  document.querySelectorAll('.m-mini').forEach((node) => {
    node.classList.toggle('m-mini-float', on);
  });
}

export function installDesktopExtras(actions: {
  onSearch: () => void;
  onBack: () => void;
  onOpenLink: (link: string) => void;
}): () => void {
  const player = native as { playerControl?: (action: string) => Promise<unknown> };
  const pipOn = () => {
    try { return localStorage.getItem(PIP_KEY) !== '0'; } catch { return true; }
  };
  const syncPip = () => {
    const on = pipOn();
    document.querySelectorAll('.m-mini').forEach((node) => node.classList.toggle('m-mini-float', on));
  };
  syncPip();
  const stopWheel = installWheelScroll(window);
  const onKey = (event: KeyboardEvent) => {
    const action = desktopHotkey(event);
    if (!action) return;
    if (action === 'search') {
      event.preventDefault();
      actions.onSearch();
      const field = document.querySelector<HTMLElement>('.m-screen input, .m-screen textarea');
      if (field) field.focus();
      return;
    }
    if (action === 'back') {
      if (document.fullscreenElement) {
        event.preventDefault();
        void document.exitFullscreen();
        return;
      }
      event.preventDefault();
      actions.onBack();
      return;
    }
    event.preventDefault();
    if (action === 'play-pause') {
      const playing = nowPlaying.value;
      if (linkStatus.value === 'live' && playing) sendCmd({ type: playing.paused ? 'play' : 'pause' });
      void player.playerControl?.('pause');
      return;
    }
    if (action === 'seek-back' || action === 'seek-forward') {
      sendCmd({ type: 'skip', d: action === 'seek-back' ? -10 : 10 });
      void player.playerControl?.(action);
      return;
    }
    if (action === 'volume-down' || action === 'volume-up') {
      void volume(action === 'volume-up' ? 'up' : 'down');
      void player.playerControl?.(action);
      return;
    }
    if (action === 'fullscreen') {
      const screen = document.querySelector('.m-screen');
      if (!document.fullscreenElement && screen && screen.requestFullscreen) void screen.requestFullscreen();
      else if (document.fullscreenElement) void document.exitFullscreen();
      void player.playerControl?.('fullscreen');
    }
  };
  const onContext = (event: Event) => {
    if (event instanceof MouseEvent) placeMenu(event);
  };
  const clearContext = () => document.documentElement.classList.remove('omp-context');
  const onDragOver = (event: DragEvent) => {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    event.preventDefault();
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const text = transfer.getData('text/uri-list') || transfer.getData('text/plain') || '';
    const files = Array.from(transfer.files || []);
    void Promise.all(files.map(readFile)).then((read) => {
      for (const link of linksFromDrop(text, read)) actions.onOpenLink(link);
    });
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('contextmenu', onContext, true);
  window.addEventListener('pointerdown', clearContext);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  const observer = new MutationObserver(() => syncPip());
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    stopWheel();
    observer.disconnect();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('contextmenu', onContext, true);
    window.removeEventListener('pointerdown', clearContext);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}
