export const VERSIONS_START: string;
export const VERSIONS_END: string;

export interface ReleaseTag {
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
  version: string;
  tag: string;
}

export interface SupportedReleases {
  stable: ReleaseTag | null;
  beta: ReleaseTag | null;
}

export function parseReleaseTag(raw: string): ReleaseTag | null;
export function compareReleases(a: ReleaseTag, b: ReleaseTag): number;
export function pickSupported(rawTags: readonly string[]): SupportedReleases;
export function tagsFromLsRemote(text: string): string[];
export function renderVersionBlock(picked: SupportedReleases, lang: 'ru' | 'en'): string;
export function applySecurityVersions(text: string, picked: SupportedReleases): string;
export function listReleaseTags(): string[];
export function supportedFrom(tags: readonly string[], extra?: readonly string[]): SupportedReleases;
export function syncSecurityPolicy(extra?: readonly string[]): SupportedReleases;
