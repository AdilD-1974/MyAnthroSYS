import React, { useState, useEffect, useRef } from "react";
import { db, api } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, User, Phone, FileText, Briefcase,
  Check, Save, ChevronRight, RefreshCw, Search, UserCheck, X, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import RefSelect from "@/components/RefSelect";

/* ─── Types ─── */
interface FormData {
  // État civil
  civilite: string;
  matricule: string;
  ancien_matricule: string;
  nom: string;
  prenom: string;
  nom_jeune_fille: string;
  code_genre: string;
  date_naissance: string;
  lieu_naissance: string;
  code_nationalite: string;
  code_nationalite2: string;
  statut_collaborateur: string;
  // Coordonnées
  telephone: string;
  gsm: string;
  email_personnel: string;
  email_professionnel: string;
  // Documents identité
  cin: string;
  cin_date_debut: string;
  cin_date_fin: string;
  passeport: string;
  passeport_date_debut: string;
  passeport_date_fin: string;
  num_fiscal: string;
  fiscal_date_debut: string;
  fiscal_date_fin: string;
  num_cnss: string;
  cnss_date_debut: string;
  cnss_date_fin: string;
  num_cimr: string;
  cimr_date_debut: string;
  cimr_date_fin: string;
  num_amo: string;
  amo_date_debut: string;
  amo_date_fin: string;
  // Société
  societe_id: string;
  // Contrat initial (obligatoire — date_fin calculée auto, non saisissable)
  code_type_contrat: string;
  date_debut_contrat: string;
  duree_contrat: string;
  code_unite_duree: string;
  code_statut_contrat: string;
  reference_contrat: string;
  code_motif_recrutement: string;
  code_source_recrutement: string;
  salaire_base: string;
}

const INITIAL_FORM: FormData = {
  civilite: "", matricule: "", ancien_matricule: "", nom: "", prenom: "", nom_jeune_fille: "",
  code_genre: "M", date_naissance: "", lieu_naissance: "",
  code_nationalite: "", code_nationalite2: "", statut_collaborateur: "ACTIF",
  societe_id: "",
  telephone: "", gsm: "", email_personnel: "", email_professionnel: "",
  cin: "", cin_date_debut: "", cin_date_fin: "",
  passeport: "", passeport_date_debut: "", passeport_date_fin: "",
  num_fiscal: "", fiscal_date_debut: "", fiscal_date_fin: "",
  num_cnss: "", cnss_date_debut: "", cnss_date_fin: "",
  num_cimr: "", cimr_date_debut: "", cimr_date_fin: "",
  num_amo: "", amo_date_debut: "", amo_date_fin: "",
  code_type_contrat: "", date_debut_contrat: "", duree_contrat: "", code_unite_duree: "",
  code_statut_contrat: "ACTIF", reference_contrat: "",
  code_motif_recrutement: "", code_source_recrutement: "", salaire_base: "",
};

/* ─── Étapes ─── */
const STEPS = [
  { id: "civil", label: "État civil", icon: <User size={16} /> },
  { id: "coordonnees", label: "Coordonnées", icon: <Phone size={16} /> },
  { id: "documents", label: "Documents", icon: <FileText size={16} /> },
  { id: "contrat", label: "Contrat", icon: <Briefcase size={16} /> },
];

/* ─── Composants de saisie ─── */
const FInput: React.FC<{
  label: string; name: keyof FormData; value: string; required?: boolean;
  type?: string; onChange: (k: keyof FormData, v: string) => void;
  placeholder?: string; className?: string;
}> = ({ label, name, value, required, type = "text", onChange, placeholder, className }) => (
  <div className={className}>
    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(name, e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all focus:ring-2"
      style={{
        borderColor: "hsl(var(--border))",
        background: "hsl(var(--background))",
        color: "hsl(var(--foreground))",
        height: 40,
      }}
    />
  </div>
);

/* Groupe de 3 champs (numéro + début + fin) pour les documents */
const DocGroup: React.FC<{
  title: string; numKey: keyof FormData; debutKey: keyof FormData; finKey: keyof FormData;
  values: FormData; onChange: (k: keyof FormData, v: string) => void;
}> = ({ title, numKey, debutKey, finKey, values, onChange }) => (
  <div className="rounded-xl p-4 border" style={{ background: "hsl(var(--muted) / 0.35)", borderColor: "hsl(var(--border))" }}>
    <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--accent))" }}>{title}</p>
    <div className="grid grid-cols-1 gap-3">
      <FInput label="Numéro" name={numKey} value={values[numKey]} onChange={onChange} placeholder={`N° ${title}`} />
      <div className="grid grid-cols-2 gap-3">
        <FInput label="Date début" name={debutKey} value={values[debutKey]} type="date" onChange={onChange} />
        <FInput label="Date fin" name={finKey} value={values[finKey]} type="date" onChange={onChange} />
      </div>
    </div>
  </div>
);

/* Wrapper RefSelect adapté au FormData */
const FRefSelect: React.FC<{
  label: string;
  name: keyof FormData;
  value: string;
  table: string;
  onChange: (k: keyof FormData, v: string) => void;
  required?: boolean;
  className?: string;
  placeholder?: string;
  staticOptions?: { value: string; label: string }[];
}> = ({ label, name, value, table, onChange, required, className, placeholder, staticOptions }) => (
  <RefSelect
    table={table}
    value={value}
    onChange={v => onChange(name, v)}
    label={label}
    required={required}
    className={className}
    placeholder={placeholder}
    staticOptions={staticOptions}
  />
);

