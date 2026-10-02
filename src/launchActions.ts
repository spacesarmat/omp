import { parseLaunchParams } from './lib/launchParams';
import { addServer, setActiveServer, client } from './store/servers';
import { errorMessage } from './api/http';
import { navigate, resetTo } from './ui/nav';
import { toast } from './ui/toast';
import { buildTorrentQueue } from './player/queue';

/** Applies webOS launch params: {server}, {magnet}, {torrent[, file, t]}, {play, title}. */
export function runLaunchParams(raw: unknown): void {
  const plan = parseLaunchParams(raw);
  if (!plan) return;
  if (plan.invalid) {
    toast('Некорректные параметры запуска', 'error');
    return;
  }
  if (plan.server) {
    setActiveServer(addServer({ url: plan.server }).id);
    resetTo({ name: 'library' });
  }
  const a = plan.action;
  if (!a) return;
  if (a.kind === 'play') {
    navigate({ name: 'player', queue: [{ url: a.url, title: a.title }], index: 0 });
    return;
  }
  const c = client.value;
  if (!c) {
    toast('Сначала подключитесь к серверу', 'error');
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
    c.get(hash)
      .then((t) => (c.files(t).length ? t : c.loadInfo(hash)))
      .then(
        (t) => {
          const queue = buildTorrentQueue(c, t, c.files(t));
          const index = queue.findIndex((q) => q.fileIndex === file);
          if (index < 0) {
            toast('Некорректные параметры запуска', 'error');
            navigate({ name: 'torrent', hash });
            return;
          }
          navigate({ name: 'player', queue, index, startAt });
        },
        (e) => toast(errorMessage(e), 'error'),
      );
    return;
  }
  c.add({ link: a.link }).then(
    (t) => navigate({ name: 'torrent', hash: t.hash }),
    (e) => toast(errorMessage(e), 'error'),
  );
}
