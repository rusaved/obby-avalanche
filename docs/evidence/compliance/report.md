# Отчёт соответствия требованиям Яндекс Игр (M6-05)

Отчёт по каждому ID раздела 1 `docs/03-yandex-compliance.md` (66 пунктов: BLD, SDK, SND, SAV, ADS, IAP, SCR, GD, CNT, LOC) для релиз-кандидата, 2026-10-25. Статусы: PASS-auto — тест или скрипт из цепочки `npm run verify:full` (`e2e/*.spec.ts`, `tests/**/*.test.ts`, `scripts/*.mjs`); PASS-manual — проверка по файлу в `docs/evidence/`; PRODUCER — делает продюсер в черновике, Консоли или на телефоне; N/A — не применимо, с причиной. PASS-auto подтверждаются полным verify вехи M6, прогон: `docs/evidence/M6/verify.txt`. Тесты с меткой `@full` идут только в `verify:full`. Обновлено 2026-10-26 (круг правок «Лавина 18», G-12): покупки в релизе включены (`payments.enabled: true`, решение продюсера 26.10 по Q-M6-1), в `downloads/` второй релизный архив `-no-iap` без покупок; окно «Промокод» выключено (CNT-04 → PASS-auto); награды за визит в группу нет. Полный verify этого круга — `docs/evidence/G/verify.txt`. Обновлено 2026-10-26 (веха «Лавина 19 · Зимний облик», Z-12): зимний декор из моделей Kenney (CC0, `assets/LICENSES.md`; в сборку попадают только 17 выбранных моделей, переведённые в `content/avalanche/decor-models.json`, без новогодней символики), новый герой без чужих причёсок и цветов (`tests/render/z-winter.test.ts`), новых текстов для игрока нет; полный verify — `docs/evidence/Z/verify.txt`.

Итого: PASS-auto 50, PASS-manual 2, PRODUCER 13, N/A 1.

## 1.1 Сборка и архив (BLD)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| BLD-01 | 1.21, 1.22: ZIP, `index.html` в корне, латинские имена, размер | PASS-auto | `scripts/pack.mjs` (падает без `index.html` и на запрещённых символах в путях); `scripts/check-release.mjs` пункты 1–2; `scripts/size.mjs` |
| BLD-02 | 1.7, CSP, 1.18: всё в архиве, внешние только `/sdk.js` и Метрика | PASS-auto | `e2e/smoke.spec.ts` «BLD-02 no network requests outside the origin except /sdk.js and Metrika»; `scripts/check-release.mjs` пункт 3 |
| BLD-03 | 1.23: нет ИИ в рантайме | PASS-auto | внешних адресов нет, значит и ИИ-сервисов: `scripts/check-release.mjs` пункт 3, `e2e/smoke.spec.ts` «BLD-02 …» |
| BLD-04 | 1.15, 1.14: нет следов разработки в релизе | PASS-auto | `scripts/check-release.mjs` пункты 6 (lil-gui, `__TEST__`, мок, debugcheck) и 7; `e2e/smoke-release.spec.ts`; чекер: `checker.md` (PASS 83, FAIL 0) |
| BLD-05 | 1.20: браузеры, WebGL2 | PRODUCER | авто только Chromium (все e2e); продюсеру: открыть черновик на Android (Яндекс Браузер, Chrome) и iOS Safari |
| BLD-06 | 1.6.1.7: без WebGL2 — спокойная заставка | PASS-auto | `e2e/moderation.spec.ts` «BLD-06 no WebGL2: a calm screen with the name of the game, no «WebGL», no «error», no console error» |

