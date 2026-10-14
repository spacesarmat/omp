import { useEffect, useMemo, useState } from 'preact/hooks';

async function api(path, opts) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opts && opts.headers) },
    ...opts,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.indexOf('json') >= 0 ? await res.json() : { ok: res.ok, status: res.status };
  if (res.status === 401) return { ...data, auth: false };
  return data;
}

async function post(path, csrf, fields) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ csrf, ...fields }),
  });
}

function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.display = 'none';
  }, 1400);
}

function Copy({ value }) {
  if (!value) return null;
  return (
    <button type="button" class="copy" onClick={() => navigator.clipboard.writeText(value).then(() => toast('Скопировано'))}>
      copy
    </button>
  );
}

function Login({ error }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error || '');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const res = await api('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) location.href = '/admin/';
    else setErr(res.error || 'Неверный пароль');
  }
  return (
    <main class="login-wrap">
      <h1>OMP Billing</h1>
      <p class="lead">Вход в админ-панель</p>
      {err ? <div class="flash err">{err}</div> : null}
      <article class="card">
        <form onSubmit={submit}>
          <label>
            Пароль
            <input type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autofocus />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? '…' : 'Войти'}
          </button>
        </form>
      </article>
    </main>
  );
}

function Flash({ flash }) {
  if (!flash) return null;
  if (flash.error) return <div class="flash err">{flash.error}</div>;
  if (flash.code)
    return (
      <div class="flash">
        Код: <span class="code">{flash.code}</span> <Copy value={flash.code} />
      </div>
    );
  if (flash.promo)
    return (
      <div class="flash">
        Промо: <span class="code">{flash.promo}</span> <Copy value={flash.promo} />
      </div>
    );
  if (flash.text) return <div class="flash">{flash.text}</div>;
  return null;
}

const TABS = [
  ['home', 'Главная'],
  ['subs', 'Подписки'],
  ['finance', 'Финансы'],
  ['promos', 'Промо'],
  ['settings', 'Настройки'],
  ['security', 'Доступ'],
];

