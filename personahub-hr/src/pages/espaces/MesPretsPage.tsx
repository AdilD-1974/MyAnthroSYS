// MesPretsPage.tsx — Espace collaborateur : Mes Prêts & Avances
// src/pages/espaces/MesPretsPage.tsx
//
// Affiche : liste des prêts du collaborateur connecté, détail de chaque prêt,
// tableau d'amortissement avec barre de progression, possibilité d'annuler
// une demande en brouillon/en attente, et bouton de nouvelle demande.

import React, { useEffect, useState, useCallback } from "react";
import {
  Banknote, Building2, Plus, ChevronDown, ChevronUp,
  Clock, CheckCircle2, XCircle, PauseCircle, TrendingDown,
} from "lucide-react";
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
// COMPOSANTS LOCAUX
// ──────────────────────────────────────────────────────────────

const StatutPill: React.FC<{ statut: Pret["statut"] }> = ({ statut }) => {
  const c = PRET_STATUT_COLORS[statut] ?? { bg: "bg-gray-100", text: "text-gray-600" };
  const icons: Partial<Record<Pret["statut"], React.ReactNode>> = {
    en_attente_validation: <Clock size={11} />,
    valide: <CheckCircle2 size={11} />,
    debloque: <TrendingDown size={11} />,
    en_cours: <TrendingDown size={11} />,
    suspendu: <PauseCircle size={11} />,
    solde: <CheckCircle2 size={11} />,
    refuse: <XCircle size={11} />,
    annule: <XCircle size={11} />,
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

const CartePret: React.FC<{
  pret: Pret;
  onAnnuler: (id: string) => void;
}> = ({ pret, onAnnuler }) => {
  const [ouvert, setOuvert] = useState(false);
  const [echeances, setEcheances] = useState<Echeance[]>([]);
  const [chargement, setChargement] = useState(false);

  const toggleEcheancier = async () => {
    if (!ouvert && echeances.length === 0) {
      setChargement(true);
      try {
        const data = await pretsApi.mesEcheances(pret.id);
        setEcheances(data);
      } finally {
        setChargement(false);
      }
    }
    setOuvert(v => !v);
  };

  const avancement = avancementPct(pret);
  const peutAnnuler = ["brouillon", "en_attente_validation"].includes(pret.statut);
  const estActif = ["debloque", "en_cours"].includes(pret.statut);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${pret.pret_interne ? "bg-sky-50" : "bg-amber-50"}`}>
            {pret.pret_interne
              ? <Banknote size={18} className="text-sky-500" />
              : <Building2 size={18} className="text-amber-500" />
            }
          </div>
          <div>
            <p className="text-sm font-semibold">
              {pret.pret_interne ? "Prêt interne" : "Cession externe"}
              {!pret.pret_interne && pret.organisme_credit && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">— {pret.organisme_credit}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{pret.ref_pret} · Soumis le {formatDate(pret.dt_demande)}</p>
          </div>
        </div>
        <StatutPill statut={pret.statut} />
      </div>

      {/* Chiffres clés */}
      <div className="grid grid-cols-4 divide-x border-t border-b bg-secondary/20 text-center">
        <div className="py-2.5 px-2">
          <p className="text-[10px] text-muted-foreground mb-0.5">Montant</p>
          <p className="text-sm font-semibold">{formatMontant(pret.mt_pret)}</p>
        </div>
        <div className="py-2.5 px-2">
          <p className="text-[10px] text-muted-foreground mb-0.5">Mensualité</p>
          <p className="text-sm font-semibold">{pret.mt_echeance ? formatMontant(pret.mt_echeance) : "—"}</p>
        </div>
        <div className="py-2.5 px-2">
          <p className="text-[10px] text-muted-foreground mb-0.5">Durée</p>
          <p className="text-sm font-semibold">{pret.nb_echeance} mois</p>
        </div>
        <div className="py-2.5 px-2">
          <p className="text-[10px] text-muted-foreground mb-0.5">Méthode</p>
          <p className="text-xs font-medium truncate">{ALGO_LABELS[pret.algo_name]?.split(" ")[0]}</p>
        </div>
      </div>

      {/* Barre de progression (prêts actifs) */}
      {estActif && pret.mt_debloque && (
        <div className="px-4 py-3 space-y-1.5">
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
              ⚠ Reliquat reporté sur prochaine paie : {formatMontant(pret.mt_echeance_plus)}
            </p>
          )}
        </div>
      )}

      {/* Suspension */}
      {pret.pret_suspendu && (
        <div className="mx-4 mb-3 rounded border border-orange-200 bg-orange-50/70 px-3 py-2 text-xs text-orange-700">
          <PauseCircle size={11} className="inline mr-1" />
          Prêt suspendu — Les prélèvements sur paie sont arrêtés.
          {pret.dt_fin_suspension && ` Reprise prévue le ${formatDate(pret.dt_fin_suspension)}.`}
        </div>
      )}

      {/* Décision RH */}
      {pret.motif_decision && pret.statut === "refuse" && (
        <div className="mx-4 mb-3 rounded border border-red-100 bg-red-50/50 px-3 py-2 text-xs text-red-700">
          <XCircle size={11} className="inline mr-1" />
          Refusé — {pret.motif_decision}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-1">
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

      {/* Tableau d'amortissement inline */}
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
                    {["N°", "Date", "Capital", "Intérêts", "Total", "Restant", "Statut"].map(h => (
                      <th key={h} className="px-3 py-1.5 text-left font-medium text-muted-foreground first:pl-4 last:pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {echeances.map(e => (
                    <tr key={e.numero} className={`border-t ${e.statut === "prelevee" ? "opacity-40" : ""} ${e.reliquat > 0 ? "bg-orange-50/40" : ""}`}>
                      <td className="px-3 py-1 pl-4">{e.numero}</td>
                      <td className="px-3 py-1">{formatDate(e.date_echeance)}</td>
                      <td className="px-3 py-1">{formatMontant(e.mt_capital)}</td>
                      <td className="px-3 py-1 text-muted-foreground">{formatMontant(e.mt_interet)}</td>
                      <td className="px-3 py-1 font-medium">{formatMontant(e.mt_total)}</td>
                      <td className="px-3 py-1 text-muted-foreground">{formatMontant(e.capital_restant)}</td>
                      <td className="px-3 py-1 pr-4">
                        <span className={
                          e.statut === "prelevee" ? "text-green-600" :
                          e.statut === "reportee" ? "text-orange-500" :
                          e.statut === "forcee" ? "text-purple-600" : "text-blue-500"
                        }>
                          {e.statut}
                        </span>
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
    try {
      const data = await pretsApi.mesPrets();
      setPrets(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const annuler = async (id: string) => {
    if (!confirm("Confirmer l'annulation de cette demande ?")) return;
    // Suppression logique via l'endpoint de suppression (SL 0+ autorisé pour ses propres brouillons)
    // On passe par le statut 'annule' via un endpoint dédié si disponible, sinon via DELETE
    try {
      await pretsApi.supprimer(id);
      charger();
    } catch (e: any) {
      alert(e?.detail ?? "Impossible d'annuler ce prêt.");
    }
  };

  // Regroupement par statut
  const actifs = prets.filter(p => ["debloque", "en_cours", "suspendu"].includes(p.statut));
  const enCours = prets.filter(p => ["brouillon", "en_attente_validation", "valide"].includes(p.statut));
  const historique = prets.filter(p => ["solde", "refuse", "annule"].includes(p.statut));

  const ResumeStat: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => (
    <div className="rounded-lg border bg-card px-4 py-3 text-center">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-base font-semibold ${color ?? ""}`}>{value}</p>
    </div>
  );

  const totalCapitalRestant = actifs.reduce((s, p) => s + (p.capital_restant ?? 0), 0);
  const totalMensualites = actifs.reduce((s, p) => s + (p.mt_echeance ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Mes Prêts</h1>
          <p className="text-sm text-muted-foreground">Prêts internes et cessions externes sur salaire</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowNouvelle(true)}>
          <Plus size={13} /> Nouvelle demande
        </Button>
      </div>

      {/* Résumé chiffres clés */}
      {actifs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <ResumeStat label="Prêts actifs" value={actifs.length} />
          <ResumeStat label="Capital restant total" value={formatMontant(totalCapitalRestant)} color="text-orange-600" />
          <ResumeStat label="Mensualités mensuelles" value={formatMontant(totalMensualites)} />
        </div>
      )}

      {/* Onglets */}
      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="mes-prets">
            Mes dossiers {prets.length > 0 && <span className="ml-1 text-[11px] text-muted-foreground">({prets.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="simuler">Simulateur</TabsTrigger>
        </TabsList>

        {/* ── MES PRÊTS ──────────────────────────────────── */}
        <TabsContent value="mes-prets" className="mt-4 space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Chargement…</p>
          ) : prets.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Banknote size={36} className="mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground mb-3">Vous n'avez aucun prêt en cours.</p>
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
              {enCours.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Demandes en attente</h2>
                  {enCours.map(p => <CartePret key={p.id} pret={p} onAnnuler={annuler} />)}
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

        {/* ── SIMULATEUR ──────────────────────────────────── */}
        <TabsContent value="simuler" className="mt-4">
          <div className="rounded-lg border bg-card p-5">
            <p className="text-sm font-medium mb-4">Simuler un prêt avant de faire une demande</p>
            <SimulateurPret
              showAdopter
              onAdopter={() => setShowNouvelle(true)}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Modale nouvelle demande */}
      <NouvelleDemandeDialog
        open={showNouvelle}
        onClose={() => setShowNouvelle(false)}
        onSuccess={charger}
      />
    </div>
  );
};

export default MesPretsPage;
