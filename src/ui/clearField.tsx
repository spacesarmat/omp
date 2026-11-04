/** The x drawn inside a text field. Shared by the phone and the TV. */
export function ClearMark() {
  return (
    <svg class="field-clear-mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

/** True when a text field has something to clear. */
export function fieldHasText(value: string): boolean {
  return value.length > 0;
}
