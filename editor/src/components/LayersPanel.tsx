import { DESIGN_ELEMENTS, isDesignElementAvailable } from '../../../design/catalog';
import type { DesignTarget } from '../../../design/schema';
import { getEditorPages } from '../../shared/routes';
import type { DesktopRouteId } from '../../../desktop/src/shell/routes';
import { EditorIcon, type EditorIconName } from './EditorIcon';

export interface LayersPanelProps {
  selected: string;
  route: DesktopRouteId;
  target?: DesignTarget;
  onSelect(elementId: string): void;
  onNavigate(route: DesktopRouteId): void;
}

const icons: Record<string, EditorIconName> = {
  sidebar: 'sidebar',
  'sidebar-item': 'component',
  content: 'content',
  'settings-continue': 'button',
};

export function LayersPanel({ selected, route, target = 'desktop-windows', onSelect, onNavigate }: LayersPanelProps) {
  const selectedLayer = selected.startsWith('nav-') ? 'sidebar-item' : selected;
  const pages = getEditorPages(target);
  const routeLabel = pages.find((item) => item.id === route)?.label || route;
  const elements = DESIGN_ELEMENTS.filter((element) => isDesignElementAvailable(element.id, route, target));
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
      </div>
      <div class="editor-layers-footer"><span class="editor-status-dot" />Синхронизировано с макетом</div>
    </aside>
  );
}
