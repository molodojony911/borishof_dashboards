"use client";

import { useEffect, useState } from "react";
import { PageIntro } from "./ui";
import { DEFAULT_QUALITY_TAGS, DEFAULT_THRESHOLDS } from "@/lib/defaults";
import { CALL_GOALS } from "@/lib/catalog";
import type { AppSettings, CalltouchAccount, DirectAccount, MetrikaAccount } from "@/lib/types";
import { PlansImport } from "./PlansImport";

const emptyMetrika = (): MetrikaAccount => ({
  id: crypto.randomUUID(),
  name: "",
  counterId: "",
  token: "",
  goalCallId: ""
});
const emptyDirect = (): DirectAccount => ({
  id: crypto.randomUUID(),
  name: "",
  token: "",
  clientLogin: "",
  contractor: "",
  brand: "",
  line: "nc"
});
const emptyCalltouch = (): CalltouchAccount => ({
  id: crypto.randomUUID(),
  name: "",
  siteId: "",
  token: "",
  brand: "",
  contractor: "",
  url: "",
  qualityTags: [...DEFAULT_QUALITY_TAGS]
});

type SettingsView = AppSettings & {
  metrikaTokenFromEnv?: boolean;
  rtaDirectTokenFromEnv?: boolean;
  calltouchTokenFromVault?: boolean;
  hasSecrets?: { calltouch?: boolean[]; calltouchFromVault?: number };
};

