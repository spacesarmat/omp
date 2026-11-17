import { FLOW_TEMPLATES, type FlowTemplateId } from '../../../design/flow-templates';

export interface FlowTemplateLibraryProps {
  readOnly?: boolean;
  onInsert: (templateId: FlowTemplateId) => void;
}

export function FlowTemplateLibrary({ readOnly = false, onInsert }: FlowTemplateLibraryProps) {
  return (
    <div class="flow-template-library" data-testid="flow-template-library">
      <h3>Шаблоны потоков</h3>
      {FLOW_TEMPLATES.map((template) => (
        <div class="flow-template-card" key={template.id} data-template-id={template.id}>
          <strong>{template.title}</strong>
          <p>{template.description}</p>
          <button
            type="button"
            data-action={`insert-${template.id}`}
            disabled={readOnly}
            onClick={() => onInsert(template.id)}
          >
            Вставить
          </button>
        </div>
      ))}
    </div>
  );
}
