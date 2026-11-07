/**
 * Report charts. SIP and one-time keep the same colour on every chart, so "dark = SIP" learnt once carries over.
 * Every chart has a table twin on the Reports page, so no value depends on hovering.
 */
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inrCompact, type MonthlyPoint, type YearlyPoint } from "@/lib/report-math";
import { money } from "@/lib/format";

import { useEffect, useState } from "react";

const LIGHT = { sip: "#2d3b33", oneTime: "#cdae7e", other: "#b9b4a8", grid: "#e4dfd4", tick: "#615d56", text: "#0d0d0c", card: "#fbfaf7", border: "rgb(30 41 35 / 0.13)", cursor: "rgba(30,41,35,0.05)" };
const DARK = { sip: "#93c39c", oneTime: "#cdae7e", other: "#5d655f", grid: "rgba(242,239,232,0.08)", tick: "#a4ab9f", text: "#f1ede4", card: "#1c2520", border: "rgba(242,239,232,0.11)", cursor: "rgba(242,239,232,0.05)" };

/** Chart colours for the current theme (charts draw SVG attributes, which can't read CSS variables). */
function usePalette() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const c = dark ? DARK : LIGHT;
  return {
    ...c,
    /** Charts keep their first colours, so they are drawn afresh when the theme changes. */
    key: dark ? "dark" : "light",
    axis: { tickLine: false, axisLine: false, tickMargin: 8, tick: { fill: c.tick, fontSize: 12 } } as const,
    tooltip: {
      formatter: (v: unknown, name: unknown) => [money(Number(v)), String(name)] as [string, string],
      contentStyle: { borderRadius: 10, border: `1px solid ${c.border}`, fontSize: 13, background: c.card, color: c.text },
      cursor: { fill: c.cursor },
    },
    legendText: (value: string) => <span style={{ color: c.text }}>{value}</span>,
  };
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-[280px] items-center justify-center text-[15px] text-muted">{text}</div>;
}

export function MonthlyFlowChart({ data }: { data: MonthlyPoint[] }) {
  const c = usePalette();
  if (!data.some((d) => d.total > 0)) return <Empty text="No investments in this period" />;
  return (
    <ResponsiveContainer key={c.key} width="100%" height={300}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...c.axis} interval="preserveStartEnd" />
        <YAxis {...c.axis} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <Tooltip {...c.tooltip} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} formatter={c.legendText} />
        <Bar dataKey="sip" name="SIP" stackId="flow" fill={c.sip} maxBarSize={24} stroke={c.card} strokeWidth={2} />
        <Bar dataKey="oneTime" name="One-time" stackId="flow" fill={c.oneTime} maxBarSize={24} radius={[4, 4, 0, 0]} stroke={c.card} strokeWidth={2} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SipTrendChart({ data }: { data: MonthlyPoint[] }) {
  const c = usePalette();
  if (!data.some((d) => d.sip > 0)) return <Empty text="No SIP activity in this period" />;
  return (
    <ResponsiveContainer key={c.key} width="100%" height={300}>
      <LineChart data={data} margin={{ top: 24, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...c.axis} interval="preserveStartEnd" />
        <YAxis {...c.axis} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <Tooltip {...c.tooltip} cursor={{ stroke: c.grid }} />
        <Line dataKey="sip" name="SIP" type="monotone" stroke={c.sip} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function YearlyTotalsChart({ data }: { data: YearlyPoint[] }) {
  const c = usePalette();
  if (!data.length) return <Empty text="No investments recorded yet" />;
  return (
    <ResponsiveContainer key={c.key} width="100%" height={300}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="year" {...c.axis} />
        <YAxis {...c.axis} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <Tooltip {...c.tooltip} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} formatter={c.legendText} />
        <Bar dataKey="sip" name="SIP" stackId="fy" fill={c.sip} maxBarSize={28} stroke={c.card} strokeWidth={2} />
        <Bar dataKey="oneTime" name="One-time" stackId="fy" fill={c.oneTime} maxBarSize={28} radius={[4, 4, 0, 0]} stroke={c.card} strokeWidth={2} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SchemeMixChart({ data }: { data: { scheme: string; amount: number }[] }) {
  const c = usePalette();
  if (!data.length) return <Empty text="No investments recorded yet" />;
  return (
    <ResponsiveContainer key={c.key} width="100%" height={Math.max(200, data.length * 44 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 4 }} barCategoryGap="26%">
        <CartesianGrid horizontal={false} stroke={c.grid} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="scheme"
          {...c.axis}
          width={170}
          interval={0}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
        />
        <Tooltip {...c.tooltip} />
        <Bar dataKey="amount" name="Invested" maxBarSize={24} radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.scheme} fill={d.scheme === "Other" ? c.other : c.sip} />
          ))}
          <LabelList dataKey="amount" position="right" offset={8} fontSize={12} formatter={(v) => inrCompact(Number(v))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
