import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clientsQuery, investmentsQuery } from "@/lib/data";
import { formatDate, inr, investmentSchema } from "@/lib/fundvault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/investments")({
  head: () => ({
    meta: [
      { title: "Investments — FundVault Lite" },
      { name: "description", content: "Record mutual fund investments with scheme, amount, payment mode and transaction ID." },
      { property: "og:title", content: "Investments — FundVault Lite" },
      { property: "og:description", content: "Transaction book for client mutual fund investments." },
    ],
  }),
  component: InvestmentsPage,
});

const EMPTY = {
  client_id: "",
  scheme: "",
  type: "One-time",
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  payment_mode: "Online",
  transaction_id: "",
};

function InvestmentsPage() {
  const qc = useQueryClient();
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: investments = [], isLoading } = useQuery(investmentsQuery);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "—";

  const save = useMutation({
    mutationFn: async () => {
      const parsed = investmentSchema.parse(form);
      const { error } = await supabase.from("investments").insert({
        ...parsed,
        transaction_id: parsed.transaction_id || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investments"] });
      toast.success("Investment saved");
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e: Error) => toast.error(e.message.includes("\n") ? "Please fill required fields" : "Something went wrong"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("investments").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investments"] });
      toast.success("Investment removed");
    },
    onError: () => toast.error("Something went wrong"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = investmentSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please fill required fields");
      return;
    }
    save.mutate();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Investments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {investments.length} transactions · {inr(investments.reduce((s, i) => s + Number(i.amount), 0))} invested
          </p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!clients.length}>
          <Plus className="mr-2 h-4 w-4" /> Add New
        </Button>
      </header>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Scheme</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="hidden lg:table-cell">Mode</TableHead>
                <TableHead className="hidden lg:table-cell">Txn ID</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {investments.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{clientName(i.client_id)}</TableCell>
                  <TableCell>{i.scheme}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{i.type}</Badge>
                  </TableCell>
                  <TableCell>{inr(Number(i.amount))}</TableCell>
                  <TableCell className="hidden sm:table-cell">{formatDate(i.date)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{i.payment_mode}</TableCell>
                  <TableCell className="hidden lg:table-cell">{i.transaction_id ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove.mutate(i.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!isLoading && !investments.length && (
            <div className="flex flex-col items-center gap-3 py-12">
              <p className="text-sm text-muted-foreground">No data found</p>
              <Button variant="outline" onClick={() => setOpen(true)} disabled={!clients.length}>
                <Plus className="mr-2 h-4 w-4" /> Add New
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add investment</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Client *</Label>
              <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
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
            <div className="space-y-2">
              <Label>Scheme name *</Label>
              <Input value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Investment type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SIP">SIP</SelectItem>
                    <SelectItem value="One-time">One-time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Payment mode</Label>
                <Select value={form.payment_mode} onValueChange={(v) => setForm({ ...form, payment_mode: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Online">Online</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Transaction ID</Label>
              <Input value={form.transaction_id} onChange={(e) => setForm({ ...form, transaction_id: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save investment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
