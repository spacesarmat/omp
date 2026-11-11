import type { LayoutDocument } from '../schema.ts';

// The export step rewrites this file with the shipped layout document.
// An empty document keeps the production runtime a no-op.
export const PRODUCTION_LAYOUT: LayoutDocument = {
  containers: [],
  placements: [],
};
