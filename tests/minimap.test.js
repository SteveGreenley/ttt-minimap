"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test, before } = require("node:test");

const tui = require("./tui");

const PLUGIN = path.join(tui.ROOT, "plugin.lua");
const SAMPLE = path.join(tui.ROOT, "fixtures", "sample.go");
const EMPTY = path.join(tui.ROOT, "fixtures", "empty.txt");

const BRAILLE = /[\u2800-\u28FF]/u;
const rightColumns = (screen, n) =>
  screen
    .split("\n")
    .map((line) => line.padEnd(120).slice(-n))
    .join("\n");
const barRows = (screen) =>
  screen.split("\n").flatMap((line, index) => (line.includes("▌") ? [index] : []));
const outputLines = (debugJson) => JSON.parse(debugJson).output || [];
const findPanelWidth = (lines) => {
  for (const line of lines) {
    const match = /panel=(\d+)x(\d+)/.exec(line);
    if (match) return Number(match[1]);
  }
  return null;
};

function failure(out) {
  return `ttt exited with ${out.error && out.error.message}\nstderr: ${out.stderr}\nstdout: ${out.stdout}`;
}

function writeLines(dir, name, count, line) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Array.from({ length: count }, (_, i) => line(i)).join("\n") + "\n");
  return file;
}

before(() => tui.preflight());

test("renders a braille minimap in a right-docked panel", () => {
  try {
    tui.start();
    tui.cli("--plugin", PLUGIN, SAMPLE);
    tui.wait(700);
    const shot = tui.snapshot();
    const dump = tui.debug();
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    const screen = out.read(shot) || "";
    assert.match(screen, BRAILLE, `no braille on screen:\n${screen}`);
    assert.match(screen, /package main/, `editor text missing:\n${screen}`);

    const tab = screen.split("\n").find((line) => line.includes("Minimap"));
    assert.ok(tab, `Minimap tab label missing:\n${screen}`);
    assert.ok(tab.indexOf("Minimap") >= 60, `Minimap tab is not in the right half: ${tab}`);

    const lines = outputLines(out.read(dump));
    const log = lines.join("\n");
    assert.doesNotMatch(log, /Plugin error/, log);
    assert.doesNotMatch(log, /build failed/, log);
    assert.ok(findPanelWidth(lines), `panel size log missing:\n${log}`);
  } finally {
    tui.cleanup();
  }
});

test("updates when the buffer changes", () => {
  try {
    tui.start();
    tui.cli("--plugin", PLUGIN, SAMPLE);
    tui.wait(700);
    const beforeShot = tui.snapshot();
    tui.key("enter");
    tui.type("func added() {}");
    tui.wait(300);
    const afterShot = tui.snapshot();
    const dump = tui.debug();
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    const lines = outputLines(out.read(dump));
    const width = findPanelWidth(lines);
    assert.ok(width, `panel size log missing:\n${lines.join("\n")}`);
    assert.doesNotMatch(lines.join("\n"), /Plugin error/, lines.join("\n"));

    const before = rightColumns(out.read(beforeShot) || "", width);
    const after = rightColumns(out.read(afterShot) || "", width);
    assert.notEqual(before, after, `right panel did not change:\n${after}`);
  } finally {
    tui.cleanup();
  }
});

test("moves the viewport indicator when scrolling", () => {
  try {
    const dir = tui.start();
    const file = writeLines(dir, "many.txt", 250, (i) => `line ${i + 1}`);
    tui.cli("--plugin", PLUGIN, file);
    tui.wait(700);
    const beforeShot = tui.snapshot();
    tui.key("pgdn");
    tui.wait(200);
    const afterShot = tui.snapshot();
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    const before = barRows(out.read(beforeShot) || "");
    const after = barRows(out.read(afterShot) || "");
    assert.ok(before.length > 0, "no viewport bar before scrolling");
    assert.ok(after.length > 0, "no viewport bar after scrolling");
    assert.notDeepEqual(before, after, `viewport bar did not move: ${after.join(",")}`);
  } finally {
    tui.cleanup();
  }
});

