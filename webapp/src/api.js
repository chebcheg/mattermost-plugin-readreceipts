// Клиент API плагина: кэш статусов, подписки и общий опрос.
//
// Одна точка входа на все посты в ленте: каждый пост шапки подписывается на свой
// идентификатор, а опрос идёт одним таймером, а не десятками независимых.

const ENDPOINT = '/plugins/com.mattermost.plugin-readreceipts/api/v1/readers';
const POLL_MS = 15000;
// Галочек в строке сообщения на экране много (по одной на каждое сообщение
// группы), поэтому они обновляются реже и только при видимой вкладке: иначе
// один открытый канал давал бы десяток запросов каждые 15 секунд.
const SLOW_POLL_MS = 60000;
const FRESH_MS = 5000;

const cache = new Map(); // postId -> ответ API
const fetchedAt = new Map(); // postId -> время последнего запроса
const listeners = new Map(); // postId -> Set(колбэк)
const slowListeners = new Map(); // postId -> Set(колбэк) для галочек в строке
const channelEnabled = new Map(); // channelId -> показывать ли статусы в канале
const inFlight = new Map(); // postId -> Promise

let timer = null;
let slowTimer = null;

export function getCachedStatus(postId) {
    return cache.get(postId) || null;
}

export function isChannelEnabled(channelId) {
    return channelEnabled.get(channelId) !== false;
}

function notify(postId, data) {
    const deliver = (set) => {
        if (!set) return;
        set.forEach((callback) => {
            try {
                callback(data);
            } catch (e) {
                console.warn('[read-receipts] ошибка в подписчике', e);
            }
        });
    };
    deliver(listeners.get(postId));
    deliver(slowListeners.get(postId));
}

function parse(data, channelId) {
    if (data && typeof data.enabled === 'boolean') {
        channelEnabled.set(channelId, data.enabled);
    }
    return data;
}

// requestStatus(postId, channelId) — запрос статуса поста. limit не передаём:
// размер страницы задаёт настройка плагина на сервере, иначе она мертва.
export function requestStatus(postId, channelId, force = false) {
    const now = Date.now();
    const cached = cache.get(postId);
    if (!force && cached && now - (fetchedAt.get(postId) || 0) < FRESH_MS) {
        return Promise.resolve(cached);
    }
    if (inFlight.has(postId)) return inFlight.get(postId);

    const url = `${ENDPOINT}?post_id=${encodeURIComponent(postId)}&offset=0`;
    const promise = fetch(url, {credentials: 'same-origin'})
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            if (!data) return null;
            cache.set(postId, parse(data, channelId));
            fetchedAt.set(postId, Date.now());
            notify(postId, cache.get(postId));
            return cache.get(postId);
        })
        .catch((error) => {
            console.warn('[read-receipts] не удалось получить статус', postId, error);
            return null;
        })
        .finally(() => inFlight.delete(postId));

    inFlight.set(postId, promise);
    return promise;
}

// fetchPage — следующая страница списка для окна «Показать ещё».
export function fetchPage(postId, channelId, offset) {
    const url = `${ENDPOINT}?post_id=${encodeURIComponent(postId)}&offset=${offset}`;
    return fetch(url, {credentials: 'same-origin'})
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (data ? parse(data, channelId) : null))
        .catch(() => null);
}

export function subscribeStatus(postId, channelId, callback, slow = false) {
    const registry = slow ? slowListeners : listeners;
    let set = registry.get(postId);
    if (!set) {
        set = new Set();
        registry.set(postId, set);
    }
    set.add(callback);

    const cached = cache.get(postId);
    if (cached) callback(cached);
    requestStatus(postId, channelId);
    if (slow) {
        ensureSlowTimer();
    } else {
        ensureTimer();
    }

    return () => {
        const current = registry.get(postId);
        if (!current) return;
        current.delete(callback);
        if (current.size === 0) registry.delete(postId);
        if (slow) {
            if (slowListeners.size === 0) stopSlowTimer();
        } else if (listeners.size === 0) {
            stopTimer();
        }
    };
}

function ensureTimer() {
    if (timer || listeners.size === 0) return;
    timer = setInterval(() => {
        listeners.forEach((_set, postId) => {
            const data = cache.get(postId);
            // Канал вне области показа: не дёргаем сервер впустую.
            if (data && data.enabled === false) return;
            requestStatus(postId, null, true);
        });
    }, POLL_MS);
}

function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}

// Отдельный, редкий опрос для галочек в строке сообщения: их на экране много,
// и общий 15-секундный таймер дал бы десяток лишних запросов на каждую ленту.
// Скрытая вкладка не опрашивается вовсе.
function ensureSlowTimer() {
    if (slowTimer || slowListeners.size === 0) return;
    slowTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        slowListeners.forEach((_set, postId) => {
            const data = cache.get(postId);
            if (data && data.enabled === false) return;
            requestStatus(postId, null, true);
        });
    }, SLOW_POLL_MS);
}

function stopSlowTimer() {
    if (!slowTimer) return;
    clearInterval(slowTimer);
    slowTimer = null;
}

// --- фиксация первого прочтения -------------------------------------------

const READ_ENDPOINT = '/plugins/com.mattermost.plugin-readreceipts/api/v1/read';
const READ_FLUSH_MS = 700;
const READ_MAX_BATCH = 100;

const readSent = new Set(); // посты, о которых уже сообщили в этой сессии
const readPending = new Set();
let readTimer = null;

// markRead сообщает серверу, что сообщение только что показано этому
// пользователю. Сервер записывает время лишь однажды, поэтому повторные вызовы
// безопасны; readSent нужен только чтобы не гонять лишние запросы.
export function markRead(postId) {
    if (!postId || readSent.has(postId) || readPending.has(postId)) return;
    readPending.add(postId);
    if (readTimer) return;
    readTimer = setTimeout(flushRead, READ_FLUSH_MS);
}

function flushRead() {
    readTimer = null;
    const ids = Array.from(readPending).slice(0, READ_MAX_BATCH);
    if (ids.length === 0) return;
    ids.forEach((id) => readPending.delete(id));

    fetch(READ_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({post_ids: ids}),
    }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        ids.forEach((id) => readSent.add(id));
    }).catch(() => {
        ids.forEach((id) => readPending.add(id));
    }).then(() => {
        if (readPending.size > 0 && !readTimer) {
            readTimer = setTimeout(flushRead, READ_FLUSH_MS * 3);
        }
    });
}
