"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartDay = {
  date: string;
  label: string;
  gross: number;
  refunds: number;
  revenue: number;
  cogs: number;
  fees: number;
  adSpend: number;
  mediaFee: number;
  expenses: number;
  profit: number;
};

type View = "profit" | "trend" | "cumulative" | "split";
const VIEWS: { id: View; label: string }[] = [
  { id: "profit", label: "Daily profit" },
  { id: "trend", label: "Revenue, costs & profit" },
  { id: "cumulative", label: "Profit so far" },
  { id: "split", label: "Where the money goes" },
];

const SERIES = [
  { key: "revenue", label: "Revenue", color: "var(--chart-1)" },
  { key: "cogs", label: "Cost of goods", color: "var(--chart-2)" },
  { key: "adSpend", label: "Ad spend", color: "var(--chart-3)" },
  { key: "profit", label: "Profit", color: "var(--chart-pos)" },
] as const;

const axis = { fontSize: 11, fill: "var(--muted)" };

/** Interactive charts for a sheet: switch the view, hide series, click a day to open it. */
export function SheetCharts({ data, currency, dayHref }: { data: ChartDay[]; currency: string; dayHref?: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>("profit");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const fmt = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  const open = (date?: string) => date && dayHref && router.push(dayHref.replace("{date}", date));
  const toggle = (key: string) => setHidden((h) => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  let running = 0;
  const cumulative = data.map((d) => ({ ...d, total: (running += d.profit) }));

  const sum = (k: keyof ChartDay) => data.reduce((s, d) => s + (d[k] as number), 0);
  const gross = sum("gross");
  const slices = [
    { name: "Refunds", value: sum("refunds"), color: "var(--chart-4)" },
    { name: "Cost of goods", value: sum("cogs"), color: "var(--chart-2)" },
    { name: "Transaction fees", value: sum("fees"), color: "var(--chart-5)" },
    { name: "Ad spend", value: sum("adSpend"), color: "var(--chart-3)" },
    { name: "Media buyer fee", value: sum("mediaFee"), color: "var(--chart-6)" },
    { name: "Business expenses", value: sum("expenses"), color: "var(--chart-7)" },
    { name: "Profit", value: Math.max(sum("profit"), 0), color: "var(--chart-pos)" },
  ].filter((s) => s.value > 0);
  const loss = sum("profit") < 0;

  const tip = (rows: (d: ChartDay & { total?: number }) => [string, number][]) =>
    function Tip({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) {
      if (!active || !payload?.length) return null;
      const p = payload[0].payload as ChartDay & { total?: number };
      return (
        <div className="card px-3 py-2 text-xs shadow-sm">
          <div className="mb-1 font-medium">{p.date}</div>
          {rows(p).map(([l, v]) => <div key={l} className="num">{l}: {fmt(v)}</div>)}
          {dayHref && <div className="mt-1 text-muted">Click to see this day&apos;s orders</div>}
        </div>
      );
    };

  const common = { data: view === "cumulative" ? cumulative : data, margin: { top: 8, right: 8, bottom: 0, left: 8 }, onClick: (s: { activeLabel?: string | number }) => { const d = data.find((x) => x.label === s?.activeLabel); open(d?.date); } };
  const x = <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />;
  const y = <YAxis tickFormatter={fmt} tick={axis} tickLine={false} axisLine={false} width={72} />;
  const grid = <CartesianGrid vertical={false} stroke="var(--grid)" />;
  const cursor = dayHref ? { cursor: "pointer" } : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} className={`rounded-md px-3 py-1 text-sm ${view === v.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-text"}`}>{v.label}</button>
          ))}
        </div>
        {view === "trend" && (
          <div className="flex flex-wrap gap-2 text-xs">
            {SERIES.map((s) => (
              <button key={s.key} onClick={() => toggle(s.key)} aria-pressed={!hidden.has(s.key)} className={`flex items-center gap-1 rounded-full border border-border px-2 py-0.5 ${hidden.has(s.key) ? "text-muted line-through" : ""}`}>
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />{s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-64 w-full" role="img" aria-label={`${VIEWS.find((v) => v.id === view)?.label} chart; the table below lists every value`} style={cursor}>
        <ResponsiveContainer>
          {view === "profit" ? (
            <BarChart {...common} barCategoryGap={2}>
              {grid}{x}{y}
              <ReferenceLine y={0} stroke="var(--muted)" />
              <Tooltip cursor={{ fill: "var(--grid)" }} content={tip((p) => [["Profit", p.profit], ["Revenue", p.revenue], ["Ad spend", p.adSpend]])} />
              <Bar dataKey="profit" radius={[4, 4, 4, 4]} maxBarSize={28}>
                {data.map((d) => <Cell key={d.date} fill={d.profit >= 0 ? "var(--chart-pos)" : "var(--chart-neg)"} />)}
              </Bar>
            </BarChart>
          ) : view === "trend" ? (
            <LineChart {...common}>
              {grid}{x}{y}
              <ReferenceLine y={0} stroke="var(--muted)" />
              <Tooltip content={tip((p) => SERIES.filter((s) => !hidden.has(s.key)).map((s) => [s.label, p[s.key]] as [string, number]))} />
              {SERIES.filter((s) => !hidden.has(s.key)).map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />)}
            </LineChart>
          ) : view === "cumulative" ? (
            <LineChart {...common}>
              {grid}{x}{y}
              <ReferenceLine y={0} stroke="var(--muted)" />
              <Tooltip content={tip((p) => [["Profit so far", p.total ?? 0], ["That day", p.profit]])} />
              <Line type="monotone" dataKey="total" stroke="var(--chart-pos)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          ) : (
            <PieChart>
              <Tooltip formatter={(v, n) => [`${fmt(Number(v))} · ${gross ? ((Number(v) / gross) * 100).toFixed(1) : 0}% of gross`, n]} />
              <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" />
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1} stroke="var(--surface)">
                {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
      {view === "split" && <p className="text-xs text-muted">Share of gross revenue ({fmt(gross)}) for the month so far.{loss && " The month is at a loss, so there is no profit slice."}</p>}
    </div>
  );
}
