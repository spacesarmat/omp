import { useEffect, useState } from 'preact/hooks';
import type { EditorDraft } from '../shared/draft';
import type { DraftController } from './drafts';

export function useDraftController(controller: DraftController): EditorDraft {
  const [, setVersion] = useState(0);
  useEffect(() => controller.subscribe(() => setVersion((version) => version + 1)), [controller]);
  return controller.draft;
}
