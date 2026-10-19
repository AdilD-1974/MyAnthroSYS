/**
 * FiltresPopulation.tsx — Choix de la population au lancement d'une édition.
 * Auteur : Adil DAIA — 19/10/2026 — RG-EDT-FILTRE-01..03
 *
 * Unités organisationnelles (arbre, avec ou sans les UO rattachées), catégories professionnelles,
 * classifications, emplois, métiers, types de contrat. Plusieurs valeurs d'un critère = OU,
 * plusieurs critères = ET. Le filtre porte sur la situation figée au calcul du bulletin.
 * La valeur est transmise au serveur dans le paramètre réservé « _filtres ».
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, ChevronDown, ChevronRight, Filter, RotateCcw, Search } from "lucide-react";
import MultiSelect from "@/components/MultiSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { editionsApi, type FiltresValeurs, type UoFiltre } from "@/lib/editionsApi";

export interface Filtres {
  uo?: string[];
  uo_rattachees?: boolean;
  categories?: string[];
  classifications?: string[];
  emplois?: string[];
  metiers?: string[];
  contrats?: string[];
}

let cache: Promise<FiltresValeurs> | null = null;
const charger = () => (cache ??= editionsApi.filtresPopulation().catch((e) => { cache = null; throw e; }));

export function nbFiltres(f?: Filtres | null): number {
  if (!f) return 0;
  return ["uo", "categories", "classifications", "emplois", "metiers", "contrats"]
    .filter((k) => ((f as Record<string, unknown>)[k] as string[] | undefined)?.length).length;
}

/** Filtres sans les critères vides (rien n'est envoyé quand rien n'est choisi). */
export function filtresUtiles(f?: Filtres | null): Filtres | undefined {
  if (!f || !nbFiltres(f)) return undefined;
  const r: Filtres = {};
  for (const [k, v] of Object.entries(f)) if (Array.isArray(v) ? v.length : k === "uo_rattachees") (r as any)[k] = v;
  return r;
}

