// What: Renders the Mountain N cleared window body: time on the mountain, chest coins, summit trophies, the next mountain swatch and tomorrow's calendar reward.
// Called by: main.ts (renderSummitPanel).
// Keep: Pure view over SummitPanelModel; Next is the window frame's own next button, so the window is never a dead end; texts via i18n summit.* keys; no ad code here.

/**
 * «Mountain N cleared!» window body (docs/01-gdd.md 10.2, 6.3): the time on the mountain, the chest coins, the summit
 * trophies, the next mountain with its colour and, on the first calendar circle, «Tomorrow in the calendar: …» with
 * the reward's icon (7.6). «Next» is the window's «next» button; «▶ Ad: ×2 chest» comes with the ads (M4-03).
 */
import { t } from './i18n.ts';
import { rewardIcon } from './daily-panel.ts';
import { setRich } from './icons.ts';

export interface SummitPanelModel {
  time: string;
  chest: string;
  trophies: string;
  next: string;
  nextColor: string;
  tomorrow: { name: string; icon: string } | null;
  /** MU-07 (w5-summit): the phone layout — rows «what · how much», the quiet «Ad: ×2» by the chest. */
  mu?: { ad: { text: string; busy: boolean; press(): void } | null; nextName: string };
}

function line(cls: string, ...parts: Array<HTMLElement | string>): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  for (const p of parts) e.append(p);
  return e;
}

export function renderSummitPanel(body: HTMLElement, m: SummitPanelModel): void {
  const box = line('sm-box');
  box.dataset['role'] = 'summit';
  if (m.mu) {
    const value = (mark: string, text: string): HTMLElement => {
      const v = line('sm-value');
      setRich(v, `${mark} ${text}`);
      return v;
    };
    const chest = line('sm-row', line('sm-label', t('summit.chestRow')), value('{coin}', `+${m.chest}`));
    if (m.mu.ad) {
      const ad = m.mu.ad;
      const b = document.createElement('button');
      b.className = 'card-btn quiet';
      b.dataset['hud'] = 'summit-ad';
      setRich(b, ad.text);
      b.disabled = ad.busy;
      b.addEventListener('click', () => ad.press());
      chest.appendChild(b);
    }
    box.append(chest, line('sm-row', line('sm-label', t('summit.cupRow')), value('{trophy}', `+${m.trophies}`)), line('sm-row sm-next', line('sm-label', t('summit.nextRow')), line('sm-value', m.mu.nextName)));
    if (m.tomorrow) {
      const row = line('sm-row sm-tomorrow', line('sm-label', t('summit.tomorrowRow')), line('sm-value', rewardIcon(m.tomorrow.icon), m.tomorrow.name));
      row.dataset['role'] = 'summit-tomorrow';
      box.appendChild(row);
    }
    body.appendChild(box);
    return;
  }
  box.append(
    line('sm-row', t('summit.time', { time: m.time })),
    line('sm-row', rewardIcon('coins'), t('summit.chest', { n: m.chest })),
    line('sm-row', rewardIcon('trophy'), t('summit.trophies', { n: m.trophies })),
  );
  const sw = document.createElement('span');
  sw.className = 'sm-swatch';
  sw.style.background = m.nextColor;
  box.appendChild(line('sm-row sm-next', sw, t('summit.next', { name: m.next })));
  if (m.tomorrow) {
    const row = line('sm-row sm-tomorrow', rewardIcon(m.tomorrow.icon), t('summit.tomorrow', { name: m.tomorrow.name }));
    row.dataset['role'] = 'summit-tomorrow';
    box.appendChild(row);
  }
  body.appendChild(box);
}
