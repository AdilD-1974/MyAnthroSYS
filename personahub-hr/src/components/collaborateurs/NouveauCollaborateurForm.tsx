/**
 * NouveauCollaborateurForm.tsx  ─  Exemple d'intégration
 * ──────────────────────────────────────────────────────────────────────────────
 * Montre comment brancher :
 *   • useIdentifiantsUnicity + DuplicateAlertModal  (Feature 1)
 *   • useContratValidation                          (Feature 2)
 *
 * dans un formulaire de création de collaborateur avec contrat.
 *
 * NOTE : Ce fichier est un exemple d'intégration. Adaptez les noms de champs,
 * les appels API et les composants UI à votre codebase existante.
 */

import React, { useEffect, useState } from "react";
import { AlertCircle, ShieldAlert } from "lucide-react";

import {
  useIdentifiantsUnicity,
  affiliationLabel,
} from "./useIdentifiantsUnicity";
import { DuplicateAlertModal } from "./DuplicateAlertModal";
import {
  useContratValidation,
  fetchAgeMinimumTravail,
} from "./useContratValidation";
import { useLicence } from "@/hooks/useLicence";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CollaborateurFormData {
  // Identité
  nom: string;
  prenom: string;
  dateNaissance: string;
  cin: string;
  passeport: string;
  numFiscal: string;
  affiliations: {
    cnss: string;
    cimr: string;
    mutuelle: string;
    amo: string;
  };
  // Contrat
  contrat: {
    occurrence: string;
    typeContrat: string;
    statut: string;
    dateDebut: string;
    dateFin: string;
    dateTitularisation: string;
    duree: string;
    referenceContrat: string;
  };
}

const EMPTY_FORM: CollaborateurFormData = {
  nom: "",
  prenom: "",
  dateNaissance: "",
  cin: "",
  passeport: "",
  numFiscal: "",
  affiliations: { cnss: "", cimr: "", mutuelle: "", amo: "" },
  contrat: {
    occurrence: "",
    typeContrat: "",
    statut: "",
    dateDebut: "",
    dateFin: "",
    dateTitularisation: "",
    duree: "",
    referenceContrat: "",
  },
};

// ─── Composant ────────────────────────────────────────────────────────────────

