// Phone side of the device tokens (PR-5): the pair from activation, rotation, one refresh at a time, a lost answer,
// the hidden pages, the one-time move off the legacy token and the «устройство отключено» notice.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BILLING_ORIGIN } from "../../src/billing/config";
import {
  ompSubscribed,
  saveBillingAccess,
} from "../../src/billing/entitlement";
import {
  billingNotice,
  billingSession,
  deviceId,
  saveBillingSession,
  setBillingNotice,
} from "../../src/billing/session";
import {
  allowBillingRefresh,
  REFRESH_SECRET,
  refreshDeviceTokens,
  resetBillingTokens,
  startBillingKeepAlive,
} from "../../src/billing/tokens";
import {
  activateCode,
  clearBilling,
  clearTelegramLink,
  fetchBillingAccount,
  ompJackettSource,
} from "../../src/sources/ompJackett";
import { unregisterSource } from "../../src/sources/registry";
import { fakeSite, page, type HttpCall } from "../sources/fakeSite";

const HOUR = 60 * 60 * 1000;
const RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
const ME = JSON.stringify({
  telegramId: "",
  paidUntil: 2e12,
  active: true,
  accessUntil: 2e12,
  sources: { jackett: true, jacred: true },
});

let n = 0;
function pair(extra?: object) {
  n++;
  return JSON.stringify({
    refreshToken: "r1.n" + n,
    accessToken: "a1.n" + n,
    accessExpiresAt: Date.now() + 24 * HOUR,
    refreshExpiresAt: Date.now() + 180 * 24 * HOUR,
    paidUntil: 2e12,
    ...extra,
  });
}

/** A phone already on the pair: access `a1.cur` (ends in `left` ms), refresh `r1.cur` in the Keystore. */
function onPair(left: number) {
  saveBillingSession({
    token: "",
    paidUntil: 2e12,
    id: "b".repeat(32),
    access: "a1.cur",
    accessExp: Date.now() + left,
    refreshExp: 3e12,
  });
}

const paths = (calls: HttpCall[]) =>
  calls.map((c) => c.url.replace(BILLING_ORIGIN, ""));
