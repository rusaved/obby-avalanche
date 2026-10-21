# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 40 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 38 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 33 | 56146 | 4 | 29 |
| 1 slope | рубеж 2 | 35 | 55952 | 5 | 36 |
| 1 slope | начало зоны великана | 37 | 56446 | 5 | 36 |
| 2 pines | подножие | 33 | 60098 | 5 | 33 |
| 2 pines | рубеж 2 | 35 | 59904 | 5 | 35 |
| 2 pines | начало зоны великана | 37 | 60554 | 5 | 36 |
| 3 pass | подножие | 33 | 60830 | 5 | 34 |
| 3 pass | рубеж 2 | 36 | 60648 | 5 | 35 |
| 3 pass | начало зоны великана | 37 | 60230 | 5 | 36 |
| 4 falls | подножие | 31 | 64766 | 5 | 33 |
| 4 falls | рубеж 2 | 34 | 66420 | 5 | 35 |
| 4 falls | начало зоны великана | 37 | 67190 | 5 | 36 |
| 5 canyon | подножие | 32 | 65222 | 5 | 33 |
| 5 canyon | рубеж 2 | 36 | 67704 | 5 | 35 |
| 5 canyon | начало зоны великана | 37 | 67322 | 5 | 36 |
| 6 crystal | подножие | 32 | 65102 | 5 | 33 |
| 6 crystal | рубеж 2 | 36 | 67428 | 5 | 35 |
| 6 crystal | начало зоны великана | 37 | 66806 | 5 | 36 |
| 7 blizzard | подножие | 32 | 70886 | 5 | 33 |
| 7 blizzard | рубеж 2 | 35 | 72144 | 5 | 35 |
| 7 blizzard | начало зоны великана | 37 | 72698 | 5 | 36 |
| 8 clouds | подножие | 31 | 71498 | 5 | 33 |
| 8 clouds | рубеж 2 | 34 | 73008 | 5 | 35 |
| 8 clouds | начало зоны великана | 37 | 73598 | 5 | 36 |
| 9 aurora | подножие | 34 | 78254 | 5 | 33 |
| 9 aurora | рубеж 2 | 37 | 79704 | 5 | 35 |
| 9 aurora | начало зоны великана | 38 | 77858 | 5 | 36 |
| 10 stars | подножие | 34 | 78902 | 5 | 33 |
| 10 stars | рубеж 2 | 37 | 80256 | 5 | 34 |
| 10 stars | начало зоны великана | 38 | 78362 | 5 | 36 |

Из чего худшая точка (9 aurora, начало зоны великана), объект и число отрисовок за кадр:

- level-aurora: 6
- Mesh PlaneGeometry: 2
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
- chunk-4: 1
- chunk-5: 1
- decor-sitters: 1
- decor-walkers: 1
- fun: 1
- Mesh BoxGeometry: 1
- Mesh BufferGeometry: 1
- Mesh CircleGeometry: 1
- pets: 1
- Scene : 1
- see-through-solid: 1
- shadow: char-arm: 1
- shadow: char-head: 1
- shadow: char-leg: 1
- shadow: char-torso: 1
- way-arrows: 1
