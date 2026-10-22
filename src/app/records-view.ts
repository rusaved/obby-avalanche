// What: The records of the player (docs/01-gdd.md 7.9, 19.3): the lines of the «My records» board of the base from the save, and the «Records» window — the top of the leaderboard, «Loading» up to 3 s, gone for the session on an error.
// Called by: main.ts (createRecordsView; the board lines on every entry to the base, the window by the button at the board).
// Keep: No leaderboard call without a leaderboard name and before the button is pressed; no made-up rows, no bots (03, 4.3); the login and setScore are M4-06.

import type { LeaderEntry } from '../platform/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { WindowFrame } from '../ui/window.ts';
import { formatNumber, shownTier } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

/** The window waits this long for the table (docs/01-gdd.md 7.9). */
const LOAD_MS = 3000;
const TOP = 10;

export interface RecordsViewDeps {
  windows: WindowFrame;
  /** The leaderboard of game.json is on (its name in the console). */
  leaderboard: boolean;
  topScores(n: number): Promise<LeaderEntry[] | null>;
  numSuffix(k: string): string;
  /** M4-06 (docs/02-tech.md 11.7): the player signed in — his trophies go to the table; else «Sign in» with its reason. */
  authorized?(): boolean;
  signIn?(): Promise<boolean>;
}

export interface RecordsView {
  /** The «Records» button is there: a leaderboard, and no error this session. */
  readonly available: boolean;
  /** The lines of the «My records» board: the title, best Speed, trophies over all time, summits a/b, the tier. */
  boardLines(save: SaveData, summits: number, mountains: number): string[];
  open(): void;
  /** MU-07 (w6-more «Records»): no leaderboard — the window shows the player's own records (`lines`, the title first). */
  openOwn(lines: readonly string[]): void;
}

export function createRecordsView(d: RecordsViewDeps): RecordsView {
  let failed = false;
  let rows: LeaderEntry[] | null = null;
  const fmt = (n: number): string => formatNumber(n, d.numSuffix);
  const render = (body: HTMLElement): void => {
    const list = document.createElement('div');
    list.dataset['role'] = 'records-list';
    if (!rows) list.textContent = t('records.loading');
    else
      for (const r of rows) {
        const line = document.createElement('div');
        line.className = r.isPlayer ? 'records-row me' : 'records-row';
        line.dataset['role'] = 'records-row';
        line.textContent = `${r.rank}. ${r.name} — ${fmt(r.score)}`;
        list.appendChild(line);
      }
    body.appendChild(list);
    // M4-06: only a signed-in player is in the table — «Sign in» with what it gives, by the button only.
    if (d.authorized && !d.authorized()) {
      const row = document.createElement('div');
      row.className = 'rb-hint records-login';
      const why = document.createElement('span');
      why.textContent = t('records.loginWhy');
      const b = document.createElement('button');
      b.className = 'card-btn';
      b.dataset['hud'] = 'records-login';
      b.textContent = t('records.login');
      b.addEventListener('click', () => void d.signIn?.().then(() => d.windows.current === 'records' && d.windows.refresh()));
      row.append(why, b);
      body.appendChild(row);
    }
  };
  const view: RecordsView = {
    get available() {
      return d.leaderboard && !failed;
    },
    boardLines(save, summits, mountains) {
      return [
        t('records.title'),
        `${t('records.bestStat')}: ${fmt(save.bestStat ?? 0)}`,
        `${t('records.trophiesTotal')}: ${fmt(save.trophiesTotal ?? 0)}`,
        t('records.summits', { a: summits, b: mountains }),
        t('records.tier', { n: shownTier(save.tier ?? 0) }),
      ];
    },
    openOwn(lines) {
      d.windows.open('records', lines[0] ?? t('btn.records'), (body) => {
        const list = document.createElement('div');
        list.dataset['role'] = 'records-list';
        for (const text of lines.slice(1)) {
          const line = document.createElement('div');
          line.className = 'records-row';
          line.dataset['role'] = 'records-row';
          line.textContent = text;
          list.appendChild(line);
        }
        body.appendChild(list);
      });
    },
    open() {
      if (!view.available) return;
      rows = null;
      d.windows.open('records', t('btn.records'), render);
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOAD_MS));
      void Promise.race([d.topScores(TOP), timeout]).then((got) => {
        if (d.windows.current !== 'records') return;
        // An error, a 404 or no answer in 3 s: no window and no button till the end of the session.
        if (!got) {
          failed = true;
          d.windows.close();
          return;
        }
        rows = got.slice(0, TOP);
        d.windows.refresh();
      });
    },
  };
  return view;
}
