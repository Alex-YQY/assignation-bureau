import { createClient } from "@supabase/supabase-js";
import seed from "./data.json";

/* ---- config (env vars set in Vercel / .env) ---- */
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const hasRemote = Boolean(URL && KEY);
const supabase = hasRemote ? createClient(URL, KEY) : null;

const ROW_ID = "main";
const LS_KEY = "gmfu-bureaux-doc-v1";

/* ---- immutable bits that come from the bundled seed ---- */
export const dates = seed.dates;                 // fixed calendar
export const slots = seed.slots;                 // ["AM","PM","Soir"]
export const slotLabels = seed.slotLabels;
export const meta = { title: seed.title, unit: seed.unit, appel: seed.appel };

/* ---- editable document shape ---- */
const isExt = (p) => /EXTERNE/i.test(p);
export function seedDoc() {
  const titles = {};
  for (const p of seed.people) titles[p] = isExt(p) ? "Externe" : "";
  return {
    version: 2,
    offices: seed.offices.slice(),
    people: seed.people.slice(),
    titles,
    assignments: structuredClone(seed.assignments),
  };
}

function loadLocal() {
  try {
    const r = localStorage.getItem(LS_KEY);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}
function saveLocal(doc) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(doc)); } catch {}
}

/* Returns { doc, source, warning } and never throws. */
export async function loadDoc() {
  if (hasRemote) {
    try {
      const { data, error } = await supabase
        .from("schedule").select("doc").eq("id", ROW_ID).maybeSingle();
      if (error) throw error;
      if (data && data.doc) {
        saveLocal(data.doc);
        return { doc: data.doc, source: "remote" };
      }
      // first run on a fresh database: seed it
      const fresh = loadLocal() || seedDoc();
      const up = await supabase.from("schedule")
        .upsert({ id: ROW_ID, doc: fresh, updated_at: new Date().toISOString() });
      if (up.error) throw up.error;
      saveLocal(fresh);
      return { doc: fresh, source: "remote" };
    } catch (e) {
      const local = loadLocal() || seedDoc();
      return { doc: local, source: "local", warning: humanError(e) };
    }
  }
  const local = loadLocal();
  if (local) return { doc: local, source: "local" };
  const s = seedDoc();
  saveLocal(s);
  return { doc: s, source: "local" };
}

/* Returns "remote" | "local"; throws on remote failure so UI can show it. */
export async function saveDoc(doc) {
  saveLocal(doc);
  if (hasRemote) {
    const { error } = await supabase.from("schedule")
      .upsert({ id: ROW_ID, doc, updated_at: new Date().toISOString() });
    if (error) throw error;
    return "remote";
  }
  return "local";
}

function humanError(e) {
  const m = (e && e.message) || String(e);
  if (/relation .*schedule.* does not exist/i.test(m) || /Could not find the table/i.test(m))
    return "Table « schedule » introuvable dans la base. Exécutez le script SQL du README.";
  return "Base de données injoignable — modifications conservées sur cet appareil seulement.";
}

/* ---- occupancy computed live from assignments (denominator = 30 locaux) ---- */
const isSupervisor = (o) => /^Superviseur/i.test(o);
export function occupancyFor(doc, iso) {
  const day = doc.assignments[iso] || {};
  const pool = doc.offices.filter((o) => !isSupervisor(o));
  const denom = pool.length || 1;
  const res = {};
  for (const s of slots) {
    const a = day[s] || {};
    const occ = pool.filter((o) => a[o]).length;
    res[s] = Math.round((occ / denom) * 100) + "%";
  }
  return res;
}

/* ---- quarters (trimestres civils) present in the data ---- */
export function quarterOf(iso) {
  const [y, m] = iso.split("-").map(Number);
  return { y, q: Math.floor((m - 1) / 3) + 1 };
}
export function quartersInRange() {
  const seen = [];
  const key = (x) => `${x.y}-T${x.q}`;
  for (const d of dates) {
    const qq = quarterOf(d.iso);
    if (!seen.some((s) => s.y === qq.y && s.q === qq.q)) seen.push(qq);
  }
  return seen.map((x) => ({ ...x, key: key(x), label: `T${x.q} ${x.y}` }));
}

