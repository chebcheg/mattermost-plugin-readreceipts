import React, {useEffect, useRef, useState} from 'react';
import TicksIcon from './TicksIcon';
import PopoverPortal, {useCloseOnOutside} from './PopoverPortal';
import DetailsPopover from './DetailsPopover';
import {getCachedStatus, markRead, subscribeStatus} from '../api';
import {getStore} from '../store';

// Галочки и окно статусов для одного поста.
//
// Один и тот же блок используется в двух местах:
//   * в шапке поста (registerPostHeaderComponent) — у первого сообщения группы;
//   * внутри самого сообщения (см. InlineReadTicks) — у остальных сообщений
//     группы, у которых шапки нет.
//
// Логика (подписка на статус, фиксация первого прочтения, оформление) живёт
// здесь одна, чтобы два места не расходились в поведении.
export default function TicksBlock({post, inline = false}) {
    const postId = post ? post.id : null;
    const channelId = post ? post.channel_id : null;
    const [data, setData] = useState(() => (postId ? getCachedStatus(postId) : null));
    const [open, setOpen] = useState(false);
    const anchorRef = useRef(null);

    useEffect(() => {
        if (!postId) {
            setData(null);
            return undefined;
        }
        setData(getCachedStatus(postId));
        return subscribeStatus(postId, channelId, setData, inline);
    }, [postId, channelId]);

    // Первое появление сообщения у получателя — это и есть время прочтения.
    // Сервер фиксирует его однажды и больше не меняет (LastViewedAt участника,
    // наоборот, обновляется при каждом заходе в канал).
    useEffect(() => {
        if (!post || !post.id) return;
        const store = getStore();
        const me = store && store.getState().entities.users.currentUserId;
        if (!me || post.user_id === me) return;
        markRead(post.id);
    }, [post && post.id, post && post.user_id]);

    const close = () => setOpen(false);
    useCloseOnOutside(open ? anchorRef.current : null, close);

    if (!postId || !data || !data.enabled) return null;

    const total = data.total_count || 0;
    const read = total > 0;
    const memberCount = data.member_count || 0;
    let title = 'Ещё не прочитано';
    if (read) {
        title = memberCount > 0 ? `Прочитали ${total} из ${memberCount}` : `Прочитали: ${total}`;
    }

    const className = ['rr-ticks', read ? 'rr-ticks--read' : '', inline ? 'rr-ticks--inline' : '']
        .filter(Boolean)
        .join(' ');

    return (
        <>
            <button
                type="button"
                ref={anchorRef}
                className={className}
                title={title}
                aria-label={title}
                aria-expanded={open}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen((value) => !value);
                }}
            >
                <TicksIcon state={read ? 'read' : 'sent'} size={inline ? 15 : 17}/>
                {total > 1 && <span className="rr-ticks-count">{total}</span>}
            </button>
            {open && (
                <PopoverPortal
                    anchorEl={anchorRef.current}
                    position={inline ? 'right' : (data.popup_position || 'left')}
                    onClose={close}
                >
                    <DetailsPopover post={post} data={data}/>
                </PopoverPortal>
            )}
        </>
    );
}
