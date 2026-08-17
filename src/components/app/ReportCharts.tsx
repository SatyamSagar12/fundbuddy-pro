import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { inr, inrCompact, type MonthlyPoint, type YearlyPoint } from "@/lib/fundvault";

/**
 * Shared chart vocabulary. SIP and One-time keep the same hue everywhere they
 * appear, so a reader who learns "teal = SIP" on one chart carries it to the next.
 */
const flowConfig = {
  sip: { label: "SIP", color: "var(--chart-1)" },
  oneTime: { label: "One-time", color: "var(--chart-2)" },
} satisfies ChartConfig;

const axisProps = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

/** 2px surface-coloured gap between stacked segments — never a border. */
const STACK_GAP = { stroke: "var(--color-card)", strokeWidth: 2 } as const;

function EmptyPlot({ text }: { text: string }) {
  return (
    <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

/**
 * Monthly SIP vs one-time inflow. Stacked columns: the stack total is the month's
 * inflow, the segments split it by type.
 */
export function MonthlyFlowChart({ data }: { data: MonthlyPoint[] }) {
  if (!data.some((d) => d.total > 0)) return <EmptyPlot text="No investments in this period" />;

  return (
    <ChartContainer config={flowConfig} className="aspect-auto h-[300px] w-full">
      <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent formatter={(value, name) => tooltipRow(value, name)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="sip" stackId="flow" fill="var(--color-sip)" maxBarSize={24} {...STACK_GAP} />
        <Bar
          dataKey="oneTime"
          stackId="flow"
          fill="var(--color-oneTime)"
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          {...STACK_GAP}
        />
      </BarChart>
    </ChartContainer>
  );
}

/** Running SIP commitment month over month — a single series, so no legend box. */
export function SipTrendChart({ data }: { data: MonthlyPoint[] }) {
  if (!data.some((d) => d.sip > 0)) return <EmptyPlot text="No SIP activity in this period" />;

  const config = { sip: flowConfig.sip } satisfies ChartConfig;
  const peak = data.reduce((max, d) => (d.sip > max.sip ? d : max), data[0]!);

  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <LineChart data={data} margin={{ top: 24, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <ChartTooltip
          cursor={{ stroke: "var(--color-border)" }}
          content={<ChartTooltipContent formatter={(value, name) => tooltipRow(value, name)} />}
        />
        <Line
          dataKey="sip"
          type="monotone"
          stroke="var(--color-sip)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2 }}
        />
        {/* Mark the peak only — a value on every point goes unread. The dot carries
            a 2px surface ring so it stays legible where it sits on the line. */}
        {peak.sip > 0 && (
          <ReferenceDot
            x={peak.label}
            y={peak.sip}
            r={4}
            fill="var(--color-sip)"
            stroke="var(--color-card)"
            strokeWidth={2}
            isFront
            label={{
              value: inrCompact(peak.sip),
              position: "top",
              offset: 10,
              className: "fill-foreground text-[11px] font-medium",
            }}
          />
        )}
      </LineChart>
    </ChartContainer>
  );
}

/** Financial-year totals, split by investment type. */
export function YearlyTotalsChart({ data }: { data: YearlyPoint[] }) {
  if (!data.length) return <EmptyPlot text="No investments recorded yet" />;

  return (
    <ChartContainer config={flowConfig} className="aspect-auto h-[300px] w-full">
      <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="year" {...axisProps} />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => inrCompact(Number(v))} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent formatter={(value, name) => tooltipRow(value, name)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="sip" stackId="fy" fill="var(--color-sip)" maxBarSize={24} {...STACK_GAP} />
        <Bar
          dataKey="oneTime"
          stackId="fy"
          fill="var(--color-oneTime)"
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          {...STACK_GAP}
        />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Scheme mix. Nominal categories, so every bar takes slot 1 — bar length already
 * encodes the amount; colouring by value would spend the identity channel twice.
 * "Other" is muted so the folded tail reads as a remainder, not a scheme.
 */
export function SchemeMixChart({ data }: { data: { scheme: string; amount: number }[] }) {
  const id = useId();
  if (!data.length) return <EmptyPlot text="No investments recorded yet" />;

  const config = { amount: { label: "Invested", color: "var(--chart-1)" } } satisfies ChartConfig;

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: Math.max(200, data.length * 44 + 40) }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 64, left: 4, bottom: 4 }}
        barCategoryGap="26%"
      >
        <CartesianGrid horizontal={false} stroke="var(--color-border)" />
        <XAxis type="number" hide />
        {/* Width and truncation are paired: the tick must fit on ONE line at this
            width, otherwise Recharts wraps it and the second line is clipped. */}
        <YAxis
          type="category"
          dataKey="scheme"
          {...axisProps}
          width={190}
          interval={0}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent formatter={(value, name) => tooltipRow(value, name)} />}
        />
        <Bar dataKey="amount" maxBarSize={24} radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell
              key={`${id}-${d.scheme}`}
              fill={d.scheme === "Other" ? "var(--color-muted-foreground)" : "var(--chart-1)"}
            />
          ))}
          {/* Values sit outside the bar end, so they are never clipped by a short bar. */}
          <LabelList
            dataKey="amount"
            position="right"
            offset={8}
            className="fill-foreground text-[11px] font-medium"
            formatter={(value: number) => inrCompact(value)}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Tooltip rows keep text in ink tokens; the swatch beside them carries identity. */
function tooltipRow(value: unknown, name: unknown) {
  return (
    <span className="flex w-full justify-between gap-4">
      <span className="text-muted-foreground">{String(name)}</span>
      <span className="font-medium tabular-nums text-foreground">{inr(Number(value))}</span>
    </span>
  );
}
