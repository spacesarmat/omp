import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../src/i18n';
import { native } from '../platform/native';
import { showToast } from './toast';
import { IrPanel, type IrHardware } from './IrPanel';
import { brandSignal, type IrButton } from '../tv/power/irCodes';
import { parseIrText } from '../tv/power/irParse';
import { forgetButton, irProfiles, rememberButton } from '../tv/power/irProfile';
import { manualDevices } from '../tv/power/manual';
import { captureLearner, learnerOrigin } from '../tv/power/learn';
import { loadNetToken, saveNetToken } from '../tv/power/tokens';
import { markNetToken, netTvs, type NetDevice } from '../tv/power/netStore';
import { samsungKey, samsungSocketPath, samsungToken } from '../tv/power/protocols';
import { switchInput, tvKind } from '../tv/tvClient';
import { BoxCodeSheet } from './BoxCodeSheet';
import { boxIp, boxState, cancelBoxCode, connectBox, sendBoxKey, submitBoxCode, type BoxKey } from '../tv/boxRemote';
import type { SavedTv } from '../tv/tvStore';

function deviceOf(ip: string | null): SavedTv | null {
  const d = netTvs.value.filter((x) => x.ip === ip)[0];
  if (!d) return null;
  return { ip: d.ip, name: d.name, kind: 'atv', box: { on: true, via: 'google' } };
}

async function wake(mac: string, ip: string | undefined, broadcast: string | undefined): Promise<void> {
  const host = ip || '255.255.255.255';
  if (broadcast) await native.wakeOnLan(mac, host, broadcast);
  else await native.wakeOnLan(mac, host);
}

function googleKey(d: NetDevice, key: BoxKey): Promise<void> {
  const tv = deviceOf(d.ip);
  if (!tv) return Promise.resolve();
  return sendBoxKey(tv, key);
}

async function samsungPress(d: NetDevice, key: string): Promise<void> {
  const token = await loadNetToken(d.id);
  const path = samsungSocketPath('OMP', token || undefined);
  const sent = await native.samsungClick(d.ip, path, JSON.stringify(samsungKey(key)));
  let message: unknown = null;
  try {
    message = sent.message ? JSON.parse(sent.message) : null;
  } catch {
    message = null;
  }
  const next = samsungToken(message);
  if (next) {
    await saveNetToken(d.id, next);
    markNetToken(d.id);
  }
}

