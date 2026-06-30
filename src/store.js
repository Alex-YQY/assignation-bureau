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
export function seedDoc() {
  return {
    version: 1,
    offices: seed.offices.slice(),
    people: seed.people.slice(),
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
