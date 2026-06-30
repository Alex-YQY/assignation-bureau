import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  dates, slots, slotLabels, meta, hasRemote,
  loadDoc, saveDoc, occupancyFor,
  computeStats, statsToCSV, personICS, quartersInRange,
} from "./store.js";

/* ---------- download helper ---------- */
function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- date helpers ---------- */
const MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const DOW = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const TODAY = "2026-06-29";

const dateIndex = Object.fromEntries(dates.map((d, i) => [d.iso, i]));
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = DOW[new Date(y, m - 1, d).getDay()];
  return { wd: cap(wd), wdShort: cap(wd).slice(0, 3), full: `${d} ${MONTHS[m - 1]} ${y}`, day: d };
}
function parseOffice(name) {
  const star = name.startsWith("*");
  const clean = star ? name.slice(1).trim() : name;
  const h = clean.indexOf("#");
  if (h === -1) return { star, label: clean, code: "" };
  return { star, label: clean.slice(0, h).trim(), code: clean.slice(h) };
}
const isExternal = (p) => /EXTERNE/i.test(p);
const personLabel = (p) => p.replace(/\s*-\s*EXTERNE/i, "").trim();

/* ---------- tiny components ---------- */
function SlotBadge({ slot }) {
  return <span className={`slot slot--${slot.toLowerCase()}`}>{slot}</span>;
}
function Tag({ children }) { return <span className="tag">{children}</span>; }

function OccupancyMeter({ slot, pct }) {
  const n = pct ? parseInt(pct, 10) : 0;
  const tone = n >= 80 ? "high" : n >= 40 ? "mid" : "low";
  return (
    <div className="meter">
      <div className="meter__head"><SlotBadge slot={slot} /><span className="meter__val">{pct}</span></div>
      <div className="meter__track"><div className={`meter__fill meter__fill--${tone}`} style={{ width: `${n}%` }} /></div>
    </div>
  );
}

/* ---------- cell editor modal ---------- */
function CellEditor({ doc, cell, onClose, onSet, onAddPerson }) {
  const [q, setQ] = useState("");
  const current = doc.assignments[cell.iso]?.[cell.slot]?.[cell.office] || null;
  const pd = prettyDate(cell.iso);
  const po = parseOffice(cell.office);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? doc.people.filter((p) => p.toLowerCase().includes(t)) : doc.people;
  }, [q, doc.people]);
  const exact = doc.people.some((p) => p.toLowerCase() === q.trim().toLowerCase());

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="modal__box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <div className="modal__title">{po.star && <span className="office__star">★</span>}{po.label} <span className="office__code">{po.code}</span></div>
            <div className="modal__sub"><SlotBadge slot={cell.slot} /> {pd.wd} {pd.full}</div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        {current && (
          <div className="modal__current">
            Occupé par <b>{personLabel(current)}</b>
            <button className="dangerlink" onClick={() => { onSet(cell, null); onClose(); }}>Libérer le local</button>
          </div>
        )}
        <input className="search" autoFocus placeholder="Rechercher ou ajouter une personne…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim() && !exact) { onAddPerson(q.trim()); onSet(cell, q.trim()); onClose(); }
          }} />
        <ul className="suggest suggest--inline">
          {matches.map((p) => (
            <li key={p}>
              <button className={`suggest__item ${p === current ? "is-active" : ""}`} onClick={() => { onSet(cell, p); onClose(); }}>
                {personLabel(p)}{isExternal(p) && <Tag>ext.</Tag>}
              </button>
            </li>
          ))}
          {q.trim() && !exact && (
            <li>
              <button className="suggest__item suggest__add" onClick={() => { onAddPerson(q.trim()); onSet(cell, q.trim()); onClose(); }}>
                + Ajouter « {q.trim()} » au personnel
              </button>
            </li>
          )}
          {matches.length === 0 && !q.trim() && <li className="suggest__none">Aucune personne enregistrée</li>}
        </ul>
      </div>
    </div>
  );
}

