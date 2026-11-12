import { EditorIcon } from './EditorIcon';
import { EditorToolbar } from './EditorToolbar';

export type CanvasTool = 'select' | 'hand';

export interface CanvasControlsProps {
  zoom: number;
  tool: CanvasTool;
  rulers: boolean;
  grid: boolean;
  snap: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  onTool(tool: CanvasTool): void;
  onToggleRulers(): void;
  onToggleGrid(): void;
  onToggleSnap(): void;
}

export function CanvasControls({ zoom, tool, rulers, grid, snap, onZoomIn, onZoomOut, onFit, onTool, onToggleRulers, onToggleGrid, onToggleSnap }: CanvasControlsProps) {
  return (
    <>
      <EditorToolbar label="Инструменты холста" class="editor-canvas-tools">
        <button type="button" data-testid="tool-select" class="editor-icon-button" aria-label="Выбор" title="Выбор (V)" aria-pressed={tool === 'select'} onClick={() => onTool('select')}><EditorIcon name="cursor" /></button>
        <button type="button" data-testid="tool-hand" class="editor-icon-button" aria-label="Рука" title="Рука (H)" aria-pressed={tool === 'hand'} onClick={() => onTool('hand')}><EditorIcon name="hand" /></button>
        <span class="editor-toolbar-separator" role="separator" aria-orientation="vertical" />
        <button type="button" data-testid="toggle-rulers" class="editor-icon-button" aria-label="Линейки" title="Линейки" aria-pressed={rulers} onClick={onToggleRulers}><EditorIcon name="frame" /></button>
        <button type="button" data-testid="toggle-grid" class="editor-icon-button" aria-label="Сетка" title="Сетка" aria-pressed={grid} onClick={onToggleGrid}><EditorIcon name="grid" /></button>
        <button type="button" data-testid="toggle-snap" class="editor-icon-button" aria-label="Прилипание" title="Прилипание к направляющим" aria-pressed={snap} onClick={onToggleSnap}><EditorIcon name="magnet" /></button>
      </EditorToolbar>
      <EditorToolbar label="Масштаб холста" class="editor-zoom-controls">
        <button type="button" data-action="zoom-out" class="editor-icon-button" aria-label="Уменьшить" title="Уменьшить (Ctrl -)" onClick={onZoomOut}><EditorIcon name="minus" /></button>
        <button type="button" data-action="zoom-fit" data-testid="zoom-value" class="editor-zoom-value" aria-label="Вписать макет" title="Вписать макет (Ctrl 0)" onClick={onFit}>{Math.round(zoom * 100)}%</button>
        <button type="button" data-action="zoom-in" class="editor-icon-button" aria-label="Увеличить" title="Увеличить (Ctrl +)" onClick={onZoomIn}><EditorIcon name="plus" /></button>
        <span class="editor-toolbar-separator" role="separator" aria-orientation="vertical" />
        <button type="button" data-action="zoom-fit-icon" class="editor-icon-button" aria-label="Показать весь макет" title="Показать весь макет" onClick={onFit}><EditorIcon name="fit" /></button>
      </EditorToolbar>
    </>
  );
}
