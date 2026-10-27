import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { BarChart3, Home, LogOut, Repeat, Settings, Users, Wallet } from "lucide-react";
import { getMe, logout } from "@/functions/auth";
import { BrandMark } from "@/components/brand";
import { MotionSettle, NavigationProgress } from "@/components/motion";
import { ThemeToggle } from "@/components/theme";

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
  { to: "/app", label: "Home", icon: Home, exact: true, mobile: true },
  { to: "/app/clients", label: "Clients", icon: Users, exact: false, mobile: true },
  { to: "/app/investments", label: "Investments", icon: Wallet, exact: false, mobile: true },
  { to: "/app/sips", label: "SIPs", icon: Repeat, exact: false, mobile: true },
  { to: "/app/reports", label: "Reports", icon: BarChart3, exact: false, mobile: true },
  { to: "/app/settings", label: "Settings", icon: Settings, exact: false, mobile: false },
] as const;

function AppLayout() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const signOut = async () => {
    await logout();
    await navigate({ to: "/login" });
  };
  return (
    <div className="flex min-h-dvh">
      <MotionSettle />
      <NavigationProgress />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-fg"
      >
        Skip to content
      </a>

      {/* Olive in both themes: the sidebar is a brand surface. */}
      <aside className="sticky top-0 hidden h-dvh w-[15.5rem] shrink-0 flex-col border-r border-white/10 bg-ink text-bone lg:flex dark:bg-[#111713]">
        <div className="px-5 pt-6 pb-5">
          <Link to="/app" className="group flex items-center gap-3 rounded-lg">
            <BrandMark className="size-9 transition-transform duration-700 ease-(--ease-out-expo) group-hover:-rotate-6" />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold tracking-[-0.02em]">Anqulas Folio</span>
              <span className="block truncate text-xs text-[#a9b0a5]">{me.practiceName}</span>
            </span>
          </Link>
        </div>
        <p className="eyebrow px-5 pt-2 pb-1 text-[#a9b0a5]/70">Practice</p>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-2">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.exact }}
              className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium tracking-[-0.01em] text-[#a9b0a5] transition-colors duration-300 hover:text-bone"
              activeProps={{ className: "bg-white/[0.08] !text-bone", "aria-current": "page" }}
            >
              {({ isActive }) => (
                <>
                  {/* Bronze tick on the active item. */}
                  <span
                    aria-hidden
                    className={`absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-full bg-bronze-light transition-transform duration-500 ease-(--ease-out-expo) ${isActive ? "scale-y-100" : "scale-y-0"}`}
                  />
                  <n.icon
                    size={17}
                    aria-hidden
                    className={`shrink-0 transition-[color,transform] duration-500 ease-(--ease-out-expo) group-hover:translate-x-0.5 ${isActive ? "text-bronze-light" : "text-[#a9b0a5]/80 group-hover:text-bone"}`}
                  />
                  <span className="transition-transform duration-500 ease-(--ease-out-expo) group-hover:translate-x-0.5">{n.label}</span>
                </>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-sm">
          <p className="truncate font-medium">{me.name}</p>
          <p className="truncate text-xs text-[#a9b0a5]">{me.email}</p>
          <button onClick={signOut} className="mt-3 inline-flex items-center gap-2 text-[13px] text-[#a9b0a5] transition-colors hover:text-bone">
            <LogOut size={15} /> Sign out
          </button>
        </div>
        <div className="flex justify-center border-t border-white/10 p-2.5">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-paper/80 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Link to="/app" className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold tracking-[-0.02em]">Anqulas Folio</span>
              <span className="block truncate text-[12px] text-muted">{me.practiceName}</span>
            </span>
          </Link>
          <div className="flex items-center">
            <Link to="/app/settings" aria-label="Settings" className="rounded-full p-2 text-muted hover:bg-soft hover:text-text">
              <Settings size={19} />
            </Link>
            <button onClick={signOut} aria-label="Sign out" className="rounded-full p-2 text-muted hover:bg-soft hover:text-text">
              <LogOut size={19} />
            </button>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-8 sm:pt-9 lg:px-10 lg:pt-11 lg:pb-14">
          <div className="mx-auto w-full max-w-6xl">
            <PlanBanner />
            <Outlet />
          </div>
        </main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {NAV.filter((n) => n.mobile).map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.exact }}
            className="relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-muted transition-colors"
            activeProps={{ className: "!text-text", "aria-current": "page" }}
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden
                  className={`absolute top-0 h-[2px] w-8 rounded-full bg-bronze transition-transform duration-500 ease-(--ease-out-expo) ${isActive ? "scale-x-100" : "scale-x-0"}`}
                />
                <n.icon size={21} className={isActive ? "text-bronze" : ""} />
                {n.label}
              </>
            )}
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
    <div role="status" className="reveal mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warn-soft px-4 py-3 text-[15px] text-warn ring-1 ring-warn/20">
      <span>{text}</span>
      {me.role === "owner" && (
        <Link to="/app/settings/billing" className="link-draw font-semibold">
          Choose a plan
        </Link>
      )}
    </div>
  );
}
