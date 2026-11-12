import { useEffect, useRef, useState } from 'preact/hooks';
import type { FlowEdgeBranch, FlowNodeKind, FlowNodeView } from '../../../design/schema.ts';
import { instantiateFlowTemplate, type FlowTemplateId } from '../../../design/flow-templates.ts';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';
import { FlowTemplateLibrary } from './FlowTemplateLibrary';
import {
  OUTPUT_BRANCHES,
  addFlowNode,
  autoLayoutFlow,
  connectFlowNodes,
  removeFlowNodes,
  type FlowPosition,
} from '../flow/nodeOperations';
import { copyFlowSelection, pasteFlowSelection, type FlowClipboard } from '../flow/clipboard';
import { EMPTY_FLOW_SELECTION, moveFlowSelection, reduceFlowSelection, type FlowSelection } from '../flow/selection';

export interface FlowNodeSelection {
  ruleId: string;
  nodeId: string;
}

export interface FlowCanvasProps {
  controller: DraftController;
  screenId: string;
  readOnly?: boolean;
  onSelectNode?: (selection: FlowNodeSelection) => void;
  onOpenSimulation?: () => void;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 64;

interface DragState {
  nodeId: string;
  groupNodeIds: string[];
  origins: Record<string, FlowPosition>;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface LinkState {
  fromId: string;
  branch: FlowEdgeBranch;
  x: number;
  y: number;
}

function portCenter(node: FlowNodeView, port: 'in' | 'out'): FlowPosition {
  return { x: node.x + (port === 'out' ? NODE_WIDTH : 0), y: node.y + NODE_HEIGHT / 2 };
}

export function FlowCanvas({ controller, screenId, readOnly = false, onSelectNode, onOpenSimulation }: FlowCanvasProps) {
  const draft = useDraftController(controller);
  const rule = draft.flow.rules.find((entry) => entry.screenId === screenId && entry.graph) ?? null;
  const nodes = rule?.graph?.nodes ?? [];
  const edges = rule?.graph?.edges ?? [];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<FlowPosition>({ x: 0, y: 0 });
  const [selection, setSelection] = useState<FlowSelection>(EMPTY_FLOW_SELECTION);
  const [error, setError] = useState('');
  const [override, setOverride] = useState<Record<string, FlowPosition>>({});
  const [link, setLink] = useState<LinkState | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const linkRef = useRef<LinkState | null>(null);
  const clipboardRef = useRef<FlowClipboard | null>(null);
  const suppressGroupRef = useRef<string[] | null>(null);
  linkRef.current = link;

  // Selection is canvas-local state derived against the live graph, so undo or a screen
  // switch can never point it at nodes that no longer exist.
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  const selectedNodeIds = selection.nodeIds.filter((id) => liveNodeIds.has(id));
  const selectedIdSet = new Set(selectedNodeIds);
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const dispatchSelection = (action: Parameters<typeof reduceFlowSelection>[1]) => {
    setSelection((current) => reduceFlowSelection(current, action));
  };

  const positionOf = (node: FlowNodeView): FlowPosition => override[node.id] ?? { x: node.x, y: node.y };
  const commit = (recipe: (flow: typeof draft.flow) => typeof draft.flow) => {
    controller.update((current) => {
      current.flow = recipe(current.flow);
    });
  };
  const toWorld = (clientX: number, clientY: number): FlowPosition => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: (clientX - left - pan.x) / zoom, y: (clientY - top - pan.y) / zoom };
  };
  const toWorldRef = useRef(toWorld);
  toWorldRef.current = toWorld;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = dragRef.current;
      if (active) {
        const dx = (event.clientX - active.startClientX) / zoom;
        const dy = (event.clientY - active.startClientY) / zoom;
        if (!active.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        active.moved = true;
        setOverride((prev) => {
          const next = { ...prev };
          for (const id of active.groupNodeIds) {
            const origin = active.origins[id];
            if (origin) next[id] = { x: origin.x + dx, y: origin.y + dy };
          }
          return next;
        });
        return;
      }
      if (linkRef.current) {
        const point = toWorldRef.current(event.clientX, event.clientY);
        setLink({ ...linkRef.current, x: point.x, y: point.y });
      }
    };
    const up = (event: PointerEvent) => {
      const active = dragRef.current;
      if (active) {
        dragRef.current = null;
        if (active.moved) {
          if (rule && !readOnly) {
            const dx = (event.clientX - active.startClientX) / zoom;
            const dy = (event.clientY - active.startClientY) / zoom;
            // The whole group commits in one update, so one drag of any size is one undo.
            if (active.groupNodeIds.length > 1) suppressGroupRef.current = active.groupNodeIds;
            try {
              commit((flow) => moveFlowSelection(flow, rule.id, active.groupNodeIds, { x: dx, y: dy }));
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : String(reason));
            }
          }
        }
        // A plain click selects in the node click handler, so pointerup stays silent here
        // and shift-click toggle cannot be overwritten by the drag path.
        setOverride({});
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [controller, rule, readOnly, zoom, onSelectNode]);

