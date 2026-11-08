// One-shot confirm when a network finds a TorrServer the phone has not accepted yet.
// The settings screen owns the rules. This sheet does not change the TV or the phone link.
import { t } from '../../../src/i18n';
import { addServer } from '../../../src/store/servers';
import { Sheet } from '../ui/Sheet';
import { acceptWifiHost, laterWifi, wifiPrompt } from './wifiRun';
import type { WifiPlan } from './wifiSelect';

export function WifiPrompt() {
  const prompt = wifiPrompt.value;
  return prompt && (prompt.kind === 'confirm' || prompt.kind === 'choose') ? <WifiAsk plan={prompt} /> : null;
}

function WifiAsk({ plan, onDone = () => undefined }: { plan: Extract<WifiPlan, { kind: 'confirm' | 'choose' }>; onDone?: () => void }) {
  const title = plan.kind === 'choose' ? t('connect.wifiChoose', { ssid: plan.ssid }) : t('connect.wifiConfirm', { name: plan.hosts[0].name || plan.hosts[0].url, ssid: plan.ssid });
  return (
    <Sheet label={title} onClose={() => laterWifi(plan)}>
      <div class="m-wifi-ask" role="menu">
        <p>{title}</p>
        {plan.hosts.map((h) => (
          <button
            key={h.url}
            type="button"
            class="m-btn m-btn-primary"
            onClick={() => {
              acceptWifiHost(plan, h.url, (url, name) => addServer({ url: url, name: name }));
              onDone();
            }}
          >
            {t('connect.wifiUse') + ': ' + (h.name || h.url)}
          </button>
        ))}
        <button type="button" class="m-btn m-btn-secondary" onClick={() => laterWifi(plan)}>
          {t('connect.wifiLater')}
        </button>
      </div>
    </Sheet>
  );
}
