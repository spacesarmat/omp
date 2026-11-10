import type { ReleaseIntent } from '../design/schema';
import type { EditorDraft } from './shared/draft';

export interface ExportResult {
  baseCommit: string;
  files: string[];
  releaseIntents: ReleaseIntent[];
}

export class ExportError extends Error {
  code: string;
  status: number;
  issues?: unknown;
}

export function exportDraft(options: { root: string; draft: EditorDraft }): Promise<ExportResult>;
export function inheritExportManifest(root: string, sourceId: string, targetId: string): Promise<(() => Promise<void>) | null>;
export function withRepositoryLock<T>(root: string, operation: () => Promise<T>): Promise<T>;
