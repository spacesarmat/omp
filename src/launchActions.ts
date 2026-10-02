import { parseLaunchParams } from './lib/launchParams';
import { addServer, setActiveServer, client } from './store/servers';
import { errorMessage } from './api/http';
import { navigate, resetTo } from './ui/nav';
import { toast } from './ui/toast';

/** Applies webOS launch params: {server}, {magnet}, {torrent}, {play, title}. */
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
    navigate({ name: 'torrent', hash: a.hash });
    return;
  }
  c.add({ link: a.link }).then(
    (t) => navigate({ name: 'torrent', hash: t.hash }),
    (e) => toast(errorMessage(e), 'error'),
  );
}
