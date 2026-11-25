import React from 'react';
import TicksBlock from './TicksBlock';

// Компонент шапки поста: галочки сразу после отметки времени — как в макете
// Mattermost. Регистрируется через registerPostHeaderComponent, поэтому ничего
// не дописывается в чужой DOM руками.
//
// Шапка есть только у первого сообщения группы; у остальных сообщений галочки
// рисует InlineReadTicks внутри строки самого сообщения.
export default function PostReadReceipt({post}) {
    if (!post) return null;
    return <TicksBlock post={post}/>;
}
