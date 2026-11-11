import type { LayoutContext } from '../../../design/schema.ts';
import { parseSpacingField } from './LayoutInspector.tsx';
import type { SelectionAlignment } from '../layout/selection.ts';

export interface MultiSelectInspectorProps {
  context: LayoutContext;
  count: number;
  margin: string | 'mixed' | undefined;
  onAlign(alignment: SelectionAlignment): void;
  onDistribute(axis: 'x' | 'y'): void;
  onMargin(margin: string | undefined): void;
}

const ALIGN_BUTTONS: { alignment: SelectionAlignment; testId: string; label: string }[] = [
  { alignment: 'left', testId: 'align-left', label: 'По левому краю' },
  { alignment: 'center', testId: 'align-center', label: 'По центру' },
  { alignment: 'right', testId: 'align-right', label: 'По правому краю' },
  { alignment: 'top', testId: 'align-top', label: 'По верхнему краю' },
  { alignment: 'middle', testId: 'align-middle', label: 'По середине' },
  { alignment: 'bottom', testId: 'align-bottom', label: 'По нижнему краю' },
];

// Shared edits for the whole selection: alignment buttons distinguish flow children (container
// record patch) from absolute nodes (coordinate rewrite) in the App handler, one click is one undo.
export function MultiSelectInspector(props: MultiSelectInspectorProps) {
  return (
    <div class="editor-multi-inspector" data-testid="multi-select-inspector">
      <h3>Выбрано элементов: {props.count}</h3>
      <p class="editor-chain">layout &gt; {props.context.screenId} &gt; multi</p>
      <div class="editor-multi-align" role="group" aria-label="Выравнивание">
        {ALIGN_BUTTONS.map((button) => (
          <button
            type="button"
            key={button.alignment}
            data-testid={button.testId}
            title={button.label}
            onClick={() => props.onAlign(button.alignment)}
          >
            {button.label}
          </button>
        ))}
      </div>
      <div class="editor-multi-distribute" role="group" aria-label="Распределение">
        <button type="button" data-testid="distribute-x" title="Распределить по горизонтали" onClick={() => props.onDistribute('x')}>
          Распределить по X
        </button>
        <button type="button" data-testid="distribute-y" title="Распределить по вертикали" onClick={() => props.onDistribute('y')}>
          Распределить по Y
        </button>
      </div>
      <label>Внешние поля
        <input
          type="text"
          data-testid="multi-margin"
          value={props.margin === 'mixed' || props.margin === undefined ? '' : props.margin}
          placeholder={props.margin === 'mixed' ? 'разные' : '0px'}
          onChange={(event) => {
            const parsed = parseSpacingField(event.currentTarget.value);
            if (parsed === null || parsed === 'mixed') return;
            props.onMargin(parsed === '' ? undefined : parsed);
          }}
        />
      </label>
    </div>
  );
}
