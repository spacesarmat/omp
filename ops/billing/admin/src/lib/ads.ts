/** Shapes of /admin/api/ads (src/ads.mjs on the server). */
export type AdSection = 'mine' | 'discoverGrid' | 'discoverRails';
export type AdPlatform = 'phone' | 'androidTv' | 'webos';

export type AdBanner = {
  id: string;
  enabled: boolean;
  title: string;
  text: string;
  advertiser: string;
  erid: string;
  url: string;
  image: string;
  weight: number;
  from: number | null;
  to: number | null;
  platforms: AdPlatform[];
  sections: AdSection[];
  tvMode: 'qr' | 'noclick';
  createdAt?: number;
};

export type AdsConfig = {
  enabled: boolean;
  provider: 'house' | 'yandex';
  everyN: number;
  firstAfter: number;
  afterInstallDays: number;
  maxPerScreen: number;
  railsEvery: number;
  sections: Record<AdSection, boolean>;
  platforms: Record<AdPlatform, boolean>;
  hideForSubscribers: boolean;
  tvHideIfLinkedSubscriber: boolean;
  minAppVersion: string;
  yandex: { nativeUnitPhone: string; nativeUnitTv: string; bannerUnit: string };
  banners: AdBanner[];
};

export type AdStatRow = { key: string; impressions: number; clicks: number; title?: string };

export type AdStats = {
  days: number;
  from: string;
  total: { impressions: number; clicks: number };
  byDay: { day: string; impressions: number; clicks: number }[];
  byBanner: AdStatRow[];
  bySection: AdStatRow[];
  byPlatform: AdStatRow[];
};

export const AD_SECTION_LABEL: Record<AdSection, string> = {
  mine: '«Мои» (сетка, список, компактно)',
  discoverGrid: '«Обзор»: сетка подборки',
  discoverRails: '«Обзор»: главная, между рельсами',
};

export const AD_PLATFORM_LABEL: Record<AdPlatform, string> = {
  phone: 'Телефон',
  androidTv: 'Android TV (следующий этап)',
  webos: 'webOS (следующий этап)',
};

/** CTR in percent with one decimal, «-» without impressions. */
export function ctr(r: { impressions: number; clicks: number }): string {
  if (!r.impressions) return '-';
  return ((r.clicks / r.impressions) * 100).toFixed(1).replace('.', ',') + '%';
}

/** Epoch ms as YYYY-MM-DD in MSK (the form's date inputs). */
export function dayInput(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** File to base64 (without the data: prefix). */
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
