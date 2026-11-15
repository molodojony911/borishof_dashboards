import { canonicalBrand, sameBrand } from "./brand-alias";
import type { DirectAccount, Line, MetrikaAccount } from "./types";

export interface CatalogAccount {
  id: string;
  brand: string;
  line: Line;
  contractor: "Tandem" | "RTA";
  clientLogin: string;
  /**
   * Логины до переезда на porg-*. В API не запрашиваются: они уже не существуют
   * и дают 8800 «несуществующий логин». Нужны только для сверки со старыми выгрузками.
   */
  legacyLogins?: string[];
  counterIds: string[];
  site: string;
  legalEntity: string;
  monthlyBudget?: number;
  /** Кабинет Директа выключен: в API не ходим, Метрика и Calltouch остаются. */
  skipDirect?: boolean;
}

export const LINE_LABEL: Record<Line, string> = {
  nc: "NC · продажи",
  afs: "AFS · сервис"
};

export const CONTRACTORS = ["Tandem", "RTA"] as const;

/** Справочник холдинга из рабочих таблиц подрядчиков. Токены Директа лежат отдельно, в data/direct-tokens.json. */
export const ACCOUNTS: CatalogAccount[] = [
  {
    id: "tandem-nc-haval",
    brand: "HAVAL",
    line: "nc",
    contractor: "Tandem",
    clientLogin: "porg-r5ukwqyf",
    counterIds: ["96291650"],
    site: "https://haval-borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 1660000
  },
  {
    id: "tandem-nc-haval-pro",
    brand: "HAVAL PRO",
    line: "nc",
    contractor: "Tandem",
    clientLogin: "porg-574mwltn",
    counterIds: ["97993807"],
    site: "https://havalpro-borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 880000
  },
  {
    id: "tandem-nc-toyota",
    brand: "TOYOTA",
    line: "nc",
    contractor: "Tandem",
    clientLogin: "porg-o73nkcpv",
    counterIds: ["92549388"],
    site: "https://sale.toyota-vnukovo.ru/",
    legalEntity: "БорисХоф Т",
    monthlyBudget: 585000
  },
  {
    id: "tandem-nc-tank",
    brand: "TANK",
    line: "nc",
    contractor: "Tandem",
    clientLogin: "porg-p4gfrmf2",
    counterIds: ["94930260"],
    site: "https://tank-borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 2000000
  },
  {
    id: "tandem-nc-chery",
    brand: "CHERY",
    line: "nc",
    contractor: "Tandem",
    clientLogin: "porg-xgxalkro",
    counterIds: ["97568987"],
    site: "https://promo.chery-borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 1000000
  },
  {
    id: "tandem-nc-tenet",
    brand: "Tenet",
    line: "nc",
    contractor: "Tandem",
    clientLogin: "porg-6pl5kcv7",
    counterIds: ["105085067"],
    site: "https://tenet.borishof.ru/",
    legalEntity: "БорисХоф Холдинг"
  },
  {
    id: "tandem-nc-genesis",
    brand: "Genesis",
    line: "nc",
    contractor: "Tandem",
    clientLogin: "porg-aevxylgn",
    counterIds: ["51603650"],
    site: "https://borishof-genesis.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 200000
  },
  {
    id: "tandem-afs-hyundai",
    brand: "Hyundai",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-5zd2hixj",
    counterIds: ["85881348"],
    site: "https://hyundai-service.borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 100000
  },
  {
    id: "tandem-afs-jlr",
    brand: "JLR",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-wk24s5p4",
    counterIds: ["69515182"],
    site: "https://jlr-service.borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 270000
  },
  {
    id: "tandem-afs-volvo",
    brand: "Volvo",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-gxphoyff",
    counterIds: ["78295798"],
    site: "https://service.volvocarborishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 120000
  },
  {
    id: "tandem-afs-haval",
    brand: "HAVAL",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-zao22zyy",
    counterIds: ["96613478"],
    site: "https://service.borishof-haval.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 150000
  },
  {
    id: "tandem-afs-toyota",
    brand: "TOYOTA",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-psilors7",
    counterIds: ["92549388"],
    site: "https://service-toyota-vnukovo.ru/",
    legalEntity: "БорисХоф Т",
    monthlyBudget: 320000
  },
  {
    id: "tandem-afs-tank",
    brand: "TANK",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-subkji2r",
    counterIds: ["94203707"],
    site: "https://service.tank-borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 140000
  },
  {
    id: "tandem-afs-chery",
    brand: "CHERY",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-yby47v44",
    counterIds: ["88249963"],
    site: "https://chery-service.borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 120000
  },
  {
    id: "tandem-afs-genesis",
    brand: "Genesis",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-l7mruozo",
    counterIds: ["51603650"],
    site: "https://service.borishof-genesis.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 50000
  },
  {
    id: "tandem-afs-lux",
    brand: "LUX",
    line: "afs",
    contractor: "Tandem",
    clientLogin: "porg-bhrinyoy",
    counterIds: ["99204519"],
    site: "https://service.borishof-lux.ru/",
    legalEntity: "БорисХоф 1",
    monthlyBudget: 90000
  },
  {
    id: "rta-nc-belgee",
    brand: "BELGEE",
    line: "nc",
    contractor: "RTA",
    clientLogin: "porg-6ucohk2u1",
    legacyLogins: ["porg-fj6hq6gc"],
    counterIds: ["97940886", "101605233"],
    site: "https://sales.belgee-borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 900000,
    skipDirect: true
  },
  {
    id: "rta-nc-voyah",
    brand: "VOYAH",
    line: "nc",
    contractor: "RTA",
    clientLogin: "porg-ihjk25mp",
    legacyLogins: ["pro-borishof-voyah1"],
    counterIds: ["92017205"],
    site: "https://borishof-voyah.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 750000
  },
  {
    id: "rta-nc-bmw",
    brand: "BMW",
    line: "nc",
    contractor: "RTA",
    clientLogin: "porg-al62gud4",
    legacyLogins: ["ad-bmwborishof", "ad-2bmwborishof"],
    counterIds: ["17737411"],
    site: "https://sales.bmw-borishof.ru/",
    legalEntity: "БорисХоф 1",
    monthlyBudget: 1200000
  },
  {
    id: "rta-nc-bmw-import",
    brand: "BMW",
    line: "nc",
    contractor: "RTA",
    clientLogin: "porg-r7o2dpta",
    counterIds: ["46657212"],
    site: "https://sale-borishof-sever.ru/",
    legalEntity: "БорисХоф 1",
    monthlyBudget: 400000
  },
  {
    id: "rta-nc-exeed",
    brand: "Exeed + Esteo",
    line: "nc",
    contractor: "RTA",
    clientLogin: "porg-4uklaahu",
    legacyLogins: ["ad-exeedborishof"],
    counterIds: ["96985437"],
    site: "https://msk-borishof-exeed.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 800000
  },
  {
    id: "rta-nc-geely",
    brand: "GEELY",
    line: "nc",
    contractor: "RTA",
    clientLogin: "porg-vfn74snr",
    legacyLogins: ["pro-borishof-geely"],
    counterIds: ["99143880"],
    site: "https://sale-geely.borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 850000
  },
  {
    id: "rta-afs-bmw",
    brand: "BMW",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-sxtps5rw",
    legacyLogins: ["inchcape-bmw-service-direct"],
    counterIds: ["17737411"],
    site: "https://service.bmw-borishof.ru/",
    legalEntity: "БорисХоф 1",
    monthlyBudget: 180000
  },
  {
    id: "rta-afs-mini",
    brand: "MINI",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-eznvdaev",
    legacyLogins: ["inchcape-bmw-service-direct"],
    counterIds: ["108990602"],
    site: "https://www.mini-borishof.ru/",
    legalEntity: "БорисХоф 1",
    monthlyBudget: 90000
  },
  {
    id: "rta-afs-volt",
    brand: "VOLT",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-bl6po57e",
    legacyLogins: ["pro-borishof-volt-service"],
    counterIds: ["96651343"],
    site: "https://service.borishof-volt.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 140000
  },
  {
    id: "rta-afs-belgee",
    brand: "BELGEE",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-hgofv7oj",
    legacyLogins: ["pro-borishof-belgee-service"],
    counterIds: ["98992128"],
    site: "https://service.belgee-borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 110000,
    skipDirect: true
  },
  {
    id: "rta-afs-voyah",
    brand: "VOYAH",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-qwq7cal2",
    legacyLogins: ["porg-e6zkidvl"],
    counterIds: ["52856116"],
    site: "https://borishof.ru/service/repair/brand-voyah/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 100000
  },
  {
    id: "rta-afs-exeed",
    brand: "Exeed + Esteo",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-7gc3rmkf",
    legacyLogins: ["pro-borishof-exeed-service"],
    counterIds: ["90200341"],
    site: "https://service-borishof-exeed.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 120000
  },
  {
    id: "rta-afs-geely",
    brand: "GEELY",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-ievvw4o7",
    counterIds: ["89965985"],
    site: "https://service-geely.borishof.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 110000
  },
  {
    id: "rta-afs-volt-spb",
    brand: "Volt SPB",
    line: "afs",
    contractor: "RTA",
    clientLogin: "porg-h3s7ftwb",
    legacyLogins: ["pro-borishof-leninskij-service"],
    counterIds: ["96651343"],
    site: "https://service.borishof-volt.ru/",
    legalEntity: "БорисХоф Холдинг",
    monthlyBudget: 80000
  }
];

