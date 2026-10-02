import { baseName } from './episodes';

export interface PlaylistEntry {
  url: string;
  title: string;
  duration: number;
  logo?: string;
  group?: string;
  isPlaylist?: true;
}

function findTitleComma(s: string): number {
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) return i;
  }
  return -1;
}

function parseAttrs(s: string): { [k: string]: string } {
  const out: { [k: string]: string } = {};
  const re = /([a-zA-Z0-9-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2];
  return out;
}

function resolveUrl(u: string, base?: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || !base) return u;
  try {
    return new URL(u, base).href;
  } catch (e) {
    return u;
  }
}

function titleFromUrl(u: string): string {
  const path = u.split('?')[0];
  try {
    return decodeURIComponent(baseName(path));
  } catch (e) {
    return baseName(path);
  }
}

function isPlaylistUrl(url: string): boolean {
  const path = url.split('?')[0];
  if (/\.m3u$/i.test(path)) return true;
  if (/[?&]m3u(?:[&=]|$)/.test(url)) return true;
  return false;
}

export function parseM3U(text: string, baseUrl?: string): PlaylistEntry[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const out: PlaylistEntry[] = [];
  let pending: { title: string; duration: number; logo?: string; group?: string; isPlaylist?: boolean } | null = null;
  let extGroup: string | undefined;
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.indexOf('#EXTINF:') === 0) {
      const body = line.slice(8);
      const comma = findTitleComma(body);
      const head = comma >= 0 ? body.slice(0, comma) : body;
      const title = comma >= 0 ? body.slice(comma + 1).trim() : '';
      const dur = parseFloat(head);
      const attrs = parseAttrs(head);
      pending = { title, duration: isNaN(dur) ? -1 : dur, logo: attrs['tvg-logo'], group: attrs['group-title'], isPlaylist: attrs['type'] === 'playlist' };
      return;
    }
    if (line.indexOf('#EXTGRP:') === 0) {
      extGroup = line.slice(8).trim();
      return;
    }
    if (line.charAt(0) === '#') return;
    const url = resolveUrl(line, baseUrl);
    const p = pending as { title: string; duration: number; logo?: string; group?: string; isPlaylist?: boolean } | null;
    const entry: PlaylistEntry = {
      url,
      title: (p && p.title) || titleFromUrl(url),
      duration: p ? p.duration : -1,
    };
    if (p && p.logo) entry.logo = p.logo;
    const group = (p && p.group) || extGroup;
    if (group) entry.group = group;
    if (p?.isPlaylist || isPlaylistUrl(url)) entry.isPlaylist = true;
    out.push(entry);
    pending = null;
    extGroup = undefined;
  });
  return out;
}

export function isHlsPlaylist(text: string): boolean {
  return /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/.test(text);
}

export function parseStreamUrl(url: string): { hash: string; fileIndex: number } | null {
  const play = /\/play\/([0-9a-f]{40})\/(\d+)/i.exec(url);
  if (play) return { hash: play[1].toLowerCase(), fileIndex: +play[2] };
  if (!/\/stream(\/|\?)/.test(url)) return null;
  const link = /[?&]link=([0-9a-f]{40})(?:&|$)/i.exec(url);
  const index = /[?&]index=(\d+)/.exec(url);
  if (!link || !index) return null;
  return { hash: link[1].toLowerCase(), fileIndex: +index[1] };
}
