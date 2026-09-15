// Connected devices use /v1/secure on their own Aspen. Public trial is separate.
export const config = { maxDuration: 10 };
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.runonaspen.com');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  res.statusCode = 410;
  res.end(JSON.stringify({ error: 'Update the Aspen app and your box to use the private encrypted connection.' }));
}
