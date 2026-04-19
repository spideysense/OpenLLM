/**
 * Temporary debug endpoint — remove after fixing
 * Returns what env vars are visible and whether the tunnel is reachable
 */
export default async function handler(req, res) {
  const baseUrl = process.env.MONET_BASE_URL;
  const hasKey  = !!process.env.MONET_API_KEY;

  // Try to reach the tunnel
  let reachable = false;
  let httpStatus = null;
  let errorMsg = null;

  if (baseUrl) {
    try {
      const r = await fetch(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${process.env.MONET_API_KEY || ''}` },
        signal: AbortSignal.timeout(6000),
      });
      httpStatus = r.status;
      reachable = r.ok;
    } catch(e) {
      errorMsg = e.message;
    }
  }

  return res.status(200).json({
    baseUrl: baseUrl || '(not set)',
    hasKey,
    reachable,
    httpStatus,
    errorMsg,
    region: process.env.VERCEL_REGION || 'unknown',
  });
}
