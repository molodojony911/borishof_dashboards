import type { CalltouchAccount, Line } from "./types";

/**
 * Целевой лид — это связка двух тегов, а не любой из них по отдельности.
 * «Новый звонок» отделяет первое обращение от повторного, второй тег говорит,
 * в какое подразделение человек звонил.
 */
export const NC_QUALITY_TAGS = ["Новый звонок", "Новые А/М"];
export const AFS_QUALITY_TAGS = ["Новый звонок", "Сервис"];

export interface CalltouchCabinet {
  id: string;
  name: string;
  url: string;
  accountId: string;
  siteId: string;
  brand: string;
  contractor: string;
}

/** Публичный справочник кабинетов. Токены — только в data/calltouch-tokens.json */
export const CALLTOUCH_CABINETS: CalltouchCabinet[] = [
  { id: "ct-inchcape", name: "inchcape.ru", url: "inchcape.ru", accountId: "30957", siteId: "46396", brand: "Inchcape", contractor: "" },
  { id: "ct-landrover", name: "LandRover Inchcape", url: "landrover.borishof.ru", accountId: "24714", siteId: "36719", brand: "JLR", contractor: "Tandem" },
  { id: "ct-jaguar", name: "Jaguar Inchcape", url: "jlr-service.borishof.ru", accountId: "24714", siteId: "36720", brand: "JLR", contractor: "Tandem" },
  { id: "ct-bmw", name: "bmw-borishof.ru", url: "bmw-borishof.ru", accountId: "2228", siteId: "2402", brand: "BMW", contractor: "RTA" },
  { id: "ct-mini", name: "sales.mini-borishof.ru", url: "sales.mini-borishof.ru", accountId: "26694", siteId: "39841", brand: "MINI", contractor: "RTA" },
  { id: "ct-used", name: "certified-inchcape.ru", url: "certified-inchcape.ru", accountId: "28297", siteId: "19932", brand: "Авто с пробегом", contractor: "" },
  { id: "ct-hyundai", name: "hyundai.inchcape.ru", url: "hyundai-service.borishof.ru", accountId: "16857", siteId: "23862", brand: "Hyundai", contractor: "Tandem" },
  { id: "ct-genesis", name: "genesis.inchcape.ru", url: "service.borishof-genesis.ru", accountId: "16858", siteId: "23619", brand: "Genesis", contractor: "Tandem" },
  { id: "ct-mitsubishi", name: "mitsubishi-inchcape.ru", url: "mitsubishi-borishof.ru", accountId: "19250", siteId: "27753", brand: "Mitsubishi", contractor: "" },
  { id: "ct-volvo", name: "Volvo Inchcape", url: "7851111.ru", accountId: "1797", siteId: "1852", brand: "Volvo", contractor: "Tandem" },
  { id: "ct-infiniti", name: "infiniti-inchcape.ru", url: "infiniti-borishof.ru", accountId: "20556", siteId: "29938", brand: "Infiniti", contractor: "" },
  { id: "ct-toyota", name: "toyota-vnukovo.ru", url: "toyota-vnukovo.ru", accountId: "1047", siteId: "36282", brand: "TOYOTA", contractor: "Tandem" },
  { id: "ct-leninskiy", name: "leninskiy146.ru", url: "leninskiy146.ru", accountId: "13320", siteId: "16521", brand: "Volt SPB", contractor: "RTA" },
  { id: "ct-exeed", name: "inchcape-exeed.ru", url: "msk-borishof-exeed.ru", accountId: "31882", siteId: "47648", brand: "Exeed + Esteo", contractor: "RTA" },
  { id: "ct-chery", name: "inchcape.chery.ru", url: "promo.chery-borishof.ru", accountId: "31877", siteId: "47639", brand: "CHERY", contractor: "Tandem" },
  { id: "ct-geely", name: "geely-borishof.ru", url: "geely-borishof.ru", accountId: "34890", siteId: "52028", brand: "GEELY", contractor: "RTA" },
  { id: "ct-voyah", name: "borishof-voyah.ru", url: "borishof-voyah.ru", accountId: "37902", siteId: "56257", brand: "VOYAH", contractor: "RTA" },
  { id: "ct-tank", name: "borishof-tank.ru", url: "borishof-tank.ru", accountId: "38773", siteId: "57477", brand: "TANK", contractor: "Tandem" },
  { id: "ct-volt", name: "borishof-volt.ru", url: "borishof-volt.ru", accountId: "39216", siteId: "57974", brand: "VOLT", contractor: "RTA" },
  { id: "ct-haval", name: "borishof-haval.ru", url: "borishof-haval.ru", accountId: "44297", siteId: "64584", brand: "HAVAL", contractor: "Tandem" },
  { id: "ct-haval-pro", name: "borishof-haval.ru PRO", url: "havalpro-borishof.ru", accountId: "44297", siteId: "68260", brand: "HAVAL PRO", contractor: "Tandem" },
  { id: "ct-oting", name: "oting-borishof.ru", url: "oting-borishof.ru", accountId: "44865", siteId: "65223", brand: "Oting", contractor: "" },
  { id: "ct-wey", name: "gwm-wey-borishof.ru", url: "gwm-wey-borishof.ru", accountId: "45264", siteId: "65725", brand: "WEY", contractor: "" },
  { id: "ct-belgee", name: "belgee-borishof.ru", url: "belgee-borishof.ru", accountId: "47595", siteId: "68453", brand: "BELGEE", contractor: "RTA" },
  { id: "ct-lux", name: "БорисХоф Люкс", url: "service.borishof-lux.ru", accountId: "48905", siteId: "70087", brand: "LUX", contractor: "Tandem" },
  { id: "ct-rox", name: "rox-borishof.ru", url: "rox-borishof.ru", accountId: "50971", siteId: "72569", brand: "ROX", contractor: "" },
  { id: "ct-avatr", name: "avatr-borishof.ru", url: "avatr-borishof.ru", accountId: "51393", siteId: "73053", brand: "AVATR", contractor: "" },
  { id: "ct-tenet", name: "ТЕНЕТ ЦЕНТР БОРИСХОФ ЮГО-ЗАПАД", url: "tenet.borishof.ru", accountId: "31877", siteId: "76062", brand: "Tenet", contractor: "Tandem" },
  { id: "ct-nordcross", name: "nordcross.borishof.ru", url: "nordcross.borishof.ru", accountId: "56652", siteId: "79772", brand: "Nordcross", contractor: "" },
  { id: "ct-evolute", name: "borishof-evolute.ru", url: "borishof-evolute.ru", accountId: "37666", siteId: "55963", brand: "Evolute", contractor: "" },
  { id: "ct-esteo", name: "borishof-esteo.ru", url: "borishof-esteo.ru", accountId: "58670", siteId: "82756", brand: "Exeed + Esteo", contractor: "RTA" },
  { id: "ct-gac", name: "gac-moscow.borishof.ru", url: "gac-moscow.borishof.ru", accountId: "59558", siteId: "83989", brand: "GAC", contractor: "" }
];

function normTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .replace(/[\\]/g, "/");
}

/** Первое обращение, а не повторный звонок по той же сделке. */
function isNewCallTag(t: string): boolean {
  return /^нов(ый|ые)\s+звон(ок|ки)$/.test(t);
}

/** Отдел продаж: «Новые А/М», «Новый автомобиль». */
function isNewCarTag(t: string): boolean {
  return /^нов(ый|ые)\s*(а\s*\/?\s*м|авто(мобил[ьяи])?)$/.test(t);
}

function isServiceTag(t: string): boolean {
  return t === "сервис" || t === "service";
}

/**
 * Оба тега обязательны: «Новый звонок» + «Новые А/М» для продаж, «Новый звонок» + «Сервис»
 * для сервиса. Один «Сервис» без «Нового звонка» — это повторное обращение или разговор
 * по текущему заказ-наряду, платить за него как за лид нельзя.
 */
export function classifyCalltouchTags(tags: string[]): { quality: boolean; line: Line | null } {
  const norm = tags.map(normTag);
  if (!norm.some(isNewCallTag)) return { quality: false, line: null };

  const car = norm.some(isNewCarTag);
  const service = norm.some(isServiceTag);
  if (car) return { quality: true, line: "nc" };
  if (service) return { quality: true, line: "afs" };
  return { quality: false, line: null };
}

/**
 * Линия кабинета по адресу сайта. Запасной вариант для звонков без решающих тегов:
 * на одном домене живут и продажи, и сервис, поэтому теги звонка точнее адреса.
 */
export function cabinetLine(url: string): Line | undefined {
  const host = url.toLowerCase();
  if (/service|servis|сервис/.test(host)) return "afs";
  if (/^sales\./.test(host)) return "nc";
  return undefined;
}

export function toCalltouchAccounts(): CalltouchAccount[] {
  return CALLTOUCH_CABINETS.map((cab) => ({
    id: cab.id,
    name: cab.name,
    siteId: cab.siteId,
    token: "",
    brand: cab.brand,
    contractor: cab.contractor,
    url: cab.url,
    line: cabinetLine(cab.url),
    qualityTags: [...NC_QUALITY_TAGS, ...AFS_QUALITY_TAGS]
  }));
}
