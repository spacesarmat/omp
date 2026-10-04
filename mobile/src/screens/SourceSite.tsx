import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { goBack } from '../nav';
import { native } from '../platform/native';
import { getSource } from '../../../src/sources/registry';
import { isCloudflareBypassOn, isSourceOn, onCloudflareBypassChange, setCloudflareBypass, setSourceOn } from '../../../src/sources/store';
import { BYPASS_LABEL, BYPASS_WARNING, clearanceText } from '../../../src/sources/cloudflareCheck';

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'m-switch' + (on ? ' on' : '')} onClick={onToggle}>
      <span class="m-switch-knob" />
    </button>
  );
}

/**
 * A site behind Cloudflare (mockup PhoneSite): «Искать на …», «Обходить проверку Cloudflare» with the clearance time and
 * the warning. The site's login block comes with the sites themselves. clearance / now: fakes in tests.
 */
export function SourceSite({
  id,
  clearance = (url: string) => native.cloudflareClearance(url),
  now = Date.now,
}: {
  id: string;
  clearance?: (url: string) => Promise<number | null>;
  now?: () => number;
}) {
  const [, setTick] = useState(0);
  const [until, setUntil] = useState<number | null>(null);
  const source = getSource(id);

  useEffect(() => {
    let alive = true;
    const off = onCloudflareBypassChange(() => alive && setTick((n) => n + 1));
    if (source && source.siteUrl) {
      clearance(source.siteUrl).then(
        (u) => alive && setUntil(u),
        () => undefined,
      );
    }
    return () => {
      alive = false;
      off();
    };
  }, [id]);

  if (!source) {
    return (
      <div class="m-screen" data-route="sourceSite">
        <div class="m-bar">
          <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
            <Icon d="M15 5l-7 7 7 7" />
          </button>
          <h1 class="m-bar-title">Источник</h1>
        </div>
        <div class="m-note m-muted">Источник не найден</div>
      </div>
    );
  }

  const on = isSourceOn(source);
  const bypass = isCloudflareBypassOn(source);
  const status = bypass ? clearanceText(until, now()) : null;
  const searchLabel = 'Искать на ' + source.name;

  return (
    <div class="m-screen" data-route="sourceSite">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">{source.name}</h1>
      </div>
      <section class="m-set-group">
        <div class="m-set-card" data-site-card="cloudflare">
          <div class="m-src-row">
            <span class="m-src-name">
              <span>{searchLabel}</span>
            </span>
            <Switch
              on={on}
              label={searchLabel}
              onToggle={() => {
                setSourceOn(source.id, !on);
                setTick((n) => n + 1);
              }}
            />
          </div>
          {source.cloudflare === true && (
            <>
              <div class="m-src-row" data-bypass={bypass ? 'on' : 'off'}>
                <span class="m-src-name">
                  <span>{BYPASS_LABEL}</span>
                  {status && <span class="m-src-note ok">{status}</span>}
                </span>
                <Switch on={bypass} label={BYPASS_LABEL} onToggle={() => setCloudflareBypass(source.id, !bypass)} />
              </div>
              <div class="m-cf-warn" data-note="cloudflare-warning">
                {BYPASS_WARNING}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