export default function FiltresPopulation({ valeur, onChange, ouvertParDefaut = false }: {
  valeur?: Filtres | null;
  onChange: (f: Filtres | undefined) => void;
  ouvertParDefaut?: boolean;
}) {
  const [donnees, setDonnees] = useState<FiltresValeurs | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(ouvertParDefaut || nbFiltres(valeur) > 0);
  const f: Filtres = valeur ?? {};
  const n = nbFiltres(f);

  useEffect(() => { if (ouvert && !donnees) charger().then(setDonnees).catch((e) => setErreur(e.message)); }, [ouvert, donnees]);

  const poser = (cle: keyof Filtres, v: unknown) => {
    const suivant = { ...f, [cle]: v } as Filtres;
    onChange(nbFiltres(suivant) ? suivant : undefined);
  };

  return (
    <div className="rounded-md border">
      <button type="button" onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs font-medium hover:bg-muted/50">
        {ouvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Filter className="h-3.5 w-3.5 text-primary" />
        Population
        <span className="font-normal text-muted-foreground">{n ? `· ${n} critère(s)` : "· tous les salariés"}</span>
        {n > 0 && (
          <span role="button" tabIndex={0} title="Retirer tous les filtres" className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onChange(undefined); }}><RotateCcw className="h-3.5 w-3.5" /></span>
        )}
      </button>
      {ouvert && (
        <div className="space-y-3 border-t p-2.5">
          {erreur && <p className="text-xs text-destructive">{erreur}</p>}
          {!donnees && !erreur && <p className="text-xs text-muted-foreground">Chargement…</p>}
          {donnees && (
            <>
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-medium">Unités organisationnelles</span>
                  <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Une UO cochée inclut celles qui lui sont rattachées">
                    <Switch checked={f.uo_rattachees !== false} onCheckedChange={(v) => poser("uo_rattachees", v)} />
                    Inclure les UO rattachées
                  </label>
                </div>
                <ArbreUo uos={donnees.uos} choisies={f.uo ?? []} rattachees={f.uo_rattachees !== false}
                  onChange={(ids) => poser("uo", ids)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {donnees.criteres.map((c) => (
                  <label key={c.code} className="block">
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{c.libelle}</span>
                    <MultiSelect options={c.options.map((o) => ({ value: o.code, label: o.libelle }))}
                      selected={((f as Record<string, unknown>)[c.code] as string[] | undefined) ?? []}
                      onChange={(v) => poser(c.code as keyof Filtres, v)}
                      placeholder={c.options.length ? "Toutes" : "Aucune valeur paramétrée"} searchable />
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Plusieurs valeurs d'un critère : l'une ou l'autre. Plusieurs critères : tous à la fois.
                La situation prise en compte est celle du salarié au calcul du bulletin.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ArbreUo({ uos, choisies, rattachees, onChange }: {
  uos: UoFiltre[]; choisies: string[]; rattachees: boolean; onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [fermes, setFermes] = useState<Set<string>>(new Set());
  const { enfants, racines } = useMemo(() => {
    const ids = new Set(uos.map((u) => u.id));
    const e: Record<string, UoFiltre[]> = {};
    const r: UoFiltre[] = [];
    uos.forEach((u) => { if (u.parent_id && ids.has(u.parent_id)) (e[u.parent_id] ??= []).push(u); else r.push(u); });
    return { enfants: e, racines: r };
  }, [uos]);
  // UO couvertes par un choix (elles-mêmes cochées, ou rattachées à une UO cochée)
  const couvertes = useMemo(() => {
    const res = new Set<string>();
    const pile = [...choisies];
    while (pile.length) {
      const x = pile.pop()!;
      if (res.has(x)) continue;
      res.add(x);
      if (rattachees) (enfants[x] ?? []).forEach((c) => pile.push(c.id));
    }
    return res;
  }, [choisies, rattachees, enfants]);
  const bas = q.trim().toLowerCase();
  const correspond = (u: UoFiltre): boolean =>
    !bas || u.libelle.toLowerCase().includes(bas) || (u.code ?? "").toLowerCase().includes(bas) || (enfants[u.id] ?? []).some(correspond);

  const basculer = (id: string) => onChange(choisies.includes(id) ? choisies.filter((x) => x !== id) : [...choisies, id]);
  const rendre = (u: UoFiltre, niveau: number): ReactNode => {
    if (!correspond(u)) return null;
    const ferme = fermes.has(u.id) && !bas;
    const sous = enfants[u.id] ?? [];
    const herite = couvertes.has(u.id) && !choisies.includes(u.id);
    return (
      <div key={u.id}>
        <div className="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted" style={{ paddingLeft: 4 + niveau * 14 }}>
          {sous.length ? (
            <button type="button" className="text-muted-foreground" onClick={() => setFermes((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })}>
              {ferme ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          ) : <span className="w-3" />}
          <Checkbox checked={couvertes.has(u.id)} disabled={herite} onCheckedChange={() => basculer(u.id)}
            title={herite ? "Incluse : rattachée à une UO cochée" : ""} className="h-3.5 w-3.5" />
          <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className={`truncate ${herite ? "text-muted-foreground" : ""}`}>{u.libelle}</span>
          {u.code && <span className="text-[10px] text-muted-foreground">{u.code}</span>}
        </div>
        {!ferme && sous.map((c) => rendre(c, niveau + 1))}
      </div>
    );
  };
  if (!uos.length) return <p className="text-xs text-muted-foreground">Aucune unité organisationnelle paramétrée pour la société.</p>;
  return (
    <div className="rounded border">
      <div className="relative border-b">
        <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une UO…"
          className="w-full bg-transparent py-1 pl-7 pr-2 text-xs outline-none" />
      </div>
      <div className="max-h-44 overflow-auto p-1">{racines.map((u) => rendre(u, 0))}</div>
      {choisies.length > 0 && (
        <div className="flex items-center border-t px-2 py-1 text-[11px] text-muted-foreground">
          {choisies.length} UO cochée(s){rattachees ? ` · ${couvertes.size} au total avec les rattachées` : ""}
          <button type="button" className="ml-auto text-primary hover:underline" onClick={() => onChange([])}>Effacer</button>
        </div>
      )}
    </div>
  );
}
