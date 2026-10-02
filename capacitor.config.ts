import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.spacesarmat.omp',
  appName: 'OMP',
  webDir: 'dist-mobile',
  android: { allowMixedContent: true },
  server: { androidScheme: 'http', cleartext: true },
};

export default config;
