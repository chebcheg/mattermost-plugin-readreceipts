// Геометрия окна со списком читателей.
//
// Функция place() — чистая: на вход прямоугольник галочки, размер окна и размеры
// экрана, на выходе координаты левого верхнего угла. Ни DOM, ни React здесь нет,
// поэтому модуль проверяется отдельным тестом без браузера.
//
// Главное требование к окну: каким бы ни был выбранный в админке угол, окно не
// должно накрывать саму галочку. Прежняя версия считала координаты один раз и
// потом «прижимала» окно к экрану — при нехватке места сверху окно съезжало вниз
// и закрывало галочку. Здесь у каждой стороны есть запасные варианты, а из них
// выбирается тот, который не пересекается с галочкой и не требует сдвига.

export const SIDES = {
    left: ['left', 'right', 'above', 'below'],
    right: ['right', 'left', 'above', 'below'],
    above: ['above', 'below', 'left', 'right'],
    below: ['below', 'above', 'left', 'right'],
};

export const DEFAULT_SIDE = 'above';

// Зазор между галочкой и окном, а также отступ от краёв экрана.
export const GAP = 8;
export const MARGIN = 8;
// Насколько расширить галочку при проверке пересечения: окно не должно не то
// что накрывать её, а даже касаться.
export const ANCHOR_PADDING = 4;

function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function overlapArea(rect, other) {
    const width = Math.min(rect.left + rect.width, other.left + other.width) - Math.max(rect.left, other.left);
    const height = Math.min(rect.top + rect.height, other.top + other.height) - Math.max(rect.top, other.top);
    if (width <= 0 || height <= 0) return 0;
    return width * height;
}

function idealRect(side, anchor, size, gap) {
    const anchorRight = anchor.left + anchor.width;
    const anchorBottom = anchor.top + anchor.height;
    switch (side) {
    case 'right':
        // Справа от галочки, по её нижнему краю.
        return { left: anchorRight + gap, top: anchorBottom - size.height };
    case 'above':
        // Над галочками, по левому краю — как в макете Mattermost.
        return { left: anchor.left, top: anchor.top - size.height - gap };
    case 'below':
        // Под галочками, по левому краю.
        return { left: anchor.left, top: anchorBottom + gap };
    default:
        // Слева от галочки, по её нижнему краю.
        return { left: anchor.left - size.width - gap, top: anchorBottom - size.height };
    }
}

/**
 * Куда поставить окно.
 *
 * @param {{left:number, top:number, width:number, height:number}} anchor — галочка, координаты вьюпорта
 * @param {{width:number, height:number}} size — размер окна
 * @param {string} preferred — выбранная в настройках сторона
 * @param {{width:number, height:number, gap?:number, margin?:number, padding?:number}} viewport
 * @returns {{left:number, top:number, side:string}}
 */
export function place(anchor, size, preferred, viewport) {
    const gap = viewport.gap === undefined ? GAP : viewport.gap;
    const margin = viewport.margin === undefined ? MARGIN : viewport.margin;
    const padding = viewport.padding === undefined ? ANCHOR_PADDING : viewport.padding;
    const maxLeft = viewport.width - margin - size.width;
    const maxTop = viewport.height - margin - size.height;

    const anchorBox = {
        left: anchor.left - padding,
        top: anchor.top - padding,
        width: anchor.width + padding * 2,
        height: anchor.height + padding * 2,
    };

    const order = SIDES[preferred] || SIDES[DEFAULT_SIDE];
    let best = null;

    for (let i = 0; i < order.length; i++) {
        const side = order[i];
        const ideal = idealRect(side, anchor, size, gap);
        const left = clamp(ideal.left, margin, maxLeft);
        const top = clamp(ideal.top, margin, maxTop);
        const shift = Math.abs(left - ideal.left) + Math.abs(top - ideal.top);
        const rect = { left: left, top: top, width: size.width, height: size.height };
        // Пересечение с галочкой — самый дорогой недостаток, сдвиг при
        // прижатии к краю экрана — дешёвый.
        const score = overlapArea(rect, anchorBox) * 1000 + shift;

        if (best === null || score < best.score) {
            best = { side: side, left: left, top: top, score: score };
        }
        if (score === 0) break;
    }

    return { left: Math.round(best.left), top: Math.round(best.top), side: best.side };
}
