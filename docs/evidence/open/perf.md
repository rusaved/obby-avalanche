# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 42 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 41 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 36 | 74747 | 6 | 33 |
| 1 slope | рубеж 2 | 39 | 73546 | 7 | 41 |
| 1 slope | начало зоны великана | 41 | 77260 | 7 | 41 |
| 2 pines | подножие | 35 | 71603 | 7 | 38 |
| 2 pines | рубеж 2 | 40 | 74728 | 7 | 41 |
| 2 pines | начало зоны великана | 41 | 74064 | 7 | 42 |
| 3 pass | подножие | 35 | 73725 | 7 | 38 |
| 3 pass | рубеж 2 | 41 | 74500 | 7 | 41 |
| 3 pass | начало зоны великана | 41 | 73874 | 7 | 42 |
| 4 falls | подножие | 33 | 76961 | 7 | 36 |
| 4 falls | рубеж 2 | 41 | 82666 | 7 | 40 |
| 4 falls | начало зоны великана | 41 | 82632 | 7 | 41 |
| 5 canyon | подножие | 34 | 76687 | 7 | 37 |
| 5 canyon | рубеж 2 | 41 | 82660 | 7 | 40 |
| 5 canyon | начало зоны великана | 41 | 82286 | 7 | 41 |
| 6 crystal | подножие | 35 | 78103 | 7 | 38 |
| 6 crystal | рубеж 2 | 40 | 83772 | 7 | 40 |
| 6 crystal | начало зоны великана | 41 | 82974 | 7 | 41 |
| 7 blizzard | подножие | 34 | 83909 | 7 | 37 |
| 7 blizzard | рубеж 2 | 40 | 89534 | 7 | 40 |
| 7 blizzard | начало зоны великана | 41 | 90272 | 7 | 41 |
| 8 clouds | подножие | 34 | 84531 | 7 | 37 |
| 8 clouds | рубеж 2 | 40 | 89846 | 7 | 40 |
| 8 clouds | начало зоны великана | 41 | 90780 | 7 | 41 |
| 9 aurora | подножие | 35 | 89729 | 7 | 37 |
| 9 aurora | рубеж 2 | 41 | 96932 | 7 | 40 |
| 9 aurora | начало зоны великана | 41 | 93266 | 7 | 41 |
| 10 stars | подножие | 35 | 91093 | 7 | 37 |
| 10 stars | рубеж 2 | 40 | 94256 | 7 | 39 |
| 10 stars | начало зоны великана | 41 | 95208 | 7 | 41 |

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
