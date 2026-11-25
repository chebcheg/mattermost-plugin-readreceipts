// Тест геометрии окна со списком читателей: webapp/src/position.js.
//
// Запуск: node webapp/test/position.test.mjs
//
// Модуль position.js написан как ES-модуль без внешних зависимостей, а
// package.json здесь без "type": "module" — поэтому исходник читается и
// загружается как функция, без сборщика и фреймворков.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'position.js'), 'utf8').replace(/^export /gm, '');
const { place, SIDES, GAP, DEFAULT_SIDE } = new Function(`${source}\nreturn { place, SIDES, GAP, DEFAULT_SIDE };`)();

let failed = 0;
let passed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        return;
    }
    failed += 1;
    console.log(`  ПРОВАЛ: ${name}${detail ? ` — ${detail}` : ''}`);
}

function overlap(a, b) {
    const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
    const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    return (w > 0 && h > 0) ? w * h : 0;
}

const SIDES_LIST = Object.keys(SIDES);

// ---------------------------------------------------------------- сценарии

console.log('Типовые случаи (экран 1400x900, окно 340x320, галочка 120x18):');

const viewport = { width: 1400, height: 900 };
const popup = { width: 340, height: 320 };
const anchorSize = { width: 120, height: 18 };

const cases = [
    { name: 'галочка внизу ленты', anchor: { left: 1000, top: 700, ...anchorSize } },
    { name: 'галочка у верха экрана', anchor: { left: 1000, top: 20, ...anchorSize } },
    { name: 'галочка в середине', anchor: { left: 700, top: 450, ...anchorSize } },
    { name: 'галочка у правого края', anchor: { left: 1270, top: 400, ...anchorSize } },
    { name: 'галочка у левого края', anchor: { left: 4, top: 400, ...anchorSize } },
    { name: 'галочка в самом низу', anchor: { left: 900, top: 878, ...anchorSize } },
];

for (const c of cases) {
    for (const side of SIDES_LIST) {
        const res = place(c.anchor, popup, side, viewport);
        const rect = { left: res.left, top: res.top, ...popup };
        const area = overlap(rect, c.anchor);
        check(
            `${c.name}, сторона «${side}»`,
            area === 0,
            `окно ${JSON.stringify(rect)} перекрывает галочку на ${area} px²`
        );
        check(
            `${c.name}, сторона «${side}»: окно в границах экрана`,
            rect.left >= 0 && rect.top >= 0 &&
            rect.left + rect.width <= viewport.width && rect.top + rect.height <= viewport.height,
            `окно ${JSON.stringify(rect)}`
        );
    }
}

console.log(`  проверено случаев: ${cases.length * SIDES_LIST.length * 2}`);

// ------------------------------------------------- второй по важности случай
// Ничего не помещается с выбранной стороны — раньше окно прижималось к верху
// экрана и ложилось ровно на галочку. Проверяем все положения галочки на сетке.

console.log('Сетка положений (окно 340x320, все четыре стороны):');
let gridFailures = 0;
let gridChecks = 0;
for (let top = 4; top <= 880; top += 42) {
    for (let left = 4; left <= 1270; left += 66) {
        const anchor = { left, top, ...anchorSize };
        for (const side of SIDES_LIST) {
            const res = place(anchor, popup, side, viewport);
            const rect = { left: res.left, top: res.top, ...popup };
            gridChecks += 1;
            if (overlap(rect, anchor) > 0) {
                gridFailures += 1;
                if (gridFailures < 4) {
                    console.log(`  ПРОВАЛ: галочка ${JSON.stringify(anchor)}, сторона «${side}» → окно ${JSON.stringify(rect)}`);
                }
            }
        }
    }
}
check('на сетке нет ни одного перекрытия', gridFailures === 0, `перекрытий: ${gridFailures} из ${gridChecks}`);
console.log(`  проверено положений: ${gridChecks}`);

// ----------------------------------------------------- довольно узкий экран

console.log('Узкий экран (800x420, окно 340x320):');
const narrow = { width: 800, height: 420 };
let narrowFailures = 0;
let narrowChecks = 0;
for (let top = 4; top <= 400; top += 40) {
    for (let left = 4; left <= 680; left += 40) {
        const anchor = { left, top, ...anchorSize };
        for (const side of SIDES_LIST) {
            const res = place(anchor, popup, side, narrow);
            const rect = { left: res.left, top: res.top, ...popup };
            narrowChecks += 1;
            const area = overlap(rect, anchor);
            if (area > 0) {
                narrowFailures += 1;
                if (narrowFailures < 4) {
                    console.log(`  ПРОВАЛ: галочка ${JSON.stringify(anchor)}, сторона «${side}» → окно ${JSON.stringify(rect)}, перекрытие ${area}`);
                }
            }
        }
    }
}
check('на узком экране нет перекрытий', narrowFailures === 0, `перекрытий: ${narrowFailures} из ${narrowChecks}`);
console.log(`  проверено положений: ${narrowChecks}`);

// ----------------------------------------------------------- выбор стороны

console.log('Выбор стороны:');
const roomy = { left: 800, top: 500, ...anchorSize };
check('«слева» остаётся слева, когда места хватает',
    place(roomy, popup, 'left', viewport).left + popup.width < roomy.left,
    JSON.stringify(place(roomy, popup, 'left', viewport)));
check('«справа» уходит вправо, когда места хватает',
    place(roomy, popup, 'right', viewport).left > roomy.left + roomy.width,
    JSON.stringify(place(roomy, popup, 'right', viewport)));
check('«над галочкой» встаёт выше, когда места хватает',
    place(roomy, popup, 'above', viewport).top + popup.height < roomy.top,
    JSON.stringify(place(roomy, popup, 'above', viewport)));
check('«под галочкой» встаёт ниже, когда места хватает',
    place(roomy, popup, 'below', viewport).top > roomy.top + roomy.height,
    JSON.stringify(place(roomy, popup, 'below', viewport)));

const nearLeft = { left: 4, top: 500, ...anchorSize };
const flipped = place(nearLeft, popup, 'left', viewport);
check('«слева» у левого края уезжает вправо, а не накрывает галочку',
    flipped.left - GAP >= nearLeft.left + nearLeft.width,
    JSON.stringify(flipped));

const nearTop = { left: 1000, top: 6, ...anchorSize };
const below = place(nearTop, popup, 'above', viewport);
check('«над галочкой» у верхнего края уезжает вниз, а не накрывает галочку',
    below.top >= nearTop.top + nearTop.height,
    JSON.stringify(below));

check('неизвестная сторона трактуется как сторона по умолчанию',
    JSON.stringify(place(roomy, popup, 'сверху', viewport)) ===
        JSON.stringify(place(roomy, popup, DEFAULT_SIDE, viewport)),
    `${JSON.stringify(place(roomy, popup, 'сверху', viewport))} против ${DEFAULT_SIDE}`);

check('сторона по умолчанию — над галочками',
    DEFAULT_SIDE === 'above',
    DEFAULT_SIDE);

// ------------------------------------------------------------------ итог

console.log(`\nуспешных проверок: ${passed}, провалов: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
