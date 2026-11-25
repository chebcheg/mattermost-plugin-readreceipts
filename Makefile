PLUGIN_ID := com.mattermost.plugin-readreceipts
PLUGIN_NAME := readreceipts

GO := go
NPM := npm

DIST_DIR := dist
SERVER_DIST := server/dist
WEBAPP_DIST := webapp/dist

BUILD_HASH := $(shell git rev-parse HEAD 2>/dev/null || echo "dev")
BUILD_DATE := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

all: dist

.PHONY: dist
dist: server webapp bundle

.PHONY: server
server:
	@echo Building server plugin...
	mkdir -p $(SERVER_DIST)
	$(GO) build -ldflags "-X main.buildHash=$(BUILD_HASH) -X main.buildDate=$(BUILD_DATE)" -o $(SERVER_DIST)/plugin-linux-amd64 .
	@echo Building server plugin for Windows...
	env GOOS=windows GOARCH=amd64 $(GO) build -ldflags "-X main.buildHash=$(BUILD_HASH) -X main.buildDate=$(BUILD_DATE)" -o $(SERVER_DIST)/plugin-windows-amd64.exe .
	@echo Building server plugin for macOS...
	env GOOS=darwin GOARCH=amd64 $(GO) build -ldflags "-X main.buildHash=$(BUILD_HASH) -X main.buildDate=$(BUILD_DATE)" -o $(SERVER_DIST)/plugin-darwin-amd64 .

.PHONY: webapp
webapp:
	@echo Building webapp plugin...
	cd webapp && $(NPM) install && $(NPM) run build

.PHONY: bundle
bundle:
	@echo Creating plugin bundle...
	mkdir -p $(DIST_DIR)
	tar -czf $(DIST_DIR)/$(PLUGIN_NAME)-$(BUILD_HASH).tar.gz \
		plugin.json \
		$(SERVER_DIST)/plugin-linux-amd64 \
		$(SERVER_DIST)/plugin-windows-amd64.exe \
		$(SERVER_DIST)/plugin-darwin-amd64 \
		$(WEBAPP_DIST)/main.js

.PHONY: clean
clean:
	rm -rf $(DIST_DIR) $(SERVER_DIST) $(WEBAPP_DIST)
	rm -f plugin.tar.gz
