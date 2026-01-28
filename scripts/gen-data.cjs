// scripts/gen-data.cjs
console.log("CWD:", process.cwd());
console.log("tests exists:", fs.existsSync(TESTS_TXT), TESTS_TXT);
console.log("sources exists:", fs.existsSync(SOURCES_TXT), SOURCES_TXT);

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, "assets");
const TESTS_TXT = path.join(ROOT, "tests.txt");
const SOURCES_TXT = path.join(ROOT, "sources.txt");
const OUT_FILE = path.join(ROOT, "src", "data.ts");

const CLASSES = ["5", "9", "11"];
const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const TOPIC_RE = /^\s*(\d+)\s*(?:\.\s*(.+))?\s*$/u;

function naturalKey(s) {
  return s.split(/(\d+)/).map(x => (x.match(/^\d+$/) ? Number(x) : x.toLowerCase()));
}
function naturalSort(a, b) {
  const ak = naturalKey(a);
  const bk = naturalKey(b);
  for (let i = 0; i < Math.max(ak.length, bk.length); i++) {
    if (ak[i] === undefined) return -1;
    if (bk[i] === undefined) return 1;
    if (ak[i] < bk[i]) return -1;
    if (ak[i] > bk[i]) return 1;
  }
  return 0;
}

function normalizeUrl(s) {
  s = (s || "").trim();
  if (!s) return s;
  if (s.startsWith("t.me/") || s.startsWith("telegram.me/")) return "https://" + s;
  if (/^[\w.-]+\.[a-zA-Z]{2,}(\/|$)/.test(s)) return "https://" + s;
  return s;
}
function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normTestLabel(label) {
  const x = String(label || "").trim().toLowerCase();
  if (["basic", "base", "b", "базовый", "база", "базовая"].includes(x)) return "🟢 Базовая сложность";
  if (["advanced", "hard", "a", "повыш", "повышенная", "сложная", "углубленная"].includes(x)) return "🔴 Повышенная сложность";
  if (["test", "quiz", "тест"].includes(x)) return "✅ Пройти тест";
  return String(label || "").trim();
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(x => x && !x.startsWith("#"));
}

function parseTopics() {
  const TOPICS = {};
  for (const cls of CLASSES) {
    const d = path.join(ASSETS_DIR, cls);
    const arr = [];
    if (!fs.existsSync(d)) {
      TOPICS[cls] = [];
      continue;
    }
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (!fs.statSync(p).isDirectory()) continue;
      const m = name.match(TOPIC_RE);
      if (!m) continue;

      const num = Number(m[1]);
      const title = m[2] ? m[2].trim() : null;

      const images = fs.readdirSync(p)
        .filter(f => IMG_EXTS.has(path.extname(f).toLowerCase()))
        .sort(naturalSort);

      arr.push({ num, title, folder: name, images });
    }
    arr.sort((a,b)=>a.num-b.num);
    TOPICS[cls] = arr;
  }
  return TOPICS;
}

function parseTests() {
  const out = {};
  for (const line of readLines(TESTS_TXT)) {
    const parts = line.split("|").map(x => x.trim());
    if (parts.length < 3) continue;

    let cls, topicS, label, url;
    if (parts.length === 3) {
      [cls, topicS, url] = parts;
      label = "test";
    } else {
      [cls, topicS, label, url] = parts;
    }

    if (!CLASSES.includes(cls)) continue;
    if (!/^\d+$/.test(topicS)) continue;

    url = normalizeUrl(url);
    if (!isHttpUrl(url)) continue;

    const key = `${cls}|${Number(topicS)}`;
    out[key] = out[key] || [];
    out[key].push({ label: normTestLabel(label), url });
  }
  return out;
}

function parseSources() {
  const out = {};
  for (const line of readLines(SOURCES_TXT)) {
    const parts = line.split("|").map(x => x.trim());
    if (parts.length < 4) continue;
    const [cls, topicS, title, urlRaw] = parts;

    if (!CLASSES.includes(cls)) continue;
    if (!/^\d+$/.test(topicS)) continue;

    const url = normalizeUrl(urlRaw);
    if (!isHttpUrl(url)) continue;

    const key = `${cls}|${Number(topicS)}`;
    out[key] = out[key] || [];
    out[key].push({ title: title.trim(), url });
  }
  return out;
}

function emitTS({ TOPICS, TESTS, SOURCES }) {
  const header = `/* AUTO-GENERATED. DO NOT EDIT. */\n`;
  const body =
`export const CLASSES = ${JSON.stringify(CLASSES)} as const;
export type ClassNum = typeof CLASSES[number];

export type Topic = {
  num: number;
  title: string | null;
  folder: string;
  images: string[];
};

export const TOPICS: Record<string, Topic[]> = ${JSON.stringify(TOPICS, null, 2)};

export const TESTS: Record<string, { label: string; url: string }[]> = ${JSON.stringify(TESTS, null, 2)};

export const SOURCES: Record<string, { title: string; url: string }[]> = ${JSON.stringify(SOURCES, null, 2)};
`;
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, header + body, "utf-8");
  console.log("✅ Generated:", path.relative(ROOT, OUT_FILE));
}

function main() {
  const TOPICS = parseTopics();
  const TESTS = parseTests();
  const SOURCES = parseSources();
  emitTS({ TOPICS, TESTS, SOURCES });
}
main();
