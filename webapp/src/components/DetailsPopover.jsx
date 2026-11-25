import React, {useState} from 'react';
import TicksIcon from './TicksIcon';
import {fetchPage} from '../api';
import {formatReadTime, getAvatarColor, getDisplayName, getInitials, openDirectMessage} from '../utils';

// Окно в стиле официального макета Mattermost:
//   личные — две строки «Прочитано — сегодня 16:47» и «Отправлено — 16:45»;
//   группы и каналы — заголовок «Прочитали N из M» и список с временем.
export default function DetailsPopover({post, data}) {
    const [readers, setReaders] = useState(Array.isArray(data.readers) ? data.readers : []);
    const [hasMore, setHasMore] = useState(Boolean(data.has_more));
    const [loading, setLoading] = useState(false);

    const isDirect = data.channel_type === 'D';
    const total = data.total_count || 0;
    const memberCount = data.member_count || 0;
    const format = data.display_name_format || 'fullname';

    function loadMore() {
        setLoading(true);
        fetchPage(post.id, post.channel_id, readers.length)
            .then((page) => {
                if (!page) return;
                setReaders((prev) => [...prev, ...(page.readers || [])]);
                setHasMore(Boolean(page.has_more));
            })
            .finally(() => setLoading(false));
    }

    if (isDirect) {
        const reader = readers[0];
        return (
            <div className="rr-card" role="dialog" aria-label="Статус сообщения">
                {reader ? (
                    <div className="rr-row">
                        <TicksIcon state="read"/>
                        <span className="rr-row-label">Прочитано</span>
                        <span className="rr-row-time">{formatReadTime(reader.read_at)}</span>
                    </div>
                ) : (
                    <div className="rr-row rr-row--muted">
                        <TicksIcon state="sent"/>
                        <span className="rr-row-label">Ещё не прочитано</span>
                    </div>
                )}
                <div className="rr-row">
                    <TicksIcon state="sent"/>
                    <span className="rr-row-label">Отправлено</span>
                    <span className="rr-row-time">{formatReadTime(post.create_at)}</span>
                </div>
            </div>
        );
    }

    const title = memberCount > 0 ? `Прочитали ${total} из ${memberCount}` : `Прочитали (${total})`;

    return (
        <div className="rr-card" role="dialog" aria-label="Список прочитавших">
            <div className="rr-card-head">
                <TicksIcon state={total > 0 ? 'read' : 'sent'}/>
                <span className="rr-card-title">{total > 0 ? title : 'Пока никто не прочитал'}</span>
            </div>
            {readers.length > 0 && (
                <div className="rr-readers">
                    {readers.map((reader) => (
                        <button
                            type="button"
                            className="rr-reader"
                            key={reader.id}
                            onClick={() => openDirectMessage(reader.id, reader.username)}
                            title="Написать в личные сообщения"
                        >
                            <ReaderAvatar reader={reader}/>
                            <span className="rr-reader-name">{getDisplayName(reader, format)}</span>
                            <span className="rr-row-time">{formatReadTime(reader.read_at)}</span>
                        </button>
                    ))}
                </div>
            )}
            {hasMore && (
                <button type="button" className="rr-more" onClick={loadMore} disabled={loading}>
                    {loading ? 'Загрузка…' : `Показать ещё (${Math.max(total - readers.length, 0)})`}
                </button>
            )}
        </div>
    );
}

function ReaderAvatar({reader}) {
    const style = {backgroundColor: getAvatarColor(reader.id)};
    if (reader.last_picture_update > 0) {
        return (
            <span className="rr-avatar">
                <img
                    src={`/api/v4/users/${reader.id}/image?_=${reader.last_picture_update}`}
                    alt=""
                />
            </span>
        );
    }
    return (
        <span className="rr-avatar" style={style}>
            {getInitials(reader.username)}
        </span>
    );
}
