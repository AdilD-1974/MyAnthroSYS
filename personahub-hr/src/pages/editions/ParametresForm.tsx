/**
 * ParametresForm.tsx — Saisie des paramètres d'une édition (lancement, aperçu).
 * Auteur : Adil DAIA — lot 2 (16/10/2026), refonte du 19/10/2026
 *
 * Le formulaire se construit à partir des paramètres déclarés par le modèle :
 * aucun écran n'est à écrire quand un utilisateur ajoute un paramètre.
 * Le contrôle de périmètre (période d'une autre société…) reste côté serveur.
 *
 * RG-EDT-LANCEMENT-01 (Adil DAIA) : l'année d'abord, puis des listes filtrées sur cette année :
 *   période de paie, mois de paie, plans de paie, et salariés PAYÉS dans l'année / le mois / la
 *   période choisis (sortis compris — un salarié parti reste éditable sur ses anciennes paies).
 * RG-EDT-UI-02 : composants du thème (Select, Checkbox, Input, Button), jamais de liste native.
 * RG-EDT-LANCEMENT-02 (Adil DAIA) : périodes chargées une fois (cache 2 min) ; la dernière année
 *   choisie est retenue dans le navigateur (simple confort, jamais obligatoire).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { editionsApi, type CollaborateurPaye, type Periode } from "@/lib/editionsApi";
import Liste from "./Liste";
import type { Parametre } from "./types";

export type Valeurs = Record<string, unknown>;

const classeLibelle = "mb-1.5 block text-xs font-medium text-muted-foreground";

const MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const libellePeriode = (p: Periode) =>
  `${p.intitule || `${MOIS[p.mois]} ${p.annee}`}${p.plan_code ? ` · ${p.plan_code}` : ""} — ${p.nb_bulletins} bulletin(s)`;
/** Libellé dans une liste déjà filtrée sur l'année : sans l'année. */
const libelleDansAnnee = (p: Periode) => {
  const nom = (p.intitule || MOIS[p.mois]).replace(new RegExp(`\\s*${p.annee}\\s*$`), "");
  return `${nom.charAt(0).toUpperCase()}${nom.slice(1)}${p.plan_code ? ` · ${p.plan_code}` : ""} — ${p.nb_bulletins ? `${p.nb_bulletins} bulletin(s)` : "aucun bulletin"}`;
};

export function parametresManquants(parametres: Parametre[], v: Valeurs): string[] {
  return parametres
    .filter((p) => (p.obligatoire ?? true) && !p.defaut)
    .filter((p) => v[p.code] === undefined || v[p.code] === "" || (Array.isArray(v[p.code]) && !(v[p.code] as unknown[]).length))
    .map((p) => p.libelle);
}

// ── données partagées (RG-EDT-LANCEMENT-02) ─────────────────────────────────
let cachePeriodes: { quand: number; p: Promise<Periode[]> } | null = null;
const chargerPeriodes = () => {
  if (!cachePeriodes || Date.now() - cachePeriodes.quand > 120_000)
    cachePeriodes = { quand: Date.now(), p: editionsApi.periodes().catch((e) => { cachePeriodes = null; throw e; }) };
  return cachePeriodes.p;
};
const CLE_ANNEE = "editions.annee";
const anneeRetenue = (): number | undefined => {
  try { const v = Number(localStorage.getItem(CLE_ANNEE)); return v > 1900 ? v : undefined; } catch { return undefined; }
};
const retenirAnnee = (a?: number) => { try { if (a) localStorage.setItem(CLE_ANNEE, String(a)); } catch { /* navigation privée */ } };

const moisDe = (v: unknown): [number | undefined, number | undefined] =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? (v.split("-").map(Number) as [number, number]) : [undefined, undefined];

/** Périmètre temporel du formulaire : sert à filtrer plans et salariés. */
interface Portee { annee?: number; mois?: number; periodes?: string[] }

