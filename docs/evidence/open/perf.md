# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 40 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 37 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 31 | 52488 | 5 | 27 |
| 1 slope | рубеж 2 | 36 | 52126 | 5 | 32 |
| 1 slope | начало зоны великана | 34 | 51442 | 5 | 32 |
| 2 pines | подножие | 29 | 53750 | 5 | 30 |
| 2 pines | рубеж 2 | 37 | 54098 | 5 | 32 |
| 2 pines | начало зоны великана | 34 | 52178 | 5 | 33 |
| 3 pass | подножие | 29 | 54038 | 5 | 30 |
| 3 pass | рубеж 2 | 36 | 54062 | 5 | 31 |
| 3 pass | начало зоны великана | 34 | 52274 | 5 | 33 |
| 4 falls | подножие | 29 | 54122 | 5 | 30 |
| 4 falls | рубеж 2 | 33 | 54120 | 5 | 31 |
| 4 falls | начало зоны великана | 32 | 52334 | 5 | 33 |
| 5 canyon | подножие | 28 | 53594 | 5 | 29 |
| 5 canyon | рубеж 2 | 32 | 54324 | 5 | 31 |
| 5 canyon | начало зоны великана | 32 | 52406 | 5 | 33 |
| 6 crystal | подножие | 28 | 53690 | 5 | 29 |
| 6 crystal | рубеж 2 | 32 | 54324 | 5 | 31 |
| 6 crystal | начало зоны великана | 32 | 52406 | 5 | 33 |
| 7 blizzard | подножие | 28 | 53738 | 5 | 29 |
| 7 blizzard | рубеж 2 | 32 | 54372 | 5 | 31 |
| 7 blizzard | начало зоны великана | 32 | 52406 | 5 | 33 |
| 8 clouds | подножие | 28 | 53822 | 5 | 29 |
| 8 clouds | рубеж 2 | 32 | 54600 | 5 | 31 |
| 8 clouds | начало зоны великана | 32 | 52538 | 5 | 33 |
| 9 aurora | подножие | 28 | 53918 | 5 | 29 |
| 9 aurora | рубеж 2 | 32 | 54696 | 5 | 31 |
| 9 aurora | начало зоны великана | 32 | 52586 | 5 | 33 |
| 10 stars | подножие | 28 | 53954 | 5 | 29 |
| 10 stars | рубеж 2 | 32 | 54636 | 5 | 31 |
| 10 stars | начало зоны великана | 32 | 52574 | 5 | 33 |

Из чего худшая точка (2 pines, рубеж 2), объект и число отрисовок за кадр:

- level-pines: 6
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
- chunk-2: 1
- chunk-3: 1
- chunk-4: 1
- chunk-5: 1
- ftue: 1
- fun: 1
- Mesh BoxGeometry: 1
- Mesh BufferGeometry: 1
- Mesh CircleGeometry: 1
- pets: 1
- Scene : 1
- shadow: char-arm: 1
- shadow: char-head: 1
- shadow: char-leg: 1
- shadow: char-torso: 1
