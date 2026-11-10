export declare function updateDownloads(root: ParentNode, fetchImpl: typeof fetch): Promise<void>;
export declare function formatSize(size: number): string;
export declare function formatReleaseDate(iso: string, lang: string): string;
export declare function detectPlatform(ua: string): string;
export declare function highlightPlatform(root: ParentNode, ua: string): string;
