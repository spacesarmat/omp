import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { DesignTarget, DesignFormat, DesignState, ThemeDocument } from '../../../design/schema.ts';
import { designOverrideAttrs } from './designScope';
import { DESKTOP_ROUTES, DESKTOP_SCREEN_SUPPORT, type DesktopRouteId } from './routes';
import './shell.css';

export interface DesktopShellProps {
  target: DesignTarget;
  route: DesktopRouteId;
  format: DesignFormat;
  state: DesignState;
  language: 'ru' | 'en';
  theme: ThemeDocument;
  children: ComponentChildren;
}

export function DesktopShell({ target, route, format, state, language, theme, children }: DesktopShellProps) {
  const [collapsed, setCollapsed] = useState(format === 'portrait');
  useEffect(() => setCollapsed(format === 'portrait'), [format]);
  const rootContext = { target, screenId: route, format, state };
  return (
    <div
      class={'desktop-shell' + (collapsed ? ' is-collapsed' : '')}
      data-design-root
      data-design-target={target}
      data-design-screen={route}
      data-design-format={format}
      data-design-state={state}
      {...designOverrideAttrs(theme, rootContext)}
    >
      <aside class="desktop-sidebar" data-design-id="sidebar" data-design-component="sidebar" {...designOverrideAttrs(theme, { ...rootContext, componentId: 'sidebar', elementId: 'sidebar' })}>
        <div class="desktop-brand">OMP</div>
        <button type="button" class="desktop-collapse" data-action="toggle-sidebar" aria-label={language === 'ru' ? 'Свернуть меню' : 'Toggle sidebar'} onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? '>' : '<'}
        </button>
        <nav aria-label={language === 'ru' ? 'Основная навигация' : 'Main navigation'}>
          {DESKTOP_ROUTES.filter((item) => item.menu).map((item) => {
            const active = item.id === route;
            return (
              <button
                type="button"
                key={item.id}
                class={'desktop-nav-item' + (active ? ' is-active' : '')}
                data-design-id={`nav-${item.id}`}
                data-design-component="sidebar-item"
                data-route={item.id}
                aria-current={active ? 'page' : undefined}
                {...designOverrideAttrs(theme, { ...rootContext, componentId: 'sidebar-item', elementId: `nav-${item.id}` })}
              >
                <span class="desktop-nav-icon" aria-hidden="true">{(language === 'ru' ? item.label : item.labelEn).slice(0, 1)}</span>
                <span class="desktop-nav-label">{language === 'ru' ? item.label : item.labelEn}</span>
                <span class="desktop-support">{DESKTOP_SCREEN_SUPPORT[item.id] === 'preview' ? 'preview' : ''}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main class="desktop-content" data-design-id="content" data-design-component="content" {...designOverrideAttrs(theme, { ...rootContext, componentId: 'content', elementId: 'content' })}>
        {children}
      </main>
    </div>
  );
}
