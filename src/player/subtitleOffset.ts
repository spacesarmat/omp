import { t, fmtNumber } from '../i18n';
export const SUB_OFFSET_STEP = 0.5;
export const SUB_OFFSET_MAX = 5;

export function subSizeOptions(): { value: 'small' | 'medium' | 'large'; label: string }[] {
  return [
    { value: 'small', label: t('player.subSizeSmall') },
    { value: 'medium', label: t('player.subSizeMedium') },
    { value: 'large', label: t('player.subSizeLarge') },
  ];
}

export function formatOffset(v: number): string {
  if (v === 0) return '0 ' + t('common.sec');
  const n = fmtNumber(Math.abs(v), 1);
  return v > 0 ? t('player.offsetLater', { n }) : t('player.offsetEarlier', { n });
}

export function subtitleOffsetOptions(): { value: number; label: string }[] {
  const out: { value: number; label: string }[] = [];
  const steps = SUB_OFFSET_MAX / SUB_OFFSET_STEP;
  for (let i = -steps; i <= steps; i++) {
    const value = i * SUB_OFFSET_STEP;
    out.push({ value, label: formatOffset(value) });
  }
  return out;
}
