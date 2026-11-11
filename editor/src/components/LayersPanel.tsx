import { useState } from 'preact/hooks';
import { DESIGN_ELEMENTS, isDesignElementAvailable } from '../../../design/catalog';
import type { DesignTarget } from '../../../design/schema';
import { getEditorPages } from '../../shared/routes';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes';
import { EditorIcon, type EditorIconName } from './EditorIcon';

export interface LayerRowModel {
  nodeId: string;
  label: string;
  hidden: boolean;
  locked: boolean;
}

export interface LayersPanelProps {
  selected: string;
  route: DesktopRouteId;
  target?: DesignTarget;
  layers?: LayerRowModel[];
  selectedNodeId?: string | null;
  clipboardError?: string | null;
  readOnly?: boolean;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
  onSelectNode?(nodeId: string): void;
  onRenameNode?(nodeId: string, name: string): void;
  onToggleHidden?(nodeId: string, hidden: boolean): void;
  onToggleLocked?(nodeId: string, locked: boolean): void;
  onDuplicateNode?(nodeId: string): void;
  onCopySelection?(): void;
  onPaste?(): void;
}

const icons: Record<string, EditorIconName> = {
  sidebar: 'sidebar',
  'sidebar-item': 'component',
  content: 'content',
  'settings-continue': 'button',
};

type LayerFilter = 'all' | 'hidden' | 'locked';

