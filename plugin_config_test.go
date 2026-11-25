package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

// Ключи настроек из plugin.json должны доходить до структуры configuration.
//
// Это регрессионный тест на ошибку, из-за которой настройки «Формат отображения
// имени» и «Позиция окна списка» не применялись: json-теги были записаны через
// подчёркивания (display_name_format), а ключи в манифесте — в CamelCase
// (DisplayNameFormat). Go сопоставляет их без учёта регистра, но подчёркивания
// значимы, поэтому поля молча оставались пустыми и плагин подставлял значения по
// умолчанию, хотя в консоли администратора настройка выглядела сохранённой.
func TestConfigurationKeysFromPluginJSON(t *testing.T) {
	var manifest struct {
		SettingsSchema struct {
			Settings []struct {
				Key string `json:"key"`
			} `json:"settings"`
		} `json:"settings_schema"`
	}

	raw, err := os.ReadFile("plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.SettingsSchema.Settings) == 0 {
		t.Fatal("в plugin.json не найдено ни одной настройки")
	}

	// Значения, которые администратор мог бы выставить в консоли.
	values := map[string]string{
		"ChannelScope":      `"direct"`,
		"DisplayLimit":      `42`,
		"DisplayNameFormat": `"username"`,
		"PopupPosition":     `"above"`,
	}

	payload := "{"
	for i, setting := range manifest.SettingsSchema.Settings {
		value, ok := values[setting.Key]
		if !ok {
			t.Fatalf("настройка %q есть в plugin.json, но тест про неё не знает", setting.Key)
		}
		if i > 0 {
			payload += ","
		}
		payload += `"` + setting.Key + `":` + value
	}
	payload += "}"

	var cfg configuration
	if err := json.Unmarshal([]byte(payload), &cfg); err != nil {
		t.Fatal(err)
	}
	t.Logf("админка прислала: %s", payload)
	t.Logf("плагин получил:   scope=%q limit=%d format=%q position=%q",
		cfg.ChannelScope, cfg.DisplayLimit, cfg.DisplayNameFormat, cfg.PopupPosition)

	if cfg.ChannelScope != scopeDirect {
		t.Errorf("ChannelScope не дошёл до структуры: получено %q", cfg.ChannelScope)
	}
	if cfg.DisplayLimit != 42 {
		t.Errorf("DisplayLimit не дошёл до структуры: получено %d", cfg.DisplayLimit)
	}
	if cfg.DisplayNameFormat != "username" {
		t.Errorf("DisplayNameFormat не дошёл до структуры: получено %q", cfg.DisplayNameFormat)
	}
	if cfg.PopupPosition != "above" {
		t.Errorf("PopupPosition не дошёл до структуры: получено %q", cfg.PopupPosition)
	}
}

// Некорректное значение настройки не должно уезжать в браузер.
func TestOnConfigurationChangeDefaults(t *testing.T) {
	cases := []struct {
		name             string
		raw              string
		wantLimit        int
		wantNameFormat   string
		wantPopupPostion string
		wantScope        string
	}{
		{"пустая конфигурация", `{}`, defaultDisplayLimit, defaultDisplayNameFormat, defaultPopupPosition, scopeAll},
		{"мусор в списках", `{"DisplayLimit":-5,"DisplayNameFormat":"ФИО","PopupPosition":"сверху","ChannelScope":"только-лс"}`,
			defaultDisplayLimit, defaultDisplayNameFormat, defaultPopupPosition, scopeAll},
		{"значения из консоли", `{"DisplayLimit":25,"DisplayNameFormat":"nickname","PopupPosition":"below","ChannelScope":"direct"}`,
			25, "nickname", "below", scopeDirect},
		{"лимит сверх предела", `{"DisplayLimit":1000}`, maxDisplayLimit, defaultDisplayNameFormat, defaultPopupPosition, scopeAll},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var cfg configuration
			if err := json.Unmarshal([]byte(tc.raw), &cfg); err != nil {
				t.Fatal(err)
			}
			got := normalizeConfig(cfg)
			if got.DisplayLimit != tc.wantLimit {
				t.Errorf("DisplayLimit = %d, ожидалось %d", got.DisplayLimit, tc.wantLimit)
			}
			if got.DisplayNameFormat != tc.wantNameFormat {
				t.Errorf("DisplayNameFormat = %q, ожидалось %q", got.DisplayNameFormat, tc.wantNameFormat)
			}
			if got.PopupPosition != tc.wantPopupPostion {
				t.Errorf("PopupPosition = %q, ожидалось %q", got.PopupPosition, tc.wantPopupPostion)
			}
			if got.ChannelScope != tc.wantScope {
				t.Errorf("ChannelScope = %q, ожидалось %q", got.ChannelScope, tc.wantScope)
			}
		})
	}
}

// Область показа: «только ЛС и группы» не прячет статусы в личных и групповых
// каналах и прячет их в обычных.
func TestChannelScopeAllows(t *testing.T) {
	cases := []struct {
		scope   string
		channel string
		want    bool
	}{
		{scopeAll, string(model.ChannelTypeDirect), true},
		{scopeAll, string(model.ChannelTypeGroup), true},
		{scopeAll, string(model.ChannelTypeOpen), true},
		{scopeAll, string(model.ChannelTypePrivate), true},
		{scopeDirect, string(model.ChannelTypeDirect), true},
		{scopeDirect, string(model.ChannelTypeGroup), true},
		{scopeDirect, string(model.ChannelTypeOpen), false},
		{scopeDirect, string(model.ChannelTypePrivate), false},
	}
	for _, tc := range cases {
		if got := channelScopeAllows(tc.scope, tc.channel); got != tc.want {
			t.Errorf("scope=%s channel=%s: получено %v, ожидалось %v", tc.scope, tc.channel, got, tc.want)
		}
	}
}

// В ответ уходит минимальный профиль: почта, роли и auth_service не должны
// покидать сервер (плагинный GetUsersByIds профили не очищает).
func TestReaderViewHasNoPrivateFields(t *testing.T) {
	raw, err := json.Marshal(readerView{
		Id: "abc", Username: "ivanov", Nickname: "Иванов",
		FirstName: "Иван", LastName: "Иванов", LastPictureUpdate: 1, ReadAt: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"email", "roles", "auth_service", "password", "position", "timezone"} {
		if strings.Contains(string(raw), forbidden) {
			t.Errorf("в JSON профиля попало поле %q: %s", forbidden, raw)
		}
	}
}

// Порядок «свежие прочтения сверху» должен определяться до нарезки на страницы.
func TestReaderOrderBeforePaging(t *testing.T) {
	readers := []memberRead{
		{userID: "b", readAt: 100},
		{userID: "a", readAt: 300},
		{userID: "c", readAt: 200},
	}
	sortReaders(readers)
	if readers[0].userID != "a" || readers[1].userID != "c" || readers[2].userID != "b" {
		t.Fatalf("порядок неверный: %+v", readers)
	}
	page := readers[1:3]
	if page[0].userID != "c" || page[1].userID != "b" {
		t.Fatalf("страница испорчена: %+v", page)
	}
}
