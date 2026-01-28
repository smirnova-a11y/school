// functions/webhook.ts
import { CLASSES, TOPICS, TESTS, SOURCES, type ClassNum, type Topic } from "../src/data";

type Env = {
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
};

type TgUpdate = any;

const NBSP = "\u00A0";
const padBtn = (text: string, left = 3, right = 3) => `${NBSP.repeat(left)}${text}${NBSP.repeat(right)}`;

function tgUrl(token: string, method: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function tgCall(env: Env, method: string, payload: Record<string, any>) {
  const r = await fetch(tgUrl(env.BOT_TOKEN, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.ok === false) {
    console.log("TG error", method, r.status, JSON.stringify(data));
  }
  return data;
}

function classExists(cls: string): cls is ClassNum {
  return (CLASSES as readonly string[]).includes(cls);
}

function getTopic(cls: ClassNum, topicNum: number): Topic | undefined {
  const arr = TOPICS[String(cls)] || [];
  return arr.find((t) => t.num === topicNum);
}

function topicLabel(t: Topic) {
  return t.title?.trim() ? t.title.trim() : `Параграф ${t.num}`;
}

function buildAssetUrl(origin: string, cls: string, folder: string, fileName: string) {
  // Важно кодировать сегменты, т.к. могут быть пробелы/кириллица
  const enc = (s: string) => encodeURIComponent(s);
  return `${origin}/assets/${enc(cls)}/${enc(folder)}/${enc(fileName)}`;
}

function topicsKeyboard(cls: ClassNum) {
  const topics = TOPICS[String(cls)] || [];
  const inline_keyboard = topics.map((t) => [
    { text: padBtn(topicLabel(t), 4, 4), callback_data: `topic:${cls}:${t.num}` },
  ]);

  inline_keyboard.push([{ text: padBtn("⬅️ Другой класс", 3, 3), callback_data: "menu" }]);
  return { inline_keyboard };
}

function classesKeyboard(selected?: string) {
  const inline_keyboard: any[] = [];
  const row: any[] = [];
  for (const c of CLASSES as readonly string[]) {
    const mark = selected === c ? " ✅" : "";
    row.push({ text: padBtn(`${c} класс${mark}`, 4, 4), callback_data: `class:${c}` });
    if (row.length === 2) {
      inline_keyboard.push([...row]);
      row.length = 0;
    }
  }
  if (row.length) inline_keyboard.push([...row]);
  return { inline_keyboard };
}

function navKeyboard(
  cls: ClassNum,
  topicNum: number,
  opts?: { testsExpanded?: boolean; sourcesExpanded?: boolean }
) {
  const topics = TOPICS[String(cls)] || [];
  const idx = topics.findIndex((t) => t.num === topicNum);
  const prev = idx > 0 ? topics[idx - 1].num : null;
  const next = idx >= 0 && idx < topics.length - 1 ? topics[idx + 1].num : null;

  const key = `${cls}|${topicNum}`;
  const tests = TESTS[key] || [];
  const sources = SOURCES[key] || [];

  const testsExpanded = !!opts?.testsExpanded;
  const sourcesExpanded = !!opts?.sourcesExpanded;

  const inline_keyboard: any[] = [];

  // ✅ ТЕСТЫ
  if (tests.length === 1) {
    inline_keyboard.push([{ text: padBtn("✅ Пройти тест", 4, 4), url: tests[0].url }]);
  } else if (tests.length >= 2) {
    if (!testsExpanded) {
      inline_keyboard.push([
        { text: padBtn("✅ Пройти тест", 4, 4), callback_data: `tests:${cls}:${topicNum}:open` },
      ]);
    } else {
      for (const t of tests) {
        inline_keyboard.push([{ text: padBtn(t.label, 4, 4), url: t.url }]);
      }
      inline_keyboard.push([
        { text: padBtn("⬅️ Назад", 3, 3), callback_data: `tests:${cls}:${topicNum}:close` },
      ]);
    }
  }

  // 📎 ИСТОЧНИКИ
  if (sources.length === 1) {
    inline_keyboard.push([{ text: padBtn("📎 Доп. источники", 4, 4), url: sources[0].url }]);
  } else if (sources.length >= 2) {
    if (!sourcesExpanded) {
      inline_keyboard.push([
        { text: padBtn("📎 Доп. источники", 4, 4), callback_data: `sources:${cls}:${topicNum}:open` },
      ]);
    } else {
      for (const s of sources) {
        inline_keyboard.push([{ text: padBtn(s.title, 4, 4), url: s.url }]);
      }
      inline_keyboard.push([
        { text: padBtn("⬅️ Назад", 3, 3), callback_data: `sources:${cls}:${topicNum}:close` },
      ]);
    }
  }

  // Навигация
  const navRow: any[] = [{ text: padBtn("⬅️ Назад", 3, 3), callback_data: `back:topics:${cls}` }];
  if (prev !== null) navRow.push({ text: padBtn("⬅️ Предыдущая тема", 2, 2), callback_data: `topic:${cls}:${prev}` });
  if (next !== null) navRow.push({ text: padBtn("➡️ Следующая тема", 2, 2), callback_data: `topic:${cls}:${next}` });
  inline_keyboard.push(navRow);

  // Меню
  inline_keyboard.push([{ text: padBtn("🏠 Меню", 3, 3), callback_data: "menu" }]);

  return { inline_keyboard };
}

async function sendTopic(env: Env, origin: string, chatId: number, cls: ClassNum, topicNum: number) {
  const topic = getTopic(cls, topicNum);
  if (!topic) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "Такой темы нет.",
      reply_markup: { inline_keyboard: [[{ text: padBtn("🏠 Меню", 3, 3), callback_data: "menu" }]] },
    });
    return;
  }

  const images = topic.images || [];
  if (!images.length) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: `Картинок не найдено: assets/${cls}/${topic.folder}/`,
      reply_markup: navKeyboard(cls, topicNum),
    });
    return;
  }

  // отправка пачками по 10 (лимит sendMediaGroup: 2–10) :contentReference[oaicite:7]{index=7}
  for (let i = 0; i < images.length; i += 10) {
    const chunk = images.slice(i, i + 10);
    if (chunk.length === 1) {
      const url = buildAssetUrl(origin, cls, topic.folder, chunk[0]);
      await tgCall(env, "sendPhoto", { chat_id: chatId, photo: url });
    } else {
      const media = chunk.map((file) => ({
        type: "photo",
        media: buildAssetUrl(origin, cls, topic.folder, file),
      }));
      await tgCall(env, "sendMediaGroup", {
        chat_id: chatId,
        media: JSON.stringify(media), // Telegram ждёт JSON-сериализованный массив :contentReference[oaicite:8]{index=8}
      });
    }
  }

  await tgCall(env, "sendMessage", {
    chat_id: chatId,
    text: `📌 ${cls} класс — ${topicLabel(topic)}`,
    reply_markup: navKeyboard(cls, topicNum),
  });
}

