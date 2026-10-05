import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

/**
 * The top row of a bottom-tab screen («Новое», «Добавить», «Пульт», «Настройки»): the title in a small display size,
 * then the round 44px icon buttons on the right (the same look as the TV button of «Мои»).
 */
export function ScreenHeader({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="m-lib-head m-screen-head">
      <h1 class="m-head-title">{title}</h1>
      {children}
    </div>
  );
}

/** A round icon button for the header row; `spin` turns the icon while something runs. */
export function HeadButton({
  d,
  label,
  onClick,
  disabled,
  spin,
  data,
}: {
  d: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spin?: boolean;
  data?: Record<string, string>;
}) {
  return (
    <button type="button" class="m-tvchip m-head-btn" aria-label={label} disabled={disabled} aria-busy={spin ? 'true' : undefined} onClick={onClick} {...data}>
      <Icon d={d} size={22} spin={spin} />
    </button>
  );
}
