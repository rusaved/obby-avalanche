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
};

export function icon(id: string): string {
  return ICONS[id] ?? ICONS['iceBolt']!;
}
