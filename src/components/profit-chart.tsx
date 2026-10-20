"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

type Point = { date: string; label: string; profit: number; revenue: number; adSpend: number };

export function ProfitChart({ data, currency }: { data: Point[]; currency: string }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  return (
    <div className="h-56 w-full" role="img" aria-label="Daily profit; the table below lists every value">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={72} />
          <ReferenceLine y={0} stroke="var(--muted)" />
          <Tooltip
            cursor={{ fill: "var(--grid)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <div className="card px-3 py-2 text-xs shadow-sm">
                  <div className="mb-1 font-medium">{p.date}</div>
                  <div className="num">Profit: {fmt(p.profit)}</div>
                  <div className="num text-muted">Revenue: {fmt(p.revenue)}</div>
                  <div className="num text-muted">Ad spend: {fmt(p.adSpend)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="profit" radius={[4, 4, 4, 4]} maxBarSize={28}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.profit >= 0 ? "var(--chart-pos)" : "var(--chart-neg)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
