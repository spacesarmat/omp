export type DonateForm = {
  enabled: boolean;
  yoomoney: boolean;
  stars: boolean;
  crypto: boolean;
  notifyAll: boolean;
  showAmounts: boolean;
  amounts: string;
  minRub: string;
  maxRub: string;
  commentMax: string;
  thanksText: string;
  rubPerStar: string;
  notifyMin: string;
};

type Settings = {
  enabled?: boolean;
  amounts?: string;
  minRub?: number;
  maxRub?: number;
  commentMax?: number;
  thanksText?: string;
  yoomoney?: boolean;
  stars?: boolean;
  crypto?: boolean;
  rubPerStar?: number;
  notifyAll?: boolean;
  notifyMin?: number;
  showAmounts?: boolean;
};

export function formFromDonateSettings(src?: Settings): DonateForm {
  const s = src || {};
  return {
    enabled: s.enabled === true,
    yoomoney: s.yoomoney === true,
    stars: s.stars === true,
    crypto: s.crypto === true,
    notifyAll: s.notifyAll === true,
    showAmounts: s.showAmounts === true,
    amounts: s.amounts || '100,300,500,1000',
    minRub: String(s.minRub ?? 50),
    maxRub: String(s.maxRub ?? 100000),
    commentMax: String(s.commentMax ?? 200),
    thanksText: s.thanksText || 'Спасибо! Вы поддержали проект OMP.',
    rubPerStar: String(s.rubPerStar ?? 0),
    notifyMin: String(s.notifyMin ?? 0),
  };
}

/** A dirty form keeps what the admin typed. A clean form takes the server copy. */
export function keepOrRefreshForm(local: DonateForm, incoming: DonateForm, dirty: boolean): DonateForm {
  return dirty ? local : incoming;
}

function sameForm(a: DonateForm, b: DonateForm): boolean {
  const keys = Object.keys(a) as (keyof DonateForm)[];
  for (let i = 0; i < keys.length; i++) if (a[keys[i]] !== b[keys[i]]) return false;
  return true;
}

/** A save that did not succeed must not clear the form, even without flash.error. */
export function donateSaveFailed(res: { ok?: boolean; flash?: { error?: string } } | null | undefined): boolean {
  if (!res || res.ok !== true) return true;
  return !!(res.flash && res.flash.error);
}

/** Stay dirty when the save failed or the admin typed more while it was running. */
export function stillDirtyAfterSave(current: DonateForm, sent: DonateForm, failed: boolean): boolean {
  if (failed) return true;
  return !sameForm(current, sent);
}

/** A late response from an older filter selection is dropped. `null` means show the unfiltered report. */
export function takeFilterRows<T>(requestId: number, latestId: number, rows: T[] | null): T[] | null | undefined {
  if (requestId !== latestId) return undefined;
  return rows;
}
