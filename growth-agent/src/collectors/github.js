// Repo momentum — stars + (with token) clones/views traffic.
import { cfg } from '../config.js';
export async function githubSnapshot() {
  const h = { 'User-Agent': cfg.userAgent, Accept: 'application/vnd.github+json' };
  if (cfg.githubToken) h.Authorization = `Bearer ${cfg.githubToken}`;
  const repo = await (await fetch(`https://api.github.com/repos/${cfg.githubRepo}`, { headers: h })).json();
  const snap = { stars: repo.stargazers_count, forks: repo.forks_count, watchers: repo.subscribers_count };
  if (cfg.githubToken) {
    try {
      const t = await (await fetch(`https://api.github.com/repos/${cfg.githubRepo}/traffic/clones`, { headers: h })).json();
      const v = await (await fetch(`https://api.github.com/repos/${cfg.githubRepo}/traffic/views`, { headers: h })).json();
      snap.clones14d = t.count; snap.views14d = v.count; snap.uniqueVisitors14d = v.uniques;
    } catch { /* needs push access */ }
  }
  return snap;
}
