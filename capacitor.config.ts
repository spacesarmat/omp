import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.spacesarmat.omp',
  appName: 'OMP',
  // plugin calls carry tracker passwords and cookies: never log them (the default logs every debuggable build)
  loggingBehavior: 'none',
  webDir: 'dist-mobile',
  // the phone UI never zooms as a page (MainActivity / PhoneWebZoom and the viewport meta say the same)
  android: { allowMixedContent: true, zoomEnabled: false },
  server: { androidScheme: 'http', cleartext: true },
};

export default config;
