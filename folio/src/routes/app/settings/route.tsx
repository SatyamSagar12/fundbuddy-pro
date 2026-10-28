import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings · Anqulas Folio" }] }),
  component: SettingsLayout,
});

function SettingsLayout() {
  const { me } = Route.useRouteContext();
  const tabs = [
    { to: "/app/settings", label: "Practice", exact: true },
    ...(me.role !== "subbroker" ? [{ to: "/app/settings/mail", label: "Email import", exact: false }] : []),
    { to: "/app/settings/team", label: "Team", exact: false },
    { to: "/app/settings/security", label: "Security", exact: false },
    ...(me.role === "owner" ? [{ to: "/app/settings/billing", label: "Billing", exact: false }] : []),
  ] as const;
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-[2.25rem] sm:text-[2.875rem]"><span className="line-mask"><span>Settings</span></span></h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: t.exact }}
            className="-mb-px border-b-2 border-transparent px-3 py-2.5 text-[15px] font-medium whitespace-nowrap text-muted transition-colors hover:text-text"
            activeProps={{ className: "!border-bronze !text-text" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
