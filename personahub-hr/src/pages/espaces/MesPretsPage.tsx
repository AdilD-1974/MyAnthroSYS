// MesPretsPage.tsx v2 — Espace collaborateur : Mes Prêts (enrichi)
// src/pages/espaces/MesPretsPage.tsx

import React, { useEffect, useState, useCallback } from "react";
import {
  Plus, ChevronDown, ChevronUp, Clock, CheckCircle2,
  XCircle, PauseCircle, TrendingDown, Info,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  pretsApi, Pret, Echeance,
  PRET_STATUT_LABELS, PRET_STATUT_COLORS, ALGO_LABELS,
  formatMontant, formatDate, avancementPct,
} from "@/lib/pretsApi";
import SimulateurPret from "@/components/prets/SimulateurPret";
import NouvelleDemandeDialog from "@/components/prets/NouvelleDemandeDialog";

// ──────────────────────────────────────────────────────────────
// ICÔNE DYNAMIQUE
// ──────────────────────────────────────────────────────────────
const DynIcon: React.FC<{ name?: string; size?: number; color?: string }> = ({
  name = "Banknote", size = 18, color,
}) => {
  const Icon = (LucideIcons as Record<string, any>)[name];
  return Icon ? <Icon size={size} color={color} /> : <LucideIcons.Banknote size={size} color={color} />;
};

