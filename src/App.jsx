import { useState, useMemo, useEffect, useRef } from "react";
import data from "./data.json";

/* ---------- helpers ---------- */

const MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const DOW = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = DOW[new Date(y, m - 1, d).getDay()];
  return { wd: wd[0].toUpperCase() + wd.slice(1), full: `${d} ${MONTHS[m - 1]} ${y}` };
}

// Split "AUX C1 #6725" or "*C4 INF #6728" -> { star, label, code }
function parseOffice(name) {
  const star = name.startsWith("*");
  const clean = star ? name.slice(1).trim() : name;
  const hash = clean.indexOf("#");
  if (hash === -1) return { star, label: clean, code: "" };
  return { star, label: clean.slice(0, hash).trim(), code: clean.slice(hash) };
}

function isExternal(person) {
  return /EXTERNE/i.test(person);
}
function personLabel(person) {
  return person.replace(/\s*-\s*EXTERNE/i, "").trim();
}

const TODAY = "2026-06-29";

/* ---------- small components ---------- */

function SlotBadge({ slot }) {
  return <span className={`slot slot--${slot.toLowerCase()}`}>{slot}</span>;
}

function OccupancyMeter({ slot, pct }) {
  const n = pct ? parseInt(pct, 10) : 0;
  const tone = n >= 80 ? "high" : n >= 40 ? "mid" : "low";
  return (
    <div className="meter">
      <div className="meter__head">
        <SlotBadge slot={slot} />
        <span className="meter__val">{pct || "0%"}</span>
      </div>
      <div className="meter__track">
        <div className={`meter__fill meter__fill--${tone}`} style={{ width: `${n}%` }} />
      </div>
    </div>
  );
}

function Tag({ children }) {
  return <span className="tag">{children}</span>;
}

/* ---------- views ---------- */

