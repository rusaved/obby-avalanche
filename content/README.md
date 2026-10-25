# Пакет контента: контракт

Игра — движок «+1 X Escape»: всё, что видит и слышит игрок, лежит в `content/<pack>/`. Игра 2 — новая папка с теми же файлами. Код меняется только в новом модуле эффекта стата (`src/sim/effects/`, до 100 строк) и, если нужно, в новом типе сегмента (`docs/01a-content.md`, раздел 14; `docs/02-tech.md`, 5.1–5.4).

- `avalanche` — игра 1 (лавина, стат «Скорость»)
- `_sample` — проверка замены: стат «Прыжок» (эффект `jumpPower`), волна лавы, 1 гора, 3 стены

## Сборка и проверка

| Команда | Что делает |
|---|---|
| `VITE_CONTENT=<pack> npm run dev` | игра на пакете (по умолчанию `avalanche`) |
| `npm run validate:content` | схемы и связи всех пакетов и темпов; код 0 — пакет годен |
| `npm run gen:worlds` | `worlds.json` из `worlds-spec.json` и `balance.json` (руками не правится) |
| `npm run e2e:sample` | сборка `_sample` и смоук `e2e/sample.spec.ts` |

## Версия схемы

`game.json` → `"schema": 1`. Новое поле с умолчанием — та же версия; поле, без которого старый пакет не соберётся, — версия 2 и запись в `docs/допущения.md`.

## Файлы

| Файл | Обязателен | Что внутри |
|---|---|---|
| `game.json` | да | `id`, `schema`, `stat` (`key`, `effect`), `threat` (`kind`, `visual`, золотой подарок `bonus`, великан `boss`), реклама (`ads`), покупки (`payments`), флаги (`flags`), Метрика, ориентация, события горы (`events`), сообщество, ярлык |
| `balance.json` | да | шаг (`stepLength`, `gainPerStep`, `gainTrigger: "step"`), кривая эффекта (`speedCurve`; при `jumpPower` ещё `jumpCurve`), кроссовки (`upgrade.tiers`), перерождение, кубки, подарки, монеты, питомцы, бусты, лавина, реклама, покупки, календарь, задания, награды за время, колесо, подсказки, обучение |
| `tuning.json` | да | ощущение: контроллер, камера, лавина, эффекты (`fx`); ползунки `?debug=1` |
| `theme.json` | да | палитра: небо, туман, свет, материалы, редкости, интерфейс, облик угрозы (`threat`: фронт, тело, пыль, комья, тень, гул; `threat.worlds` — по горам), оттенки гор (`tints`), украшения |
| `worlds-spec.json` | да | шаблон гор: длины, ширина, угроза, горы со стенами (`walls`: `requires`, `treadmill`, `ledge`) |
| `worlds.json` | да | горы для движка, собирает `gen:worlds` |
| `skins.json`, `accessories.json` | да | скины (цвета 6 частей, лицо, шапка, как открыть) и крылья; детали аксессуаров из примитивов |
| `pets.json`, `eggs.json` | да | питомцы (цвет, бонус, редкость) и яйца (цена, шансы) |
| `trails.json`, `auras.json` | да | трейлы и ауры (множитель, цена в кубках) |
| `sfx.json` | да | звуки ZzFX по именам, файлы `assets/audio/` (`files`), шаги (`footsteps`), реплики (`cues`) и их события (`events`) |
| `bots.json` | да | боты: число по качеству, палитра, имена-ключи, поведение |
| `i18n/ru.json`, `i18n/en.json` | да | все тексты игрока; ключи в обоих файлах одинаковые |
| `pace/<pace>/` | нет | заплатки темпа: `balance.json`, `tuning.json`, `worlds-spec.json`, `worlds.json`, `base.json` |

## Перечисления

| Поле | Значения |
|---|---|
| `game.json` → `stat.effect` | `moveSpeed` (бег от стата), `jumpPower` (прыжок от стата, бег ровный), `gateOnly` (стат только открывает стены) |
| `game.json` → `threat.kind` | `wave` |
| `game.json` → `threat.visual` | любое имя: вид задаёт `theme.json` → `threat`, модуль рендера волны один |
| `balance.json` → `gainTrigger` | `step` |
| `worlds-spec.json` → `layout` | `classic`, `gateSide`, `openSlope`, `stageSlope` (по темпу) |
| `skins.json` → `unlock.kind` | `default`, `trophies`, `daily`, `iap`, `tier` |
| `theme.json` → `fx.*` | по одному значению в игре 1: `caught: ball`, `gateOpen: melt`, `footFx: snow`, `weather: snow`, `screenFrame: frost`, `shelterMesh: cave`, `treadmill: snowWhirl`; новое значение — новый модуль |
| Типы сегментов `worlds.json` | `floor`, `wall`, `gate`, `niche`, `gap`, `ramp`, `steps`, `treadmill`, `checkpoint`, `coins`, `chest`, `portal`, `decor`, `gift`, `eggStand`, `zoneArch`, `summit`, `jumpPad`, `slide`, `fork`, `cliff`, `chestGrotto`, `chasm`, `throat`, `tunnel`, `hump`, `funnel`, `taper`, `island`, `cover`, `pit`, `stairs`, `dip`, `block`, `trophyPad` |

Полный список полей и границ — схемы `valibot` в `src/level/validate.ts` (`SCHEMAS`); ошибки валидатора называют файл и поле.

## Правила данных

- Цвета — только `#RRGGBB` в `theme.json` и `skins.json`; в `src/` цветов, чисел баланса, текстов игрока и имени стата нет (архитектурный тест)
- Тексты игрока — только ключи `i18n`; 6+: без «смерти», «жизней», «конца игры» (`docs/03`, раздел 3)
- Чужих брендов нет нигде (`scripts/stopwords.json`, `tests/architecture.test.ts`)
- Звук — ZzFX или файлы `assets/audio/` с лицензией в `assets/LICENSES.md`; внешних запросов нет