export default function ParametresForm({ parametres, valeurs, onChange }: {
  parametres: Parametre[]; valeurs: Valeurs; onChange: (v: Valeurs) => void;
}) {
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [anneesParam, setAnneesParam] = useState<Record<string, number>>({});   // année affichée d'un paramètre encore vide
  const aTemps = parametres.some((p) => p.type === "PERIODE" || p.type === "MOIS" || p.type === "ANNEE");
  const aPlan = parametres.some((p) => p.type === "PLAN_PAIE");
  const aCollab = parametres.some((p) => p.type === "COLLABORATEUR");

  const annees = useMemo(() => [...new Set(periodes.map((x) => x.annee))].sort((a, b) => b - a), [periodes]);
  const parId = useMemo(() => new Map(periodes.map((x) => [x.id, x])), [periodes]);
  const anneeParDefaut = useMemo(() => {
    const r = anneeRetenue();
    return r && annees.includes(r) ? r : (periodes.find((x) => x.nb_bulletins > 0) ?? periodes[0])?.annee;
  }, [periodes, annees]);

  useEffect(() => {
    if (!aTemps && !aPlan && !aCollab) return;
    chargerPeriodes().then((ps) => {
      setPeriodes(ps);
      // valeurs par défaut, dans l'année retenue (sinon la plus récente payée)
      const r = anneeRetenue();
      const an = r && ps.some((x) => x.annee === r) ? r : (ps.find((x) => x.nb_bulletins > 0) ?? ps[0])?.annee;
      const toutesPayees = ps.filter((x) => x.nb_bulletins > 0);
      const debut = Math.max(0, toutesPayees.findIndex((x) => x.annee === an));
      const nouv = { ...valeurs };
      let change = false, rang = 0;
      for (const p of parametres) {
        const requis = p.obligatoire ?? true;
        if (p.type === "PERIODE" && requis) {
          // 2e période obligatoire (référence d'une comparaison) : la précédente, au besoin l'année d'avant
          const d = toutesPayees[debut + rang] ?? toutesPayees[debut] ?? ps.find((x) => x.annee === an);
          if (!valeurs[p.code] && d) { nouv[p.code] = d.id; change = true; }
          rang++;
        }
        if (p.type === "MOIS" && requis && !valeurs[p.code]) {
          const d = toutesPayees[debut] ?? ps.find((x) => x.annee === an);
          if (d) { nouv[p.code] = `${d.annee}-${String(d.mois).padStart(2, "0")}`; change = true; }
        }
        if (p.type === "ANNEE" && valeurs[p.code] === undefined && !p.defaut && an) { nouv[p.code] = an; change = true; }
      }
      if (change) onChange(nouv);
    }).catch(() => setPeriodes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aTemps, aPlan, aCollab]);

  const set = (code: string, v: unknown) => onChange({ ...valeurs, [code]: v });

  // portée : la 1re période choisie, sinon le mois, sinon l'année (filtre des plans et des salariés)
  const portee: Portee = useMemo(() => {
    for (const p of parametres) {
      const v = valeurs[p.code];
      if (p.type === "PERIODE" && typeof v === "string" && parId.get(v)) {
        const per = parId.get(v)!;
        return { annee: per.annee, periodes: [per.id] };
      }
      if (p.type === "MOIS") { const [a, m] = moisDe(v); if (a) return { annee: a, mois: m }; }
      if (p.type === "ANNEE" && typeof v === "number") return { annee: v };
    }
    return { annee: anneeParDefaut };
  }, [parametres, valeurs, parId, anneeParDefaut]);

  if (!parametres.length) return <p className="text-sm text-muted-foreground">Ce modèle ne demande aucun paramètre.</p>;

  const choixAnnee = (valeur: number | undefined, onAnnee: (a: number) => void) => (
    <Liste value={valeur !== undefined ? String(valeur) : undefined} aria-label="Année" placeholder="Année" className="tabular-nums"
      options={annees.map((a) => ({ v: String(a), l: String(a) }))}
      onChange={(x) => { const a = Number(x); if (a) { retenirAnnee(a); onAnnee(a); } }} />
  );

  return (
    <div className="space-y-3">
      {parametres.map((p) => {
        const v = valeurs[p.code];
        const obligatoire = (p.obligatoire ?? true) && !p.defaut;
        let champ: React.ReactNode;
        switch (p.type) {
          case "PERIODE": {
            // année puis période de cette année
            const choisie = typeof v === "string" ? parId.get(v) : undefined;
            const an = choisie?.annee ?? anneesParam[p.code] ?? portee.annee ?? anneeParDefaut;
            const liste = periodes.filter((x) => x.annee === an);
            champ = (
              <div className="grid grid-cols-[96px_1fr] gap-2">
                {choixAnnee(an, (a) => {
                  setAnneesParam((s) => ({ ...s, [p.code]: a }));
                  const ps = periodes.filter((x) => x.annee === a);
                  const memeMois = choisie && ps.find((x) => x.mois === choisie.mois && x.plan_paie_id === choisie.plan_paie_id);
                  const d = memeMois ?? ps.find((x) => x.nb_bulletins > 0) ?? ps[0];
                  set(p.code, (p.obligatoire ?? true) || choisie ? d?.id : undefined);
                })}
                <Liste value={choisie ? choisie.id : undefined} onChange={(x) => set(p.code, x || undefined)}
                  vide={obligatoire ? undefined : p.code === "periode_comparaison" ? "— mois précédent —" : "—"}
                  placeholder={liste.length ? "— choisir —" : `Aucune période en ${an ?? "—"}`}
                  options={liste.map((x) => ({ v: x.id, l: libelleDansAnnee(x) }))} />
              </div>
            );
            break;
          }
          case "MOIS": {
            // année puis mois : toutes les périodes de paie du mois (plusieurs plans ou périodes)
            const [a, m] = moisDe(v);
            const an = a ?? anneesParam[p.code] ?? anneeParDefaut;
            const duMois = (mo?: number) => periodes.filter((x) => x.annee === an && x.mois === mo);
            const poserMois = (y?: number, mo?: number) => set(p.code, y && mo ? `${y}-${String(mo).padStart(2, "0")}` : undefined);
            const choisies = duMois(m);
            champ = (
              <div>
                <div className="grid grid-cols-[96px_1fr] gap-2">
                  {choixAnnee(an, (y) => {
                    setAnneesParam((s) => ({ ...s, [p.code]: y }));
                    const moisAn = periodes.filter((x) => x.annee === y);
                    const garde = m && moisAn.some((x) => x.mois === m) ? m : (moisAn.find((x) => x.nb_bulletins > 0) ?? moisAn[0])?.mois;
                    poserMois(y, garde);
                  })}
                  <Liste value={m ? String(m) : undefined} aria-label="Mois" placeholder="— choisir —" vide={obligatoire ? undefined : "—"}
                    onChange={(x) => poserMois(an, x ? Number(x) : undefined)}
                    options={MOIS.slice(1).flatMap((nom, i) => {
                      const ps = duMois(i + 1);
                      if (!ps.length) return [];
                      const nb = ps.reduce((t, x) => t + x.nb_bulletins, 0);
                      return [{ v: String(i + 1), l: `${nom.charAt(0).toUpperCase()}${nom.slice(1)} — ${ps.length > 1 ? `${ps.length} périodes, ` : ""}${nb ? `${nb} bulletin(s)` : "aucun bulletin"}` }];
                    }).reverse()} />
                </div>
                {choisies.length > 1 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {choisies.length} périodes regroupées : {choisies.map((x) => x.intitule || x.plan_code || "").filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            );
            break;
          }
          case "ANNEE":
            champ = annees.length ? (
              <Liste value={v !== undefined && v !== null ? String(v) : undefined} vide={obligatoire ? undefined : "—"} className="tabular-nums"
                onChange={(x) => { const a = x === "" ? undefined : Number(x); retenirAnnee(a); set(p.code, a); }}
                options={annees.map((a) => {
                  const n = periodes.filter((x) => x.annee === a).reduce((t, x) => t + x.nb_bulletins, 0);
                  return { v: String(a), l: `${a} — ${n} bulletin(s)` };
                })} />
            ) : <Input type="number" value={(v as number) ?? ""} onChange={(e) => set(p.code, e.target.value === "" ? undefined : Number(e.target.value))} />;
            break;
          case "PLAN_PAIE":
            champ = <ChoixPlan valeur={v} multiple={!!p.multiple} obligatoire={obligatoire} annee={portee.annee} onChange={(x) => set(p.code, x)} />;
            break;
          case "COLLABORATEUR":
            champ = <CollaborateursPayes valeur={v} multiple={!!p.multiple} portee={portee} onChange={(x) => set(p.code, x)} />;
            break;
          case "DATE":
            champ = <Input type="date" value={(v as string) ?? ""} onChange={(e) => set(p.code, e.target.value || undefined)} />;
            break;
          case "NOMBRE":
            champ = <Input type="number" value={(v as number) ?? ""} placeholder={p.defaut && /^[\d.]+$/.test(p.defaut) ? `${p.defaut} par défaut` : undefined}
              onChange={(e) => set(p.code, e.target.value === "" ? undefined : Number(e.target.value))} />;
            break;
          case "BOOLEEN":
            // non touchée : la valeur par défaut du modèle (VRAI / FAUX) est affichée
            champ = <Checkbox checked={v === undefined ? /^\s*VRAI\s*$/i.test(p.defaut ?? "") : !!v} onCheckedChange={(c) => set(p.code, c === true)} />;
            break;
          case "LISTE":
            champ = (
              <Liste value={(v as string) ?? ""} onChange={(x) => set(p.code, x || undefined)}
                vide={p.defaut && /^".*"$/.test(p.defaut) ? `${p.defaut.slice(1, -1)} (par défaut)` : "—"}
                options={(p.valeurs ?? []).map((x) => ({ v: x, l: x }))} />
            );
            break;
          default:
            champ = <Input value={(v as string) ?? ""} onChange={(e) => set(p.code, e.target.value || undefined)} />;
        }
        // une case à cocher se lit mieux devant son libellé ; les autres champs sous le leur
        if (p.type === "BOOLEEN") return (
          <label key={p.code} className="flex cursor-pointer items-center gap-2">
            {champ}<span className="text-sm">{p.libelle}</span>
          </label>
        );
        return (
          <div key={p.code}>
            <span className={classeLibelle}>{p.libelle}{obligatoire && <span className="text-destructive"> *</span>}</span>
            {champ}
          </div>
        );
      })}
    </div>
  );
}

// ── plans de paie de l'année ────────────────────────────────────────────────
type Plan = { id: string; code: string; libelle: string };
const cachePlans = new Map<string, Promise<Plan[]>>();
function ChoixPlan({ valeur, multiple, obligatoire, annee, onChange }: {
  valeur: unknown; multiple: boolean; obligatoire: boolean; annee?: number; onChange: (v: unknown) => void;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    const cle = String(annee ?? "");
    if (!cachePlans.has(cle)) cachePlans.set(cle, editionsApi.plansPaie(annee).catch((e) => { cachePlans.delete(cle); throw e; }));
    cachePlans.get(cle)!.then(setPlans).catch(() => setPlans([]));
  }, [annee]);
  const choisis = Array.isArray(valeur) ? (valeur as string[]) : valeur ? [valeur as string] : [];
  if (multiple) return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5">
      {plans.map((x) => {
        const on = choisis.includes(x.id);
        return (
          <Button key={x.id} type="button" title={x.libelle} size="sm" variant={on ? "secondary" : "outline"} className="h-7 px-2 text-xs"
            onClick={() => onChange(on ? choisis.filter((y) => y !== x.id) : [...choisis, x.id])}>
            {on && <Check className="mr-1 h-3 w-3" />}{x.code}
          </Button>
        );
      })}
      {!plans.length && <span className="px-1 text-xs text-muted-foreground">Aucun plan en {annee ?? "—"}</span>}
      {!choisis.length && plans.length > 0 && <span className="self-center px-1 text-[11px] text-muted-foreground">tous</span>}
    </div>
  );
  return (
    <Liste value={(valeur as string) ?? ""} onChange={(x) => onChange(x || undefined)} vide={obligatoire ? undefined : "Tous les plans"}
      placeholder="— choisir —"
      options={[...plans.map((x) => ({ v: x.id, l: `${x.code} · ${x.libelle}` })),
        ...(typeof valeur === "string" && valeur && !plans.some((x) => x.id === valeur) ? [{ v: valeur, l: "(plan sans période cette année)" }] : [])]} />
  );
}

// ── salariés payés sur la portée (RG-EDT-LANCEMENT-01) ──────────────────────
const cacheCollabs = new Map<string, Promise<CollaborateurPaye[]>>();
const nomCollab = (c: CollaborateurPaye) => `${(c.nom ?? "").toUpperCase()} ${c.prenom ?? ""}`.trim() || c.matricule || c.id.slice(0, 8);

function CollaborateursPayes({ valeur, multiple, portee, onChange }: {
  valeur: unknown; multiple: boolean; portee: Portee; onChange: (v: unknown) => void;
}) {
  const [liste, setListe] = useState<CollaborateurPaye[] | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const cle = JSON.stringify(portee);
  useEffect(() => {
    setListe(null);
    if (!cacheCollabs.has(cle)) cacheCollabs.set(cle, editionsApi.collaborateursPayes(portee).catch((e) => { cacheCollabs.delete(cle); throw e; }));
    cacheCollabs.get(cle)!.then(setListe).catch(() => setListe([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  useEffect(() => {
    const fermer = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, []);

  const choisis = Array.isArray(valeur) ? (valeur as string[]) : valeur ? [valeur as string] : [];
  const parId = new Map((liste ?? []).map((c) => [c.id, c]));
  const bas = q.trim().toLowerCase();
  const filtres = (liste ?? []).filter((c) => !bas || nomCollab(c).toLowerCase().includes(bas) || (c.matricule ?? "").toLowerCase().includes(bas));
  const visibles = filtres.slice(0, 200);
  const basculer = (id: string) => {
    if (!multiple) { onChange(choisis[0] === id ? undefined : id); setOuvert(false); return; }
    onChange(choisis.includes(id) ? choisis.filter((x) => x !== id) : [...choisis, id]);
  };
  const libellePortee = portee.periodes?.length ? "sur la période" : portee.mois ? `en ${MOIS[portee.mois]} ${portee.annee}` : portee.annee ? `en ${portee.annee}` : "";
  const horsPortee = liste ? choisis.filter((id) => !parId.has(id)) : [];

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOuvert((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
        <span className={`flex-1 truncate ${choisis.length ? "" : "text-muted-foreground"}`}>
          {choisis.length === 0 ? `Tous les salariés payés ${libellePortee}${liste ? ` (${liste.length})` : ""}`
            : choisis.length === 1 ? (parId.get(choisis[0]) ? nomCollab(parId.get(choisis[0])!) : "1 salarié")
            : `${choisis.length} salariés choisis`}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      {multiple && choisis.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {choisis.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
              {parId.get(id) ? nomCollab(parId.get(id)!) : "salarié hors de la période"}
              <button type="button" aria-label="Retirer" onClick={() => onChange(choisis.filter((x) => x !== id))}><X className="h-3 w-3" /></button>
            </span>
          ))}
          <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => onChange(undefined)}>Tous</button>
        </div>
      )}
      {horsPortee.length > 0 && (
        <p className="mt-1 text-[11px] text-[hsl(var(--warning))]">{horsPortee.length} salarié(s) choisi(s) sans bulletin {libellePortee} : aucun document pour eux.</p>
      )}
      {ouvert && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="relative border-b">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
              placeholder="Nom ou matricule…" className="w-full bg-transparent py-1.5 pl-7 pr-2 text-sm outline-none" />
          </div>
          <div className="max-h-64 overflow-auto p-1">
            {liste === null && <p className="p-2 text-xs text-muted-foreground">Chargement…</p>}
            {liste !== null && !filtres.length && <p className="p-2 text-xs text-muted-foreground">Aucun salarié payé {libellePortee}{bas ? " pour cette recherche" : ""}.</p>}
            {visibles.map((c) => {
              const on = choisis.includes(c.id);
              return (
                <button key={c.id} type="button" onClick={() => basculer(c.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted ${on ? "bg-primary/10" : ""}`}>
                  <span className="w-4">{on && <Check className="h-3.5 w-3.5 text-primary" />}</span>
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{c.matricule}</span>
                  <span className="flex-1 truncate">{nomCollab(c)}</span>
                  {c.nb_bulletins > 1 && <span className="text-[10px] text-muted-foreground">{c.nb_bulletins} bull.</span>}
                </button>
              );
            })}
            {filtres.length > visibles.length && <p className="p-2 text-[11px] text-muted-foreground">{filtres.length - visibles.length} autres : précisez la recherche.</p>}
          </div>
          {multiple && (
            <div className="flex items-center gap-3 border-t px-2 py-1.5 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => onChange([...new Set([...choisis, ...filtres.map((c) => c.id)])])}>
                Cocher les {filtres.length} affichés
              </button>
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => onChange(undefined)}>Tous (aucun filtre)</button>
              <button type="button" className="ml-auto font-medium" onClick={() => setOuvert(false)}>Fermer</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
