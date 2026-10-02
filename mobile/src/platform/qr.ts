// QR scan of the pairing code shown on the TV: Google code scanner (no camera permission needed).
import { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState as Install } from '@capacitor-mlkit/barcode-scanning';
import { parsePairUri, type PairData } from '../../../src/lib/pairing';

export const NOT_OMP_QR = 'Это не QR OMP';
export const SCAN_UNAVAILABLE = 'Сканер QR недоступен на этом устройстве';

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
    const done = (err?: Error) => {
      off?.();
      if (err) reject(err);
      else resolve();
    };
    BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (e) => {
      if (e.state === Install.COMPLETED) done();
      else if (e.state === Install.FAILED || e.state === Install.CANCELED) done(new Error(SCAN_UNAVAILABLE));
    })
      .then((h) => {
        off = () => void h.remove();
        return BarcodeScanner.installGoogleBarcodeScannerModule();
      })
      .catch(() => done(new Error(SCAN_UNAVAILABLE)));
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
    throw new Error(SCAN_UNAVAILABLE);
  }
  if (!barcodes.length) return null;
  const data = parsePairUri(barcodes[0].rawValue ?? '');
  if (!data) throw new Error(NOT_OMP_QR);
  return data;
}
