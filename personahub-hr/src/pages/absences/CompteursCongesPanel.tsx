import React from "react";
import { useQuery } from "@tanstack/react-query";
import { db, api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, Loader2, RefreshCw } from "lucide-react";

/**
 * CompteursCongesPanel
 * Affiche les compteurs de congés d'un collaborateur pour un exercice, en DEUX modes :
 *  • CONGE_PAYE  → SOLDE ACQUIS (prorata) lu dans cong_solde (acquis/pris/en attente/restant/reliquat).
 *  • Autres familles → PLAFOND : droit max (ref_type_conge.droit_legal_jours), sans pré-acquisition,
 *                       consommation calculée depuis cong_demandes (APPROUVEE) + en attente (EN_ATTENTE).
 */
interface SoldeRow {
  code_type_conge: string;
  solde_acquis: number; solde_pris: number; solde_en_attente: number; solde_restant: number; reliquat_reporte: number;
}
interface TypeRow { code: string; libelle: string; code_famille: string; plafond: number; }
interface DemandeRow { code_type_conge: string; statut: string; nbr_jours_decomptes: number; date_debut: string; }

interface Props { collaborateurId: string; exercice: number; }

const n = (v: any) => Number(v ?? 0);
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export default function CompteursCongesPanel({ collaborateurId, exercice }: Props) {
  // 1) Soldes pré-calculés (congés payés)
  const { data: soldes = [], isLoading: loadingSoldes } = useQuery<SoldeRow[]>({
    queryKey: ["cong-soldes", collaborateurId, exercice],
    enabled: !!collaborateurId,
    queryFn: async () => {
      const rows = await db.list<any>("cong_solde", {
        select: "code_type_conge,solde_acquis,solde_pris,solde_en_attente,solde_restant,reliquat_reporte",
        collaborateur_id: collaborateurId, exercice, archive: false, order: "code_type_conge",
      });
      return (rows || []).map((r) => ({
        code_type_conge: r.code_type_conge,
        solde_acquis: n(r.solde_acquis), solde_pris: n(r.solde_pris), solde_en_attente: n(r.solde_en_attente),
        solde_restant: n(r.solde_restant), reliquat_reporte: n(r.reliquat_reporte),
      }));
    },
  });

  // 2) Tous les types actifs (famille + plafond)
  const { data: types = [], isLoading: loadingTypes } = useQuery<TypeRow[]>({
    queryKey: ["ref-type-conge-plafonds"],
    queryFn: async () => {
      const rows = await db.list<any>("ref_type_conge", {
        select: "code,libelle,code_famille,droit_legal_jours,droit_convention_jours,droit_particulier_jours",
        actif: true, order: "ordre",
      });
      return (rows || []).map((r) => ({
        code: r.code, libelle: r.libelle, code_famille: r.code_famille,
        plafond: n(r.droit_legal_jours ?? r.droit_convention_jours ?? r.droit_particulier_jours),
      }));
    },
  });

  // 3) Consommation (demandes de l'exercice) pour les types PLAFOND
  const { data: demandes = [], isLoading: loadingDem } = useQuery<DemandeRow[]>({
    queryKey: ["cong-demandes-conso", collaborateurId, exercice],
    enabled: !!collaborateurId,
    queryFn: async () => {
      // exercice borné sur date_debut ; filtre mono-colonne d'order
      const rows = await api.get(
        `/db/cong_demandes?select=code_type_conge,statut,nbr_jours_decomptes,date_debut` +
        `&collaborateur_id=eq.${collaborateurId}&archive=eq.false` +
        `&date_debut=gte.${exercice}-01-01&date_debut=lte.${exercice}-12-31&order=date_debut`
      );
      return (rows || []).map((r: any) => ({
        code_type_conge: r.code_type_conge, statut: r.statut,
        nbr_jours_decomptes: n(r.nbr_jours_decomptes), date_debut: r.date_debut,
      }));
    },
  });

  if (!collaborateurId) return null;
  const isLoading = loadingSoldes || loadingTypes || loadingDem;

  const soldeByCode = new Map<string, SoldeRow>(soldes.map((s) => [s.code_type_conge, s]));

  // Consommation agrégée par type (APPROUVEE = pris, EN_ATTENTE = en attente)
  const prisByCode = new Map<string, number>();
  const attenteByCode = new Map<string, number>();
  demandes.forEach((d) => {
    if (d.statut === "APPROUVEE") prisByCode.set(d.code_type_conge, (prisByCode.get(d.code_type_conge) ?? 0) + d.nbr_jours_decomptes);
    else if (d.statut === "EN_ATTENTE") attenteByCode.set(d.code_type_conge, (attenteByCode.get(d.code_type_conge) ?? 0) + d.nbr_jours_decomptes);
  });

  // Construction des cartes
  const cartes = types.map((t) => {
    const isCP = t.code_famille === "CONGE_PAYE";
    if (isCP) {
      const s = soldeByCode.get(t.code);
      const dispo = s ? s.solde_restant - s.solde_en_attente : 0;
      return {
        ...t, mode: "solde" as const, ouvert: !!s,
        acquis: s?.solde_acquis ?? 0, pris: s?.solde_pris ?? 0, attente: s?.solde_en_attente ?? 0,
        restant: s?.solde_restant ?? 0, reliquat: s?.reliquat_reporte ?? 0, dispo,
      };
    }
    const pris = prisByCode.get(t.code) ?? 0;
    const attente = attenteByCode.get(t.code) ?? 0;
    const restant = Math.max(0, t.plafond - pris);
    return { ...t, mode: "plafond" as const, ouvert: t.plafond > 0, acquis: t.plafond, pris, attente, restant, reliquat: 0, dispo: restant - attente };
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={16} style={{ color: "hsl(var(--primary))" }} />
          <h2 className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
            Mes compteurs de congés — exercice {exercice}
          </h2>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            <Loader2 size={16} className="animate-spin" /> Chargement des compteurs…
          </div>
        ) : cartes.length === 0 ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
            <RefreshCw size={15} /> Aucun type de congé actif.
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
            {cartes.map((c) => {
              const dispoColor = c.dispo <= 0 ? "#DC2626" : c.dispo < 3 ? "#E07B39" : "#16A34A";
              const badge = c.mode === "plafond"
                ? { txt: "plafond", bg: "#6366F11F", fg: "#6366F1" }
                : (!c.ouvert ? { txt: "non ouvert", bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" } : null);
              return (
                <div key={c.code} className="rounded-xl border p-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                  <div className="text-xs font-medium mb-2 flex items-center gap-1" style={{ color: "hsl(var(--foreground))" }} title={c.libelle}>
                    <span className="truncate flex-1">{c.libelle}</span>
                    {badge && <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: badge.bg, color: badge.fg }}>{badge.txt}</span>}
                  </div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-2xl font-bold" style={{ color: dispoColor }}>{fmt(c.dispo)}</span>
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>j disponibles</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <span>{c.mode === "plafond" ? "Plafond" : "Acquis"}</span>
                    <span className="text-right font-medium flex items-center justify-end gap-0.5" style={{ color: "hsl(var(--foreground))" }}>
                      {fmt(c.acquis)} j
                    </span>
                    <span>Pris</span><span className="text-right font-medium" style={{ color: "hsl(var(--foreground))" }}>{fmt(c.pris)} j</span>
                    <span>En attente</span><span className="text-right font-medium" style={{ color: "hsl(var(--foreground))" }}>{fmt(c.attente)} j</span>
                    {c.mode === "solde" && (<><span>Restant</span><span className="text-right font-medium" style={{ color: "hsl(var(--foreground))" }}>{fmt(c.restant)} j</span></>)}
                    {c.mode === "plafond" && (<><span>Restant</span><span className="text-right font-medium" style={{ color: "hsl(var(--foreground))" }}>{fmt(c.restant)} j</span></>)}
                    {c.reliquat > 0 && (<><span>Reliquat reporté</span><span className="text-right font-medium" style={{ color: "hsl(var(--foreground))" }}>{fmt(c.reliquat)} j</span></>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
