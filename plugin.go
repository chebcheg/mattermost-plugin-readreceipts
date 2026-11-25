package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"sync"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin

	confMu sync.RWMutex
	conf   configuration
}

// Ключи json обязаны совпадать с ключами из settings_schema в plugin.json
// посимвольно: Go сопоставляет их без учёта регистра, но подчёркивания значимы,
// поэтому тег popup_position не совпал бы с ключом PopupPosition и настройка
// молча оставалась бы значением по умолчанию.
type configuration struct {
	DisplayLimit      int    `json:"DisplayLimit"`
	DisplayNameFormat string `json:"DisplayNameFormat"`
	PopupPosition     string `json:"PopupPosition"`
	// ChannelScope: "all" — показывать во всех каналах, "direct" — только в
	// личных и групповых (как в дизайне Mattermost).
	ChannelScope string `json:"ChannelScope"`
}

const (
	defaultDisplayLimit      = 10
	defaultDisplayNameFormat = "fullname"
	defaultPopupPosition     = "above"
	maxDisplayLimit          = 100

	scopeAll    = "all"
	scopeDirect = "direct"
)

var (
	allowedDisplayNameFormats = map[string]bool{"fullname": true, "nickname": true, "username": true}
	// Порядок списка задаёт приоритет при выборе места: если окно списка не
	// помещается с запрошенной стороны, веб-часть пробует следующую.
	allowedPopupPositions = map[string]bool{"left": true, "right": true, "above": true, "below": true}
	allowedChannelScopes  = map[string]bool{scopeAll: true, scopeDirect: true}
)

func (p *Plugin) getConfig() configuration {
	p.confMu.RLock()
	defer p.confMu.RUnlock()
	return p.conf
}

// readerView — то, что уходит в браузер. Свой тип, а не model.User: плагинный
// GetUsersByIds профили не очищает, и полный профиль выносит в канал почту,
// роли, auth_service и остальное. Здесь только то, что нужно окну со списком.
type readerView struct {
	Id                string `json:"id"`
	Username          string `json:"username"`
	Nickname          string `json:"nickname"`
	FirstName         string `json:"first_name"`
	LastName          string `json:"last_name"`
	LastPictureUpdate int64  `json:"last_picture_update"`
	// ReadAt — когда участник последний раз открывал канал (мс). Это то же
	// время, по которому он попал в список прочитавших.
	ReadAt int64 `json:"read_at"`
}

type ReadersResponse struct {
	Readers     []readerView `json:"readers"`
	TotalCount  int          `json:"total_count"`
	MemberCount int          `json:"member_count"`
	HasMore     bool         `json:"has_more"`
	ChannelType string       `json:"channel_type"`
	// Enabled — показывать ли статусы в этом канале с учётом настройки области.
	Enabled           bool   `json:"enabled"`
	DisplayNameFormat string `json:"display_name_format"`
	PopupPosition     string `json:"popup_position"`
}

type apiError struct {
	Error string `json:"error"`
}

func (p *Plugin) OnConfigurationChange() error {
	var cfg configuration
	if err := p.API.LoadPluginConfiguration(&cfg); err != nil {
		return err
	}
	cfg = normalizeConfig(cfg)
	p.confMu.Lock()
	p.conf = cfg
	p.confMu.Unlock()
	return nil
}

// normalizeConfig приводит настройки к допустимым значениям: пустое или
// неизвестное значение из консоли администратора не должно уезжать в браузер.
func normalizeConfig(cfg configuration) configuration {
	if cfg.DisplayLimit <= 0 {
		cfg.DisplayLimit = defaultDisplayLimit
	}
	if cfg.DisplayLimit > maxDisplayLimit {
		cfg.DisplayLimit = maxDisplayLimit
	}
	if !allowedDisplayNameFormats[cfg.DisplayNameFormat] {
		cfg.DisplayNameFormat = defaultDisplayNameFormat
	}
	if !allowedPopupPositions[cfg.PopupPosition] {
		cfg.PopupPosition = defaultPopupPosition
	}
	if !allowedChannelScopes[cfg.ChannelScope] {
		cfg.ChannelScope = scopeAll
	}
	return cfg
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	switch r.URL.Path {
	case "/api/v1/readers":
		p.handleGetReaders(w, r)
	case "/api/v1/read":
		p.handleMarkRead(w, r)
	default:
		http.NotFound(w, r)
	}
}

