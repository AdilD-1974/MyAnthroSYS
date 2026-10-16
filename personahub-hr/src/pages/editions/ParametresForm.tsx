/**
 * ParametresForm.tsx — Saisie des paramètres d'une édition (lancement, aperçu).
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Le formulaire se construit à partir des paramètres déclarés par le modèle :
 * aucun écran n'est à écrire quand un utilisateur ajoute un paramètre.
 * Le contrôle de périmètre (période d'une autre société…) reste côté serveur.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import CollaborateurPicker from "@/components/CollaborateurPicker";
import { api } from "@/lib/api";
import { editionsApi, type Periode } from "@/lib/editionsApi";
import type { Parametre } from "./types";

export type Valeurs = Record<string, unknown>;

const classe = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

const MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const libellePeriode = (p: Periode) =>
  `${p.intitule || `${MOIS[p.mois]} ${p.annee}`}${p.plan_code ? ` · ${p.plan_code}` : ""} — ${p.nb_bulletins} bulletin(s)`;

export function parametresManquants(parametres: Parametre[], v: Valeurs): string[] {
  return parametres
    .filter((p) => (p.obligatoire ?? true) && !p.defaut)
    .filter((p) => v[p.code] === undefined || v[p.code] === "" || (Array.isArray(v[p.code]) && !(v[p.code] as unknown[]).length))
    .map((p) => p.libelle);
}

export default function ParametresForm({ parametres, valeurs, onChange }: {
  parametres: Parametre[]; valeurs: Valeurs; onChange: (v: Valeurs) => void;
}) {
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [plans, setPlans] = useState<{ id: string; code: string; libelle: string }[]>([]);
  const aPeriode = parametres.some((p) => p.type === "PERIODE");
  const aPlan = parametres.some((p) => p.type === "PLAN_PAIE");

  useEffect(() => {
    if (aPeriode) editionsApi.periodes().then((ps) => {
      setPeriodes(ps);
      // par défaut : la période la plus récente qui a des bulletins
      const defaut = ps.find((p) => p.nb_bulletins > 0) ?? ps[0];
      const nouv = { ...valeurs };
      let change = false;
      for (const p of parametres) {
        if (p.type === "PERIODE" && !valeurs[p.code] && defaut) { nouv[p.code] = defaut.id; change = true; }
      }
      if (change) onChange(nouv);
    }).catch(() => setPeriodes([]));
    if (aPlan) editionsApi.plansPaie().then(setPlans).catch(() => setPlans([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aPeriode, aPlan]);

  const set = (code: string, v: unknown) => onChange({ ...valeurs, [code]: v });

  if (!parametres.length) return <p className="text-sm text-muted-foreground">Ce modèle ne demande aucun paramètre.</p>;

  return (
    <div className="space-y-3">
      {parametres.map((p) => {
        const v = valeurs[p.code];
        const obligatoire = (p.obligatoire ?? true) && !p.defaut;
        let champ: React.ReactNode;
        switch (p.type) {
          case "PERIODE":
            champ = (
              <select className={classe} value={(v as string) ?? ""} onChange={(e) => set(p.code, e.target.value || undefined)}>
                {!obligatoire && <option value="">— toutes —</option>}
                {periodes.map((x) => <option key={x.id} value={x.id}>{libellePeriode(x)}</option>)}
              </select>
            );
            break;
          case "PLAN_PAIE":
            champ = (
              <select className={classe} value={(v as string) ?? ""} onChange={(e) => set(p.code, e.target.value || undefined)}>
                <option value="">{obligatoire ? "— choisir —" : "— tous —"}</option>
                {plans.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.libelle}</option>)}
              </select>
            );
            break;
          case "COLLABORATEUR": {
            const liste = Array.isArray(v) ? (v as string[]) : v ? [v as string] : [];
            champ = p.multiple ? (
              <div>
                <CollaborateurPicker value="" placeholder={liste.length ? "Ajouter un collaborateur…" : "Tous (ou choisir…)"}
                  onChange={(id) => id && !liste.includes(id) && set(p.code, [...liste, id])} />
                {liste.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {liste.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                        <ChipCollab id={id} />
                        <button type="button" onClick={() => set(p.code, liste.filter((x) => x !== id))}><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <CollaborateurPicker value={(v as string) ?? ""} onChange={(id) => set(p.code, id || undefined)} />
            );
            break;
          }
          case "DATE":
            champ = <input type="date" className={classe} value={(v as string) ?? ""} onChange={(e) => set(p.code, e.target.value || undefined)} />;
            break;
          case "ANNEE":
          case "NOMBRE":
            champ = <input type="number" className={classe} value={(v as number) ?? ""} onChange={(e) => set(p.code, e.target.value === "" ? undefined : Number(e.target.value))} />;
            break;
          case "BOOLEEN":
            champ = <input type="checkbox" checked={!!v} onChange={(e) => set(p.code, e.target.checked)} />;
            break;
          case "LISTE":
            champ = (
              <select className={classe} value={(v as string) ?? ""} onChange={(e) => set(p.code, e.target.value || undefined)}>
                <option value="">—</option>
                {(p.valeurs ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            );
            break;
          default:
            champ = <input className={classe} value={(v as string) ?? ""} onChange={(e) => set(p.code, e.target.value || undefined)} />;
        }
        return (
          <label key={p.code} className="block">
            <span className="mb-1 block text-xs font-medium">
              {p.libelle}{obligatoire && <span className="text-destructive"> *</span>}
            </span>
            {champ}
          </label>
        );
      })}
    </div>
  );
}

/** Nom d'un collaborateur choisi (lecture unitaire, mise en cache). */
const nomsCollab = new Map<string, string>();
function ChipCollab({ id }: { id: string }) {
  const [nom, setNom] = useState(nomsCollab.get(id) ?? "…");
  useEffect(() => {
    if (nomsCollab.has(id)) return;
    api.get<{ nom: string; prenom: string; matricule?: string }[]>(`/db/collaborateurs?id=eq.${id}&select=nom,prenom,matricule`)
      .then((r) => {
        const c = r?.[0];
        const n = c ? `${c.nom} ${c.prenom}${c.matricule ? ` (${c.matricule})` : ""}` : id.slice(0, 8);
        nomsCollab.set(id, n);
        setNom(n);
      })
      .catch(() => setNom(id.slice(0, 8)));
  }, [id]);
  return <span>{nom}</span>;
}
