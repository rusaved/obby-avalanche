# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 40 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 39 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 34 | 55894 | 4 | 30 |
| 1 slope | рубеж 2 | 36 | 55700 | 5 | 37 |
| 1 slope | начало зоны великана | 38 | 56194 | 5 | 37 |
| 2 pines | подножие | 34 | 59510 | 5 | 34 |
| 2 pines | рубеж 2 | 36 | 59316 | 5 | 36 |
| 2 pines | начало зоны великана | 38 | 59966 | 5 | 37 |
| 3 pass | подножие | 34 | 60830 | 5 | 35 |
| 3 pass | рубеж 2 | 37 | 60648 | 5 | 37 |
| 3 pass | начало зоны великана | 38 | 60230 | 5 | 38 |
| 4 falls | подножие | 32 | 64766 | 5 | 34 |
| 4 falls | рубеж 2 | 36 | 67344 | 5 | 36 |
| 4 falls | начало зоны великана | 38 | 67190 | 5 | 37 |
| 5 canyon | подножие | 33 | 65222 | 5 | 34 |
| 5 canyon | рубеж 2 | 37 | 67704 | 5 | 36 |
| 5 canyon | начало зоны великана | 38 | 67322 | 5 | 37 |
| 6 crystal | подножие | 33 | 65018 | 5 | 34 |
| 6 crystal | рубеж 2 | 36 | 66360 | 5 | 36 |
| 6 crystal | начало зоны великана | 38 | 66722 | 5 | 37 |
| 7 blizzard | подножие | 33 | 70886 | 5 | 34 |
| 7 blizzard | рубеж 2 | 37 | 73188 | 5 | 36 |
| 7 blizzard | начало зоны великана | 38 | 72698 | 5 | 37 |
| 8 clouds | подножие | 32 | 71498 | 5 | 34 |
| 8 clouds | рубеж 2 | 35 | 73008 | 5 | 36 |
| 8 clouds | начало зоны великана | 38 | 73598 | 5 | 37 |
| 9 aurora | подножие | 35 | 78422 | 5 | 34 |
| 9 aurora | рубеж 2 | 39 | 80928 | 5 | 36 |
| 9 aurora | начало зоны великана | 39 | 78026 | 5 | 37 |
| 10 stars | подножие | 35 | 79154 | 5 | 34 |
| 10 stars | рубеж 2 | 38 | 80508 | 5 | 35 |
| 10 stars | начало зоны великана | 39 | 78614 | 5 | 37 |

Из чего худшая точка (9 aurora, рубеж 2), объект и число отрисовок за кадр:

- level-aurora: 6
- Mesh BufferGeometry: 2
- acc-box: 1
- acc-cone: 1
- acc-cylinder: 1
- acc-sphere: 1
- avalanche-crack: 1
- avalanche-dust: 1
- cave-cut-parts: 1
- cave-marker: 1
- char-arm: 1
- char-head: 1
- char-leg: 1
- char-torso: 1
- chunk-1: 1
- chunk-2: 1
- chunk-3: 1
- decor-sitters: 1
- decor-walkers: 1
- fun: 1
- fx: 1
- Mesh CircleGeometry: 1
- Mesh PlaneGeometry: 1
- pets: 1
- Scene : 1
- see-through-solid: 1
- shadow: char-arm: 1
- shadow: char-head: 1
- shadow: char-leg: 1
- shadow: char-torso: 1
- way-arrows: 1