## 1.2 SDK и загрузка (SDK)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| SDK-01 | 1.1, 1.19.1: `/sdk.js` и один `YaGames.init()` | PASS-auto | `scripts/check-release.mjs` пункт 4; `tests/platform/yandex.test.ts` «init fails → one retry after 1 s…»; чекер `checker.md` (YaGames.init — PASS); буквы `IT` на панели черновика — продюсер |
| SDK-02 | 1.19.2: `ready()` один раз, когда игра управляема | PASS-auto | `e2e/smoke.spec.ts` «SDK-02 LoadingAPI.ready() exactly once and after the first frame…», «SDK-02 slow network…»; `e2e/smoke-release.spec.ts` |
| SDK-03 | 1.19.4, 4.7: `game_api_pause` / `resume` | PASS-auto | `e2e/ads-pause.spec.ts` «SND-02 SND-03 SND-04: blur, a hidden tab, game_api_pause and an open ad suspend…»; `tests/platform/mock.test.ts` «mock_startup_ad=1…» |
| SDK-04 | 1.19.3: GameplayAPI по переходам | PASS-auto | `e2e/ads-pause.spec.ts` «… GameplayAPI only on transitions»; `e2e/smoke.spec.ts` «pause reasons: hidden tab stops the simulation and GameplayAPI…» |
| SDK-05 | 2.14: язык из `environment.i18n.lang` | PASS-auto | `e2e/smoke.spec.ts` «SDK-03 interface language comes from environment.i18n.lang»; `tests/platform/yandex.test.ts` «maps languages…» |
| SDK-06 | 1.2: вся игра без входа | PASS-auto | стенд по умолчанию без входа: `e2e/bot-world1.spec.ts`, `e2e/bot-session.spec.ts` @full; вход — `e2e/records-lb.spec.ts` «M4-06 signed in…» |
| SDK-07 | рекомендация: deviceInfo, serverTime, отзыв, лидерборд | PASS-auto | `tests/platform/mock.test.ts` «mock_lang and mock_device…», «mock_time_offset shifts serverTime…»; `e2e/fm-community-gift.spec.ts`; без лидерборда — `e2e/fm-records.spec.ts` «… no leaderboard — no button, no call» |
| SDK-08 | рекомендация: ярлык на рабочий стол | PASS-auto | `e2e/fm-shortcut.spec.ts` «accepted…», «rejected…», «unavailable…»; `tests/meta/shortcut.test.ts` |

## 1.3 Пауза, звук, фокус (SND)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| SND-01 | 1.6.1.6, 1.6.2.5: только Web Audio | PASS-auto | `e2e/snd.spec.ts` «SND-01: no <audio> or <video>…»; `scripts/check-release.mjs` пункт 5 |
| SND-02 | 1.3: звук стоп при потере фокуса | PASS-auto | `e2e/ads-pause.spec.ts` «SND-02 SND-03 SND-04…»; сворачивание на телефоне — продюсер в черновике |
| SND-03 | 4.7: реклама — симуляция и звук на паузе | PASS-auto | `e2e/ads-pause.spec.ts` «SND-02 SND-03 SND-04…»; `e2e/truthful-ads-outcomes.spec.ts` «ADS-05 fullscreen × …» |
| SND-04 | 1.14: пауза — одно место правды | PASS-auto | `e2e/ads-pause.spec.ts` «SND-02 SND-03 SND-04…»; `tests/core/pause.test.ts` |
| SND-05 | 6.2, 6.3: кнопки звука и паузы, выбор сохраняется | PASS-auto | `e2e/snd.spec.ts` «SND-05: the effects switch survives F5…»; кадр `docs/evidence/M3/window_pause_1920x1080_ru.png` |

