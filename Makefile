TTT_VERSION ?= 1.12.1
TTT_BIN     ?= .tools/ttt
CONFIG_DIR  ?= $(HOME)/.config/ttt
PLUGIN_DIR   = $(CONFIG_DIR)/plugins/ttt-minimap

OS   := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ARCH := $(shell uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')

.PHONY: test dev ttt install-local uninstall-local clean

ttt: $(TTT_BIN)

$(TTT_BIN):
	@mkdir -p $(dir $@)
	curl -sSfL -o $@ https://github.com/eugenioenko/ttt/releases/download/v$(TTT_VERSION)/ttt-$(OS)-$(ARCH)
	chmod +x $@
	xattr -d com.apple.quarantine $@ 2>/dev/null || true

test: $(TTT_BIN)
	TTT_BIN=$(abspath $(TTT_BIN)) node --test tests/*.test.js

dev: $(TTT_BIN)
	TTT_CONFIG_DIR=$$(mktemp -d) $(TTT_BIN) --plugin ./plugin.lua fixtures/sample.go

install-local:
	@mkdir -p $(CONFIG_DIR)/plugins
	ln -sfn $(CURDIR) $(PLUGIN_DIR)

uninstall-local:
	rm -f $(PLUGIN_DIR)

clean:
	rm -rf .tools
