-- ttt-minimap: a VS Code-style braille minimap of the active buffer.
--
-- The map renders into the plugin's bottom-panel tab, which the plugin docks
-- right: ttt's only persistent right-side plugin surface. Each source line is
-- one pixel row of 2x4 braille dots, so indentation and line length form the
-- visible silhouette. All Lua stays in this file: the plugin sandbox only
-- preloads its own modules.

local ttt     = require("ttt")
local editor  = require("ttt.editor")
local events  = require("ttt.events")
local storage = require("ttt.storage")
local text    = require("ttt.text")

local CONFIG_KEY         = "config"
local MAX_MEASURE_COLS   = 4000
local FULL_BUFFER_LIMIT  = 20000
local CHANGE_DEBOUNCE_MS = 60
local BAR_CHAR           = "▌"
local CURSOR_CHAR        = "◆"

local DEFAULTS = {
  color = "muted",
  show_viewport = true,
  viewport_style = "line",
  show_cursor = true,
  cursor_style = "default",
  tab_width = 4,
  auto_open = true,
}

local GRAY_STYLES = { muted = true, line = true, border = true }
local BAR_STYLES  = { muted = true, line = true, border = true, default = true }
local COLOR_CHOICES = {
  { id = "muted",  label = "Mid gray (theme muted, default #888888)" },
  { id = "line",   label = "Soft gray (theme line number, default #999999)" },
  { id = "border", label = "Dark gray (theme border, default #555555)" },
}

local function load_config()
  local ok, stored = pcall(storage.get, CONFIG_KEY)
  if not ok then
    ttt.log("warn", "could not read config: " .. tostring(stored))
    stored = nil
  end

  local cfg = {}
  for k, v in pairs(DEFAULTS) do cfg[k] = v end
  if type(stored) == "table" then
    for k, default in pairs(DEFAULTS) do
      if type(stored[k]) == type(default) then cfg[k] = stored[k] end
    end
  end

  if not GRAY_STYLES[cfg.color] then cfg.color = DEFAULTS.color end
  if not BAR_STYLES[cfg.viewport_style] then cfg.viewport_style = DEFAULTS.viewport_style end
  if not BAR_STYLES[cfg.cursor_style] then cfg.cursor_style = DEFAULTS.cursor_style end

  cfg.tab_width = math.floor(cfg.tab_width)
  if cfg.tab_width < 1 then cfg.tab_width = 1 end
  if cfg.tab_width > 16 then cfg.tab_width = 16 end

  return cfg
end

local cfg = load_config()
ttt.log("info", string.format(
  "color=%s auto_open=%s viewport=%s",
  cfg.color, tostring(cfg.auto_open), tostring(cfg.show_viewport)))

local S = {
  cfg = cfg,
  panel = nil,
  content_dirty = true,
  content_key = "",
  rows = nil,
  content_x = 0,
  bar_x = nil,
  line_count = 0,
  size_logged = false,
  build_error = false,
}

local function save_config()
  local ok, err = pcall(storage.set, CONFIG_KEY, S.cfg)
  if not ok then ttt.log("error", "save config: " .. tostring(err)) end
end

local redraw

-- Braille: pixel rows 0..3 of a cell map to braille dots 1/4, 2/5, 3/6, 7/8.
local DOTS = {
  { 0x01, 0x08 },
  { 0x02, 0x10 },
  { 0x04, 0x20 },
  { 0x40, 0x80 },
}

local BRAILLE = {}
for mask = 0, 255 do
  if mask == 0 then
    BRAILLE[mask + 1] = " "
  else
    -- U+2800 + mask, encoded as UTF-8 by hand: Lua 5.1 has no utf8 library.
    BRAILLE[mask + 1] = string.char(
      0xE2,
      0xA0 + math.floor(mask / 64),
      0x80 + (mask % 64))
  end
end

-- line_metrics returns the display columns of a line's indentation and of its
-- end, both measured from column 0.
local function line_metrics(line)
  local s = text.truncate(line, MAX_MEASURE_COLS, "")
  local n = #s
  local tab_width = cfg.tab_width

  local col = 0
  local i = 1
  while i <= n do
    local b = string.byte(s, i)
    if b == 32 then
      col = col + 1
    elseif b == 9 then
      col = col + (tab_width - (col % tab_width))
    else
      break
    end
    i = i + 1
  end
  local indent = col

  local pos = i
  while pos <= n do
    local tab = string.find(s, "\t", pos, true)
    if not tab then
      col = col + text.width(string.sub(s, pos))
      break
    end
    if tab > pos then
      col = col + text.width(string.sub(s, pos, tab - 1))
    end
    col = col + (tab_width - (col % tab_width))
    pos = tab + 1
  end

  return indent, col