func writeAPIError(w http.ResponseWriter, msg string, code int) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(apiError{Error: msg})
}

func (p *Plugin) handleGetReaders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeAPIError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		writeAPIError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	postID := r.URL.Query().Get("post_id")
	if postID == "" {
		writeAPIError(w, "post_id is required", http.StatusBadRequest)
		return
	}

	post, appErr := p.API.GetPost(postID)
	if appErr != nil {
		writeAPIError(w, "post not found", http.StatusNotFound)
		return
	}

	if _, appErr = p.API.GetChannelMember(post.ChannelId, userID); appErr != nil {
		writeAPIError(w, "access denied", http.StatusForbidden)
		return
	}

	conf := p.getConfig()
	channel, appErr := p.API.GetChannel(post.ChannelId)
	if appErr != nil {
		writeAPIError(w, "channel not found", http.StatusNotFound)
		return
	}

	response := ReadersResponse{
		Readers:           []readerView{},
		ChannelType:       string(channel.Type),
		Enabled:           channelScopeAllows(conf.ChannelScope, string(channel.Type)),
		DisplayNameFormat: conf.DisplayNameFormat,
		PopupPosition:     conf.PopupPosition,
	}
	// Канал вне области показа: не перебираем участников вообще, отдаём только
	// признак «здесь не показывать» — веб-часть по нему не рисует иконку.
	if !response.Enabled {
		json.NewEncoder(w).Encode(response)
		return
	}

	limit := readIntParam(r, "limit", conf.DisplayLimit, 1, maxDisplayLimit)
	offset := readIntParam(r, "offset", 0, 0, 1<<30)

	readers, memberCount := p.collectReaders(post.Id, post.ChannelId, post.CreateAt, post.UserId)
	response.MemberCount = memberCount

	// Сортировка по времени прочтения (свежие сверху) до нарезки страницы:
	// иначе «Показать ещё» дописывает имена не в том порядке.
	sortReaders(readers)

	response.TotalCount = len(readers)
	if offset >= len(readers) {
		json.NewEncoder(w).Encode(response)
		return
	}

	end := offset + limit
	if end > len(readers) {
		end = len(readers)
	}
	page := readers[offset:end]
	response.HasMore = end < len(readers)
	response.Readers = p.resolveReaders(page)

	json.NewEncoder(w).Encode(response)
}

func readIntParam(r *http.Request, name string, fallback, min, max int) int {
	value := fallback
	if raw := r.URL.Query().Get(name); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= min {
			value = parsed
		}
	}
	if value < min {
		value = min
	}
	if value > max {
		value = max
	}
	return value
}

// channelScopeAllows: показывать ли статусы в канале этого типа.
func channelScopeAllows(scope, channelType string) bool {
	if scope == scopeDirect {
		return channelType == string(model.ChannelTypeDirect) || channelType == string(model.ChannelTypeGroup)
	}
	return true
}

type memberRead struct {
	userID string
	readAt int64
}

// sortReaders: свежие прочтения сверху, при равном времени — по идентификатору,
// чтобы порядок был устойчивым между страницами.
func sortReaders(readers []memberRead) {
	sort.Slice(readers, func(i, j int) bool {
		if readers[i].readAt != readers[j].readAt {
			return readers[i].readAt > readers[j].readAt
		}
		return readers[i].userID < readers[j].userID
	})
}

// collectReaders обходит участников канала и возвращает тех, кто открывал канал
// после публикации поста, вместе с общим числом участников (без автора).
func (p *Plugin) collectReaders(postID, channelID string, postCreateAt int64, authorID string) ([]memberRead, int) {
	const perPage = 200

	var readers []memberRead
	memberCount := 0

	for page := 0; ; page++ {
		members, appErr := p.API.GetChannelMembers(channelID, page, perPage)
		if appErr != nil {
			// Ошибка — не «участники кончились»: без записи в лог заниженный
			// счётчик выглядит как пустая переписка.
			p.API.LogError("failed to list channel members",
				"channel_id", channelID, "page", strconv.Itoa(page), "error", appErr.Error())
			return readers, memberCount
		}
		if len(members) == 0 {
			return readers, memberCount
		}
		for _, member := range members {
			if member.UserId == authorID {
				continue
			}
			memberCount++

			// Время прочтения фиксируем один раз. LastViewedAt у участника
			// обновляется при каждом заходе в канал, поэтому раньше время
			// «уезжало» вперёд при каждом открытии переписки.
			if readAt, ok := p.storedReadAt(postID, member.UserId); ok {
				readers = append(readers, memberRead{userID: member.UserId, readAt: readAt})
				continue
			}
			if member.LastViewedAt >= postCreateAt {
				p.storeReadAt(postID, member.UserId, member.LastViewedAt)
				readers = append(readers, memberRead{userID: member.UserId, readAt: member.LastViewedAt})
			}
		}
	}
}