export function LayersPanel({
  selected,
  route,
  target = 'desktop-windows',
  layers = [],
  selectedNodeId = null,
  clipboardError = null,
  readOnly = false,
  onSelect,
  onNavigate,
  onSelectNode,
  onRenameNode,
  onToggleHidden,
  onToggleLocked,
  onDuplicateNode,
  onCopySelection,
  onPaste,
}: LayersPanelProps) {
  const selectedLayer = selected.startsWith('nav-') ? 'sidebar-item' : selected;
  const pages = getEditorPages(target);
  const routeLabel = pages.find((item) => item.id === route)?.label || route;
  const elements = DESIGN_ELEMENTS.filter((element) => isDesignElementAvailable(element.id, route, target));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LayerFilter>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleLayers = layers.filter((layer) => {
    if (normalizedQuery && !layer.label.toLowerCase().includes(normalizedQuery)) return false;
    if (filter === 'hidden') return layer.hidden;
    if (filter === 'locked') return layer.locked;
    return true;
  });
  const commitRename = (layer: LayerRowModel, name: string) => {
    setRenamingId(null);
    if (!readOnly && onRenameNode && name.trim()) onRenameNode(layer.nodeId, name);
  };
  return (
    <aside class="editor-layers-panel" aria-label="Слои">
      <div class="editor-panel-heading">
        <h2><EditorIcon name="layers" />Слои</h2>
        <span>{elements.length}</span>
      </div>
      <div class="editor-pages-scroll">
        <div class="editor-page-label">Страницы</div>
        <nav aria-label="Страницы проекта">
          <ul class="editor-page-list">
            {pages.map((page) => (
              <li key={page.id}>
                <button type="button" data-testid={`page-${page.id}`} aria-current={route === page.id ? 'page' : undefined} onClick={() => onNavigate(page.id)}>
                  <EditorIcon name="frame" />
                  <span>{page.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div class="editor-page-label">Шаблоны экрана</div>
        <div class="editor-frame-layer"><EditorIcon name="frame" /><span>{routeLabel}</span><EditorIcon name="chevron" size={12} /></div>
        <ul class="editor-layer-list">
          {elements.map((element) => (
            <li key={element.id}>
              <button
                type="button"
                data-testid={`layer-${element.id}`}
                aria-pressed={selectedLayer === element.id}
                onClick={() => onSelect(element.id)}
              >
                <EditorIcon name={icons[element.id] || 'component'} />
                <span>{element.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {layers.length > 0 && (
          <>
            <div class="editor-page-label">Слои макета</div>
            <div class="editor-layer-tools">
              <input
                type="search"
                data-testid="layout-search"
                placeholder="Поиск слоя"
                value={query}
                onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
              />
              <select
                data-testid="layout-filter"
                aria-label="Фильтр слоёв"
                value={filter}
                onChange={(event) => setFilter((event.target as HTMLSelectElement).value as LayerFilter)}
              >
                <option value="all">Все</option>
                <option value="hidden">Скрытые</option>
                <option value="locked">Заблокированные</option>
              </select>
              <button type="button" data-testid="layout-copy" class="editor-icon-button" aria-label="Копировать выделенные слои" title="Копировать выделенные слои" onClick={() => onCopySelection?.()}><EditorIcon name="copy" /></button>
              <button type="button" data-testid="layout-paste" class="editor-icon-button" aria-label="Вставить слои" title="Вставить слои" disabled={readOnly} onClick={() => { if (!readOnly) onPaste?.(); }}><EditorIcon name="plus" /></button>
            </div>
            <ul class="editor-layer-list editor-layout-layer-list">
              {visibleLayers.map((layer) => (
                <li key={layer.nodeId}>
                  <div
                    class={`editor-layer-row${layer.hidden || layer.locked ? ' editor-layer-muted' : ''}`}
                    data-testid={`layout-row-${layer.nodeId}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedNodeId === layer.nodeId}
                    onClick={() => onSelectNode?.(layer.nodeId)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectNode?.(layer.nodeId); }}
                  >
                    {renamingId === layer.nodeId ? (
                      <input
                        type="text"
                        data-testid="layout-rename-input"
                        value={draftName}
                        maxLength={60}
                        disabled={readOnly}
                        onInput={(event) => setDraftName((event.target as HTMLInputElement).value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename(layer, (event.target as HTMLInputElement).value);
                          if (event.key === 'Escape') setRenamingId(null);
                          event.stopPropagation();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        class="editor-layer-row-name"
                        title={layer.label}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectNode?.(layer.nodeId);
                        }}
                      >
                        <EditorIcon name="component" />
                        <span>{layer.label}</span>
                      </button>
                    )}
                    <span class="editor-layer-row-actions">
                      {onRenameNode && renamingId !== layer.nodeId && (
                        <button
                          type="button"
                          data-testid={`layout-rename-${layer.nodeId}`}
                          class="editor-icon-button"
                          aria-label="Переименовать слой"
                          title="Переименовать слой"
                          disabled={readOnly}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (readOnly) return;
                            setDraftName(layer.label);
                            setRenamingId(layer.nodeId);
                          }}
                        >
                          <EditorIcon name="design" />
                        </button>
                      )}
                      {onToggleHidden && (
                        <button
                          type="button"
                          data-testid={`layout-hide-${layer.nodeId}`}
                          class="editor-icon-button"
                          aria-label={layer.hidden ? 'Показать слой' : 'Скрыть слой'}
                          title={layer.hidden ? 'Показать слой' : 'Скрыть слой'}
                          aria-pressed={layer.hidden}
                          disabled={readOnly}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (readOnly) return;
                            onToggleHidden(layer.nodeId, !layer.hidden);
                          }}
                        >
                          <EditorIcon name={layer.hidden ? 'eye-off' : 'eye'} />
                        </button>
                      )}
                      {onToggleLocked && (
                        <button
                          type="button"
                          data-testid={`layout-lock-${layer.nodeId}`}
                          class="editor-icon-button"
                          aria-label={layer.locked ? 'Разблокировать слой' : 'Заблокировать слой'}
                          title={layer.locked ? 'Разблокировать слой' : 'Заблокировать слой'}
                          aria-pressed={layer.locked}
                          disabled={readOnly}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (readOnly) return;
                            onToggleLocked(layer.nodeId, !layer.locked);
                          }}
                        >
                          <EditorIcon name={layer.locked ? 'lock' : 'unlock'} />
                        </button>
                      )}
                      {onDuplicateNode && (
                        <button
                          type="button"
                          data-testid={`layout-duplicate-${layer.nodeId}`}
                          class="editor-icon-button"
                          aria-label="Дублировать слой"
                          title="Дублировать слой"
                          disabled={readOnly}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (readOnly) return;
                            onDuplicateNode(layer.nodeId);
                          }}
                        >
                          <EditorIcon name="copy" />
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
              {visibleLayers.length === 0 && <li class="editor-layer-empty">Нет слоёв по запросу</li>}
            </ul>
          </>
        )}
      </div>
      <div class="editor-layers-footer"><span class="editor-status-dot" />{clipboardError || 'Синхронизировано с макетом'}</div>
    </aside>
  );
}
