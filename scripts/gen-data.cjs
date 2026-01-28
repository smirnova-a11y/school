/* scripts/gen-data.cjs */
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const ASSETS_DIR = path.join(PUBLIC_DIR, "assets");
const TESTS_TXT = path.join(PUBLIC_DIR, "tests.txt");
const SOURCES_TXT = path.join(PUBLIC_DIR, "sources.txt");
const OUT_FILE = path.join(ROOT, "src", "data.ts");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function naturalKey(s) {
  return s.split(/(\d+)/).map((x) => (x.match(/^\d+$/) ? Number(x) : x.toLowerCase()));
}

function naturalCompare(a, b) {
  const ka = naturalKey(a);
  const kb = naturalKey(b);
  const n = Math.max(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const va = ka[i];
    const vb = kb[i];
    if (va === undefined) return -1;
    if (vb === undefined) return 1;
    if (va === vb) continue;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb), "ru");
  }
  return 0;
}

// Папка темы: "14" или "1. Ткани и мышцы"
function parseTopicFolder(folderName) {
  const m = folderName.match(/^\s*(\d+)\s*(?:\.\s*(.+))?\s*$/u);
  if (!m) return null;
  const num = Number(m[1]);
  const title = m[2] ? String(m[2]).trim() : undefined;
  return { num, title };
}

function normalizeUrl(s) {
  s = (s || "").trim();
  if (!s) return s;
  if (s.startsWith("t.me/") || s.startsWith("telegram.me/")) return "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return s;
  } catch {}
  // домен без схемы
  if (/^[\w.-]+\.[a-zA-Z]{2,}(\/|$)/.test(s)) return "https://" + s;
  return s;
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.host;
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

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, "utf8");
  return txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function parseKv(filePath) {
  return readLines(filePath).map((line) => line.split("|").map((p) => p.trim()));
}

function loadTests() {
  const data = {}; // key "5|14" => [{label,url}]
  for (const parts of parseKv(TESTS_TXT)) {
    let cls, topicS, label, url;
    if (parts.length === 3) {
      [cls, topicS, url] = parts;
      label = "test";
    } else if (parts.length >= 4) {
      [cls, topicS, label, url] = parts;
    } else continue;

    if (!/^\d+$/.test(cls || "") || !/^\d+$/.test(topicS || "")) continue;

    url = normalizeUrl(url);
    if (!isHttpUrl(url)) continue;

    const key = `${cls}|${Number(topicS)}`;
    if (!data[key]) data[key] = [];
    data[key].push({ label: normTestLabel(label), url });
  }
  return data;
}

function loadSources() {
  const data = {}; // key "5|14" => [{title,url}]
  for (const parts of parseKv(SOURCES_TXT)) {
    if (parts.length < 4) continue;
    const [cls, topicS, title, urlRaw] = parts;

    if (!/^\d+$/.test(cls || "") || !/^\d+$/.test(topicS || "")) continue;

    const url = normalizeUrl(urlRaw);
    if (!isHttpUrl(url)) continue;

    const key = `${cls}|${Number(topicS)}`;
    if (!data[key]) data[key] = [];
    data[key].push({ title: String(title || "").trim(), url });
  }
  return data;
}

function loadTopics() {
  if (!fs.existsSync(ASSETS_DIR)) return { classes: [], topicsByClass: {} };

  const classDirs = fs
    .readdirSync(ASSETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a) - Number(b));

  const topicsByClass = {};

  for (const cls of classDirs) {
    const clsPath = path.join(ASSETS_DIR, cls);
    const topicDirs = fs.readdirSync(clsPath, { withFileTypes: true }).filter((d) => d.isDirectory());

    const topics = [];
    for (const td of topicDirs) {
      const parsed = parseTopicFolder(td.name);
      if (!parsed) continue;

      const topicPath = path.join(clsPath, td.name);
      const files = fs
        .readdirSync(topicPath, { withFileTypes: true })
        .filter((f) => f.isFile())
        .map((f) => f.name)
        .filter((name) => IMAGE_EXTS.has(path.extname(name).toLowerCase()))
        .sort(naturalCompare);

      topics.push({
        num: parsed.num,
        title: parsed.title,
        folder: td.name,   // важно: реальное имя папки, может быть с пробелами/кириллицей
        images: files
      });
    }

    topics.sort((a, b) => a.num - b.num);
    topicsByClass[cls] = topics;
  }

  return { classes: classDirs, topicsByClass };
}

function writeDataTs({ classes, topicsByClass, tests, sources }) {
  ensureDir(path.dirname(OUT_FILE));

  const header =
`/* AUTO-GENERATED FILE. DO NOT EDIT.
   Run: npm run gen
*/\n\n`;

  const content =
`${header}` +
`export const CLASSES = ${JSON.stringify(classes, null, 2)} as const;\n\n` +
`export type ClassNum = (typeof CLASSES)[number];\n\n` +
`export type Topic = { num: number; title?: string; folder: string; images: string[] };\n\n` +
`export const TOPICS: Record<string, Topic[]> = ${JSON.stringify(topicsByClass, null, 2)};\n\n` +
`export const TESTS: Record<string, { label: string; url: string }[]> = ${JSON.stringify(tests, null, 2)};\n\n` +
`export const SOURCES: Record<string, { title: string; url: string }[]> = ${JSON.stringify(sources, null, 2)};\n`;

  fs.writeFileSync(OUT_FILE, content, "utf8");
  console.log(`✅ Generated: ${path.relative(ROOT, OUT_FILE)}`);
}

(function main() {
  const { classes, topicsByClass } = loadTopics();
  const tests = loadTests();
  const sources = loadSources();

  writeDataTs({ classes, topicsByClass, tests, sources });
})();
