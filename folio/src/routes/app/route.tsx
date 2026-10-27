import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { Home, LogOut, Settings, Users } from "lucide-react";
import { getMe, logout } from "@/functions/auth";

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    const me = await getMe();
    if (!me) throw redirect({ to: "/login" });
    if (me.step) throw redirect({ to: me.step === "code" ? "/two-factor" : "/two-factor/setup" });
    if (!me.hasPractice) throw redirect({ to: "/no-access" });
    if (me.billing?.state === "locked" && location.pathname !== "/app/settings/billing") {
      throw redirect({ to: me.role === "owner" ? "/app/settings/billing" : "/locked" });
    }
    return { me };
  },
  component: AppLayout,
});

const NAV = [
  { to: "/app", label: "Home", icon: Home, exact: true },
  { to: "/app/clients", label: "Clients", icon: Users, exact: false },
  { to: "/app/settings", label: "Settings", icon: Settings, exact: false },
] as const;

function AppLayout() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const signOut = async () => {
    await logout();
    await navigate({ to: "/login" });
  };
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col bg-ink text-paper lg:flex">
        <div className="px-6 pt-7 pb-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-bronze-light">Anqulas Folio</p>
          <p className="mt-1 truncate text-[15px] font-semibold">{me.practiceName}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.exact }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-paper/75 hover:bg-ink-2 hover:text-paper"
              activeProps={{ className: "bg-ink-2 !text-paper" }}
            >
              <n.icon size={18} /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-6 py-5 text-sm">
          <p className="truncate font-semibold">{me.name}</p>
          <p className="truncate text-paper/60">{me.email}</p>
          <button onClick={signOut} className="mt-3 inline-flex items-center gap-2 text-paper/75 hover:text-paper">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <header className="flex items-center justify-between bg-ink px-4 py-3 text-paper lg:hidden">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bronze-light">Anqulas Folio</p>
          <p className="truncate text-[15px] font-semibold">{me.practiceName}</p>
        </div>
        <button onClick={signOut} aria-label="Sign out" className="p-2 text-paper/80">
          <LogOut size={20} />
        </button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-8 lg:pb-12">
        <PlanBanner />
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-line bg-card lg:hidden">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.exact }}
            className="flex flex-col items-center gap-0.5 py-2.5 text-[12px] font-semibold text-muted"
            activeProps={{ className: "!text-ink" }}
          >
            <n.icon size={22} />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

const DAY = 86400000;

/** Shown when the trial or plan ends within 7 days, or has ended (grace). */
function PlanBanner() {
  const { me } = Route.useRouteContext();
  const b = me.billing;
  if (!b || b.state === "exempt" || b.state === "locked" || !b.endsAt) return null;
  const end = new Date(b.state === "grace" ? b.locksAt! : b.endsAt);
  const daysLeft = Math.ceil((end.getTime() - Date.now()) / DAY);
  if (b.state !== "grace" && daysLeft > 7) return null;
  const text =
    b.state === "grace"
      ? `Your plan has ended. The app closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"} unless it's renewed.`
      : `Your ${b.state === "trial" ? "free trial" : "plan"} ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bronze/40 bg-bronze-light/20 px-4 py-3 text-[15px]">
      <span>{text}</span>
      {me.role === "owner" && (
        <Link to="/app/settings/billing" className="font-semibold text-bronze underline">
          Choose a plan
        </Link>
      )}
    </div>
  );
}
