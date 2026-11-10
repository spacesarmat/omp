import { useEffect, useState } from 'preact/hooks';
import type { DesignPropertyDef } from '../../../design/catalog';

export interface PropertyFieldProps extends DesignPropertyDef {
  value: string;
  onChange(token: string, value: string): void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function PropertyField({ token, label, kind, value, onChange }: PropertyFieldProps) {
  const [error, setError] = useState('');
  useEffect(() => setError(''), [value]);
  const change = (raw: string) => {
    if (kind === 'color') {
      if (!HEX.test(raw)) {
        setError('INVALID_VALUE');
        return;
      }
      setError('');
      onChange(token, raw.toUpperCase());
      return;
    }
    const normalized = raw.endsWith('px') ? raw.slice(0, -2) : raw;
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) > 512) {
      setError('INVALID_VALUE');
      return;
    }
    setError('');
    onChange(token, `${normalized}px`);
  };
  return (
    <label class="editor-property">
      <span>{label}</span>
      <span class="editor-property-input">
        {kind === 'color' && <input type="color" aria-label={`${label} picker`} value={HEX.test(value) ? value : '#000000'} onChange={(event) => change(event.currentTarget.value)} />}
        <input data-token={token} aria-label={label} value={kind === 'px' ? value.replace(/px$/, '') : value} inputMode={kind === 'px' ? 'decimal' : 'text'} onChange={(event) => change(event.currentTarget.value)} />
      </span>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
