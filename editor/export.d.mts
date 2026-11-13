import type { DesignTarget, FlowDocument, ReleaseIntent, ThemeDocument } from '../design/schema';
import type { FlowDocumentDiff } from '../design/production-flow';
import type { EditorDraft } from './shared/draft';

export type ExportScope =
  | { kind: 'all' }
  | { kind: 'page'; screenId: string }
  | { kind: 'component'; nodeId: string };

export interface ExportPlanFile {
  path: string;
  content: string;
}

export interface ExportPlan {
  scope: ExportScope;
  targets: DesignTarget[];
  draft: EditorDraft;
  theme: ThemeDocument;
  // The scoped flow view the plan ships: the full document for the all scope, the owned
  // rules (with the variables they reference) for a scoped export.
  flow: FlowDocument;
  files: ExportPlanFile[];
}

export interface ExportDiffFile {
  path: string;
  action: 'create' | 'update' | 'unchanged';
  before: string | null;
  after: string;
  // Structured review diff for flow documents: added/removed/changed ids per section.
  flow?: FlowDocumentDiff | null;
}

export interface ExportDiff {
  baseCommit: string;
  targets: DesignTarget[];
  files: ExportDiffFile[];
  foreignDirty: string[];
}

export interface ExportResult {
  baseCommit: string;
  files: string[];
  releaseIntents: ReleaseIntent[];
  targets: DesignTarget[];
  scope: 'all' | 'page' | 'component';
}

export class ExportError extends Error {
  code: string;
  status: number;
  issues?: unknown;
}

export function createExportPlan(draft: unknown, scope: unknown): ExportPlan;
export function createExportDiff(root: string, plan: ExportPlan): Promise<ExportDiff>;
export function exportDraft(options: { root: string; draft: EditorDraft; scope?: ExportScope }): Promise<ExportResult>;
export function inheritExportManifest(root: string, sourceId: string, targetId: string): Promise<(() => Promise<void>) | null>;
export function withRepositoryLock<T>(root: string, operation: () => Promise<T>): Promise<T>;