end

-- map_layout splits the panel width into the viewport bar column and the map.
local function map_layout(w)
  if cfg.show_viewport and w >= 4 then
    return w - 1, 1, 0
  end
  return w, 0, nil
end

local function pixel_row(line0, count, px_rows)
  if count <= 0 or px_rows <= 0 then return 0 end
  if count <= px_rows then return line0 end
  return math.floor(line0 * px_rows / count)
end

local function build(w, h, key)
  local count = editor.line_count()
  local map_w, content_x, bar_x = map_layout(w)
  local px_rows = h * 4
  local buckets = {}
  local max_cols = 1

  local function add(px, line)
    local indent, end_col = line_metrics(line)
    local b = buckets[px + 1]
    if b then
      if indent < b.min_indent then b.min_indent = indent end
      if end_col > b.max_end then b.max_end = end_col end
    else
      buckets[px + 1] = { min_indent = indent, max_end = end_col }
    end
    if end_col > max_cols then max_cols = end_col end
  end

  if count > 0 then
    if count <= FULL_BUFFER_LIMIT then
      local lines = editor.buffer_lines()
      for i = 1, #lines do
        local px
        if count <= px_rows then
          px = i - 1
        else
          px = math.floor((i - 1) * px_rows / count)
        end
        add(px, lines[i])
      end
    else
      -- Large buffers: sample one representative line per pixel row instead of
      -- copying the buffer; both the first and last line are included.
      local n = math.min(px_rows, count)
      for px = 0, n - 1 do
        local idx
        if n > 1 then
          idx = 1 + math.floor(px * (count - 1) / (n - 1))
        else
          idx = 1
        end
        add(px, editor.get_line(idx))
      end
    end
  end

  local px_w = map_w * 2
  local rows = {}
  for cy = 0, h - 1 do
    local masks = {}
    for cx = 1, map_w do masks[cx] = 0 end
    for py = 0, 3 do
      local b = buckets[cy * 4 + py + 1]
      if b and b.max_end > b.min_indent then
        local sx = math.floor(b.min_indent * px_w / max_cols)
        local ex = math.ceil(b.max_end * px_w / max_cols)
        if sx < 0 then sx = 0 elseif sx > px_w then sx = px_w end
        if ex < 0 then ex = 0 elseif ex > px_w then ex = px_w end
        if ex <= sx then ex = math.min(sx + 1, px_w) end
        local dots = DOTS[py + 1]
        for px = sx, ex - 1 do
          local cx = math.floor(px / 2) + 1
          local mask = masks[cx]
          if mask then masks[cx] = mask + dots[px % 2 + 1] end
        end
      end
    end
    local parts = {}
    for cx = 1, map_w do parts[cx] = BRAILLE[masks[cx] + 1] end
    rows[cy + 1] = table.concat(parts)
  end

  S.rows = rows
  S.content_x = content_x
  S.bar_x = bar_x
  S.line_count = count
  S.content_key = key
  S.content_dirty = false

  if not S.size_logged then
    S.size_logged = true
    ttt.log("info", string.format("panel=%dx%d", w, h))
  end
end

local function draw(panel, h)
  local rows = S.rows
  if not rows then return end
  for y = 1, #rows do
    panel:text(S.content_x, y - 1, rows[y], cfg.color)
  end

  if not S.bar_x then return end

  local vp = editor.viewport()
  if not vp then return end
  local px_rows = h * 4
  local top = pixel_row(vp.top_line - 1, S.line_count, px_rows)
  local bottom = pixel_row(vp.bottom_line - 1, S.line_count, px_rows)
  local y0 = math.floor(top / 4)
  local y1 = math.floor(bottom / 4)
  if y0 < 0 then y0 = 0 elseif y0 > h - 1 then y0 = h - 1 end
  if y1 < 0 then y1 = 0 elseif y1 > h - 1 then y1 = h - 1 end
  if y1 < y0 then y0, y1 = y1, y0 end
  for y = y0, y1 do
    panel:text(S.bar_x, y, BAR_CHAR, cfg.viewport_style)
  end

  if not cfg.show_cursor then return end
  local cur = editor.cursor()
  if not cur then return end
  if cur.line < vp.top_line or cur.line > vp.bottom_line then return end
  local y = math.floor(pixel_row(cur.line - 1, S.line_count, px_rows) / 4)
  if y < 0 then y = 0 elseif y > h - 1 then y = h - 1 end
  panel:text(S.bar_x, y, CURSOR_CHAR, cfg.cursor_style)