export const BRANDS = Array.from(new Set(ACCOUNTS.map((a) => a.brand))).sort((a, b) => a.localeCompare(b, "ru"));

/** Цели Метрики и Директа: «Уникальный звонок» (или ближайший аналог, если цели нет). */
export const CALL_GOALS: Record<string, { id: string; name: string }> = {
  "tandem-nc-haval": { id: "322778995", name: "Уникальный звонок" },
  "tandem-nc-haval-pro": { id: "339542632", name: "Уникальный звонок" },
  "tandem-nc-toyota": { id: "284588489", name: "Уникальный звонок" },
  "tandem-nc-tank": { id: "308966440", name: "Уникальный звонок" },
  "tandem-nc-chery": { id: "334794056", name: "Уникальный звонок" },
  "tandem-nc-tenet": { id: "483732429", name: "Уникальный звонок" },
  "tandem-nc-genesis": { id: "201695572", name: "Уникально-целевой звонок" },
  "tandem-afs-hyundai": { id: "225226585", name: "Уникальный звонок" },
  "tandem-afs-jlr": { id: "267925116", name: "Уникальный звонок" },
  "tandem-afs-volvo": { id: "292416009", name: "Уникальный звонок" },
  "tandem-afs-haval": { id: "416372892", name: "Уникальный звонок" },
  "tandem-afs-toyota": { id: "285040391", name: "Уникально-целевой звонок - Сервис" },
  "tandem-afs-tank": { id: "302446690", name: "Уникальный звонок" },
  "tandem-afs-chery": { id: "234244364", name: "Уникальный звонок" },
  "tandem-afs-genesis": { id: "201695572", name: "Уникально-целевой звонок" },
  "tandem-afs-lux": { id: "354128427", name: "Уникальный звонок" },
  "rta-nc-belgee": { id: "338700952", name: "Уникальный звонок" },
  "rta-nc-voyah": { id: "278942699", name: "Уникальный звонок" },
  "rta-nc-bmw": { id: "201383347", name: "Уникальный звонок" },
  "rta-nc-exeed": { id: "329702336", name: "Уникальный звонок" },
  "rta-nc-geely": { id: "353522932", name: "Уникальный звонок" },
  "rta-afs-bmw": { id: "201383347", name: "Уникальный звонок" },
  "rta-afs-mini": { id: "556094133", name: "Все лиды" },
  "rta-afs-volt": { id: "326143971", name: "Уникальный звонок" },
  "rta-afs-belgee": { id: "353148360", name: "Уникальный звонок" },
  "rta-afs-voyah": { id: "267847481", name: "Уникальный звонок" },
  "rta-afs-exeed": { id: "259559820", name: "Уникальный звонок" },
  "rta-afs-geely": { id: "256744763", name: "Уникальный звонок" },
  "rta-afs-volt-spb": { id: "326143971", name: "Уникальный звонок" }
};

