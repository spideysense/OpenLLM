// ASO optimizer: read the live App Store listing + reviews, propose concrete
// title/subtitle/keyword/screenshot/description changes for the local-AI buyer.
import { askJSON } from '../aspen.js';
import { PRODUCT } from '../config.js';
import { appStoreSnapshot } from '../collectors/appstore.js';
import { propose } from '../proposals.js';
import { push } from '../store.js';
import { log } from '../log.js';

const SYS = `You are an App Store Optimization expert for Aspen. ${PRODUCT}

Given the live listing + recent reviews, propose concrete ASO changes to grow installs that STICK (remember: the iOS app needs the Mac app, so attract the right buyer and set expectations honestly to avoid 1-star "needs a Mac" reviews).
Return JSON:
{"title_30":"<=30 chars","subtitle_30":"<=30 chars","keywords_100":"comma list <=100 chars","promo_text_170":"<=170","first_2_lines":"the hook shown before 'more'","screenshot_captions":["..."],"rationale":"why","risks":"App Store review risks"}`;

export async function runASO() {
  const snap = await appStoreSnapshot();
  const out = await askJSON(SYS, JSON.stringify(snap));
  propose({
    tactic: 'aso', title: 'App Store listing optimization', estImpact: 3,
    body: `TITLE: ${out.title_30}\nSUBTITLE: ${out.subtitle_30}\nKEYWORDS: ${out.keywords_100}\nPROMO: ${out.promo_text_170}\n\nHOOK:\n${out.first_2_lines}\n\nSCREENSHOT CAPTIONS:\n- ${(out.screenshot_captions || []).join('\n- ')}\n\nWHY: ${out.rationale}\nRISKS: ${out.risks}`,
    meta: out,
  });
  push('aso_runs', { version: snap.version, rating: snap.rating, ratingCount: snap.ratingCount });
  log('aso: queued listing proposal');
  return out;
}
