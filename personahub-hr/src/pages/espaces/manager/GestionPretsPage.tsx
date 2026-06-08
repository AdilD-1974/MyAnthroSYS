// GestionPretsPage.tsx — Espace RH : Gestion des Prêts (complet)
// src/pages/espaces/manager/GestionPretsPage.tsx
import React, { useEffect, useState, useCallback } from "react";
import {
  Banknote, Building2, CheckCircle, XCircle, Eye, PauseCircle, PlayCircle,
  Zap, Trash2, TrendingUp, DollarSign, AlertTriangle, Bell, Settings,
  ChevronDown, ChevronUp, Lock, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  pretsApi, Pret, PretDetail, PretStats, Alerte, PretConfig,
  PRET_STATUT_LABELS, PRET_STATUT_COLORS, ALGO_LABELS,
  MOTIF_SUSPENSION_LABELS, MODE_SUSPENSION_LABELS,
  formatMontant, formatDate, avancementPct, actionsDisponibles,
} from "@/lib/pretsApi";

// ──────────────────────────────────────────────────────────────
// COMPOSANTS UTILITAIRES
// ──────────────────────────────────────────────────────────────

const StatutBadge: React.FC<{ statut: Pret["statut"] }> = ({ statut }) => {
  const c = PRET_STATUT_COLORS[statut] ?? { bg: "bg-gray-100", text: "text-gray-600" };
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${c.bg} ${c.text}`}>
      {PRET_STATUT_LABELS[statut]}
    </span>
  );
};

const StatCard: React.FC<{
  label: string; value: string | number; icon: React.ReactNode;
  sub?: string; colorClass?: string;
}> = ({ label, value, icon, sub, colorClass = "text-foreground" }) => (
  <div className="rounded-lg border bg-card p-4 flex items-start gap-3">
    <div className={`w-9 h-9 rounded-lg bg-secondary/70 flex items-center justify-center flex-shrink-0 ${colorClass}`}>
      {icon}
    </div>
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────
// MODALE DÉTAIL / ACTIONS
// ──────────────────────────────────────────────────────────────

const ModalDetail: React.FC<{
  pretId: string | null;
  sl: number;
  onClose: () => void;
  onRefresh: () => void;
}> = ({ pretId, sl, onClose, onRefresh }) => {
  const [detail, setDetail] = useState<PretDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("infos");
  const [action, setAction] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Champs action
  const [montantDebloque, setMontantDebloque] = useState(0);
  const [dateDeblocage, setDateDeblocage] = useState("");
  const [noCheque, setNoCheque] = useState("");
  const [banqueEmettrice, setBanqueEmettrice] = useState("");
  const [refDecision, setRefDecision] = useState("");
  const [motifDecision, setMotifDecision] = useState("");
  const [competencDecideur, setCompetencDecideur] = useState("");
  const [motifSuspension, setMotifSuspension] = useState("conge_sans_solde");
  const [modeSuspension, setModeSuspension] = useState("gel_echeance");
  const [dateDebutSusp, setDateDebutSusp] = useState("");
  const [dateFinSusp, setDateFinSusp] = useState("");
  const [dateAmort, setDateAmort] = useState("");
  const [noEcheance, setNoEcheance] = useState(1);
  const [montantForce, setMontantForce] = useState(0);
  const [noteForce, setNoteForce] = useState("");

  useEffect(() => {
    if (!pretId) return;
    setLoading(true);
    setAction(null);
    setError(null);
    setTab("infos");
    pretsApi.detailPret(pretId).then((d) => {
      setDetail(d);
      setMontantDebloque(d.mt_pret);
    }).finally(() => setLoading(false));
  }, [pretId]);

  const executer = async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      switch (action) {
        case "approuver":
          await pretsApi.valider(detail.id, {
            decision: "approuve", ref_decision: refDecision,
            motif_decision: motifDecision, competenc_decideur: competencDecideur,
          });
          break;
        case "refuser":
          if (!motifDecision) { setError("Le motif de refus est obligatoire."); setSaving(false); return; }
          await pretsApi.valider(detail.id, { decision: "refuse", motif_decision: motifDecision });
          break;
        case "generer_amortissement":
          if (!dateAmort) { setError("La date de première échéance est obligatoire."); setSaving(false); return; }
          await pretsApi.genererAmortissement(detail.id, dateAmort);
          break;
        case "debloquer":
          await pretsApi.debloquer(detail.id, {
            montant_debloque: montantDebloque, date_deblocage: dateDeblocage,
            no_cheque: noCheque || undefined, banque_emettrice: banqueEmettrice || undefined,
          });
          break;
        case "suspendre":
          await pretsApi.suspendre(detail.id, {
            motif: motifSuspension, mode: modeSuspension as any,
            date_debut: dateDebutSusp, date_fin: dateFinSusp || undefined,
          });
          break;
        case "reprendre":
          await pretsApi.reprendre(detail.id);
          break;
        case "forcer_echeance":
          if (!noteForce) { setError("Une note justificative est obligatoire."); setSaving(false); return; }
          await pretsApi.forcerEcheance(detail.id, {
            numero_echeance: noEcheance, nouveau_montant: montantForce, note: noteForce,
          });
          break;
        case "supprimer":
          await pretsApi.supprimer(detail.id);
          onRefresh(); onClose(); return;
      }
      onRefresh();
      onClose();
    } catch (e: any) {
      setError(e?.detail ?? JSON.stringify(e));
    } finally {
      setSaving(false);
    }
  };

  const actions = detail ? actionsDisponibles(detail, sl) : [];
  const avancement = detail ? avancementPct(detail) : 0;

  if (!pretId) return null;

  return (
    <Dialog open={!!pretId} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {detail?.pret_interne ? <Banknote size={16} className="text-sky-500" /> : <Building2 size={16} className="text-amber-500" />}
            {detail?.ref_pret} — {detail?.collab_nom}
            {detail && <StatutBadge statut={detail.statut} />}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Chargement…</div>
        ) : detail ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="infos">Informations</TabsTrigger>
              <TabsTrigger value="echeancier">Tableau d'amortissement</TabsTrigger>
              {sl >= 70 && <TabsTrigger value="audit">Piste d'audit</TabsTrigger>}
              {actions.length > 0 && <TabsTrigger value="actions">Actions</TabsTrigger>}
            </TabsList>

            {/* ── INFOS ─────────────────────────────────────── */}
            <TabsContent value="infos" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-2">
                  <p><span className="text-muted-foreground text-xs">Type</span><br />
                    <strong>{detail.pret_interne ? "Prêt interne" : "Prêt externe (cession)"}</strong>
                  </p>
                  <p><span className="text-muted-foreground text-xs">Algorithme</span><br />{ALGO_LABELS[detail.algo_name]}</p>
                  <p><span className="text-muted-foreground text-xs">Montant demandé</span><br /><strong>{formatMontant(detail.mt_pret)}</strong></p>
                  <p><span className="text-muted-foreground text-xs">Taux</span><br />{detail.tx_interets}%/an</p>
                  <p><span className="text-muted-foreground text-xs">Nb échéances</span><br />{detail.nb_echeance} mois</p>
                  <p><span className="text-muted-foreground text-xs">Mensualité</span><br />{formatMontant(detail.mt_echeance)}</p>
                </div>
                <div className="space-y-2">
                  <p><span className="text-muted-foreground text-xs">Matricule</span><br />{detail.matricule}</p>
                  <p><span className="text-muted-foreground text-xs">Date demande</span><br />{formatDate(detail.dt_demande)}</p>
                  <p><span className="text-muted-foreground text-xs">Date déblocage</span><br />{formatDate(detail.dt_deblocage)}</p>
                  <p><span className="text-muted-foreground text-xs">Fin prévue</span><br />{formatDate(detail.fin_prevue)}</p>
                  {detail.tx_endettement_i != null && (
                    <p><span className="text-muted-foreground text-xs">Taux endettement global</span><br />
                      <span className={detail.tx_endettement_i > 33 ? "text-red-600 font-semibold" : ""}>{detail.tx_endettement_i}%</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Remboursement */}
              {detail.mt_debloque && (
                <div className="rounded-lg bg-secondary/40 p-3 space-y-2">
                  <p className="text-xs font-medium">Remboursement</p>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Remboursé : {formatMontant(detail.mt_rembourse)}</span>
                    <span>{avancement}%</span>
                    <span>Restant : {formatMontant(detail.capital_restant)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${avancement}%` }} />
                  </div>
                  {detail.mt_echeance_plus > 0 && (
                    <p className="text-xs text-orange-600">⚠ Reliquat reporté : {formatMontant(detail.mt_echeance_plus)}</p>
                  )}
                </div>
              )}

              {/* Organismes (externe) */}
              {!detail.pret_interne && (detail.organisme_credit || detail.no_compte) && (
                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <p className="text-xs font-medium mb-1">Établissement de crédit</p>
                  {detail.organisme_credit && <p>Organisme : <strong>{detail.organisme_credit}</strong></p>}
                  {detail.etab_credit && <p>Établissement : {detail.etab_credit}</p>}
                  {detail.no_compte && <p>Compte : {detail.code_bqe} — {detail.no_compte} — clé {detail.clerib}</p>}
                </div>
              )}

              {/* Suspension */}
              {detail.pret_suspendu && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
                  <p className="font-medium text-orange-700 mb-1">Prêt suspendu</p>
                  <p>Motif : {MOTIF_SUSPENSION_LABELS[detail.motif_suspension ?? ""] ?? detail.motif_suspension}</p>
                  <p>Mode : {MODE_SUSPENSION_LABELS[detail.mode_suspension ?? "gel_echeance"]}</p>
                  <p>Du {formatDate(detail.dt_debut_suspension)} au {formatDate(detail.dt_fin_suspension)}</p>
                </div>
              )}

              {/* Décision */}
              {detail.dt_decision && (
                <div className="rounded-lg bg-secondary/40 p-3 text-sm space-y-1">
                  <p className="text-xs font-medium">Décision</p>
                  <p>Date : {formatDate(detail.dt_decision)} — Réf : {detail.ref_decision}</p>
                  <p>Décideur : {detail.matric_decideur} ({detail.competenc_decideur})</p>
                  {detail.motif_decision && <p className="text-muted-foreground">{detail.motif_decision}</p>}
                </div>
              )}

              {/* Sécurité */}
              {detail.pret_debloque && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock size={11} /> Champs financiers verrouillés après déblocage
                </div>
              )}
            </TabsContent>

            {/* ── ÉCHEANCIER ───────────────────────────────── */}
            <TabsContent value="echeancier">
              {detail.echeancier.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Tableau d'amortissement non encore généré.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/60 sticky top-0">
                      <tr>
                        {["N°","Échéance","Capital dû","Capital","Intérêts","Total","Restant","Statut","Réf paie"].map(h => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.echeancier.map((e) => (
                        <tr key={e.numero} className={`border-t ${e.statut === "prelevee" ? "opacity-50" : ""} ${e.reliquat > 0 ? "bg-orange-50/50" : ""}`}>
                          <td className="px-2 py-1">{e.numero}</td>
                          <td className="px-2 py-1">{formatDate(e.date_echeance)}</td>
                          <td className="px-2 py-1 text-right">{formatMontant(e.capital_du)}</td>
                          <td className="px-2 py-1 text-right">{formatMontant(e.mt_capital)}</td>
                          <td className="px-2 py-1 text-right">{formatMontant(e.mt_interet)}</td>
                          <td className="px-2 py-1 text-right font-medium">{formatMontant(e.mt_total)}</td>
                          <td className="px-2 py-1 text-right">{formatMontant(e.capital_restant)}</td>
                          <td className="px-2 py-1">
                            <span className={`${e.statut === "prelevee" ? "text-green-600" : e.statut === "reportee" ? "text-orange-500" : e.statut === "forcee" ? "text-purple-600" : "text-blue-500"}`}>
                              {e.statut}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{e.reference_paie ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* ── AUDIT ────────────────────────────────────── */}
            {sl >= 70 && (
              <TabsContent value="audit">
                <div className="max-h-72 overflow-y-auto space-y-1.5">
                  {detail.audit.map((a) => (
                    <div key={a.id} className="rounded border px-3 py-2 text-xs">
                      <div className="flex justify-between text-muted-foreground mb-0.5">
                        <span className="font-medium text-foreground">{a.action}</span>
                        <span>{new Date(a.horodatage).toLocaleString("fr-FR")}</span>
                      </div>
                      <span>Opérateur : {a.operateur} (SL {a.security_level_operateur})</span>
                      {a.champ && <span className="ml-2 text-muted-foreground">{a.champ} : {a.ancienne_valeur} → {a.nouvelle_valeur}</span>}
                    </div>
                  ))}
                </div>
              </TabsContent>
            )}

            {/* ── ACTIONS ──────────────────────────────────── */}
            {actions.length > 0 && (
              <TabsContent value="actions" className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {actions.includes("approuver") && (
                    <Button size="sm" variant={action === "approuver" ? "default" : "outline"}
                      className="gap-1 text-green-700 border-green-300"
                      onClick={() => setAction("approuver")}>
                      <CheckCircle size={13} /> Approuver
                    </Button>
                  )}
                  {actions.includes("refuser") && (
                    <Button size="sm" variant={action === "refuser" ? "destructive" : "outline"}
                      className="gap-1" onClick={() => setAction("refuser")}>
                      <XCircle size={13} /> Refuser
                    </Button>
                  )}
                  {actions.includes("generer_amortissement") && (
                    <Button size="sm" variant={action === "generer_amortissement" ? "default" : "outline"}
                      className="gap-1" onClick={() => setAction("generer_amortissement")}>
                      Générer l'échéancier
                    </Button>
                  )}
                  {actions.includes("debloquer") && (
                    <Button size="sm" variant={action === "debloquer" ? "default" : "outline"}
                      className="gap-1 text-amber-700 border-amber-300" onClick={() => setAction("debloquer")}>
                      <DollarSign size={13} /> Débloquer les fonds
                    </Button>
                  )}
                  {actions.includes("suspendre") && (
                    <Button size="sm" variant={action === "suspendre" ? "default" : "outline"}
                      className="gap-1 text-orange-700 border-orange-300" onClick={() => setAction("suspendre")}>
                      <PauseCircle size={13} /> Suspendre
                    </Button>
                  )}
                  {actions.includes("reprendre") && (
                    <Button size="sm" variant={action === "reprendre" ? "default" : "outline"}
                      className="gap-1 text-teal-700 border-teal-300" onClick={() => setAction("reprendre")}>
                      <PlayCircle size={13} /> Reprendre
                    </Button>
                  )}
                  {actions.includes("forcer_echeance") && (
                    <Button size="sm" variant={action === "forcer_echeance" ? "default" : "outline"}
                      className="gap-1" onClick={() => setAction("forcer_echeance")}>
                      <Zap size={13} /> Forcer une échéance
                    </Button>
                  )}
                  {actions.includes("supprimer") && (
                    <Button size="sm" variant="outline" className="gap-1 text-destructive border-destructive/30"
                      onClick={() => setAction("supprimer")}>
                      <Trash2 size={13} /> Supprimer (logique)
                    </Button>
                  )}
                </div>

                {/* Formulaires contextuels */}
                {action && action !== "reprendre" && action !== "supprimer" && (
                  <div className="rounded-lg border bg-secondary/20 p-4 space-y-3">
                    {(action === "approuver") && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs mb-1 block">Référence décision</Label>
                            <Input value={refDecision} onChange={e => setRefDecision(e.target.value)} placeholder="DEC-2025-001" />
                          </div>
                          <div>
                            <Label className="text-xs mb-1 block">Qualité du décideur</Label>
                            <Input value={competencDecideur} onChange={e => setCompetencDecideur(e.target.value)} placeholder="Directeur RH" />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">Commentaire (optionnel)</Label>
                          <Textarea value={motifDecision} onChange={e => setMotifDecision(e.target.value)} rows={2} />
                        </div>
                      </>
                    )}
                    {action === "refuser" && (
                      <div>
                        <Label className="text-xs mb-1 block">Motif de refus <span className="text-destructive">*</span></Label>
                        <Textarea value={motifDecision} onChange={e => setMotifDecision(e.target.value)} rows={2} placeholder="Motif obligatoire" />
                      </div>
                    )}
                    {action === "generer_amortissement" && (
                      <div>
                        <Label className="text-xs mb-1 block">Date de 1ʳᵉ échéance <span className="text-destructive">*</span></Label>
                        <Input type="date" value={dateAmort} onChange={e => setDateAmort(e.target.value)} />
                      </div>
                    )}
                    {action === "debloquer" && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs mb-1 block">Montant débloqué (MAD) <span className="text-destructive">*</span></Label>
                            <Input type="number" value={montantDebloque} onChange={e => setMontantDebloque(Number(e.target.value))} />
                          </div>
                          <div>
                            <Label className="text-xs mb-1 block">Date de déblocage <span className="text-destructive">*</span></Label>
                            <Input type="date" value={dateDeblocage} onChange={e => setDateDeblocage(e.target.value)} />
                          </div>
                        </div>
                        {detail.pret_interne && (
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs mb-1 block">N° chèque</Label>
                              <Input value={noCheque} onChange={e => setNoCheque(e.target.value)} />
                            </div>
                            <div>
                              <Label className="text-xs mb-1 block">Banque émettrice</Label>
                              <Input value={banqueEmettrice} onChange={e => setBanqueEmettrice(e.target.value)} />
                            </div>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Lock size={11} /> Les champs financiers seront verrouillés après cette action.
                        </p>
                      </div>
                    )}
                    {action === "suspendre" && (
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs mb-1 block">Motif de suspension</Label>
                          <Select value={motifSuspension} onValueChange={setMotifSuspension}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(MOTIF_SUSPENSION_LABELS).map(([k,v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">Mode de suspension</Label>
                          <Select value={modeSuspension} onValueChange={setModeSuspension}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(MODE_SUSPENSION_LABELS).map(([k,v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground mt-1">
                            {modeSuspension === "gel_echeance"
                              ? "Les échéances seront décalées et la date de fin repoussée."
                              : "Le collaborateur remboursera manuellement (chèque/virement). Aucun prélèvement sur paie."}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs mb-1 block">Début <span className="text-destructive">*</span></Label>
                            <Input type="date" value={dateDebutSusp} onChange={e => setDateDebutSusp(e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-xs mb-1 block">Fin prévue</Label>
                            <Input type="date" value={dateFinSusp} onChange={e => setDateFinSusp(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    )}
                    {action === "forcer_echeance" && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs mb-1 block">N° d'échéance</Label>
                            <Input type="number" value={noEcheance} min={1} onChange={e => setNoEcheance(Number(e.target.value))} />
                          </div>
                          <div>
                            <Label className="text-xs mb-1 block">Nouveau montant (MAD)</Label>
                            <Input type="number" value={montantForce} onChange={e => setMontantForce(Number(e.target.value))} />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">Note justificative <span className="text-destructive">*</span></Label>
                          <Textarea value={noteForce} onChange={e => setNoteForce(e.target.value)} rows={2}
                            placeholder="Motif du forçage (requis, générera une alerte si > 20% de la mensualité théorique)" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {action === "supprimer" && (
                  <div className="rounded-lg border border-destructive/30 bg-red-50/50 p-3 text-sm">
                    <p className="font-medium text-destructive mb-1">Suppression logique</p>
                    <p className="text-muted-foreground">Le dossier sera masqué des écrans opérationnels mais conservé en base (traçabilité audit). Cette action est irréversible si le prêt a été débloqué.</p>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}
              </TabsContent>
            )}
          </Tabs>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          {action && (
            <Button
              variant={action === "refuser" || action === "supprimer" ? "destructive" : "default"}
              onClick={executer}
              disabled={saving}
            >
              {saving ? "Traitement…" : "Confirmer"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ──────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ──────────────────────────────────────────────────────────────

const GestionPretsPage: React.FC = () => {
  const { profile, activeRole } = useAuth();
  const sl: number = (profile as any)?.security_level ?? 0;

  const [prets, setPrets] = useState<Pret[]>([]);
  const [stats, setStats] = useState<PretStats | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [configs, setConfigs] = useState<PretConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("prets");
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreType, setFiltreType] = useState("");

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, a] = await Promise.all([
        pretsApi.listePrets({ statut: filtreStatut || undefined, pret_interne: filtreType === "interne" ? true : filtreType === "externe" ? false : undefined }),
        pretsApi.stats(),
        sl >= 50 ? pretsApi.alertes() : Promise.resolve([]),
      ]);
      setPrets(p);
      setStats(s);
      setAlertes(a);
      if (sl >= 90) {
        const cfg = await pretsApi.getConfig();
        setConfigs(cfg);
      }
    } finally {
      setLoading(false);
    }
  }, [filtreStatut, filtreType, sl]);

  useEffect(() => { charger(); }, [charger]);

  const enveloppeUsage = stats
    ? Math.round((stats.enveloppe_interne_utilisee / (stats.plafond_interne_annuel || 1)) * 100)
    : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Gestion des Prêts</h1>
          <p className="text-sm text-muted-foreground">Prêts internes & cessions externes — SL {sl}</p>
        </div>
        {alertes.filter(a => !a.lue).length > 0 && (
          <button onClick={() => setTab("alertes")} className="flex items-center gap-1.5 text-sm text-orange-600 hover:underline">
            <Bell size={14} />
            {alertes.filter(a => !a.lue).length} alertes non lues
          </button>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard label="En attente" value={stats.en_attente} icon={<TrendingUp size={15} />} colorClass="text-blue-500" />
          <StatCard label="Actifs" value={stats.actifs} icon={<CheckCircle size={15} />} colorClass="text-green-500" />
          <StatCard label="Suspendus" value={stats.suspendus} icon={<PauseCircle size={15} />} colorClass="text-orange-500" />
          <StatCard label="Encours total" value={formatMontant(stats.encours_total)} icon={<DollarSign size={15} />} colorClass="text-amber-500" />
          <StatCard label="Capital restant" value={formatMontant(stats.capital_restant)} icon={<AlertTriangle size={15} />} colorClass="text-red-400" />
          <StatCard
            label="Enveloppe interne"
            value={formatMontant(stats.enveloppe_disponible)}
            icon={<Shield size={15} />}
            colorClass={enveloppeUsage > 80 ? "text-red-500" : "text-teal-500"}
            sub={`${enveloppeUsage}% utilisé`}
          />
        </div>
      )}

      {/* Enveloppe budget */}
      {stats && stats.plafond_interne_annuel > 0 && (
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Enveloppe budgétaire prêts internes {new Date().getFullYear()}</span>
            <span>{formatMontant(stats.enveloppe_interne_utilisee)} / {formatMontant(stats.plafond_interne_annuel)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${enveloppeUsage > 80 ? "bg-red-500" : "bg-sky-500"}`}
              style={{ width: `${Math.min(100, enveloppeUsage)}%` }}
            />
          </div>
        </div>
      )}

      {/* Onglets */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="prets">Dossiers</TabsTrigger>
          {sl >= 50 && <TabsTrigger value="alertes" className="relative">
            Alertes
            {alertes.filter(a => !a.lue).length > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-white">
                {alertes.filter(a => !a.lue).length}
              </span>
            )}
          </TabsTrigger>}
          {sl >= 90 && <TabsTrigger value="config"><Settings size={12} className="mr-1" />Config</TabsTrigger>}
        </TabsList>

        {/* ── DOSSIERS ─────────────────────────────────────── */}
        <TabsContent value="prets" className="space-y-3 mt-4">
          <div className="flex flex-wrap gap-2">
            <Select value={filtreStatut || "tous"} onValueChange={v => setFiltreStatut(v === "tous" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs w-52"><SelectValue placeholder="Tous statuts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous les statuts</SelectItem>
                {Object.entries(PRET_STATUT_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtreType || "tous"} onValueChange={v => setFiltreType(v === "tous" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Tous types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Interne + Externe</SelectItem>
                <SelectItem value="interne">Prêts internes</SelectItem>
                <SelectItem value="externe">Prêts externes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs">
                <tr className="border-b">
                  {["Référence","Collaborateur","Type","Algo","Montant","Mensualité","Statut","Taux end.",""].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center py-10 text-muted-foreground text-sm">Chargement…</td></tr>
                ) : prets.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-10 text-muted-foreground text-sm">Aucun dossier.</td></tr>
                ) : prets.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-secondary/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.ref_pret}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-xs">{p.collab_nom ?? p.matricule}</p>
                      <p className="text-[11px] text-muted-foreground">{p.matricule}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1 text-xs">
                        {p.pret_interne ? <Banknote size={12} className="text-sky-500" /> : <Building2 size={12} className="text-amber-500" />}
                        {p.pret_interne ? "Interne" : "Externe"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{ALGO_LABELS[p.algo_name]?.split(" ")[0]}</td>
                    <td className="px-3 py-2 text-xs font-medium text-right">{formatMontant(p.mt_pret)}</td>
                    <td className="px-3 py-2 text-xs text-right">{formatMontant(p.mt_echeance)}</td>
                    <td className="px-3 py-2"><StatutBadge statut={p.statut} /></td>
                    <td className="px-3 py-2 text-xs text-center">
                      {p.tx_endettement_i != null
                        ? <span className={p.tx_endettement_i > 33 ? "text-red-600 font-semibold" : ""}>{p.tx_endettement_i}%</span>
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSelectedId(p.id)}>
                        <Eye size={13} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── ALERTES ──────────────────────────────────────── */}
        {sl >= 50 && (
          <TabsContent value="alertes" className="mt-4 space-y-2">
            {alertes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Aucune alerte non lue.</p>
            ) : alertes.map((a) => (
              <div key={a.id} className={`rounded-lg border p-3 text-sm ${a.lue ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-xs">{a.type_alerte} — <span className="text-muted-foreground">{a.ref_pret} ({a.matricule})</span></p>
                    <p className="text-muted-foreground mt-0.5">{a.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{formatDate(a.cree_le)}</p>
                  </div>
                  {!a.lue && (
                    <Button variant="ghost" size="sm" className="text-xs h-7"
                      onClick={async () => { await pretsApi.marquerAlerteLue(a.id); charger(); }}>
                      Marquer lue
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </TabsContent>
        )}

        {/* ── CONFIG (SL 90+) ──────────────────────────────── */}
        {sl >= 90 && (
          <TabsContent value="config" className="mt-4">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-xs">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Paramètre</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Valeur</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Modifié par</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((c) => (
                    <tr key={c.code} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.libelle}</td>
                      <td className="px-3 py-2 text-right font-semibold">{c.valeur}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.modifie_par ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Modification des paramètres via les endpoints <code>PUT /api/v1/prets/config/&#123;code&#125;</code> (SL 90+ requis).</p>
          </TabsContent>
        )}
      </Tabs>

      <ModalDetail pretId={selectedId} sl={sl} onClose={() => setSelectedId(null)} onRefresh={charger} />
    </div>
  );
};

export default GestionPretsPage;
