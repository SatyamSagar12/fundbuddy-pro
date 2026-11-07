import { Link } from "@tanstack/react-router";

/** Clients and Families are two views of the same people: a switch at the top of both lists. */
export function ClientsTabs() {
  const tab =
    "relative rounded-full px-4 py-1.5 text-[14px] font-medium text-muted transition-colors hover:text-text";
  return (
    <nav aria-label="Clients or families" className="reveal inline-flex rounded-full bg-soft p-1 ring-1 ring-line">
      <Link to="/app/clients" activeOptions={{ exact: true }} className={tab} activeProps={{ className: "bg-card !text-text shadow-xs", "aria-current": "page" }}>
        Clients
      </Link>
      <Link to="/app/families" className={tab} activeProps={{ className: "bg-card !text-text shadow-xs", "aria-current": "page" }}>
        Families
      </Link>
    </nav>
  );
}
