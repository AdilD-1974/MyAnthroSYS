// GestionPretsPage.tsx — Espace RH : Gestion des Prêts (complet)
// src/pages/espaces/manager/GestionPretsPage.tsx
import React, { useEffect, useState, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { Link } from "react-router-dom";
import {
  Banknote, Building2, CheckCircle, XCircle, Eye, PauseCircle, PlayCircle,
  Zap, Trash2, TrendingUp, DollarSign, AlertTriangle, Bell, Settings, Plus,
  ChevronDown, ChevronUp, Lock, Shield,
} from "lucide-react";
import CreationDirectePretDialog from "@/components/prets/CreationDirectePretDialog";
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
import { db } from "@/lib/api";
import {
  pretsApi, Pret, PretDetail, PretStats, Alerte, PretConfig, RemboursementAnticipe, SuspensionHistorique, DocumentPret,
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
  const [remboursementsAnticipes, setRemboursementsAnticipes] = useState<RemboursementAnticipe[]>([]);
  const [suspensions, setSuspensions] = useState<SuspensionHistorique[]>([]);
  const [banques, setBanques] = useState<{ code: string; libelle: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("infos");
  const [action, setAction] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Champs action
  const [montantDebloque, setMontantDebloque] = useState(0);
  const [dateDeblocage, setDateDeblocage] = useState(() => new Date().toISOString().slice(0, 10));
  const [noCheque, setNoCheque] = useState("");
  const [banqueEmettrice, setBanqueEmettrice] = useState("");
  const [recuCheque, setRecuCheque] = useState<File | null>(null);
  const [documents, setDocuments] = useState<DocumentPret[]>([]);
  const [uploadEnCours, setUploadEnCours] = useState(false);
  const [editionBanque, setEditionBanque] = useState(false);
  const [savingBanque, setSavingBanque] = useState(false);
  const [editionExterne, setEditionExterne] = useState(false);
  const [savingExterne, setSavingExterne] = useState(false);
  const [echeancesSelectionnees, setEcheancesSelectionnees] = useState<Set<number>>(new Set());
  const [savingSuppressionEcheances, setSavingSuppressionEcheances] = useState(false);
  const [externeForm, setExterneForm] = useState({
    mt_pret: "", nb_echeance: "", tx_interets: "", taux_tva: "", dt_debut_pret: "", dt_debut_remb: "", ref_pret: "", motif: "",
    deja_debloque: false, montant_debloque: "", date_deblocage: "", capital_restant_saisie: "",
  });
  const [banqueForm, setBanqueForm] = useState({
    organisme_credit: "", etab_credit: "", code_bqe: "", code_guichet: "",
    no_compte: "", clerib: "", intitule_compte: "", hypotheque: false, reconnaissance_dette: false,
  });
  const [fichierNouveauDoc, setFichierNouveauDoc] = useState<File | null>(null);
  const [libelleNouveauDoc, setLibelleNouveauDoc] = useState("");
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
  const [modeCascadeForcage, setModeCascadeForcage] = useState<"reduire_mensualite" | "reduire_duree">("reduire_mensualite");
  const [noteForce, setNoteForce] = useState("");
  const [nouveauCapitalRestant, setNouveauCapitalRestant] = useState("");
  const [nouveauNbEcheances, setNouveauNbEcheances] = useState("");
  const [dateRepriseRecalcul, setDateRepriseRecalcul] = useState("");
  const [motifRecalcul, setMotifRecalcul] = useState("");
  const [ajoutEcheancierOuvert, setAjoutEcheancierOuvert] = useState(false);
  const [nouvelleLigneDate, setNouvelleLigneDate] = useState("");
  const [nouvelleLigneCapital, setNouvelleLigneCapital] = useState("");
  const [nouvelleLigneInteret, setNouvelleLigneInteret] = useState("");
  const [lignesEnAttente, setLignesEnAttente] = useState<{ date_echeance: string; mt_capital: number; mt_interet: number }[]>([]);
  const [savingEcheancier, setSavingEcheancier] = useState(false);

  useEffect(() => {
    db.list<{ code: string; libelle: string }>("ref_banque", { actif: true, order: "libelle", select: "code,libelle" })
      .then(setBanques)
      .catch(() => setBanques([]));
  }, []);

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
    pretsApi.remboursementsAnticipes(pretId).then(setRemboursementsAnticipes).catch(() => setRemboursementsAnticipes([]));
    pretsApi.historiqueSuspensions(pretId).then(setSuspensions).catch(() => setSuspensions([]));
    chargerDocuments(pretId);
  }, [pretId]);

  const chargerDocuments = (id: string) => {
    pretsApi.listerDocuments(id).then(setDocuments).catch(() => setDocuments([]));
  };

  const ajouterDocument = async () => {
    if (!detail || !fichierNouveauDoc || !libelleNouveauDoc.trim()) return;
    setUploadEnCours(true);
    try {
      await pretsApi.uploaderDocument(detail.id, fichierNouveauDoc, libelleNouveauDoc.trim());
      setFichierNouveauDoc(null); setLibelleNouveauDoc("");
      chargerDocuments(detail.id);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'ajout du document.");
    } finally {
      setUploadEnCours(false);
    }
  };

  const supprimerDocument = async (documentId: string) => {
    if (!detail) return;
    if (!confirm("Supprimer ce document ?")) return;
    await pretsApi.supprimerDocument(documentId);
    chargerDocuments(detail.id);
  };

  const ajouterLigneEnAttente = () => {
    if (!nouvelleLigneDate || !nouvelleLigneCapital) return;
    setLignesEnAttente(prev => [...prev, {
      date_echeance: nouvelleLigneDate,
      mt_capital: Number(nouvelleLigneCapital),
      mt_interet: Number(nouvelleLigneInteret) || 0,
    }]);
    setNouvelleLigneDate(""); setNouvelleLigneCapital(""); setNouvelleLigneInteret("");
  };

  // Nombre au format français ("3322,06" ou "3.322,06") -> nombre JS.
  // La virgule est le séparateur DÉCIMAL ici, jamais un séparateur de colonnes
  // (bug corrigé : on découpait auparavant aussi sur la virgule, ce qui
  // décalait toutes les colonnes dès qu'un montant avait des décimales).
  const parseNombreFr = (s: string): number => {
    const nettoye = s.trim().replace(/\s/g, "");
    if (nettoye.includes(",") && nettoye.includes(".")) return Number(nettoye.replace(/\./g, "").replace(",", "."));
    if (nettoye.includes(",")) return Number(nettoye.replace(",", "."));
    return Number(nettoye);
  };

  // Normalise une date "jj/mm/aaaa" ou "jj-mm-aaaa" (format le plus courant
  // dans un CSV/Excel français) vers l'ISO "aaaa-mm-jj" attendu par le
  // backend et par les champs <input type="date"> de la saisie manuelle.
  const versDateISO = (s: string): string => {
    const v = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return v;
  };

  const traiterLignesColonnes = (lignesColonnes: string[][]) =>
    lignesColonnes
      .filter(cols => cols.length >= 3 && cols[0] && !Number.isNaN(parseNombreFr(String(cols[1]))))
      .map(cols => ({
        date_echeance: versDateISO(String(cols[0])),
        mt_capital: parseNombreFr(String(cols[1])),
        mt_interet: parseNombreFr(String(cols[2])) || 0,
      }));

  const importerFichierCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    const nomFichier = fichier.name.toLowerCase();

    if (nomFichier.endsWith(".xlsx") || nomFichier.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = () => {
        const classeur = XLSX.read(reader.result, { type: "array" });
        const feuille = classeur.Sheets[classeur.SheetNames[0]];
        const lignesColonnes: string[][] = XLSX.utils.sheet_to_json(feuille, { header: 1, raw: false, blankrows: false });
        setLignesEnAttente(prev => [...prev, ...traiterLignesColonnes(lignesColonnes)]);
      };
      reader.readAsArrayBuffer(fichier);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const texte = String(reader.result ?? "");
        const lignes = texte.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const lignesColonnes = lignes.map(l => l.split(";").map(s => s.trim()));
        setLignesEnAttente(prev => [...prev, ...traiterLignesColonnes(lignesColonnes)]);
      };
      reader.readAsText(fichier);
    }
    e.target.value = "";
  };

  const enregistrerLignesEcheancier = async () => {
    if (!detail || lignesEnAttente.length === 0) return;
    setSavingEcheancier(true);
    setError(null);
    try {
      await pretsApi.importerEcheancier(detail.id, [...lignesEnAttente].sort((a, b) => a.date_echeance.localeCompare(b.date_echeance)));
      setLignesEnAttente([]);
      setAjoutEcheancierOuvert(false);
      const maj = await pretsApi.detailPret(detail.id);
      setDetail(maj);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement de l'échéancier.");
    } finally {
      setSavingEcheancier(false);
    }
  };

  const enregistrerBanque = async () => {
    if (!detail) return;
    setSavingBanque(true);
    setError(null);
    try {
      const maj = await pretsApi.modifierBanque(detail.id, banqueForm);
      setDetail({ ...detail, ...maj });
      setEditionBanque(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement des coordonnées bancaires.");
    } finally {
      setSavingBanque(false);
    }
  };

  const enregistrerExterne = async () => {
    if (!detail) return;
    setSavingExterne(true);
    setError(null);
    try {
      const maj = await pretsApi.modifierPretExterne(detail.id, {
        mt_pret: externeForm.mt_pret ? Number(externeForm.mt_pret) : undefined,
        nb_echeance: externeForm.nb_echeance ? Number(externeForm.nb_echeance) : undefined,
        tx_interets: externeForm.tx_interets ? Number(externeForm.tx_interets) : undefined,
        taux_tva: externeForm.taux_tva ? Number(externeForm.taux_tva) : undefined,
        dt_debut_pret: externeForm.dt_debut_pret || undefined,
        dt_debut_remb: externeForm.dt_debut_remb || undefined,
        ref_pret: externeForm.ref_pret || undefined,
        motif: externeForm.motif || undefined,
        deja_debloque: externeForm.deja_debloque,
        montant_debloque: externeForm.montant_debloque ? Number(externeForm.montant_debloque) : undefined,
        date_deblocage: externeForm.date_deblocage || undefined,
        capital_restant_saisie: externeForm.capital_restant_saisie ? Number(externeForm.capital_restant_saisie) : undefined,
      });
      setDetail({ ...detail, ...maj });
      setEditionExterne(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement des éléments du prêt.");
    } finally {
      setSavingExterne(false);
    }
  };

  const supprimerEcheancesSelectionnees = async () => {
    if (!detail || echeancesSelectionnees.size === 0) return;
    if (!confirm(`Supprimer ${echeancesSelectionnees.size} échéance(s) sélectionnée(s) ? Cette action est irréversible.`)) return;
    setSavingSuppressionEcheances(true);
    setError(null);
    try {
      await pretsApi.supprimerEcheances(detail.id, Array.from(echeancesSelectionnees));
      setEcheancesSelectionnees(new Set());
      const maj = await pretsApi.detailPret(detail.id);
      setDetail(maj);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de la suppression des échéances.");
    } finally {
      setSavingSuppressionEcheances(false);
    }
  };

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
          if (!montantDebloque || montantDebloque <= 0) { setError("Le montant débloqué doit être supérieur à 0."); setSaving(false); return; }
          if (!dateDeblocage) { setError("La date de déblocage est obligatoire."); setSaving(false); return; }
          await pretsApi.debloquer(detail.id, {
            montant_debloque: montantDebloque, date_deblocage: dateDeblocage,
            no_cheque: noCheque || undefined, banque_emettrice: banqueEmettrice || undefined,
          });
          if (recuCheque) {
            try {
              await pretsApi.uploaderDocument(detail.id, recuCheque, `Reçu chèque n°${noCheque || "—"}`);
            } catch {
              // Le déblocage a réussi ; on ne bloque pas dessus si l'upload du reçu échoue.
            }
          }
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
            mode_cascade: modeCascadeForcage,
          });
          break;
        case "recalculer_echeancier": {
          if (!nouveauCapitalRestant || Number(nouveauCapitalRestant) <= 0) { setError("Le nouveau capital restant doit être supérieur à 0."); setSaving(false); return; }
          if (!nouveauNbEcheances || Number(nouveauNbEcheances) <= 0) { setError("Le nombre d'échéances restantes doit être supérieur à 0."); setSaving(false); return; }
          if (!dateRepriseRecalcul) { setError("La date de reprise est obligatoire."); setSaving(false); return; }
          if (!motifRecalcul.trim()) { setError("Le motif est obligatoire."); setSaving(false); return; }
          await pretsApi.recalculerEcheancier(detail.id, {
            nouveau_capital_restant: Number(nouveauCapitalRestant), nouveau_nb_echeances: Number(nouveauNbEcheances),
            date_reprise: dateRepriseRecalcul, motif: motifRecalcul.trim(),
          });
          break;
        }
        case "supprimer":
          await pretsApi.supprimer(detail.id);
          onRefresh(); onClose(); return;
      }
      onRefresh();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'exécution de l'action.");
    } finally {
      setSaving(false);
    }
  };

  const actions = detail ? actionsDisponibles(detail, sl) : [];
  const avancement = detail ? avancementPct(detail) : 0;

  if (!pretId) return null;

  return (
    <Dialog open={!!pretId} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-[90vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {detail?.pret_interne ? <Banknote size={16} style={{ color: "hsl(var(--primary))" }} /> : <Building2 size={16} style={{ color: "hsl(var(--info))" }} />}
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
              <TabsTrigger value="suspension">Suspension{detail?.pret_suspendu ? " ⏸" : ""}</TabsTrigger>
              {sl >= 70 && <TabsTrigger value="audit">Piste d'audit</TabsTrigger>}
              {actions.length > 0 && <TabsTrigger value="actions">Actions</TabsTrigger>}
            </TabsList>

            {/* ── INFOS ─────────────────────────────────────── */}
            <TabsContent value="infos" className="space-y-4">
              {/* Identification */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Identification</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <p><span className="text-muted-foreground text-xs">N° de dossier</span><br /><strong>{detail.ref_pret ?? "—"}</strong></p>
                  <p><span className="text-muted-foreground text-xs">Matricule</span><br />{detail.matricule}</p>
                  <p><span className="text-muted-foreground text-xs">Type</span><br />
                    <strong>{detail.type_libelle ?? detail.type_code}</strong> ({detail.pret_interne ? "Interne" : "Externe"})
                  </p>
                </div>
                {detail.objet && <p className="text-sm mt-2"><span className="text-muted-foreground text-xs">Objet</span><br />{detail.objet}</p>}
                {detail.motif && <p className="text-sm mt-2"><span className="text-muted-foreground text-xs">Motif / précisions</span><br />{detail.motif}</p>}
              </div>

              {/* Conditions financières */}
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conditions financières</p>
                  {!detail.pret_interne && !editionExterne && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => {
                      setExterneForm({
                        mt_pret: String(detail.mt_pret ?? ""), nb_echeance: String(detail.nb_echeance ?? ""),
                        tx_interets: String(detail.tx_interets ?? ""), taux_tva: String(detail.taux_tva ?? ""),
                        dt_debut_pret: detail.dt_debut_pret ?? "", dt_debut_remb: detail.dt_debut_remb ?? "",
                        ref_pret: detail.ref_pret ?? "", motif: detail.motif ?? "",
                        deja_debloque: detail.pret_debloque, montant_debloque: String(detail.mt_debloque ?? ""),
                        date_deblocage: detail.dt_deblocage ?? "", capital_restant_saisie: "",
                      });
                      setEditionExterne(true);
                    }}>
                      Modifier
                    </Button>
                  )}
                </div>

                {editionExterne ? (
                  <div className="space-y-3">
                    <p className="text-[11px] text-muted-foreground">
                      Prêt externe : ces éléments sont modifiables à tout moment, y compris après déblocage —
                      aucun moteur d'amortissement interne n'en dépend (l'échéancier est saisi/importé séparément).
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Montant (DH)</Label>
                        <Input type="number" value={externeForm.mt_pret} onChange={e => setExterneForm({ ...externeForm, mt_pret: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Nb échéances</Label>
                        <Input type="number" value={externeForm.nb_echeance} onChange={e => setExterneForm({ ...externeForm, nb_echeance: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Taux annuel %</Label>
                        <Input type="number" step="0.01" value={externeForm.tx_interets} onChange={e => setExterneForm({ ...externeForm, tx_interets: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Taux TVA %</Label>
                        <Input type="number" step="0.01" value={externeForm.taux_tva} onChange={e => setExterneForm({ ...externeForm, taux_tva: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Date de début du prêt (contraction)</Label>
                        <Input type="date" value={externeForm.dt_debut_pret} onChange={e => setExterneForm({ ...externeForm, dt_debut_pret: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Début remboursement</Label>
                        <Input type="date" value={externeForm.dt_debut_remb} onChange={e => setExterneForm({ ...externeForm, dt_debut_remb: e.target.value })} />
                      </div>
                      <div className="col-span-3">
                        <Label className="text-xs mb-1 block">Fin prévue (calculée automatiquement)</Label>
                        <p className="text-sm px-3 py-2 rounded-md bg-secondary/40 text-muted-foreground">
                          {externeForm.dt_debut_pret && externeForm.nb_echeance ? (() => {
                            const d = new Date(externeForm.dt_debut_pret);
                            d.setMonth(d.getMonth() + Number(externeForm.nb_echeance));
                            return d.toLocaleDateString("fr-FR");
                          })() : "— renseignez la date de début et le nombre d'échéances —"}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs mb-1 block">Réf. prêt (établissement de crédit)</Label>
                        <Input value={externeForm.ref_pret} onChange={e => setExterneForm({ ...externeForm, ref_pret: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Motif / précisions</Label>
                      <Textarea rows={2} value={externeForm.motif} onChange={e => setExterneForm({ ...externeForm, motif: e.target.value })} />
                    </div>

                    <div className="rounded-md border border-border p-3 space-y-3">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        Situation de début — image du prêt lors de sa contraction/saisie
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={externeForm.deja_debloque}
                          onChange={e => setExterneForm({ ...externeForm, deja_debloque: e.target.checked })} />
                        Déjà débloqué au moment de la saisie
                      </label>
                      {externeForm.deja_debloque && (
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs mb-1 block">Montant débloqué (DH)</Label>
                            <Input type="number" value={externeForm.montant_debloque} onChange={e => setExterneForm({ ...externeForm, montant_debloque: e.target.value })} />
                          </div>
                          <div>
                            <Label className="text-xs mb-1 block">Date de déblocage</Label>
                            <Input type="date" value={externeForm.date_deblocage} onChange={e => setExterneForm({ ...externeForm, date_deblocage: e.target.value })} />
                          </div>
                          <div>
                            <Label className="text-xs mb-1 block">Capital restant à la saisie (DH)</Label>
                            <Input type="number" value={externeForm.capital_restant_saisie} onChange={e => setExterneForm({ ...externeForm, capital_restant_saisie: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </div>

                    {error && <p className="text-xs text-destructive">{error}</p>}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditionExterne(false); setError(null); }}>Annuler</Button>
                      <Button size="sm" disabled={savingExterne} onClick={enregistrerExterne}>
                        {savingExterne ? "Enregistrement…" : "Enregistrer"}

                      </Button>
                    </div>
                  </div>
                ) : (
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <p><span className="text-muted-foreground text-xs">Montant demandé</span><br /><strong>{formatMontant(detail.mt_pret)}</strong></p>
                  <p><span className="text-muted-foreground text-xs">Taux annuel</span><br />{detail.tx_interets}%</p>
                  {detail.taux_tva > 0 && (
                    <p><span className="text-muted-foreground text-xs">Taux de TVA</span><br />{detail.taux_tva}%</p>
                  )}
                  <p><span className="text-muted-foreground text-xs">Algorithme</span><br />{ALGO_LABELS[detail.algo_name]}</p>
                  <p><span className="text-muted-foreground text-xs">Nb échéances</span><br />{detail.nb_echeance} mois</p>
                  <p><span className="text-muted-foreground text-xs">Mensualité</span><br />{formatMontant(detail.mt_echeance)}</p>
                  <p><span className="text-muted-foreground text-xs">Prélever en plus</span><br />{formatMontant(detail.mt_echeance_plus)}</p>
                  <p><span className="text-muted-foreground text-xs">Date demande</span><br />{formatDate(detail.dt_demande)}</p>
                  <p><span className="text-muted-foreground text-xs">Début remboursement</span><br />{formatDate(detail.dt_debut_remb)}</p>
                  {detail.dt_debut_pret && (
                    <p><span className="text-muted-foreground text-xs">Date de début du prêt</span><br />{formatDate(detail.dt_debut_pret)}</p>
                  )}
                  <p><span className="text-muted-foreground text-xs">Date déblocage</span><br />{formatDate(detail.dt_deblocage)}</p>
                  <p><span className="text-muted-foreground text-xs">Fin prévue</span><br />{formatDate(detail.fin_prevue)}</p>
                  {detail.priorite_prelevement != null && (
                    <p><span className="text-muted-foreground text-xs">Priorité de prélèvement</span><br />{detail.priorite_prelevement}</p>
                  )}
                  {detail.avantage_nature_mensuel > 0 && (
                    <p><span className="text-muted-foreground text-xs">Avantage en nature/mois</span><br />{formatMontant(detail.avantage_nature_mensuel)}</p>
                  )}
                </div>
                )}
                {detail.echeancier.length > detail.nb_echeance && (
                  <p className="text-xs mt-2" style={{ color: "hsl(var(--warning))" }}>
                    ⚠ Durée effective rallongée de {detail.echeancier.length - detail.nb_echeance} mois par rapport à la durée initiale
                    (probablement suite à suspension(s) ou reliquat(s) reportés).
                  </p>
                )}
                {(() => {
                  const reliquatTotal = detail.echeancier.reduce((s, e) => s + (e.reliquat || 0), 0);
                  return reliquatTotal > 0 ? (
                    <p className="text-xs mt-1" style={{ color: "hsl(var(--warning))" }}>
                      ⚠ Montant reporté (reliquats cumulés non prélevés) : {formatMontant(reliquatTotal)}
                    </p>
                  ) : null;
                })()}
              </div>

              {/* Remboursement anticipé */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Remboursement anticipé</p>
                {remboursementsAnticipes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun remboursement anticipé enregistré sur ce dossier.</p>
                ) : (
                  <div className="space-y-2">
                    {remboursementsAnticipes.map(r => (
                      <div key={r.id} className="flex items-center justify-between text-xs border-b border-border pb-1.5 last:border-0 last:pb-0">
                        <div>
                          <span className="font-medium">{r.type_remboursement === "TOTAL" ? "Total" : "Partiel"}</span>
                          {" — "}{formatDate(r.date_remboursement)} — {formatMontant(r.montant)} ({r.mode_paiement.toLowerCase()})
                          <span className="text-muted-foreground"> · impact : {r.impact_amortissement === "REDUCTION_DUREE" ? "réduction de durée" : "réduction de mensualité"}</span>
                        </div>
                        <span className="text-muted-foreground">Restant après : {formatMontant(r.capital_restant_apres)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Endettement */}
              {(detail.tx_endettement_avant != null || detail.tx_endettement_apres != null || detail.tx_endettement_i != null) && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Endettement</p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {detail.tx_endettement_avant != null && <p><span className="text-muted-foreground text-xs">Avant ce prêt</span><br />{detail.tx_endettement_avant}%</p>}
                    {detail.tx_endettement_apres != null && <p><span className="text-muted-foreground text-xs">Après ce prêt</span><br />{detail.tx_endettement_apres}%</p>}
                    {detail.tx_endettement_i != null && (
                      <p><span className="text-muted-foreground text-xs">Global (tous prêts)</span><br />
                        <span className={detail.tx_endettement_i > 33 ? "text-[hsl(var(--destructive))] font-semibold" : "font-semibold"}>{detail.tx_endettement_i}%</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Imputation en paie */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Imputation en paie</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <p><span className="text-muted-foreground text-xs">Rubrique</span><br />{detail.rubrique_lib ?? detail.rubrique_paie_code ?? "—"}</p>
                  <p><span className="text-muted-foreground text-xs">Prochaine échéance paie</span><br />{formatDate(detail.dt_proch_echeance)}</p>
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
                    <div className="h-full rounded-full bg-[hsl(var(--success))] transition-all" style={{ width: `${avancement}%` }} />
                  </div>
                  {detail.echeance_restant != null && (
                    <p className="text-xs text-muted-foreground">Échéances restantes : {detail.echeance_restant}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground italic">
                    Capital restant et échéances restantes sont mis à jour à chaque clôture de paie ayant traité une échéance.
                  </p>
                  {detail.no_cheque && <p className="text-xs text-muted-foreground">Chèque n° {detail.no_cheque} — {detail.banque_emettrice}</p>}
                </div>
              )}

              {/* Banque — toujours visible, éditable (RIB pour virement de la retenue à la source) */}
              <div className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Banque (virement de la retenue à la source)</p>
                  {!editionBanque && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => {
                      setBanqueForm({
                        organisme_credit: detail.organisme_credit ?? "", etab_credit: detail.etab_credit ?? "",
                        code_bqe: detail.code_bqe ?? "", code_guichet: detail.code_guichet ?? "",
                        no_compte: detail.no_compte ?? "", clerib: detail.clerib ?? "",
                        intitule_compte: detail.intitule_compte ?? "", hypotheque: detail.hypotheque, reconnaissance_dette: detail.reconnaissance_dette,
                      });
                      setEditionBanque(true);
                    }}>
                      Modifier
                    </Button>
                  )}
                </div>

                {!editionBanque ? (
                  <>
                    {!(detail.organisme_credit || detail.no_compte || detail.code_bqe || detail.intitule_compte) ? (
                      <p className="text-xs text-muted-foreground">Aucune coordonnée bancaire renseignée.</p>
                    ) : (
                      <div className="space-y-1">
                        {detail.organisme_credit && <p>Organisme : <strong>{detail.organisme_credit}</strong></p>}
                        {detail.etab_credit && <p>Établissement : {detail.etab_credit}</p>}
                        {detail.no_compte && <p>Compte : {detail.code_bqe} {detail.code_guichet} — {detail.no_compte} — clé {detail.clerib}</p>}
                        {detail.intitule_compte && <p>Intitulé : {detail.intitule_compte}</p>}
                        <div className="flex gap-4 mt-1 text-xs">
                          {detail.hypotheque && <span className="text-[hsl(var(--warning))]">🔒 Hypothèque</span>}
                          {detail.reconnaissance_dette && <span className="text-[hsl(var(--warning))]">📄 Reconnaissance de dette</span>}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Organisme de crédit</Label>
                        <Input value={banqueForm.organisme_credit} onChange={e => setBanqueForm({ ...banqueForm, organisme_credit: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Établissement de crédit</Label>
                        <Input value={banqueForm.etab_credit} onChange={e => setBanqueForm({ ...banqueForm, etab_credit: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Banque</Label>
                        <select
                          className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                          value={banqueForm.code_bqe} onChange={e => setBanqueForm({ ...banqueForm, code_bqe: e.target.value })}
                        >
                          <option value="">Sélectionner une banque</option>
                          {banques.map(b => <option key={b.code} value={b.code}>{b.libelle}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Code guichet</Label>
                        <Input value={banqueForm.code_guichet} onChange={e => setBanqueForm({ ...banqueForm, code_guichet: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">N° compte</Label>
                        <Input value={banqueForm.no_compte} onChange={e => setBanqueForm({ ...banqueForm, no_compte: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Clé RIB</Label>
                        <Input value={banqueForm.clerib} onChange={e => setBanqueForm({ ...banqueForm, clerib: e.target.value })} />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs mb-1 block">Intitulé du compte</Label>
                        <Input value={banqueForm.intitule_compte} onChange={e => setBanqueForm({ ...banqueForm, intitule_compte: e.target.value })} />
                      </div>
                    </div>
                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={banqueForm.hypotheque} onChange={e => setBanqueForm({ ...banqueForm, hypotheque: e.target.checked })} />
                        Hypothèque
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={banqueForm.reconnaissance_dette} onChange={e => setBanqueForm({ ...banqueForm, reconnaissance_dette: e.target.checked })} />
                        Reconnaissance de dette
                      </label>
                    </div>
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditionBanque(false); setError(null); }}>Annuler</Button>
                      <Button size="sm" disabled={savingBanque} onClick={enregistrerBanque}>
                        {savingBanque ? "Enregistrement…" : "Enregistrer"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Justificatif */}
              {detail.justificatif_fourni && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle size={12} style={{ color: "hsl(var(--success))" }} />
                  Justificatif fourni{detail.justificatif_date ? ` le ${formatDate(detail.justificatif_date)}` : ""}
                </div>
              )}

              {/* Suspension — résumé court ici, détail complet dans l'onglet dédié */}
              {detail.pret_suspendu && (
                <div className="rounded-md p-2 text-sm" style={{ border: "1px solid hsl(var(--warning) / 0.3)", background: "hsl(var(--warning) / 0.08)" }}>
                  <p className="font-medium text-[hsl(var(--warning))]">
                    Suspendu depuis le {formatDate(detail.dt_debut_suspension)} —
                    <button className="underline ml-1" onClick={() => setTab("suspension")}>voir l'onglet Suspension</button>
                  </p>
                </div>
              )}

              {/* Décision */}
              {detail.dt_decision && (
                <div className="rounded-lg bg-secondary/40 p-3 text-sm space-y-1">
                  <p className="text-xs font-medium">Décision</p>
                  <p>Date : {formatDate(detail.dt_decision)} — Réf : {detail.ref_decision}</p>
                  <p>Décideur : {detail.matric_decideur}{detail.competenc_decideur ? ` (${detail.competenc_decideur})` : ""}</p>
                  {detail.motif_decision && <p className="text-muted-foreground">{detail.motif_decision}</p>}
                </div>
              )}

              {/* Notes RH internes */}
              {detail.observations_rh && (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Observations RH (internes)</p>
                  <p className="whitespace-pre-wrap">{detail.observations_rh}</p>
                </div>
              )}

              {/* Documents */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Documents</p>
                {documents.length === 0 ? (
                  <p className="text-xs text-muted-foreground mb-2">Aucun document rattaché à ce dossier.</p>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {documents.map(d => (
                      <div key={d.id} className="flex items-center justify-between text-xs border-b border-border pb-1.5 last:border-0 last:pb-0">
                        <div>
                          <span className="font-medium">{d.libelle}</span>
                          <span className="text-muted-foreground"> · {d.taille_ko ? `${d.taille_ko} Ko` : ""} · {formatDate(d.uploade_le)} · {d.uploade_par}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => pretsApi.ouvrirDocument(d.id, "view")}>
                            <Eye size={12} className="mr-1" /> Voir
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => pretsApi.ouvrirDocument(d.id, "download", d.libelle)}>
                            Télécharger
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => supprimerDocument(d.id)}>
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-[11px] mb-1 block">Libellé</Label>
                    <Input className="h-8 text-xs" value={libelleNouveauDoc} onChange={e => setLibelleNouveauDoc(e.target.value)} placeholder="Ex. Justificatif, reçu..." />
                  </div>
                  <div className="flex-1">
                    <Label className="text-[11px] mb-1 block">Fichier</Label>
                    <input
                      type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      onChange={e => setFichierNouveauDoc(e.target.files?.[0] ?? null)}
                      className="w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-[11px]"
                    />
                  </div>
                  <Button size="sm" className="h-8" disabled={!fichierNouveauDoc || !libelleNouveauDoc.trim() || uploadEnCours} onClick={ajouterDocument}>
                    {uploadEnCours ? "…" : "Ajouter"}
                  </Button>
                </div>
              </div>

              {/* Traçabilité */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {detail.created_date && <span>Créé le {formatDate(detail.created_date)}{detail.created_by ? ` par ${detail.created_by}` : ""}</span>}
                {detail.modified_date && <span>Modifié le {formatDate(detail.modified_date)}{detail.modified_by ? ` par ${detail.modified_by}` : ""}</span>}
                {(detail.manuel || detail.forcage) && (
                  <span className="text-[hsl(var(--warning))]">
                    {detail.manuel ? "Saisie manuelle" : ""}{detail.manuel && detail.forcage ? " · " : ""}{detail.forcage ? "Forçage appliqué" : ""}
                  </span>
                )}
              </div>

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
                <div className="max-h-96 overflow-y-auto border rounded-lg shadow-inner bg-secondary/10 p-2">
                  <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                    <p className="text-[11px] text-muted-foreground">
                      "Date réelle" et "Période de paie" restent vides tant que la clôture de paie n'a pas traité l'échéance.
                      La ligne qui clignote est la prochaine échéance à traiter.
                    </p>
                    {!detail.pret_interne && echeancesSelectionnees.size > 0 && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] text-destructive border-destructive/30 shrink-0 ml-2"
                        disabled={savingSuppressionEcheances} onClick={supprimerEcheancesSelectionnees}>
                        <Trash2 size={12} className="mr-1" />
                        {savingSuppressionEcheances ? "Suppression…" : `Supprimer ${echeancesSelectionnees.size} échéance(s)`}
                      </Button>
                    )}
                  </div>
                  <table className="w-full text-xs border-separate" style={{ borderSpacing: "0 3px" }}>
                    <thead>
                      <tr className="bg-secondary/80 sticky top-0 shadow-sm">
                        {!detail.pret_interne && <th className="px-2 py-1.5 w-8"></th>}
                        {["N°","Échéance prévue","Date réelle","Période paie","Capital dû","Capital","Intérêts","TVA/intérêts","Total","Restant","Statut","Réf paie"].map(h => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground first:rounded-l-md last:rounded-r-md">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const prochaine = detail.echeancier.find(e => e.statut !== "prelevee");
                        return detail.echeancier.map((e) => {
                          const traitee = e.statut === "prelevee";
                          const estProchaine = prochaine?.numero === e.numero;
                          return (
                            <tr
                              key={e.numero}
                              className={[
                                "transition-all rounded-md",
                                traitee ? "bg-muted/70 text-muted-foreground" : "bg-card shadow-[0_2px_4px_rgba(0,0,0,0.10)] hover:shadow-[0_3px_8px_rgba(0,0,0,0.16)] hover:-translate-y-px",
                                !traitee && e.reliquat > 0 ? "bg-[hsl(var(--warning)/0.10)]" : "",
                                estProchaine ? "animate-pulse ring-2 ring-[hsl(var(--warning))]" : "",
                              ].join(" ")}
                            >
                              {!detail.pret_interne && (
                                <td className="px-2 py-1.5">
                                  {!traitee && (
                                    <input
                                      type="checkbox"
                                      checked={echeancesSelectionnees.has(e.numero)}
                                      onChange={ev => setEcheancesSelectionnees(prev => {
                                        const next = new Set(prev);
                                        if (ev.target.checked) next.add(e.numero); else next.delete(e.numero);
                                        return next;
                                      })}
                                    />
                                  )}
                                </td>
                              )}
                              <td className="px-2 py-1.5 rounded-l-md">{e.numero}</td>
                              <td className="px-2 py-1.5">{formatDate(e.date_echeance)}</td>
                              <td className="px-2 py-1.5">{e.dt_reelle_remboursement ? formatDate(e.dt_reelle_remboursement) : "—"}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">
                                {e.mois_paie && e.annee_paie ? `${String(e.mois_paie).padStart(2, "0")}/${e.annee_paie}` : (e.periode_paie_code ?? "—")}
                              </td>
                              <td className="px-2 py-1.5 text-right">{formatMontant(e.capital_du)}</td>
                              <td className="px-2 py-1.5 text-right">{formatMontant(e.mt_capital)}</td>
                              <td className="px-2 py-1.5 text-right">{formatMontant(e.mt_interet)}</td>
                              <td className="px-2 py-1.5 text-right text-muted-foreground">{e.mt_tva_interet > 0 ? formatMontant(e.mt_tva_interet) : "—"}</td>
                              <td className="px-2 py-1.5 text-right font-medium">{formatMontant(e.mt_total)}</td>
                              <td className="px-2 py-1.5 text-right">{formatMontant(e.capital_restant)}</td>
                              <td className="px-2 py-1.5">
                                <span className={`${e.statut === "prelevee" ? "text-[hsl(var(--success))]" : e.statut === "reportee" ? "text-[hsl(var(--warning))]" : e.statut === "forcee" ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--info))]"}`}>
                                  {e.statut}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground rounded-r-md">{e.reference_paie ?? "—"}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              )}

              {!detail.pret_interne && (
                <div className="rounded-lg border border-border p-3 mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Prêt externe — saisie ou import d'échéances
                    </p>
                    {!ajoutEcheancierOuvert && (
                      <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setAjoutEcheancierOuvert(true)}>
                        Ajouter des échéances
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    L'échéancier de ce prêt n'est pas calculé par le moteur interne — il provient de
                    l'établissement de crédit. Les nouvelles échéances doivent être postérieures
                    (date et numéro) à la dernière déjà enregistrée{detail.echeancier.length > 0 ? ` (n°${detail.echeancier[detail.echeancier.length - 1].numero}, ${formatDate(detail.echeancier[detail.echeancier.length - 1].date_echeance)})` : ""}.
                  </p>

                  {ajoutEcheancierOuvert && (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-4 gap-2 items-end">
                        <div>
                          <Label className="text-[11px] mb-1 block">Date</Label>
                          <Input type="date" className="h-8 text-xs" value={nouvelleLigneDate} onChange={e => setNouvelleLigneDate(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-[11px] mb-1 block">Capital</Label>
                          <Input type="number" className="h-8 text-xs" value={nouvelleLigneCapital} onChange={e => setNouvelleLigneCapital(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-[11px] mb-1 block">Intérêts</Label>
                          <Input type="number" className="h-8 text-xs" value={nouvelleLigneInteret} onChange={e => setNouvelleLigneInteret(e.target.value)} />
                        </div>
                        <Button size="sm" className="h-8" onClick={ajouterLigneEnAttente} disabled={!nouvelleLigneDate || !nouvelleLigneCapital}>
                          Ajouter à la liste
                        </Button>
                      </div>

                      <div>
                        <Label className="text-[11px] mb-1 block">Ou importer un fichier CSV ou Excel (colonnes : date;capital;interet)</Label>
                        <input type="file" accept=".csv,.xlsx,.xls" onChange={importerFichierCsv} className="text-xs" />
                      </div>

                      {lignesEnAttente.length > 0 && (
                        <div className="rounded-md border border-border overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-secondary/50">
                              <tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-right">Capital</th><th className="px-2 py-1 text-right">Intérêts</th><th className="w-8"></th></tr>
                            </thead>
                            <tbody>
                              {lignesEnAttente.map((l, i) => (
                                <tr key={i} className="border-t border-border">
                                  <td className="px-2 py-1">{l.date_echeance}</td>
                                  <td className="px-2 py-1 text-right">{formatMontant(l.mt_capital)}</td>
                                  <td className="px-2 py-1 text-right">{formatMontant(l.mt_interet)}</td>
                                  <td className="px-2 py-1 text-right">
                                    <button className="text-destructive" onClick={() => setLignesEnAttente(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {error && <p className="text-xs text-destructive">{error}</p>}
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => { setAjoutEcheancierOuvert(false); setLignesEnAttente([]); setError(null); }}>Annuler</Button>
                        <Button size="sm" disabled={lignesEnAttente.length === 0 || savingEcheancier} onClick={enregistrerLignesEcheancier}>
                          {savingEcheancier ? "Enregistrement…" : `Enregistrer ${lignesEnAttente.length} échéance(s)`}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── SUSPENSION ───────────────────────────────── */}
            <TabsContent value="suspension" className="space-y-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">État courant</p>
                {detail.pret_suspendu ? (
                  <div className="rounded-md p-3 text-sm mb-3" style={{ border: "1px solid hsl(var(--warning) / 0.3)", background: "hsl(var(--warning) / 0.08)" }}>
                    <p className="font-medium text-[hsl(var(--warning))] mb-1">Actuellement suspendu</p>
                    <p>Motif : {MOTIF_SUSPENSION_LABELS[detail.motif_suspension ?? ""] ?? detail.motif_suspension}</p>
                    <p>Mode : {MODE_SUSPENSION_LABELS[detail.mode_suspension ?? "gel_echeance"]}</p>
                    <p>Du {formatDate(detail.dt_debut_suspension)} au {formatDate(detail.dt_fin_suspension)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mb-3">Aucune suspension en cours sur ce dossier.</p>
                )}
                {actions.includes("suspendre") && (
                  <Button size="sm" variant={action === "suspendre" ? "default" : "outline"}
                    className="gap-1 text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.4)]" onClick={() => setAction(action === "suspendre" ? null : "suspendre")}>
                    <PauseCircle size={13} /> Suspendre
                  </Button>
                )}
                {actions.includes("reprendre") && (
                  <Button size="sm" variant={action === "reprendre" ? "default" : "outline"}
                    className="gap-1 text-teal-700 border-teal-300" onClick={() => setAction(action === "reprendre" ? null : "reprendre")}>
                    <PlayCircle size={13} /> Reprendre le remboursement
                  </Button>
                )}
                {action === "reprendre" && (
                  <div className="rounded-lg border bg-secondary/20 p-3 mt-3">
                    {error && <p className="text-xs text-destructive mb-2">{error}</p>}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setAction(null)}>Annuler</Button>
                      <Button size="sm" onClick={executer} disabled={saving}>Confirmer la reprise</Button>
                    </div>
                  </div>
                )}
                {action === "suspendre" && (
                  <div className="rounded-lg border bg-secondary/20 p-3 mt-3 space-y-3">
                    <div>
                      <Label className="text-xs mb-1 block">Motif de suspension</Label>
                      <Select value={motifSuspension} onValueChange={setMotifSuspension}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(MOTIF_SUSPENSION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Mode</Label>
                      <Select value={modeSuspension} onValueChange={setModeSuspension}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(MODE_SUSPENSION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Date de début <span className="text-destructive">*</span></Label>
                        <Input type="date" value={dateDebutSusp} onChange={e => setDateDebutSusp(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Date de fin (optionnel)</Label>
                        <Input type="date" value={dateFinSusp} onChange={e => setDateFinSusp(e.target.value)} />
                      </div>
                    </div>
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setAction(null)}>Annuler</Button>
                      <Button size="sm" onClick={executer} disabled={saving || !dateDebutSusp}>Confirmer la suspension</Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Historique</p>
                {suspensions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun historique de suspension enregistré.</p>
                ) : (
                  <div className="space-y-2">
                    {suspensions.map(s => (
                      <div key={s.id} className="flex items-center justify-between text-xs border-b border-border pb-1.5 last:border-0 last:pb-0">
                        <div>
                          {MOTIF_SUSPENSION_LABELS[s.motif_suspension ?? ""] ?? s.motif_suspension} ({MODE_SUSPENSION_LABELS[s.mode_suspension ?? "gel_echeance"]})
                          {" — "}Du {formatDate(s.dt_debut_suspension)} au {s.dt_fin_suspension ? formatDate(s.dt_fin_suspension) : "…"}
                          {s.nb_mois_decale > 0 && <span className="text-muted-foreground"> · +{s.nb_mois_decale} mois décalé(s)</span>}
                        </div>
                        {s.fin_prevue_avant && s.fin_prevue_apres && (
                          <span className="text-muted-foreground">Fin : {formatDate(s.fin_prevue_avant)} → {formatDate(s.fin_prevue_apres)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── AUDIT ────────────────────────────────────── */}
            {sl >= 70 && (
              <TabsContent value="audit">
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-secondary/60 sticky top-0">
                        <tr>
                          {["Date", "Action", "Opérateur", "SL", "Champ modifié", "Ancienne valeur", "Nouvelle valeur"].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.audit.length === 0 ? (
                          <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Aucune entrée d'audit.</td></tr>
                        ) : detail.audit.map((a) => (
                          <tr key={a.id} className="border-t border-border hover:bg-secondary/20">
                            <td className="px-3 py-2 whitespace-nowrap">{new Date(a.horodatage).toLocaleString("fr-FR")}</td>
                            <td className="px-3 py-2 font-medium">{a.action}</td>
                            <td className="px-3 py-2">{a.operateur}</td>
                            <td className="px-3 py-2 text-muted-foreground">{a.security_level_operateur ?? "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{a.champ ?? "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{a.ancienne_valeur ?? "—"}</td>
                            <td className="px-3 py-2">{a.nouvelle_valeur ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── ACTIONS ──────────────────────────────────── */}
            {actions.length > 0 && (
              <TabsContent value="actions" className="space-y-4">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Actions disponibles</p>
                  <div className="flex flex-wrap gap-2">
                  {actions.includes("approuver") && (
                    <Button size="sm" variant={action === "approuver" ? "default" : "outline"}
                      className="gap-1 text-[hsl(var(--success))] border-[hsl(var(--success)/0.4)]"
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
                      className="gap-1 text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.4)]" onClick={() => setAction("debloquer")}>
                      <DollarSign size={13} /> Débloquer les fonds
                    </Button>
                  )}
                  {actions.includes("suspendre") && (
                    <Button size="sm" variant={action === "suspendre" ? "default" : "outline"}
                      className="gap-1 text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.4)]" onClick={() => setAction("suspendre")}>
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
                  {sl >= 70 && detail.echeancier.length > 0 && (
                    <Button size="sm" variant={action === "recalculer_echeancier" ? "default" : "outline"}
                      className="gap-1 text-[hsl(var(--info))] border-[hsl(var(--info)/0.4)]" onClick={() => {
                        setNouveauCapitalRestant(String(detail.capital_restant ?? ""));
                        setNouveauNbEcheances(String(detail.echeance_restant ?? ""));
                        setMotifRecalcul("");
                        setAction("recalculer_echeancier");
                      }}>
                      <TrendingUp size={13} /> Recalculer l'échéancier
                    </Button>
                  )}
                  {actions.includes("supprimer") && (
                    <Button size="sm" variant="outline" className="gap-1 text-destructive border-destructive/30"
                      onClick={() => setAction("supprimer")}>
                      <Trash2 size={13} /> Supprimer (logique)
                    </Button>
                  )}
                  </div>
                </div>

                {/* Formulaires contextuels */}
                {action && action !== "reprendre" && action !== "supprimer" && (
                  <div className="rounded-lg border border-border p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Détails de l'action</p>
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
                              <select
                                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                                value={banqueEmettrice} onChange={e => setBanqueEmettrice(e.target.value)}
                              >
                                <option value="">Sélectionner une banque</option>
                                {banques.map(b => <option key={b.code} value={b.libelle}>{b.libelle}</option>)}
                              </select>
                            </div>
                          </div>
                        )}
                        <div>
                          <Label className="text-xs mb-1 block">Reçu du chèque (optionnel)</Label>
                          <input
                            type="file" accept=".pdf,.png,.jpg,.jpeg"
                            onChange={e => setRecuCheque(e.target.files?.[0] ?? null)}
                            className="w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs"
                          />
                          {recuCheque && <p className="text-[11px] text-muted-foreground mt-1">{recuCheque.name}</p>}
                        </div>
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
                        <div>
                          <Label className="text-xs mb-1 block">Après ce forçage, pour la suite du tableau…</Label>
                          <div className="space-y-1.5">
                            <label className="flex items-start gap-2 text-xs cursor-pointer">
                              <input type="radio" className="mt-0.5" name="modeCascadeForcage"
                                checked={modeCascadeForcage === "reduire_mensualite"}
                                onChange={() => setModeCascadeForcage("reduire_mensualite")} />
                              <span><strong>Recalculer les échéances</strong> — même nombre d'échéances restantes, montant de chacune ajusté.</span>
                            </label>
                            <label className="flex items-start gap-2 text-xs cursor-pointer">
                              <input type="radio" className="mt-0.5" name="modeCascadeForcage"
                                checked={modeCascadeForcage === "reduire_duree"}
                                onChange={() => setModeCascadeForcage("reduire_duree")} />
                              <span><strong>Garder la mensualité habituelle</strong> — le nombre d'échéances restantes est réduit (ou augmenté) en conséquence.</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                    {action === "recalculer_echeancier" && (
                      <div className="space-y-3">
                        <p className="text-[11px] text-muted-foreground">
                          Les échéances déjà traitées (statut "prelevee") ne sont jamais modifiées. Seule la suite du
                          tableau (à partir de la date de reprise) est supprimée et régénérée avec ces nouvelles valeurs.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs mb-1 block">Nouveau capital restant (DH) <span className="text-destructive">*</span></Label>
                            <Input type="number" min={0} value={nouveauCapitalRestant} onChange={e => setNouveauCapitalRestant(e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-xs mb-1 block">Nouveau nb d'échéances restantes <span className="text-destructive">*</span></Label>
                            <Input type="number" min={1} value={nouveauNbEcheances} onChange={e => setNouveauNbEcheances(e.target.value)} />
                          </div>
                        </div>
                        <div className="max-w-xs">
                          <Label className="text-xs mb-1 block">Date de reprise <span className="text-destructive">*</span></Label>
                          <Input type="date" value={dateRepriseRecalcul} onChange={e => setDateRepriseRecalcul(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">Motif <span className="text-destructive">*</span></Label>
                          <Textarea value={motifRecalcul} onChange={e => setMotifRecalcul(e.target.value)} rows={2}
                            placeholder="Raison de l'ajustement manuel (obligatoire, tracé en audit)" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {action === "supprimer" && (
                  <div className="rounded-lg border border-destructive/30 p-3 text-sm" style={{ background: "hsl(var(--destructive) / 0.06)" }}>
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
  // Un Administrateur a toujours l'équivalent du SL maximal côté UI, même si
  // collaborateurs.security_level n'est pas renseigné pour son propre compte
  // (le backend, lui, revalide indépendamment sur chaque action sensible).
  const sl: number = activeRole === "administrateur" ? 999 : ((profile as any)?.security_level ?? 0);

  const [prets, setPrets] = useState<Pret[]>([]);
  const [stats, setStats] = useState<PretStats | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [configs, setConfigs] = useState<PretConfig[]>([]);
  const [configEnEdition, setConfigEnEdition] = useState<string | null>(null);
  const [valeurEdition, setValeurEdition] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("prets");
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreType, setFiltreType] = useState("");
  const [creationDirecte, setCreationDirecte] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [montantMin, setMontantMin] = useState("");
  const [montantMax, setMontantMax] = useState("");
  const [dateDemandeDe, setDateDemandeDe] = useState("");
  const [dateDemandeA, setDateDemandeA] = useState("");
  const [filtresAvancesOuverts, setFiltresAvancesOuverts] = useState(false);

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

  const enregistrerParametre = async (code: string) => {
    const v = Number(valeurEdition);
    if (Number.isNaN(v)) return;
    setSavingConfig(true);
    try {
      const maj = await pretsApi.modifierConfig(code, v);
      setConfigs(prev => prev.map(c => c.code === code ? maj : c));
      setConfigEnEdition(null);
    } catch {
      // Silencieux ici — la ligne reste en édition, l'utilisateur voit que
      // "Enregistrer" n'a rien changé et peut réessayer.
    } finally {
      setSavingConfig(false);
    }
  };

  // Filtres avancés appliqués côté client (recherche texte, montant, dates
  // de demande) — statut/type restent côté serveur (déjà en place).
  const pretsFiltres = useMemo(() => {
    const texte = recherche.trim().toLowerCase();
    const mMin = montantMin ? Number(montantMin) : null;
    const mMax = montantMax ? Number(montantMax) : null;
    const dDe = dateDemandeDe ? new Date(dateDemandeDe) : null;
    const dA = dateDemandeA ? new Date(dateDemandeA) : null;

    return prets.filter(p => {
      if (texte) {
        const cible = `${p.collab_nom ?? ""} ${p.matricule} ${p.ref_pret ?? ""}`.toLowerCase();
        if (!cible.includes(texte)) return false;
      }
      if (mMin !== null && p.mt_pret < mMin) return false;
      if (mMax !== null && p.mt_pret > mMax) return false;
      if (dDe && new Date(p.dt_demande) < dDe) return false;
      if (dA && new Date(p.dt_demande) > dA) return false;
      return true;
    });
  }, [prets, recherche, montantMin, montantMax, dateDemandeDe, dateDemandeA]);

  const reinitialiserFiltresAvances = () => {
    setRecherche(""); setMontantMin(""); setMontantMax(""); setDateDemandeDe(""); setDateDemandeA("");
  };
  const filtresAvancesActifs = !!(recherche || montantMin || montantMax || dateDemandeDe || dateDemandeA);

  const enveloppeUsage = stats
    ? Math.round((stats.enveloppe_interne_utilisee / (stats.plafond_interne_annuel || 1)) * 100)
    : 0;

  return (
    <div className="w-full">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-2 text-[13px] text-muted-foreground">
        <span>Mon équipe</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold text-foreground">Gestion des Prêts</span>
        {alertes.filter(a => !a.lue).length > 0 && (
          <button onClick={() => setTab("alertes")} className="ml-2 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }}>
            <Bell size={11} />
            {alertes.filter(a => !a.lue).length} alertes non lues
          </button>
        )}
        <Link to="/configuration/prets" className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <Settings size={12} /> Paramétrage des prêts
        </Link>
      </div>

      <div className="px-4 py-6 space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard label="En attente" value={stats.en_attente} icon={<TrendingUp size={15} />} colorClass="text-[hsl(var(--info))]" />
          <StatCard label="Actifs" value={stats.actifs} icon={<CheckCircle size={15} />} colorClass="text-[hsl(var(--success))]" />
          <StatCard label="Suspendus" value={stats.suspendus} icon={<PauseCircle size={15} />} colorClass="text-[hsl(var(--warning))]" />
          <StatCard label="Encours total" value={formatMontant(stats.encours_total)} icon={<DollarSign size={15} />} colorClass="text-[hsl(var(--warning))]" />
          <StatCard label="Capital restant" value={formatMontant(stats.capital_restant)} icon={<AlertTriangle size={15} />} colorClass="text-[hsl(var(--destructive))]" />
          <StatCard
            label="Enveloppe interne"
            value={formatMontant(stats.enveloppe_disponible)}
            icon={<Shield size={15} />}
            colorClass={enveloppeUsage > 80 ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--primary))]"}
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
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, enveloppeUsage)}%`, background: enveloppeUsage > 80 ? "hsl(var(--destructive))" : "hsl(var(--primary))" }}
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
          <div className="flex flex-wrap items-center gap-2">
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
            {sl >= 50 && (
              <Button size="sm" className="h-8 ml-auto" onClick={() => setCreationDirecte(true)}>
                <Plus size={14} className="mr-1.5" /> Nouveau dossier
              </Button>
            )}
            <Button
              variant="outline" size="sm" className={`h-8 ${sl >= 50 ? "" : "ml-auto"}`}
              onClick={() => setFiltresAvancesOuverts(o => !o)}
            >
              {filtresAvancesOuverts ? <ChevronUp size={13} className="mr-1" /> : <ChevronDown size={13} className="mr-1" />}
              Filtres avancés
              {filtresAvancesActifs && <span className="ml-1.5 w-1.5 h-1.5 rounded-full" style={{ background: "hsl(var(--primary))" }} />}
            </Button>
          </div>

          {filtresAvancesOuverts && (
            <div className="rounded-lg border border-border p-3 grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="col-span-2">
                <Label className="text-[11px] mb-1 block">Recherche (collaborateur, matricule, référence)</Label>
                <Input className="h-8 text-xs" value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Ex. Karim, 00123, PR-2026..." />
              </div>
              <div>
                <Label className="text-[11px] mb-1 block">Montant min (DH)</Label>
                <Input className="h-8 text-xs" type="number" value={montantMin} onChange={e => setMontantMin(e.target.value)} />
              </div>
              <div>
                <Label className="text-[11px] mb-1 block">Montant max (DH)</Label>
                <Input className="h-8 text-xs" type="number" value={montantMax} onChange={e => setMontantMax(e.target.value)} />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-[11px] mb-1 block">Demande du</Label>
                  <Input className="h-8 text-xs" type="date" value={dateDemandeDe} onChange={e => setDateDemandeDe(e.target.value)} />
                </div>
                <div className="flex-1">
                  <Label className="text-[11px] mb-1 block">au</Label>
                  <Input className="h-8 text-xs" type="date" value={dateDemandeA} onChange={e => setDateDemandeA(e.target.value)} />
                </div>
              </div>
              {filtresAvancesActifs && (
                <div className="col-span-2 md:col-span-5">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reinitialiserFiltresAvances}>
                    Réinitialiser les filtres avancés
                  </Button>
                </div>
              )}
            </div>
          )}

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
                ) : pretsFiltres.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-10 text-muted-foreground text-sm">
                    {prets.length === 0 ? "Aucun dossier." : "Aucun dossier ne correspond aux filtres."}
                  </td></tr>
                ) : pretsFiltres.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-secondary/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.ref_pret}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-xs">{p.collab_nom ?? p.matricule}</p>
                      <p className="text-[11px] text-muted-foreground">{p.matricule}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1 text-xs">
                        {p.pret_interne ? <Banknote size={12} style={{ color: "hsl(var(--primary))" }} /> : <Building2 size={12} style={{ color: "hsl(var(--info))" }} />}
                        {p.pret_interne ? "Interne" : "Externe"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{ALGO_LABELS[p.algo_name]?.split(" ")[0]}</td>
                    <td className="px-3 py-2 text-xs font-medium text-right">{formatMontant(p.mt_pret)}</td>
                    <td className="px-3 py-2 text-xs text-right">{formatMontant(p.mt_echeance)}</td>
                    <td className="px-3 py-2"><StatutBadge statut={p.statut} /></td>
                    <td className="px-3 py-2 text-xs text-center">
                      {p.tx_endettement_i != null
                        ? <span className={p.tx_endettement_i > 33 ? "text-[hsl(var(--destructive))] font-semibold" : ""}>{p.tx_endettement_i}%</span>
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
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((c) => (
                    <tr key={c.code} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.libelle}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {configEnEdition === c.code ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Input
                              type="number" autoFocus value={valeurEdition}
                              onChange={e => setValeurEdition(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") enregistrerParametre(c.code); if (e.key === "Escape") setConfigEnEdition(null); }}
                              className="h-7 w-28 text-right text-sm"
                            />
                          </div>
                        ) : c.valeur}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.modifie_par ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {configEnEdition === c.code ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" className="h-6 px-2 text-[11px]" disabled={savingConfig} onClick={() => enregistrerParametre(c.code)}>
                              {savingConfig ? "…" : "OK"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setConfigEnEdition(null)}>
                              Annuler
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm" variant="ghost" className="h-6 w-6 p-0"
                            onClick={() => { setConfigEnEdition(c.code); setValeurEdition(String(c.valeur)); }}
                          >
                            <Settings size={12} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Réservé aux administrateurs (SL 90+).</p>
          </TabsContent>
        )}
      </Tabs>

      <ModalDetail pretId={selectedId} sl={sl} onClose={() => setSelectedId(null)} onRefresh={charger} />
      <CreationDirectePretDialog open={creationDirecte} onClose={() => setCreationDirecte(false)} onSuccess={charger} />
      </div>
    </div>
  );
};

export default GestionPretsPage;