function DayView({ dateIdx, setDateIdx, goPerson }) {
  const dates = data.dates;
  const meta = dates[dateIdx];
  const pd = prettyDate(meta.iso);
  const occ = data.occupancy[meta.iso] || {};
  const assign = data.assignments[meta.iso] || {};

  const freeCount = data.slots.reduce((acc, s) => {
    const a = assign[s] || {};
    return acc + data.offices.filter((o) => !a[o]).length;
  }, 0);

  return (
    <div>
      <div className="daybar">
        <button className="navbtn" onClick={() => setDateIdx(Math.max(0, dateIdx - 1))} disabled={dateIdx === 0} aria-label="Jour précédent">‹</button>
        <div className="daybar__center">
          <div className="daybar__wd">{pd.wd}</div>
          <div className="daybar__full">{pd.full}</div>
        </div>
        <button className="navbtn" onClick={() => setDateIdx(Math.min(dates.length - 1, dateIdx + 1))} disabled={dateIdx === dates.length - 1} aria-label="Jour suivant">›</button>
      </div>

      <div className="daytools">
        <input
          className="dateinput"
          type="date"
          value={meta.iso}
          min={dates[0].iso}
          max={dates[dates.length - 1].iso}
          onChange={(e) => {
            const i = dates.findIndex((x) => x.iso === e.target.value);
            if (i !== -1) setDateIdx(i);
          }}
        />
        <button className="ghostbtn" onClick={() => {
          const i = dates.findIndex((x) => x.iso === TODAY);
          setDateIdx(i !== -1 ? i : 0);
        }}>Aujourd’hui</button>
      </div>

      <div className="meters">
        {data.slots.map((s) => <OccupancyMeter key={s} slot={s} pct={occ[s]} />)}
      </div>

      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="grid__office">Local</th>
              {data.slots.map((s) => (
                <th key={s} className="grid__slot">{data.slotLabels[s]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.offices.map((office) => {
              const po = parseOffice(office);
              return (
                <tr key={office}>
                  <th className="grid__office" scope="row">
                    <span className="office__label">
                      {po.star && <span className="office__star" title="Local prioritaire">★</span>}
                      {po.label}
                    </span>
                    {po.code && <span className="office__code">{po.code}</span>}
                  </th>
                  {data.slots.map((s) => {
                    const person = (assign[s] || {})[office];
                    if (!person) return <td key={s} className="cell cell--free"><span className="free">libre</span></td>;
                    return (
                      <td key={s} className="cell">
                        <button className="who" onClick={() => goPerson(person)}>
                          {personLabel(person)}
                          {isExternal(person) && <Tag>ext.</Tag>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">{freeCount} créneaux de local libres ce jour · ★ local prioritaire · touchez un nom pour voir son horaire</p>
    </div>
  );
}

function PersonView({ person, setPerson, fromIdx, goOffice }) {
  const dates = data.dates;
  const items = useMemo(() => {
    if (!person) return [];
    const out = [];
    for (let i = fromIdx; i < dates.length; i++) {
      const iso = dates[i].iso;
      const day = data.assignments[iso] || {};
      for (const s of data.slots) {
        const a = day[s] || {};
        for (const office of data.offices) {
          if (a[office] === person) out.push({ iso, slot: s, office, idx: i });
        }
      }
    }
    return out;
  }, [person, fromIdx]);

  return (
    <div>
      <PeoplePicker value={person} onChange={setPerson} />
      {!person && <p className="empty">Choisissez une personne pour afficher son horaire à venir.</p>}
      {person && (
        <>
          <p className="hint">{items.length} créneau{items.length !== 1 ? "x" : ""} à partir d’aujourd’hui</p>
          {items.length === 0 && <p className="empty">Aucune assignation à venir pour {personLabel(person)}.</p>}
          <ul className="list">
            {items.map((it, k) => {
              const pd = prettyDate(it.iso);
              const po = parseOffice(it.office);
              const newDay = k === 0 || items[k - 1].iso !== it.iso;
              return (
                <li key={k} className={`row ${newDay ? "row--new" : ""}`}>
                  <span className="row__date">{newDay ? <><b>{pd.wd}</b> {pd.full}</> : ""}</span>
                  <SlotBadge slot={it.slot} />
                  <button className="row__office" onClick={() => goOffice(it.office)}>
                    {po.star && <span className="office__star">★</span>}{po.label}
                    {po.code && <span className="office__code">{po.code}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function OfficeView({ office, setOffice, fromIdx, goPerson }) {
  const dates = data.dates;
  const items = useMemo(() => {
    if (!office) return [];
    const out = [];
    for (let i = fromIdx; i < dates.length; i++) {
      const iso = dates[i].iso;
      const day = data.assignments[iso] || {};
      for (const s of data.slots) {
        const person = (day[s] || {})[office];
        if (person) out.push({ iso, slot: s, person });
      }
    }
    return out;
  }, [office, fromIdx]);

  const po = office ? parseOffice(office) : null;

  return (
    <div>
      <label className="pickerlabel">
        Local
        <select className="select" value={office || ""} onChange={(e) => setOffice(e.target.value || null)}>
          <option value="">— Choisir un local —</option>
          {data.offices.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      {!office && <p className="empty">Choisissez un local pour voir qui l’occupe.</p>}
      {office && (
        <>
          <div className="officehead">
            <span className="office__label big">{po.star && <span className="office__star">★</span>}{po.label}</span>
            {po.code && <span className="office__code">{po.code}</span>}
          </div>
          <p className="hint">{items.length} occupation{items.length !== 1 ? "s" : ""} à partir d’aujourd’hui</p>
          {items.length === 0 && <p className="empty">Local libre sur toute la période à venir.</p>}
          <ul className="list">
            {items.map((it, k) => {
              const pd = prettyDate(it.iso);
              const newDay = k === 0 || items[k - 1].iso !== it.iso;
              return (
                <li key={k} className={`row ${newDay ? "row--new" : ""}`}>
                  <span className="row__date">{newDay ? <><b>{pd.wd}</b> {pd.full}</> : ""}</span>
                  <SlotBadge slot={it.slot} />
                  <button className="row__office" onClick={() => goPerson(it.person)}>
                    {personLabel(it.person)}{isExternal(it.person) && <Tag>ext.</Tag>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/* ---------- people picker with search ---------- */

function PeoplePicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data.people;
    return data.people.filter((p) => p.toLowerCase().includes(t));
  }, [q]);

  return (
    <div className="picker" ref={boxRef}>
      <input
        className="search"
        placeholder={value ? personLabel(value) : "Rechercher une personne…"}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        aria-label="Rechercher une personne"
      />
      {value && <button className="clearbtn" onClick={() => { onChange(null); setQ(""); }} aria-label="Effacer">×</button>}
      {open && (
        <ul className="suggest">
          {matches.length === 0 && <li className="suggest__none">Aucun résultat</li>}
          {matches.map((p) => (
            <li key={p}>
              <button className={`suggest__item ${p === value ? "is-active" : ""}`} onClick={() => { onChange(p); setQ(""); setOpen(false); }}>
                {personLabel(p)}{isExternal(p) && <Tag>ext.</Tag>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- app shell ---------- */

export default function App() {
  const dates = data.dates;
  const todayIdx = Math.max(0, dates.findIndex((d) => d.iso === TODAY));
  const fromIdx = todayIdx === -1 ? 0 : todayIdx;

  const [view, setView] = useState("jour");
  const [dateIdx, setDateIdx] = useState(fromIdx);
  const [person, setPerson] = useState(null);
  const [office, setOffice] = useState(null);

  const goPerson = (p) => { setPerson(p); setView("personne"); };
  const goOffice = (o) => { setOffice(o); setView("bureau"); };

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__rooms">36 locaux · 3 plages</div>
        <h1 className="masthead__title">{data.title}</h1>
        <div className="masthead__unit">{data.unit}</div>
        <div className="masthead__appel">{data.appel}</div>
      </header>

      <nav className="tabs" role="tablist">
        {[["jour", "Jour"], ["personne", "Personne"], ["bureau", "Local"]].map(([k, lbl]) => (
          <button key={k} role="tab" aria-selected={view === k}
            className={`tab ${view === k ? "is-active" : ""}`} onClick={() => setView(k)}>
            {lbl}
          </button>
        ))}
      </nav>

      <main className="panel">
        {view === "jour" && <DayView dateIdx={dateIdx} setDateIdx={setDateIdx} goPerson={goPerson} />}
        {view === "personne" && <PersonView person={person} setPerson={setPerson} fromIdx={fromIdx} goOffice={goOffice} />}
        {view === "bureau" && <OfficeView office={office} setOffice={setOffice} fromIdx={fromIdx} goPerson={goPerson} />}
      </main>

      <footer className="foot">
        Période : {prettyDate(dates[0].iso).full} → {prettyDate(dates[dates.length - 1].iso).full} · données internes, non contractuelles
      </footer>
    </div>
  );
}