/** IR, manual Wake-on-LAN and network TV keys. The OMP remote stays above this block. */
export function PowerTools({ deviceId }: { deviceId: string }) {
  const [hw, setHw] = useState<IrHardware>({ transmit: false, receive: false });
  const tried = useRef<{ [brand: string]: number }>({});
  useEffect(() => {
    native.irHardware().then(
      (h) => {
        if (h && h.transmit) setHw({ transmit: true, receive: !!h.receive });
      },
      () => undefined,
    );
  }, []);
  const buttons = (irProfiles.value.filter((p) => p.deviceId === deviceId)[0] || { buttons: [] }).buttons;

  async function transmit(frequency: number, pulses: number[]): Promise<void> {
    await native.irTransmit(frequency, pulses);
    showToast(t('remote.ir.sent'));
  }

  async function onTest(brand: string): Promise<void> {
    const keys: IrButton[] = ['power', 'volUp', 'volDown', 'input'];
    const n = tried.current[brand] || 0;
    const button = keys[n % keys.length];
    const signal = brandSignal(brand, button, 0);
    tried.current[brand] = n + 1;
    if (!signal) {
      showToast(t('remote.ir.badCode'));
      return;
    }
    try {
      await transmit(signal.frequency, signal.pulses);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('remote.ir.badCode'));
    }
  }

  function onImport(text: string): void {
    const parsed = parseIrText(text);
    if (!parsed) {
      showToast(t('remote.ir.badCode'));
      return;
    }
    parsed.forEach((s, i) => {
      rememberButton(deviceId, {
        id: 'i' + Date.now().toString(36) + i,
        name: s.name || t('remote.ir.name'),
        frequency: s.frequency,
        pulses: s.pulses,
      });
    });
    showToast(t('remote.ir.saved'));
  }

  async function onLearnExt(): Promise<void> {
    try {
      const found = await native.discoverLearners(4000);
      const one = found[0];
      if (!one) {
        showToast(t('remote.ir.badCode'));
        return;
      }
      const origin = learnerOrigin(one.ip, one.port);
      const known = await loadNetToken('learner:' + one.ip);
      const got = await captureLearner(origin, known);
      await saveNetToken('learner:' + one.ip, got.token);
      const name = typeof prompt === 'function' ? prompt(t('remote.ir.name')) || t('remote.ir.name') : t('remote.ir.name');
      rememberButton(deviceId, { id: 'l' + Date.now().toString(36), name, frequency: got.signal.frequency, pulses: got.signal.pulses });
      showToast(t('remote.ir.saved'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('remote.ir.badCode'));
    }
  }

  async function onLearn(): Promise<void> {
    try {
      const got = await native.irLearn();
      if (!got) {
        showToast(t('remote.ir.badCode'));
        return;
      }
      const name = typeof prompt === 'function' ? prompt(t('remote.ir.name')) || t('remote.ir.name') : t('remote.ir.name');
      rememberButton(deviceId, { id: 'n' + Date.now().toString(36), name, frequency: got.frequency, pulses: got.pulses });
      showToast(t('remote.ir.saved'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('remote.ir.badCode'));
    }
  }

  async function power(d: NetDevice): Promise<void> {
    try {
      if (d.mac) await wake(d.mac, d.ip, d.broadcast);
      if (d.kind === 'samsung') await samsungPress(d, 'KEY_POWER');
      else {
        const tv = deviceOf(d.ip);
        if (tv) {
          await connectBox(tv, { setup: true });
          if (boxState.value === 'code' || boxState.value === 'confirm') return;
          if (boxState.value !== 'connected') {
            showToast(t('remote.box.err.failed'));
            return;
          }
          await sendBoxKey(tv, 'POWER');
        }
      }
      showToast(t('remote.turningOn', { name: d.name }));
    } catch (e) {
      showToast(e instanceof Error && !d.mac ? e.message : t('remote.turningOn', { name: d.name }));
    }
  }

  const coding = boxState.value === 'code' ? deviceOf(boxIp.value) : null;

  return (
    <div>
      {manualDevices.value.map((d) => (
        <button
          key={d.mac}
          type="button"
          class="m-btn m-btn-secondary tm"
          data-code="P08.2"
          onClick={() => {
            wake(d.mac, d.ip, d.broadcast).then(
              () => showToast(t('remote.turningOn', { name: d.name })),
              (e) => showToast(e instanceof Error ? e.message : t('remote.wolNeedApp')),
            );
          }}
        >
          {t('remote.powerOn')} {d.name}
        </button>
      ))}
      {tvKind() !== 'atv' && (
        <div class="m-tv-row">
          {['HDMI_1', 'HDMI_2', 'HDMI_3'].map((id) => (
            <button key={id} type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => void switchInput(id).catch((e) => showToast(e instanceof Error ? e.message : t('remote.ir.badCode')))}>
              {id.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}
      {netTvs.value.length > 0 && <h2 class="m-small">{t('remote.netTitle')}</h2>}
      {netTvs.value.map((d) => (
        <div key={d.id} class="m-tv-row">
          <span>{d.name}</span>
          <button type="button" class="m-btn m-btn-primary m-btn-sm tm" data-code="P08.2" onClick={() => void power(d)}>
            {t('remote.powerOn')}
          </button>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => void (d.kind === 'samsung' ? samsungPress(d, 'KEY_VOLUP') : googleKey(d, 'VOLUMEUP')).catch((e) => showToast(e instanceof Error ? e.message : t('remote.ir.badCode')))}>
            {t('remote.volUp')}
          </button>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => void (d.kind === 'samsung' ? samsungPress(d, 'KEY_VOLDOWN') : googleKey(d, 'VOLUMEDOWN')).catch((e) => showToast(e instanceof Error ? e.message : t('remote.ir.badCode')))}>
            {t('remote.volDown')}
          </button>
          <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => void (d.kind === 'samsung' ? samsungPress(d, 'KEY_HDMI') : googleKey(d, 'INPUT')).catch((e) => showToast(e instanceof Error ? e.message : t('remote.ir.badCode')))}>
            {t('remote.netInput')}
          </button>
        </div>
      ))}
      {coding && <BoxCodeSheet onSubmit={(code) => submitBoxCode(coding, code)} onCancel={cancelBoxCode} />}
      <IrPanel
        hardware={hw}
        buttons={buttons}
        onTest={(brand) => void onTest(brand)}
        onDelete={(id) => forgetButton(deviceId, id)}
        onLearn={() => void onLearn()}
        onLearnExt={() => void onLearnExt()}
        onImport={onImport}
        onSend={(id) => {
          const b = buttons.filter((x) => x.id === id)[0];
          if (!b) return;
          transmit(b.frequency, b.pulses).catch((e) => showToast(e instanceof Error ? e.message : t('remote.ir.badCode')));
        }}
      />
    </div>
  );
}