/* ---------- DAY ---------- */
function DayView({ doc, dateIdx, setDateIdx, editMode, openCell }) {
  const m = dates[dateIdx];
  const pd = prettyDate(m.iso);
  const occ = occupancyFor(doc, m.iso);
  const assign = doc.assignments[m.iso] || {};

  return (
    <div>
      <div className="daybar">
        <button className="navbtn" onClick={() => setDateIdx(Math.max(0, dateIdx - 1))} disabled={dateIdx === 0}>‹</button>
        <div className="daybar__center"><div className="daybar__wd">{pd.wd}</div><div className="daybar__full">{pd.full}</div></div>
        <button className="navbtn" onClick={() => setDateIdx(Math.min(dates.length - 1, dateIdx + 1))} disabled={dateIdx === dates.length - 1}>›</button>
      </div>
      <div className="daytools">
        <input className="dateinput" type="date" value={m.iso} min={dates[0].iso} max={dates.at(-1).iso}
          onChange={(e) => { const i = dateIndex[e.target.value]; if (i != null) setDateIdx(i); }} />
        <button className="ghostbtn" onClick={() => setDateIdx(dateIndex[TODAY] ?? 0)}>Aujourd’hui</button>
      </div>
      <div className="meters">{slots.map((s) => <OccupancyMeter key={s} slot={s} pct={occ[s]} />)}</div>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr><th className="grid__office">Local</th>{slots.map((s) => <th key={s} className="grid__slot">{slotLabels[s]}</th>)}</tr></thead>
          <tbody>
            {doc.offices.map((office) => {
              const po = parseOffice(office);
              return (
                <tr key={office}>
                  <th className="grid__office" scope="row">
                    <span className="office__label">{po.star && <span className="office__star">★</span>}{po.label}</span>
                    {po.code && <span className="office__code">{po.code}</span>}
                  </th>
                  {slots.map((s) => {
                    const person = (assign[s] || {})[office];
                    return (
                      <td key={s} className={`cell ${!person ? "cell--free" : ""}`}>
                        {person ? (
                          editMode ? (
                            <button className="who who--edit" onClick={() => openCell({ iso: m.iso, slot: s, office })}>
                              {personLabel(person)}{isExternal(person) && <Tag>ext.</Tag>}
                            </button>
                          ) : (
                            <span className="who who--static">{personLabel(person)}{isExternal(person) && <Tag>ext.</Tag>}</span>
                          )
                        ) : editMode ? (
                          <button className="addcell" onClick={() => openCell({ iso: m.iso, slot: s, office })}>+ assigner</button>
                        ) : <span className="free">libre</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">{editMode ? "Mode édition — touchez une case pour assigner ou libérer un local." : "★ local prioritaire."}</p>
    </div>
  );
}

/* ---------- WEEK ---------- */
function WeekView({ doc, anchorIdx, setAnchorIdx, editMode, openCell, highlight, setHighlight }) {
  const [slot, setSlot] = useState("AM");
  const ws = anchorIdx - (anchorIdx % 7);
  const week = Array.from({ length: 7 }, (_, k) => dates[ws + k]).filter(Boolean);

  return (
    <div>
      <div className="weekbar">
        <button className="navbtn" onClick={() => setAnchorIdx(Math.max(0, ws - 7))} disabled={ws === 0}>‹</button>
        <div className="weekbar__label">Semaine du {prettyDate(week[0].iso).full}</div>
        <button className="navbtn" onClick={() => setAnchorIdx(Math.min(dates.length - 1, ws + 7))} disabled={ws + 7 >= dates.length}>›</button>
      </div>
      <div className="weektools">
        <div className="seg">{slots.map((s) => (
          <button key={s} className={`seg__btn ${slot === s ? "is-active" : ""}`} onClick={() => setSlot(s)}>{s}</button>
        ))}</div>
        <PersonSelect doc={doc} value={highlight} onChange={setHighlight} placeholder="Surligner une personne…" />
      </div>
      <div className="grid-wrap">
        <table className="grid grid--week">
          <thead><tr><th className="grid__office">Local · {slotLabels[slot]}</th>
            {week.map((d) => <th key={d.iso} className="grid__day">{prettyDate(d.iso).wdShort}<span className="grid__daynum">{prettyDate(d.iso).day}</span></th>)}
          </tr></thead>
          <tbody>
            {doc.offices.map((office) => {
              const po = parseOffice(office);
              return (
                <tr key={office}>
                  <th className="grid__office" scope="row">
                    <span className="office__label sm">{po.star && <span className="office__star">★</span>}{po.label}</span>
                  </th>
                  {week.map((d) => {
                    const person = doc.assignments[d.iso]?.[slot]?.[office];
                    const hot = person && highlight && person === highlight;
                    return (
                      <td key={d.iso} className={`cell cellw ${!person ? "cell--free" : ""} ${hot ? "cell--hot" : ""}`}>
                        {person ? (
                          editMode ? (
                            <button className="who whow who--edit" onClick={() => openCell({ iso: d.iso, slot, office })}>
                              {personLabel(person)}
                            </button>
                          ) : (
                            <span className="who whow who--static">{personLabel(person)}</span>
                          )
                        ) : editMode ? (
                          <button className="addcell addcell--sm" onClick={() => openCell({ iso: d.iso, slot, office })}>+</button>
                        ) : <span className="dot">·</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Affichage par plage ({slot}). {editMode ? "Touchez une case pour la modifier." : "Surlignez une personne pour suivre sa semaine."}</p>
    </div>
  );
}

/* ---------- MONTH ---------- */
function MonthView({ doc, cursor, setCursor, goDay, highlight, setHighlight }) {
  const { y, m } = cursor;
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday = 0
  const ndays = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= ndays; d++) cells.push(d);

  const isoOf = (d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const inRange = (iso) => iso in dateIndex;
  const canPrev = dates[0].iso < isoOf(1);
  const canNext = dates.at(-1).iso > isoOf(ndays);
  const step = (delta) => {
    let nm = m + delta, ny = y;
    if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; }
    setCursor({ y: ny, m: nm });
  };

  return (
    <div>
      <div className="weekbar">
        <button className="navbtn" onClick={() => step(-1)} disabled={!canPrev}>‹</button>
        <div className="weekbar__label">{cap(MONTHS[m])} {y}</div>
        <button className="navbtn" onClick={() => step(1)} disabled={!canNext}>›</button>
      </div>
      <div className="weektools">
        <PersonSelect doc={doc} value={highlight} onChange={setHighlight} placeholder="Surligner mes jours…" />
      </div>
      <div className="cal">
        <div className="cal__row cal__row--head">
          {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d) => <div key={d} className="cal__dow">{d}</div>)}
        </div>
        <div className="cal__grid">
          {cells.map((d, i) => {
            if (d == null) return <div key={i} className="cal__cell cal__cell--empty" />;
            const iso = isoOf(d);
            const ok = inRange(iso);
            const occ = ok ? occupancyFor(doc, iso) : null;
            const mark = ok && highlight
              ? slots.filter((s) => Object.values(doc.assignments[iso]?.[s] || {}).includes(highlight))
              : [];
            return (
              <button key={i} className={`cal__cell ${!ok ? "cal__cell--off" : ""} ${iso === TODAY ? "cal__cell--today" : ""}`}
                disabled={!ok} onClick={() => goDay(iso)}>
                <span className="cal__num">{d}</span>
                {ok && !highlight && (
                  <span className="cal__bars">{slots.map((s) => {
                    const n = parseInt(occ[s], 10);
                    return <span key={s} className={`cal__bar cal__bar--${s.toLowerCase()}`} style={{ height: `${Math.max(6, n)}%` }} title={`${s} ${occ[s]}`} />;
                  })}</span>
                )}
                {ok && highlight && (
                  <span className="cal__slots">{mark.length
                    ? mark.map((s) => <SlotBadge key={s} slot={s} />)
                    : <span className="cal__offmark">—</span>}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p className="hint">{highlight ? `Jours de ${personLabel(highlight)} ce mois.` : "Barres = taux d’occupation AM / PM / Soir. Touchez un jour pour l’ouvrir."}</p>
    </div>
  );
}

/* ---------- STATISTIQUES ---------- */
function StatBar({ label, pct, sub, tone = "teal" }) {
  return (
    <div className="statbar">
      <div className="statbar__top"><span className="statbar__label">{label}</span><span className="statbar__pct">{pct}%</span></div>
      <div className="statbar__track"><div className={`statbar__fill statbar__fill--${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      {sub && <div className="statbar__sub">{sub}</div>}
    </div>
  );
}
function StatsView({ doc }) {
  const quarters = useMemo(() => quartersInRange(), []);
  const [period, setPeriod] = useState("all");
  const range = useMemo(() => {
    if (period === "all") return { from: dates[0].iso, to: dates.at(-1).iso, label: "Toute la période" };
    const q = quarters.find((x) => x.key === period);
    const inQ = dates.filter((d) => { const [y, m] = d.iso.split("-").map(Number); return y === q.y && Math.floor((m - 1) / 3) + 1 === q.q; });
    return { from: inQ[0].iso, to: inQ.at(-1).iso, label: q.label };
  }, [period, quarters]);
  const stats = useMemo(() => computeStats(doc, range.from, range.to), [doc, range]);
  const slotTone = { AM: "am", PM: "pm", Soir: "soir" };

  return (
    <div>
      <div className="statshead">
        <label className="pickerlabel nomargin">Période
          <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">Toute la période</option>
            {quarters.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
          </select>
        </label>
        <button className="ghostbtn" onClick={() => downloadFile(
          `statistiques_${range.label.replace(/\s+/g, "_")}.csv`,
          "\uFEFF" + statsToCSV(stats, range.label), "text/csv;charset=utf-8")}>
          ↓ Exporter en CSV
        </button>
      </div>

      <div className="statgrid">
        <div className="statcard statcard--hero">
          <div className="statcard__eyebrow">Taux d’occupation moyen</div>
          <div className="statcard__big">{stats.global.pct}<span>%</span></div>
          <div className="statcard__note">{stats.global.occ.toLocaleString("fr-CA")} créneaux occupés sur {stats.global.cap.toLocaleString("fr-CA")} · {stats.days} jours</div>
        </div>

        <div className="statcard">
          <div className="statcard__title">Par plage horaire</div>
          {stats.bySlot.map((r) => <StatBar key={r.slot} label={slotLabels[r.slot]} pct={r.pct} tone={slotTone[r.slot]} sub={`${r.occ} / ${r.cap}`} />)}
        </div>

        <div className="statcard">
          <div className="statcard__title">Par jour de la semaine</div>
          {stats.byDow.filter((r) => r.cap > 0).map((r) => <StatBar key={r.w} label={r.w} pct={r.pct} sub={`${r.occ} / ${r.cap}`} />)}
        </div>

        <div className="statcard">
          <div className="statcard__title">Par trimestre</div>
          {stats.byQuarter.map((r) => <StatBar key={r.key} label={r.label} pct={r.pct} tone="coral" sub={`${r.occ} / ${r.cap}`} />)}
        </div>

        <div className="statcard statcard--wide">
          <div className="statcard__title">Par titre d’emploi <span className="statcard__hint">(part des créneaux)</span></div>
          {stats.byTitle.length === 0 && <p className="empty nomargin">Aucune donnée.</p>}
          {stats.byTitle.map((r) => (
            <StatBar key={r.title} label={r.title === "Non défini" ? "Non défini" : r.title} pct={r.pct} tone={r.title === "Non défini" ? "muted" : "teal"} sub={`${r.n} créneaux`} />
          ))}
          {stats.byTitle.some((r) => r.title === "Non défini") && (
            <p className="hint">Astuce : renseignez le titre d’emploi dans l’onglet Personnel pour préciser cette répartition.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- STAFF MANAGER ---------- */
const TITLE_SUGGESTIONS = ["Médecin", "Résident", "Externe", "Infirmière", "Infirmière praticienne (IPS)", "Pharmacien", "Travailleur social", "Nutritionniste", "Kinésiologue", "Psychologue", "Agent administratif"];
function StaffView({ doc, renamePerson, addPerson, removePerson, setTitle }) {
  const [adding, setAdding] = useState("");
  const counts = useMemo(() => {
    const c = {};
    for (const iso in doc.assignments) for (const s of slots) for (const o of doc.offices) {
      const p = doc.assignments[iso][s]?.[o]; if (p) c[p] = (c[p] || 0) + 1;
    }
    return c;
  }, [doc]);
  const sorted = [...doc.people].sort((a, b) => a.localeCompare(b, "fr"));
  const exportICS = (name) => {
    const { ics, count } = personICS(doc, name, dates[dateIndex[TODAY] ?? 0].iso);
    if (count) downloadFile(`${personLabel(name).replace(/\s+/g, "_")}.ics`, ics, "text/calendar");
  };

  return (
    <div>
      <datalist id="titres">{TITLE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="addrow">
        <input className="search" placeholder="Nom d’une nouvelle personne…" value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && adding.trim()) { addPerson(adding.trim()); setAdding(""); } }} />
        <button className="ghostbtn" disabled={!adding.trim()} onClick={() => { addPerson(adding.trim()); setAdding(""); }}>Ajouter</button>
      </div>
      <p className="hint">{sorted.length} personnes · titre d’emploi pour les statistiques · ↓ exporte l’horaire vers Outlook (.ics)</p>
      <ul className="staff">
        <li className="staff__row staff__row--head">
          <span>Nom</span><span>Titre d’emploi</span><span className="staff__count">Créneaux</span><span />
        </li>
        {sorted.map((p) => (
          <StaffRow key={p} name={p} title={doc.titles?.[p] || ""} count={counts[p] || 0}
            onRename={renamePerson} onRemove={removePerson} onTitle={setTitle} onExport={exportICS} />
        ))}
      </ul>
    </div>
  );
}
function StaffRow({ name, title, count, onRename, onRemove, onTitle, onExport }) {
  const [val, setVal] = useState(name);
  const [tval, setTval] = useState(title);
  useEffect(() => setVal(name), [name]);
  useEffect(() => setTval(title), [title]);
  const commit = () => { const t = val.trim(); if (t && t !== name) onRename(name, t); else setVal(name); };
  const commitTitle = () => { if (tval !== title) onTitle(name, tval.trim()); };
  return (
    <li className="staff__row">
      <input className="staff__name" value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      <input className="staff__title" list="titres" placeholder="—" value={tval}
        onChange={(e) => setTval(e.target.value)} onBlur={commitTitle}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      <span className="staff__count">{count}</span>
      <span className="staff__actions">
        <button className="iconbtn" title="Exporter l’horaire (.ics)" disabled={!count}
          onClick={() => onExport(name)}>↓</button>
        <button className="iconbtn iconbtn--danger" title="Retirer"
          onClick={() => { if (confirm(`Retirer ${personLabel(name)} ? Ses ${count} assignation(s) seront effacées.`)) onRemove(name); }}>×</button>
      </span>
    </li>
  );
}

/* ---------- person search/select (shared) ---------- */
function PersonSelect({ doc, value, onChange, placeholder }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? doc.people.filter((p) => p.toLowerCase().includes(t)) : doc.people;
  }, [q, doc.people]);
  return (
    <div className="picker" ref={ref}>
      <input className="search" placeholder={value ? personLabel(value) : placeholder} value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {value && <button className="clearbtn" onClick={() => { onChange(null); setQ(""); }}>×</button>}
      {open && (
        <ul className="suggest">
          {matches.length === 0 && <li className="suggest__none">Aucun résultat</li>}
          {matches.map((p) => (
            <li key={p}><button className={`suggest__item ${p === value ? "is-active" : ""}`}
              onClick={() => { onChange(p); setQ(""); setOpen(false); }}>
              {personLabel(p)}{isExternal(p) && <Tag>ext.</Tag>}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- secondary dropdown menu ---------- */
function SecondaryMenu({ items, view, setView }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const active = items.find(([k]) => k === view);
  return (
    <div className="menu" ref={ref}>
      <button className={`tab menu__btn ${active ? "is-active" : ""}`} onClick={() => setOpen((o) => !o)}>
        {active ? active[1] : "Plus"}<span className="menu__chev" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="menu__list">
          {items.map(([k, lbl]) => (
            <li key={k}>
              <button className={`menu__item ${view === k ? "is-active" : ""}`} onClick={() => { setView(k); setOpen(false); }}>{lbl}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- app shell ---------- */
export default function App() {
  const fromIdx = dateIndex[TODAY] ?? 0;
  const [doc, setDoc] = useState(null);
  const [source, setSource] = useState("local");
  const [warning, setWarning] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const dirty = useRef(false);
  const timer = useRef(null);

  const [view, setView] = useState("jour");
  const [editMode, setEditMode] = useState(false);
  const [dateIdx, setDateIdx] = useState(fromIdx);
  const [weekAnchor, setWeekAnchor] = useState(fromIdx);
  const [monthCursor, setMonthCursor] = useState(() => { const [y, mm] = TODAY.split("-").map(Number); return { y, m: mm - 1 }; });
  const [highlight, setHighlight] = useState(null);
  const [cell, setCell] = useState(null);

  useEffect(() => {
    loadDoc().then(({ doc, source, warning }) => { setDoc(doc); setSource(source); if (warning) setWarning(warning); });
  }, []);

  useEffect(() => {
    if (!doc || !dirty.current) return;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const r = await saveDoc(doc); setSaveState("saved"); setSource(r); setWarning(""); }
      catch (e) { setSaveState("error"); setWarning(e.message || "Échec de l’enregistrement."); }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [doc]);

  const mutate = useCallback((fn) => { dirty.current = true; setSaveState("unsaved"); setDoc((prev) => fn(prev)); }, []);

  const setCellVal = useCallback((c, personVal) => mutate((prev) => {
    const dayPrev = prev.assignments[c.iso] || {};
    const slotPrev = { ...(dayPrev[c.slot] || {}) };
    if (personVal) slotPrev[c.office] = personVal; else delete slotPrev[c.office];
    return { ...prev, assignments: { ...prev.assignments, [c.iso]: { ...dayPrev, [c.slot]: slotPrev } } };
  }), [mutate]);

  const addPerson = useCallback((name) => mutate((prev) =>
    prev.people.includes(name) ? prev : { ...prev, people: [...prev.people, name], titles: { ...prev.titles, [name]: prev.titles?.[name] || "" } }), [mutate]);

  const setTitle = useCallback((name, title) => mutate((prev) =>
    ({ ...prev, titles: { ...(prev.titles || {}), [name]: title } })), [mutate]);

  const renamePerson = useCallback((oldN, neo) => mutate((prev) => {
    const people = Array.from(new Set(prev.people.map((p) => (p === oldN ? neo : p))));
    const titles = { ...(prev.titles || {}) };
    if (oldN in titles) { titles[neo] = titles[neo] || titles[oldN]; delete titles[oldN]; }
    const assignments = {};
    for (const iso in prev.assignments) { assignments[iso] = {};
      for (const s in prev.assignments[iso]) { assignments[iso][s] = {};
        for (const o in prev.assignments[iso][s]) { const v = prev.assignments[iso][s][o]; assignments[iso][s][o] = v === oldN ? neo : v; }
      }
    }
    return { ...prev, people, titles, assignments };
  }), [mutate]);

  const removePerson = useCallback((name) => mutate((prev) => {
    const people = prev.people.filter((p) => p !== name);
    const titles = { ...(prev.titles || {}) }; delete titles[name];
    const assignments = {};
    for (const iso in prev.assignments) { assignments[iso] = {};
      for (const s in prev.assignments[iso]) { assignments[iso][s] = {};
        for (const o in prev.assignments[iso][s]) { const v = prev.assignments[iso][s][o]; if (v !== name) assignments[iso][s][o] = v; }
      }
    }
    return { ...prev, people, titles, assignments };
  }), [mutate]);

  const goDay = (iso) => { const i = dateIndex[iso]; if (i != null) { setDateIdx(i); setView("jour"); } };

  if (!doc) return <div className="app"><p className="empty">Chargement…</p></div>;

  const PRIMARY = [["jour","Jour"],["semaine","Semaine"],["mois","Mois"]];
  const SECONDARY = [["statistiques","Statistiques"],["personnel","Personnel"]];
  const saveText = {
    saved: source === "remote" ? "Enregistré" : "Enregistré (appareil)",
    saving: "Enregistrement…", unsaved: "Modifications non enregistrées", error: "Erreur d’enregistrement",
  }[saveState];

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__rooms">{doc.offices.length} locaux · {slots.length} plages</div>
        <h1 className="masthead__title">{meta.title}</h1>
        <div className="masthead__unit">{meta.unit}</div>
        <div className="masthead__appel">{meta.appel}</div>
      </header>

      <div className="toolbar">
        <button className={`editbtn ${editMode ? "is-on" : ""}`} onClick={() => setEditMode((v) => !v)}>
          {editMode ? "● Édition activée" : "Modifier l’horaire"}
        </button>
        <div className={`savechip savechip--${saveState}`} title={warning || ""}>
          <span className="savedot" />{saveText}
        </div>
      </div>
      {warning && <div className="banner">{warning}{!hasRemote && " · Base non configurée — voir le README."}</div>}

      <nav className="tabs">
        {PRIMARY.map(([k, lbl]) => (
          <button key={k} className={`tab ${view === k ? "is-active" : ""}`} onClick={() => setView(k)}>{lbl}</button>
        ))}
        <SecondaryMenu items={SECONDARY} view={view} setView={setView} />
      </nav>

      <main className="panel">
        {view === "jour" && <DayView doc={doc} dateIdx={dateIdx} setDateIdx={setDateIdx} editMode={editMode} openCell={setCell} />}
        {view === "semaine" && <WeekView doc={doc} anchorIdx={weekAnchor} setAnchorIdx={setWeekAnchor} editMode={editMode} openCell={setCell} highlight={highlight} setHighlight={setHighlight} />}
        {view === "mois" && <MonthView doc={doc} cursor={monthCursor} setCursor={setMonthCursor} goDay={goDay} highlight={highlight} setHighlight={setHighlight} />}
        {view === "statistiques" && <StatsView doc={doc} />}
        {view === "personnel" && <StaffView doc={doc} renamePerson={renamePerson} addPerson={addPerson} removePerson={removePerson} setTitle={setTitle} />}
      </main>

      {cell && <CellEditor doc={doc} cell={cell} onClose={() => setCell(null)} onSet={setCellVal} onAddPerson={addPerson} />}

      <footer className="foot">
        Période : {prettyDate(dates[0].iso).full} → {prettyDate(dates.at(-1).iso).full} · {source === "remote" ? "synchronisé (base de données)" : "stockage local de l’appareil"} · données internes
      </footer>
    </div>
  );
}
