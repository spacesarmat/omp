// Cross-platform runner for android/gradlew: node scripts/gradle.mjs assembleDebug
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const win = process.platform === 'win32';
const androidDir = join(process.cwd(), 'android');
const env = { ...process.env };

function javaMajor(home) {
  const exe = join(home, 'bin', win ? 'java.exe' : 'java');
  if (!existsSync(exe)) return 0;
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8' });
  const m = /version "(\d+)(?:\.(\d+))?/.exec((r.stderr || '') + (r.stdout || ''));
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

function currentJavaMajor() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8', shell: win });
  const m = /version "(\d+)(?:\.(\d+))?/.exec((r.stderr || '') + (r.stdout || ''));
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

// Capacitor 8 / current AGP need Java 21+
const ok = env.JAVA_HOME ? javaMajor(env.JAVA_HOME) >= 21 : currentJavaMajor() >= 21;
if (!ok) {
  const jbr = [
    'C:/Program Files/Android/Android Studio/jbr',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/opt/android-studio/jbr',
  ].find((p) => existsSync(p));
  if (jbr) {
    env.JAVA_HOME = jbr;
    console.log('[gradle] JAVA_HOME ->', jbr);
  } else {
    console.warn('[gradle] Java 21+ not found; set JAVA_HOME to a JDK 21 install');
  }
}

if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
  const sdk = [
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android', 'Sdk'),
    join(homedir(), 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
  ].find((p) => p && existsSync(p));
  if (sdk) {
    env.ANDROID_HOME = sdk;
    console.log('[gradle] ANDROID_HOME ->', sdk);
  }
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node scripts/gradle.mjs <task> [...]');
  process.exit(2);
}
const wrapper = join(androidDir, win ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(wrapper, args, { cwd: androidDir, env, stdio: 'inherit', shell: win });
process.exit(r.status ?? 1);