/* ─── Types pour le lookup ancien collaborateur ─── */
interface AncienCollab {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  date_naissance?: string;
  civilite?: string;
  nom_jeune_fille?: string;
  code_genre?: string;
  lieu_naissance?: string;
  code_nationalite?: string;
  code_nationalite2?: string;
  telephone?: string;
  gsm?: string;
  email_personnel?: string;
  email_professionnel?: string;
  cin?: string; cin_date_debut?: string; cin_date_fin?: string;
  passeport?: string; passeport_date_debut?: string; passeport_date_fin?: string;
  num_fiscal?: string; fiscal_date_debut?: string; fiscal_date_fin?: string;
  num_cnss?: string; cnss_date_debut?: string; cnss_date_fin?: string;
  num_cimr?: string; cimr_date_debut?: string; cimr_date_fin?: string;
  num_amo?: string; amo_date_debut?: string; amo_date_fin?: string;
}

interface AncienContrat {
  id: string;
  code_type_contrat?: string;
  date_debut?: string;
  date_fin?: string;
  code_statut_contrat?: string;
  reference_contrat?: string;
}

/* ─── Modal sélection de contrat ─── */
const ContratPickerModal: React.FC<{
  collab: AncienCollab;
  contrats: AncienContrat[];
  onSelect: (contrat: AncienContrat) => void;
  onClose: () => void;
}> = ({ collab, contrats, onSelect, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
    <div className="rounded-2xl border shadow-xl w-full max-w-lg mx-4 p-6" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>
            Choisir le contrat de référence
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {collab.civilite} {collab.nom} {collab.prenom} — {collab.matricule}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-red-50 transition-all" style={{ color: "hsl(var(--muted-foreground))" }}>
          <X size={16} />
        </button>
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {contrats.map(ct => (
          <button
            key={ct.id}
            onClick={() => onSelect(ct)}
            className="w-full text-left px-4 py-3 rounded-xl border transition-all hover:border-accent"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                {ct.code_type_contrat || "—"}{ct.reference_contrat ? ` · ${ct.reference_contrat}` : ""}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{
                background: ["ACTIF","EN_COURS"].includes(ct.code_statut_contrat || "") ? "hsl(142 70% 45% / 0.15)" : "hsl(var(--muted))",
                color: ["ACTIF","EN_COURS"].includes(ct.code_statut_contrat || "") ? "hsl(142 70% 35%)" : "hsl(var(--muted-foreground))"
              }}>
                {ct.code_statut_contrat || "—"}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              Début : {ct.date_debut ? new Date(ct.date_debut).toLocaleDateString("fr-FR") : "—"}
              {ct.date_fin ? ` → ${new Date(ct.date_fin).toLocaleDateString("fr-FR")}` : " → en cours"}
            </p>
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-4 w-full py-2 rounded-xl border text-sm" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
        Annuler
      </button>
    </div>
  </div>
);

/* ─── Contenu des étapes ─── */
const StepCivil: React.FC<{
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
  errors: Record<string, string>;
  onLookupAncienMatricule: (matricule: string) => void;
  lookingUp: boolean;
  /* nouveau */
  collabsSortis: AncienCollab[];
  loadingCollabsSortis: boolean;
  ancienCollabSelectionne: AncienCollab | null;
}> = ({ form, onChange, errors, onLookupAncienMatricule, lookingUp, collabsSortis, loadingCollabsSortis, ancienCollabSelectionne }) => {

  const CIVILITE_OPTIONS = [
    { value: "M.", label: "M." }, { value: "Mme", label: "Mme" },
    { value: "Dr.", label: "Dr." }, { value: "Pr.", label: "Pr." }, { value: "Me.", label: "Me." },
  ];


  const STATUT_OPTIONS = [
    { value: "ACTIF", label: "Actif" }, { value: "INACTIF", label: "Inactif" }, { value: "SUSPENDU", label: "Suspendu" },
  ];

  return (
    <div className="space-y-5">
      {/* Matricules + Statut */}
      <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
        <FInput label="Matricule" name="matricule" value={form.matricule} required onChange={onChange} placeholder="001234" />
      {/* Ancien matricule — double mode : texte libre + liste déroulante */}
        <div className="col-span-2">
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Ancien matricule
          </label>

          {/* Bandeau de confirmation si un ancien collab est sélectionné */}
          {ancienCollabSelectionne && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: "hsl(142 70% 45% / 0.1)", color: "hsl(142 70% 35%)", border: "1px solid hsl(142 70% 45% / 0.3)" }}>
              <UserCheck size={13} />
              Dossier récupéré : {ancienCollabSelectionne.civilite} {ancienCollabSelectionne.nom} {ancienCollabSelectionne.prenom} ({ancienCollabSelectionne.matricule})
            </div>
          )}

          {/* Mode 1 : texte libre + bouton Récupérer */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={form.ancien_matricule}
              onChange={e => onChange("ancien_matricule", e.target.value)}
              placeholder="Saisir l'ancien matricule..."
              className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none transition-all focus:ring-2"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", height: 40 }}
            />
            <button
              type="button"
              onClick={() => form.ancien_matricule && onLookupAncienMatricule(form.ancien_matricule)}
              disabled={!form.ancien_matricule || lookingUp}
              title="Récupérer les infos de l'ancien dossier"
              className="px-3 py-2 rounded-lg border text-sm flex items-center gap-1.5 font-medium transition-all disabled:opacity-40"
              style={{ borderColor: "hsl(var(--accent) / 0.5)", color: "hsl(var(--accent))", background: "hsl(var(--accent) / 0.08)" }}
            >
              <Search size={13} className={lookingUp ? "animate-spin" : ""} />
              {lookingUp ? "..." : "Récupérer"}
            </button>
          </div>

          {/* Mode 2 : liste déroulante des collaborateurs sortis */}
          <div className="relative">
            <select
              value=""
              onChange={e => { if (e.target.value) onLookupAncienMatricule(e.target.value); }}
              disabled={loadingCollabsSortis}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none appearance-none"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--muted-foreground))", height: 40 }}
            >
              <option value="">
                {loadingCollabsSortis ? "Chargement..." : `— Ou sélectionner dans les collaborateurs sortis (${collabsSortis.length}) —`}
              </option>
              {collabsSortis.map(c => (
                <option key={c.id} value={c.matricule}>
                  {c.matricule} — {c.nom} {c.prenom}{c.date_naissance ? ` (${new Date(c.date_naissance).toLocaleDateString("fr-FR")})` : ""}
                </option>
              ))}
            </select>
            <RefreshCw size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "hsl(var(--muted-foreground))" }} />
          </div>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Saisir l'ancien matricule ou sélectionner dans la liste — le dossier sera pré-rempli
          </p>
        </div>
        <FRefSelect
          label="Statut" name="statut_collaborateur" value={form.statut_collaborateur}
          table="" required onChange={onChange}
          staticOptions={STATUT_OPTIONS}
        />
      </div>
      {errors.matricule && <p className="text-xs" style={{ color: "hsl(0 84% 55%)" }}>{errors.matricule}</p>}

      {/* Identité */}
      <div className="rounded-xl p-4 border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--accent))" }}>Identité</p>
        {/* Ligne civilité + nom + prénom avec proportions différentes */}
        <div className="grid grid-cols-8 gap-4 mb-4">
          <FRefSelect
            label="Civilité" name="civilite" value={form.civilite} required onChange={onChange}
            className="col-span-1"
            table=""
            staticOptions={CIVILITE_OPTIONS}
            placeholder="—"
          />
          <FInput label="Nom" name="nom" value={form.nom} required onChange={onChange} placeholder="Nom de famille" className="col-span-3" />
          <FInput label="Prénom" name="prenom" value={form.prenom} required onChange={onChange} placeholder="Prénom" className="col-span-2" />
          <FInput label="Nom de jeune fille" name="nom_jeune_fille" value={form.nom_jeune_fille} onChange={onChange} className="col-span-2" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <FRefSelect
            label="Genre" name="code_genre" value={form.code_genre} required onChange={onChange}
            table="ref_genre"
          />
          <div>
            <FInput label="Date de naissance" name="date_naissance" value={form.date_naissance} required type="date" onChange={onChange} />
            {errors.date_naissance && <p className="text-xs mt-1" style={{ color: "hsl(0 84% 55%)" }}>{errors.date_naissance}</p>}
          </div>
          <FInput label="Lieu de naissance" name="lieu_naissance" value={form.lieu_naissance} onChange={onChange} />
          <div />{/* spacer */}
          <FRefSelect
            label="Nationalité" name="code_nationalite" value={form.code_nationalite}
            table="ref_nationalite" onChange={onChange}
            placeholder="— Sélectionner —"
          />
          <FRefSelect
            label="Nationalité 2" name="code_nationalite2" value={form.code_nationalite2}
            table="ref_nationalite" onChange={onChange}
            placeholder="— Sélectionner —"
          />
        </div>
      </div>
    </div>
  );
};

