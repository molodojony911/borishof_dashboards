import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings, resolveCalltouchToken, resolveDirectToken, resolveMetrikaToken } from "../src/lib/config";

const KEYS = [
  "BORISHOF_DATA_DIR",
  "YANDEX_METRIKA_OAUTH_TOKEN",
  "YANDEX_DIRECT_RTA_OAUTH_TOKEN",
  "YANDEX_DIRECT_TANDEM_OAUTH_TOKEN",
  "YANDEX_DIRECT_TOKENS",
  "CALLTOUCH_TOKENS",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID"
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("секреты из окружения", () => {
  it("переменная важнее файла и поля кабинета", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-secrets-"));
    process.env.BORISHOF_DATA_DIR = dir;
    fs.writeFileSync(path.join(dir, "direct-tokens.json"), JSON.stringify({ Tandem: "from-file", RTA: "from-file" }));
    fs.writeFileSync(path.join(dir, "calltouch-tokens.json"), JSON.stringify({ "47639": "from-file" }));
    process.env.YANDEX_DIRECT_TANDEM_OAUTH_TOKEN = "from-env";
    process.env.CALLTOUCH_TOKENS = JSON.stringify({ "47639": "from-env" });
    process.env.YANDEX_METRIKA_OAUTH_TOKEN = "metrika-env";
    expect(resolveDirectToken({ contractor: "Tandem", token: "from-ui" })).toBe("from-env");
    expect(resolveCalltouchToken({ siteId: "47639", token: "from-ui" })).toBe("from-env");
    expect(resolveMetrikaToken("from-ui")).toBe("metrika-env");
    delete process.env.YANDEX_DIRECT_TANDEM_OAUTH_TOKEN;
    delete process.env.CALLTOUCH_TOKENS;
    delete process.env.YANDEX_METRIKA_OAUTH_TOKEN;
    expect(resolveDirectToken({ contractor: "Tandem", token: "from-ui" })).toBe("from-file");
    expect(resolveCalltouchToken({ siteId: "47639", token: "from-ui" })).toBe("from-file");
    expect(resolveMetrikaToken("from-ui")).toBe("from-ui");
    fs.rmSync(path.join(dir, "direct-tokens.json"));
    fs.rmSync(path.join(dir, "calltouch-tokens.json"));
    expect(resolveDirectToken({ contractor: "Tandem", token: "from-ui" })).toBe("from-ui");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("пустой сохранённый токен Telegram не затирает переменную", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-secrets-"));
    process.env.BORISHOF_DATA_DIR = dir;
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ telegramBotToken: "", telegramChatId: "" }));
    process.env.TELEGRAM_BOT_TOKEN = "bot-from-env";
    process.env.TELEGRAM_CHAT_ID = "chat-from-env";
    const settings = loadSettings();
    expect(settings.telegramBotToken).toBe("bot-from-env");
    expect(settings.telegramChatId).toBe("chat-from-env");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