## 1.4 Сохранения и вход (SAV)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| SAV-01 | 1.9, 1.2.2: сохранение сразу после действия | PASS-auto | `e2e/save.spec.ts` «F5 right after buying shoes…», «F5 right after a wall…», «?mock_save=fail…» |
| SAV-02 | 1.14, лимиты SDK | PASS-auto | `e2e/bot-session.spec.ts` @full (нарушений стенда 0); `e2e/save.spec.ts` «@full bot plays 15 minutes…»; `tests/platform/mock.test.ts` «limits…» |
| SAV-03 | 1.9, 1.10: поворот и ресайз не теряют состояние | PASS-auto | `e2e/save.spec.ts` «resize and rotation … (SAV-03)»; `e2e/layout.spec.ts` «SCR-07 resize and rotation keep the game state» |
| SAV-04 | 1.11: облачные сохранения в черновике | PRODUCER | включить «Игра использует облачные сохранения» в настройках черновика |
| SAV-05 | 1.14: битое сохранение — чистый старт | PASS-auto | `tests/meta/save.test.ts` «broken saves give a clean start…», «migration v1 → v2…» |

## 1.5 Реклама и монетизация (ADS)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| ADS-01 | 1.12: свои вызовы interstitial и rewarded | PASS-auto | `e2e/ads-inter.spec.ts` «ADS-03 menu…»; `e2e/ads-rewarded.spec.ts` «ADS-04 no callback for 10 s…» |
| ADS-02 | 4.1, 1.16, 4.6: реклама только через `ysdk.adv` | PASS-auto | `scripts/check-release.mjs` пункт 3 (чужих адресов и рекламных SDK нет); `e2e/smoke.spec.ts` «BLD-02 …» |
| ADS-03 | 4.4: interstitial после кнопки, не в первые 180 с, кулдаун | PASS-auto | `e2e/ads-inter.spec.ts` «ADS-03 menu…», «ADS-03 portal…»; `e2e/ads-flags.spec.ts` «M4-12 interstitialCooldownSec 120…» |
| ADS-04 | 4.5: rewarded по кнопке «Реклама», награда в `onRewarded` | PASS-auto | `e2e/ads-rewarded.spec.ts` «ADS-04 …» (4 теста); `e2e/touch-ads.spec.ts` «ADS-04 phone…»; без рекламы — `tests/sim/balance-model.test.ts` |
| ADS-05 | 4.2, 1.14: после рекламы игра идёт | PASS-auto | `e2e/truthful-ads-outcomes.spec.ts` «ADS-05 rewarded × …», «ADS-05 fullscreen × …», «ADS-05 a late onRewarded…» |
| ADS-06 | 4.3: ориентация рекламы как у игры | PRODUCER | в черновике выставить альбомную ориентацию для мобильных |
| ADS-07 | 1.10: стики-баннер сжимает область игры | PASS-auto | `e2e/layout-matrix.spec.ts` «ADS-07: the sticky banner shrinks the game and it grows back on resize, nothing cut»; кадры `layout/sticky-*.png`; включить баннер в черновике — продюсер |

## 1.6 Покупки (IAP)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| IAP-01 | 1.4, 1.13: `ysdk.payments`, `getPurchases()` при старте, цена из каталога | PASS-auto | G-10 (26.10): в релизе покупки включены (`game.json` → `payments.enabled: true`, `tests/content/g10-payments.test.ts`); `e2e/iap.spec.ts` «G-10: on by default…», «IAP-04 … IAP-01 the price and the currency picture of the catalog», «IAP-01 bought before (another device)…»; архив без покупок `-no-iap` — «IAP off (?payments=0, as the archive without purchases)…» |
| IAP-02 | 1.13.3: купленное доступно на другом устройстве | PRODUCER | завести 4 товара в Консоли (`vip` 99, `autopilot` 79, `no_ads` 149, `starter` 49 ян; флаг уже включён, G-10), купить тестовым логином и войти с другого устройства |
| IAP-03 | 4.4: «Без рекламы» — нет interstitial и баннера | PASS-auto | на стенде: `e2e/iap.spec.ts` «the show after a purchase: VIP, autopilot, starter, no ads…»; `e2e/ads-inter.spec.ts` «ADS-03 «No ads»…» |
| IAP-04 | рекомендация: покупки не раньше 5 минут | PASS-auto | на стенде: `e2e/iap.spec.ts` «IAP-04 «Special» only from 300 s…» |