const StepCoordonnees: React.FC<{ form: FormData; onChange: (k: keyof FormData, v: string) => void }> = ({ form, onChange }) => (
  <div className="rounded-xl p-4 border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
    <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--accent))" }}>Coordonnées</p>
    <div className="grid grid-cols-2 gap-4">
      <FInput label="Téléphone fixe" name="telephone" value={form.telephone} type="tel" onChange={onChange} placeholder="+212 5XX XXX XXX" />
      <FInput label="GSM / Mobile" name="gsm" value={form.gsm} type="tel" onChange={onChange} placeholder="+212 6XX XXX XXX" />
      <FInput label="Email personnel" name="email_personnel" value={form.email_personnel} type="email" onChange={onChange} placeholder="prenom.nom@gmail.com" />
      <FInput label="Email professionnel" name="email_professionnel" value={form.email_professionnel} type="email" onChange={onChange} placeholder="prenom.nom@entreprise.com" />
    </div>
  </div>
);

const StepDocuments: React.FC<{ form: FormData; onChange: (k: keyof FormData, v: string) => void }> = ({ form, onChange }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <DocGroup title="CIN" numKey="cin" debutKey="cin_date_debut" finKey="cin_date_fin" values={form} onChange={onChange} />
      <DocGroup title="Passeport" numKey="passeport" debutKey="passeport_date_debut" finKey="passeport_date_fin" values={form} onChange={onChange} />
      <DocGroup title="Identifiant fiscal" numKey="num_fiscal" debutKey="fiscal_date_debut" finKey="fiscal_date_fin" values={form} onChange={onChange} />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <DocGroup title="CNSS" numKey="num_cnss" debutKey="cnss_date_debut" finKey="cnss_date_fin" values={form} onChange={onChange} />
      <DocGroup title="CIMR" numKey="num_cimr" debutKey="cimr_date_debut" finKey="cimr_date_fin" values={form} onChange={onChange} />
      <DocGroup title="AMO" numKey="num_amo" debutKey="amo_date_debut" finKey="amo_date_fin" values={form} onChange={onChange} />
    </div>
  </div>
);

