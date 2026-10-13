# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 40 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 39 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 33 | 54274 | 4 | 29 |
| 1 slope | рубеж 2 | 35 | 53864 | 4 | 33 |
| 1 slope | начало зоны великана | 36 | 52526 | 5 | 36 |
| 2 pines | подножие | 32 | 56582 | 5 | 33 |
| 2 pines | рубеж 2 | 37 | 57134 | 5 | 34 |
| 2 pines | начало зоны великана | 37 | 54150 | 5 | 37 |
| 3 pass | подножие | 32 | 55958 | 5 | 34 |
| 3 pass | рубеж 2 | 36 | 56472 | 5 | 35 |
| 3 pass | начало зоны великана | 37 | 53778 | 5 | 38 |
| 4 falls | подножие | 31 | 61766 | 5 | 33 |
| 4 falls | рубеж 2 | 35 | 63840 | 5 | 35 |
| 4 falls | начало зоны великана | 37 | 60462 | 5 | 38 |
| 5 canyon | подножие | 31 | 62186 | 5 | 33 |
| 5 canyon | рубеж 2 | 35 | 63588 | 5 | 35 |
| 5 canyon | начало зоны великана | 37 | 60546 | 5 | 38 |
| 6 crystal | подножие | 30 | 61166 | 5 | 32 |
| 6 crystal | рубеж 2 | 35 | 63720 | 5 | 35 |
| 6 crystal | начало зоны великана | 37 | 61026 | 5 | 38 |
| 7 blizzard | подножие | 30 | 66998 | 5 | 32 |
| 7 blizzard | рубеж 2 | 35 | 69816 | 5 | 35 |
| 7 blizzard | начало зоны великана | 37 | 66594 | 5 | 38 |
| 8 clouds | подножие | 31 | 67958 | 5 | 33 |
| 8 clouds | рубеж 2 | 35 | 70020 | 5 | 35 |
| 8 clouds | начало зоны великана | 37 | 66978 | 5 | 38 |
| 9 aurora | подножие | 33 | 76730 | 5 | 33 |
| 9 aurora | рубеж 2 | 37 | 79332 | 5 | 35 |
| 9 aurora | начало зоны великана | 39 | 74598 | 5 | 38 |
| 10 stars | подножие | 33 | 77198 | 5 | 33 |
| 10 stars | рубеж 2 | 36 | 78108 | 5 | 34 |
| 10 stars | начало зоны великана | 38 | 74734 | 5 | 37 |

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
- chunk-6: 1
- decor-sitters: 1
- decor-walkers: 1
- Mesh BoxGeometry: 1
- Mesh BufferGeometry: 1
- Mesh CircleGeometry: 1
- pets: 1
- portal-glow: 1
- Scene : 1
- shadow: char-arm: 1
- shadow: char-head: 1
- shadow: char-leg: 1
- shadow: char-torso: 1
- way-arrows: 1
