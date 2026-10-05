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
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="#fff" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4M12 13v4M8 21h8l-1-4H9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

export function icon(id: string): string {
  return ICONS[id] ?? ICONS['iceBolt']!;
}