const StepContrat: React.FC<{ form: FormData; onChange: (k: keyof FormData, v: string) => void; societes: { id: string; raison_sociale: string }[]; errors: Record<string, string>; showDuree: boolean; dateFinCalculee: string }> = ({ form, onChange, societes, errors, showDuree, dateFinCalculee }) => (
  <div className="space-y-4">
    {/* Société obligatoire */}
    <div className="rounded-xl p-4 border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
      <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--accent))" }}>Rattachement société</p>
      {societes.length <= 1 ? (
        <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
          {societes.length === 1 ? `Société : ${societes[0].raison_sociale}` : "Aucune société configurée"}
        </p>
      ) : (
        <RefSelect
          table=""
          staticOptions={societes.map(s => ({ value: s.id, label: s.raison_sociale }))}
          value={form.societe_id}
          onChange={v => onChange("societe_id", v)}
          label="Société"
          required
          placeholder="— Sélectionner une société —"
        />
      )}
      {errors.societe_id && <p className="text-xs mt-1" style={{ color: "hsl(0 84% 55%)" }}>{errors.societe_id}</p>}
    </div>

    <div className="rounded-xl p-1 mb-2 text-sm" style={{ background: "hsl(var(--accent) / 0.08)", color: "hsl(var(--accent))", borderRadius: 8, padding: "8px 12px" }}>
      ⚠️ Le contrat est obligatoire — type de contrat et date de début à minima.
    </div>
    <div className="rounded-xl p-4 border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
      <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--accent))" }}>Contrat initial</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* FK → ref_type_contrat */}
        <RefSelect
          table="ref_type_contrat"
          value={form.code_type_contrat}
          onChange={v => onChange("code_type_contrat", v)}
          label="Type de contrat"
          placeholder="— Type —"
        />
        {/* Statut contrat — valeurs fixes */}
        <RefSelect
          table=""
          staticOptions={[
            { value: "ACTIF", label: "Actif" },
            { value: "TERMINE", label: "Terminé" },
            { value: "SUSPENDU", label: "Suspendu" },
          ]}
          value={form.code_statut_contrat}
          onChange={v => onChange("code_statut_contrat", v)}
          label="Statut contrat"
        />
        <FInput label="Référence contrat" name="reference_contrat" value={form.reference_contrat} onChange={onChange} placeholder="Réf." />
        <div>
          <FInput label="Date début contrat" name="date_debut_contrat" value={form.date_debut_contrat} type="date" required onChange={onChange} />
          {errors.date_debut_contrat && <p className="text-xs mt-1" style={{ color: "hsl(0 84% 55%)" }}>{errors.date_debut_contrat}</p>}
        </div>
        {showDuree && (
          <>
            <FInput label="Durée" name="duree_contrat" value={form.duree_contrat} type="number" onChange={onChange} placeholder="Ex: 12" required />
            <RefSelect
              table="ref_unite_duree_contrat"
              value={form.code_unite_duree}
              onChange={v => onChange("code_unite_duree", v)}
              label="Unité"
              placeholder="— Unité —"
              required
            />
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Date de fin (calculée)
              </label>
              <input
                type="date"
                value={dateFinCalculee}
                readOnly
                disabled
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--muted-foreground))", height: 40 }}
              />
            </div>
          </>
        )}
        {/* FK → ref_motif_recrutement */}
        <RefSelect
          table="ref_motif_recrutement"
          value={form.code_motif_recrutement}
          onChange={v => onChange("code_motif_recrutement", v)}
          label="Motif de recrutement"
          placeholder="— Motif —"
        />
        {/* FK → ref_source_recrutement */}
        <RefSelect
          table="ref_source_recrutement"
          value={form.code_source_recrutement}
          onChange={v => onChange("code_source_recrutement", v)}
          label="Source de recrutement"
          placeholder="— Source —"
        />
      </div>
    </div>

    <div className="rounded-xl p-4 border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
      <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--accent))" }}>Rémunération de départ</p>
      <div className="grid grid-cols-2 gap-4">
        <FInput label="Salaire de base (MAD)" name="salaire_base" value={form.salaire_base} type="number" onChange={onChange} placeholder="0.00" />
      </div>
    </div>
  </div>
);

