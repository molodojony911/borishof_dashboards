import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCalltouchTokens,
  loadDirectTokens,
  loadSettings,
  persistCalltouchTokens,
  resolveCalltouchToken,
  resolveDirectToken,
  resolveMetrikaToken
} from "../src/lib/config";

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

  it("читает data/tokens.json и указатель _movedTo, окружение остаётся важнее", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "borishof-secrets-"));
    process.env.BORISHOF_DATA_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "tokens.json"),
      JSON.stringify({
        metrika: "metrika-file",
        direct: { Tandem: "tandem-file", RTA: "rta-file" },
        calltouch: { "47639": "call-file" }
      })
    );
    fs.writeFileSync(path.join(dir, "direct-tokens.json"), JSON.stringify({ _movedTo: "data/tokens.json" }));
    fs.writeFileSync(path.join(dir, "calltouch-tokens.json"), JSON.stringify({ _movedTo: "data/tokens.json" }));
    expect(loadDirectTokens()).toEqual({ Tandem: "tandem-file", RTA: "rta-file" });
    expect(loadCalltouchTokens()).toEqual({ "47639": "call-file" });
    expect(resolveMetrikaToken("from-ui")).toBe("metrika-file");
    expect(resolveDirectToken({ contractor: "Tandem", token: "from-ui" })).toBe("tandem-file");
    expect(resolveDirectToken({ contractor: "RTA", token: "" })).toBe("rta-file");
    expect(resolveCalltouchToken({ siteId: "47639", token: "from-ui" })).toBe("call-file");
    process.env.YANDEX_METRIKA_OAUTH_TOKEN = "metrika-env";
    process.env.YANDEX_DIRECT_TANDEM_OAUTH_TOKEN = "tandem-env";
    process.env.CALLTOUCH_TOKENS = JSON.stringify({ "47639": "call-env" });
    expect(resolveMetrikaToken("metrika-file")).toBe("metrika-env");
    expect(resolveDirectToken({ contractor: "Tandem", token: "tandem-file" })).toBe("tandem-env");
    expect(resolveCalltouchToken({ siteId: "47639", token: "call-file" })).toBe("call-env");
    delete process.env.YANDEX_METRIKA_OAUTH_TOKEN;
    delete process.env.YANDEX_DIRECT_TANDEM_OAUTH_TOKEN;
    delete process.env.CALLTOUCH_TOKENS;
    fs.writeFileSync(path.join(dir, "direct-tokens.json"), JSON.stringify({ Tandem: "legacy-tandem", RTA: "legacy-rta" }));
    expect(resolveDirectToken({ contractor: "Tandem", token: "" })).toBe("tandem-file");
    persistCalltouchTokens([
      { id: "ct", name: "cabinet", siteId: "82756", token: "new-site", brand: "Exeed", qualityTags: [] }
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "calltouch-tokens.json"), "utf8"))).toEqual({
      _movedTo: "data/tokens.json"
    });
    const unified = JSON.parse(fs.readFileSync(path.join(dir, "tokens.json"), "utf8")) as {
      metrika: string;
      direct: { Tandem: string };
      calltouch: Record<string, string>;
    };
    expect(unified.metrika).toBe("metrika-file");
    expect(unified.direct.Tandem).toBe("tandem-file");
    expect(unified.calltouch["47639"]).toBe("call-file");
    expect(unified.calltouch["82756"]).toBe("new-site");
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
