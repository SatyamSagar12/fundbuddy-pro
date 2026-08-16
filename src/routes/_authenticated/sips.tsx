import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clientsQuery, sipsQuery } from "@/lib/data";
import { formatDate, inr, sipSchema } from "@/lib/fundvault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/sips")({
  head: () => ({
    meta: [
      { title: "SIPs — FundVault Lite" },
      { name: "description", content: "Track systematic investment plans by client, scheme, frequency and status." },
      { property: "og:title", content: "SIPs — FundVault Lite" },
      { property: "og:description", content: "Active and paused SIP register for your clients." },
    ],
  }),
  component: SipsPage,
});

const EMPTY = {
  client_id: "",
  scheme: "",
  amount: "",
  frequency: "Monthly",
  start_date: new Date().toISOString().slice(0, 10),
  status: "Active",
};

function SipsPage() {
  const qc = useQueryClient();
  const { data: clients = [] } = useQuery(clientsQuery);
  const { data: sips = [], isLoading } = useQuery(sipsQuery);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "—";

  const save = useMutation({
    mutationFn: async () => {
      const parsed = sipSchema.parse(form);
      const { error } = await supabase.from("sips").insert(parsed);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sips"] });
      toast.success("SIP saved");
      setOpen(false);
      setForm(EMPTY);
    },
    onError: () => toast.error("Something went wrong"),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("sips").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sips"] }),
    onError: () => toast.error("Something went wrong"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sips").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sips"] });
      toast.success("SIP removed");
    },
    onError: () => toast.error("Something went wrong"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = sipSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please fill required fields");
      return;
    }
    save.mutate();
  }

  const monthly = sips
    .filter((s) => s.status === "Active" && s.frequency === "Monthly")
    .reduce((sum, s) => sum + Number(s.amount), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">SIPs</h1>
          <p className="mt-1 text-sm text-muted-foreground">{inr(monthly)} active monthly inflow</p>
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
                <TableHead>Amount</TableHead>
                <TableHead className="hidden sm:table-cell">Frequency</TableHead>
                <TableHead className="hidden md:table-cell">Start date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sips.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{clientName(s.client_id)}</TableCell>
                  <TableCell>{s.scheme}</TableCell>
                  <TableCell>{inr(Number(s.amount))}</TableCell>
                  <TableCell className="hidden sm:table-cell">{s.frequency}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(s.start_date)}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggle.mutate({ id: s.id, status: s.status === "Active" ? "Paused" : "Active" })}
                    >
                      <Badge variant={s.status === "Active" ? "default" : "secondary"}>{s.status}</Badge>
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => remove.mutate(s.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!isLoading && !sips.length && (
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
            <DialogTitle>Add SIP</DialogTitle>
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
              <Label>Scheme *</Label>
              <Input value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>SIP amount *</Label>
                <Input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save SIP"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