// timeReadRecord — сколько храним зафиксированное время прочтения.
const readRecordTTL = int64(180 * 24 * 60 * 60)

func readKey(postID, userID string) string {
	return "read:" + postID + ":" + userID
}

// storedReadAt возвращает зафиксированное время первого прочтения.
func (p *Plugin) storedReadAt(postID, userID string) (int64, bool) {
	value, appErr := p.API.KVGet(readKey(postID, userID))
	if appErr != nil || len(value) == 0 {
		return 0, false
	}
	millis, err := strconv.ParseInt(string(value), 10, 64)
	if err != nil || millis <= 0 {
		return 0, false
	}
	return millis, true
}

func (p *Plugin) storeReadAt(postID, userID string, readAt int64) {
	_, appErr := p.API.KVSetWithOptions(
		readKey(postID, userID),
		[]byte(strconv.FormatInt(readAt, 10)),
		model.PluginKVSetOptions{ExpireInSeconds: readRecordTTL},
	)
	if appErr != nil {
		p.API.LogWarn("failed to store first read time",
			"post_id", postID, "user_id", userID, "error", appErr.Error())
	}
}

// markRead фиксирует время первого прочтения для перечисленных постов и
// возвращает число новых записей. Идемпотентен.
func (p *Plugin) markRead(userID string, postIDs []string) int {
	conf := p.getConfig()
	now := model.GetMillis()
	stored := 0

	for _, postID := range postIDs {
		post, appErr := p.API.GetPost(postID)
		if appErr != nil {
			continue
		}
		// Своё сообщение прочитанным не считается.
		if post.UserId == userID {
			continue
		}
		channel, appErr := p.API.GetChannel(post.ChannelId)
		if appErr != nil || !channelScopeAllows(conf.ChannelScope, string(channel.Type)) {
			continue
		}
		if _, appErr := p.API.GetChannelMember(post.ChannelId, userID); appErr != nil {
			continue
		}
		if _, ok := p.storedReadAt(postID, userID); ok {
			continue
		}

		readAt := now
		if post.CreateAt > readAt {
			readAt = post.CreateAt
		}
		p.storeReadAt(postID, userID, readAt)
		stored++
	}

	return stored
}

type markReadRequest struct {
	PostIDs []string `json:"post_ids"`
}

// handleMarkRead принимает от клиента сообщения, которые пользователь только что
// увидел, и фиксирует время первого показа. Записи идемпотентны: повторный вызов
// для того же поста ничего не меняет.
func (p *Plugin) handleMarkRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAPIError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		writeAPIError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req markReadRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeAPIError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if len(req.PostIDs) == 0 {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"stored": 0})
		return
	}
	if len(req.PostIDs) > 200 {
		writeAPIError(w, "too many posts", http.StatusBadRequest)
		return
	}

	stored := p.markRead(userID, req.PostIDs)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"stored": stored})
}

// resolveReaders превращает идентификаторы страницы в минимальные профили,
// сохраняя порядок страницы (GetUsersByIds порядок не гарантирует).
func (p *Plugin) resolveReaders(page []memberRead) []readerView {
	views := make([]readerView, 0, len(page))
	if len(page) == 0 {
		return views
	}

	ids := make([]string, 0, len(page))
	for _, item := range page {
		ids = append(ids, item.userID)
	}

	users, appErr := p.API.GetUsersByIds(ids)
	if appErr != nil {
		p.API.LogError("failed to get users by ids", "error", appErr.Error())
		return views
	}

	byID := make(map[string]*model.User, len(users))
	for _, user := range users {
		byID[user.Id] = user
	}

	for _, item := range page {
		user, ok := byID[item.userID]
		if !ok {
			continue
		}
		views = append(views, readerView{
			Id:                user.Id,
			Username:          user.Username,
			Nickname:          user.Nickname,
			FirstName:         user.FirstName,
			LastName:          user.LastName,
			LastPictureUpdate: user.LastPictureUpdate,
			ReadAt:            item.readAt,
		})
	}
	return views
}
