// scripts/gen-data.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const ASSETS_DIR = path.join(PUBLIC_DIR, "assets");
const TESTS_TXT = path.join(ROOT, "tests.txt");
const SOURCES_TXT = path.join(ROOT, "sources.txt");
const OUT_TS = path.join(ROOT, "src", "data.ts");

const CLASSES = ["5", "9", "11"];
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const TOPIC_RE = /^\s*(\d+)\s*(?:\.\s*(.+))?\s*$/u;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function naturalKey(s) {
  return s.split(/(\d+)/).map(x => (x.match(/^\d+$/) ? Number(x) : x.toLowerCase()));
}
function naturalSort(a, b) {
  const A = naturalKey(a);
  const B = naturalKey(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] === undefined) return -1;
    if (B[i] === undefined) return 1;
    if (A[i] === B[i]) continue;
    return A[i] < B[i] ? -1 : 1;
  }
  return 0;
}

function parseKvFile(filePath) {
  if (!isFile(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    rows.push(line.split("|").map(x => x.trim()));
  }
  return rows;
}

function normalizeUrl(s) {
  s = (s || "").trim();
  if (!s) return s;

  if (s.startsWith("t.me/") || s.startsWith("telegram.me/")) return "https://" + s;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  // если похоже на домен без схемы
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
  const x = (label || "").trim().toLowerCase();
  if (["basic","base","b","базовый","база","базовая"].includes(x)) return "🟢 Базовая сложность";
  if (["advanced","hard","a","повыш","повышенная","сложная","углубленная"].includes(x)) return "🔴 Повышенная сложность";
  if (["test","quiz","тест"].includes(x)) return "✅ Пройти тест";
  return (label || "").trim();
}

function scanTopics() {
  const TOPICS = {};
  for (const cls of CLASSES) {
    const classDir = path.join(ASSETS_DIR, cls);
    if (!isDir(classDir)) {
      TOPICS[cls] = [];
      continue;
    }
    const topicFolders = fs.readdirSync(classDir).filter(name => isDir(path.join(classDir, name)));

    const topics = [];
    for (const folder of topicFolders) {
      const m = folder.match(TOPIC_RE);
      if (!m) continue;
      const num = Number(m[1]);
      const title = m[2] ? m[2].trim() : "";

      const topicDir = path.join(classDir, folder);
      const files = fs.readdirSync(topicDir)
        .filter(f => {
          const p = path.join(topicDir, f);
          const ext = path.extname(f).toLowerCase();
          return isFile(p) && IMAGE_EXTS.has(ext);
        })
        .sort(naturalSort);

      topics.push({
        num,
        title: title || undefined,
        folder,
        images: files
      });
    }

    topics.sort((a,b) => a.num - b.num);
    TOPICS[cls] = topics;
  }
  return TOPICS;
}

function loadTests() {
  const map = {};
  for (const parts of parseKvFile(TESTS_TXT)) {
    let cls, topicS, label, url;
    if (parts.length === 3) {
      [cls, topicS, url] = parts;
      label = "test";
    } else if (parts.length >= 4) {
      [cls, topicS, label, url] = parts;
    } else continue;

    if (!CLASSES.includes(cls)) continue;
    const topicNum = Number(topicS);
    if (!Number.isFinite(topicNum)) continue;

    url = normalizeUrl(url);
    if (!isHttpUrl(url)) continue;

    const key = `${cls}|${topicNum}`;
    map[key] = map[key] || [];
    map[key].push({ label: normTestLabel(label), url });
  }
  return map;
}

function loadSources() {
  const map = {};
  for (const parts of parseKvFile(SOURCES_TXT)) {
    if (parts.length < 4) continue;
    const [cls, topicS, title, urlRaw] = parts;

    if (!CLASSES.includes(cls)) continue;
    const topicNum = Number(topicS);
    if (!Number.isFinite(topicNum)) continue;

    const url = normalizeUrl(urlRaw);
    if (!isHttpUrl(url)) continue;

    const key = `${cls}|${topicNum}`;
    map[key] = map[key] || [];
    map[key].push({ title: (title || "").trim(), url });
  }
  return map;
}

function toTsString(x) {
  return JSON.stringify(x, null, 2);
}

function main() {
  if (!isDir(ASSETS_DIR)) {
    console.error(`❌ Не найдена папка: ${ASSETS_DIR}`);
    process.exit(1);
  }

  const TOPICS = scanTopics();
  const TESTS = loadTests();
  const SOURCES = loadSources();

  ensureDir(path.dirname(OUT_TS));

  const out = `/* AUTO-GENERATED by scripts/gen-data.cjs — DO NOT EDIT BY HAND */
export const CLASSES = ${toTsString(CLASSES)} as const;
export type ClassNum = typeof CLASSES[number];

export type Topic = {
  num: number;
  title?: string;
  folder: string;
  images: string[];
};

export const TOPICS: Record<ClassNum, Topic[]> = ${toTsString(TOPICS)} as any;

export type TestItem = { label: string; url: string };
export type SourceItem = { title: string; url: string };

export const TESTS: Record<string, TestItem[]> = ${toTsString(TESTS)};
export const SOURCES: Record<string, SourceItem[]> = ${toTsString(SOURCES)};
`;

  fs.writeFileSync(OUT_TS, out, "utf8");

  const testsCount = Object.values(TESTS).reduce((a, arr) => a + arr.length, 0);
  const sourcesCount = Object.values(SOURCES).reduce((a, arr) => a + arr.length, 0);

  console.log(`✅ Generated: ${path.relative(ROOT, OUT_TS)}`);
  console.log(`   Topics: ${Object.values(TOPICS).reduce((a, arr) => a + arr.length, 0)}`);
  console.log(`   Tests: ${testsCount}`);
  console.log(`   Sources: ${sourcesCount}`);
}

main();
