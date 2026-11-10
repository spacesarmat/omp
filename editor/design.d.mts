import type { FlowDocument, ThemeDocument } from '../design/schema';
import type { EditorDraft } from './shared/draft';

export interface CommittedDesign {
  baseCommit: string;
  theme: ThemeDocument;
  flow: FlowDocument;
}

export interface RebaseResult {
  draft: EditorDraft;
  changes: string[];
}

export class DesignError extends Error {
  code: string;
  status: number;
  issues?: unknown;
}

export function getCommittedDesign(root: string): Promise<CommittedDesign | null>;
export function rebaseDraft(options: { root: string; draft: EditorDraft }): Promise<RebaseResult>;
