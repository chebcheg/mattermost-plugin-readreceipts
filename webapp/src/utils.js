import { getStore } from './store';

const AVATAR_COLORS = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd',
    '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1',
    '#4db6ac', '#81c784', '#aed581', '#ffd54f',
    '#ffb74d', '#ff8a65', '#a1887f', '#90a4ae',
];

export function getAvatarColor(userId) {
    let hash = 0;
    const value = userId || '';
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function getInitials(username) {
    if (!username) return '?';
    return username.charAt(0).toUpperCase();
}

export function getDisplayName(user, format) {
    if (!user) return '';
    const firstName = (user.first_name || '').trim();
    const lastName = (user.last_name || '').trim();
    if (format === 'username') return user.username || '';
    if (format === 'nickname') return user.nickname || user.username || '';
    const full = `${firstName} ${lastName}`.trim();
    if (full) return full;
    return user.nickname || user.username || '';
}

// formatReadTime — «сегодня 16:47», «вчера 16:47», «12.10 16:47»: как в макете
// Mattermost («today 4:47pm»), только по-русски и в 24-часовом виде.
export function formatReadTime(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';

    const time = date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayDiff = Math.round((startOfToday - startOfDate) / 86400000);

    if (dayDiff === 0) return `сегодня ${time}`;
    if (dayDiff === 1) return `вчера ${time}`;

    const day = date.toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit'});
    return `${day} ${time}`;
}

export function getPostFromStore(postId) {
    const store = getStore();
    if (!store || !postId) return null;
    const state = store.getState();
    const posts = state.entities && state.entities.posts && state.entities.posts.posts;
    return (posts && posts[postId]) || null;
}

export function openDirectMessage(userId, username) {
    const store = getStore();
    if (!store) {
        const teamName = window.location.pathname.split('/')[1];
        if (teamName && username) window.location.href = `/${teamName}/messages/${username}`;
        return;
    }
    const state = store.getState();
    const currentUserId = state.entities && state.entities.users && state.entities.users.currentUserId;
    const teamId = state.entities && state.entities.teams && state.entities.teams.currentTeamId;
    const team = state.entities && state.entities.teams && state.entities.teams.teams && state.entities.teams.teams[teamId];
    if (!currentUserId || !team) {
        const teamName = window.location.pathname.split('/')[1];
        if (teamName && username) window.location.href = `/${teamName}/messages/${username}`;
        return;
    }
    const csrfMatch = document.cookie.match(/(?:^|;\s*)MMCSRF=([^;]+)/);
    const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
    fetch('/api/v4/channels/direct', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-Token': csrf,
        },
        body: JSON.stringify([currentUserId, userId]),
    })
        .then((res) => (res.ok ? res.json() : null))
        .then((channel) => {
            if (channel && channel.id) {
                window.location.href = `/${team.name}/channels/${channel.id}`;
            }
        })
        .catch(() => {});
}
