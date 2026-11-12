declare module 'qrcode' {
  interface ToDataURLOptions {
    margin?: number;
    width?: number;
  }
  const QRCode: {
    toDataURL(text: string, options?: ToDataURLOptions): Promise<string>;
  };
  export default QRCode;
}
