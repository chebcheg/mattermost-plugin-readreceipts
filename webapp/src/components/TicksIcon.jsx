import React from 'react';

// Галочки как в дизайне Mattermost: одна серая — сообщение на сервере, две
// синие — прочитано. Рисуются SVG, а не текстовыми символами: у шрифтов разная
// ширина и «✓✓» разъезжается в разных системах.
export default function TicksIcon({state = 'sent', size = 17}) {
    const read = state === 'read';
    const className = `rr-ticks-icon${read ? ' rr-ticks-icon--read' : ''}`;

    return (
        <svg
            className={className}
            width={size}
            height={size * 0.65}
            viewBox="0 0 17 11"
            fill="none"
            aria-hidden="true"
        >
            <path
                d="M1 6.2 L4.3 9.4 L10.2 2"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {read && (
                <path
                    d="M6.4 6.2 L9.7 9.4 L15.8 2"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
        </svg>
    );
}
