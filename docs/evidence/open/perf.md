# Простор: замеры отрисовки (PS-09)

Сборка `build:e2e`, Chromium + SwiftShader, `?pace=open&quality=high`, 960×540. Цели `docs/02-tech.md` 9.5: draw calls 40 (предел 60), треугольники ≤ 100000, текстуры ≤ 12. Худшее: 40 вызовов.

| Гора | Точка | Draw calls | Треугольники | Текстуры | Геометрии |
|---|---|---|---|---|---|
| 1 slope | подножие | 34 | 55726 | 4 | 30 |
| 1 slope | рубеж 2 | 37 | 58542 | 5 | 38 |
| 1 slope | начало зоны великана | 39 | 59036 | 5 | 38 |
| 2 pines | подножие | 34 | 60014 | 5 | 35 |
| 2 pines | рубеж 2 | 37 | 63230 | 5 | 37 |
| 2 pines | начало зоны великана | 39 | 63880 | 5 | 38 |
| 3 pass | подножие | 34 | 60830 | 5 | 36 |
| 3 pass | рубеж 2 | 38 | 64258 | 5 | 37 |
| 3 pass | начало зоны великана | 39 | 63840 | 5 | 38 |
| 4 falls | подножие | 32 | 64766 | 5 | 35 |
| 4 falls | рубеж 2 | 36 | 70230 | 5 | 37 |
| 4 falls | начало зоны великана | 39 | 71000 | 5 | 38 |
| 5 canyon | подножие | 33 | 65306 | 5 | 35 |
| 5 canyon | рубеж 2 | 37 | 70862 | 5 | 37 |
| 5 canyon | начало зоны великана | 39 | 71416 | 5 | 38 |
| 6 crystal | подножие | 33 | 65270 | 5 | 35 |
| 6 crystal | рубеж 2 | 37 | 70822 | 5 | 37 |
| 6 crystal | начало зоны великана | 39 | 71184 | 5 | 38 |
| 7 blizzard | подножие | 33 | 70886 | 5 | 35 |
| 7 blizzard | рубеж 2 | 38 | 77998 | 5 | 37 |
| 7 blizzard | начало зоны великана | 39 | 77508 | 5 | 38 |
| 8 clouds | подножие | 32 | 71498 | 5 | 35 |
| 8 clouds | рубеж 2 | 37 | 78462 | 5 | 37 |
| 8 clouds | начало зоны великана | 39 | 78008 | 5 | 38 |
| 9 aurora | подножие | 35 | 78590 | 5 | 35 |
| 9 aurora | рубеж 2 | 39 | 85050 | 5 | 37 |
| 9 aurora | начало зоны великана | 40 | 83204 | 5 | 38 |
| 10 stars | подножие | 35 | 78818 | 5 | 35 |
| 10 stars | рубеж 2 | 39 | 85782 | 5 | 36 |
| 10 stars | начало зоны великана | 40 | 83888 | 5 | 38 |

Из чего худшая точка (9 aurora, начало зоны великана), объект и число отрисовок за кадр:

- level-aurora: 6
- Mesh PlaneGeometry: 2
- acc-box: 1
- acc-cone: 1
- acc-cylinder: 1
- acc-sphere: 1
- avalanche-body: 1
- avalanche-clumps: 1
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
- fx: 1
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
