// Cross-platform runner for android/gradlew: node scripts/gradle.mjs assembleDebug
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const win = process.platform === 'win32';
const androidDir = join(process.cwd(), 'android');
const env = { ...process.env };

function parseMajor(out) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(out);
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

function javaMajor(home) {
  const exe = join(home, 'bin', win ? 'java.exe' : 'java');
  if (!existsSync(exe)) return 0;
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8' });
  return parseMajor((r.stderr || '') + (r.stdout || ''));
}

// OMP builds with JDK 21 (CI too); Capacitor 8 and AGP 9 need 21+; 21..24 are accepted
const fits = (n) => n >= 21 && n <= 24;

function globDirs(base, prefix) {
  try {
    return readdirSync(base)
      .filter((n) => n.startsWith(prefix))
      .map((n) => join(base, n));
  } catch {
    return [];
  }
}

function javaHomeFromPath() {
  const r = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8', shell: win });
  const m = /java\.home = (.+)/.exec((r.stderr || '') + (r.stdout || ''));
  return m ? m[1].trim() : null;
}

function candidates() {
  const list = [];
  if (env.JAVA_HOME) list.push(env.JAVA_HOME);
  const onPath = javaHomeFromPath();
  if (onPath) list.push(onPath);
  list.push(
    'C:/Program Files/Android/Android Studio/jbr',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/opt/android-studio/jbr',
  );
  for (const base of ['C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java', 'C:/Program Files/Microsoft']) {
    list.push(...globDirs(base, 'jdk-21'));
  }
  return list;
}

let jdk = null;
for (const c of candidates()) {
  const n = javaMajor(c);
  if (fits(n)) {
    jdk = c;
    break;
  }
}
if (!jdk) {
  console.error(
    'Нужна Java 21–24 (JDK 21 LTS). Установите Temurin 21: winget install EclipseAdoptium.Temurin.21.JDK\n' +
      'Java 21-24 (JDK 21 LTS) is required; Capacitor 8 and AGP 9 cannot build on 17 or older. ' +
      'Install Temurin 21 and/or set JAVA_HOME.',
  );
  process.exit(1);
}
env.JAVA_HOME = jdk;
console.log('[gradle] JAVA_HOME ->', jdk);

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
const cmd = win ? `"${wrapper}"` : wrapper;
const r = spawnSync(cmd, args, { cwd: androidDir, env, stdio: 'inherit', shell: win });
process.exit(r.status ?? 1);
