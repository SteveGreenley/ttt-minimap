"use strict";

// Headless driver for the ttt binary: builds one --exec script per run and
// executes it against an isolated TTT_CONFIG_DIR.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BINARY = process.env.TTT_BIN
  ? path.resolve(process.env.TTT_BIN)
  : path.join(ROOT, ".tools", "ttt");
const SIZE = "120x36";
// ASCII unit separator: cannot appear in a key name, typed text or path, so a
// literal ";" or ":" stays inside one action.
const SEP = "\x1f";

let dir = "";
let actions = [];
let argv = [];
let shots = 0;
let dumps = 0;

// start() creates the run's temp directory; cli() sets the ttt arguments.
function start() {
  cleanup();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttt-minimap-"));
  actions = [];
  argv = [];
  shots = 0;
  dumps = 0;
  return dir;
}

function cli(...args) {
  argv = args;
}

function workdir() {
  return dir;
}

function configDir() {
  return path.join(dir, "config");
}

function writeFile(relPath, data) {
  const target = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

function wait(ms) {
  actions.push(`wait ${ms}`);
}

function key(combo) {
  actions.push(`key ${combo}`);
}

function type(text) {
  actions.push(`type ${JSON.stringify(text)}`);
}

function exec(title) {
  actions.push(`exec ${JSON.stringify(title)}`);
}

// snapshot() returns the name of the screenshot file to read after run().
function snapshot() {
  const name = `snap-${shots++}.txt`;
  actions.push(`screenshot ${JSON.stringify(path.join(dir, name))}`);
  return name;
}

function debug() {
  const name = `debug-${dumps++}.json`;
  actions.push(`debug ${JSON.stringify(path.join(dir, name))}`);
  return name;
}

function seedStorage(value) {
  writeFile("config/state/plugins/ttt-minimap.json", JSON.stringify(value));
}

// installPlugin() symlinks this repository into an isolated plugins directory
// and pre-approves the manifest permissions, so ttt loads it without --plugin.
function installPlugin() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "plugin.ttt.json"), "utf8"));
  fs.mkdirSync(path.join(configDir(), "plugins"), { recursive: true });
  fs.symlinkSync(ROOT, path.join(configDir(), "plugins", manifest.name), "dir");
  writeFile(
    "config/plugins.ttt.json",
    JSON.stringify(
      [
        {
          name: manifest.name,
          displayName: manifest.displayName,
          version: manifest.version,
          enabled: true,
          grantsVersion: 2,
          permissions: manifest.permissions,
        },
      ],
      null,
      2,
    ),
  );
}

function run() {
  actions.push("quit");
  const script = actions.join(SEP);
  let error;
  let stdout = "";
  let stderr = "";

  try {
    stdout = execFileSync(
      BINARY,
      ["--size", SIZE, "--exec-split-on", SEP, "--exec", script, ...argv],
      {
        encoding: "utf8",
        timeout: 60000,
        stdio: "pipe",
        cwd: ROOT,
        env: { ...process.env, TTT_CONFIG_DIR: configDir() },
      },
    );
  } catch (err) {
    error = err;
    stdout = String(err.stdout || "");
    stderr = String(err.stderr || "");
  }

  const read = (name) => {
    if (!name) return null;
    try {
      return fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      return null;
    }
  };

  return { error, stdout, stderr, read };
}

function cleanup() {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  dir = "";
}

// preflight() fails fast with an actionable message when the binary is missing
// or predates the APIs this plugin needs.
function preflight() {
  let out;
  try {
    out = execFileSync(BINARY, ["--version"], { encoding: "utf8", timeout: 10000 });
  } catch (err) {
    throw new Error(
      `cannot run ttt at ${BINARY} (${err.message}). Run "make ttt" to download v1.12.1.`,
    );
  }
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(out);
  if (!match) {
    throw new Error(`could not parse the ttt version from ${JSON.stringify(out.trim())}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 1 || (major === 1 && minor < 10)) {
    throw new Error(
      `ttt ${match[0]} at ${BINARY} is too old: ttt-minimap needs >= 1.10.0 for ttt.text, ttt.debounce and ttt.show_panel. Run "make ttt".`,
    );
  }
}

module.exports = {
  BINARY,
  ROOT,
  start,
  cli,
  workdir,
  configDir,
  wait,
  key,
  type,
  exec,
  snapshot,
  debug,
  seedStorage,
  installPlugin,
  run,
  cleanup,
  preflight,
};
