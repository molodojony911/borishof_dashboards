"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  Bell,
  Cable,
  Gauge,
  Layers,
  LineChart,
  PhoneCall,
  Sparkles,
  MapPin,
  Store,
  Target
} from "lucide-react";
import { FilterBar } from "./FilterBar";
import { buildQuery } from "@/lib/href";

const NAV = [
  { href: "/", label: "Обзор", icon: Gauge },
  { href: "/brands", label: "Бренды", icon: Layers },
  { href: "/campaigns", label: "Реклама", icon: Target },
  { href: "/direct", label: "Директ вглубь", icon: LineChart },
  { href: "/leads", label: "Лиды", icon: PhoneCall },
  { href: "/classifieds", label: "Классифайды", icon: Store },
  { href: "/behavior", label: "Поведение", icon: Activity },
  { href: "/maps", label: "Яндекс Бизнес", icon: MapPin },
  { href: "/insights", label: "Инсайты", icon: Sparkles },
  { href: "/alerts", label: "Алерты", icon: Bell },
  { href: "/setup", label: "Подключение", icon: Cable }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const q = buildQuery(search, {});

  return (
    <div className="min-h-screen bg-ink-950 text-paper">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] border-r border-white/[0.06] bg-ink-900 md:flex md:flex-col">
        <div className="px-5 pb-6 pt-7">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center border border-gold-500/40 bg-gold-500/10 font-display text-sm tracking-[0.18em] text-gold-400">
              БХ
            </div>
            <div>
              <div className="font-display text-[15px] leading-none">Борисхоф</div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-mute">Digital control</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={`${item.href}${q}`}
                className={`mb-0.5 flex items-center gap-3 px-3 py-2.5 text-[13.5px] transition ${
                  active
                    ? "bg-white/[0.06] text-paper"
                    : "text-mute hover:bg-white/[0.03] hover:text-paper"
                }`}
              >
                <Icon size={16} className={active ? "text-gold-400" : ""} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/[0.06] px-5 py-4 text-[11px] leading-relaxed text-mute">
          Tandem · RTA · NC / AFS
          <div className="mt-1">Фильтры действуют на всех экранах</div>
        </div>
      </aside>
      <div className="md:pl-[232px]">
        <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-ink-950/90 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-8">
            <div className="flex items-center gap-2 text-mute md:hidden">
              <LineChart size={16} /> Борисхоф Digital
            </div>
            <PeriodSwitch />
          </div>
          <div className="px-4 pb-3 md:px-8">
            <FilterBar />
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:hidden">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={`${item.href}${q}`}
                  className={`whitespace-nowrap px-3 py-1.5 text-xs ${
                    active ? "bg-paper text-ink-950" : "text-mute"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <div className="px-4 py-6 md:px-8 md:py-8">{children}</div>
      </div>
    </div>
  );
}

function PeriodSwitch() {
  const pathname = usePathname();
  const search = useSearchParams();
  const period = search.get("period") || "14d";
  return (
    <div className="ml-auto flex items-center gap-1 rounded-none border border-white/[0.08] p-1">
      {(["7d", "14d", "30d"] as const).map((key) => (
        <Link
          key={key}
          href={`${pathname}${buildQuery(search, { period: key })}`}
          className={`px-3 py-1.5 text-xs tracking-wide ${
            period === key ? "bg-paper text-ink-950" : "text-mute hover:text-paper"
          }`}
        >
          {key === "7d" ? "7 дней" : key === "14d" ? "14 дней" : "30 дней"}
        </Link>
      ))}
    </div>
  );
}
