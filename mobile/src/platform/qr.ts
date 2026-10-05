// QR scan of the pairing code shown on the TV: Google code scanner (no camera permission needed).
import { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState as Install } from '@capacitor-mlkit/barcode-scanning';
import { parsePairUri, type PairData } from '../../../src/lib/pairing';
import { t } from '../../../src/i18n';

export const notOmpQr = () => t('errors.qrNotOmp');
export const scanUnavailable = () => t('errors.qrUnavailable');
export const scanPrepareFailed = () => t('errors.qrPrepareFailed');
const INSTALL_TIMEOUT_MS = 60000;

export type QrScanner = () => Promise<PairData | null>;

let override: QrScanner | null = null;

/** Replaces the scanner (tests); null restores the real one. */
export function setQrScanner(fn: QrScanner | null): void {
  override = fn;
}

async function ensureModule(): Promise<void> {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (available) return;
  await new Promise<void>((resolve, reject) => {
    let off: (() => void) | undefined;
    const timer = setTimeout(() => done(new Error(scanPrepareFailed())), INSTALL_TIMEOUT_MS);
    const done = (err?: Error) => {
      clearTimeout(timer);
      off?.();
      if (err) reject(err);
      else resolve();
    };
    BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (e) => {
      if (e.state === Install.COMPLETED) done();
      else if (e.state === Install.FAILED || e.state === Install.CANCELED) done(new Error(scanUnavailable()));
    })
      .then((h) => {
        off = () => void h.remove();
        return BarcodeScanner.installGoogleBarcodeScannerModule();
      })
      .catch(() => done(new Error(scanUnavailable())));
  });
}

/** Resolves with the pairing data, null if the user closed the scanner, rejects for a foreign code. */
export async function scanPairQr(): Promise<PairData | null> {
  if (override) return override();
  let barcodes;
  try {
    await ensureModule();
    ({ barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return null;
    throw new Error(msg === scanPrepareFailed() ? scanPrepareFailed() : scanUnavailable());
  }
  if (!barcodes.length) return null;
  const data = parsePairUri(barcodes[0].rawValue ?? '');
  if (!data) throw new Error(notOmpQr());
  return data;
}
