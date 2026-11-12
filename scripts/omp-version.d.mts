export function nextBeta(version: string): string;
export function webosVersion(version: string): string;
export function promoteUnreleased(text: string, version: string, english?: boolean): string;
export function replaceVersionFields(text: string, from: string, to: string, expected: number): string;
export function replaceCargoVersion(text: string, from: string, to: string, expected: number): string;
export function replaceCounted(text: string, needle: string, replacement: string, expected: number): string;
