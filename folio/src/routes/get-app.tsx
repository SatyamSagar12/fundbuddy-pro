import { createFileRoute, Link } from "@tanstack/react-router";
import { getAppPage } from "@/functions/get-app";
import { AndroidSteps, IosSteps, usePlatform } from "@/components/get-app";
import { Card } from "@/components/ui";

export const Route = createFileRoute("/get-app")({
  loader: () => getAppPage(),
  head: () => ({ meta: [{ title: "Get the FundVault app · Anqulas Folio" }, { name: "robots", content: "index, follow" }] }),
  component: GetAppPage,
});

function GetAppPage() {
  const d = Route.useLoaderData();
  const platform = usePlatform();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="flex items-center gap-4">
        <img src="/icons/icon-192.png" alt="" className="size-16 rounded-2xl" />
        <div>
          <h1 className="text-[2.25rem] leading-tight">FundVault</h1>
          <p className="text-muted">Anqulas Folio on your phone: clients, SIPs, values and who to call today.</p>
        </div>
      </div>
      {platform === "installed" && <Card>FundVault is already installed on this phone. </Card>}
      {platform === "desktop" && (
        <Card className="flex flex-wrap items-center gap-6">
          <div className="rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
          <div className="min-w-56 flex-1">
            <h2 className="text-lg font-semibold">Scan with your phone's camera</h2>
            <p className="mt-1 text-[15px] text-muted">It opens this page on the phone, with the right steps for Android or iPhone.</p>
            <p className="mt-2 text-[13px] break-all text-muted">{d.url}</p>
          </div>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className={platform === "ios" ? "opacity-60" : ""}>
          <h2 className="mb-3 text-lg font-semibold">Android</h2>
          <AndroidSteps />
        </Card>
        <Card className={platform === "android" ? "opacity-60" : platform === "ios" ? "order-first" : ""}>
          <h2 className="mb-3 text-lg font-semibold">iPhone</h2>
          <IosSteps />
          <p className="mt-3 text-[13px] text-muted">Apple doesn't allow app downloads outside the App Store, so on iPhone FundVault is added from Safari instead. It works the same.</p>
        </Card>
      </div>
      <p className="text-[15px]">
        <Link to="/app" className="font-medium text-bronze">
          Open Anqulas Folio in the browser instead
        </Link>
      </p>
    </main>
  );
}
