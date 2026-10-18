// What: Inline SVG icon set (stat bolt, sound, flag, wave, shop, pets, wardrobe, lock, calendar, quests, gift, trophy, coin, ad, more …), the icon(id) lookup and setRich (texts with {coin}/{trophy}/{ad} marks).
// Called by: main.ts, ui/hud.ts, ui/daily-panel.ts, ui/footsteps-panel.ts, ui/quests-panel.ts, ui/rebirth-panel.ts, ui/shop-panel.ts, ui/wardrobe-panel.ts.
// Keep: Inline only, no files, fonts, emoji or font symbols (docs/07-mobile-ui.md «Знаки»); currentColor so CSS recolours; ids match theme.json ui.statIcon and menu/reward icon ids; unknown id falls back to iceBolt.

/**
 * Interface icon set (docs/02-tech.md 5.2: theme.json ui.statIcon picks one by id). Inline SVG, no files, no fonts.
 * `currentColor` takes the colour of the element the icon sits in.
 */
export const ICONS: Record<string, string> = {
  /** Ice bolt: the stat icon of game 1 (docs/01-gdd.md 10.1: not a snowflake, not a shoe). */
  iceBolt:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 1.5 4.5 13.5h6l-2 9 11-13h-6.2l1.2-8z" fill="#fff" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12.6 5.2 9 10.5" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>',
  /** Speaker on and off (sound button). */
  soundOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  soundOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  /** Summit flag at the end of the mountain bar. */
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M6 4h12l-3 4 3 4H6z" fill="#fff" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  /** Avalanche mark on the mountain bar while it runs. */
  wave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 18c3-7 6-11 10-11s5 4 10 1c-1 6-5 10-10 10H2z" fill="#fff" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  /** HUD column (docs/01-gdd.md 10.1): shop bag, pet paw, wardrobe shirt; the trophy of the trophy plaque and prices. */
  shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 13H6z" fill="#fff" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10V6a3 3 0 0 1 6 0v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pets: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="16" rx="5" ry="4.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/><circle cx="5.5" cy="10" r="2.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/><circle cx="9.5" cy="6" r="2.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/><circle cx="14.5" cy="6" r="2.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/><circle cx="18.5" cy="10" r="2.2" fill="#fff" stroke="currentColor" stroke-width="1.6"/></svg>',
  /** Rebirth: a circle arrow round a star (docs/01-gdd.md 7.5). */
  rebirth: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M18.5 2.8v4.6h-4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="m12 8.2 1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" fill="#fff" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  wardrobe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3c-.5 1.6-2 2.6-4 2.6S8.5 4.6 8 3z" fill="#fff" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  /** Lock on a wardrobe card whose look comes from a tier, a calendar day or the starter pack (M3-04b). */
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10.5" rx="2" fill="#fff" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="15.5" r="1.5" fill="currentColor"/></svg>',
  /** Calendar (docs/01-gdd.md 7.6), a tick on a claimed card, quests (7.7), time rewards: a gift (7.8). */
  calendar:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5" fill="#fff" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="7" y="13" width="4" height="4" rx="1" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#4cd964"/><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  quests:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5" fill="#fff" stroke="currentColor" stroke-width="1.8"/><path d="m7 8 1.5 1.5L11 7M7 14l1.5 1.5L11 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 8.5h4M13 14.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  gift: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="9" width="17" height="12" rx="2" fill="#fff" stroke="currentColor" stroke-width="1.8"/><rect x="2.5" y="6" width="19" height="4.5" rx="1.5" fill="#fff" stroke="currentColor" stroke-width="1.8"/><path d="M12 6v15" stroke="currentColor" stroke-width="2"/><path d="M12 6c-1-3-5-4-5-1.5S11 6 12 6zm0 0c1-3 5-4 5-1.5S13 6 12 6z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  /** «More» of the short HUD column (docs/01-gdd.md 10.1): three dots on a card. */
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3" fill="#fff" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="16" cy="12" r="1.7" fill="currentColor"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="#fff" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4M12 13v4M8 21h8l-1-4H9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',

  /** MU-01 (docs/07-mobile-ui.md «Знаки»): the coin — a gold disc with an ink snowflake; the same mark by every price,
   * reward and balance of coins. */
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="coin-face" cx="12" cy="12" r="10.5" stroke-width="1.5"/><path class="coin-ink" d="M12 6.5v11M7.2 9.25l9.6 5.5M7.2 14.75l9.6-5.5" stroke-width="1.7" stroke-linecap="round"/><path class="coin-ink" d="m10.6 7.4 1.4 1.2 1.4-1.2M10.6 16.6l1.4-1.2 1.4 1.2" fill="none" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  /** The cup of the trophies (summits): an outline in the colour of the text it sits by. */
  cup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10v4.5a5 5 0 0 1-10 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 5.5H4.5a3 3 0 0 0 3 3.5M17 5.5h2.5a3 3 0 0 1-3 3.5M12 13v3.5M8.5 20.5h7l-.8-4h-5.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  /** The ad mark: a play triangle in a rounded box, always by the word «Ad». */
  ad: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 9v6l5-3z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  /** Pause: two bars. */
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.5" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.5" fill="currentColor"/></svg>',
  /** Jump: an ink arrow up. */
  jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  /** The cross of a window. */
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12l9.5-6z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  tick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  padlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  /** The groups of the game: a paper plane and a chat bubble (own marks, no logos). */
  telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4 3 11.2l6.2 2.3L19 7l-7.6 8.1v4.4l3.3-3.3 4.2 3.1z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  vk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H11l-4.5 3.5V16H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9.5l1.5 3 1.5-3M13 9.5v3M16 9.5l-2 1.5 2 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 12H21M17 12v3M20 12v2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  /** Speed boosts of the gifts: a bolt outline; «+1 level»: an arrow up. */
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2.5 5 13.5h6l-1.5 8 9-11.5h-6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  /** The tiles of the column (docs/07-mobile-ui.md): teleport — a spiral, footsteps — a boot, records — a list. */
  teleport: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12.5a1.5 1.5 0 1 1 1.5-1.5M15.5 11A3.5 3.5 0 1 1 12 7.5M19.5 11A7.5 7.5 0 1 1 12 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  footsteps: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v13h13v-2.5a3 3 0 0 0-3-3h-5.5V3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 19.5h13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  records: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor"/></svg>',
  task: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="18.5" cy="12" r="2" fill="currentColor"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8.5h13l-1 12h-11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  paw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12.5c-3 0-5.5 3-5.5 5 0 1.5 1.3 2.2 2.7 2l2.8-.6 2.8.6c1.4.2 2.7-.5 2.7-2 0-2-2.5-5-5.5-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="5.5" cy="10.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9.5" cy="6" r="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="14.5" cy="6" r="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18.5" cy="10.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  shirt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5 3.5 6.5l2 4.5 2-1v10.5h9V10l2 1 2-4.5-5-3c-.5 1.6-1.8 2.5-3.5 2.5s-3-.9-3.5-2.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  rebirthArrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M18.5 2.8v4.6h-4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  calendarLine: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  giftLine: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="6.5" width="18" height="4" rx="1.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6.5v14M12 6.5C11 3.5 7.5 3 7.5 5s3.5 1.5 4.5 1.5zm0 0c1-3 4.5-3.5 4.5-1.5S13 6.5 12 6.5z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3.5L12 5v14l-4.5-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  speakerOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3.5L12 5v14l-4.5-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  /** The rotate screen (docs/07-mobile-ui.md, p1-rotate): a phone with an arc arrow. */
  rotatePhone: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="27" y="8" width="26" height="46" rx="5" fill="none" stroke="#ffffff" stroke-width="3"/><path d="M37 49h6" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/><path d="M19 48C14 40 14 22 23 13" fill="none" stroke="#5cc8ff" stroke-width="3" stroke-linecap="round"/><path d="m18.5 13.5 5-1.5.8 5.2" fill="none" stroke="#5cc8ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
/** Reward ids of the calendar and quests (daily-view REWARD_ICON): the coin. */
ICONS['coins'] = ICONS['coin']!;

export function icon(id: string): string {
  return ICONS[id] ?? ICONS['iceBolt']!;
}

/** Marks a text of the dictionary may carry (docs/07-mobile-ui.md «Знаки»): the coin, the cup, the ad mark. */
const MARKS: Record<string, string> = { '{coin}': 'coin', '{trophy}': 'cup', '{ad}': 'ad' };
const MARK_RE = /(\{coin\}|\{trophy\}|\{ad\})/;

/** Does a text carry a mark (then setRich is needed instead of textContent). */
export function hasMark(text: string): boolean {
  return MARK_RE.test(text);
}

/** Fills `node` with `text`, each {coin} / {trophy} / {ad} an inline SVG mark 1,15 em, 4 px from its neighbours (the
 * spaces round a mark are its margins). */
export function setRich(node: HTMLElement, text: string): void {
  if (node.dataset['rich'] === text) return;
  node.dataset['rich'] = text;
  if (!MARK_RE.test(text)) {
    node.textContent = text;
    return;
  }
  node.replaceChildren();
  for (const part of text.split(MARK_RE)) {
    const id = MARKS[part];
    if (id) {
      const m = document.createElement('span');
      m.className = `mark mark-${id}`;
      m.innerHTML = ICONS[id]!;
      node.appendChild(m);
    } else if (part.trim() !== '') node.appendChild(document.createTextNode(part.trim()));
  }
}
