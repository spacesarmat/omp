// The on/off switch of a search source row (the search sources screens of Android TV and LG). A module of its own, so the
// LG screen does not pull the Android TV sources screen (a separate chunk) into the main bundle.
export function SourceSwitch(p: { on: boolean }) {
  return (
    <span class={'src-switch' + (p.on ? ' on' : '')}>
      <span class="src-switch-knob" />
    </span>
  );
}