/* ---- statistics over a date range [fromIso, toIso] inclusive ---- */
const WEEKDAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
export function computeStats(doc, fromIso, toIso) {
  const pool = doc.offices.filter((o) => !isSupervisor(o));
  const slotsAcc = Object.fromEntries(slots.map((s) => [s, { occ: 0, slots_count: 0 }]));
  const dowAcc = WEEKDAYS.map((w) => ({ w, occ: 0, cap: 0 }));
  const titleAcc = {};
  let occTotal = 0, capTotal = 0, days = 0;

  for (const d of dates) {
    if (d.iso < fromIso || d.iso > toIso) continue;
    days++;
    const [y, mo, da] = d.iso.split("-").map(Number);
    const jsDow = new Date(y, mo - 1, da).getDay();      // 0=Sun
    const wIdx = (jsDow + 6) % 7;                          // 0=Mon
    const day = doc.assignments[d.iso] || {};
    for (const s of slots) {
      const a = day[s] || {};
      let occ = 0;
      for (const o of pool) if (a[o]) occ++;
      slotsAcc[s].occ += occ; slotsAcc[s].slots_count += pool.length;
      dowAcc[wIdx].occ += occ; dowAcc[wIdx].cap += pool.length;
      occTotal += occ; capTotal += pool.length;
      // titres : compter tous les créneaux occupés (locaux + superviseurs)
      for (const o of doc.offices) {
        const who = a[o];
        if (!who) continue;
        const t = (doc.titles && doc.titles[who]) || "Non défini";
        titleAcc[t] = (titleAcc[t] || 0) + 1;
      }
    }
  }
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const totalTitleCreneaux = Object.values(titleAcc).reduce((a, b) => a + b, 0);

  return {
    days,
    global: { occ: occTotal, cap: capTotal, pct: pct(occTotal, capTotal) },
    bySlot: slots.map((s) => ({ slot: s, occ: slotsAcc[s].occ, cap: slotsAcc[s].slots_count, pct: pct(slotsAcc[s].occ, slotsAcc[s].slots_count) })),
    byDow: dowAcc.map((x) => ({ ...x, pct: pct(x.occ, x.cap) })),
    byTitle: Object.entries(titleAcc).map(([title, n]) => ({ title, n, pct: pct(n, totalTitleCreneaux) }))
      .sort((a, b) => b.n - a.n),
    byQuarter: quartersInRange().map((qq) => {
      let occ = 0, cap = 0;
      for (const d of dates) {
        const c = quarterOf(d.iso);
        if (c.y !== qq.y || c.q !== qq.q) continue;
        const day = doc.assignments[d.iso] || {};
        for (const s of slots) { const a = day[s] || {}; for (const o of pool) if (a[o]) occ++; cap += pool.length; }
      }
      return { ...qq, occ, cap, pct: pct(occ, cap) };
    }),
  };
}

/* ---- exports ---- */
export function statsToCSV(stats, label) {
  const rows = [["Rapport de présence", label], [], ["Indicateur", "Occupés", "Capacité", "Taux %"]];
  rows.push(["Global", stats.global.occ, stats.global.cap, stats.global.pct]);
  rows.push([]); rows.push(["Par plage", "", "", ""]);
  stats.bySlot.forEach((r) => rows.push([r.slot, r.occ, r.cap, r.pct]));
  rows.push([]); rows.push(["Par jour de la semaine", "", "", ""]);
  stats.byDow.forEach((r) => rows.push([r.w, r.occ, r.cap, r.pct]));
  rows.push([]); rows.push(["Par trimestre", "", "", ""]);
  stats.byQuarter.forEach((r) => rows.push([r.label, r.occ, r.cap, r.pct]));
  rows.push([]); rows.push(["Par titre d'emploi", "Créneaux", "", "Part %"]);
  stats.byTitle.forEach((r) => rows.push([r.title, r.n, "", r.pct]));
  return rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* iCalendar (.ics) for one person's upcoming assignments — importable into Outlook */
const SLOT_TIMES = { AM: ["083000", "123000"], PM: ["123000", "170000"], Soir: ["170000", "200000"] };
export function personICS(doc, person, fromIso) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GMF-U Saint-Jean//Assignation bureaux//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  let n = 0;
  for (const d of dates) {
    if (d.iso < fromIso) continue;
    const day = doc.assignments[d.iso] || {};
    for (const s of slots) {
      const a = day[s] || {};
      for (const o of doc.offices) {
        if (a[o] !== person) continue;
        const ymd = d.iso.replace(/-/g, "");
        const [t1, t2] = SLOT_TIMES[s];
        const office = o.replace(/^\*/, "").trim();
        n++;
        lines.push("BEGIN:VEVENT",
          `UID:gmfu-${ymd}-${s}-${n}@assignation-bureau`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${ymd}T${t1}`,
          `DTEND:${ymd}T${t2}`,
          `SUMMARY:Bureau ${escICS(office)} (${s})`,
          `LOCATION:${escICS(office)}`,
          `DESCRIPTION:Assignation GMF-U Saint-Jean-sur-Richelieu — plage ${s}`,
          "END:VEVENT");
      }
    }
  }
  lines.push("END:VCALENDAR");
  return { ics: lines.join("\r\n"), count: n };
}
function escICS(s) { return String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n"); }
