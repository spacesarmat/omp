import type { JSX } from 'preact';

export interface RulersProps {
  viewport: { width: number; height: number };
  zoom: number;
}

const RULER_SIZE = 28;
const RULER_STEP = 100;
const RULER_MINOR = 10;

function ticks(length: number): number[] {
  const values: number[] = [];
  for (let value = 0; value <= length; value += RULER_STEP) values.push(value);
  return values;
}

// Rulers live in screen space next to the scaled artboard: geometry is mapped through zoom so a
// tick always points at the same artboard position, while the strip itself stays the same size.
export function Rulers(props: RulersProps): JSX.Element {
  const scale = props.zoom > 0 ? props.zoom : 1;
  return (
    <div class="editor-rulers" data-testid="rulers" aria-hidden="true">
      <div class="editor-ruler-corner" style={{ width: `${RULER_SIZE}px`, height: `${RULER_SIZE}px` }} />
      <div
        class="editor-ruler editor-ruler-x"
        data-testid="ruler-x"
        style={{
          left: `${RULER_SIZE}px`,
          top: '0px',
          width: `${props.viewport.width * scale}px`,
          height: `${RULER_SIZE}px`,
          backgroundSize: `${RULER_MINOR * scale}px 100%`,
        }}
      >
        {ticks(props.viewport.width).map((value) => (
          <div key={value} class="editor-ruler-tick" data-testid="ruler-tick" data-value={String(value)} style={{ left: `${value * scale}px` }}>
            <span>{value}</span>
          </div>
        ))}
      </div>
      <div
        class="editor-ruler editor-ruler-y"
        data-testid="ruler-y"
        style={{
          left: '0px',
          top: `${RULER_SIZE}px`,
          width: `${RULER_SIZE}px`,
          height: `${props.viewport.height * scale}px`,
          backgroundSize: `100% ${RULER_MINOR * scale}px`,
        }}
      >
        {ticks(props.viewport.height).map((value) => (
          <div key={value} class="editor-ruler-tick" data-testid="ruler-tick" data-value={String(value)} style={{ top: `${value * scale}px` }}>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