async function handleCallback(env: Env, origin: string, cq: any) {
  const data: string = cq.data || "";
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const cqId = cq.id;

  // всегда отвечаем на callback, чтобы Telegram убрал "часики"
  await tgCall(env, "answerCallbackQuery", { callback_query_id: cqId });

  if (!chatId || !messageId) return;

  if (data === "menu") {
    await tgCall(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "Выбери класс:",
      reply_markup: classesKeyboard(),
    });
    return;
  }

  if (data.startsWith("class:")) {
    const cls = data.split(":")[1];
    if (!classExists(cls)) return;

    await tgCall(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: `Выбранный класс: ${cls}\nВыбери тему:`,
      reply_markup: topicsKeyboard(cls),
    });
    return;
  }

  if (data.startsWith("back:topics:")) {
    const cls = data.split(":")[2];
    if (!classExists(cls)) return;

    await tgCall(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: `Выбранный класс: ${cls}\nВыбери тему:`,
      reply_markup: topicsKeyboard(cls),
    });
    return;
  }

  if (data.startsWith("topic:")) {
    const [, clsRaw, topicRaw] = data.split(":");
    if (!classExists(clsRaw)) return;
    const topicNum = Number(topicRaw);
    if (!Number.isFinite(topicNum)) return;

    // отправим тему отдельными сообщениями (картинки + навигация)
    await sendTopic(env, origin, chatId, clsRaw, topicNum);
    return;
  }

  // Аккордеон тестов: tests:<class>:<topic>:open|close
  if (data.startsWith("tests:")) {
    const parts = data.split(":");
    if (parts.length !== 4) return;
    const cls = parts[1];
    const topicNum = Number(parts[2]);
    const action = parts[3]; // open|close
    if (!classExists(cls) || !Number.isFinite(topicNum)) return;

    const expanded = action === "open";
    await tgCall(env, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: navKeyboard(cls, topicNum, { testsExpanded: expanded, sourcesExpanded: false }),
    });
    return;
  }

  // Аккордеон источников: sources:<class>:<topic>:open|close
  if (data.startsWith("sources:")) {
    const parts = data.split(":");
    if (parts.length !== 4) return;
    const cls = parts[1];
    const topicNum = Number(parts[2]);
    const action = parts[3]; // open|close
    if (!classExists(cls) || !Number.isFinite(topicNum)) return;

    const expanded = action === "open";
    await tgCall(env, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: navKeyboard(cls, topicNum, { testsExpanded: false, sourcesExpanded: expanded }),
    });
    return;
  }
}

async function handleMessage(env: Env, msg: any) {
  const chatId = msg.chat?.id;
  const text: string = msg.text || "";

  if (!chatId) return;

  if (text.startsWith("/start") || text.startsWith("/menu")) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "Выбери класс:",
      reply_markup: classesKeyboard(),
    });
    return;
  }

  await tgCall(env, "sendMessage", {
    chat_id: chatId,
    text: "Я работаю через кнопки. Нажми /menu",
  });
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  // Проверка secret_token webhook :contentReference[oaicite:9]{index=9}
  if (env.WEBHOOK_SECRET) {
    const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (got !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
  }

  const origin = new URL(request.url).origin;
  const update: TgUpdate = await request.json().catch(() => null);
  if (!update) return new Response("bad request", { status: 400 });

  try {
    if (update.callback_query) {
      await handleCallback(env, origin, update.callback_query);
    } else if (update.message) {
      await handleMessage(env, update.message);
    }
  } catch (e) {
    console.log("handler error", e);
  }

  return new Response("ok");
};

// (необязательно) GET для проверки “жив ли endpoint”
export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response("OK");
};
