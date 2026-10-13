# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 40 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 39 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 33 | 53614 | 4 | 29 |
| 1 slope | рубеж 2 | 35 | 53204 | 4 | 33 |
| 1 slope | начало зоны великана | 36 | 51962 | 5 | 36 |
| 2 pines | подножие | 32 | 56342 | 5 | 33 |
| 2 pines | рубеж 2 | 37 | 56942 | 5 | 34 |
| 2 pines | начало зоны великана | 37 | 54198 | 5 | 37 |
| 3 pass | подножие | 32 | 55610 | 5 | 34 |
| 3 pass | рубеж 2 | 36 | 56100 | 5 | 35 |
| 3 pass | начало зоны великана | 37 | 53646 | 5 | 38 |
| 4 falls | подножие | 31 | 61526 | 5 | 33 |
| 4 falls | рубеж 2 | 35 | 63456 | 5 | 35 |
| 4 falls | начало зоны великана | 37 | 60342 | 5 | 38 |
| 5 canyon | подножие | 31 | 61946 | 5 | 33 |
| 5 canyon | рубеж 2 | 35 | 63156 | 5 | 35 |
| 5 canyon | начало зоны великана | 37 | 60498 | 5 | 38 |
| 6 crystal | подножие | 30 | 60554 | 5 | 32 |
| 6 crystal | рубеж 2 | 35 | 62988 | 5 | 35 |
| 6 crystal | начало зоны великана | 37 | 60606 | 5 | 38 |
| 7 blizzard | подножие | 30 | 66518 | 5 | 32 |
| 7 blizzard | рубеж 2 | 35 | 69192 | 5 | 35 |
| 7 blizzard | начало зоны великана | 37 | 66378 | 5 | 38 |
| 8 clouds | подножие | 31 | 67430 | 5 | 33 |
| 8 clouds | рубеж 2 | 35 | 69120 | 5 | 35 |
| 8 clouds | начало зоны великана | 37 | 66714 | 5 | 38 |
| 9 aurora | подножие | 33 | 76118 | 5 | 33 |
| 9 aurora | рубеж 2 | 37 | 78312 | 5 | 35 |
| 9 aurora | начало зоны великана | 39 | 74130 | 5 | 38 |
| 10 stars | подножие | 33 | 76766 | 5 | 33 |
| 10 stars | рубеж 2 | 36 | 77472 | 5 | 34 |
| 10 stars | начало зоны великана | 38 | 74446 | 5 | 37 |

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
