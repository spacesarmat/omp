/** The brand screen inline in mobile/index.html: it covers the time the bundle needs to boot and goes away in the
 * same task as the first render, so the app never shows an empty page. */
export function hideBootScreen(): void {
  const boot = document.getElementById('omp-boot');
  if (boot) boot.remove();
}
