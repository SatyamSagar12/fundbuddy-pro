import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clientsQuery, investmentsQuery, sipsQuery, type Client } from "@/lib/data";
import { clientSchema, formatDate, inr } from "@/lib/fundvault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({
    meta: [
      { title: "Clients — FundVault Lite" },
      { name: "description", content: "Add, search, edit and manage mutual fund clients with nominee, PAN and contact details." },
      { property: "og:title", content: "Clients — FundVault Lite" },
      { property: "og:description", content: "Client master for your mutual fund advisory practice." },
    ],
  }),
  component: ClientsPage,
});

const EMPTY = {
  name: "",
  mobile: "",
  email: "",
  address: "",
  pan: "",
  nominee_name: "",
  nominee_dob: "",
};

function ClientsPage() {
  const qc = useQueryClient();
  const { data: clients = [], isLoading } = useQuery(clientsQuery);
  const { data: investments = [] } = useQuery(investmentsQuery);
  const { data: sips = [] } = useQuery(sipsQuery);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Client | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q) || c.mobile.includes(q));
  }, [clients, search]);

  const save = useMutation({
    mutationFn: async (values: typeof EMPTY) => {
      const payload = {
        ...values,
        pan: values.pan ? values.pan.toUpperCase() : null,
        email: values.email || null,
        address: values.address || null,
        nominee_name: values.nominee_name || null,
        nominee_dob: values.nominee_dob || null,
      };
      const res = editing
        ? await supabase.from("clients").update(payload).eq("id", editing.id)
        : await supabase.from("clients").insert(payload);
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success(editing ? "Client updated" : "Client added");
      setOpen(false);
      setEditing(null);
      setForm(EMPTY);
    },
    onError: () => toast.error("Something went wrong"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Client deleted");
    },
    onError: () => toast.error("Something went wrong"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = clientSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please fill required fields");
      return;
    }
    save.mutate(form);
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      name: c.name,
      mobile: c.mobile,
      email: c.email ?? "",
      address: c.address ?? "",
      pan: c.pan ?? "",
      nominee_name: c.nominee_name ?? "",
      nominee_dob: c.nominee_dob ?? "",
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">{clients.length} client records</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add New
        </Button>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name or mobile"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden sm:table-cell">PAN</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.mobile}</TableCell>
                  <TableCell className="hidden md:table-cell">{c.email ?? "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{c.pan ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label="View" onClick={() => setViewing(c)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete"
                        onClick={() => {
                          if (confirm(`Delete ${c.name}? This also removes their investments and SIPs.`))
                            remove.mutate(c.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!isLoading && !filtered.length && (
            <div className="flex flex-col items-center gap-3 py-12">
              <p className="text-sm text-muted-foreground">No data found</p>
              <Button variant="outline" onClick={openAdd}>
                <Plus className="mr-2 h-4 w-4" /> Add New
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit client" : "Add client"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name *">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Mobile number *">
                <Input value={form.mobile} maxLength={10} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="PAN number">
                <Input
                  value={form.pan}
                  maxLength={10}
                  placeholder="ABCDE1234F"
                  onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Nominee name">
                <Input value={form.nominee_name} onChange={(e) => setForm({ ...form, nominee_name: e.target.value })} />
              </Field>
              <Field label="Nominee date of birth">
                <Input type="date" value={form.nominee_dob} onChange={(e) => setForm({ ...form, nominee_dob: e.target.value })} />
              </Field>
            </div>
            <Field label="Address">
              <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save client"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-3">
                <Detail label="Mobile" value={viewing.mobile} />
                <Detail label="Email" value={viewing.email ?? "—"} />
                <Detail label="PAN" value={viewing.pan ?? "—"} />
                <Detail label="Nominee" value={viewing.nominee_name ?? "—"} />
                <Detail label="Nominee DOB" value={formatDate(viewing.nominee_dob)} />
                <Detail label="Address" value={viewing.address ?? "—"} />
              </dl>
              <div>
                <p className="mb-2 font-medium">Investments</p>
                {investments.filter((i) => i.client_id === viewing.id).map((i) => (
                  <p key={i.id} className="text-muted-foreground">
                    {i.scheme} — {inr(Number(i.amount))} · {formatDate(i.date)}
                  </p>
                ))}
                {!investments.some((i) => i.client_id === viewing.id) && (
                  <p className="text-muted-foreground">No data found</p>
                )}
              </div>
              <div>
                <p className="mb-2 font-medium">SIPs</p>
                {sips.filter((s) => s.client_id === viewing.id).map((s) => (
                  <p key={s.id} className="text-muted-foreground">
                    {s.scheme} — {inr(Number(s.amount))} · {s.frequency} · {s.status}
                  </p>
                ))}
                {!sips.some((s) => s.client_id === viewing.id) && (
                  <p className="text-muted-foreground">No data found</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
