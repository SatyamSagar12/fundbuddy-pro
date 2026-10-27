/**
 * Report charts. SIP and one-time keep the same colour on every chart, so "dark = SIP" learnt once carries over.
 * Every chart has a table twin on the Reports page, so no value depends on hovering.
 */
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inrCompact, type MonthlyPoint, type YearlyPoint } from "@/lib/report-math";
import { money } from "@/lib/format";

export const SIP_COLOR = "#2d3b33";
export const ONE_TIME_COLOR = "#cdae7e";
const GRID = "#e4dfd4";
const axis = { tickLine: false, axisLine: false, tickMargin: 8, tick: { fill: "#5b5850", fontSize: 12 } } as const;
const tooltip = {
  formatter: (v: unknown, name: unknown) => [money(Number(v)), String(name)] as [string, string],
  contentStyle: { borderRadius: 10, border: "1px solid #dcd6ca", fontSize: 13 },
  cursor: { fill: "rgba(30,41,35,0.05)" },
};

/** Legend labels in ink colour: the swatch beside them carries the series colour. */
const legendText = (value: string) => <span style={{ color: "#141613" }}>{value}</span>;

function Empty({ text }: { text: string }) {
  return <div className="flex h-[280px] items-center justify-center text-[15px] text-muted">{text}</div>;
}

export function MonthlyFlowChart({ data }: { data: MonthlyPoint[] }) {
  if (!data.some((d) => d.total > 0)) return <Empty text="No investments in this period" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <Tooltip {...tooltip} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} formatter={legendText} />
        <Bar dataKey="sip" name="SIP" stackId="flow" fill={SIP_COLOR} maxBarSize={24} stroke="#fbfaf7" strokeWidth={2} />
        <Bar dataKey="oneTime" name="One-time" stackId="flow" fill={ONE_TIME_COLOR} maxBarSize={24} radius={[4, 4, 0, 0]} stroke="#fbfaf7" strokeWidth={2} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SipTrendChart({ data }: { data: MonthlyPoint[] }) {
  if (!data.some((d) => d.sip > 0)) return <Empty text="No SIP activity in this period" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 24, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <Tooltip {...tooltip} cursor={{ stroke: GRID }} />
        <Line dataKey="sip" name="SIP" type="monotone" stroke={SIP_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function YearlyTotalsChart({ data }: { data: YearlyPoint[] }) {
  if (!data.length) return <Empty text="No investments recorded yet" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="year" {...axis} />
        <YAxis {...axis} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <Tooltip {...tooltip} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} formatter={legendText} />
        <Bar dataKey="sip" name="SIP" stackId="fy" fill={SIP_COLOR} maxBarSize={28} stroke="#fbfaf7" strokeWidth={2} />
        <Bar dataKey="oneTime" name="One-time" stackId="fy" fill={ONE_TIME_COLOR} maxBarSize={28} radius={[4, 4, 0, 0]} stroke="#fbfaf7" strokeWidth={2} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SchemeMixChart({ data }: { data: { scheme: string; amount: number }[] }) {
  if (!data.length) return <Empty text="No investments recorded yet" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 44 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 4 }} barCategoryGap="26%">
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="scheme"
          {...axis}
          width={170}
          interval={0}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
        />
        <Tooltip {...tooltip} />
        <Bar dataKey="amount" name="Invested" maxBarSize={24} radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.scheme} fill={d.scheme === "Other" ? "#b9b4a8" : SIP_COLOR} />
          ))}
          <LabelList dataKey="amount" position="right" offset={8} fontSize={12} formatter={(v) => inrCompact(Number(v))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
