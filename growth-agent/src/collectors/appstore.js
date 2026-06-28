// App Store signal via Apple's public iTunes Lookup + RSS reviews (no key).
import { cfg } from '../config.js';

export async function appStoreSnapshot() {
  const r = await fetch(`https://itunes.apple.com/lookup?id=${cfg.appstoreId}&country=us`,
    { headers: { 'User-Agent': cfg.userAgent } });
  const j = await r.json();
  const a = j.results?.[0] || {};
  let reviews = [];
  try {
    const rr = await fetch(`https://itunes.apple.com/us/rss/customerreviews/id=${cfg.appstoreId}/sortBy=mostRecent/json`,
      { headers: { 'User-Agent': cfg.userAgent } });
    const rj = await rr.json();
    reviews = (rj.feed?.entry || []).filter((e) => e['im:rating']).slice(0, 10)
      .map((e) => ({ rating: Number(e['im:rating'].label), title: e.title?.label, text: e.content?.label, by: e.author?.name?.label }));
  } catch { /* reviews feed flaky */ }
  return {
    name: a.trackName, version: a.version, rating: a.averageUserRating,
    ratingCount: a.userRatingCount, category: a.primaryGenreName,
    description: a.description, releaseNotes: a.releaseNotes,
    updated: a.currentVersionReleaseDate, reviews,
  };
}
