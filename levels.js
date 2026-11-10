/* Каждый новый уровень увеличивает ширину разрывов и луж. Главы добавляют механики. */
const CHAPTERS = [
  ['Заросший храм', '#629272'],
  ['Подземный акведук', '#5797a9'],
  ['Пещеры янтаря', '#bb8553'],
  ['Залы ветров', '#879cb8'],
  ['Лунный архив', '#9282c8'],
  ['Кристальный разлом', '#70a6ab'],
  ['Кузница стражей', '#b97561'],
  ['Сады теней', '#77967b'],
  ['Башня затмений', '#8b7eb3'],
  ['Сердце храма', '#c19468']
];

function createLevel(number) {
  const chapter = Math.floor((number - 1) / 10);
  const level = {
    number, chapter, title: CHAPTERS[chapter][0], accent: CHAPTERS[chapter][1],
    starts: [{x: 40, y: 480}, {x: 78, y: 480}],
    platforms: [], pools: [], gems: [], gates: [], plates: [], movers: [],
    doors: [{x: 824, y: 200, kind: 0}, {x: 882, y: 200, kind: 1}]
  };

  for (let row = 0; row < 3; row++) {
    const y = 480 - row * 140;
    // Нижний и верхний ярусы проходятся вправо, средний — влево.
    const direction = row === 1 ? -1 : 1;
    const at = (x, width = 0) => direction === 1 ? x : 960 - x - width;
    const start = row === 0 ? 18 : 165;
    const end = row === 2 ? 942 : 795;
    // Сохраняем место разбега и приближаем дальний край к следующей луже.
    const gapWidth = 44 + number + row * 3;
    const gap = 420;
    const platform = (x, width) => level.platforms.push({x: at(x, width), y, w: width, h: 16});
    platform(start, gap - start);
    platform(gap + gapWidth, end - gap - gapWidth);

    const firstKind = row % 2;
    for (const [index, x] of [286, 604].entries()) {
      const width = 44 + (number - 1) / 5;
      const toxic = index === 1 && chapter >= [5, 6, 7][row];
      const kind = toxic ? 2 : (firstKind + index) % 2;
      level.pools.push({x: at(x, width), y: y - 10, w: width, h: 10, kind});
      level.gems.push({x: at(x + width / 2), y: y - 43, kind: (firstKind + index) % 2});
    }

    if (row < 2) {
      for (const [x, rise] of [[805, 40], [856, 82], [795, 117]]) {
        level.platforms.push({x: at(x, 70), y: y - rise, w: 70, h: 13});
      }
    }
    if (chapter >= [3, 4, 5][row]) {
      level.movers.push({x: at(gap + (gapWidth - 36) / 2, 36), y: y + 27, w: 36, h: 9,
        baseY: y + 27, range: 13 + chapter, phase: row * Math.PI / 2});
    }
    // Добавленные механики остаются на соответствующих ярусах до конца игры.
    const paired = chapter >= [6, 2, 8][row];
    const timer = chapter >= [4, 7, 9][row];
    const duration = 450 - Math.max(0, number - 41) * 2;
    const gate = {x: at(714, 17), y: y - 122, w: 17, h: 122, open: 0,
      timer, duration, paired, latched: false, previous: false};
    level.gates.push(gate);
    level.plates.push({x: at(385, 29), y, w: 29, kind: firstKind, gate});
    if (paired) level.plates.push({x: at(684, 23), y, w: 23, kind: 1 - firstKind, gate});
  }
  return level;
}
