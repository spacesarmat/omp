import { useEffect } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { testLabels } from '../../../src/testmode/active';
import { lookupPhone } from '../../../src/testmode/registry';
import { catalogMode } from '../catalog/phoneCatalog';
import { currentRoute } from '../nav';
import { showToast } from '../ui/toast';

/** Paints `body.test-labels` and the corner screen code. Item badges are CSS on `[data-code]`. */
export function TestModeHost() {
  const on = testLabels.value;
  useEffect(() => {
    document.body.classList.toggle('test-labels', on);
    return () => {
      document.body.classList.remove('test-labels');
    };
  }, [on]);
  if (!on) return null;
  const screen = lookupPhone(currentRoute.value.name, catalogMode.value);
  if (!screen) return null;
  const code = screen.code;
  const copy = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    const clip = navigator.clipboard;
    if (clip && clip.writeText) clip.writeText(code).then(() => undefined, () => undefined);
    showToast(t('settings.testModeCopied', { code: code }));
  };
  return (
    <button type="button" class="test-screen-badge" onClick={copy}>
      <span class="test-badge">{code}</span>
    </button>
  );
}