end

local function render(panel)
  S.panel = panel
  local w, h = panel:size()
  if w <= 0 or h <= 0 then return end

  if editor.file_path() == "" then
    panel:text(0, 0, text.truncate("No active buffer", w, "…"), "muted")
    return
  end

  local key = table.concat({ w, h, tostring(cfg.show_viewport), tostring(cfg.tab_width) }, ":")
  if S.content_dirty or S.content_key ~= key then
    local ok, err = pcall(build, w, h, key)
    if not ok then
      S.content_dirty = false
      S.content_key = key
      if not S.build_error then
        S.build_error = true
        ttt.log("error", "build failed: " .. tostring(err))
      end
      panel:text(0, 0, text.truncate("Minimap error", w, "…"), "danger")
      return
    end
    S.build_error = false
  end

  draw(panel, h)
end

redraw = function()
  if S.panel then S.panel:redraw() end
end

local run_dirty = ttt.debounce(CHANGE_DEBOUNCE_MS, function()
  S.content_dirty = true
  redraw()
end)

events.on("editor.change", function(path)
  if path == editor.file_path() then run_dirty() end
end)

events.on("tab.change", function()
  S.content_dirty = true
  S.content_key = ""
  redraw()
end)

local function choose_color()
  local items = {}
  for _, choice in ipairs(COLOR_CHOICES) do
    local item = { id = choice.id, label = choice.label }
    if choice.id == cfg.color then item.badge = "current" end
    items[#items + 1] = item
  end

  local opened = ttt.open_dialog({
    title = "Minimap Color",
    width = 60,
    height = 8,
    render = function(panel)
      panel:label({ text = "Colors come from the active theme.", style = "muted" })
      panel:list({
        items = items,
        active = cfg.color,
        on_command = function(command, node)
          if command ~= "activate" or not node or not node.id then return end
          cfg.color = node.id
          save_config()
          ttt.close_dialog()
          redraw()
          ttt.notify("Minimap color: " .. node.id)
        end,
      })
    end,
  })

  if opened == false then
    ttt.notify("Minimap: close the open dialog first", "warn")
  end
end

local function try_show()
  if ttt.exec_command then
    pcall(ttt.exec_command, "panel.dockRight")
  end
  if type(ttt.show_panel) ~= "function" then
    return false, "ttt.show_panel is unavailable"
  end
  local ok, shown = pcall(ttt.show_panel, "bottom")
  if not ok then return false, tostring(shown) end
  return shown == true
end

local function show()
  local attempts = 0
  local function attempt()
    local shown, err = try_show()
    if shown then return end
    attempts = attempts + 1
    if attempts < 5 then
      ttt.set_timeout(200, attempt)
    else
      ttt.log("warn", "could not open the Minimap panel: " .. tostring(err))
    end
  end
  attempt()
end

ttt.register({
  bottom = { title = "Minimap", render = render },
  commands = {
    { id = "ttt-minimap.show", title = "Minimap: Show", handler = show },
    {
      id = "ttt-minimap.refresh",
      title = "Minimap: Refresh",
      handler = function()
        S.content_dirty = true
        S.content_key = ""
        redraw()
      end,
    },
    { id = "ttt-minimap.chooseColor", title = "Minimap: Choose Color", handler = choose_color },
    {
      id = "ttt-minimap.toggleAutoOpen",
      title = "Minimap: Toggle Auto-Open",
      handler = function()
        cfg.auto_open = not cfg.auto_open
        save_config()
        ttt.notify("Minimap auto-open: " .. tostring(cfg.auto_open))
      end,
    },
  },
})

ttt.set_timeout(200, function()
  if cfg.auto_open then show() end
end)