test("clicking the minimap scrolls the editor to that point", () => {
  try {
    tui.start();
    tui.cli("--plugin", PLUGIN, SAMPLE);
    tui.wait(700);
    const shot = tui.snapshot();
    const before = tui.debug();
    // Panel content row 0 sits at screen row 4: menu bar, top border, panel tab
    // row, divider. These clicks land on map rows 5 and 15.
    tui.click(70, 4 + 5);
    tui.wait(300);
    const first = tui.debug();
    tui.click(70, 4 + 15);
    tui.wait(300);
    const second = tui.debug();
    // Typing right after a click must still reach the editor: the panel never
    // takes keyboard focus.
    tui.type("Z");
    tui.wait(200);
    const typed = tui.debug();
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));

    const lines = (out.read(shot) || "").split("\n");
    const tabRow = lines.findIndex((line) => line.includes("Minimap"));
    assert.ok(tabRow >= 0, "Minimap tab label missing");
    assert.equal(tabRow + 2, 4, `panel content no longer starts at row 4: ${tabRow + 2}`);

    const start = JSON.parse(out.read(before));
    const mid = JSON.parse(out.read(first));
    const last = JSON.parse(out.read(second));

    // The debug dump reports 0-based viewport lines and cursor positions.
    const shows = (viewport, line) =>
      viewport.top_line <= line && line < viewport.top_line + viewport.height;

    assert.equal(start.viewport.top_line, 0, "editor did not start at the top");
    // One pixel row per source line for this 96-line fixture, so map row 5 is
    // line index 20 and row 15 is index 60.
    assert.ok(
      shows(mid.viewport, 20),
      `line 21 is not visible after the first click: ${JSON.stringify(mid.viewport)}`,
    );
    assert.ok(
      last.viewport.top_line > mid.viewport.top_line,
      `second click did not scroll further: ${JSON.stringify(last.viewport)}`,
    );
    assert.ok(
      shows(last.viewport, 60),
      `line 61 is not visible after the second click: ${JSON.stringify(last.viewport)}`,
    );
    assert.equal(last.cursor.line, start.cursor.line, "clicking the minimap moved the cursor");

    const afterTyping = JSON.parse(out.read(typed));
    assert.ok(
      afterTyping.buffer.text.some((text) => text.includes("Z")),
      "typing after a click did not reach the editor: the panel took focus",
    );
  } finally {
    tui.cleanup();
  }
});

test("reads the configured color", () => {
  try {
    // Installed path: ttt wires the plugin log before init, so the startup log
    // line carrying the effective config reaches the Output panel.
    tui.start();
    tui.installPlugin();
    tui.seedStorage({ config: { color: "border" } });
    tui.cli(SAMPLE);
    tui.wait(800);
    const dump = tui.debug();
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    const log = outputLines(out.read(dump)).join("\n");
    assert.match(log, /color=border/, log);
  } finally {
    tui.cleanup();
  }
});

test("choose color persists the selection", () => {
  try {
    const dir = tui.start();
    tui.cli("--plugin", PLUGIN, SAMPLE);
    tui.wait(700);
    tui.exec("Minimap: Choose Color");
    tui.wait(300);
    tui.key("down");
    tui.key("enter");
    tui.wait(300);
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    const storagePath = path.join(dir, "config", "state", "plugins", "ttt-minimap.json");
    assert.ok(fs.existsSync(storagePath), `storage file not written: ${storagePath}`);
    const stored = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    assert.equal(stored.config.color, "line");
  } finally {
    tui.cleanup();
  }
});

test("loads from an isolated plugins directory", () => {
  try {
    tui.start();
    tui.installPlugin();
    tui.cli(SAMPLE);
    tui.wait(800);
    const shot = tui.snapshot();
    const dump = tui.debug();
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    const screen = out.read(shot) || "";
    assert.match(screen, BRAILLE, `no braille on screen:\n${screen}`);
    assert.match(screen, /Minimap/, `Minimap tab label missing:\n${screen}`);
    const log = outputLines(out.read(dump)).join("\n");
    assert.doesNotMatch(log, /Plugin error/, log);
  } finally {
    tui.cleanup();
  }
});

test("empty and large buffers do not error", () => {
  try {
    tui.start();
    tui.cli("--plugin", PLUGIN, EMPTY);
    tui.wait(700);
    let shot = tui.snapshot();
    let dump = tui.debug();
    let out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    assert.match(out.read(shot) || "", /Minimap/, "Minimap tab label missing for an empty file");
    let log = outputLines(out.read(dump)).join("\n");
    assert.doesNotMatch(log, /Plugin error/, log);
  } finally {
    tui.cleanup();
  }

  try {
    const dir = tui.start();
    const file = writeLines(dir, "huge.txt", 21000, (i) => `line ${i + 1} ${"x".repeat(i % 7)}`);
    tui.cli("--plugin", PLUGIN, file);
    tui.wait(1500);
    const shot = tui.snapshot();
    const dump = tui.debug();
    const out = tui.run();

    assert.equal(out.error, undefined, failure(out));
    assert.match(out.read(shot) || "", BRAILLE, "large buffer produced no braille");
    const log = outputLines(out.read(dump)).join("\n");
    assert.doesNotMatch(log, /Plugin error/, log);
  } finally {
    tui.cleanup();
  }
});