// ──────────────────────────────────────────────────────────────
// BADGE STATUT
// ──────────────────────────────────────────────────────────────
const StatutPill: React.FC<{ statut: Pret["statut"] }> = ({ statut }) => {
  const c = PRET_STATUT_COLORS[statut] ?? { bg: "bg-gray-100", text: "text-gray-600" };
  const icons: Partial<Record<Pret["statut"], React.ReactNode>> = {
    en_attente_validation: <Clock size={10} />,
    valide: <CheckCircle2 size={10} />,
    debloque: <TrendingDown size={10} />,
    en_cours: <TrendingDown size={10} />,
    suspendu: <PauseCircle size={10} />,
    solde: <CheckCircle2 size={10} />,
    refuse: <XCircle size={10} />,
    annule: <XCircle size={10} />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${c.bg} ${c.text}`}>
      {icons[statut]}
      {PRET_STATUT_LABELS[statut]}
    </span>
  );
};

// ──────────────────────────────────────────────────────────────
// CARTE PRÊT
// ──────────────────────────────────────────────────────────────
const CartePret: React.FC<{ pret: Pret; onAnnuler: (id: string) => void }> = ({
  pret, onAnnuler,
}) => {
  const [ouvert, setOuvert] = useState(false);
  const [echeances, setEcheances] = useState<Echeance[]>([]);
  const [chargement, setChargement] = useState(false);

  const toggleEcheancier = async () => {
    if (!ouvert && echeances.length === 0) {
      setChargement(true);
      try { setEcheances(await pretsApi.mesEcheances(pret.id)); }
      finally { setChargement(false); }
    }
    setOuvert(v => !v);
  };

  const avancement = avancementPct(pret);
  const estActif = ["debloque", "en_cours"].includes(pret.statut);
  const peutAnnuler = ["brouillon", "en_attente_validation"].includes(pret.statut);
  const algoInfo = ALGO_LABELS[pret.algo_name];

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: (pret.type_couleur ?? "#0ea5e9") + "20" }}
          >
            <DynIcon
              name={pret.type_icone ?? "Banknote"}
              size={19}
              color={pret.type_couleur ?? "#0ea5e9"}
            />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {pret.type_libelle ?? (pret.pret_interne ? "Prêt interne" : "Prêt externe")}
            </p>
            {pret.objet && (
              <p className="text-xs text-muted-foreground">{pret.objet}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {pret.ref_pret} · {formatDate(pret.dt_demande)}
            </p>
          </div>
        </div>
        <StatutPill statut={pret.statut} />
      </div>

      {/* Chiffres clés */}
      <div className="grid grid-cols-4 divide-x border-t border-b bg-secondary/20">
        {[
          { label: "Montant", value: formatMontant(pret.mt_pret) },
          { label: "Mensualité", value: pret.mt_echeance ? formatMontant(pret.mt_echeance) : "—" },
          { label: "Durée", value: `${pret.nb_echeance} mois` },
          { label: "Méthode", value: algoInfo?.court ?? pret.algo_name },
        ].map(({ label, value }) => (
          <div key={label} className="py-2.5 px-2 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
            <p className="text-xs font-semibold truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Description algorithme (au survol via tooltip ou affiché si actif) */}
      {algoInfo && pret.tx_interets > 0 && (
        <div className="px-4 pt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info size={11} className="mt-0.5 flex-shrink-0" />
          <span>{algoInfo.description}</span>
        </div>
      )}

      {/* Rubrique de paie */}
      {pret.rubrique_lib && (
        <div className="px-4 pt-1 text-[11px] text-muted-foreground">
          Rubrique de paie : <span className="font-medium">{pret.rubrique_lib}</span>
          {pret.rubrique_paie_code && <span className="ml-1 text-muted-foreground/60">({pret.rubrique_paie_code})</span>}
        </div>
      )}

      {/* Taux d'endettement avant/après */}
      {(pret.tx_endettement_avant != null || pret.tx_endettement_apres != null) && (
        <div className="px-4 pt-1.5 flex items-center gap-3 text-[11px]">
          {pret.tx_endettement_avant != null && (
            <span className="text-muted-foreground">
              Endettement avant : <strong>{pret.tx_endettement_avant}%</strong>
            </span>
          )}
          {pret.tx_endettement_apres != null && (
            <span className={pret.tx_endettement_apres > 33 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
              → Après : <strong>{pret.tx_endettement_apres}%</strong>
              {pret.tx_endettement_apres > 33 && " ⚠ Dépasse 33%"}
            </span>
          )}
        </div>
      )}

      {/* Première retenue prévue */}
      {pret.dt_premiere_retenue && (
        <div className="px-4 pt-1 text-[11px] text-muted-foreground">
          Première retenue demandée : <strong>{formatDate(pret.dt_premiere_retenue)}</strong>
        </div>
      )}

      {/* Avantage en nature */}
      {pret.avantage_nature_mensuel > 0 && (
        <div className="px-4 pt-1 text-[11px] text-orange-600">
          Avantage en nature mensuel : {formatMontant(pret.avantage_nature_mensuel)} (à réintégrer au salaire imposable)
        </div>
      )}

      {/* Barre de progression */}
      {estActif && pret.mt_debloque && (
        <div className="px-4 pt-3 pb-1 space-y-1.5">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Remboursé : {formatMontant(pret.mt_rembourse)}</span>
            <span className="font-medium">{avancement}%</span>
            <span>Restant : {formatMontant(pret.capital_restant)}</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${avancement}%` }}
            />
          </div>
          {pret.dt_proch_echeance && (
            <p className="text-[11px] text-muted-foreground">
              Prochaine échéance : <strong>{formatDate(pret.dt_proch_echeance)}</strong>
              {pret.echeance_restant != null && ` · ${pret.echeance_restant} restante${pret.echeance_restant > 1 ? "s" : ""}`}
            </p>
          )}
          {pret.mt_echeance_plus > 0 && (
            <p className="text-[11px] text-orange-600">
              ⚠ Reliquat reporté : {formatMontant(pret.mt_echeance_plus)}
            </p>
          )}
        </div>
      )}

      {/* Suspension */}
      {pret.pret_suspendu && (
        <div className="mx-4 my-2 rounded border border-orange-200 bg-orange-50/70 px-3 py-2 text-xs text-orange-700">
          <PauseCircle size={11} className="inline mr-1" />
          Prêt suspendu. Reprise prévue le {formatDate(pret.dt_fin_suspension)}.
        </div>
      )}

      {/* Refus */}
      {pret.statut === "refuse" && pret.motif_decision && (
        <div className="mx-4 my-2 rounded border border-red-100 bg-red-50/50 px-3 py-2 text-xs text-red-700">
          <XCircle size={11} className="inline mr-1" />
          Refusé — {pret.motif_decision}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 px-4 py-3">
        {(estActif || pret.statut === "valide") && (
          <button
            type="button"
            onClick={toggleEcheancier}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {ouvert ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {ouvert ? "Masquer" : "Voir"} le tableau d'amortissement
          </button>
        )}
        {peutAnnuler && (
          <button
            type="button"
            onClick={() => onAnnuler(pret.id)}
            className="ml-auto text-xs text-destructive hover:underline"
          >
            Annuler la demande
          </button>
        )}
      </div>

      {/* Tableau d'amortissement */}
      {ouvert && (
        <div className="border-t">
          {chargement ? (
            <p className="text-xs text-muted-foreground px-4 py-3">Chargement…</p>
          ) : echeances.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-3">Échéancier non encore généré.</p>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/40 sticky top-0">
                  <tr>
                    {["N°","Date","Capital","Intérêts","Total","Restant","Statut"].map(h => (
                      <th key={h} className="px-3 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {echeances.map(e => (
                    <tr key={e.numero}
                      className={`border-t ${e.statut === "prelevee" ? "opacity-40" : ""} ${e.reliquat > 0 ? "bg-orange-50/40" : ""}`}
                    >
                      <td className="px-3 py-1">{e.numero}</td>
                      <td className="px-3 py-1">{formatDate(e.date_echeance)}</td>
                      <td className="px-3 py-1">{formatMontant(e.mt_capital)}</td>
                      <td className="px-3 py-1 text-muted-foreground">{formatMontant(e.mt_interet)}</td>
                      <td className="px-3 py-1 font-medium">{formatMontant(e.mt_total)}</td>
                      <td className="px-3 py-1 text-muted-foreground">{formatMontant(e.capital_restant)}</td>
                      <td className="px-3 py-1">
                        <span className={
                          e.statut === "prelevee" ? "text-green-600" :
                          e.statut === "reportee" ? "text-orange-500" :
                          e.statut === "forcee" ? "text-purple-600" : "text-blue-500"
                        }>{e.statut}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ──────────────────────────────────────────────────────────────
const MesPretsPage: React.FC = () => {
  const [prets, setPrets] = useState<Pret[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNouvelle, setShowNouvelle] = useState(false);
  const [tab, setTab] = useState<"mes-prets" | "simuler">("mes-prets");

  const charger = useCallback(async () => {
    setLoading(true);
    try { setPrets(await pretsApi.mesPrets()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const annuler = async (id: string) => {
    if (!confirm("Confirmer l'annulation de cette demande ?")) return;
    try { await pretsApi.supprimer(id); charger(); }
    catch (e: any) { alert(e?.detail ?? "Impossible d'annuler."); }
  };

  const actifs = prets.filter(p => ["debloque","en_cours","suspendu"].includes(p.statut));
  const enAttente = prets.filter(p => ["brouillon","en_attente_validation","valide"].includes(p.statut));
  const historique = prets.filter(p => ["solde","refuse","annule"].includes(p.statut));

  const totalCapital = actifs.reduce((s, p) => s + (p.capital_restant ?? 0), 0);
  const totalMens = actifs.reduce((s, p) => s + (p.mt_echeance ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-2 text-[13px] text-muted-foreground">
        <span className="font-semibold text-foreground">Mes Prêts</span>
      </div>
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap border-b border-border bg-card">
        <button onClick={() => setShowNouvelle(true)}
          className="flex items-center gap-1.5 text-[13px] font-medium h-8 px-3"
          style={{ background: "hsl(var(--primary))", color: "white", borderRadius: "var(--radius)" }}>
          <Plus size={14} /> Nouvelle demande
        </button>
        <div className="flex-1" />
        <span className="text-[12px] text-muted-foreground">Prêts internes et cessions externes sur salaire</span>
      </div>

      <div className="px-4 py-6 space-y-6">
      {actifs.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-border bg-card px-4 py-3 text-center rounded-[var(--radius)]">
            <p className="text-xs text-muted-foreground mb-0.5">Capital restant total</p>
            <p className="text-base font-semibold" style={{ color: "hsl(var(--warning))" }}>{formatMontant(totalCapital)}</p>
          </div>
          <div className="border border-border bg-card px-4 py-3 text-center rounded-[var(--radius)]">
            <p className="text-xs text-muted-foreground mb-0.5">Mensualités totales / mois</p>
            <p className="text-base font-semibold">{formatMontant(totalMens)}</p>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="mes-prets">
            Mes dossiers {prets.length > 0 && <span className="ml-1 text-[11px] text-muted-foreground">({prets.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="simuler">Simulateur</TabsTrigger>
        </TabsList>

        <TabsContent value="mes-prets" className="mt-4 space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Chargement…</p>
          ) : prets.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <LucideIcons.Banknote size={36} className="mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground mb-3">Aucun prêt en cours.</p>
              <Button variant="outline" size="sm" onClick={() => setShowNouvelle(true)}>
                Faire une demande
              </Button>
            </div>
          ) : (
            <>
              {actifs.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">En cours de remboursement</h2>
                  {actifs.map(p => <CartePret key={p.id} pret={p} onAnnuler={annuler} />)}
                </section>
              )}
              {enAttente.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Demandes en attente</h2>
                  {enAttente.map(p => <CartePret key={p.id} pret={p} onAnnuler={annuler} />)}
                </section>
              )}
              {historique.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Historique</h2>
                  {historique.map(p => <CartePret key={p.id} pret={p} onAnnuler={annuler} />)}
                </section>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="simuler" className="mt-4">
          <div className="rounded-lg border bg-card p-5">
            <p className="text-sm font-medium mb-4">Simuler un prêt avant de faire une demande</p>
            <SimulateurPret showAdopter onAdopter={() => setShowNouvelle(true)} />
          </div>
        </TabsContent>
      </Tabs>

      <NouvelleDemandeDialog
        open={showNouvelle}
        onClose={() => setShowNouvelle(false)}
        onSuccess={charger}
      />
      </div>
    </div>
  );
};

export default MesPretsPage;
