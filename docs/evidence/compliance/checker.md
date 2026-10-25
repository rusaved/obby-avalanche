# M6-04 · Чекер debugcheck.js на playtest-сборке

- Чекер: неофициальный, рекомендован официальным каналом Яндекса 20.08.2026 (`docs/03`, 7.1.3), версия 1.1.0, коммит `f86d4eb` от 14.08.2026, 93 проверки
- Как запускали: `npm run build:playtest`, затем `node scripts/checker.mjs <путь к debugcheck.js>` — сборка `dist-playtest` со стендом SDK на `/sdk.js`, чекер вставлен сразу после `/sdk.js` (как велит его README), минута игры (клик, бег, прыжки, пауза Esc и обратно, скрытая вкладка и обратно), `YGDebugChecker.refresh()`. Файл чекера в репозиторий и архивы не попадает: `check-release` (пункт 6) падает на файле `debugcheck*` и на `YGDebugChecker` в коде
- Сырой отчёт чекера: `checker-raw.txt`, снимок панели — `checker.png`
- Итог последнего прогона: **PASS 83, FAIL 0, WARN 5, NOT VERIFIED 3**; ошибок в консоли — 0

## Что исправлено по чекеру
| Было | Почему | Что сделали | Чем проверено |
|---|---|---|---|
| FAIL `YaGames.init()` — Not found (п. 1.19.1) | чекер ищет в коде текст `YaGames.init(`, а сборщик сводил вызов к `e.init()` через переменную | `src/platform/yandex.ts`: глобал вызывается по имени, метод с вызовом — в конце класса | чекер: PASS; Vitest `tests/platform` 24 из 24 |
| WARN «No body scroll» — частичная защита (п. 1.10.2) | `overscroll-behavior: none` стоял только у `body`, чекер читает `html` | `index.html`: `overscroll-behavior: none` у `html` и `body` | чекер: PASS; e2e `SCR-03` |

## WARN и NOT VERIFIED, которые остаются, и почему это не нарушение
| Проверка | Что видит чекер | Почему не нарушение | Чем доказано |
|---|---|---|---|
| WARN `consumePurchase()` | в коде нет вызова | все 4 товара (`vip`, `autopilot`, `no_ads`, `starter`) постоянные, не расходуемые: их не «тратят», а выдают по `getPurchases()` при каждом старте (`docs/03`, IAP-01). В релизе покупки выключены (`payments.enabled: false`, решение штаба 25.10) | e2e `IAP-01 bought before (another device)` |
| WARN цена с «$» (п. 1.13.2) | `!1,$a` в сжатом коде — имя переменной сборщика, а не цена | цены берутся из `getCatalog()` числом и картинкой валюты SDK | e2e `IAP-04 … IAP-01 the price and the currency picture` |
| WARN звук на паузе в рекламе (п. 4.7) | рядом с `showFullscreenAdv(` нет слов `mute`/`suspend` | пауза и звук идут через общий протокол причин паузы (`docs/03`, 2.3), вызов рекламы его включает в другом модуле | e2e `SND-02 SND-03 SND-04 … an open ad suspend`, `ADS-03 …` |
| WARN игра на паузе в рекламе (п. 4.7) | то же, эвристика по соседству текста | то же | e2e `SND-02 …`, `ADS-04 no callback for 10 s …` |
| WARN «No WebGL notice» (п. 1.6.1.7) | строки `WebGLRenderer: … not supported` во внутренних предупреждениях three.js | игроку они не показываются; экран без WebGL2 — спокойный текст без слова «WebGL» | e2e `BLD-06 no WebGL2: a calm screen …` |
| NOT VERIFIED язык по умолчанию | резолвер не доказан по коду | язык берётся из `environment.i18n.lang`, иначе ru | e2e `SDK-03 interface language comes from environment.i18n.lang` |
| NOT VERIFIED имя лидерборда | имя задано данными | рекорды за флагом и выключены в релизе (M4-06) | `content/avalanche/game.json` |
| NOT VERIFIED текст на canvas | DOM-проверка не видит canvas | весь текст интерфейса — DOM, на canvas только числа стен | e2e `LOC-*`, кадры `docs/evidence/` |

Проверено: чекер на playtest-сборке в облаке (Chromium, SwiftShader), стенд SDK. Не проверено: чекер против настоящего SDK Яндекса (домен закрыт из облака) — это пункт продюсеру в черновике (`docs/03`, 7.2, пункт 4)
