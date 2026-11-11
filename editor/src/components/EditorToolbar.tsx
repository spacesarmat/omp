import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export interface EditorToolbarProps {
  label: string;
  orientation?: 'horizontal' | 'vertical';
  class?: string;
  children: ComponentChildren;
}

export function EditorToolbar({ label, orientation = 'horizontal', class: className = '', children }: EditorToolbarProps) {
  const toolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = toolbar.current;
    if (!element || 'focusGroup' in HTMLElement.prototype) return;
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button'));
    const activate = (active: HTMLButtonElement | undefined) => {
      for (const button of buttons) button.tabIndex = button === active ? 0 : -1;
    };
    activate(buttons[0]);
    const focus = (event: FocusEvent) => {
      if (buttons.includes(event.target as HTMLButtonElement)) activate(event.target as HTMLButtonElement);
    };
    const keydown = (event: KeyboardEvent) => {
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      const vertical = element.getAttribute('aria-orientation') === 'vertical';
      const rtl = getComputedStyle(element).direction === 'rtl';
      const steps: Record<string, number> = vertical
        ? { ArrowDown: 1, ArrowUp: -1 }
        : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
      let next = current;
      if (steps[event.key]) next = (current + steps[event.key] + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault();
      activate(buttons[next]);
      buttons[next]?.focus();
    };
    element.addEventListener('focusin', focus);
    element.addEventListener('keydown', keydown);
    return () => {
      element.removeEventListener('focusin', focus);
      element.removeEventListener('keydown', keydown);
    };
  }, []);
  return (
    <div
      ref={toolbar}
      class={`editor-toolbar ${className}`}
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      {...({ focusgroup: orientation === 'vertical' ? 'toolbar wrap block' : 'toolbar wrap' } as object)}
    >
      {children}
    </div>
  );
}
