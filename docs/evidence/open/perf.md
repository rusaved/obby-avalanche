# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 42 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 41 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 35 | 65217 | 6 | 33 |
| 1 slope | рубеж 2 | 38 | 66738 | 7 | 41 |
| 1 slope | начало зоны великана | 41 | 67166 | 7 | 41 |
| 2 pines | подножие | 35 | 67993 | 7 | 38 |
| 2 pines | рубеж 2 | 37 | 69182 | 7 | 40 |
| 2 pines | начало зоны великана | 40 | 70648 | 7 | 41 |
| 3 pass | подножие | 36 | 70231 | 7 | 38 |
| 3 pass | рубеж 2 | 39 | 71044 | 7 | 40 |
| 3 pass | начало зоны великана | 40 | 70804 | 7 | 41 |
| 4 falls | подножие | 33 | 73923 | 7 | 36 |
| 4 falls | рубеж 2 | 38 | 78878 | 7 | 38 |
| 4 falls | начало зоны великана | 40 | 78412 | 7 | 39 |
| 5 canyon | подножие | 34 | 73143 | 7 | 37 |
| 5 canyon | рубеж 2 | 39 | 77332 | 7 | 39 |
| 5 canyon | начало зоны великана | 40 | 78090 | 7 | 40 |
| 6 crystal | подножие | 33 | 72741 | 7 | 36 |
| 6 crystal | рубеж 2 | 38 | 76680 | 7 | 38 |
| 6 crystal | начало зоны великана | 40 | 78122 | 7 | 39 |
| 7 blizzard | подножие | 34 | 79527 | 7 | 37 |
| 7 blizzard | рубеж 2 | 39 | 84616 | 7 | 39 |
| 7 blizzard | начало зоны великана | 40 | 84832 | 7 | 40 |
| 8 clouds | подножие | 32 | 79351 | 7 | 36 |
| 8 clouds | рубеж 2 | 38 | 84372 | 7 | 38 |
| 8 clouds | начало зоны великана | 40 | 85292 | 7 | 39 |
| 9 aurora | подножие | 35 | 85637 | 7 | 37 |
| 9 aurora | рубеж 2 | 39 | 90070 | 7 | 39 |
| 9 aurora | начало зоны великана | 40 | 88886 | 7 | 40 |
| 10 stars | подножие | 34 | 85805 | 7 | 36 |
| 10 stars | рубеж 2 | 39 | 90592 | 7 | 37 |
| 10 stars | начало зоны великана | 40 | 90156 | 7 | 39 |

Из чего худшая точка (1 slope, начало зоны великана), объект и число отрисовок за кадр:

- level-slope: 6
- acc-box: 1
- acc-cylinder: 1
- acc-sphere: 1
- avalanche-body: 1
- avalanche-clumps: 1
- avalanche-dust: 1
- cave-cut-parts: 1
- cave-marker: 1
- char-arm: 1
- char-hair: 1
- char-head: 1
- char-leg: 1
- char-torso: 1
- chunk-1: 1
- chunk-2: 1
- chunk-3: 1
- chunk-4: 1
- decor-animals: 1
- decor-glows: 1
- fun: 1
- fx: 1
- Mesh BoxGeometry: 1
- Mesh CircleGeometry: 1
- Mesh PlaneGeometry: 1
- pets: 1
- Points BufferGeometry: 1
- Scene : 1
- shadow: char-arm: 1
- shadow: char-head: 1
- shadow: char-leg: 1
- shadow: char-torso: 1
- sky-dome: 1
- way-arrows: 1
