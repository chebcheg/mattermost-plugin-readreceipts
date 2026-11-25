package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// Время прочтения должно фиксироваться один раз: LastViewedAt участника
// обновляется при каждом заходе в канал, из-за чего в окне «Прочитали» время
// уезжало вперёд при каждом открытии переписки.
func TestCollectReadersKeepsStoredReadTime(t *testing.T) {
	api := &plugintest.API{}
	defer api.AssertExpectations(t)

	p := &Plugin{}
	p.SetAPI(api)

	members := model.ChannelMembers{
		{UserId: "u1", ChannelId: "ch", LastViewedAt: 5000},
		{UserId: "u2", ChannelId: "ch", LastViewedAt: 9000},
		{UserId: "author", ChannelId: "ch", LastViewedAt: 7000},
	}
	api.On("GetChannelMembers", "ch", 0, 200).Return(members, nil)
	api.On("GetChannelMembers", "ch", 1, 200).Return(model.ChannelMembers{}, nil)

	// u1 прочитал в 3000 — запись уже есть, показываем именно её, а не 5000.
	api.On("KVGet", readKey("p1", "u1")).Return([]byte("3000"), nil)
	// u2 записи не имеет: фиксируем текущее LastViewedAt и дальше не меняем.
	api.On("KVGet", readKey("p1", "u2")).Return([]byte(nil), nil)
	api.On("KVSetWithOptions", readKey("p1", "u2"), []byte("9000"), mock.Anything).Return(true, nil)

	readers, memberCount := p.collectReaders("p1", "ch", 4000, "author")

	require.Equal(t, 2, memberCount, "автор не считается участником")
	require.Len(t, readers, 2)

	byUser := map[string]int64{}
	for _, reader := range readers {
		byUser[reader.userID] = reader.readAt
	}
	require.Equal(t, int64(3000), byUser["u1"], "сохранённое время не должно заменяться на LastViewedAt")
	require.Equal(t, int64(9000), byUser["u2"], "первое наблюдение фиксируется как есть")
}

// Участник, который ещё не открывал канал после публикации, читателем не считается
// и запись о нём не создаётся.
func TestCollectReadersSkipsUnread(t *testing.T) {
	api := &plugintest.API{}
	defer api.AssertExpectations(t)

	p := &Plugin{}
	p.SetAPI(api)

	members := model.ChannelMembers{
		{UserId: "u1", ChannelId: "ch", LastViewedAt: 1000},
	}
	api.On("GetChannelMembers", "ch", 0, 200).Return(members, nil)
	api.On("GetChannelMembers", "ch", 1, 200).Return(model.ChannelMembers{}, nil)
	api.On("KVGet", readKey("p1", "u1")).Return([]byte(nil), nil)

	readers, memberCount := p.collectReaders("p1", "ch", 4000, "author")

	require.Equal(t, 1, memberCount)
	require.Empty(t, readers, "канал открывали до публикации — ещё не прочитано")
}

// Повторный вызов /read не перезаписывает уже зафиксированное время.
func TestMarkReadIsIdempotent(t *testing.T) {
	api := &plugintest.API{}
	defer api.AssertExpectations(t)

	p := &Plugin{}
	p.SetAPI(api)
	p.conf = configuration{ChannelScope: scopeAll}

	post := &model.Post{Id: "p1", ChannelId: "ch", UserId: "author", CreateAt: 1000}
	api.On("GetPost", "p1").Return(post, nil)
	api.On("GetChannel", "ch").Return(&model.Channel{Id: "ch", Type: model.ChannelTypeDirect}, nil)
	api.On("GetChannelMember", "ch", "u1").Return(&model.ChannelMember{ChannelId: "ch", UserId: "u1"}, nil)
	api.On("KVGet", readKey("p1", "u1")).Return([]byte("1500"), nil)

	stored := p.markRead("u1", []string{"p1"})
	require.Zero(t, stored, "запись уже есть — ничего не меняем")
}

// Своё сообщение прочитанным не считается.
func TestMarkReadIgnoresOwnPost(t *testing.T) {
	api := &plugintest.API{}
	defer api.AssertExpectations(t)

	p := &Plugin{}
	p.SetAPI(api)
	p.conf = configuration{ChannelScope: scopeAll}

	api.On("GetPost", "p1").Return(&model.Post{Id: "p1", ChannelId: "ch", UserId: "u1", CreateAt: 1000}, nil)

	stored := p.markRead("u1", []string{"p1"})
	require.Zero(t, stored)
}