const bearer = (c: HttpCall) =>
  c.opts && c.opts.headers ? c.opts.headers.Authorization : undefined;
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("device tokens on the phone", () => {
  let pauses: number[];
  beforeEach(() => {
    localStorage.clear();
    n = 0;
    pauses = [];
    resetBillingTokens((ms) => {
      pauses.push(ms);
      return Promise.resolve();
    });
    allowBillingRefresh(true);
  });
  afterEach(() => {
    allowBillingRefresh(false);
    resetBillingTokens();
    clearBilling();
    unregisterSource("omp-jackett");
    unregisterSource("omp-jacred");
  });

  it("activation keeps the refresh token in the Keystore, never in localStorage", async () => {
    setBillingNotice("revoked");
    const site = fakeSite((c) => page(pair(), c.url), {});
    await activateCode(site.ctx, "ABCD-EFGH");
    expect(site.calls[0].form).toEqual({
      code: "ABCD-EFGH",
      deviceId: deviceId(),
      tokens: "pair",
    });
    expect(site.secrets[REFRESH_SECRET]).toBe("r1.n1");
    const s = billingSession()!;
    expect(s.access).toBe("a1.n1");
    expect(s.token).toBe("");
    expect(s.refresh).toBeUndefined();
    expect(JSON.stringify(localStorage)).not.toContain("r1.n1");
    expect(billingNotice()).toBe("");
  });

  it("without a Keystore the refresh token stays in the session", async () => {
    const site = fakeSite((c) => page(pair(), c.url), null);
    await activateCode(site.ctx, "ABCD-EFGH");
    expect(billingSession()!.refresh).toBe("r1.n1");
  });

  it("says what a refused code means: device_limit, other_device, app_update_required", async () => {
    const answer = (status: number, body: object) =>
      fakeSite((c) => page(JSON.stringify(body), c.url, status), {});
    await expect(
      activateCode(answer(409, { error: "device_limit" }).ctx, "ABCD-EFGH"),
    ).rejects.toThrow("Все устройства подписки заняты");
    await expect(
      activateCode(answer(409, { error: "other_device" }).ctx, "ABCD-EFGH"),
    ).rejects.toThrow("уже привязан к другому устройству");
    await expect(
      activateCode(
        answer(403, { error: "app_update_required" }).ctx,
        "ABCD-EFGH",
      ),
    ).rejects.toThrow("Обновите приложение OMP");
    await expect(
      activateCode(answer(403, { error: "expired" }).ctx, "ABCD-EFGH"),
    ).rejects.toThrow("Подписка закончилась");
    await expect(
      activateCode(answer(403, { error: "bad_code" }).ctx, "ABCD-EFGH"),
    ).rejects.toThrow("Код не подошёл");
    await expect(
      activateCode(answer(429, { error: "rate" }).ctx, "ABCD-EFGH"),
    ).rejects.toThrow("Слишком много запросов");
    expect(billingSession()).toBeNull();
  });

  it("a fresh access token is used as is", async () => {
    onPair(20 * HOUR);
    const site = fakeSite((c) => page(RSS, c.url), {
      [REFRESH_SECRET]: "r1.cur",
    });
    await ompJackettSource().search("q", site.ctx);
    expect(paths(site.calls)).toEqual(["/v1/search"]);
    expect(bearer(site.calls[0])).toBe("Bearer a1.cur");
    expect(site.calls[0].opts!.headers!["X-Device-Id"]).toBe(deviceId());
  });

  it("renews ahead of expiry and rotates the refresh token", async () => {
    onPair(HOUR);
    const site = fakeSite(
      (c) => page(c.url.indexOf("/v1/token/refresh") > 0 ? pair() : RSS, c.url),
      { [REFRESH_SECRET]: "r1.cur" },
    );
    await ompJackettSource().search("q", site.ctx);
    expect(paths(site.calls)).toEqual(["/v1/token/refresh", "/v1/search"]);
    expect(site.calls[0].form!.refreshToken).toBe("r1.cur");
    expect(site.calls[0].opts!.headers!["X-Device-Id"]).toBe(deviceId());
    expect(bearer(site.calls[1])).toBe("Bearer a1.n1");
    expect(site.secrets[REFRESH_SECRET]).toBe("r1.n1");
    expect(billingSession()!.id).toBe("b".repeat(32));
  });

  it("an early refresh that fails keeps using the current token", async () => {
    onPair(HOUR);
    const site = fakeSite(
      (c) =>
        c.url.indexOf("/v1/token/refresh") > 0
          ? Promise.reject(new Error("offline"))
          : page(RSS, c.url),
      {
        [REFRESH_SECRET]: "r1.cur",
      },
    );
    await ompJackettSource().search("q", site.ctx);
    expect(paths(site.calls)).toEqual([
      "/v1/token/refresh",
      "/v1/token/refresh",
      "/v1/search",
    ]);
    expect(bearer(site.calls[2])).toBe("Bearer a1.cur");
    // no new attempt for a while: the next search goes straight out
    await ompJackettSource().search("q", site.ctx);
    expect(paths(site.calls).slice(3)).toEqual(["/v1/search"]);
  });

  it("one refresh at a time: parallel calls share it", async () => {
    onPair(-1);
    const site = fakeSite(
      (c) => page(c.url.indexOf("/v1/token/refresh") > 0 ? pair() : RSS, c.url),
      { [REFRESH_SECRET]: "r1.cur" },
    );
    await Promise.all([
      ompJackettSource().search("a", site.ctx),
      ompJackettSource().search("b", site.ctx),
      fetchBillingAccount(site.ctx),
    ]);
    expect(
      paths(site.calls).filter((p) => p === "/v1/token/refresh"),
    ).toHaveLength(1);
    expect(
      site.calls
        .filter((c) => c.url.indexOf("/v1/token") < 0)
        .every((c) => bearer(c) === "Bearer a1.n1"),
    ).toBe(true);
  });

  it("401 token_expired renews the pair and repeats the call once", async () => {
    onPair(20 * HOUR);
    let searches = 0;
    const site = fakeSite(
      (c) => {
        if (c.url.indexOf("/v1/token/refresh") > 0) return page(pair(), c.url);
        searches++;
        return searches === 1
          ? page(JSON.stringify({ error: "token_expired" }), c.url, 401)
          : page(RSS, c.url);
      },
      { [REFRESH_SECRET]: "r1.cur" },
    );
    await ompJackettSource().search("q", site.ctx);
    expect(paths(site.calls)).toEqual([
      "/v1/search",
      "/v1/token/refresh",
      "/v1/search",
    ]);
    expect(bearer(site.calls[2])).toBe("Bearer a1.n1");
  });

  it("a lost refresh answer is retried once with the same token inside the grace window", async () => {
    onPair(-1);
    let tries = 0;
    const site = fakeSite(
      (c) => {
        if (c.url.indexOf("/v1/token/refresh") > 0) {
          tries++;
          return tries === 1
            ? Promise.reject(new Error("timeout"))
            : page(pair(), c.url);
        }
        return page(RSS, c.url);
      },
      { [REFRESH_SECRET]: "r1.cur" },
    );
    await ompJackettSource().search("q", site.ctx);
    const refreshes = site.calls.filter(
      (c) => c.url.indexOf("/v1/token/refresh") > 0,
    );
    expect(refreshes.map((c) => c.form!.refreshToken)).toEqual([
      "r1.cur",
      "r1.cur",
    ]);
    expect(pauses).toEqual([3000]);
    expect(site.secrets[REFRESH_SECRET]).toBe("r1.n1");
  });

  for (const code of ["revoked", "refresh_expired", "bad_token"]) {
    it(
      "refresh answered " +
        code +
        ": the device is disconnected and asks for a new code",
      async () => {
        onPair(-1);
        saveBillingAccess({ active: true, accessUntil: 2e12 });
        const site = fakeSite(
          (c) => page(JSON.stringify({ error: code }), c.url, 401),
          { [REFRESH_SECRET]: "r1.cur" },
        );
        await expect(ompJackettSource().search("q", site.ctx)).rejects.toThrow(
          "Устройство отключено — введите новый код",
        );
        expect(billingSession()).toBeNull();
        expect(billingNotice()).toBe("revoked");
        expect(ompSubscribed()).toBe(false);
        await tick();
        expect(site.secrets[REFRESH_SECRET]).toBeUndefined();
      },
    );
  }

  it("401 revoked on a call forgets the binding at once", async () => {
    onPair(20 * HOUR);
    const site = fakeSite(
      (c) => page(JSON.stringify({ error: "revoked" }), c.url, 401),
      { [REFRESH_SECRET]: "r1.cur" },
    );
    expect(await fetchBillingAccount(site.ctx)).toBeNull();
    expect(billingSession()).toBeNull();
    expect(billingNotice()).toBe("revoked");
    expect(paths(site.calls)).toEqual(["/v1/me"]);
  });

  it("a network error never disconnects", async () => {
    onPair(-1);
    const site = fakeSite(() => Promise.reject(new Error("offline")), {
      [REFRESH_SECRET]: "r1.cur",
    });
    await expect(ompJackettSource().search("q", site.ctx)).rejects.toThrow(
      "Сервер подписки не отвечает",
    );
    expect(billingSession()!.access).toBe("a1.cur");
    expect(billingNotice()).toBe("");
  });

  it("a hidden page never rotates: it repeats only with a token the app saved meanwhile", async () => {
    onPair(-1);
    allowBillingRefresh(false);
    const site = fakeSite(
      (c) => page(JSON.stringify({ error: "token_expired" }), c.url, 401),
      { [REFRESH_SECRET]: "r1.cur" },
    );
    await expect(ompJackettSource().search("q", site.ctx)).rejects.toThrow(
      "Откройте OMP на телефоне",
    );
    expect(paths(site.calls)).toEqual(["/v1/search"]);
    expect(billingSession()!.access).toBe("a1.cur");

    let first = true;
    const later = fakeSite((c) => {
      if (first) {
        first = false;
        // the app's page renewed the pair while this call was on the way
        saveBillingSession({
          ...billingSession()!,
          access: "a1.app",
          accessExp: Date.now() + 24 * HOUR,
        });
        return page(JSON.stringify({ error: "token_expired" }), c.url, 401);
      }
      return page(RSS, c.url);
    });
    await ompJackettSource().search("q", later.ctx);
    expect(later.calls.map(bearer)).toEqual(["Bearer a1.cur", "Bearer a1.app"]);
  });

  it("the background page (ctx.background) does not rotate either", async () => {
    onPair(-1);
    const site = fakeSite(
      (c) => page(JSON.stringify({ error: "token_expired" }), c.url, 401),
      { [REFRESH_SECRET]: "r1.cur" },
    );
    await expect(
      fetchBillingAccount({ ...site.ctx, background: true }),
    ).rejects.toThrow("Откройте OMP на телефоне");
    expect(paths(site.calls)).toEqual(["/v1/me"]);
    expect(billingSession()).not.toBeNull();
  });

  it("an old install moves off the legacy token once and keeps its cached subscription state", async () => {
    saveBillingSession({ token: "legacy-1", paidUntil: 1 });
    saveBillingAccess({ active: true, accessUntil: Date.now() + 2 * HOUR });
    expect(ompSubscribed()).toBe(true);
    const site = fakeSite(
      (c) =>
        page(
          c.url.indexOf("/v1/token/upgrade") > 0
            ? pair({ paidUntil: 2e12 })
            : ME,
          c.url,
        ),
      {},
    );
    await fetchBillingAccount(site.ctx);
    expect(paths(site.calls)).toEqual(["/v1/token/upgrade", "/v1/me"]);
    expect(bearer(site.calls[0])).toBe("Bearer legacy-1");
    expect(site.calls[0].opts!.headers!["X-Device-Id"]).toBe(deviceId());
    expect(bearer(site.calls[1])).toBe("Bearer a1.n1");
    const s = billingSession()!;
    expect(s.token).toBe("");
    expect(s.access).toBe("a1.n1");
    expect(site.secrets[REFRESH_SECRET]).toBe("r1.n1");
    expect(ompSubscribed()).toBe(true);
    await fetchBillingAccount(site.ctx);
    expect(
      paths(site.calls).filter((p) => p === "/v1/token/upgrade"),
    ).toHaveLength(1);
  });

  it("a failed upgrade keeps the legacy token working and waits before trying again", async () => {
    saveBillingSession({ token: "legacy-1", paidUntil: 2e12 });
    const site = fakeSite(
      (c) =>
        c.url.indexOf("/v1/token/upgrade") > 0
          ? page("{}", c.url, 503)
          : page(ME, c.url),
      {},
    );
    await fetchBillingAccount(site.ctx);
    await fetchBillingAccount(site.ctx);
    expect(paths(site.calls)).toEqual([
      "/v1/token/upgrade",
      "/v1/me",
      "/v1/me",
    ]);
    expect(
      site.calls.slice(1).every((c) => bearer(c) === "Bearer legacy-1"),
    ).toBe(true);
    expect(billingSession()!.token).toBe("legacy-1");

    const old = fakeSite(
      (c) =>
        c.url.indexOf("/v1/token/upgrade") > 0
          ? page("not found", c.url, 404)
          : page(ME, c.url),
      {},
    );
    resetBillingTokens();
    await fetchBillingAccount(old.ctx);
    expect(billingSession()!.token).toBe("legacy-1");
  });

  it("a lost upgrade answer is asked again at once (the server re-issues within 60 s)", async () => {
    saveBillingSession({ token: "legacy-1", paidUntil: 2e12 });
    let tries = 0;
    const site = fakeSite((c) => {
      if (c.url.indexOf("/v1/token/upgrade") > 0) {
        tries++;
        return tries === 1
          ? Promise.reject(new Error("timeout"))
          : page(pair(), c.url);
      }
      return page(ME, c.url);
    }, {});
    await fetchBillingAccount(site.ctx);
    expect(tries).toBe(2);
    expect(billingSession()!.access).toBe("a1.n1");
  });

  it("upgrade answered upgraded: disconnected, a new code is needed", async () => {
    saveBillingSession({ token: "legacy-1", paidUntil: 2e12 });
    const site = fakeSite(
      (c) => page(JSON.stringify({ error: "upgraded" }), c.url, 401),
      {},
    );
    await expect(fetchBillingAccount(site.ctx)).rejects.toThrow(
      "Устройство отключено",
    );
    expect(billingSession()).toBeNull();
    expect(billingNotice()).toBe("revoked");
  });

  it("legacy_disabled on a hidden page says the old sign-in is off", async () => {
    saveBillingSession({ token: "legacy-1", paidUntil: 2e12 });
    allowBillingRefresh(false);
    const site = fakeSite(
      (c) => page(JSON.stringify({ error: "legacy_disabled" }), c.url, 401),
      {},
    );
    await expect(ompJackettSource().search("q", site.ctx)).rejects.toThrow(
      "Старый вход в подписку больше не работает",
    );
  });

  it("the keep-alive moves a legacy session and renews a stale access token", async () => {
    saveBillingSession({ token: "legacy-1", paidUntil: 2e12 });
    allowBillingRefresh(false);
    const site = fakeSite((c) => page(pair(), c.url), {});
    const stop = startBillingKeepAlive(() => site.ctx);
    await tick();
    stop();
    expect(paths(site.calls)).toEqual(["/v1/token/upgrade"]);
    expect(billingSession()!.access).toBe("a1.n1");
  });

  it("a refresh that ends after «Отключить» does not bring the session back", async () => {
    onPair(-1);
    let release: () => void = () => undefined;
    const site = fakeSite(
      (c) =>
        new Promise((resolve) => {
          release = () => resolve(page(pair(), c.url));
        }),
      { [REFRESH_SECRET]: "r1.cur" },
    );
    const p = refreshDeviceTokens(site.ctx);
    await tick();
    clearBilling(site.ctx);
    release();
    await expect(p).rejects.toThrow();
    expect(billingSession()).toBeNull();
  });

  it("unlinking Telegram sends the device token when there is one", async () => {
    onPair(20 * HOUR);
    const site = fakeSite((c) => page('{"ok":true}', c.url), {
      [REFRESH_SECRET]: "r1.cur",
    });
    await clearTelegramLink(site.ctx);
    expect(bearer(site.calls[0])).toBe("Bearer a1.cur");
    expect(site.calls[0].opts!.headers!["X-Device-Id"]).toBe(deviceId());
    clearBilling(site.ctx);
    const bare = fakeSite((c) => page('{"ok":true}', c.url), {});
    await clearTelegramLink(bare.ctx);
    expect(bearer(bare.calls[0])).toBeUndefined();
    expect(bare.calls[0].opts!.headers!["X-Device-Id"]).toBe(deviceId());
  });
});
