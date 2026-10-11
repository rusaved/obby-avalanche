// What: Logger (debug, info, warn, error) with the [obby] prefix; debug is a no-op unless the build defines __DEBUG_TOOLS__.
// Called by: main.ts, platform/index.ts, platform/yandex.ts.
// Keep: Release console stays clean: debug must remain stripped outside dev, playtest and e2e builds; error only for failures nobody expects.

/** Logger (docs/02-tech.md 16.1): `debug` is a no-op outside dev, playtest and e2e builds. */
/* eslint-disable no-console */
type LogFn = (...args: unknown[]) => void;

const noop: LogFn = () => {};

export const log: { debug: LogFn; info: LogFn; warn: LogFn; error: LogFn } = {
  debug: __DEBUG_TOOLS__ ? (...args) => console.debug('[obby]', ...args) : noop,
  info: (...args) => console.info('[obby]', ...args),
  warn: (...args) => console.warn('[obby]', ...args),
  // Only for failures nobody expects; the release must not print errors in normal flow.
  error: (...args) => console.error('[obby]', ...args),
};
