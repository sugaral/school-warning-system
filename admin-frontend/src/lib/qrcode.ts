import QRCode from 'qrcode';

export async function buildQrCodeDataUrl(
  payload: unknown,
  size = 200,
): Promise<string> {
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return QRCode.toDataURL(content, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}

