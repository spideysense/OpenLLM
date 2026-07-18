// Test-only stub for qrcode.react.
//
// Onboarding and Settings both import PairDeviceModal, which imports qrcode.react.
// When that dep isn't resolvable in a given environment, the import fails at
// transform time and takes down THREE unrelated tests (onboarding, settings, API
// keys) — making "is the suite broken?" ambiguous. The tests don't care about QR
// rendering; they just need the import graph to resolve. This stub gives them a
// trivial component so a real regression stands out instead of drowning in a
// dependency-resolution cascade. Production is unaffected — this is wired only in
// vitest.config.js's resolve.alias.
export function QRCodeSVG(props) {
  return <svg data-testid="qrcode-stub" {...props} />;
}

export function QRCodeCanvas(props) {
  return <canvas data-testid="qrcode-stub" {...props} />;
}

export default { QRCodeSVG, QRCodeCanvas };