export function App() {
  const [auth, setAuth] = useState(null);
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('home');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const params = useMemo(() => new URLSearchParams(location.search), []);

  async function reload() {
    const id = params.get('id');
    if (id) {
      const u = await api('/admin/api/user?id=' + encodeURIComponent(id));
      if (u.auth === false) {
        setAuth(false);
        return;
      }
      if (u.error) {
        setUser(null);
        setAuth(true);
        const home = await api('/admin/api/home');
        setData(home);
        return;
      }
      setUser(u);
      setAuth(true);
      return;
    }
    const home = await api('/admin/api/home');
    if (home.auth === false) {
      setAuth(false);
      return;
    }
    setData(home);
    setAuth(true);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function run(path, fields) {
    const csrf = (user && user.csrf) || (data && data.csrf) || '';
    const res = await post(path, csrf, fields || {});
    if (res.auth === false) {
      setAuth(false);
      return;
    }
    if (res.redirect) {
      location.href = res.redirect;
      return;
    }
    await reload();
    if (res.flash && res.flash.error) toast(res.flash.error);
    else if (res.flash && res.flash.text) toast(res.flash.text);
  }

  if (auth === null) return <main class="muted">Загрузка…</main>;
  if (auth === false) return <Login />;

  if (user) {
    return (
      <main>
        <p>
          <a href="/admin/">← Назад</a>
        </p>
        <h1>Пользователь</h1>
        <Flash flash={user.flash} />
        <article class="card">
          <p>
            <span class="muted">id</span> {user.account.id} <Copy value={user.account.id} />
          </p>
          <p>
            <span class="muted">Telegram</span>{' '}
            {user.account.telegramId ? (
              <>
                <span class="ok">{user.account.telegramId}</span> <Copy value={user.account.telegramId} />
              </>
            ) : (
              '—'
            )}
          </p>
          <p>
            <span class="muted">Email</span> {user.account.email || '—'}
          </p>
          <p>
            <span class="muted">Создан</span> {user.account.createdText}
          </p>
          {user.subscription ? (
            <p>
              Подписка до <b>{user.subscription.paidUntilText}</b> · устройств {user.subscription.deviceLimit} ·{' '}
              {user.subscription.active ? <span class="ok">активна</span> : <span class="bad">истекла</span>}
            </p>
          ) : (
            <p class="muted">Нет подписки</p>
          )}
        </article>
        <article class="card">
          <h2>Выдать дни</h2>
          <div class="row">
            <label>
              Дни
              <select id="grant-days" defaultValue="30">
                <option value="1">1</option>
                <option value="7">7</option>
                <option value="30">30</option>
                <option value="90">90</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                run('/admin/grant', {
                  accountId: user.account.id,
                  days: document.getElementById('grant-days').value,
                })
              }
            >
              Выдать
            </button>
          </div>
        </article>
        <article class="card">
          <h2>Коды</h2>
          {(user.codes || []).length === 0 ? <p class="muted">Нет кодов</p> : null}
          <ul>
            {(user.codes || []).map((c) => (
              <li key={c.id}>
                {c.formatted || (c.bound ? 'привязан · ' + c.deviceId : '—')}{' '}
                {c.formatted ? <Copy value={c.formatted} /> : null}
                {c.openUrl ? (
                  <a class="secondary" href={c.openUrl} target="_blank" rel="noreferrer">
                    OMP
                  </a>
                ) : null}
                {c.bound ? (
                  <button type="button" class="ghost" onClick={() => run('/admin/unbind', { codeId: c.id, accountId: user.account.id })}>
                    Сбросить
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
        {user.account.telegramId ? (
          <article class="card">
            <h2>Сообщение в Telegram</h2>
            <textarea id="msg-text" rows="3" placeholder="Текст…" />
            <button
              type="button"
              onClick={() =>
                run('/admin/message', { accountId: user.account.id, text: document.getElementById('msg-text').value })
              }
            >
              Отправить
            </button>
          </article>
        ) : null}
        <div id="toast" />
      </main>
    );
  }

  const d = data || {};
  const subs = (d.subscriptions || []).filter((s) => filter === 'all' || s.status === filter || (filter === 'active' && s.active));

  return (
    <main>
      <header class="row" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
        <div style={{ flex: 1 }}>
          <h1>OMP Billing</h1>
          <p class="lead" style={{ margin: 0 }}>
            SQLite · {d.storage ? Math.round((d.storage.bytes || 0) / 1024) + ' КБ' : '—'}
          </p>
        </div>
        <button type="button" class="ghost" onClick={() => run('/admin/logout', {})}>
          Выйти
        </button>
      </header>
      <Flash flash={d.flash} />
      <nav class="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'home' && (
        <>
          <div class="grid-stats">
            <div class="stat">
              <b>{d.stats?.accounts ?? 0}</b>
              <span>аккаунтов</span>
            </div>
            <div class="stat">
              <b>{d.stats?.activeSubs ?? 0}</b>
              <span>активных</span>
            </div>
            <div class="stat">
              <b>{d.stats?.payments30 ?? 0}</b>
              <span>оплат / 30 дн.</span>
            </div>
            <div class="stat">
              <b>{Math.round(d.stats?.revenue30 || 0)}</b>
              <span>₽ / 30 дн.</span>
            </div>
          </div>
          <article class="card">
            <h2>Найти</h2>
            <div class="row">
              <label>
                Telegram / email / код / id
                <input value={q} onInput={(e) => setQ(e.currentTarget.value)} />
              </label>
              <button type="button" onClick={() => run('/admin/find', { q })}>
                Найти
              </button>
            </div>
          </article>
          {(d.alerts || []).length > 0 && (
            <article class="card">
              <h2>Алерты</h2>
              {d.alerts.map((a, i) => (
                <div key={i} class={'alert ' + (a.level || 'warn')}>
                  {a.text}
                </div>
              ))}
            </article>
          )}
          <article class="card">
            <h2>Быстрое промо</h2>
            <div class="row">
              <button type="button" onClick={() => run('/admin/promo', { days: 1, maxUses: 1 })}>
                1 день × 1
              </button>
              <button type="button" class="ghost" onClick={() => run('/admin/promo', { days: 7, maxUses: 10 })}>
                7 дней × 10
              </button>
              <button type="button" class="ghost" onClick={() => run('/admin/promo', { days: 30, maxUses: 1 })}>
                30 дней × 1
              </button>
            </div>
          </article>
          <article class="card">
            <h2>Выдать код</h2>
            <div class="row">
              <label>
                Telegram id
                <input id="issue-tg" />
              </label>
              <label>
                Email
                <input id="issue-email" />
              </label>
              <label>
                Канал
                <select id="issue-ch" defaultValue="telegram">
                  <option value="telegram">Telegram</option>
                  <option value="email">Email</option>
                  <option value="none">Только показать</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  run('/admin/issue', {
                    telegramId: document.getElementById('issue-tg').value,
                    email: document.getElementById('issue-email').value,
                    channel: document.getElementById('issue-ch').value,
                  })
                }
              >
                Выдать
              </button>
            </div>
          </article>
          <article class="card">
            <h2>Лента</h2>
            {(d.events || []).length === 0 ? <p class="muted">Пока пусто</p> : null}
            <ul>
              {(d.events || []).slice(0, 20).map((e, i) => (
                <li key={i}>
                  <span class={'pill ' + e.kind}>{e.kind}</span>
                  {e.text}{' '}
                  {e.accountId ? (
                    <a href={'/admin/?id=' + encodeURIComponent(e.accountId)}>{e.accountId.slice(0, 8)}</a>
                  ) : null}
                </li>
              ))}
            </ul>
          </article>
        </>
      )}

      {tab === 'subs' && (
        <article class="card">
          <h2>Подписки</h2>
          <div class="filters">
            {[
              ['all', 'Все'],
              ['active', 'Активные'],
              ['unbound', 'Без устройства'],
              ['expired', 'Истекшие'],
            ].map(([id, label]) => (
              <button key={id} type="button" class={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <div class="overflow-auto">
            <table>
              <thead>
                <tr>
                  <th>Кто</th>
                  <th>До</th>
                  <th>Устр.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.who}
                      {s.telegramId ? <Copy value={s.telegramId} /> : null}
                    </td>
                    <td class={s.active ? 'ok' : 'bad'}>{s.paidUntilText}</td>
                    <td>
                      {s.bound}/{s.deviceLimit}
                    </td>
                    <td>
                      <a href={'/admin/?id=' + encodeURIComponent(s.accountId)}>карточка</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {tab === 'finance' && (
        <>
          <div class="grid-stats">
            <div class="stat">
              <b>{Math.round(d.finance?.summary?.day?.sum || 0)}</b>
              <span>₽ сегодня · {d.finance?.summary?.day?.count || 0}</span>
            </div>
            <div class="stat">
              <b>{Math.round(d.finance?.summary?.week?.sum || 0)}</b>
              <span>₽ неделя · {d.finance?.summary?.week?.count || 0}</span>
            </div>
            <div class="stat">
              <b>{Math.round(d.finance?.summary?.month?.sum || 0)}</b>
              <span>₽ месяц · {d.finance?.summary?.month?.count || 0}</span>
            </div>
          </div>
          <p>
            <a href="/admin/finance.csv">Скачать CSV за 30 дней</a>
          </p>
          {(d.finance?.problems || []).length > 0 && (
            <article class="card">
              <h2>Проблемы</h2>
              <ul>
                {d.finance.problems.map((p, i) => (
                  <li key={i} class="bad">
                    {p.kind}: {p.text}
                  </li>
                ))}
              </ul>
            </article>
          )}
          <article class="card">
            <h2>Платежи</h2>
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Сумма</th>
                  <th>Кто</th>
                  <th>Label</th>
                </tr>
              </thead>
              <tbody>
                {(d.finance?.payments || []).map((p, i) => (
                  <tr key={i}>
                    <td>{p.at ? new Date(p.at).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td>{p.amount}</td>
                    <td>
                      {p.accountId ? <a href={'/admin/?id=' + encodeURIComponent(p.accountId)}>{p.who || p.accountId.slice(0, 8)}</a> : p.who || '—'}
                    </td>
                    <td class="muted">{p.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </>
      )}

      {tab === 'promos' && (
        <article class="card">
          <h2>Промокоды</h2>
          <div class="row">
            <label>
              Код (пусто = сгенерировать)
              <input id="promo-code" />
            </label>
            <label>
              Дни
              <input id="promo-days" type="number" defaultValue="1" />
            </label>
            <label>
              Использований
              <input id="promo-uses" type="number" defaultValue="1" />
            </label>
            <button
              type="button"
              onClick={() =>
                run('/admin/promo', {
                  code: document.getElementById('promo-code').value,
                  days: document.getElementById('promo-days').value,
                  maxUses: document.getElementById('promo-uses').value,
                })
              }
            >
              Создать
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Дни</th>
                <th>Uses</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(d.promos || []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <span class={p.revoked ? 'muted' : 'code'}>{p.code}</span> <Copy value={p.code} />
                  </td>
                  <td>{p.days}</td>
                  <td>
                    {p.uses}/{p.maxUses}
                  </td>
                  <td>
                    {!p.revoked ? (
                      <button type="button" class="ghost" onClick={() => run('/admin/promo-revoke', { promoId: p.id })}>
                        Отозвать
                      </button>
                    ) : (
                      <span class="muted">отозван</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      )}

      {tab === 'settings' && (
        <article class="card">
          <h2>Настройки</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const fields = {};
              fd.forEach((v, k) => {
                fields[k] = v;
              });
              void run('/admin/settings', fields);
            }}
          >
            {[
              ['botToken', 'Токен бота'],
              ['botUsername', 'Username бота'],
              ['publicOrigin', 'Публичный URL'],
              ['adminTelegramIds', 'Telegram id админов'],
              ['yoomoneyWallet', 'ЮMoney кошелёк'],
              ['yoomoneySecret', 'ЮMoney секрет'],
              ['jackettUrl', 'Jackett URL'],
              ['jackettApiKey', 'Jackett API key'],
              ['smtpHost', 'SMTP host'],
              ['smtpUser', 'SMTP user'],
              ['smtpPass', 'SMTP pass'],
              ['smtpFrom', 'SMTP from'],
              ['priceRub', 'Цена ₽'],
              ['periodDays', 'Период дней'],
              ['extraDeviceRub', 'Доп. устройство ₽'],
            ].map(([name, label]) => (
              <label key={name}>
                {label}
                <input name={name} defaultValue={d.settings?.[name] ?? ''} />
              </label>
            ))}
            <p class="muted">
              Хранилище: {d.storage?.engine} · {d.storage?.path}
            </p>
            <button type="submit">Сохранить</button>
          </form>
        </article>
      )}

      {tab === 'security' && (
        <>
          <article class="card">
            <h2>Смена пароля</h2>
            <div class="row">
              <label>
                Текущий
                <input id="pw-cur" type="password" />
              </label>
              <label>
                Новый
                <input id="pw-next" type="password" />
              </label>
              <label>
                Ещё раз
                <input id="pw-next2" type="password" />
              </label>
              <button
                type="button"
                onClick={() =>
                  run('/admin/password', {
                    current: document.getElementById('pw-cur').value,
                    next: document.getElementById('pw-next').value,
                    next2: document.getElementById('pw-next2').value,
                  })
                }
              >
                Сменить
              </button>
            </div>
          </article>
          <article class="card">
            <h2>Сессии</h2>
            <table>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(d.sessions || []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.id.slice(0, 8)}…{s.id === d.sessionId ? ' (эта)' : ''}</td>
                    <td>{s.lastSeen ? new Date(s.lastSeen).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td>
                      {s.id !== d.sessionId ? (
                        <button type="button" class="ghost" onClick={() => run('/admin/session-revoke', { sessionId: s.id })}>
                          Завершить
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
          <article class="card">
            <h2>Аудит</h2>
            <ul>
              {(d.audit || []).map((a, i) => (
                <li key={i}>
                  <span class="muted">{a.at ? new Date(a.at).toISOString().slice(0, 16).replace('T', ' ') : ''}</span> {a.action}{' '}
                  {a.detail}
                </li>
              ))}
            </ul>
          </article>
          <article class="card">
            <h2>Отказы кода</h2>
            <ul>
              {(d.fails || []).map((f, i) => (
                <li key={i}>
                  {f.atText} · {f.reason} · {f.deviceId}
                </li>
              ))}
            </ul>
          </article>
        </>
      )}
      <div id="toast" />
    </main>
  );
}