  const selectionOf = (nodeId: string): FlowNodeSelection => ({ ruleId: rule?.id ?? '', nodeId });

  const addNode = (kind: FlowNodeKind) => {
    if (readOnly) return;
    setError('');
    const rect = viewportRef.current?.getBoundingClientRect();
    const center = toWorld((rect?.width || 800) / 2, (rect?.height || 600) / 2);
    const position = { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 };
    let created = '';
    let createdRuleId = '';
    try {
      controller.update((current) => {
        const ref = addFlowNode(current.flow, screenId, kind, position);
        created = ref.nodeId;
        createdRuleId = ref.ruleId;
        current.flow = ref.flow;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (created) setSelection({ ruleId: createdRuleId, nodeIds: [created] });
  };

  const copySelection = () => {
    if (!rule || selectedNodeIds.length === 0) return;
    setError('');
    try {
      // Copying is a pure read, so it stays available in read-only compare mode.
      clipboardRef.current = copyFlowSelection(controller.draft.flow, rule.id, selectedNodeIds);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const pasteClipboard = () => {
    if (readOnly || !rule || !clipboardRef.current) return;
    setError('');
    let pasted: string[] = [];
    try {
      controller.update((current) => {
        const result = pasteFlowSelection(current.flow, rule.id, clipboardRef.current!);
        current.flow = result.flow;
        pasted = result.nodeIds;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (pasted.length) setSelection({ ruleId: rule.id, nodeIds: pasted });
  };

  const startLink = (node: FlowNodeView, branch: FlowEdgeBranch, event: PointerEvent) => {
    if (readOnly) return;
    event.stopPropagation();
    setError('');
    const origin = portCenter({ ...node, ...positionOf(node) }, 'out');
    setLink({ fromId: node.id, branch, x: origin.x, y: origin.y });
  };

  const finishLink = (toId: string) => {
    const active = link;
    setLink(null);
    if (!active || !rule || readOnly) return;
    // The connection is computed inside update so it always applies to the latest draft:
    // the flow may have changed between pointerdown and commit.
    try {
      controller.update((current) => {
        const result = connectFlowNodes(current.flow, rule.id, active.fromId, toId, active.branch);
        current.flow = result.flow;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === 'Insert') {
        event.preventDefault();
        addNode('condition');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (event.key === 'Delete' && selectedNodeIds.length > 0 && rule && !readOnly) {
        event.preventDefault();
        setError('');
        try {
          commit((flow) => removeFlowNodes(flow, rule.id, selectedNodeIds));
          dispatchSelection({ type: 'clear' });
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const autoLayout = () => {
    if (readOnly || !rule) return;
    setError('');
    commit((flow) => autoLayoutFlow(flow, rule.id));
  };

  const insertTemplate = (templateId: FlowTemplateId) => {
    if (readOnly) return;
    setError('');
    try {
      const instance = instantiateFlowTemplate(templateId, { id: draft.flow.id, baseCommit: draft.flow.baseCommit });
      controller.update((current) => {
        // Instance ids carry a fresh random token, so appended rules never collide with the
        // existing document; variables merge by id like a clipboard paste.
        const knownVariableIds = new Set((current.flow.variables ?? []).map((variable) => variable.id));
        const missingVariables = (instance.variables ?? []).filter((variable) => !knownVariableIds.has(variable.id));
        current.flow = {
          ...current.flow,
          rules: [...current.flow.rules, ...instance.rules],
          variables: missingVariables.length ? [...(current.flow.variables ?? []), ...missingVariables] : current.flow.variables,
        };
      });
      setTemplatesOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const byId = new Map(nodes.map((node) => [node.id, { ...node, ...positionOf(node) }]));
  return (
    <div class="flow-canvas" data-testid="flow-canvas">
      <div class="flow-canvas-toolbar" role="toolbar" aria-label="Узлы потока">
        <button type="button" data-action="add-trigger" disabled={readOnly} onClick={() => addNode('trigger')}>+ Триггер</button>
        <button type="button" data-action="add-condition" disabled={readOnly} onClick={() => addNode('condition')}>+ Условие</button>
        <button type="button" data-action="add-action" disabled={readOnly} onClick={() => addNode('action')}>+ Действие</button>
        <button type="button" data-action="add-result" disabled={readOnly} onClick={() => addNode('result')}>+ Результат</button>
        <span class="editor-toolbar-separator" role="separator" aria-orientation="vertical" />
        <button type="button" data-action="zoom-out" aria-label="Уменьшить масштаб" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value / ZOOM_STEP))}>-</button>
        <button type="button" data-action="zoom-in" aria-label="Увеличить масштаб" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value * ZOOM_STEP))}>+</button>
        <button type="button" data-action="auto-layout" disabled={readOnly} onClick={autoLayout}>Авторазметка</button>
        {!readOnly && <button type="button" data-action="toggle-templates" onClick={() => setTemplatesOpen((open) => !open)}>Шаблоны</button>}
        {onOpenSimulation && <button type="button" data-action="open-simulation" onClick={onOpenSimulation}>Симуляция</button>}
      </div>
      {templatesOpen && <FlowTemplateLibrary readOnly={readOnly} onInsert={insertTemplate} />}
      {readOnly && <p class="editor-notice" data-testid="flow-canvas-readonly">Базовая тема - редактирование выключено</p>}
      {selectedNodeIds.length > 1 && (
        <p class="editor-notice" data-testid="flow-canvas-multiselect">
          Выбрано узлов: {selectedNodeIds.length}. Shift - добавить или убрать узел, Delete - удалить все.
        </p>
      )}
      {error && <p class="editor-flow-error" role="alert" data-testid="flow-canvas-error">{error}</p>}
      <div
        class="flow-canvas-viewport"
        data-testid="flow-canvas-grid"
        ref={viewportRef}
        style={{ backgroundSize: `${24 * zoom}px ${24 * zoom}px` }}
        onPointerDown={(event) => {
          // The world layer covers the whole viewport, so a background hit is any pointerdown
          // that did not land on a node or a port: dragging empty canvas space pans.
          const target = event.target as HTMLElement;
          if (target.closest('[data-node-id]') || target.closest('[data-port]')) return;
          const start = { x: event.clientX, y: event.clientY };
          const origin = { ...pan };
          const panMove = (moveEvent: PointerEvent) => {
            setPan({ x: origin.x + moveEvent.clientX - start.x, y: origin.y + moveEvent.clientY - start.y });
          };
          const panUp = () => {
            window.removeEventListener('pointermove', panMove);
            window.removeEventListener('pointerup', panUp);
          };
          window.addEventListener('pointermove', panMove);
          window.addEventListener('pointerup', panUp);
        }}
      >
        <div
          class="flow-canvas-world"
          data-testid="flow-canvas-world"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          <svg class="flow-canvas-edges" width="1" height="1">
            {edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to) return null;
              const start = portCenter(from, 'out');
              const end = portCenter(to, 'in');
              const midX = (start.x + end.x) / 2;
              return (
                <path
                  key={edge.id}
                  data-edge-id={edge.id}
                  class={`flow-edge flow-edge-${edge.branch}`}
                  d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                />
              );
            })}
            {link && fromLinkPath(byId.get(link.fromId), link)}
          </svg>
          {nodes.map((node) => {
            const pos = positionOf(node);
            const selected = selectedIdSet.has(node.id);
            return (
              <div
                key={node.id}
                data-node-id={node.id}
                data-kind={node.kind}
                class={`flow-node flow-node-${node.kind}${selected ? ' flow-node-selected' : ''}`}
                style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${NODE_WIDTH}px`, minHeight: `${NODE_HEIGHT}px` }}
                onClick={(event) => {
                  // Browsers fire a click right after a drag; swallow that single click on a
                  // dragged node so it cannot collapse the multi-selection, and self-heal on
                  // the next click anywhere else.
                  if (suppressGroupRef.current) {
                    const suppressed = suppressGroupRef.current;
                    suppressGroupRef.current = null;
                    if (suppressed.includes(node.id)) return;
                  }
                  if (event.shiftKey) {
                    dispatchSelection({ type: 'toggle', ruleId: rule?.id ?? '', nodeId: node.id });
                    return;
                  }
                  dispatchSelection({ type: 'select', ruleId: rule?.id ?? '', nodeId: node.id });
                  onSelectNode?.(selectionOf(node.id));
                }}
                onPointerDown={(event) => {
                  if (readOnly) return;
                  if (event.button !== 0) return;
                  const target = event.target as HTMLElement;
                  if (target.closest('[data-port]')) return;
                  if (!event.shiftKey && !selectedIdSet.has(node.id)) {
                    dispatchSelection({ type: 'select', ruleId: rule?.id ?? '', nodeId: node.id });
                  }
                  const groupNodeIds = !event.shiftKey && selectedIdSet.has(node.id) ? [...selectedNodeIds] : [node.id];
                  const origins: Record<string, FlowPosition> = {};
                  for (const id of groupNodeIds) {
                    const member = byId.get(id);
                    origins[id] = member ? { x: member.x, y: member.y } : { ...pos };
                  }
                  dragRef.current = {
                    nodeId: node.id,
                    groupNodeIds,
                    origins,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    moved: false,
                  };
                }}
              >
                <div class="flow-node-head">
                  <strong>{node.label ?? node.kind}</strong>
                  <small>{node.kind}</small>
                </div>
                {node.kind !== 'trigger' && (
                  <span
                    class="flow-port flow-port-in"
                    data-port="in"
                    data-node={node.id}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      finishLink(node.id);
                    }}
                  />
                )}
                {OUTPUT_BRANCHES[node.kind].map((branch) => (
                  <span
                    key={branch}
                    class={`flow-port flow-port-out flow-port-${branch}`}
                    data-port="out"
                    data-branch={branch}
                    data-node={node.id}
                    title={branch}
                    onPointerDown={(event) => startLink(node, branch, event)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div class="flow-canvas-minimap" data-testid="flow-minimap" aria-hidden="true">
        {nodes.map((node) => {
          const pos = positionOf(node);
          return <span key={node.id} class={`flow-minimap-dot flow-minimap-${node.kind}`} style={{ left: `${pos.x / 12}px`, top: `${pos.y / 12}px` }} />;
        })}
      </div>
    </div>
  );
}

function fromLinkPath(from: FlowNodeView | undefined, link: LinkState) {
  if (!from) return null;
  const start = portCenter(from, 'out');
  const midX = (start.x + link.x) / 2;
  return <path class="flow-edge flow-edge-draft" d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${link.y}, ${link.x} ${link.y}`} />;
}
