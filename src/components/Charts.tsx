"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, num, pct } from "@/lib/format";
import type { DailyPoint, FunnelStep } from "@/lib/types";

const axis = { fill: "#9AA3B2", fontSize: 11 };
const grid = { stroke: "rgba(237,234,227,0.06)" };

export function TrendChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(8)} tick={axis} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="spend"
            tick={axis}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${Math.round(Number(v) / 1000)}к`}
          />
          <YAxis
            yAxisId="visits"
            orientation="right"
            tick={axis}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => num(Number(v))}
          />
          <Tooltip
            contentStyle={{ background: "#12151C", border: "1px solid rgba(255,255,255,0.08)", fontSize: 12 }}
            formatter={(value, name) => {
              const v = Number(value);
              if (name === "spend") return [money(v), "Расход"];
              if (name === "visits") return [num(v), "Визиты"];
              return [num(v), name === "qualityLeads" ? "Качественные лиды" : name === "totalLeads" ? "Уникальные звонки" : String(name)];
            }}
            labelFormatter={(l) => `Дата ${l}`}
          />
          <Area yAxisId="spend" type="monotone" dataKey="spend" stroke="#C4A35A" fill="#C4A35A22" strokeWidth={1.6} />
          <Area yAxisId="visits" type="monotone" dataKey="visits" stroke="#9AA3B2" fill="#9AA3B218" strokeWidth={1.2} />
        </AreaChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-mute">Расход Директа (золотой, слева) и визиты Метрики (серый, справа), по дням.</p>
    </div>
  );
}

function logShare(value: number, top: number): number {
  if (top <= 0) return 0;
  const share = Math.log10(Math.max(value, 0) + 1) / Math.log10(top + 1);
  return Math.max(0, Math.min(1, share));
}

export function FunnelChart({ data }: { data: FunnelStep[] }) {
  const steps = data.filter((step) => step);
  const top = Math.max(...steps.map((step) => step.value), 1);

  return (
    <div className="w-full">
      <div className="space-y-0">
        {steps.map((step, i) => {
          const prev = i === 0 ? step.value : steps[i - 1].value;
          const crFromPrev = prev ? (step.value / prev) * 100 : 0;
          const shareOfTop = top ? (step.value / top) * 100 : 0;
          const fill = step.value <= 0 ? 0 : Math.max(logShare(step.value, top) * 100, 12);
          const last = i === steps.length - 1;
          const bar = last ? "bg-[#C4A35A]" : "bg-[#8A93A3]";

          return (
            <div key={step.id}>
              {i > 0 && (
                <div className="flex items-center gap-3 py-2.5 pl-1">
                  <div className="text-[#C4A35A]">↓</div>
                  <div className="text-sm">
                    <span className="font-display text-lg text-paper">{pct(crFromPrev, 2)}</span>
                    <span className="ml-2 text-mute">конверсия с предыдущего шага</span>
                  </div>
                </div>
              )}
              <div className="border border-white/[0.08] bg-[#0E1116] px-4 py-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-mute">{step.name}</div>
                    <div className="mt-1 font-display text-[28px] leading-none">{num(step.value)}</div>
                  </div>
                  <div className="pb-0.5 text-right text-[11px] text-mute">
                    <div className="text-paper/80">{pct(shareOfTop, 2)} от визитов</div>
                    {i > 0 ? <div className="mt-1">было {num(step.previous)}</div> : <div className="mt-1">база воронки</div>}
                  </div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden bg-white/[0.06]">
                  <div className={`h-full ${bar}`} style={{ width: `${fill}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-mute">
        Визит → лиды Метрики → качественные лиды Calltouch. Ширина полосы сжата по логарифму, чтобы лиды были видны рядом с визитами; проценты — фактические.
      </p>
    </div>
  );
}