/* ─── Page principale ─── */
const NouveauCollaborateur: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lookingUp, setLookingUp] = useState(false);
  const [societes, setSocietes] = useState<{ id: string; raison_sociale: string }[]>([]);
  const [typeContratRules, setTypeContratRules] = useState<Record<string, {
    duree_requise: boolean;
    duree_defaut_valeur: number | null;
    code_unite_duree_defaut: string | null;
  }>>({});
  const [ageMiniTravail, setAgeMiniTravail] = useState<number>(16); // valeur par défaut
  const [collabsSortis, setCollabsSortis] = useState<AncienCollab[]>([]);
  const [loadingCollabsSortis, setLoadingCollabsSortis] = useState(false);
  const [ancienCollabSelectionne, setAncienCollabSelectionne] = useState<AncienCollab | null>(null);
  const [contratPickerData, setContratPickerData] = useState<{ collab: AncienCollab; contrats: AncienContrat[] } | null>(null);

  // Charger sociétés actives + règles par type de contrat + paramètre AGE_MINIMUM_TRAVAIL
  useEffect(() => {
    let cancelled = false;
    // Charger les collaborateurs sortis en parallèle
    setLoadingCollabsSortis(true);
    api.get("/db/collaborateurs?statut_collaborateur=eq.SORTI&order=nom&select=id,matricule,nom,prenom,date_naissance,civilite,nom_jeune_fille,code_genre,lieu_naissance,code_nationalite,code_nationalite2,telephone,gsm,email_personnel,email_professionnel,cin,cin_date_debut,cin_date_fin,passeport,passeport_date_debut,passeport_date_fin,num_fiscal,fiscal_date_debut,fiscal_date_fin,num_cnss,cnss_date_debut,cnss_date_fin,num_cimr,cimr_date_debut,cimr_date_fin,num_amo,amo_date_debut,amo_date_fin")
      .then((data: AncienCollab[]) => { if (!cancelled) setCollabsSortis(data || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCollabsSortis(false); });

    (async () => {
      try {
        const [societesData, typesContrats, parametres] = await Promise.all([
          db.list<any>("societes", { actif: true, order: "raison_sociale" }),
          db.list<any>("ref_type_contrat"),
          db.list<any>("parametres_rh", { code: "AGE_MINIMUM_TRAVAIL", actif: true }),
        ]);
        if (!cancelled && parametres?.length) {
          setAgeMiniTravail(parseInt(parametres[0].valeur, 10) || 16);
        }
        if (cancelled) return;
        setSocietes(societesData || []);
        if ((societesData || []).length === 1) {
          setForm(f => ({ ...f, societe_id: societesData[0].id }));
        }
        const rulesMap: Record<string, any> = {};
        (typesContrats || []).forEach((r: any) => {
          rulesMap[r.code] = {
            duree_requise: !!r.duree_requise,
            duree_defaut_valeur: r.duree_defaut_valeur ?? null,
            code_unite_duree_defaut: r.code_unite_duree_defaut ?? null,
          };
        });
        setTypeContratRules(rulesMap);
      } catch (e: any) {
        console.error("Erreur chargement initial:", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-fill durée/unité au changement du type (uniquement si vide)
  useEffect(() => {
    if (!form.code_type_contrat) return;
    const rule = typeContratRules[form.code_type_contrat];
    if (!rule) return;
    setForm(f => {
      const next = { ...f };
      if (rule.duree_requise) {
        if (!f.duree_contrat && rule.duree_defaut_valeur != null) {
          next.duree_contrat = String(rule.duree_defaut_valeur);
        }
        if (!f.code_unite_duree && rule.code_unite_duree_defaut) {
          next.code_unite_duree = rule.code_unite_duree_defaut;
        }
      } else {
        next.duree_contrat = "";
        next.code_unite_duree = "";
      }
      return next;
    });
  }, [form.code_type_contrat, typeContratRules]);

  // Helpers dérivés
  const currentRule = typeContratRules[form.code_type_contrat];
  const showDuree = currentRule ? currentRule.duree_requise : false;

  // Date de fin calculée auto (date_debut + durée × unité - 1j)
  const dateFinCalculee = React.useMemo(() => {
    if (!showDuree || !form.date_debut_contrat || !form.duree_contrat || !form.code_unite_duree) return "";
    const n = parseInt(form.duree_contrat);
    if (!n || n <= 0) return "";
    const d = new Date(form.date_debut_contrat);
    if (isNaN(d.getTime())) return "";
    switch (form.code_unite_duree) {
      case "J": d.setDate(d.getDate() + n); break;
      case "M": d.setMonth(d.getMonth() + n); break;
      case "A": case "AN": d.setFullYear(d.getFullYear() + n); break;
      default: return "";
    }
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }, [showDuree, form.date_debut_contrat, form.duree_contrat, form.code_unite_duree]);

  const onChange = (key: keyof FormData, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const validateStep = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Utilitaire : ajoute `ageMiniTravail` ans à une date
    const addYears = (dateStr: string, years: number): Date => {
      const d = new Date(dateStr);
      d.setFullYear(d.getFullYear() + years);
      return d;
    };

    if (step === 0) {
      if (!form.matricule.trim()) newErrors.matricule = "Le matricule est obligatoire";
      if (!form.nom.trim()) newErrors.nom = "Le nom est obligatoire";
      if (!form.prenom.trim()) newErrors.prenom = "Le prénom est obligatoire";
      if (!form.date_naissance) {
        newErrors.date_naissance = "La date de naissance est obligatoire";
      } else {
        // RG-COLLAB-AGE-01 : DTN + AGE_MINIMUM_TRAVAIL <= Date système
        const dateMinEmbauche = addYears(form.date_naissance, ageMiniTravail);
        if (dateMinEmbauche > new Date()) {
          newErrors.date_naissance = `Le collaborateur doit avoir au moins ${ageMiniTravail} ans (né(e) avant le ${dateMinEmbauche.toLocaleDateString("fr-FR")})`;
        }
      }
    }
    if (step === 3) {
      // Société obligatoire
      const effectiveSocieteId = societes.length === 1 ? societes[0].id : form.societe_id;
      if (!effectiveSocieteId) newErrors.societe_id = "La société est obligatoire";
      // Contrat obligatoire
      if (!form.code_type_contrat) newErrors.code_type_contrat = "Le type de contrat est obligatoire";
      if (!form.date_debut_contrat) {
        newErrors.date_debut_contrat = "La date de début est obligatoire";
      } else if (form.date_naissance) {
        // RG-COLLAB-AGE-02 : DTN + AGE_MINIMUM_TRAVAIL <= DTC
        const addYears = (dateStr: string, years: number): Date => {
          const d = new Date(dateStr); d.setFullYear(d.getFullYear() + years); return d;
        };
        const dateMinEmbauche = addYears(form.date_naissance, ageMiniTravail);
        if (new Date(form.date_debut_contrat) < dateMinEmbauche) {
          newErrors.date_debut_contrat = `La date de début du contrat doit être après le ${dateMinEmbauche.toLocaleDateString("fr-FR")} (DTN + ${ageMiniTravail} ans)`;
        }
      }
      if (showDuree) {
        if (!form.duree_contrat || parseInt(form.duree_contrat) <= 0) {
          newErrors.duree_contrat = "La durée est obligatoire pour ce type de contrat";
        }
        if (!form.code_unite_duree) {
          newErrors.code_unite_duree = "L'unité de durée est obligatoire";
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep()) setStep(s => s + 1);
  };

  /* Applique les données d'un ancien collaborateur + contrat sélectionné au formulaire */
  const applyAncienCollab = (data: AncienCollab) => {
    setAncienCollabSelectionne(data);
    setForm(f => ({
      ...f,
      ancien_matricule: data.matricule,
      civilite: data.civilite || f.civilite,
      nom: data.nom || f.nom,
      prenom: data.prenom || f.prenom,
      nom_jeune_fille: data.nom_jeune_fille || f.nom_jeune_fille,
      code_genre: data.code_genre || f.code_genre,
      date_naissance: data.date_naissance || f.date_naissance,
      lieu_naissance: data.lieu_naissance || f.lieu_naissance,
      code_nationalite: data.code_nationalite || f.code_nationalite,
      code_nationalite2: data.code_nationalite2 || f.code_nationalite2,
      telephone: data.telephone || f.telephone,
      gsm: data.gsm || f.gsm,
      email_personnel: data.email_personnel || f.email_personnel,
      email_professionnel: data.email_professionnel || f.email_professionnel,
      cin: data.cin || f.cin,
      cin_date_debut: data.cin_date_debut || f.cin_date_debut,
      cin_date_fin: data.cin_date_fin || f.cin_date_fin,
      passeport: data.passeport || f.passeport,
      passeport_date_debut: data.passeport_date_debut || f.passeport_date_debut,
      passeport_date_fin: data.passeport_date_fin || f.passeport_date_fin,
      num_fiscal: data.num_fiscal || f.num_fiscal,
      fiscal_date_debut: data.fiscal_date_debut || f.fiscal_date_debut,
      fiscal_date_fin: data.fiscal_date_fin || f.fiscal_date_fin,
      num_cnss: data.num_cnss || f.num_cnss,
      cnss_date_debut: data.cnss_date_debut || f.cnss_date_debut,
      cnss_date_fin: data.cnss_date_fin || f.cnss_date_fin,
      num_cimr: data.num_cimr || f.num_cimr,
      cimr_date_debut: data.cimr_date_debut || f.cimr_date_debut,
      cimr_date_fin: data.cimr_date_fin || f.cimr_date_fin,
      num_amo: data.num_amo || f.num_amo,
      amo_date_debut: data.amo_date_debut || f.amo_date_debut,
      amo_date_fin: data.amo_date_fin || f.amo_date_fin,
    }));
    setErrors({});
  };

  /* Lookup ancien matricule → charge les contrats → picker si plusieurs */
  const handleLookupAncienMatricule = async (matricule: string) => {
    setLookingUp(true);
    setErrors(e => { const n = { ...e }; delete n.ancien_matricule_lookup; return n; });
    try {
      // 1) Trouver le collaborateur par son matricule (archive=true, statut=SORTI)
      let collabData: AncienCollab | null = null;
      try {
        const results: AncienCollab[] = await api.get(
          `/db/collaborateurs?matricule=eq.${encodeURIComponent(matricule)}&statut_collaborateur=eq.SORTI&select=id,matricule,nom,prenom,date_naissance,civilite,nom_jeune_fille,code_genre,lieu_naissance,code_nationalite,code_nationalite2,telephone,gsm,email_personnel,email_professionnel,cin,cin_date_debut,cin_date_fin,passeport,passeport_date_debut,passeport_date_fin,num_fiscal,fiscal_date_debut,fiscal_date_fin,num_cnss,cnss_date_debut,cnss_date_fin,num_cimr,cimr_date_debut,cimr_date_fin,num_amo,amo_date_debut,amo_date_fin&limit=1`
        );
        collabData = results?.[0] ?? null;
      } catch (err: any) {
        setErrors(e => ({ ...e, ancien_matricule_lookup: `Erreur de recherche : ${err?.message || err}` }));
        setLookingUp(false);
        return;
      }

      if (!collabData) {
        setErrors(e => ({ ...e, ancien_matricule_lookup: `Aucun collaborateur sorti trouvé avec le matricule "${matricule}"` }));
        setLookingUp(false);
        return;
      }

      // 2) Charger les contrats de cet ancien collaborateur
      let contrats: AncienContrat[] = [];
      try {
        contrats = await api.get(
          `/db/collaborateur_contrats?collaborateur_id=eq.${collabData.id}&order=date_debut.desc&select=id,code_type_contrat,date_debut,date_fin,code_statut_contrat,reference_contrat`
        ) || [];
      } catch { /* on continue sans contrats */ }

      if (contrats.length === 0) {
        // Pas de contrat → pré-remplissage direct sans sélection
        applyAncienCollab(collabData);
      } else if (contrats.length === 1) {
        // Un seul contrat → sélection automatique
        applyAncienCollab(collabData);
      } else {
        // Plusieurs contrats → afficher le picker
        setContratPickerData({ collab: collabData, contrats });
      }
    } catch (e: any) {
      setErrors(err => ({ ...err, ancien_matricule_lookup: `Erreur : ${e?.message || e}` }));
    }
    setLookingUp(false);
  };

  const handleSave = async () => {
    if (!validateStep()) return;
    setSaving(true);
    try {
      // 1) Créer le collaborateur
      const collabPayload: any = {
        matricule: form.matricule,
        ancien_matricule: form.ancien_matricule || null,
        civilite: form.civilite || null,
        nom: form.nom,
        prenom: form.prenom,
        nom_jeune_fille: form.nom_jeune_fille || null,
        code_genre: form.code_genre || null,
        date_naissance: form.date_naissance || null,
        lieu_naissance: form.lieu_naissance || null,
        code_nationalite: form.code_nationalite || null,
        code_nationalite2: form.code_nationalite2 || null,
        statut_collaborateur: form.statut_collaborateur || "ACTIF",
        telephone: form.telephone || null,
        gsm: form.gsm || null,
        email_personnel: form.email_personnel || null,
        email_professionnel: form.email_professionnel || null,
        cin: form.cin || null,
        cin_date_debut: form.cin_date_debut || null,
        cin_date_fin: form.cin_date_fin || null,
        passeport: form.passeport || null,
        passeport_date_debut: form.passeport_date_debut || null,
        passeport_date_fin: form.passeport_date_fin || null,
        num_fiscal: form.num_fiscal || null,
        fiscal_date_debut: form.fiscal_date_debut || null,
        fiscal_date_fin: form.fiscal_date_fin || null,
        num_cnss: form.num_cnss || null,
        cnss_date_debut: form.cnss_date_debut || null,
        cnss_date_fin: form.cnss_date_fin || null,
        num_cimr: form.num_cimr || null,
        cimr_date_debut: form.cimr_date_debut || null,
        cimr_date_fin: form.cimr_date_fin || null,
        num_amo: form.num_amo || null,
        amo_date_debut: form.amo_date_debut || null,
        amo_date_fin: form.amo_date_fin || null,
        archive: false,
      };

      let collabId: string | null = null;
      try {
        const inserted: any = await db.create("collaborateurs", collabPayload);
        collabId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      } catch (err: any) {
        const msg = err?.message || err?.detail || String(err);
        if (msg.includes("unique") || msg.includes("duplicate")) {
          setErrors({ matricule: "Ce matricule existe déjà" });
          setStep(0);
        } else {
          alert("Erreur lors de la création : " + msg);
        }
        setSaving(false);
        return;
      }

      if (!collabId) {
        alert("Erreur : impossible de récupérer l'identifiant du collaborateur créé");
        setSaving(false);
        return;
      }

      const effectiveSocieteId = societes.length === 1 ? societes[0].id : form.societe_id;

      // 2) Créer le contrat — OBLIGATOIRE désormais
      try {
        await db.create("collaborateur_contrats", {
          collaborateur_id: collabId,
          code_type_contrat: form.code_type_contrat,
          date_debut: form.date_debut_contrat,
          // date_fin calculée auto (sauf CDI où showDuree=false → "")
          date_fin: dateFinCalculee || null,
          duree_contrat: form.duree_contrat ? parseInt(form.duree_contrat) : null,
          code_unite_duree: form.code_unite_duree || null,
          code_statut_contrat: form.code_statut_contrat || "ACTIF",
          reference_contrat: form.reference_contrat || null,
          code_motif_recrutement: form.code_motif_recrutement || null,
          code_source_recrutement: form.code_source_recrutement || null,
          societe_id: effectiveSocieteId || null,
        });
      } catch (err: any) {
        // Rollback : supprimer le collaborateur si le contrat échoue
        try { await db.remove("collaborateurs", { id: collabId }); } catch { /* ignoré */ }
        alert("Erreur lors de la création du contrat : " + (err?.message || err));
        setSaving(false);
        return;
      }

      // 3) Créer le salaire de base si renseigné
      if (form.salaire_base && form.date_debut_contrat) {
        try {
          await db.create("collaborateur_salaires_fixes", {
            collaborateur_id: collabId,
            salaire_base: parseFloat(form.salaire_base),
            date_debut: form.date_debut_contrat,
          });
        } catch (err) {
          console.error("Erreur salaire de base:", err);
        }
      }

      navigate(`/collaborateurs/${collabId}`);
    } catch (err: any) {
      console.error("Détail erreur création:", err);
      alert("ERREUR: " + (err?.message || err?.detail || JSON.stringify(err)));
      setSaving(false);
    }
  };

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => navigate("/collaborateurs")} className="flex items-center gap-1.5 text-sm mb-5 hover:underline" style={{ color: "hsl(var(--accent))" }}>
        <ArrowLeft size={15} /> Retour à la liste
      </button>

      <div className="mb-6">
        <h1 className="text-xl font-bold mb-1" style={{ color: "hsl(var(--foreground))" }}>Nouveau collaborateur</h1>
        <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Renseignez les informations de base du collaborateur</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
        {STEPS.map((s, i) => {
          const isDone = i < step;
          const isActive = i === step;
          return (
            <React.Fragment key={s.id}>
              <button
                onClick={() => { if (i < step) setStep(i); }}
                disabled={i > step}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap"
                style={{
                  background: isActive ? "hsl(var(--accent) / 0.12)" : isDone ? "hsl(84 55% 50% / 0.1)" : "transparent",
                  color: isActive ? "hsl(var(--accent))" : isDone ? "hsl(84 55% 40%)" : "hsl(var(--muted-foreground))",
                  cursor: i < step ? "pointer" : i === step ? "default" : "not-allowed",
                }}
              >
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: isActive ? "hsl(var(--accent))" : isDone ? "hsl(84 55% 50%)" : "hsl(var(--border))",
                    color: isActive || isDone ? "white" : "hsl(var(--muted-foreground))",
                  }}
                >
                  {isDone ? <Check size={12} /> : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && (
                <ChevronRight size={16} className="flex-shrink-0 mx-1" style={{ color: "hsl(var(--border))" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Barre de progression */}
      <div className="w-full h-1.5 rounded-full mb-6" style={{ background: "hsl(var(--border))" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, background: "hsl(var(--accent))" }}
        />
      </div>

      {/* Contenu de l'étape */}
      <div
        className="rounded-2xl border p-6 mb-6"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="flex items-center gap-2 mb-5 pb-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <span style={{ color: "hsl(var(--accent))" }}>{STEPS[step].icon}</span>
          <h2 className="text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>{STEPS[step].label}</h2>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
            Étape {step + 1} / {STEPS.length}
          </span>
        </div>

        {Object.keys(errors).filter(k => k !== "ancien_matricule_lookup").length > 0 && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)", border: "1px solid hsl(0 84% 55% / 0.3)" }}>
            Veuillez corriger les champs obligatoires marqués en rouge.
          </div>
        )}
        {errors.ancien_matricule_lookup && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm" style={{ background: "hsl(35 90% 50% / 0.1)", color: "hsl(35 90% 40%)", border: "1px solid hsl(35 90% 50% / 0.3)" }}>
            ⚠️ {errors.ancien_matricule_lookup}
          </div>
        )}

        {step === 0 && <StepCivil
          form={form}
          onChange={onChange}
          errors={errors}
          onLookupAncienMatricule={handleLookupAncienMatricule}
          lookingUp={lookingUp}
          collabsSortis={collabsSortis}
          loadingCollabsSortis={loadingCollabsSortis}
          ancienCollabSelectionne={ancienCollabSelectionne}
        />}
        {step === 1 && <StepCoordonnees form={form} onChange={onChange} />}
        {step === 2 && <StepDocuments form={form} onChange={onChange} />}
        {step === 3 && <StepContrat form={form} onChange={onChange} societes={societes} errors={errors} showDuree={showDuree} dateFinCalculee={dateFinCalculee} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => step === 0 ? navigate("/collaborateurs") : setStep(s => s - 1)}
          className="flex items-center gap-2"
        >
          <ArrowLeft size={15} />
          {step === 0 ? "Annuler" : "Précédent"}
        </Button>

        <div className="flex gap-3">
          {step < STEPS.length - 1 ? (
            <Button
              onClick={handleNext}
              className="flex items-center gap-2"
              style={{ background: "hsl(var(--accent))", color: "white" }}
            >
              Suivant <ArrowRight size={15} />
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => navigate("/collaborateurs")}>
                Annuler
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2"
                style={{ background: "hsl(var(--accent))", color: "white" }}
              >
                {saving ? (
                  <><div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> Création...</>
                ) : (
                  <><Save size={15} /> Créer le collaborateur</>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
      {/* Modal sélection contrat (plusieurs contrats détectés) */}
      {contratPickerData && (
        <ContratPickerModal
          collab={contratPickerData.collab}
          contrats={contratPickerData.contrats}
          onSelect={() => {
            applyAncienCollab(contratPickerData.collab);
            setContratPickerData(null);
          }}
          onClose={() => setContratPickerData(null)}
        />
      )}
    </div>
  );
};

export default NouveauCollaborateur;
