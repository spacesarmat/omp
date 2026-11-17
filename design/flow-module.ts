import type { FlowDocument } from './schema.ts';

export const FLOW_MODULE_OUTPUT = 'design/generated/flow.ts';

// The production runtime imports this module. It carries only the validated flow document
// as JSON, so preview and production share the same behavior after an explicit export.
export function generateFlowModule(flow: FlowDocument): string {
  return [
    "import type { FlowDocument } from '../schema.ts';",
    '',
    '// Generated from design/flows. The export step rewrites this file with the reviewed',
    '// flow document; a document without rules keeps the production runtime a no-op.',
    `export const PRODUCTION_FLOW: FlowDocument = ${JSON.stringify(flow, null, 2)};`,
    '',
  ].join('\n');
}
