import React, {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import TicksBlock from './TicksBlock';
import {getStore} from '../store';

// Галочки у сообщений, которые идут в группе после первого.
//
// Mattermost склеивает подряд идущие сообщения одного автора в одну группу:
// шапка (автор, время, наши галочки из registerPostHeaderComponent) есть только
// у первого сообщения. У остальных сообщений шапки нет, поэтому их статус
// прочтения нигде не виден.
//
// Здесь мы находим такие посты в ленте и дорисовываем галочки прямо в строку
// сообщения — в конец последнего абзаца текста, как в мессенджерах. Первое
// сообщение группы не трогаем: у него галочки уже в шапке.
//
// Почему портал, а не «свой» пост-хук: отдельного хука для «каждого поста»
// в API плагинов нет (registerPostHeaderComponent рисует только шапку,
// registerPostActionComponent — кнопку в панели действий при наведении).
export default function InlineReadTicks() {
    const [entries, setEntries] = useState([]);
    const [runtime] = useState(() => ({
        observer: null,
        visible: new Set(),
        watched: new WeakSet(),
        frame: 0,
    }));

    useEffect(() => {
        const schedule = () => {
            if (runtime.frame) return;
            runtime.frame = requestAnimationFrame(() => {
                runtime.frame = 0;
                collect();
            });
        };

        const collect = () => {
            const posts = document.querySelectorAll('.post[id^="post_"]');
            const next = [];

            posts.forEach((element) => {
                const id = element.id.slice('post_'.length);
                if (!id) return;

                // У первого сообщения группы шапка видима — там галочки уже
                // рисует компонент шапки. У остальных сообщений группы шапка
                // в DOM есть, но схлопнута в ноль по высоте.
                const header = element.querySelector('.post__header');
                const headerVisible = Boolean(header) && header.getBoundingClientRect().height > 0;
                if (headerVisible) {
                    removeHolder(element);
                    return;
                }

                if (!runtime.watched.has(element)) {
                    element.dataset.rrPostId = id;
                    if (runtime.observer) runtime.observer.observe(element);
                    runtime.watched.add(element);
                }

                if (!runtime.visible.has(id)) return;

                let holder = element.querySelector('.rr-inline-holder');
                if (!holder) {
                    const host = findHost(element);
                    if (!host) return;
                    holder = document.createElement('span');
                    holder.className = 'rr-inline-holder';
                    host.appendChild(holder);
                }
                next.push({id, el: holder});
            });

            setEntries((prev) => {
                if (prev.length === next.length &&
                    prev.every((item, index) => item.id === next[index].id && item.el === next[index].el)) {
                    return prev;
                }
                return next;
            });
        };

        runtime.observer = new IntersectionObserver((items) => {
            let changed = false;
            items.forEach((item) => {
                const id = item.target.dataset.rrPostId;
                if (!id) return;
                if (item.isIntersecting) {
                    if (!runtime.visible.has(id)) {
                        runtime.visible.add(id);
                        changed = true;
                    }
                } else if (runtime.visible.delete(id)) {
                    changed = true;
                }
            });
            if (changed) schedule();
        }, {rootMargin: '250px 0px'});

        const mutationObserver = new MutationObserver(schedule);
        mutationObserver.observe(document.body, {childList: true, subtree: true});
        schedule();

        return () => {
            mutationObserver.disconnect();
            if (runtime.observer) runtime.observer.disconnect();
            if (runtime.frame) cancelAnimationFrame(runtime.frame);
        };
    }, [runtime]);

    return (
        <>
            {entries.map(({id, el}) => createPortal(
                <InlineTicksForPost postId={id}/>,
                el,
                id,
            ))}
        </>
    );
}

function InlineTicksForPost({postId}) {
    const [post, setPost] = useState(() => lookupPost(postId));

    useEffect(() => {
        if (post) return undefined;
        const store = getStore();
        if (!store || typeof store.subscribe !== 'function') return undefined;
        const unsubscribe = store.subscribe(() => {
            const found = lookupPost(postId);
            if (found) setPost(found);
        });
        return unsubscribe;
    }, [post, postId]);

    if (!post) return null;
    return <TicksBlock post={post} inline/>;
}

function lookupPost(postId) {
    const store = getStore();
    if (!store) return null;
    const state = store.getState();
    const posts = (state.entities && state.entities.posts && state.entities.posts.posts) || {};
    return posts[postId] || null;
}

function removeHolder(element) {
    const holder = element.querySelector('.rr-inline-holder');
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
}

// Куда вставить галочки: в конец последнего абзаца текста сообщения, чтобы они
// шли в строку, а не отдельным блоком. Если сообщение заканчивается списком,
// таблицей или кодом, галочки ставим отдельной строкой под всем блоком — внутрь
// <ul>/<pre> вставлять нельзя.
function findHost(element) {
    const text = element.querySelector('.post-message__text');
    if (!text) return null;

    const blocks = Array.from(text.children).filter((child) => child.offsetParent !== null || child.tagName === 'P');
    const last = blocks[blocks.length - 1];

    if (last && last.tagName === 'P') {
        return last;
    }
    return text;
}
