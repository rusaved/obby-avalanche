# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 40 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 36 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 32 | 53244 | 5 | 29 |
| 1 slope | рубеж 2 | 35 | 52858 | 5 | 34 |
| 1 slope | начало зоны великана | 33 | 52174 | 5 | 34 |
| 2 pines | подножие | 30 | 55682 | 5 | 32 |
| 2 pines | рубеж 2 | 36 | 56066 | 5 | 34 |
| 2 pines | начало зоны великана | 33 | 53426 | 5 | 35 |
| 3 pass | подножие | 30 | 55250 | 5 | 33 |
| 3 pass | рубеж 2 | 33 | 55566 | 5 | 34 |
| 3 pass | начало зоны великана | 31 | 53214 | 5 | 36 |
| 4 falls | подножие | 30 | 61910 | 5 | 33 |
| 4 falls | рубеж 2 | 32 | 62152 | 5 | 34 |
| 4 falls | начало зоны великана | 31 | 59634 | 5 | 36 |
| 5 canyon | подножие | 29 | 61502 | 5 | 32 |
| 5 canyon | рубеж 2 | 31 | 62476 | 5 | 34 |
| 5 canyon | начало зоны великана | 31 | 59838 | 5 | 36 |
| 6 crystal | подножие | 28 | 60158 | 5 | 31 |
| 6 crystal | рубеж 2 | 33 | 61716 | 5 | 34 |
| 6 crystal | начало зоны великана | 33 | 59870 | 5 | 36 |
| 7 blizzard | подножие | 28 | 66266 | 5 | 31 |
| 7 blizzard | рубеж 2 | 33 | 68184 | 5 | 34 |
| 7 blizzard | начало зоны великана | 33 | 65834 | 5 | 36 |
| 8 clouds | подножие | 29 | 67130 | 5 | 32 |
| 8 clouds | рубеж 2 | 33 | 68196 | 5 | 34 |
| 8 clouds | начало зоны великана | 33 | 66146 | 5 | 36 |
| 9 aurora | подножие | 31 | 75830 | 5 | 32 |
| 9 aurora | рубеж 2 | 35 | 77280 | 5 | 34 |
| 9 aurora | начало зоны великана | 34 | 73562 | 5 | 36 |
| 10 stars | подножие | 31 | 76274 | 5 | 32 |
| 10 stars | рубеж 2 | 35 | 78012 | 5 | 34 |
| 10 stars | начало зоны великана | 34 | 73898 | 5 | 36 |

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
- decor-walkers: 1
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
