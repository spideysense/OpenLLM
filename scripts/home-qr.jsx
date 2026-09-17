import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
export function qrSvg(value) {
  return renderToStaticMarkup(<QRCodeSVG value={value} size={220} level="M" marginSize={2} title="Aspen pairing code" />);
}