export interface DashboardFilter {
  contractor: string;
  line: Line | "";
  brand: string;
}

export function emptyFilter(): DashboardFilter {
  return { contractor: "", line: "", brand: "" };
}

export function parseFilters(get: (key: string) => string | null): DashboardFilter {
  const line = get("line");
  return {
    contractor: get("contractor") || "",
    line: line === "nc" || line === "afs" ? line : "",
    brand: canonicalBrand(get("brand") || "")
  };
}

export function matchAccount(acc: CatalogAccount, f: DashboardFilter): boolean {
  if (f.contractor && acc.contractor !== f.contractor) return false;
  if (f.line && acc.line !== f.line) return false;
  if (f.brand && !sameBrand(acc.brand, f.brand)) return false;
  return true;
}

export function findAccount(login: string, brand?: string): CatalogAccount | undefined {
  const needle = login.toLowerCase();
  return ACCOUNTS.find((a) => {
    const logins = [a.clientLogin, ...(a.legacyLogins || [])].map((x) => x.toLowerCase());
    if (!logins.includes(needle)) return false;
    if (brand && !sameBrand(a.brand, brand)) return false;
    return true;
  });
}

export function toDirectAccounts(tokens: Record<string, string>): DirectAccount[] {
  return ACCOUNTS.filter((acc) => !acc.skipDirect).map((acc) => ({
    id: acc.id,
    name: `${acc.brand} · ${LINE_LABEL[acc.line]} · ${acc.contractor}`,
    token: tokens[acc.contractor] || "",
    clientLogin: acc.clientLogin,
    contractor: acc.contractor,
    brand: acc.brand,
    line: acc.line,
    goalCallId: CALL_GOALS[acc.id]?.id
  }));
}

export function toMetrikaAccounts(token = ""): MetrikaAccount[] {
  const seen = new Set<string>();
  const rows: MetrikaAccount[] = [];
  for (const acc of ACCOUNTS) {
    const goal = CALL_GOALS[acc.id];
    for (const counterId of acc.counterIds) {
      const key = `${counterId}:${acc.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        id: `ym-${acc.id}-${counterId}`,
        name: `${acc.brand} · ${LINE_LABEL[acc.line]}`,
        counterId,
        token,
        goalCallId: goal?.id,
        brand: acc.brand,
        contractor: acc.contractor,
        line: acc.line
      });
    }
  }
  return rows;
}