## 1.7 Экран и ввод (SCR)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| SCR-01 | 1.10.1, 1.10.3, 1.8: ничего не обрезано | PASS-auto | `e2e/layout-matrix.spec.ts` (матрица M6-02: 4 группы размеров и баннер); `e2e/layout.spec.ts` «SCR-01 phone sizes…»; кадры `layout/` |
| SCR-02 | 1.6.2.1, 1.6.2.2: ПК — canvas у краёв, ≤ 2:1 | PASS-auto | `e2e/layout.spec.ts` «SCR-02 desktop sizes…»; `e2e/layout-matrix.spec.ts` «SCR-01 SCR-02 SCR-03: PC»; `tests/ui/fit.test.ts` |
| SCR-03 | 1.10.2: нет прокрутки страницы | PASS-auto | `e2e/input.spec.ts` «SCR-03 Space jumps and never scrolls the page…»; `e2e/layout-matrix.spec.ts` (все размеры); чекер «No body scroll» — PASS |
| SCR-04 | 1.6.1.8, 1.6.2.7: нет выделения и меню | PASS-auto | `e2e/layout.spec.ts` «SCR-04 right click and long tap…» |
| SCR-05 | 1.6.2.4, 1.6.2.6: клавиши по `event.code` | PASS-auto | `e2e/input.spec.ts` «SCR-05 KeyW … Russian layout…», «SCR-05 no shortcuts with Ctrl or Alt…» |
| SCR-06 | 1.6.1.5, 1.10.4: телефон — жесты, зоны ≥ 44 px | PASS-auto | `e2e/touch.spec.ts` «SCR-06 stick, camera swipe and jump button…»; `e2e/touch-autorun.spec.ts`; игра одной рукой — продюсер |
| SCR-07 | 1.6.1.1, 1.14: поворот, «Назад» | PASS-auto | `e2e/moderation.spec.ts` «SCR-07 the browser «Back» and «Forward»…»; `e2e/layout.spec.ts` «SCR-07 resize and rotation…» |
| SCR-08 | 1.6.1.2: поле ввода — клавиатура по тапу | PRODUCER | применим из-за окна «Промокод» (Q-MU-9, Q-M6-3): на телефоне в черновике тап по полю открывает клавиатуру — или окно убирается по Q-M6-3 |
| SCR-09 | 1.14: ноль ошибок JS, ноль `alert` | PASS-auto | фикстура `e2e/fixtures.ts` роняет e2e на `pageerror` и `console.error`; `e2e/bot-session.spec.ts` @full; `e2e/smoke-release.spec.ts` |

## 1.8 Геймдизайн, который проверяет модерация (GD)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| GD-01 | 2.4: цель, прогресс, рекорд | PASS-manual | `docs/evidence/M2/hud_warn_1920x1080_ru.png`, `docs/evidence/compliance/layout/pc_1920x1080.png` |
| GD-02 | 2.9: контента больше 10 минут | PASS-auto | `tests/sim/balance-model.test.ts` «F16 … 10 mountains in 17–23 min»; `tests/sim/balance.test.ts` |
| GD-03 | 2.8: сложность растёт | PASS-auto | `validate:content` (требование стены растёт), `tests/content/validate.test.ts` «every pack in content/ is valid» |
| GD-04 | 2.2, 6.8: управление в игре и «Как играть» | PRODUCER | в игре — шаги обучения (`e2e/st-evidence.spec.ts`); поле «Как играть» карточки отложено (M6-06, решение 24.10) |
| GD-05 | 1.15: нет экрана-тупика | PASS-auto | `e2e/windows.spec.ts` «every window of 10.2 opens … closes…»; `e2e/rebirth.spec.ts`; `e2e/caught.spec.ts`; бот-сессия M6-03 (после каждого окна герой движется) |
| GD-06 | 1.15: нет заглушек и сырых ключей | PASS-manual | `tests/content/validate.test.ts` (ключи и пустые тексты); кадры окон ru и en: `docs/evidence/M4/loc/` |
| GD-07 | 2.3: категории | PRODUCER | «Аркады» и «Казуальные» в черновике; карточка отложена (M6-06) |
| GD-08 | 3.6, 5.12: название уникально | PRODUCER | поиск названия в каталоге на ru и en в день подачи |
| GD-09 | 2.13: рейтинг вовлечённости выше 30 | PRODUCER | смотреть в Консоли через 2 недели после выхода |

