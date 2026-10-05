/**
 * «Mountain N cleared!» window body (docs/01-gdd.md 10.2, 6.3): the time on the mountain, the chest coins, the summit
 * trophies, the next mountain with its colour and, on the first calendar circle, «Tomorrow in the calendar: …» with
 * the reward's icon (7.6). «Next» is the window's «next» button; «▶ Ad: ×2 chest» comes with the ads (M4-03).
 */
import { t } from './i18n.ts';
import { rewardIcon } from './daily-panel.ts';

export interface SummitPanelModel {
  time: string;
  chest: string;
  trophies: string;
  next: string;
  nextColor: string;
  tomorrow: { name: string; icon: string } | null;
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
