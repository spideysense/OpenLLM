// Daily pulse: snapshot the metrics that matter, store them, compute deltas.
// This is the ground truth the strategist learns from.
import { appStoreSnapshot } from '../collectors/appstore.js';
import { githubSnapshot } from '../collectors/github.js';
import { load, push } from '../store.js';
import { log } from '../log.js';

export async function runPulse() {
  const [app, gh] = await Promise.allSettled([appStoreSnapshot(), githubSnapshot()]);
  const prev = (load('metrics', []) || []).slice(-1)[0] || {};
  const snap = {
    date: new Date().toISOString().slice(0, 10),
    appRating: app.value?.rating, appRatingCount: app.value?.ratingCount, appVersion: app.value?.version,
    stars: gh.value?.stars, views14d: gh.value?.views14d, clones14d: gh.value?.clones14d,
    // NOTE: true download counts come from App Store Connect / your web analytics —
    // wire those in and store as `downloads` for the strategist to optimize against.
    downloads: null,
  };
  snap.deltaStars = prev.stars != null && snap.stars != null ? snap.stars - prev.stars : null;
  snap.deltaRatingCount = prev.appRatingCount != null && snap.appRatingCount != null ? snap.appRatingCount - prev.appRatingCount : null;
  push('metrics', snap);
  log(`pulse: stars ${snap.stars} (${fmt(snap.deltaStars)}), ratings ${snap.appRatingCount} (${fmt(snap.deltaRatingCount)})`);
  return snap;
}
const fmt = (d) => (d == null ? '—' : d >= 0 ? `+${d}` : `${d}`);
