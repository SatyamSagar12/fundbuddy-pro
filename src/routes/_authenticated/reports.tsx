import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { clientsQuery, investmentsQuery, sipsQuery } from "@/lib/data";
import { downloadCsv, formatDate, inr } from "@/lib/fundvault";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — FundVault Lite" },
      { name: "description", content: "Per-client investment and SIP reports with CSV export." },
      { property: "og:title", content: "Reports — FundVault Lite" },
      { property: "og:description", content: "Generate client-wise mutual fund reports and export them as CSV." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: investments = [] } = useQuery(investmentsQuery);
  const { data: sips = [] } = useQuery(sipsQuery);
  const [clientId, setClientId] = useState("");

  const client = clients.find((c) => c.id === clientId);
  const rows = investments.filter((i) => i.client_id === clientId);
  const clientSips = sips.filter((s) => s.client_id === clientId);
  const total = rows.reduce((sum, i) => sum + Number(i.amount), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Client-wise investment and SIP summary.</p>
      </header>

      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="min-w-56 flex-1 space-y-2">
            <Label>Select client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={!client}
            onClick={() =>
              downloadCsv(
                `${client?.name.replace(/\s+/g, "-").toLowerCase()}-report.csv`,
                rows.map((i) => ({
                  Client: client?.name,
                  Scheme: i.scheme,
                  Type: i.type,
                  Amount: i.amount,
                  Date: i.date,
                  Mode: i.payment_mode,
                  TransactionID: i.transaction_id ?? "",
                })),
              )
            }
          >
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </CardContent>
      </Card>

      {!client ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Select a client to view their report.</p>
      ) : (
        <div className="space-y-4">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">
                {client.name} · total invested {inr(total)}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scheme</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.scheme}</TableCell>
                      <TableCell>{i.type}</TableCell>
                      <TableCell>{inr(Number(i.amount))}</TableCell>
                      <TableCell>{formatDate(i.date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!rows.length && <p className="py-8 text-center text-sm text-muted-foreground">No data found</p>}
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">SIPs</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scheme</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientSips.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.scheme}</TableCell>
                      <TableCell>{inr(Number(s.amount))}</TableCell>
                      <TableCell>{s.frequency}</TableCell>
                      <TableCell>{s.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!clientSips.length && <p className="py-8 text-center text-sm text-muted-foreground">No data found</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
