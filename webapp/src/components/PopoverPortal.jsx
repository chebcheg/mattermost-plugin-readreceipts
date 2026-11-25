import React, { useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { place } from '../position';

// Портал окна: элемент в body с фиксированным положением, а содержимое —
// штатный React-портал (createPortal).
//
// Раньше здесь был ReactDOM.render в отдельный корень. В React 19 (Mattermost 12)
// этих функций больше нет, и плагин падал с «Произошла ошибка в плагине» ровно в
// момент открытия окна. createPortal работает и в 17, и в 18, и в 19.
export default function PopoverPortal({children, anchorEl, position, onClose}) {
    const host = useMemo(() => {
        const element = document.createElement('div');
        element.className = 'rr-popover-portal';
        element.style.cssText = 'position:fixed;z-index:9999;left:0;top:0';
        return element;
    }, []);

    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        document.body.appendChild(host);
        return () => {
            if (host.parentNode) host.parentNode.removeChild(host);
        };
    }, [host]);

    useEffect(() => {
        if (!anchorEl) return undefined;

        let frame = 0;

        const reposition = () => {
            frame = 0;
            if (!anchorEl.isConnected) {
                onCloseRef.current();
                return;
            }
            const card = host.firstElementChild;
            if (!card) return;
            const anchor = anchorEl.getBoundingClientRect();
            const target = place(
                {left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height},
                {width: card.offsetWidth, height: card.offsetHeight},
                position,
                {
                    width: document.documentElement.clientWidth,
                    height: document.documentElement.clientHeight,
                },
            );
            host.style.left = `${target.left}px`;
            host.style.top = `${target.top}px`;
        };

        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(reposition);
        };

        schedule();

        let observer = null;
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(schedule);
            observer.observe(host);
        }

        const onKeyDown = (event) => {
            if (event.key === 'Escape') onCloseRef.current();
        };

        window.addEventListener('resize', schedule);
        document.addEventListener('scroll', schedule, true);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            if (frame) cancelAnimationFrame(frame);
            if (observer) observer.disconnect();
            window.removeEventListener('resize', schedule);
            document.removeEventListener('scroll', schedule, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [anchorEl, position, host]);

    return ReactDOM.createPortal(children, host);
}

// Закрытие по клику вне окна: слушаем mousedown на документе и сравниваем с
// якорем и окном.
export function useCloseOnOutside(anchorEl, onClose) {
    useEffect(() => {
        if (!anchorEl) return undefined;
        const handler = (event) => {
            const card = document.querySelector('.rr-popover-portal');
            if (card && card.contains(event.target)) return;
            if (anchorEl.contains(event.target)) return;
            onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [anchorEl, onClose]);
}
