// Install assistant: collects the facts about one device for src/lib/installPlan.
import { connectTv, lgInstallInfo, sessionIp, tvState, tvError } from '../tv/tvClient';
import { tvs, ATV_PORT } from '../tv/tvStore';
import { latestOmpVersion } from '../tv/tvUpdate';
import { log } from '../../../src/lib/log';
import { t } from '../../../src/i18n';
import {
  LG_OMP_APP_ID,
  LG_SSH_PORT,
  LG_KEY_SERVER_PORT,
  type LgFacts,
  type AtvFacts,
  type DeviceFacts,
} from '../../../src/lib/installPlan';
import { installNative, type InstallDevice } from './devices';

const PROBE_MS = 1500;
const OMP_INFO_MS = 2500;

/**
 * LG: pairs over SSAP if needed (the TV asks «Разрешить») without making it the active TV, then reads model, webOS,
 * apps and Dev Mode ports. The caller asks the user first when another TV is connected (see installSession).
 */
export async function lgFacts(d: InstallDevice): Promise<LgFacts> {
  const base: LgFacts = { kind: 'lg', name: d.name, ip: d.ip, paired: false };
  if (d.model) base.model = d.model;
  if (!(sessionIp.value === d.ip && tvState.value === 'connected')) {
    const saved = tvs.value.find((t) => t.ip === d.ip && t.kind !== 'atv');
    try {
      await connectTv({ ...saved, ip: d.ip, name: saved?.name ?? d.name, kind: 'lg' }, { keepActive: true });
    } catch (e) {
      log('warn', 'install', t('install.run.lgNoConnect'));
      return { ...base, error: tvError.value || (e instanceof Error ? e.message : '') };
    }
  }
  const [info, latest] = await Promise.all([
    lgInstallInfo().catch(() => null),
    latestOmpVersion('lg'),
  ]);
  if (!info) return { ...base, error: tvError.value || undefined };
  const facts: LgFacts = { ...base, paired: true, latest };
  if (info.model) facts.model = info.model;
  if (info.productName) facts.productName = info.productName;
  if (info.swModel) facts.swModel = info.swModel;
  if (info.apps) {
    facts.apps = info.apps.map((a) => a.id);
    const omp = info.apps.find((a) => a.id === LG_OMP_APP_ID);
    // '' = in the list without a version
    facts.ompVersion = omp ? omp.version || '' : null;
  }
  // Dev Mode ports only matter when OMP is missing
  if (facts.ompVersion === null || facts.ompVersion === undefined) {
    facts.openPorts = await installNative()
      .probePorts(d.ip, [LG_SSH_PORT, LG_KEY_SERVER_PORT], PROBE_MS)
      .catch(() => {
        log('warn', 'install', t('install.run.lgProbeFailed'));
        return undefined;
      });
  }
  return facts;
}

/** OMP version answered by the control server of an Android TV (no token needed for /omp/info); null when silent. */
export async function ompOnAtv(ip: string, port = ATV_PORT): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OMP_INFO_MS);
  try {
    const r = await fetch('http://' + ip + ':' + port + '/omp/info', { signal: ctrl.signal });
    if (r.status !== 200) return null;
    const d = JSON.parse(await r.text());
    return d && typeof d.version === 'string' && d.version ? d.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Android TV: OMP version (from NSD or a direct ask) and the newest APK; model and API level come later over adb. */
export async function atvFacts(d: InstallDevice): Promise<AtvFacts> {
  const [omp, latest] = await Promise.all([
    d.ompVersion ? Promise.resolve(d.ompVersion) : ompOnAtv(d.ip, d.ompPort),
    latestOmpVersion('atv'),
  ]);
  const facts: AtvFacts = { kind: 'atv', name: d.name, ip: d.ip, ompVersion: omp, latest };
  if (d.model) facts.model = d.model;
  if (d.cast) facts.cast = d.cast;
  return facts;
}

export function deviceFacts(d: InstallDevice): Promise<DeviceFacts> {
  if (d.kind === 'samsung') return Promise.resolve({ kind: 'samsung', name: d.name, ip: d.ip });
  return d.kind === 'atv' ? atvFacts(d) : lgFacts(d);
}
