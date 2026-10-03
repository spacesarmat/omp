import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.spacesarmat.omp',
  appName: 'OMP',
  // plugin calls carry tracker passwords and cookies: never log them (the default logs every debuggable build)
  loggingBehavior: 'none',
  webDir: 'dist-mobile',
  android: { allowMixedContent: true },
  server: { androidScheme: 'http', cleartext: true },
};

export default config;
