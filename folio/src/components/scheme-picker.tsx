/**
 * Scheme name field with suggestions from the AMFI list. Picking one links the entry to that scheme (hidden
 * `instrumentId`), so it gets units and a current value. Typing a name without picking still works: a certain
 * match is linked when saved, and anything else can be matched later on the "Match schemes" page.
 */
import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { findSchemes } from "@/functions/schemes";
import { navText } from "@/lib/format";

type Hit = Awaited<ReturnType<typeof findSchemes>>[number];

export function SchemePicker({ initialName, initialId }: { initialName: string; initialId: string | null }) {
  const id = useId();
  const [text, setText] = useState(initialName);
  const [picked, setPicked] = useState<string>(initialId ?? "");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);

  useEffect(() => {
    if (picked || text.trim().length < 3) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(() => {
      findSchemes({ data: { q: text } })
        .then((r) => n === seq.current && setHits(r))
        .catch(() => n === seq.current && setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [text, picked]);

  function choose(h: Hit) {
    setText(h.name);
    setPicked(h.id);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-semibold">
        Scheme
      </label>
      <input
        id={id}
        name="scheme"
        value={text}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={`${id}-list`}
        placeholder="Type to search, e.g. HDFC Flexi Cap"
        className="block min-h-12 w-full rounded-lg border border-line bg-white px-3.5 text-[17px] outline-none transition-colors focus:border-bronze"
        onChange={(e) => {
          setText(e.target.value);
          setPicked("");
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !hits.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            choose(hits[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <input type="hidden" name="instrumentId" value={picked} />
      {picked ? (
        <p className="flex items-center gap-1.5 text-sm text-good">
          <CheckCircle2 size={15} /> Linked to the AMFI scheme: units and value are worked out from its NAV.
        </p>
      ) : (
        <p className="text-sm text-muted">Pick from the list to track its value. A typed name can be matched later.</p>
      )}
      {open && hits.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
          {hits.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3.5 py-2.5 ${i === active ? "bg-paper" : "hover:bg-paper"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
            >
              <p className="text-[15px] font-semibold leading-snug">{h.name}</p>
              <p className="text-[13px] text-muted">
                {[h.category, h.nav !== null ? `NAV ${navText(h.nav)}` : null].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
