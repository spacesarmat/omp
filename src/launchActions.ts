import { parseLaunchParams } from './lib/launchParams';
import { addServer, setActiveServer, client } from './store/servers';
import { errorMessage } from './api/http';
import { navigate, openPlayer, resetTo } from './ui/nav';
import { toast } from './ui/toast';
import { buildTorrentQueue } from './player/queue';
import { attachPhone } from './phone/link';
import { savePhoneLink } from './phone/phoneStore';
import { checkForUpdate, dismissPrompt } from './store/updates';
import { magnetName } from './lib/categoryGuess';
import { updateSettings } from './store/settings';
import { t } from './i18n';
import { pauseOnboarding, resumeOnboarding } from './onboarding/gate';

/** Applies webOS launch params: {server}, {magnet}, {torrent[, file, t]}, {play, title}, {lang}, {phone}. */
export function runLaunchParams(raw: unknown): void {
  const plan = parseLaunchParams(raw);
  if (!plan) return;
  // the phone sets the TV's language first, so whatever follows is shown in it
  if (plan.lang) updateSettings({ language: plan.lang });
  if (plan.report) attachPhone(plan.report);
  if (plan.phone) savePhoneLink(plan.phone);
  if (plan.invalid) {
    toast(t('errors.badLaunchParams'), 'error');
    return;
  }
  if (plan.server) {
    setActiveServer(addServer({ url: plan.server }).id);
    resetTo({ name: 'library' });
  }
  if (plan.open === 'update') {
    navigate({ name: 'update' });
    // the update screen shows the result itself, no dialog on top of it
    checkForUpdate({ manual: true }).then(dismissPrompt, dismissPrompt);
    return;
  }
  const a = plan.action;
  if (!a) return;
  if (a.kind === 'play') {
    openPlayer({ name: 'player', queue: [{ url: a.url, title: a.title }], index: 0 });
    return;
  }
  const c = client.value;
  if (!c) {
    toast(t('errors.connectFirst'), 'error');
    resetTo({ name: 'connect' });
    return;
  }
  if (a.kind === 'torrent') {
    if (a.file === undefined) {
      navigate({ name: 'torrent', hash: a.hash });
      return;
    }
    const file = a.file;
    const startAt = a.t;
    const hash = a.hash;
    const from = a.from;
    // The file list is async: keep the tour off the library until the player opens or the launch fails.
    pauseOnboarding();
    c.get(hash)
      .then((tor) => (c.files(tor).length ? tor : c.loadInfo(hash)))
      .then(
        (tor) => {
          const full = buildTorrentQueue(c, tor, c.files(tor));
          let queue = full;
          let seasonNext = false;
          if (a.files && a.files.length) {
            const byId: { [id: number]: (typeof full)[number] } = {};
            full.forEach((q) => {
              if (q.fileIndex !== undefined) byId[q.fileIndex] = q;
            });
            const sliced = a.files.map((id) => byId[id]).filter((q) => !!q);
            if (sliced.length && sliced.some((q) => q.fileIndex === file)) {
              queue = sliced;
              seasonNext = true;
            }
          }
          const index = queue.findIndex((q) => q.fileIndex === file);
          if (index < 0) {
            resumeOnboarding();
            toast(t('errors.badLaunchParams'), 'error');
            navigate({ name: 'torrent', hash });
            return;
          }
          const route: { name: 'player'; queue: typeof queue; index: number; startAt?: number; from?: string; seasonNext?: boolean } = {
            name: 'player',
            queue,
            index,
            startAt,
          };
          if (from) route.from = from;
          if (seasonNext) route.seasonNext = true;
          openPlayer(route);
        },
        (e) => {
          resumeOnboarding();
          toast(errorMessage(e), 'error');
        },
      );
    return;
  }
  c.add({ link: a.link, title: magnetName(a.link) || undefined }).then(
    (t) => navigate({ name: 'torrent', hash: t.hash }),
    (e) => toast(errorMessage(e), 'error'),
  );
}
