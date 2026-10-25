# M5-01 · темы гор — сверка (сессия «Лавина 16», 25.10)

Закрыто вехами ST и MT, не переделывалось.

- Цвета и параметры — `content/avalanche/theme.json` (`sky`, `fog`, `light`, `materials`, `tints` по 9 горам, `decor`); в `src/` цветов нет — `tests/architecture.test.ts` 9 из 9 (25.10)
- Кадры 3 точек каждой из 10 гор (старт, испытание, финиш) — `docs/evidence/MT/880x405/m01-1-start.png` … `m10-3-finish.png` (30 кадров, веха MT)
- Draw calls в 3 точках каждой горы (подножие, рубеж 2, зона великана) — `docs/evidence/open/perf.md`, переснят 25.10: худшее 39 (предел 60); `e2e/open-perf.spec.ts` и `e2e/perf.spec.ts` SP-03 — 6 из 6 зелёные
