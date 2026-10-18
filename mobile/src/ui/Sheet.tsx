import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useBackHandler } from './backStack';
import { t } from '../../../src/i18n';
import { beginSheetDrag, moveSheetDrag, sheetDragDismisses, sheetListScrolled, SHEET_DRAG_SLOP, type SheetDrag } from './sheetDrag';

/** Bottom sheet with a dimmed backdrop. Backdrop, grab handle, a downward pull from the top, and system «Назад» close it. */
export function Sheet({
  onClose,
  onBack,
  label,
  children,
}: {
  onClose: () => void;
  onBack?: () => void;
  label: string;
  children: ComponentChildren;
}) {
  useBackHandler(() => (onBack ?? onClose)());
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ignoreClick = useRef(false);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    let drag: SheetDrag | null = null;
    let fromGrip = false;
    const place = (px: number, animate: boolean) => {
      sheet.style.transition = animate ? 'transform .22s ease' : 'none';
      sheet.style.transform = px > 0 ? 'translateY(' + Math.round(px) + 'px)' : '';
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        drag = null;
        return;
      }
      const touch = e.touches[0];
      drag = beginSheetDrag(touch.clientY, touch.clientX);
      const el = e.target instanceof Element ? e.target : null;
      fromGrip = !!el && !!el.closest('.m-sheet-grip');
    };
    const move = (e: TouchEvent) => {
      if (!drag || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const next = moveSheetDrag(drag, touch.clientY, touch.clientX, sheetListScrolled(sheet, e.target), fromGrip);
      if (next.latched && e.cancelable) e.preventDefault();
      drag = next;
      if (next.latched) place(next.offset, false);
    };
    const end = () => {
      if (!drag) return;
      const dismiss = drag.latched && sheetDragDismisses(drag.offset);
      if (drag.latched && drag.offset > SHEET_DRAG_SLOP) ignoreClick.current = true;
      drag = null;
      if (dismiss) closeRef.current();
      if (sheet.isConnected) place(0, !dismiss);
    };
    const cancel = () => {
      drag = null;
      if (sheet.isConnected) place(0, true);
    };
    sheet.addEventListener('touchstart', start, { passive: true });
    sheet.addEventListener('touchmove', move, { passive: false });
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', cancel);
    return () => {
      sheet.removeEventListener('touchstart', start);
      sheet.removeEventListener('touchmove', move);
      sheet.removeEventListener('touchend', end);
      sheet.removeEventListener('touchcancel', cancel);
    };
  }, []);

  return (
    <div class="m-sheet-host">
      <button type="button" class="m-sheet-backdrop" aria-label={t('common.close')} onClick={onClose} />
      <div ref={sheetRef} class="m-sheet" role="dialog" aria-label={label}>
        <button
          type="button"
          class="m-sheet-grip"
          aria-label={t('common.close')}
          onClick={() => {
            if (ignoreClick.current) {
              ignoreClick.current = false;
              return;
            }
            onClose();
          }}
        />
        {children}
      </div>
    </div>
  );
}