export function SetupPage() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  async function save() {
    if (!settings) return;
    setStatus("Сохранение…");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    const json = await res.json();
    setSettings(json);
    setStatus("Сохранено. Секреты остаются в data/tokens.json или в переменных окружения и в интерфейс не попадают.");
  }

  if (!settings) return <div className="text-sm text-mute">Загрузка настроек…</div>;

  return (
    <>
      <PageIntro
        title="Подключение источников"
        lead="OAuth Метрики и токен Директа RTA кладутся в .env — по одному на все сайты и кабинеты подрядчика."
      />

      <ol className="mb-12 max-w-3xl space-y-8 text-sm leading-relaxed">
        <li>
          <h2 className="font-display text-xl">1. Яндекс Метрика — что прислать</h2>
          <p className="mt-2 text-mute">
            Один OAuth-токен на все счётчики. Положите его в <code className="text-paper">.env</code> как{" "}
            <span className="text-paper">YANDEX_METRIKA_OAUTH_TOKEN</span>. В каждый сайт копировать не нужно.
          </p>
          <div className="mt-3 space-y-2 text-mute">
            <p>
              <span className="text-paper">Где взять ID.</span> Метрика → счётчик → в URL будет
              metrika.yandex.ru/dashboard?id=<b className="text-paper">XXXXXXX</b>. Тот же номер в «Настройки / счётчик». Нужны все
              счётчики брендовых сайтов холдинга.
            </p>
            <p>
              <span className="text-paper">Как выпустить токен.</span> Создайте приложение на{" "}
              <a className="text-gold-400" href="https://oauth.yandex.ru/client/new" target="_blank" rel="noreferrer">
                oauth.yandex.ru/client/new
              </a>
              : платформа «Веб-сервисы», callback <code className="text-paper">https://oauth.yandex.ru/verification_code</code>,
              доступ «Яндекс.Метрика — чтение». Затем откройте:
            </p>
            <pre className="overflow-x-auto border border-white/10 bg-ink-900 p-3 text-[12px] text-paper">
{`https://oauth.yandex.ru/authorize?response_type=token&client_id=ВАШ_CLIENT_ID`}
            </pre>
            <p>
              После разрешения токен будет в адресной строке: <code className="text-paper">#access_token=...</code>. Этого токена
              хватает на все счётчики, к которым у аккаунта есть доступ. Не присылайте пароль Яндекса.
            </p>
            <p>
              <span className="text-paper">Цели.</span> Если есть цель «звонок» / «отправка формы», пришлите её ID (цифры в
              настройках цели). Тогда воронка строится по факту Метрики, а не только по Calltouch.
            </p>
          </div>
        </li>
        <li>
          <h2 className="font-display text-xl">2. Яндекс Директ подрядчиков</h2>
          <p className="mt-2 text-mute">
            RTA: один OAuth-токен представителя в <code className="text-paper">.env</code> как{" "}
            <span className="text-paper">YANDEX_DIRECT_RTA_OAUTH_TOKEN</span>. Client-Login каждого кабинета уже в справочнике —
            в каждый бренд копировать не нужно.
          </p>
          <p className="mt-2 text-mute">
            Tandem: <span className="text-paper">YANDEX_DIRECT_TANDEM_OAUTH_TOKEN</span> или JSON{" "}
            <span className="text-paper">YANDEX_DIRECT_TOKENS</span>. Если переменной нет, читается{" "}
            <code className="text-paper">data/tokens.json</code>, секция direct. Право{" "}
            <span className="text-paper">direct:api</span>, для агентских кабинетов обязателен Client-Login.
          </p>
          <p className="mt-2 text-mute">
            Приложение на oauth.yandex.ru с доступом «Яндекс.Директ». Токен выпускает представитель, у которого есть доступ к
            кабинетам подрядчика. После правки .env перезапустите npm run dev.
          </p>
          <p className="mt-2 text-mute">
            Варианты текстов слабых объявлений: <span className="text-paper">OPENAI_API_KEY</span> в окружении сервера. Прокси —{" "}
            <span className="text-paper">OPENAI_BASE_URL</span>, модель — <span className="text-paper">OPENAI_MODEL</span> (по
            умолчанию gpt-4o-mini). Без ключа разбор остаётся, кнопка скрыта. В Директ тексты не отправляются.
          </p>
        </li>
        <li>
          <h2 className="font-display text-xl">3. Calltouch</h2>
          <p className="mt-2 text-mute">
            Один кабинет = и NC, и AFS. Направление определяется только тегами, не отдельным ЛК. Кабинеты сопоставлены по URL
            сайта.
          </p>
          <p className="mt-2 text-mute">
            Качественные лиды, точное совпадение тега: NC — <span className="text-paper">Новый</span>,{" "}
            <span className="text-paper">Новый А/м</span>. AFS — <span className="text-paper">Новый звонок</span>,{" "}
            <span className="text-paper">Сервис</span>. «Новый» не считается «Новый звонок».
          </p>
          <p className="mt-2 text-mute">
            Токены Calltouch: JSON <span className="text-paper">CALLTOUCH_TOKENS</span> по siteId. Если переменной нет — секция{" "}
            <span className="text-paper">calltouch</span> в <code className="text-paper">data/tokens.json</code>. В интерфейс они не светятся.
          </p>
        </li>
        <li>
          <h2 className="font-display text-xl">4. Telegram-алерты</h2>
          <p className="mt-2 text-mute">
            Создайте бота через @BotFather, возьмите token. Напишите боту, затем узнайте chat id (личный или чат маркетинга).
            Кнопка «Отправить в Telegram» на странице алертов.
          </p>
        </li>
      </ol>

      <PlansImport />

      <h2 className="mb-4 font-display text-xl">Счётчики Метрики</h2>
      <p className="mb-4 text-sm text-mute">
        {settings.metrikaTokenFromEnv
          ? "Единый токен найден в YANDEX_METRIKA_OAUTH_TOKEN. Поля токена у сайтов не нужны."
          : "Добавьте YANDEX_METRIKA_OAUTH_TOKEN в .env и перезапустите npm run dev."}
      </p>
      <AccountList
        rows={settings.metrika}
        onChange={(metrika) => setSettings({ ...settings, metrika })}
        onAdd={() => setSettings({ ...settings, metrika: [...settings.metrika, emptyMetrika()] })}
        render={(row, patch) => {
          const mapped = Object.entries(CALL_GOALS).find(([key]) => row.id.includes(key))?.[1];
          return (
          <div className="grid gap-2 md:grid-cols-2">
            <Field label="Название сайта" value={row.name} onChange={(name) => patch({ name })} />
            <Field label="ID счётчика" value={row.counterId} onChange={(counterId) => patch({ counterId })} />
            <Field
              label={mapped ? `Цель: ${mapped.name}` : "ID цели звонка (ОП для NC, ОС для AFS)"}
              value={row.goalCallId || mapped?.id || ""}
              onChange={(goalCallId) => patch({ goalCallId })}
            />
          </div>
          );
        }}
      />

      <h2 className="mb-4 mt-10 font-display text-xl">Кабинеты Директа</h2>
      <p className="mb-4 text-sm text-mute">
        {settings.rtaDirectTokenFromEnv
          ? "Токен RTA найден в YANDEX_DIRECT_RTA_OAUTH_TOKEN. Поля токена у кабинетов RTA не нужны."
          : "Добавьте YANDEX_DIRECT_RTA_OAUTH_TOKEN в .env и перезапустите npm run dev."}
      </p>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(settings.useLiveDirect)}
          onChange={(e) => setSettings({ ...settings, useLiveDirect: e.target.checked })}
        />
        Тянуть статистику из Директа по кабинетам из таблиц (Tandem / RTA). Включено по умолчанию.
      </label>
      <AccountList
        rows={settings.direct}
        onChange={(direct) => setSettings({ ...settings, direct })}
        onAdd={() => setSettings({ ...settings, direct: [...settings.direct, emptyDirect()] })}
        render={(row, patch) => (
          <div className="grid gap-2 md:grid-cols-2">
            <Field label="Название кабинета" value={row.name} onChange={(name) => patch({ name })} />
            <Field label="Подрядчик" value={row.contractor} onChange={(contractor) => patch({ contractor })} />
            <Field label="Бренд" value={row.brand} onChange={(brand) => patch({ brand })} />
            <label className="text-xs text-mute">
              Направление
              <select
                className="mt-1 w-full border border-white/10 bg-ink-900 px-3 py-2 text-sm text-paper"
                value={row.line}
                onChange={(e) => patch({ line: e.target.value === "afs" ? "afs" : "nc" })}
              >
                <option value="nc">NC · продажи</option>
                <option value="afs">AFS · сервис</option>
              </select>
            </label>
            <Field label="Client-Login" value={row.clientLogin} onChange={(clientLogin) => patch({ clientLogin })} />
            {settings.rtaDirectTokenFromEnv && row.contractor.toLowerCase() === "rta" ? (
              <p className="self-end text-xs text-mute">OAuth RTA берётся из .env</p>
            ) : (
              <Field label="OAuth-токен" value={row.token} onChange={(token) => patch({ token })} password />
            )}
          </div>
        )}
      />

      <h2 className="mb-4 mt-10 font-display text-xl">Кабинеты Calltouch</h2>
      <p className="mb-4 text-sm text-mute">
        {settings.calltouchTokenFromVault
          ? `Токены Calltouch найдены (${settings.hasSecrets?.calltouchFromVault ?? 0} siteId). Поля токена в форме не обязательны.`
          : "Положите токены в data/tokens.json или вставьте в кабинет и сохраните."}
      </p>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(settings.useLiveCalltouch)}
          onChange={(e) => setSettings({ ...settings, useLiveCalltouch: e.target.checked })}
        />
        Тянуть звонки из Calltouch. Включено по умолчанию. Один кабинет = NC и AFS, режем тегами.
      </label>
      <AccountList
        rows={settings.calltouch}
        onChange={(calltouch) => setSettings({ ...settings, calltouch })}
        onAdd={() => setSettings({ ...settings, calltouch: [...settings.calltouch, emptyCalltouch()] })}
        render={(row, patch, i) => (
          <div className="grid gap-2 md:grid-cols-2">
            <Field label="Название ЛК" value={row.name} onChange={(name) => patch({ name })} />
            <Field label="URL / сайт" value={row.url || ""} onChange={(url) => patch({ url })} />
            <Field label="Бренд" value={row.brand} onChange={(brand) => patch({ brand })} />
            <Field label="Подрядчик" value={row.contractor || ""} onChange={(contractor) => patch({ contractor })} />
            <Field label="siteId" value={row.siteId} onChange={(siteId) => patch({ siteId })} />
            <Field
              label={settings.hasSecrets?.calltouch?.[i] ? "API token (в vault)" : "API token"}
              value={row.token}
              onChange={(token) => patch({ token })}
              password
            />
            <p className="md:col-span-2 text-xs text-mute">
              Теги качества общие: NC — {DEFAULT_QUALITY_TAGS.slice(0, 2).join(", ")}; AFS —{" "}
              {DEFAULT_QUALITY_TAGS.slice(2).join(", ")}
            </p>
          </div>
        )}
      />

      <h2 className="mb-4 mt-10 font-display text-xl">Пороги алертов и Telegram</h2>
      <div className="grid gap-2 md:grid-cols-3">
        <Field
          label="Падение CTR, %"
          value={String(settings.thresholds.ctrDropPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, ctrDropPct: Number(v) || 0 } })}
        />
        <Field
          label="Рост CPC, %"
          value={String(settings.thresholds.cpcRisePct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, cpcRisePct: Number(v) || 0 } })}
        />
        <Field
          label="Рост CPL, %"
          value={String(settings.thresholds.cplRisePct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, cplRisePct: Number(v) || 0 } })}
        />
        <Field
          label="Падение доли качества, п.п."
          value={String(settings.thresholds.qualityShareDropPp)}
          onChange={(v) =>
            setSettings({ ...settings, thresholds: { ...settings.thresholds, qualityShareDropPp: Number(v) || 0 } })
          }
        />
        <Field
          label="Рост отказов, п.п."
          value={String(settings.thresholds.bounceRisePp)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, bounceRisePp: Number(v) || 0 } })}
        />
        <Field
          label="Расход без лидов, ₽"
          value={String(settings.thresholds.zeroLeadSpend)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, zeroLeadSpend: Number(v) || 0 } })}
        />
        <Field
          label="Падение звонков, %"
          value={String(settings.thresholds.callsDropPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, callsDropPct: Number(v) || 0 } })}
        />
        <Field
          label="Падение конверсии, %"
          value={String(settings.thresholds.conversionDropPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, conversionDropPct: Number(v) || 0 } })}
        />
        <Field
          label="Рост CPA, %"
          value={String(settings.thresholds.cpaRisePct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, cpaRisePct: Number(v) || 0 } })}
        />
        <Field
          label="Скачок расхода к медиане, %"
          value={String(settings.thresholds.spendSpikePct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, spendSpikePct: Number(v) || 0 } })}
        />
        <Field
          label="Потеря трекинга, %"
          value={String(settings.thresholds.trackingLossPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, trackingLossPct: Number(v) || 0 } })}
        />
        <Field
          label="Перерасход бюджета, %"
          value={String(settings.thresholds.budgetPaceOverPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, budgetPaceOverPct: Number(v) || 0 } })}
        />
        <Field
          label="Недобор РЛ к плану, %"
          value={String(settings.thresholds.planRlUnderPct ?? DEFAULT_THRESHOLDS.planRlUnderPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, planRlUnderPct: Number(v) || 0 } })}
        />
        <Field
          label="Недобор РЛ, critical %"
          value={String(settings.thresholds.planRlCriticalPct ?? DEFAULT_THRESHOLDS.planRlCriticalPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, planRlCriticalPct: Number(v) || 0 } })}
        />
        <Field
          label="CPL выше плана, %"
          value={String(settings.thresholds.planCplOverPct ?? DEFAULT_THRESHOLDS.planCplOverPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, planCplOverPct: Number(v) || 0 } })}
        />
        <Field
          label="CPL выше плана, critical %"
          value={String(settings.thresholds.planCplCriticalPct ?? DEFAULT_THRESHOLDS.planCplCriticalPct)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, planCplCriticalPct: Number(v) || 0 } })}
        />
        <Field
          label="Z-score аномалии (0 выкл.)"
          value={String(settings.thresholds.anomalyZ)}
          onChange={(v) => setSettings({ ...settings, thresholds: { ...settings.thresholds, anomalyZ: Number(v) || 0 } })}
        />
        <Field
          label="Telegram bot token"
          value={settings.telegramBotToken}
          onChange={(telegramBotToken) => setSettings({ ...settings, telegramBotToken })}
          password
        />
        <Field
          label="Telegram chat id"
          value={settings.telegramChatId}
          onChange={(telegramChatId) => setSettings({ ...settings, telegramChatId })}
        />
      </div>
      <p className="mt-2 text-xs text-mute">По умолчанию: CTR −{DEFAULT_THRESHOLDS.ctrDropPct}%, CPC +{DEFAULT_THRESHOLDS.cpcRisePct}%, CPL +{DEFAULT_THRESHOLDS.cplRisePct}%.</p>

      <button type="button" onClick={save} className="mt-8 bg-gold-500 px-5 py-2.5 text-sm text-ink-950">
        Сохранить подключения
      </button>
      {status ? <p className="mt-3 text-sm text-mute">{status}</p> : null}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  password
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  password?: boolean;
}) {
  return (
    <label className="text-xs text-mute">
      {label}
      <input
        type={password ? "password" : "text"}
        className="mt-1 w-full border border-white/10 bg-ink-900 px-3 py-2 text-sm text-paper"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </label>
  );
}

function AccountList<T extends { id: string }>({
  rows,
  onChange,
  onAdd,
  render
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  onAdd: () => void;
  render: (row: T, patch: (part: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <div key={row.id} className="border border-white/[0.08] p-4">
          {render(row, (part) => {
            const next = [...rows];
            next[i] = { ...row, ...part };
            onChange(next);
          }, i)}
          <button
            type="button"
            className="mt-3 text-xs text-rose-300"
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            Удалить
          </button>
        </div>
      ))}
      <button type="button" onClick={onAdd} className="border border-white/15 px-3 py-2 text-xs text-mute">
        Добавить кабинет
      </button>
    </div>
  );
}
