export const QUIET: number;
export function qrData(url: string): { url: string; modules: number; size: number; path: string; bits: string };
export function qrModule(url: string): string;
export function donateUrlFrom(source: string): string;
export function supportCode(month: string, privatePem: string | Buffer): string;
export function publicKeyOf(privatePem: string | Buffer): string;
