import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — FundVault Lite" },
      { name: "description", content: "Sign in to FundVault Lite to manage mutual fund clients, investments and SIPs." },
      { property: "og:title", content: "Sign in — FundVault Lite" },
      { property: "og:description", content: "Advisor login for the FundVault Lite mutual fund management system." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Something went wrong");
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Please fill required fields");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Something went wrong");
      return;
    }
    toast.success("Account created. You can sign in now.");
  }

  async function googleSignIn() {
    const { lovable } = await import("@/integrations/lovable/index");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Something went wrong");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-brand-foreground">
          <h1 className="text-3xl font-bold">FundVault Lite</h1>
          <p className="mt-1 text-sm opacity-70">Mutual Fund Management System</p>
        </div>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Advisor access</CardTitle>
            <CardDescription>Sign in to manage clients, investments and SIPs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="mb-4 grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={signIn} className="space-y-4">
                  <Field label="Email">
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="advisor@firm.com" />
                  </Field>
                  <Field label="Password">
                    <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  </Field>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={signUp} className="space-y-4">
                  <Field label="Full name">
                    <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
                  </Field>
                  <Field label="Email">
                    <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="advisor@firm.com" />
                  </Field>
                  <Field label="Password">
                    <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 6 characters" />
                  </Field>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating…" : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="outline" className="w-full" onClick={googleSignIn}>
              Continue with Google
            </Button>
          </CardContent>
        </Card>
      </div>
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