export const NouveauCollaborateurForm: React.FC<{
  /** ID du collaborateur en cours d'édition (undefined = création) */
  collabId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}> = ({ collabId, onSuccess, onCancel }) => {
  const [form, setForm] = useState<CollaborateurFormData>(EMPTY_FORM);
  const [ageMinimumTravail, setAgeMinimumTravail] = useState<number>(15);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showLicenceWarn, setShowLicenceWarn] = useState(false);
  const [licenceError, setLicenceError] = useState<string | null>(null);

  // ── Licence : sièges « collaborateurs gérés » (RG-LIC-01, Adil DAIA) ──────
  const { geres, maxSieges } = useLicence();

  // ── Hooks métier ──────────────────────────────────────────────────────────
  const { checkUnicity, duplicates, isChecking, clearDuplicates } =
    useIdentifiantsUnicity();
  const { validate, errors: contratErrors, reset: resetContratErrors } =
    useContratValidation();

  // ── Charger le paramètre AGE_MINIMUM_TRAVAIL au montage ───────────────────
  useEffect(() => {
    fetchAgeMinimumTravail().then(setAgeMinimumTravail);
  }, []);

  // ─── Helpers de saisie ────────────────────────────────────────────────────

  const setField = <K extends keyof CollaborateurFormData>(
    key: K,
    value: CollaborateurFormData[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  const setContratField = <K extends keyof CollaborateurFormData["contrat"]>(
    key: K,
    value: string
  ) =>
    setForm((f) => ({
      ...f,
      contrat: { ...f.contrat, [key]: value },
    }));

  const setAffiliationField = (
    key: keyof CollaborateurFormData["affiliations"],
    value: string
  ) =>
    setForm((f) => ({
      ...f,
      affiliations: { ...f.affiliations, [key]: value },
    }));

  // ─── Soumission du formulaire ─────────────────────────────────────────────

  // Seuil d'alerte avant le plafond de licence (en %).
  const SEUIL_ALERTE_PCT = 90;
  const todayISO = new Date().toISOString().slice(0, 10);

  /**
   * Garde-fou licence — uniquement à la CRÉATION d'un collaborateur qui
   * consomme un siège (contrat en cours). 'block' = dépasserait le plafond ;
   * 'warn' = approche du seuil (autorisé après confirmation) ; 'ok' sinon.
   */
  const evalLicenceGate = (): "ok" | "warn" | "block" => {
    if (collabId) return "ok";                       // édition : pas de nouveau siège
    if (!maxSieges || maxSieges <= 0) return "ok";   // licence illimitée / absente
    const consommeSiege = !form.contrat.dateFin || form.contrat.dateFin >= todayISO;
    if (!consommeSiege) return "ok";                 // contrat déjà échu : ne consomme pas
    const apres = geres + 1;
    if (apres > maxSieges) return "block";
    if (apres >= Math.ceil((maxSieges * SEUIL_ALERTE_PCT) / 100)) return "warn";
    return "ok";
  };

  const handleLicenceConfirm = async () => {
    setShowLicenceWarn(false);
    await saveCollaborateur(true);   // force malgré l'approche du seuil
  };
  const handleLicenceCancel = () => setShowLicenceWarn(false);

  const handleSubmit = async () => {
    resetContratErrors();

    // 1. Valider le contrat (occurrence + dates)
    const contratOk = validate({
      occurrence: form.contrat.occurrence,
      dateDebut: form.contrat.dateDebut,
      dateFin: form.contrat.dateFin || null,
      dateTitularisation: form.contrat.dateTitularisation || null,
      dateNaissanceCollab: form.dateNaissance,
      ageMinimumTravail,
    });

    if (!contratOk) {
      // Les erreurs sont affichées inline dans le formulaire
      return;
    }

    // 2. Vérifier l'unicité des identifiants
    const isUnique = await checkUnicity(
      {
        cin: form.cin,
        passeport: form.passeport,
        num_fiscal: form.numFiscal,
        affiliations: form.affiliations,
      },
      collabId
    );

    if (!isUnique) {
      // Afficher le modal d'alerte doublon
      setShowDuplicateModal(true);
      return;
    }

    // Aucun doublon → enregistrement direct
    await saveCollaborateur();
  };

  const saveCollaborateur = async (forceLicence = false) => {
    // Contrôle de licence avant tout enregistrement
    const gate = evalLicenceGate();
    if (gate === "block") {
      setLicenceError(
        `Plafond de licence atteint : ${geres}/${maxSieges} collaborateurs gérés. ` +
        `L'ajout est impossible sans extension de licence.`
      );
      return;
    }
    if (gate === "warn" && !forceLicence) {
      setShowLicenceWarn(true);
      return;
    }
    setLicenceError(null);
    setIsSaving(true);
    try {
      // TODO : remplacer par votre appel API réel
      await fetch(`/api/collaborateurs${collabId ? `/${collabId}` : ""}`, {
        method: collabId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      onSuccess();
    } catch (e) {
      console.error("Erreur enregistrement :", e);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Gestion du modal doublon ─────────────────────────────────────────────

  const handleDuplicateConfirm = async () => {
    // L'utilisateur force la validation malgré le doublon
    setShowDuplicateModal(false);
    clearDuplicates();
    await saveCollaborateur();
  };

  const handleDuplicateCancel = () => {
    // Retour au formulaire pour correction
    setShowDuplicateModal(false);
    clearDuplicates();
  };

  // ─── Rendu ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Modal doublon (Feature 1) ── */}
      {showDuplicateModal && (
        <DuplicateAlertModal
          duplicates={duplicates}
          onConfirm={handleDuplicateConfirm}
          onCancel={handleDuplicateCancel}
          allowForce={true} // Mettre false pour bloquer complètement
        />
      )}

      {/* ── Alerte de seuil de licence (avant plafond) ── */}
      {showLicenceWarn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3" style={{ border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center gap-2 font-semibold" style={{ color: "hsl(30 80% 40%)" }}>
              <ShieldAlert size={18} /> Seuil de licence bientôt atteint
            </div>
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Après cet ajout, <strong>{geres + 1}/{maxSieges}</strong> sièges « collaborateurs gérés » seront
              utilisés (seuil d'alerte {SEUIL_ALERTE_PCT} %). Vous pouvez continuer, mais pensez à prévoir une
              extension de licence avant d'atteindre le plafond.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={handleLicenceCancel}
                className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors hover:bg-muted/40">
                Annuler
              </button>
              <button type="button" onClick={handleLicenceConfirm}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "hsl(30 80% 45%)" }}>
                Continuer quand même
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* ── Blocage licence (plafond atteint) ── */}
        {licenceError && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm"
            style={{ background: "hsl(var(--destructive) / 0.1)", border: "1px solid hsl(var(--destructive) / 0.4)", color: "hsl(var(--destructive))" }}>
            <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" /> <span>{licenceError}</span>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION IDENTITÉ + IDENTIFIANTS
        ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Identité
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Nom *">
              <input
                value={form.nom}
                onChange={(e) => setField("nom", e.target.value)}
                className="form-input"
                placeholder="DUPONT"
              />
            </FormField>
            <FormField label="Prénom *">
              <input
                value={form.prenom}
                onChange={(e) => setField("prenom", e.target.value)}
                className="form-input"
                placeholder="Jean"
              />
            </FormField>
            <FormField label="Date de naissance *">
              <input
                type="date"
                value={form.dateNaissance}
                onChange={(e) => setField("dateNaissance", e.target.value)}
                className="form-input"
              />
            </FormField>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            IDENTIFIANTS (Feature 1 : vérification unicité)
        ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Identifiants
          </h3>
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <AlertCircle size={12} />
            Ces champs seront vérifiés pour éviter les doublons à l'enregistrement.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="CIN">
              <input
                value={form.cin}
                onChange={(e) => setField("cin", e.target.value.toUpperCase())}
                className="form-input font-mono"
                placeholder="AB123456"
                maxLength={10}
              />
            </FormField>
            <FormField label="N° Passeport">
              <input
                value={form.passeport}
                onChange={(e) => setField("passeport", e.target.value.toUpperCase())}
                className="form-input font-mono"
                placeholder="AA1234567"
              />
            </FormField>
            <FormField label="N° Fiscal">
              <input
                value={form.numFiscal}
                onChange={(e) => setField("numFiscal", e.target.value)}
                className="form-input font-mono"
                placeholder="12345678"
              />
            </FormField>
          </div>

          {/* Affiliations */}
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-2">
            Affiliations sociales
          </h4>
          <div className="grid grid-cols-2 gap-4">
            {(
              Object.keys(form.affiliations) as (keyof typeof form.affiliations)[]
            ).map((key) => (
              <FormField key={key} label={affiliationLabel(key)}>
                <input
                  value={form.affiliations[key]}
                  onChange={(e) => setAffiliationField(key, e.target.value)}
                  className="form-input font-mono"
                  placeholder="—"
                />
              </FormField>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            CONTRAT (Feature 2 : occurrence obligatoire + contrôle dates)
        ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Contrat
          </h3>
          <div className="grid grid-cols-2 gap-4">

            {/* Occurrence — OBLIGATOIRE */}
            <FormField
              label="Occurrence *"
              error={contratErrors.occurrence}
              hint="Numéro d'ordre du contrat (ex : 001, 002…)"
            >
              <input
                value={form.contrat.occurrence}
                onChange={(e) => setContratField("occurrence", e.target.value)}
                className={`form-input font-mono ${contratErrors.occurrence ? "border-destructive ring-1 ring-destructive/40" : ""}`}
                placeholder="001"
                maxLength={10}
              />
            </FormField>

            <FormField label="Type de contrat *">
              <select
                value={form.contrat.typeContrat}
                onChange={(e) => setContratField("typeContrat", e.target.value)}
                className="form-input"
              >
                <option value="">— Sélectionner —</option>
                <option value="CDI">CDI</option>
                <option value="CDD">CDD</option>
                <option value="STAGE">Stage</option>
                <option value="ALTERNANCE">Alternance</option>
              </select>
            </FormField>

            {/* Date de début — contrôle âge minimum */}
            <FormField
              label="Date de début *"
              error={contratErrors.dateDebut}
              hint={
                form.dateNaissance
                  ? `Doit être ≥ date de naissance + ${ageMinimumTravail} ans`
                  : undefined
              }
            >
              <input
                type="date"
                value={form.contrat.dateDebut}
                onChange={(e) => setContratField("dateDebut", e.target.value)}
                className={`form-input ${contratErrors.dateDebut ? "border-destructive ring-1 ring-destructive/40" : ""}`}
              />
            </FormField>

            {/* Date de fin */}
            <FormField label="Date de fin" error={contratErrors.dateFin}>
              <input
                type="date"
                value={form.contrat.dateFin}
                onChange={(e) => setContratField("dateFin", e.target.value)}
                className={`form-input ${contratErrors.dateFin ? "border-destructive ring-1 ring-destructive/40" : ""}`}
              />
            </FormField>

            {/* Date de titularisation */}
            <FormField
              label="Date de titularisation"
              error={contratErrors.dateTitularisation}
            >
              <input
                type="date"
                value={form.contrat.dateTitularisation}
                onChange={(e) =>
                  setContratField("dateTitularisation", e.target.value)
                }
                className={`form-input ${contratErrors.dateTitularisation ? "border-destructive ring-1 ring-destructive/40" : ""}`}
              />
            </FormField>

            <FormField label="Référence contrat">
              <input
                value={form.contrat.referenceContrat}
                onChange={(e) =>
                  setContratField("referenceContrat", e.target.value)
                }
                className="form-input"
                placeholder="CTR-2025-001"
              />
            </FormField>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            BOUTONS
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors hover:bg-muted/40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || isChecking}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: "hsl(var(--primary))" }}
          >
            {isSaving || isChecking ? "Vérification…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </>
  );
};

// ─── Composant utilitaire : champ de formulaire avec label + erreur ───────────

const FormField: React.FC<{
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, error, hint, children }) => (
  <div className="space-y-1">
    <label className="text-xs font-medium text-foreground">{label}</label>
    {children}
    {hint && !error && (
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    )}
    {error && (
      <p className="text-[10px] font-medium flex items-start gap-1" style={{ color: "hsl(var(--destructive))" }}>
        <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
        {error}
      </p>
    )}
  </div>
);