## 1.9 Контент, возраст, бренды (CNT)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| CNT-01 | 2.7: 6+, лавина без смерти | PASS-auto | `scripts/check-release.mjs` пункт 7 (словарь возраста); `e2e/caught.spec.ts`; кадр `docs/evidence/M2/caught_1920x1080_ru.png` |
| CNT-02 | 3.4: нет политики, флагов, религии | PRODUCER | просмотр кадров `docs/evidence/M5/` и прохождение черновика |
| CNT-03 | 3.5, 5.1.1.1: свои или CC0 ассеты, нет чужих брендов | PASS-auto | `tests/architecture.test.ts` «no stop-list words…»; `scripts/check-release.mjs` пункт 7; `assets/LICENSES.md` (модели Kenney CC0, Z-06); `tests/render/z-winter.test.ts` (герой не в цветах чужого аватара, декор без новогодних моделей) |
| CNT-04 | 3.7: нет реальных призов, денег, промокодов | PASS-auto | G-06 (26.10, Q-M6-3 А): окно «Промокод» выключено (`game.json` → `promo.enabled: false`), `e2e/g-promo.spec.ts` «G-06: the pause has no «Enter a code»»; награды за визит в группу нет (G-05, `e2e/fm-community-gift.spec.ts` «G-05: no gift for a visit…») |
| CNT-05 | 8.4: нет ссылок, кроме сообщества | PASS-auto | `tests/content/cnt05.test.ts`; `tests/architecture.test.ts` «window.open appears in src/** once…» |
| CNT-06 | 8.2.1, 8.2.4: тексты без ошибок | PRODUCER | вычитать `content/avalanche/i18n/ru.json` и `en.json` или кадры `docs/evidence/M4/loc/` |
| CNT-07 | 8.2.2: нет «онлайн», боты не выдаются за людей | PASS-auto | `scripts/check-release.mjs` пункт 7; `tests/content/validate.test.ts` «bots.json: names…»; `e2e/bots.spec.ts` |

## 1.10 Локализация (LOC)

| ID | пункт правил | статус | доказательство |
|---|---|---|---|
| LOC-01 | 8.2.3: языки = полные словари | PASS-auto | `tests/content/validate.test.ts`; `e2e/loc.spec.ts` «LOC-01 … at 640×360…» |
| LOC-02 | 8.2.3: переведено всё значимое | PASS-auto | `e2e/loc.spec.ts` обходит HUD и окна на en (кадры `docs/evidence/M4/loc/en/`); `e2e/hud.spec.ts` «en: texts from en.json…» |
| LOC-03 | 2.14: фолбэк языков | PASS-auto | `tests/platform/yandex.test.ts` «maps languages: ru, be, kk, uk, uz → ru; everything else → en»; `tests/ui/format.test.ts` |
| LOC-04 | 5.1.3, 5.12: название в игре = в карточке | PRODUCER | карточка (`store.json`) отложена решением продюсера 24.10 (M6-06); в игре название из `game.title` |
| LOC-05 | 6.9: ручной выбор языка | N/A | выбора языка в первой версии нет, язык из SDK |
| LOC-06 | 8.2.3: нет текста на картинках | PRODUCER | в игре весь текст — DOM; иконку, обложки и видео делает продюсер без текста |
