import React, { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, User, FileText, Briefcase, Users, CreditCard,
  GraduationCap, Settings, Save, Plus, Pencil, Trash2,
  Phone, Mail, MapPin, Shield, AlertCircle, Award, Heart,
  Building2, Calendar, Hash, X, Check, Camera, DoorOpen,
  Users as UsersIcon, Plane, Clock, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import RefSelect from "@/components/RefSelect";
import ConjointForm from "@/components/famille/ConjointForm";
import EnfantForm from "@/components/famille/EnfantForm";
import ContactUrgenceForm from "@/components/famille/ContactUrgenceForm";
import ContratForm from "@/components/contrat/ContratForm";
import AffectationForm from "@/components/affectation/AffectationForm";
import RepartitionCentreCoutForm from "@/components/affectation/RepartitionCentreCoutForm";
import WorkflowManagerForm from "@/components/affectation/WorkflowManagerForm";
import DepartForm from "@/components/depart/DepartForm";
import SyndicalMandatForm from "@/components/syndical/SyndicalMandatForm";
import PaiementForm from "@/components/paiement/PaiementForm";
import DiplomeForm from "@/components/formation/DiplomeForm";
import CompetenceForm from "@/components/formation/CompetenceForm";
import ClassificationForm from "@/components/affectation/ClassificationForm";
import SalaireFixeForm from "@/components/remuneration/SalaireFixeForm";
import AvantageForm from "@/components/remuneration/AvantageForm";
import CollaborateurPlanPaieForm from "@/components/remuneration/CollaborateurPlanPaieForm";
import TabAdresses from "@/components/collaborateur/TabAdresses";

import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useChainCollaborateurIds } from "@/hooks/useChainCollaborateurIds";
import { useFormatMasks, fmtDate } from "@/hooks/useFormatMasks";
import { useListNavigationContext } from "@/hooks/useListNavigationContext";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";

/* ──────────────── Types ──────────────── */
interface Collaborateur {
  id: string; matricule: string; ancien_matricule?: string; civilite?: string;
  nom: string; prenom: string; nom_jeune_fille?: string;
  date_naissance: string; lieu_naissance?: string;
  // RG-COLLAB-SITFAM-01 (Adil DAIA) : situation matrimoniale + date de début
  code_situation_familiale?: string;
  date_situation_familiale?: string;
  code_nationalite?: string; code_nationalite2?: string;
  code_genre: string;
  cin?: string; cin_date_debut?: string; cin_date_fin?: string;
  passeport?: string; passeport_date_debut?: string; passeport_date_fin?: string;
  num_cnss?: string; cnss_date_debut?: string; cnss_date_fin?: string;
  num_cimr?: string; cimr_date_debut?: string; cimr_date_fin?: string;
  num_amo?: string; amo_date_debut?: string; amo_date_fin?: string;
  num_fiscal?: string; fiscal_date_debut?: string; fiscal_date_fin?: string;
  telephone?: string; gsm?: string;
  email_personnel?: string; email_professionnel?: string;
  statut_collaborateur: string; photo_path?: string;
  created_at: string; updated_at: string; archive: boolean;
}

/* ──────────────── Onglets ──────────────── */
const TABS = [
  { id: "identite",       label: "Identité",      icon: <User size={15} /> },
  { id: "contrats",       label: "Contrats",       icon: <Briefcase size={15} /> },
  { id: "affectation",    label: "Affectation & Classification",    icon: <Building2 size={15} /> },
  { id: "adresses",       label: "Adresses",       icon: <MapPin size={15} /> },
  
  { id: "famille",        label: "Famille",        icon: <Heart size={15} /> },
  { id: "remuneration",   label: "Rémunération",   icon: <CreditCard size={15} /> },
  { id: "formation",      label: "Formation & Compétences", icon: <GraduationCap size={15} /> },
  { id: "immatriculation",label: "Immatriculat°",  icon: <Shield size={15} /> },
  { id: "syndical",       label: "Syndical",       icon: <Users size={15} /> },
  { id: "divers",         label: "Divers",         icon: <Settings size={15} /> },
];

// Couleur dédiée par onglet pour le badge de comptage (teinte + fond clair assorti)
const TAB_BADGE_COLORS: Record<string, string> = {
  identite:        "217 91% 55%",  // bleu
  contrats:        "262 83% 58%",  // violet
  affectation:     "199 89% 48%",  // cyan
  adresses:        "25 95% 53%",   // orange
  famille:         "340 82% 52%",  // rose
  remuneration:    "142 71% 40%",  // vert
  formation:       "271 76% 53%",  // indigo
  immatriculation: "38 92% 45%",   // ambre
  syndical:        "199 60% 40%",  // bleu ardoise
  divers:          "220 9% 46%",   // gris
};

/* ──────────────── Helpers ──────────────── */
const Field: React.FC<{ label: string; value?: string | null; className?: string }> = ({ label, value, className }) => (
  <div className={className}>
    <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
    <p className="text-sm font-medium" style={{ color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.5)" }}>
      {value || "—"}
    </p>
  </div>
);

const SectionCard: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }> = ({ title, icon, children, action }) => (
  <div className="group relative rounded-xl mb-5 overflow-hidden transition-all duration-200 hover:-translate-y-[1px]"
    style={{
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border) / 0.7)",
      boxShadow: "0 1px 2px hsl(var(--foreground) / 0.02)",
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 8px 24px -12px hsl(var(--foreground) / 0.12)"; e.currentTarget.style.borderColor = "hsl(var(--border))"; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 2px hsl(var(--foreground) / 0.02)"; e.currentTarget.style.borderColor = "hsl(var(--border) / 0.7)"; }}>
    {/* Liseré d'accent — s'affirme au survol, discret au repos */}
    <div className="absolute left-0 top-0 bottom-0 w-[3px] transition-all duration-200 opacity-0 group-hover:opacity-100"
      style={{ background: "linear-gradient(180deg, hsl(var(--primary)), hsl(var(--primary) / 0.3))" }} />
    {/* Header — séparation fine, sans fond contrasté */}
    <div className="flex items-center justify-between px-6 py-4"
      style={{ borderBottom: "1px solid hsl(var(--border) / 0.4)" }}>
      <div className="flex items-center gap-3">
        {icon && (
          <span className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors duration-200"
            style={{ background: "hsl(var(--muted) / 0.6)", color: "hsl(var(--muted-foreground))" }}>
            {icon}
          </span>
        )}
        <h3 className="text-sm font-semibold tracking-tight"
          style={{ color: "hsl(var(--foreground))" }}>
          {title}
        </h3>
      </div>
      {action}
    </div>
    {/* Contenu — padding généreux */}
    <div className="px-6 py-5">{children}</div>
  </div>
);

/* Variante pliable : header cliquable, ChevronDown rotatif, contenu masqué tant que fermé */
const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = false, action, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="relative rounded-xl mb-5 overflow-hidden transition-shadow duration-200"
      style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border) / 0.7)",
        boxShadow: open
          ? "0 8px 24px -14px hsl(var(--foreground) / 0.15)"
          : "0 1px 2px hsl(var(--foreground) / 0.02)",
      }}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px] transition-opacity duration-200"
        style={{ background: "linear-gradient(180deg, hsl(var(--primary)), hsl(var(--primary) / 0.3))", opacity: open ? 1 : 0 }} />
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 transition-colors text-left"
        style={{
          borderBottom: open ? "1px solid hsl(var(--border) / 0.4)" : "1px solid transparent",
          background: "transparent",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--muted) / 0.3)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      >
        <div className="flex items-center gap-3">
          {icon && (
            <span className="flex items-center justify-center w-7 h-7 rounded-lg"
              style={{ background: "hsl(var(--muted) / 0.6)", color: "hsl(var(--muted-foreground))" }}>
              {icon}
            </span>
          )}
          <h3 className="text-sm font-semibold tracking-tight"
            style={{ color: "hsl(var(--foreground))" }}>
            {title}
          </h3>
        </div>
        <ChevronDown size={16}
          style={{
            color: open ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms ease, color 200ms ease",
            flexShrink: 0,
          }} />
      </button>
      {open && (
        <>
          {action && (
            <div className="px-6 pt-4 flex justify-end"
              style={{ borderTop: "0" }}>
              {action}
            </div>
          )}
          <div className={action ? "px-6 pb-5 pt-3" : "px-6 py-5"}>
            {children}
          </div>
        </>
      )}
    </div>
  );
};

/* ────────────────────────────────────────
   COMPOSANTS PAR ONGLET
──────────────────────────────────────── */

/* IDENTITE */
const TabIdentite: React.FC<{ collab: Collaborateur; onSave: () => void }> = ({ collab, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(collab);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ageMiniTravail, setAgeMiniTravail] = useState<number>(16);
  // Maps de résolution des libellés pour l'affichage en lecture
  const [natMap, setNatMap] = useState<Record<string, string>>({});
  const [genreMap, setGenreMap] = useState<Record<string, string>>({});
  const [sitFamMap, setSitFamMap] = useState<Record<string, string>>({});
  const GENRE_FALLBACKS: Record<string, string> = { F: "Femme", H: "Homme" };

  useEffect(() => {
    // Charger AGE_MINIMUM_TRAVAIL
    api.get("/db/parametres_rh?code=eq.AGE_MINIMUM_TRAVAIL&actif=eq.true&select=valeur&limit=1")
      .then((data: any[]) => {
        if (data?.length) setAgeMiniTravail(parseInt(data[0].valeur, 10) || 16);
      }).catch(() => {/* utilise la valeur par défaut 16 */});
  }, []);

  useEffect(() => {
    // Charger les libellés des référentiels pour l'affichage en lecture
    Promise.all([
      supabase.from("ref_nationalite" as never).select("code, libelle").eq("actif" as never, true as never),
      supabase.from("ref_genre" as never).select("code, libelle").eq("actif" as never, true as never),
      supabase.from("ref_situation_familiale" as never).select("code, libelle").eq("actif" as never, true as never),
    ]).then(([nat, genre, sitfam]) => {
      const nm: Record<string, string> = {};
      ((nat.data as any[]) || []).forEach((r: any) => { nm[String(r.code).trim()] = r.libelle; });
      setNatMap(nm);
      const gm: Record<string, string> = {};
      ((genre.data as any[]) || []).forEach((r: any) => { gm[String(r.code).trim().toUpperCase()] = r.libelle; });
      setGenreMap(gm);
      const sm: Record<string, string> = {};
      ((sitfam.data as any[]) || []).forEach((r: any) => { sm[String(r.code).trim().toUpperCase()] = r.libelle; });
      setSitFamMap(sm);
    });
  }, []);

  const resolveGenreLabel = (code?: string | null) => {
    const normalizedCode = String(code || "").trim().toUpperCase();
    return genreMap[normalizedCode] || GENRE_FALLBACKS[normalizedCode] || code || "—";
  };

  const save = async () => {
    setSaveError(null);
    // RG-COLLAB-AGE-01 : DTN + AGE_MINIMUM_TRAVAIL <= Date système
    if (form.date_naissance) {
      const dtn = new Date(form.date_naissance);
      const dateMinEmbauche = new Date(dtn);
      dateMinEmbauche.setFullYear(dateMinEmbauche.getFullYear() + ageMiniTravail);
      if (dateMinEmbauche > new Date()) {
        setSaveError(`Le collaborateur doit avoir au moins ${ageMiniTravail} ans. Date de naissance invalide (doit être avant le ${dateMinEmbauche.toLocaleDateString("fr-FR")}).`);
        return;
      }
    }
    setSaving(true);
    await supabase.from("collaborateurs").update({
      nom: form.nom, prenom: form.prenom, nom_jeune_fille: form.nom_jeune_fille,
      date_naissance: form.date_naissance, lieu_naissance: form.lieu_naissance,
      code_nationalite: form.code_nationalite, code_nationalite2: form.code_nationalite2,
      code_genre: form.code_genre, telephone: form.telephone, gsm: form.gsm,
      email_personnel: form.email_personnel, email_professionnel: form.email_professionnel,
      statut_collaborateur: form.statut_collaborateur,
      civilite: (form as any).civilite || null,
      // RG-COLLAB-SITFAM-01
      code_situation_familiale: form.code_situation_familiale || null,
      date_situation_familiale: form.date_situation_familiale || null,
      cin: form.cin || null, cin_date_debut: form.cin_date_debut || null, cin_date_fin: form.cin_date_fin || null,
      passeport: form.passeport || null, passeport_date_debut: form.passeport_date_debut || null, passeport_date_fin: form.passeport_date_fin || null,
      num_fiscal: form.num_fiscal || null, fiscal_date_debut: form.fiscal_date_debut || null, fiscal_date_fin: form.fiscal_date_fin || null,
    }).eq("id", collab.id);
    setSaving(false);
    setEditing(false);
    onSave();
  };

  const F = (key: keyof Collaborateur) => (
    editing
      ? <input value={(form[key] as string) || ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="w-full px-2 py-1 rounded border text-sm"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
      : <p className="text-sm font-medium" style={{ color: (form[key] as string) ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>
          {(form[key] as string) || "—"}
        </p>
  );

  return (
    <div>
      {/* État civil */}
      <SectionCard title="État civil" icon={<User size={15} />} action={
        editing
          ? <div className="flex gap-2 items-center">
              <button onClick={() => { setEditing(false); setForm(collab); setSaveError(null); }} className="p-1.5 rounded text-xs" style={{ color: "hsl(var(--muted-foreground))" }}><X size={14} /></button>
              <button onClick={save} disabled={saving} className="px-3 py-1 rounded text-xs font-semibold" style={{ background: "hsl(var(--accent))", color: "white" }}>
                {saving ? "…" : <><Check size={12} className="inline mr-1" />Enregistrer</>}
              </button>
            </div>
          : <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-blue-50 transition-all" style={{ color: "hsl(var(--accent))" }}><Pencil size={14} /></button>
      }>
        {/* RG-COLLAB-ETAT-CIVIL-V2 (Adil DAIA) : Layout dense 6 colonnes responsive
            Ligne 1 — IDENTITÉ : Matricule | Civilité | Nom | Prénom | Genre | Date naissance
            Ligne 2 — NAISSANCE : Nom jeune fille | Lieu naissance | Nationalité | Nationalité 2
            Ligne 3 — FAMILLE : Situation matrimoniale | Date depuis */}

        {/* Ligne 1 — Identité */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
          <div>
            <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Matricule</p>
            <p className="text-sm font-bold" style={{ color: "hsl(var(--accent))" }}>#{collab.matricule}</p>
          </div>
          <div>
            {editing
              ? <RefSelect
                  table=""
                  staticOptions={[
                    { value: "M.", label: "M." }, { value: "Mme", label: "Mme" },
                    { value: "Dr.", label: "Dr." }, { value: "Pr.", label: "Pr." }, { value: "Me.", label: "Me." },
                  ]}
                  value={form.civilite || ""}
                  onChange={v => setForm(f => ({ ...f, civilite: v }))}
                  label="Civilité"
                />
              : <><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Civilité</p>
                  <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{form.civilite || "—"}</p></>
            }
          </div>
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Nom</p>{F("nom")}</div>
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Prénom</p>{F("prenom")}</div>
          <div>
            {editing
              ? <RefSelect
                  table="ref_genre"
                  staticOptions={[
                    { value: "F", label: "Femme" },
                    { value: "H", label: "Homme" },
                  ]}
                  value={String(form.code_genre || "").trim().toUpperCase()}
                  onChange={v => setForm(f => ({ ...f, code_genre: v }))}
                  label="Genre"
                />
              : <><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Genre</p>
                  <p className="text-sm font-medium">{resolveGenreLabel(form.code_genre)}</p></>
            }
          </div>
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Nom de jeune fille</p>{F("nom_jeune_fille")}</div>
        </div>

        {/* Ligne 2 — Naissance & Nationalités */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            {editing
              ? <><label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Date de naissance</label>
                  <input type="date" value={form.date_naissance || ""} onChange={e => { setForm(f => ({ ...f, date_naissance: e.target.value })); setSaveError(null); }}
                    min="1900-01-01" max="2099-12-31"
                    className="w-full px-2 py-1.5 rounded-lg border text-sm" style={{ borderColor: saveError ? "hsl(0 84% 55%)" : "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                  {saveError && <p className="text-xs mt-1" style={{ color: "hsl(0 84% 55%)" }}>{saveError}</p>}</>
              : <><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Date de naissance</p>
                  <p className="text-sm font-medium">{form.date_naissance ? fmtDate(form.date_naissance) : "—"}</p></>
            }
          </div>
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Lieu de naissance</p>{F("lieu_naissance")}</div>
          <div>
            {editing
              ? <RefSelect
                  table="ref_nationalite"
                  value={form.code_nationalite || ""}
                  onChange={v => setForm(f => ({ ...f, code_nationalite: v }))}
                  label="Nationalité"
                />
              : <><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Nationalité</p>
                  <p className="text-sm font-medium" style={{ color: form.code_nationalite ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>{natMap[form.code_nationalite || ""] || form.code_nationalite || "—"}</p></>
            }
          </div>
          <div>
            {editing
              ? <RefSelect
                  table="ref_nationalite"
                  value={form.code_nationalite2 || ""}
                  onChange={v => setForm(f => ({ ...f, code_nationalite2: v }))}
                  label="Nationalité 2"
                />
              : <><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Nationalité 2</p>
                  <p className="text-sm font-medium" style={{ color: form.code_nationalite2 ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>{natMap[form.code_nationalite2 || ""] || form.code_nationalite2 || "—"}</p></>
            }
          </div>
        </div>

        {/* Ligne 3 — Situation matrimoniale (RG-COLLAB-SITFAM-01) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            {editing
              ? <RefSelect
                  table="ref_situation_familiale"
                  value={String(form.code_situation_familiale || "").trim().toUpperCase()}
                  onChange={v => setForm(f => ({ ...f, code_situation_familiale: v }))}
                  label="Situation matrimoniale"
                />
              : <><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Situation matrimoniale</p>
                  <p className="text-sm font-medium" style={{ color: form.code_situation_familiale ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>
                    {sitFamMap[String(form.code_situation_familiale || "").trim().toUpperCase()] || form.code_situation_familiale || "—"}
                  </p></>
            }
          </div>
          <div>
            {editing
              ? <><label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Depuis le</label>
                  <input type="date" value={form.date_situation_familiale || ""}
                    onChange={e => setForm(f => ({ ...f, date_situation_familiale: e.target.value }))}
                    min="1900-01-01" max="2099-12-31"
                    disabled={!form.code_situation_familiale || form.code_situation_familiale === "C"}
                    title={form.code_situation_familiale === "C" ? "Non applicable pour Célibataire" : ""}
                    className="w-full px-2 py-1.5 rounded-lg border text-sm disabled:opacity-50"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} /></>
              : <><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Depuis le</p>
                  <p className="text-sm font-medium" style={{ color: form.date_situation_familiale ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>
                    {form.date_situation_familiale ? fmtDate(form.date_situation_familiale) : "—"}
                  </p></>
            }
          </div>
        </div>
      </SectionCard>

      {/* Contact */}
      <SectionCard title="Coordonnées" icon={<Phone size={15} />} action={
        editing
          ? null
          : <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-blue-50 transition-all" style={{ color: "hsl(var(--accent))" }}><Pencil size={14} /></button>
      }>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Téléphone</p>{F("telephone")}</div>
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>GSM</p>{F("gsm")}</div>
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Email personnel</p>{F("email_personnel")}</div>
          <div><p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Email professionnel</p>{F("email_professionnel")}</div>
        </div>
      </SectionCard>

      {/* Documents d'identité */}
      <SectionCard title="Documents d'identité" icon={<FileText size={15} />} action={
        editing
          ? null
          : <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-blue-50 transition-all" style={{ color: "hsl(var(--accent))" }}><Pencil size={14} /></button>
      }>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* CIN */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: "hsl(var(--muted) / 0.5)" }}>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "hsl(var(--accent))" }}>CIN</p>
            {editing ? (
              <>
                <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Numéro</label>{F("cin")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Date début</label>
                    <input type="date" value={form.cin_date_debut || ""} onChange={e => setForm(f => ({ ...f, cin_date_debut: e.target.value }))}
                      className="w-full px-2 py-1 rounded border text-sm" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} /></div>
                  <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Date fin</label>
                    <input type="date" value={form.cin_date_fin || ""} onChange={e => setForm(f => ({ ...f, cin_date_fin: e.target.value }))}
                      className="w-full px-2 py-1 rounded border text-sm" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} /></div>
                </div>
              </>
            ) : (
              <>
                <Field label="Numéro" value={collab.cin} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Date début" value={collab.cin_date_debut ? fmtDate(collab.cin_date_debut) : undefined} />
                  <Field label="Date fin" value={collab.cin_date_fin ? fmtDate(collab.cin_date_fin) : undefined} />
                </div>
              </>
            )}
          </div>
          {/* Passeport */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: "hsl(var(--muted) / 0.5)" }}>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "hsl(var(--accent))" }}>Passeport</p>
            {editing ? (
              <>
                <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Numéro</label>{F("passeport")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Date début</label>
                    <input type="date" value={form.passeport_date_debut || ""} onChange={e => setForm(f => ({ ...f, passeport_date_debut: e.target.value }))}
                      className="w-full px-2 py-1 rounded border text-sm" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} /></div>
                  <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Date fin</label>
                    <input type="date" value={form.passeport_date_fin || ""} onChange={e => setForm(f => ({ ...f, passeport_date_fin: e.target.value }))}
                      className="w-full px-2 py-1 rounded border text-sm" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} /></div>
                </div>
              </>
            ) : (
              <>
                <Field label="Numéro" value={collab.passeport} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Date début" value={collab.passeport_date_debut ? fmtDate(collab.passeport_date_debut) : undefined} />
                  <Field label="Date fin" value={collab.passeport_date_fin ? fmtDate(collab.passeport_date_fin) : undefined} />
                </div>
              </>
            )}
          </div>
          {/* Fiscal */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: "hsl(var(--muted) / 0.5)" }}>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "hsl(var(--accent))" }}>Identifiant fiscal</p>
            {editing ? (
              <>
                <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Numéro</label>{F("num_fiscal")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Date début</label>
                    <input type="date" value={form.fiscal_date_debut || ""} onChange={e => setForm(f => ({ ...f, fiscal_date_debut: e.target.value }))}
                      className="w-full px-2 py-1 rounded border text-sm" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} /></div>
                  <div><label className="text-xs font-medium mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Date fin</label>
                    <input type="date" value={form.fiscal_date_fin || ""} onChange={e => setForm(f => ({ ...f, fiscal_date_fin: e.target.value }))}
                      className="w-full px-2 py-1 rounded border text-sm" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} /></div>
                </div>
              </>
            ) : (
              <>
                <Field label="Numéro" value={collab.num_fiscal} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Date début" value={collab.fiscal_date_debut ? fmtDate(collab.fiscal_date_debut) : undefined} />
                  <Field label="Date fin" value={collab.fiscal_date_fin ? fmtDate(collab.fiscal_date_fin) : undefined} />
                </div>
              </>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

/* CONTRATS */
// Map code → libelle pour un référentiel donné
type RefMap = Record<string, string>;

const TabContrats: React.FC<{ collaborateurId: string; ancienMatricule?: string }> = ({ collaborateurId, ancienMatricule }) => {
  const [contrats, setContrats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editContrat, setEditContrat] = useState<any | null>(null);
  const [refs, setRefs] = useState<{
    typeContrat: RefMap; motifRecrutement: RefMap; sourceRecrutement: RefMap;
    tempsTravail: RefMap; devise: RefMap; uniteDuree: RefMap; motifSortie: RefMap; societes: RefMap;
  }>({ typeContrat: {}, motifRecrutement: {}, sourceRecrutement: {}, tempsTravail: {}, devise: {}, uniteDuree: {}, motifSortie: {}, societes: {} });

  // Charge les référentiels en parallèle
  useEffect(() => {
    const toMap = (data: any[] | null) =>
      (data || []).reduce((acc, r) => ({ ...acc, [r.code]: r.libelle }), {} as RefMap);

    Promise.all([
      supabase.from("ref_type_contrat" as never).select("code, libelle"),
      supabase.from("ref_motif_recrutement").select("code, libelle"),
      supabase.from("ref_source_recrutement" as never).select("code, libelle"),
      supabase.from("ref_temps_travail" as never).select("code, libelle"),
      supabase.from("ref_devise").select("code, libelle"),
      supabase.from("ref_unite_duree_contrat" as never).select("code, libelle"),
      supabase.from("ref_motif_sortie").select("code, libelle"),
      supabase.from("societes" as never).select("id, raison_sociale"),
    ]).then(([tc, mr, sr, tt, dv, ud, ms, soc]) => {
      setRefs({
        typeContrat: toMap(tc.data as any),
        motifRecrutement: toMap(mr.data as any),
        sourceRecrutement: toMap(sr.data as any),
        tempsTravail: toMap(tt.data as any),
        devise: toMap(dv.data as any),
        uniteDuree: toMap(ud.data as any),
        motifSortie: toMap(ms.data as any),
        societes: (soc.data as any[] || []).reduce((acc, s) => ({ ...acc, [s.id]: s.raison_sociale }), {} as RefMap),
      });
    });
  }, []);

  // Résolution de la chaîne complète des matricules historiques (N niveaux)
  const { chainIds, chainCollabs } = useChainCollaborateurIds(collaborateurId, ancienMatricule);

  const load = async () => {
    if (chainIds.length === 0) return;
    setLoading(true);
    try {
      // Une seule requête qui couvre TOUS les collabs de la chaîne historique
      const idsList = chainIds.join(",");
      const allContrats: any[] = await api.get(
        `/db/collaborateur_contrats?` +
        `collaborateur_id=in.(${idsList})` +
        `&archive=eq.false`
      );

      // Map collab_id → matricule pour étiqueter les contrats venant des ancêtres
      const matriculeById = new Map(chainCollabs.map(c => [c.id, c.matricule]));
      const currentId = chainIds[0];
      const tagged = (allContrats || []).map((c: any) => ({
        ...c,
        _from_ancien: c.collaborateur_id !== currentId ? matriculeById.get(c.collaborateur_id) : undefined,
      }));

      // Tri décroissant par date_debut
      tagged.sort((a, b) => (b.date_debut || "").localeCompare(a.date_debut || ""));
      setContrats(tagged);
    } catch (e) {
      console.error("[TabContrats] Erreur chargement contrats :", e);
      setContrats([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [chainIds.join(",")]);

  const handleEdit = (c: any) => { setEditContrat(c); setShowForm(true); };
  const handleNew = () => { setEditContrat(null); setShowForm(true); };

  // Résout code → libelle, avec fallback sur le code brut si non trouvé
  const lbl = (map: RefMap, code?: string | null) => code ? (map[code] || code) : "—";

  const getStatutContrat = (c: any) => {
    const isEnCours = ["ACTIF", "EN_COURS"].includes(c.code_statut_contrat);
    const isEchu = c.code_statut_contrat === "ECHU" || (c.date_fin && new Date(c.date_fin) < new Date());
    if (isEnCours && !isEchu) return { label: "En cours", bg: "hsl(84 55% 50% / 0.15)", color: "hsl(84 55% 35%)" };
    if (isEchu) return { label: "Échu", bg: "hsl(215 20% 55% / 0.15)", color: "hsl(215 20% 40%)" };
    return { label: c.code_statut_contrat, bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" };
  };

  const contratEnCours = contrats.find(c => ["ACTIF", "EN_COURS"].includes(c.code_statut_contrat) && !c._from_ancien && !(c.date_fin && new Date(c.date_fin) < new Date()));

  return (
    <>
      {/* Alerte contrat en cours */}
      {contratEnCours && (
        <div className="mb-4 px-4 py-2.5 rounded-lg text-xs flex items-center gap-2 border" style={{ background: "hsl(84 55% 50% / 0.08)", borderColor: "hsl(84 55% 50% / 0.25)", color: "hsl(84 55% 32%)" }}>
          <span className="text-base">✅</span>
          <span>Contrat en cours actif depuis le <strong>{fmtDate(contratEnCours.date_debut)}</strong>
          {contratEnCours.date_fin ? ` — jusqu'au ${fmtDate(contratEnCours.date_fin)}` : " — sans date de fin"}
          . Un nouveau contrat clôturera automatiquement celui-ci.</span>
        </div>
      )}

      <SectionCard title="Historique des contrats" icon={<Briefcase size={15} />} action={
        <button
          onClick={handleNew}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: "hsl(var(--accent))", color: "white" }}
        >
          <Plus size={12} />Nouveau contrat
        </button>
      }>
        {loading
          ? <div className="h-20 flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} /></div>
          : contrats.length === 0
            ? <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun contrat enregistré</p>
            : <div className="space-y-3">
                {contrats.map(c => {
                  const statutStyle = getStatutContrat(c);
                  return (
                    <div key={c.id} className="rounded-lg p-4 border" style={{ borderColor: c._from_ancien ? "hsl(35 90% 55% / 0.4)" : statutStyle.color + "40", background: c._from_ancien ? "hsl(35 90% 55% / 0.06)" : "hsl(var(--muted) / 0.3)" }}>
                      {c._from_ancien && (
                        <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold" style={{ color: "hsl(35 90% 45%)" }}>
                          <Hash size={11} />Historique — Ancien matricule {c._from_ancien}
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Type de contrat</p>
                            <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{lbl(refs.typeContrat, c.code_type_contrat)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</p>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: statutStyle.bg, color: statutStyle.color }}>
                              {statutStyle.label}
                            </span>
                          </div>
                          <Field label="Date début" value={c.date_debut ? fmtDate(c.date_debut) : undefined} />
                          <Field label="Date fin" value={c.date_fin ? fmtDate(c.date_fin) : "—"} />
                          <div>
                            <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Date fin prévue</p>
                            <p className="text-sm font-medium flex items-center gap-1" style={{ color: c.date_depart_previsionnelle ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.5)" }}>
                              {c.date_depart_previsionnelle ? fmtDate(c.date_depart_previsionnelle) : "—"}
                            </p>
                          </div>
                          <Field label="Société" value={lbl(refs.societes, c.societe_id)} />
                          <Field label="Référence" value={c.reference_contrat} />
                          <Field label="Temps de travail" value={lbl(refs.tempsTravail, c.code_temps)} />
                          <Field label="Devise" value={lbl(refs.devise, c.code_devise)} />
                          <Field label="Durée" value={c.duree_contrat ? `${c.duree_contrat} ${lbl(refs.uniteDuree, c.code_unite_duree)}` : undefined} />
                          <Field label="Motif recrutement" value={lbl(refs.motifRecrutement, c.code_motif_recrutement)} />
                          <Field label="Source recrutement" value={lbl(refs.sourceRecrutement, c.code_source_recrutement)} />
                          <Field label="Responsable recrutement" value={c.responsable_recrutement} />
                          {(c.motif_sortie || c.date_sortie) && <>
                            <Field label="Motif sortie" value={lbl(refs.motifSortie, c.motif_sortie)} />
                            <Field label="Date sortie" value={c.date_sortie ? fmtDate(c.date_sortie) : undefined} />
                          </>}
                        </div>
                        {!c._from_ancien && (
                          <button onClick={() => handleEdit(c)} className="p-1.5 rounded" style={{ color: "hsl(var(--accent))" }}>
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                      {c.commentaire_sortie && (
                        <div className="mt-3 pt-3 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}><span className="font-semibold">Commentaire sortie :</span> {c.commentaire_sortie}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
        }
      </SectionCard>

      {showForm && (
        <ContratForm
          collaborateurId={collaborateurId}
          contrat={editContrat}
          onClose={() => setShowForm(false)}
          onSaved={load}
        />
      )}
    </>
  );
};

/* AFFECTATION */
const TabAffectation: React.FC<{ collaborateurId: string; ancienMatricule?: string }> = ({ collaborateurId, ancienMatricule }) => {
  return (
    <div>
      <SectionCard title="Affectations UO / Poste" icon={<Building2 size={15} />}>
        <AffectationForm collaborateurId={collaborateurId} ancienMatricule={ancienMatricule} />
      </SectionCard>

      {/* Répartition analytique (comptabilité de paie) — prime sur l'UO ci-dessus
          quand des lignes actives existent, cf. RepartitionCentreCoutForm. */}
      <SectionCard title="Répartition centres de coût" icon={<Building2 size={15} />}>
        <RepartitionCentreCoutForm collaborateurId={collaborateurId} />
      </SectionCard>

      {/* Forçage workflow */}
      <SectionCard title="Forçage workflow de validation" icon={<Users size={15} />}>
        <WorkflowManagerForm collaborateurId={collaborateurId} />
      </SectionCard>

      {/* Classification - sous-formulaire complet */}
      <ClassificationForm collaborateurId={collaborateurId} ancienMatricule={ancienMatricule} />
    </div>
  );
};

/* FAMILLE — RG-FAM-INDIC-01 (Adil DAIA) : Indicateurs avec forçage manuel
 * Calcul automatique :
 *   - nb_enfants_a_charge = COUNT(collaborateur_enfants WHERE est_pris_en_charge=true)
 *   - nb_personnes_a_charge = nb_enfants_a_charge + (1 si conjoint non salarié, 0 sinon)
 *   - nb_deductions_fiscales = MIN(6, nb_personnes_a_charge)  // plafond IR Maroc
 * Si famille_force_valeurs=true → les valeurs saisies remplacent le calcul auto.
 */
const TabFamille: React.FC<{ collaborateurId: string }> = ({ collaborateurId }) => {
  const [forceValeurs, setForceValeurs] = React.useState(false);
  const [nbEnfants, setNbEnfants] = React.useState<number | null>(null);
  const [nbPersonnes, setNbPersonnes] = React.useState<number | null>(null);
  const [nbDeductions, setNbDeductions] = React.useState<number | null>(null);
  const [calcAuto, setCalcAuto] = React.useState({ enfants: 0, personnes: 0, deductions: 0 });
  const [saving, setSaving] = React.useState(false);
  const [dirtyIndicateurs, setDirtyIndicateurs] = React.useState(false);
  const [savingIndicateurs, setSavingIndicateurs] = React.useState(false);
  // RG-COLLAB-SITFAM-01 (Adil DAIA) : rappel de la situation matrimoniale en tête d'onglet
  const [codeSituationFamiliale, setCodeSituationFamiliale] = React.useState<string | null>(null);
  const [dateSituationFamiliale, setDateSituationFamiliale] = React.useState<string | null>(null);
  const [sitFamMap, setSitFamMap] = React.useState<Record<string, string>>({});
  const [editingSitFam, setEditingSitFam] = React.useState(false);
  const [sitFamCodeDraft, setSitFamCodeDraft] = React.useState<string>("");
  const [sitFamDateDraft, setSitFamDateDraft] = React.useState<string>("");
  const [savingSitFam, setSavingSitFam] = React.useState(false);
  // RG-FAM-ACCORDION-01 (Adil DAIA) : compteurs pour les badges des sections accordéon
  const [stats, setStats] = React.useState({ nbEnfantsTotal: 0, nbConjoints: 0, nbContacts: 0 });
  // États d'accordéon (un par section)
  const [openSections, setOpenSections] = React.useState({
    indicateurs: true, conjoint: false, enfants: false, contacts: false,
  });
  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections(s => ({ ...s, [key]: !s[key] }));

  // ── Charger l'état actuel (collaborateur + calcul auto) ─────────────────
  const loadAll = React.useCallback(async () => {
    const [{ data: c }, { data: enfants }, { data: conjoints }, contactsRes, { data: refSitFam }] = await Promise.all([
      supabase.from("collaborateurs" as never)
        .select("famille_force_valeurs,nb_enfants_a_charge,nb_personnes_a_charge,nb_deductions_fiscales,code_situation_familiale,date_situation_familiale" as never)
        .eq("id" as never, collaborateurId as never).single(),
      supabase.from("collaborateur_enfants" as never)
        .select("est_pris_en_charge,date_fin_prise_en_charge,date_deces" as never)
        .eq("collaborateur_id" as never, collaborateurId as never)
        .eq("archive" as never, false as never),
      supabase.from("collaborateur_conjoints" as never)
        .select("est_salarie,code_statut,date_deces,date_fin_relation" as never)
        .eq("collaborateur_id" as never, collaborateurId as never)
        .eq("archive" as never, false as never),
      // Pour le compteur "Contacts d'urgence" (RG-FAM-ACCORDION-01)
      supabase.from("collaborateur_contacts_urgence" as never)
        .select("id" as never, { count: "exact", head: true } as never)
        .eq("collaborateur_id" as never, collaborateurId as never)
        .eq("archive" as never, false as never).then((r: any) => ({ data: null, count: r.count })),
      // Libellés situation matrimoniale (RG-COLLAB-SITFAM-01)
      supabase.from("ref_situation_familiale" as never)
        .select("code, libelle" as never)
        .eq("actif" as never, true as never),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const enfantsCharge = ((enfants || []) as any[]).filter(e =>
      e.est_pris_en_charge === true
      && !e.date_deces
      && (!e.date_fin_prise_en_charge || e.date_fin_prise_en_charge >= today)
    ).length;
    const conjointsCharge = ((conjoints || []) as any[]).filter(cj =>
      cj.est_salarie === false
      && !cj.date_deces
      && (!cj.date_fin_relation || cj.date_fin_relation >= today)
      && ["MARIE", "PACS", "UNION_LIBRE"].includes(cj.code_statut)
    ).length;
    const personnesCharge = enfantsCharge + conjointsCharge;
    // RG-IR-MAROC-01 : déductions fiscales plafonnées à 6 personnes
    const deductions = Math.min(6, personnesCharge);
    setCalcAuto({ enfants: enfantsCharge, personnes: personnesCharge, deductions });

    // Compteurs pour les sections accordéon
    const nbEnfantsTotal = ((enfants || []) as any[]).length;
    const nbConjoints = ((conjoints || []) as any[]).length;
    const nbContacts = (contactsRes as any)?.count ?? 0;
    setStats({ nbEnfantsTotal, nbConjoints, nbContacts });

    // Auto-déplier les sections non vides au premier chargement
    setOpenSections(prev => ({
      indicateurs: prev.indicateurs,
      conjoint: prev.conjoint || nbConjoints > 0,
      enfants: prev.enfants || nbEnfantsTotal > 0,
      contacts: prev.contacts || nbContacts > 0,
    }));

    if (c) {
      const d = c as any;
      setForceValeurs(d.famille_force_valeurs === true);
      setNbEnfants(d.famille_force_valeurs ? d.nb_enfants_a_charge : enfantsCharge);
      setNbPersonnes(d.famille_force_valeurs ? d.nb_personnes_a_charge : personnesCharge);
      setNbDeductions(d.famille_force_valeurs ? d.nb_deductions_fiscales : deductions);
      setCodeSituationFamiliale(d.code_situation_familiale || null);
      setDateSituationFamiliale(d.date_situation_familiale || null);
      setSitFamCodeDraft(String(d.code_situation_familiale || "").trim().toUpperCase());
      setSitFamDateDraft(d.date_situation_familiale || "");
    }

    const map: Record<string, string> = {};
    ((refSitFam || []) as any[]).forEach(r => { map[String(r.code).trim().toUpperCase()] = r.libelle; });
    setSitFamMap(map);
    setDirtyIndicateurs(false);
  }, [collaborateurId]);

  React.useEffect(() => { loadAll(); }, [loadAll]);

  // ── Toggle "Forcer les valeurs" ─────────────────────────────────────────
  const handleToggleForce = async (checked: boolean) => {
    setForceValeurs(checked);
    setSaving(true);
    const payload: any = { famille_force_valeurs: checked };
    if (checked) {
      // Pré-remplir avec les valeurs auto courantes pour démarrer la saisie manuelle
      payload.nb_enfants_a_charge = nbEnfants ?? calcAuto.enfants;
      payload.nb_personnes_a_charge = nbPersonnes ?? calcAuto.personnes;
      payload.nb_deductions_fiscales = nbDeductions ?? calcAuto.deductions;
    } else {
      // Mode auto : effacer les valeurs forcées
      payload.nb_enfants_a_charge = null;
      payload.nb_personnes_a_charge = null;
      payload.nb_deductions_fiscales = null;
      setNbEnfants(calcAuto.enfants);
      setNbPersonnes(calcAuto.personnes);
      setNbDeductions(calcAuto.deductions);
    }
    const { data: updated, error } = await supabase.from("collaborateurs" as never)
      .update(payload as never).eq("id" as never, collaborateurId as never)
      .select("id");
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!updated || updated.length === 0) {
      toast.error("Écriture refusée par la base (droits insuffisants). La modification n'a pas été enregistrée.");
      // On revient à l'état d'avant tentative pour ne pas afficher une valeur non persistée
      loadAll();
      return;
    }
    setDirtyIndicateurs(false);
    toast.success(checked ? "Mode forçage activé" : "Mode calcul auto activé");
  };

  // ── Recalculer (réinitialiser depuis les données enfants/conjoints) ─────
  const handleRecalculer = async () => {
    setNbEnfants(calcAuto.enfants);
    setNbPersonnes(calcAuto.personnes);
    setNbDeductions(calcAuto.deductions);
    setSaving(true);
    const { data: updated, error } = await supabase.from("collaborateurs" as never).update({
      nb_enfants_a_charge: calcAuto.enfants,
      nb_personnes_a_charge: calcAuto.personnes,
      nb_deductions_fiscales: calcAuto.deductions,
    } as never).eq("id" as never, collaborateurId as never)
      .select("id");
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!updated || updated.length === 0) {
      toast.error("Écriture refusée par la base (droits insuffisants). La modification n'a pas été enregistrée.");
      loadAll();
      return;
    }
    setDirtyIndicateurs(false);
    toast.success("Indicateurs recalculés depuis les enfants et conjoints");
  };

  // ── Sauvegarde explicite des 3 indicateurs forcés (bouton "Enregistrer") ─
  const handleSaveIndicateurs = async () => {
    if (!forceValeurs) return;
    setSavingIndicateurs(true);
    const { data: updated, error } = await supabase.from("collaborateurs" as never)
      .update({
        nb_enfants_a_charge: nbEnfants ?? 0,
        nb_personnes_a_charge: nbPersonnes ?? 0,
        nb_deductions_fiscales: nbDeductions ?? 0,
      } as never)
      .eq("id" as never, collaborateurId as never)
      .select("id");
    setSavingIndicateurs(false);
    if (error) { toast.error(error.message); return; }
    if (!updated || updated.length === 0) {
      toast.error("Écriture refusée par la base (droits insuffisants). La modification n'a pas été enregistrée.");
      loadAll();
      return;
    }
    setDirtyIndicateurs(false);
    toast.success("Indicateurs famille enregistrés");
  };

  // ── Sauvegarde de la situation matrimoniale (RG-COLLAB-SITFAM-01) ───────
  const handleSaveSitFam = async () => {
    const code = sitFamCodeDraft.trim().toUpperCase();
    const dateVal = code === "C" ? null : (sitFamDateDraft || null);
    setSavingSitFam(true);
    const { data: updated, error } = await supabase.from("collaborateurs" as never)
      .update({ code_situation_familiale: code || null, date_situation_familiale: dateVal } as never)
      .eq("id" as never, collaborateurId as never)
      .select("id");
    setSavingSitFam(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!updated || updated.length === 0) {
      toast.error("Écriture refusée par la base (droits insuffisants). La modification n'a pas été enregistrée.");
      loadAll();
      return;
    }
    setCodeSituationFamiliale(code || null);
    setDateSituationFamiliale(dateVal);
    setEditingSitFam(false);
    toast.success("Situation matrimoniale mise à jour");
  };


  const AccordionSection: React.FC<{
    sectionKey: keyof typeof openSections;
    title: string;
    icon: React.ReactNode;
    badge?: React.ReactNode;
    action?: React.ReactNode;
    children: React.ReactNode;
  }> = ({ sectionKey, title, icon, badge, action, children }) => {
    const isOpen = openSections[sectionKey];
    return (
      <div className="rounded-xl border bg-card overflow-hidden transition-all"
        style={{ borderColor: "hsl(var(--border))" }}>
        <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => toggleSection(sectionKey)}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex-shrink-0 transition-transform" style={{
              transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
              color: "hsl(var(--muted-foreground))",
            }}>
              <ChevronDown size={15} />
            </div>
            <div style={{ color: "hsl(var(--accent))" }}>{icon}</div>
            <h3 className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
              {title}
            </h3>
            {badge}
          </div>
          {action && <div onClick={e => e.stopPropagation()}>{action}</div>}
        </div>
        {isOpen && (
          <div className="px-4 pb-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
            <div className="pt-4">{children}</div>
          </div>
        )}
      </div>
    );
  };

  // Helper : badge compteur
  const Counter: React.FC<{ count: number; label?: string; color?: string }> = ({ count, label, color }) => (
    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{
      background: count > 0 ? (color || "hsl(var(--accent) / 0.15)") : "hsl(var(--muted))",
      color: count > 0 ? (color ? "hsl(0 0% 100%)" : "hsl(var(--accent))") : "hsl(var(--muted-foreground))",
    }}>
      {count}{label ? ` ${label}` : ""}
    </span>
  );

  const situationLabel = codeSituationFamiliale
    ? (sitFamMap[String(codeSituationFamiliale).trim().toUpperCase()] || codeSituationFamiliale)
    : null;

  return (
    <div className="space-y-3">
      {/* 0. Rappel + édition de la situation matrimoniale (RG-COLLAB-SITFAM-01) — même donnée que l'onglet Identité */}
      <div className="rounded-xl border px-4 py-3"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
        {editingSitFam ? (
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1 min-w-[180px]">
              <RefSelect
                table="ref_situation_familiale"
                value={sitFamCodeDraft}
                onChange={v => {
                  setSitFamCodeDraft(v);
                  if (v === "C") setSitFamDateDraft("");
                }}
                label="Situation matrimoniale"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Depuis le</label>
              <input type="date" value={sitFamDateDraft}
                onChange={e => setSitFamDateDraft(e.target.value)}
                min="1900-01-01" max="2099-12-31"
                disabled={!sitFamCodeDraft || sitFamCodeDraft === "C"}
                title={sitFamCodeDraft === "C" ? "Non applicable pour Célibataire" : ""}
                className="w-full px-2 py-1.5 rounded-lg border text-sm disabled:opacity-50"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => {
                  setEditingSitFam(false);
                  setSitFamCodeDraft(String(codeSituationFamiliale || "").trim().toUpperCase());
                  setSitFamDateDraft(dateSituationFamiliale || "");
                }}
                className="p-1.5 rounded text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                <X size={14} />
              </button>
              <button onClick={handleSaveSitFam} disabled={savingSitFam}
                className="px-3 py-1 rounded text-xs font-semibold" style={{ background: "hsl(var(--accent))", color: "white" }}>
                {savingSitFam ? "…" : <><Check size={12} className="inline mr-1" />Enregistrer</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Heart size={15} style={{ color: "hsl(var(--accent))" }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Situation matrimoniale</p>
                  <p className="text-sm font-semibold" style={{ color: situationLabel ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>
                    {situationLabel || "—"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar size={15} style={{ color: "hsl(var(--accent))" }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Depuis le</p>
                  <p className="text-sm font-semibold" style={{ color: dateSituationFamiliale ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>
                    {dateSituationFamiliale ? fmtDate(dateSituationFamiliale) : "—"}
                  </p>
                </div>
              </div>
            </div>
            <button onClick={() => setEditingSitFam(true)} className="p-1.5 rounded hover:bg-blue-50 transition-all" style={{ color: "hsl(var(--accent))" }}>
              <Pencil size={14} />
            </button>
          </div>
        )}
      </div>

      {/* 1. Indicateurs famille (RG-FAM-INDIC-01) */}
      <AccordionSection
        sectionKey="indicateurs"
        title="Indicateurs famille"
        icon={<Users size={15} />}
        badge={
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{
            background: forceValeurs ? "hsl(var(--accent) / 0.15)" : "hsl(var(--muted))",
            color: forceValeurs ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
          }}>
            {forceValeurs ? "🔒 Forcé" : "🔓 Auto"}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            {forceValeurs && dirtyIndicateurs && (
              <button onClick={handleSaveIndicateurs} disabled={savingIndicateurs}
                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: "hsl(var(--accent))", color: "white" }}>
                {savingIndicateurs ? "…" : <><Check size={12} className="inline mr-1" />Enregistrer</>}
              </button>
            )}
            {forceValeurs && (
              <button onClick={handleRecalculer} disabled={saving}
                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold border disabled:opacity-50"
                style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--accent))" }}>
                🔄 Recalculer auto
              </button>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={forceValeurs} disabled={saving}
                onChange={e => handleToggleForce(e.target.checked)}
                className="rounded border-border text-accent" />
              <span style={{ color: "hsl(var(--muted-foreground))" }}>Valeurs forcées</span>
            </label>
          </div>
        }>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Enfants à charge",      val: nbEnfants,    setter: setNbEnfants,    field: "nb_enfants_a_charge",    auto: calcAuto.enfants },
            { label: "Personnes à charge",    val: nbPersonnes,  setter: setNbPersonnes,  field: "nb_personnes_a_charge",  auto: calcAuto.personnes },
            { label: "Déductions fiscales",   val: nbDeductions, setter: setNbDeductions, field: "nb_deductions_fiscales", auto: calcAuto.deductions },
          ].map(it => (
            <div key={it.field} className="rounded-lg p-3 border"
              style={{ borderColor: "hsl(var(--border))",
                       background: forceValeurs ? "hsl(var(--accent)/0.05)" : "hsl(var(--muted)/0.3)" }}>
              <p className="text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                {it.label}
              </p>
              {forceValeurs ? (
                <input type="number" min="0" max="20" value={it.val ?? 0}
                  onChange={e => { it.setter(Number(e.target.value)); setDirtyIndicateurs(true); }}
                  className="w-20 text-2xl font-bold px-2 py-1 rounded border" style={{
                    borderColor: "hsl(var(--accent) / 0.4)",
                    background: "hsl(var(--background))",
                    color: "hsl(var(--accent))",
                  }} />
              ) : (
                <p className="text-2xl font-bold" style={{ color: "hsl(var(--accent))" }}>{it.val ?? 0}</p>
              )}
              {forceValeurs && (it.val ?? 0) !== it.auto && (
                <p className="text-[10px] mt-1" style={{ color: "hsl(45 90% 40%)" }}>
                  ⚠ Diffère du calcul auto ({it.auto})
                </p>
              )}
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* 2. Conjoint(e) */}
      <AccordionSection
        sectionKey="conjoint"
        title="Conjoint(e)"
        icon={<Heart size={15} />}
        badge={<Counter count={stats.nbConjoints} />}>
        <ConjointForm collaborateurId={collaborateurId} />
      </AccordionSection>

      {/* 3. Enfants */}
      <AccordionSection
        sectionKey="enfants"
        title="Enfants"
        icon={<Users size={15} />}
        badge={<Counter count={stats.nbEnfantsTotal} />}>
        <EnfantForm collaborateurId={collaborateurId} />
      </AccordionSection>

      {/* 4. Contacts d'urgence */}
      <AccordionSection
        sectionKey="contacts"
        title="Contacts d'urgence"
        icon={<AlertCircle size={15} />}
        badge={<Counter count={stats.nbContacts} />}>
        <ContactUrgenceForm collaborateurId={collaborateurId} />
      </AccordionSection>
    </div>
  );
};

/* REMUNERATION */
const TabRemuneration: React.FC<{ collaborateurId: string }> = ({ collaborateurId }) => {
  return (
    <div>
      {/* RG-REM-03 : Plan de paie d'affectation – Auteur : Adil DAIA */}
      <CollapsibleSection title="Plan de paie" icon={<CreditCard size={15} />} defaultOpen={false}>
        <CollaborateurPlanPaieForm collaborateurId={collaborateurId} />
      </CollapsibleSection>

      {/* RG-REM-01 : Ordre d'affichage – Éléments fixes, Avantages, Coordonnées bancaires – Auteur : Adil DAIA */}
      <CollapsibleSection title="Éléments fixes du salaire" icon={<CreditCard size={15} />} defaultOpen={false}>
        <SalaireFixeForm collaborateurId={collaborateurId} />
      </CollapsibleSection>

      {/* RG-REM-02 : Avantages – Auteur : Adil DAIA */}
      <CollapsibleSection title="Avantages" icon={<Award size={15} />} defaultOpen={false}>
        <AvantageForm collaborateurId={collaborateurId} />
      </CollapsibleSection>

      <CollapsibleSection title="Coordonnées bancaires" icon={<Hash size={15} />} defaultOpen={false}>
        <PaiementForm collaborateurId={collaborateurId} />
      </CollapsibleSection>
    </div>
  );
};

/* FORMATION & COMPÉTENCES */
const TabFormation: React.FC<{ collaborateurId: string }> = ({ collaborateurId }) => (
  <>
    <DiplomeForm collaborateurId={collaborateurId} />
    <CompetenceForm collaborateurId={collaborateurId} />
  </>
);

/* IMMATRICULATION — RG-IMMAT-DYN-01 (Adil DAIA)
 * Tableau dynamique des régimes de cotisation affectés au collaborateur.
 * Source unique : table collaborateur_regime.
 * Référentiels : ref_regime_cotisation + regle_calcul_cotisation (jointure
 * via code_regle_cotisation pour afficher la règle appliquée).
 */
const TabImmatriculation: React.FC<{ collaborateurId: string; collab: Collaborateur; onSave?: () => void }> = ({ collaborateurId, collab, onSave }) => {
  // ─── Référentiels ───────────────────────────────────────────────────────
  const [regimes, setRegimes] = useState<Array<{
    code: string; libelle: string; organisme: string | null;
    code_regle_cotisation: string | null;
  }>>([]);
  const [regles, setRegles] = useState<Array<{
    code: string; libelle: string; nb_composantes: number;
    code_bareme_taux: string | null;
  }>>([]);

  // ─── Données collaborateur ──────────────────────────────────────────────
  interface CollabRegime {
    _id: string;       // id local pour le rendu (uuid de la base, ou temp pour les nouveaux)
    isNew?: boolean;
    id?: string;
    collaborateur_id: string;
    code_regime: string;
    matricule_organisme: string | null;
    date_affiliation: string | null;
    date_radiation: string | null;
    actif: boolean;
    valeur_bareme_taux: number | null;
    code_variante_regime: string | null;
    code_categorie_base: number | null;
  }
  const [rows, setRows] = useState<CollabRegime[]>([]);
  // Options de taux par code de barème (ex. "TAUX_CIMR"), résolues dynamiquement
  // depuis bareme_ligne — aucune valeur codée en dur côté frontend.
  const [baremeOptions, setBaremeOptions] = useState<
    Record<string, Array<{ valeur: number; patronal: number | null }>>
  >({});
  // Variantes de catégorie (ref_categorie_regime), groupées par code_regime —
  // générique : n'importe quel régime peut porter des variantes (CIMR aujourd'hui,
  // potentiellement CNOPS/RCAR demain), sans changement de code ici.
  const [categoriesParRegime, setCategoriesParRegime] = useState<Record<string, Array<{
    code_variante: string; libelle: string; borne_min: number; borne_max: number;
    gere_tranche: boolean; offset_tranche2: number | null;
  }>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  // ─── Chargement initial ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: regs }, { data: rs }, { data: lignes }, { data: compos }] = await Promise.all([
      supabase.from("ref_regime_cotisation" as never)
        .select("code,libelle,organisme,code_regle_cotisation")
        .eq("actif" as never, true as never)
        .order("ordre" as never),
      supabase.from("regle_calcul_cotisation" as never)
        .select("code,libelle")
        .eq("archive" as never, false as never),
      supabase.from("collaborateur_regime" as never)
        .select("*")
        .eq("collaborateur_id" as never, collaborateurId as never),
      supabase.from("regle_calcul_cotisation_composante" as never)
        .select("id_regle,code")
        .eq("actif" as never, true as never),
    ]);

    setRegimes((regs || []) as any[]);

    // Compter les composantes par règle (pour le badge)
    const composByRegle: Record<string, number> = {};
    ((compos || []) as any[]).forEach((c: any) => {
      composByRegle[c.id_regle] = (composByRegle[c.id_regle] || 0) + 1;
    });

    // Joindre nb_composantes — il faut récupérer l'id de la règle depuis son code
    const { data: reglesAvecId } = await supabase.from("regle_calcul_cotisation" as never)
      .select("id,code,libelle,code_bareme_taux")
      .eq("archive" as never, false as never);
    const enrichedRegles = ((reglesAvecId || []) as any[]).map((r: any) => ({
      code: r.code, libelle: r.libelle,
      nb_composantes: composByRegle[r.id] || 0,
      code_bareme_taux: r.code_bareme_taux || null,
    }));
    setRegles(enrichedRegles);

    // ─── Résolution dynamique des taux variables (ex. TAUX_CIMR) ──────────
    // Toute règle portant un code_bareme_taux propose un sélecteur alimenté
    // depuis bareme/bareme_ligne — générique, pas spécifique à la CIMR.
    const codesBareme = Array.from(
      new Set(enrichedRegles.map(r => r.code_bareme_taux).filter(Boolean))
    ) as string[];

    if (codesBareme.length > 0) {
      const { data: baremesTrouves } = await supabase.from("bareme" as never)
        .select("id,code")
        .in("code" as never, codesBareme as never)
        .eq("actif" as never, true as never)
        .eq("archive" as never, false as never);

      const idVersCode: Record<string, string> = {};
      ((baremesTrouves || []) as any[]).forEach(b => { idVersCode[b.id] = b.code; });
      const baremeIds = Object.keys(idVersCode);

      if (baremeIds.length > 0) {
        const { data: lignesBareme } = await supabase.from("bareme_ligne" as never)
          .select("bareme_id,valeurs_cles,valeurs_sorties,ordre")
          .in("bareme_id" as never, baremeIds as never)
          .order("ordre" as never);

        const options: Record<string, Array<{ valeur: number; patronal: number | null }>> = {};
        ((lignesBareme || []) as any[]).forEach(l => {
          const codeBareme = idVersCode[l.bareme_id];
          const valeur = l.valeurs_cles?.taux_salarial;
          if (codeBareme === undefined || valeur === undefined) return;
          if (!options[codeBareme]) options[codeBareme] = [];
          options[codeBareme].push({
            valeur: Number(valeur),
            patronal: l.valeurs_sorties?.taux_patronal != null ? Number(l.valeurs_sorties.taux_patronal) : null,
          });
        });
        setBaremeOptions(options);
      }
    } else {
      setBaremeOptions({});
    }

    // ─── Référentiel des variantes de catégorie, par régime ────────────────
    // Table générique : groupée par code_regime pour que n'importe quelle
    // affectation (CIMR aujourd'hui, d'autres régimes demain) trouve ses
    // variantes sans logique spécifique câblée ici.
    const { data: categoriesData } = await supabase.from("ref_categorie_regime" as never)
      .select("code_regime,code_variante,libelle,borne_min,borne_max,gere_tranche,offset_tranche2" as never)
      .eq("actif" as never, true as never)
      .order("ordre" as never);
    const groupees: Record<string, Array<{
      code_variante: string; libelle: string; borne_min: number; borne_max: number;
      gere_tranche: boolean; offset_tranche2: number | null;
    }>> = {};
    ((categoriesData || []) as any[]).forEach(c => {
      if (!groupees[c.code_regime]) groupees[c.code_regime] = [];
      groupees[c.code_regime].push({
        code_variante: c.code_variante, libelle: c.libelle,
        borne_min: c.borne_min, borne_max: c.borne_max,
        gere_tranche: c.gere_tranche, offset_tranche2: c.offset_tranche2,
      });
    });
    setCategoriesParRegime(groupees);

    setRows(((lignes || []) as any[]).map((l: any) => ({
      _id: l.id, id: l.id,
      collaborateur_id: l.collaborateur_id,
      code_regime: l.code_regime,
      matricule_organisme: l.matricule_organisme || "",
      date_affiliation: l.date_affiliation || "",
      date_radiation: l.date_radiation || "",
      actif: l.actif !== false,
      valeur_bareme_taux: l.valeur_bareme_taux ?? null,
      code_variante_regime: l.code_variante_regime || null,
      code_categorie_base: l.code_categorie_base ?? null,
    })));
    setDeletedIds([]);
    setLoading(false);
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  // ─── Helpers ────────────────────────────────────────────────────────────
  const uid = () => "tmp_" + Math.random().toString(36).slice(2);

  // Régimes déjà utilisés (pour ne pas proposer de doublon)
  const usedRegimes = new Set(rows.map(r => r.code_regime).filter(Boolean));

  const labelRegle = (codeRegime: string | null) => {
    const reg = regimes.find(r => r.code === codeRegime);
    if (!reg?.code_regle_cotisation) return null;
    return regles.find(rg => rg.code === reg.code_regle_cotisation);
  };

  // ─── CRUD local ─────────────────────────────────────────────────────────
  const addRow = () => {
    // Premier régime non encore utilisé, sinon vide
    const firstAvailable = regimes.find(r => !usedRegimes.has(r.code))?.code || "";
    setRows(prev => [...prev, {
      _id: uid(), isNew: true,
      collaborateur_id: collaborateurId,
      code_regime: firstAvailable,
      matricule_organisme: "",
      date_affiliation: "",
      date_radiation: "",
      actif: true,
      valeur_bareme_taux: null,
      code_variante_regime: null,
      code_categorie_base: null,
    }]);
  };

  const updateRow = (_id: string, patch: Partial<CollabRegime>) =>
    setRows(prev => prev.map(r => r._id === _id ? { ...r, ...patch } : r));

  const removeRow = (_id: string) => {
    const row = rows.find(r => r._id === _id);
    if (row?.id) setDeletedIds(prev => [...prev, row.id!]);
    setRows(prev => prev.filter(r => r._id !== _id));
  };

  // ─── Sauvegarde ─────────────────────────────────────────────────────────
  const saveAll = async () => {
    // Validation : pas de doublon de régime
    const codes = rows.map(r => r.code_regime).filter(Boolean);
    if (new Set(codes).size !== codes.length) {
      toast.error("Un même régime ne peut être affecté qu'une seule fois.");
      return;
    }
    if (rows.some(r => !r.code_regime)) {
      toast.error("Toutes les lignes doivent avoir un régime sélectionné.");
      return;
    }
    // Un régime dont la règle porte un barème de taux (ex. CIMR) exige un taux choisi
    const ligneSansTaux = rows.find(r => {
      const regle = labelRegle(r.code_regime);
      return regle?.code_bareme_taux && (r.valeur_bareme_taux === null || r.valeur_bareme_taux === undefined);
    });
    if (ligneSansTaux) {
      toast.error("Un taux de cotisation doit être choisi pour ce régime.");
      return;
    }
    // Tout régime portant des variantes de catégorie (ex. CIMR) exige un choix complet
    const ligneCategorieIncomplete = rows.find(r => {
      const variantes = categoriesParRegime[r.code_regime];
      if (!variantes || variantes.length === 0) return false;
      if (!r.code_variante_regime || r.code_categorie_base === null || r.code_categorie_base === undefined) return true;
      const variante = variantes.find(c => c.code_variante === r.code_variante_regime);
      if (!variante) return true;
      return r.code_categorie_base < variante.borne_min || r.code_categorie_base > variante.borne_max;
    });
    if (ligneCategorieIncomplete) {
      toast.error("La catégorie (variante + code) est incomplète ou hors plage autorisée.");
      return;
    }

    setSaving(true);

    // Suppressions
    if (deletedIds.length > 0) {
      const { error } = await supabase.from("collaborateur_regime" as never)
        .delete().in("id" as never, deletedIds as never);
      if (error) { toast.error(error.message); setSaving(false); return; }
    }

    // Updates + inserts
    for (const r of rows) {
      const payload: any = {
        collaborateur_id: collaborateurId,
        code_regime: r.code_regime,
        matricule_organisme: r.matricule_organisme || null,
        date_affiliation: r.date_affiliation || null,
        date_radiation: r.date_radiation || null,
        actif: r.actif,
        valeur_bareme_taux: r.valeur_bareme_taux ?? null,
        code_variante_regime: categoriesParRegime[r.code_regime]?.length ? (r.code_variante_regime || null) : null,
        code_categorie_base: categoriesParRegime[r.code_regime]?.length ? (r.code_categorie_base ?? null) : null,
      };
      if (r.isNew || !r.id) {
        const { error } = await supabase.from("collaborateur_regime" as never)
          .insert(payload as never);
        if (error) { toast.error(error.message); setSaving(false); return; }
      } else {
        const { error } = await supabase.from("collaborateur_regime" as never)
          .update(payload as never).eq("id" as never, r.id as never);
        if (error) { toast.error(error.message); setSaving(false); return; }
      }
    }

    toast.success("Immatriculations enregistrées");
    setSaving(false);
    onSave?.();
    load();
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))" };

  return (
    <div>
      <SectionCard
        title="Immatriculations sociales"
        icon={<Shield size={15} />}
        action={
          <div className="flex gap-2">
            <button onClick={addRow}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border"
              style={{ borderColor: "hsl(var(--accent))", color: "hsl(var(--accent))" }}>
              <Plus size={12} /> Ajouter
            </button>
            <button onClick={saveAll} disabled={saving || loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              <Save size={12} /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        }
      >
        {loading ? (
          <p className="text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
            Chargement…
          </p>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg"
            style={{ borderColor: "hsl(var(--border))" }}>
            <Shield size={28} strokeWidth={1.5} className="mx-auto mb-2"
              style={{ color: "hsl(var(--muted-foreground))" }} />
            <p className="text-sm mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
              Aucune immatriculation enregistrée
            </p>
            <button onClick={addRow}
              className="flex items-center gap-1 mx-auto px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              <Plus size={12} /> Ajouter un premier régime
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Régime *</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Numéro</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Date début</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Date fin</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Règle de cotisation</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Taux</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Catégorie</th>
                  <th className="text-center text-xs font-semibold uppercase tracking-wide py-2 px-2"
                    style={{ color: "hsl(var(--muted-foreground))" }}>Actif</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const regle = labelRegle(r.code_regime);
                  return (
                    <tr key={r._id} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                      <td className="py-2 px-2">
                        <select value={r.code_regime}
                          onChange={e => updateRow(r._id, { code_regime: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-lg border text-sm" style={inputStyle}>
                          <option value="">— Sélectionner —</option>
                          {regimes
                            .filter(reg => reg.code === r.code_regime || !usedRegimes.has(reg.code))
                            .map(reg => (
                              <option key={reg.code} value={reg.code}>
                                {reg.libelle}{reg.organisme ? ` (${reg.organisme})` : ""}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input type="text" value={r.matricule_organisme || ""}
                          onChange={e => updateRow(r._id, { matricule_organisme: e.target.value })}
                          placeholder="N° d'immatriculation"
                          className="w-full px-2 py-1.5 rounded-lg border text-sm" style={inputStyle} />
                      </td>
                      <td className="py-2 px-2">
                        <input type="date" value={r.date_affiliation || ""}
                          onChange={e => updateRow(r._id, { date_affiliation: e.target.value })}
                          min="1950-01-01" max="2099-12-31"
                          className="w-full px-2 py-1.5 rounded-lg border text-sm" style={inputStyle} />
                      </td>
                      <td className="py-2 px-2">
                        <input type="date" value={r.date_radiation || ""}
                          onChange={e => updateRow(r._id, { date_radiation: e.target.value })}
                          min="1950-01-01" max="2099-12-31"
                          className="w-full px-2 py-1.5 rounded-lg border text-sm" style={inputStyle} />
                      </td>
                      <td className="py-2 px-2">
                        {regle ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-2 py-0.5 rounded font-mono"
                              style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                              {regle.code}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                              {regle.nb_composantes} compo.
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {r.code_regime ? "Aucune règle liée" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {regle?.code_bareme_taux ? (
                          <select
                            value={r.valeur_bareme_taux ?? ""}
                            onChange={e => updateRow(r._id, {
                              valeur_bareme_taux: e.target.value ? Number(e.target.value) : null,
                            })}
                            className="w-full px-2 py-1.5 rounded-lg border text-sm" style={inputStyle}>
                            <option value="">— Taux —</option>
                            {(baremeOptions[regle.code_bareme_taux] || []).map(opt => (
                              <option key={opt.valeur} value={opt.valeur}>
                                {opt.valeur.toFixed(2)}%{opt.patronal != null ? ` sal. / ${opt.patronal.toFixed(2)}% pat.` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        {(categoriesParRegime[r.code_regime]?.length ?? 0) > 0 ? (
                          <div className="flex gap-1">
                            <select
                              value={r.code_variante_regime ?? ""}
                              onChange={e => updateRow(r._id, {
                                code_variante_regime: e.target.value || null,
                                code_categorie_base: null, // la plage change, on réinitialise
                              })}
                              className="w-full px-2 py-1.5 rounded-lg border text-sm" style={inputStyle}>
                              <option value="">— Variante —</option>
                              {categoriesParRegime[r.code_regime].map(c => (
                                <option key={c.code_variante} value={c.code_variante}>{c.libelle}</option>
                              ))}
                            </select>
                            {r.code_variante_regime && (() => {
                              const variante = categoriesParRegime[r.code_regime]?.find(c => c.code_variante === r.code_variante_regime);
                              if (!variante) return null;
                              return (
                                <input type="number"
                                  min={variante.borne_min} max={variante.borne_max}
                                  value={r.code_categorie_base ?? ""}
                                  onChange={e => updateRow(r._id, {
                                    code_categorie_base: e.target.value ? Number(e.target.value) : null,
                                  })}
                                  placeholder={`${String(variante.borne_min).padStart(2, "0")}-${String(variante.borne_max).padStart(2, "0")}`}
                                  title={variante.gere_tranche
                                    ? `Code tranche basse. Tranche haute = code + ${variante.offset_tranche2}, calculé automatiquement au-delà du seuil.`
                                    : "Code attribué par l'organisme pour cette variante"}
                                  className="w-20 px-2 py-1.5 rounded-lg border text-sm" style={inputStyle} />
                              );
                            })()}
                          </div>
                        ) : (
                          <span className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <input type="checkbox" checked={r.actif}
                          onChange={e => updateRow(r._id, { actif: e.target.checked })}
                          className="rounded border-border" />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button onClick={() => removeRow(r._id)}
                          className="p-1 rounded hover:bg-muted">
                          <Trash2 size={13} style={{ color: "hsl(0 84% 55%)" }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] mt-3" style={{ color: "hsl(var(--muted-foreground))" }}>
              La règle de cotisation est déterminée automatiquement par le régime sélectionné
              (paramétré dans <strong>Référentiels &rarr; Régimes de cotisation</strong>).
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

/* SYNDICAL — délégué au composant SyndicalMandatForm */
const TabSyndical: React.FC<{ collaborateurId: string }> = ({ collaborateurId }) => (
  <SyndicalMandatForm collaborateurId={collaborateurId} />
);

/* DIVERS */
const DIVERS_EMPTY = {
  metier_base: "",
  communication_autorisee: false,
  technicien: false,
  premier_emploi: false,
  permis_conduire: false,
  secouriste: false,
  pompier: false,
  electeur: false,
  eligible: false,
  membre_association: false,
  est_handicape: false,
  est_mutile: false,
  taux_ipp: "" as string,
  pension: "" as string,
  rente: "" as string,
  code_statut: "",
  code_situation: "",
};

const TabDivers: React.FC<{ collaborateurId: string }> = ({ collaborateurId }) => {
  const [divers, setDivers] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(DIVERS_EMPTY);
  const [existingId, setExistingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("collaborateur_divers")
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .maybeSingle();

    if (data) {
      setDivers(data);
      setExistingId((data as any).id);
    } else {
      setDivers(null);
      setExistingId(null);
    }
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => {
    if (divers) {
      setForm({
        metier_base: divers.metier_base || "",
        communication_autorisee: divers.communication_autorisee,
        technicien: divers.technicien,
        premier_emploi: divers.premier_emploi,
        permis_conduire: divers.permis_conduire,
        secouriste: divers.secouriste,
        pompier: divers.pompier,
        electeur: divers.electeur,
        eligible: divers.eligible,
        membre_association: divers.membre_association,
        est_handicape: divers.est_handicape,
        est_mutile: divers.est_mutile,
        taux_ipp: divers.taux_ipp != null ? String(divers.taux_ipp) : "",
        pension: divers.pension != null ? String(divers.pension) : "",
        rente: divers.rente != null ? String(divers.rente) : "",
        code_statut: divers.code_statut || "",
        code_situation: divers.code_situation || "",
      });
    } else {
      setForm(DIVERS_EMPTY);
    }
    setEditing(true);
  };

  const save = async () => {
    const payload: any = {
      collaborateur_id: collaborateurId,
      metier_base: form.metier_base || null,
      communication_autorisee: form.communication_autorisee,
      technicien: form.technicien,
      premier_emploi: form.premier_emploi,
      permis_conduire: form.permis_conduire,
      secouriste: form.secouriste,
      pompier: form.pompier,
      electeur: form.electeur,
      eligible: form.eligible,
      membre_association: form.membre_association,
      est_handicape: form.est_handicape,
      est_mutile: form.est_mutile,
      taux_ipp: form.taux_ipp ? parseFloat(form.taux_ipp) : null,
      pension: form.pension ? parseFloat(form.pension) : null,
      rente: form.rente ? parseFloat(form.rente) : null,
      code_statut: form.code_statut || null,
      code_situation: form.code_situation || null,
    };
    if (existingId) {
      const { error } = await supabase.from("collaborateur_divers").update(payload as any).eq("id", existingId);
      if (error) { toast.error(error.message); return; }
      toast.success("Informations diverses mises à jour");
    } else {
      const { error } = await supabase.from("collaborateur_divers").insert(payload as any);
      if (error) { toast.error(error.message); return; }
      toast.success("Informations diverses enregistrées");
    }
    setEditing(false);
    load();
  };

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", height: 38 };

  const BoolToggle: React.FC<{ label: string; field: string }> = ({ label, field }) => (
    <div className="flex items-center justify-between py-1.5 px-2 rounded cursor-pointer"
      style={{ background: (form as any)[field] ? "hsl(84 55% 50% / 0.08)" : "transparent" }}
      onClick={() => set(field, !(form as any)[field])}>
      <span className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{label}</span>
      <div className="w-5 h-5 rounded border flex items-center justify-center transition-colors"
        style={{
          borderColor: (form as any)[field] ? "hsl(var(--accent))" : "hsl(var(--border))",
          background: (form as any)[field] ? "hsl(var(--accent))" : "transparent",
        }}>
        {(form as any)[field] && <Check size={12} style={{ color: "white" }} />}
      </div>
    </div>
  );

  const BoolField: React.FC<{ label: string; value?: boolean }> = ({ label, value }) => (
    <div className="flex items-center justify-between py-1.5 px-2 rounded" style={{ background: value ? "hsl(84 55% 50% / 0.08)" : "transparent" }}>
      <span className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: value ? "hsl(84 55% 40%)" : "hsl(var(--muted-foreground))" }}>{value ? "Oui" : "Non"}</span>
    </div>
  );

  return (
    <div>
      <SectionCard title="Informations diverses" icon={<Settings size={15} />} action={
        !editing ? (
          <button onClick={startEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "hsl(var(--accent))", color: "white" }}>
            {divers ? <><Pencil size={12} /> Modifier</> : <><Plus size={12} /> Saisir</>}
          </button>
        ) : null
      }>
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Indicateurs */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--accent))" }}>Indicateurs</p>
                <div className="space-y-1 rounded-lg p-2" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                  <BoolToggle label="Communication autorisée" field="communication_autorisee" />
                  <BoolToggle label="Technicien" field="technicien" />
                  <BoolToggle label="Premier emploi" field="premier_emploi" />
                  <BoolToggle label="Permis de conduire" field="permis_conduire" />
                  <BoolToggle label="Secouriste" field="secouriste" />
                  <BoolToggle label="Pompier" field="pompier" />
                  <BoolToggle label="Électeur" field="electeur" />
                  <BoolToggle label="Éligible" field="eligible" />
                  <BoolToggle label="Membre association" field="membre_association" />
                </div>
              </div>
              {/* Handicap */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "hsl(0 84% 60%)" }}>Handicap / Invalidité</p>
                <div className="space-y-1 rounded-lg p-2 mb-3" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                  <BoolToggle label="Est handicapé" field="est_handicape" />
                  <BoolToggle label="Est mutilé" field="est_mutile" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Taux IPP (%)</label>
                    <input type="number" step="0.01" min="0" max="100" value={form.taux_ipp} onChange={e => set("taux_ipp", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Pension</label>
                    <input type="number" step="0.01" min="0" value={form.pension} onChange={e => set("pension", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Rente</label>
                    <input type="number" step="0.01" min="0" value={form.rente} onChange={e => set("rente", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Métier de base</label>
                    <input type="text" value={form.metier_base} onChange={e => set("metier_base", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle} />
                  </div>
                </div>
              </div>
            </div>
            {/* Statut & Situation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RefSelect label="Statut" table="ref_statut" value={form.code_statut} onChange={v => set("code_statut", v)} />
              <RefSelect label="Situation" table="ref_situation" value={form.code_situation} onChange={v => set("code_situation", v)} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border font-semibold"
                style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                <X size={13} /> Annuler
              </button>
              <button onClick={save} className="flex items-center gap-1 text-xs px-4 py-1.5 rounded-lg font-semibold"
                style={{ background: "hsl(var(--accent))", color: "white" }}>
                <Save size={13} /> Enregistrer
              </button>
            </div>
          </div>
        ) : !divers ? (
          <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune information diverse enregistrée</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--accent))" }}>Indicateurs</p>
              <div className="space-y-1 rounded-lg p-2" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                <BoolField label="Communication autorisée" value={divers.communication_autorisee} />
                <BoolField label="Technicien" value={divers.technicien} />
                <BoolField label="Premier emploi" value={divers.premier_emploi} />
                <BoolField label="Permis de conduire" value={divers.permis_conduire} />
                <BoolField label="Secouriste" value={divers.secouriste} />
                <BoolField label="Pompier" value={divers.pompier} />
                <BoolField label="Électeur" value={divers.electeur} />
                <BoolField label="Éligible" value={divers.eligible} />
                <BoolField label="Membre association" value={divers.membre_association} />
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "hsl(0 84% 60%)" }}>Handicap / Invalidité</p>
              <div className="space-y-1 rounded-lg p-2 mb-3" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                <BoolField label="Est handicapé" value={divers.est_handicape} />
                <BoolField label="Est mutilé" value={divers.est_mutile} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Taux IPP (%)" value={divers.taux_ipp != null ? `${divers.taux_ipp}%` : undefined} />
                <Field label="Pension" value={divers.pension != null ? `${divers.pension}` : undefined} />
                <Field label="Rente" value={divers.rente != null ? `${divers.rente}` : undefined} />
                <Field label="Métier de base" value={divers.metier_base} />
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
};

/* ──────────────── HEADER AVEC PHOTO ──────────────── */
const STATUT_LABELS: Record<string, string> = { ACTIF: "Actif", EN_DEPART: "En départ", SORTI: "Sorti" };

const CollabHeader: React.FC<{
  collab: Collaborateur;
  statutStyle: { bg: string; color: string };
  onPhotoUpdated: () => void;
  visibleTabs: { id: string; label: string; icon: React.ReactNode }[];
  tabCounts: Record<string, number>;
  activeTab: string;
  onSelectTab: (id: string) => void;
}> = ({ collab, statutStyle, onPhotoUpdated, visibleTabs, tabCounts, activeTab, onSelectTab }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handlePhotoClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Upload vers le backend FastAPI (le fichier est nommé d'après l'UUID
      // du collaborateur, ce qui écrase automatiquement l'ancienne photo).
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `http://localhost:8000/api/v1/storage/photos_collaborateurs/${collab.id}`,
        { method: "POST", body: formData }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        alert("Erreur upload photo : " + ((err as any).detail || response.statusText));
        return;
      }

      const result = await response.json();

      // Cache-busting : ajoute un timestamp pour forcer le rechargement
      // de l'image dans le navigateur même si le nom de fichier est identique.
      const urlWithBust = `${result.publicUrl}?v=${Date.now()}`;

      // Mettre à jour le chemin de la photo en base
      await supabase.from("collaborateurs")
        .update({ photo_path: urlWithBust })
        .eq("id", collab.id);

      onPhotoUpdated();
    } catch (e: any) {
      console.error("Erreur upload photo :", e);
      alert("Erreur upload photo : " + (e?.message || e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const initials = `${collab.prenom?.[0] || ""}${collab.nom?.[0] || ""}`.toUpperCase();
  const statutLabel = STATUT_LABELS[collab.statut_collaborateur] || collab.statut_collaborateur;

  return (
    <div className="overflow-hidden mb-0 relative"
      style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderBottom: "none",
        borderRadius: "var(--radius)",
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }}>
      {/* Bandeau d'ambiance — dégradé très subtil dérivé de la couleur de statut, purement décoratif */}
      <div className="absolute inset-x-0 top-0 h-24 pointer-events-none"
        style={{ background: `linear-gradient(180deg, ${statutStyle.bg}, transparent)`, opacity: 0.6 }} />

      <div className="relative px-6 py-5 flex items-start gap-6 flex-wrap">
        {/* Avatar avec anneau de statut */}
        <div className="relative flex-shrink-0 group cursor-pointer" onClick={handlePhotoClick} title="Changer la photo">
          <div className="rounded-[calc(var(--radius)+4px)] p-[3px] transition-transform duration-200 group-hover:scale-[1.03]"
            style={{ background: `linear-gradient(135deg, ${statutStyle.color}, ${statutStyle.color} 40%, hsl(var(--border)) 100%)` }}>
            {collab.photo_path ? (
              <img
                src={collab.photo_path}
                alt={`${collab.prenom} ${collab.nom}`}
                className="w-[88px] h-[88px] object-cover"
                style={{ borderRadius: "var(--radius)", background: "hsl(var(--card))" }}
              />
            ) : (
              <div className="w-[88px] h-[88px] flex items-center justify-center text-[28px] font-bold"
                style={{
                  background: "hsl(var(--muted))",
                  color: "hsl(var(--foreground) / 0.55)",
                  borderRadius: "var(--radius)",
                }}>
                {initials}
              </div>
            )}
          </div>
          {/* Pastille de statut, à l'ancre inférieure droite de l'avatar */}
          <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-6 h-6 rounded-full shadow-sm"
            style={{ background: "hsl(var(--card))", border: "2px solid hsl(var(--card))" }}>
            <span className="w-3.5 h-3.5 rounded-full" style={{ background: statutStyle.color }} />
          </span>
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "hsl(var(--foreground) / 0.55)", borderRadius: "calc(var(--radius) + 4px)" }}>
            {uploading
              ? <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} />
              : <Camera size={18} style={{ color: "white" }} />
            }
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>

        {/* Bloc identité + infos */}
        <div className="flex-1 min-w-0">
          {collab.civilite && (
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              {collab.civilite}
            </p>
          )}
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[23px] font-bold leading-none tracking-tight" style={{ color: "hsl(var(--foreground))" }}>
              {collab.prenom} {collab.nom?.toUpperCase()}
            </h1>
            <span className="text-[12px] font-mono px-1.5 py-0.5 rounded" style={{ color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted) / 0.6)" }}>
              #{collab.matricule}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
              style={{ background: statutStyle.bg, color: statutStyle.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: statutStyle.color }} />
              {statutLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-3.5 flex-wrap text-[12.5px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            {collab.email_professionnel && (
              <a href={`mailto:${collab.email_professionnel}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors"
                style={{ background: "hsl(var(--muted) / 0.5)" }}
                onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--primary) / 0.1)"; e.currentTarget.style.color = "hsl(var(--primary))"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "hsl(var(--muted) / 0.5)"; e.currentTarget.style.color = ""; }}>
                <Mail size={12.5} /><span>{collab.email_professionnel}</span>
              </a>
            )}
            {collab.gsm && (
              <a href={`tel:${collab.gsm}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors"
                style={{ background: "hsl(var(--muted) / 0.5)" }}
                onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--primary) / 0.1)"; e.currentTarget.style.color = "hsl(var(--primary))"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "hsl(var(--muted) / 0.5)"; e.currentTarget.style.color = ""; }}>
                <Phone size={12.5} /><span>{collab.gsm}</span>
              </a>
            )}
            {collab.date_naissance && (() => {
              const age = Math.floor((Date.now() - new Date(collab.date_naissance!).getTime()) / (365.25 * 24 * 3600 * 1000));
              return (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "hsl(var(--muted) / 0.5)" }}>
                  <Calendar size={12.5} />
                  <span>Né(e) le {fmtDate(collab.date_naissance)}<span style={{ opacity: 0.65, marginLeft: 5 }}>· {age} ans</span></span>
                </span>
              );
            })()}
          </div>
        </div>

        {/* Smart buttons façon Odoo : compteurs cliquables, ouvrent l'onglet correspondant */}
        <div className="flex items-stretch flex-wrap" style={{ borderLeft: "1px solid hsl(var(--border))", paddingLeft: 20, marginLeft: "auto" }}>
          {visibleTabs
            .filter(t => tabCounts[t.id] !== undefined)
            .slice(0, 5)
            .map(t => {
              const isActive = activeTab === t.id;
              const accent = TAB_BADGE_COLORS[t.id] ?? "var(--primary)";
              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTab(t.id)}
                  className="relative flex flex-col items-center justify-center px-3.5 py-1 min-w-[64px] transition-all duration-150"
                  style={{
                    borderRight: "1px solid hsl(var(--border))",
                    background: isActive ? `hsl(${accent} / 0.08)` : "transparent",
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "hsl(var(--muted) / 0.4)"; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <span className="text-[18px] font-bold tabular-nums" style={{ color: isActive ? `hsl(${accent})` : "hsl(var(--foreground))" }}>
                    {tabCounts[t.id]}
                  </span>
                  <span className="text-[10.5px] font-medium text-center leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {t.label}
                  </span>
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full" style={{ background: `hsl(${accent})` }} />
                  )}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
};

// RG-MGR-FICHE-01 : Le manager n'accède qu'aux onglets Identité, Contrats, Affectation, Rémunération en lecture seule
const TABS_MANAGER = ["identite", "contrats", "affectation", "remuneration"];

/* ──────────────── PAGE PRINCIPALE ──────────────── */
const FicheCollaborateur: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // RG-NAV-CTX-01 (Adil DAIA) : Navigation Précédent/Suivant entre collaborateurs filtrés
  const nav = useListNavigationContext("collaborateurs", id);
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [collab, setCollab] = useState<Collaborateur | null>(null);
  // Charge les masques d'affichage (remplit le cache lu par fmtDate/fmtMoney)
  // Le re-render au chargement propage les bons formats à tous les sous-composants.
  useFormatMasks();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("identite");
  const [showDepartForm, setShowDepartForm] = useState(false);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  const isManager = role === "manager";
  const visibleTabs = isManager ? TABS.filter(t => TABS_MANAGER.includes(t.id)) : TABS;

  const [accessBlocked, setAccessBlocked] = useState(false);

  const loadCollab = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      // Charger le collaborateur depuis l'API
      const { data, error } = await supabase
        .from("collaborateurs")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error("Erreur chargement collaborateur:", error);
        setCollab(null);
        setLoading(false);
        return;
      }

      if (data) {
        const c = data as Collaborateur;
        // CNDP : vérifier la rétention si le collaborateur est SORTI
        if (c.statut_collaborateur === "SORTI") {
          const [{ data: retParam }, { data: depData }] = await Promise.all([
            supabase.from("parametres_rh").select("valeur").eq("code", "DUREE_RETENTION_SORTIS").eq("actif", true).single(),
            supabase.from("collaborateur_departs").select("date_depart").eq("collaborateur_id", id).eq("statut", "TRAITE").order("date_depart", { ascending: false }).limit(1),
          ]);
          const retYears = (retParam as any)?.valeur ? parseInt((retParam as any).valeur, 10) : null;
          if (retYears && retYears > 0 && depData && depData.length > 0) {
            const cutoff = new Date();
            cutoff.setFullYear(cutoff.getFullYear() - retYears);
            if (new Date((depData as any[])[0].date_depart) < cutoff) {
              setAccessBlocked(true);
              setLoading(false);
              return;
            }
          }
        }
        setCollab(c);
      } else {
        setCollab(null);
      }
    } catch (e) {
      console.error("Exception chargement collaborateur:", e);
      setCollab(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadCollab(); }, [loadCollab]);

  // Compteurs des onglets (best-effort, tolérant aux erreurs)
  useEffect(() => {
    if (!collab?.id) return;
    let cancelled = false;
    (async () => {
      const cid = collab.id;
      const fetchCount = async (path: string): Promise<number> => {
        try {
          const data: any[] = await api.get(path);
          return Array.isArray(data) ? data.length : 0;
        } catch { return 0; }
      };

      const [contrats, affectations, qualifications, adresses, enfants, salaires, diplomes, comp, imm, synd] = await Promise.all([
        fetchCount(`/db/collaborateur_contrats?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_affectations?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_qualifications?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_adresses?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_enfants?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_salaires_fixes?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_diplomes?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_competences?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_immatriculations?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
        fetchCount(`/db/collaborateur_syndiques?collaborateur_id=eq.${cid}&archive=eq.false&select=id`),
      ]);

      if (cancelled) return;
      setTabCounts({
        contrats,
        affectation: affectations + qualifications,
        adresses,
        famille: enfants,
        remuneration: salaires,
        formation: diplomes + comp,
        immatriculation: imm,
        syndical: synd,
      });
    })();
    return () => { cancelled = true; };
  }, [collab?.id]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} />
    </div>
  );

  if (accessBlocked) return (
    <div className="p-6 text-center">
      <AlertCircle size={40} className="mx-auto mb-3" style={{ color: "hsl(var(--destructive))" }} />
      <p className="font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>Accès restreint</p>
      <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
        La durée de rétention des données de ce collaborateur sorti a expiré (conformité CNDP).
      </p>
      <button onClick={() => navigate("/collaborateurs")} className="mt-4 text-sm underline" style={{ color: "hsl(var(--accent))" }}>Retour à la liste</button>
    </div>
  );

  if (!collab) return (
    <div className="p-6 text-center">
      <p style={{ color: "hsl(var(--muted-foreground))" }}>Collaborateur introuvable</p>
      <button onClick={() => navigate("/collaborateurs")} className="mt-4 text-sm underline" style={{ color: "hsl(var(--accent))" }}>Retour à la liste</button>
    </div>
  );

  // Couleurs statut — fonctionnent en clair et en sombre (alpha-based)
  const statutStyle =
    collab.statut_collaborateur === "ACTIF"
      ? { bg: "hsl(142 70% 45% / 0.15)", color: "hsl(142 70% 38%)" }
      : collab.statut_collaborateur === "EN_DEPART"
        ? { bg: "hsl(35 95% 55% / 0.18)", color: "hsl(35 95% 45%)" }
        : collab.statut_collaborateur === "SORTI"
          ? { bg: "hsl(0 70% 50% / 0.15)", color: "hsl(0 70% 50%)" }
          : { bg: "hsl(215 16% 60% / 0.15)", color: "hsl(215 16% 50%)" };

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Fil d'Ariane façon Odoo */}
      <div className="flex items-center gap-1.5 px-6 md:px-8 pt-4 pb-2 text-[13px]"
        style={{ color: "hsl(var(--muted-foreground))" }}>
        <button onClick={() => navigate(isManager ? "/dashboard" : "/collaborateurs")} className="hover:underline">
          {isManager ? "Tableau de bord" : "Collaborateurs"}
        </button>
        <ChevronRight size={12} />
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
          {collab.prenom} {collab.nom}
        </span>

        {/* Navigation Précédent/Suivant — RG-NAV-CTX-01 */}
        {nav.hasContext && (
          <div className="flex items-center gap-1 pl-3 ml-1 border-l" style={{ borderColor: "hsl(var(--border))" }}>
            <button
              onClick={nav.goPrev}
              disabled={!nav.prevId}
              title="Collaborateur précédent (←)"
              className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              style={{ color: "hsl(var(--primary))" }}>
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-mono px-1 select-none">
              {nav.current} / {nav.total}
            </span>
            <button
              onClick={nav.goNext}
              disabled={!nav.nextId}
              title="Collaborateur suivant (→)"
              className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              style={{ color: "hsl(var(--primary))" }}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Barre d'actions façon Odoo : boutons à gauche, statusbar à droite */}
      <div className="px-6 md:px-8 pb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {isManager && (
            <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md font-semibold uppercase tracking-wider"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              <Eye size={11} /> Lecture seule
            </span>
          )}
          {!isManager && collab.statut_collaborateur !== "SORTI" && (
            <div className="flex items-center gap-1.5">
              {/* Saisir un congé — action discrète, gris dominant */}
              <button
                onClick={() => navigate(`/absences/saisie?collaborateur=${collab.id}`)}
                className="inline-flex items-center gap-2 text-[12px] font-medium px-3 py-1.5 transition-all"
                style={{
                  background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "hsl(var(--muted) / 0.5)";
                  e.currentTarget.style.borderColor = "hsl(var(--border))";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "hsl(var(--card))";
                  e.currentTarget.style.borderColor = "hsl(var(--border))";
                }}
              >
                <Plane size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                Saisir un congé
              </button>

              {/* Départ provisoire — bordure warning subtile */}
              <button
                onClick={() => navigate(`/departs-provisoires?collaborateur=${collab.id}`)}
                className="inline-flex items-center gap-2 text-[12px] font-medium px-3 py-1.5 transition-all"
                style={{
                  background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "hsl(var(--warning) / 0.08)";
                  e.currentTarget.style.borderColor = "hsl(var(--warning) / 0.4)";
                  e.currentTarget.style.color = "hsl(var(--warning))";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "hsl(var(--card))";
                  e.currentTarget.style.borderColor = "hsl(var(--border))";
                  e.currentTarget.style.color = "hsl(var(--foreground))";
                }}
              >
                <Clock size={13} style={{ color: "hsl(var(--warning))" }} />
                Départ provisoire
              </button>

              {/* Enregistrer un départ — bordure destructive subtile */}
              <button
                onClick={() => setShowDepartForm(true)}
                className="inline-flex items-center gap-2 text-[12px] font-medium px-3 py-1.5 transition-all"
                style={{
                  background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "hsl(var(--destructive) / 0.08)";
                  e.currentTarget.style.borderColor = "hsl(var(--destructive) / 0.4)";
                  e.currentTarget.style.color = "hsl(var(--destructive))";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "hsl(var(--card))";
                  e.currentTarget.style.borderColor = "hsl(var(--border))";
                  e.currentTarget.style.color = "hsl(var(--foreground))";
                }}
              >
                <DoorOpen size={13} style={{ color: "hsl(var(--destructive))" }} />
                {collab.statut_collaborateur === "EN_DEPART" ? "Voir le départ" : "Enregistrer un départ"}
              </button>
            </div>
          )}
        </div>

        {/* Statusbar façon Odoo : véritables chevrons en flèche, l'étape active en surbrillance */}
        <div className="flex items-center text-[11px] font-semibold uppercase tracking-wide">
          {["ACTIF", "EN_DEPART", "SORTI"].map((etape, i, arr) => {
            const isCurrent = collab.statut_collaborateur === etape
              || (etape === "ACTIF" && !["EN_DEPART", "SORTI"].includes(collab.statut_collaborateur));
            const passed = arr.indexOf(collab.statut_collaborateur) > i;
            const isFirst = i === 0;
            const isLast = i === arr.length - 1;
            // Découpe en pointe de flèche : plat à gauche pour la 1ʳᵉ étape, pointu partout ailleurs
            const clip = isLast
              ? (isFirst ? "none" : "polygon(0 0, 12px 50%, 0 100%, 100% 100%, 100% 0)")
              : (isFirst
                  ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
                  : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)");
            return (
              <span
                key={etape}
                className="relative flex items-center justify-center transition-all duration-200"
                style={{
                  padding: isFirst ? "7px 18px 7px 16px" : "7px 18px",
                  marginLeft: isFirst ? 0 : -11,
                  clipPath: clip,
                  background: isCurrent ? "hsl(var(--primary))" : passed ? "hsl(var(--muted))" : "hsl(var(--card))",
                  color: isCurrent ? "hsl(var(--primary-foreground, 0 0% 100%))" : "hsl(var(--muted-foreground))",
                  border: "1px solid hsl(var(--border))",
                  boxShadow: isCurrent ? "0 2px 6px hsl(var(--primary) / 0.35)" : "none",
                  zIndex: isCurrent ? 1 : 0,
                }}
              >
                {STATUT_LABELS[etape]}
              </span>
            );
          })}
        </div>
      </div>
      </div>

      <div className="px-6 md:px-8 pb-8">
      {/* Bandeau EN_DEPART */}
      {collab.statut_collaborateur === "EN_DEPART" && (
        <div className="flex items-center gap-2 px-4 py-2.5 mb-4"
          style={{ background: "hsl(var(--warning) / 0.10)", border: "1px solid hsl(var(--warning) / 0.25)", borderRadius: "var(--radius)" }}>
          <DoorOpen size={15} style={{ color: "hsl(var(--warning))", flexShrink: 0 }} />
          <p className="text-xs font-medium" style={{ color: "hsl(var(--warning))" }}>
            Ce collaborateur est en phase de départ. Le traitement automatique s'exécutera à la date de départ planifiée.
          </p>
        </div>
      )}

      {/* Header fiche + smart buttons (façon Odoo) */}
      <CollabHeader collab={collab} statutStyle={statutStyle} onPhotoUpdated={isManager ? () => {} : loadCollab}
        visibleTabs={visibleTabs} tabCounts={tabCounts} activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Onglets façon "notebook" Odoo : boîtes connectées au panneau de contenu */}
      <div className="flex flex-wrap gap-0.5 relative -mb-px z-[1]">
        {visibleTabs.map(tab => {
          const isActive = activeTab === tab.id;
          const count = tabCounts[tab.id];
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-2 px-4 py-2.5 text-[13px] whitespace-nowrap transition-all duration-150"
              style={{
                color: isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                fontWeight: isActive ? 600 : 500,
                background: isActive ? "hsl(var(--card))" : "hsl(var(--muted) / 0.5)",
                border: "1px solid hsl(var(--border))",
                borderBottom: isActive ? "1px solid hsl(var(--card))" : "1px solid hsl(var(--border))",
                borderTopLeftRadius: "var(--radius)",
                borderTopRightRadius: "var(--radius)",
                transform: isActive ? "translateY(-1px)" : "none",
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = "hsl(var(--foreground))"; e.currentTarget.style.background = "hsl(var(--muted) / 0.8)"; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = "hsl(var(--muted-foreground))"; e.currentTarget.style.background = "hsl(var(--muted) / 0.5)"; } }}>
              {isActive && (
                <span className="absolute top-0 left-0 right-0 h-[2px]"
                  style={{ background: `hsl(${TAB_BADGE_COLORS[tab.id] ?? "var(--primary)"})`, borderTopLeftRadius: "var(--radius)", borderTopRightRadius: "var(--radius)" }} />
              )}
              <span style={{ color: isActive ? `hsl(${TAB_BADGE_COLORS[tab.id] ?? "var(--primary)"})` : "currentColor" }}>{tab.icon}</span>
              <span>{tab.label}</span>
              {count !== undefined && count > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 text-[10px] font-bold tabular-nums rounded"
                  style={{
                    background: `hsl(${TAB_BADGE_COLORS[tab.id] ?? "var(--muted-foreground)"} / ${isActive ? 0.18 : 0.12})`,
                    color: `hsl(${TAB_BADGE_COLORS[tab.id] ?? "var(--muted-foreground)"})`,
                  }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ border: "1px solid hsl(var(--border))", borderTopLeftRadius: activeTab === visibleTabs[0]?.id ? 0 : "var(--radius)", borderRadius: "var(--radius)", background: "hsl(var(--card))" }} className="p-5">

      {/* Contenu onglet — manager : lecture seule via pointer-events-none */}
      <div className={isManager ? "pointer-events-none select-none opacity-90" : ""}>
        {activeTab === "identite" && <TabIdentite collab={collab} onSave={loadCollab} />}
        {activeTab === "contrats" && <TabContrats collaborateurId={collab.id} ancienMatricule={collab.ancien_matricule} />}
        {activeTab === "affectation" && <TabAffectation collaborateurId={collab.id} ancienMatricule={collab.ancien_matricule} />}
        {!isManager && activeTab === "adresses" && <TabAdresses collaborateurId={collab.id} />}
        
        {!isManager && activeTab === "famille" && <TabFamille collaborateurId={collab.id} />}
        {activeTab === "remuneration" && <TabRemuneration collaborateurId={collab.id} />}
        {!isManager && activeTab === "formation" && <TabFormation collaborateurId={collab.id} />}
        {!isManager && activeTab === "immatriculation" && <TabImmatriculation collaborateurId={collab.id} collab={collab} onSave={loadCollab} />}
        {!isManager && activeTab === "syndical" && <TabSyndical collaborateurId={collab.id} />}
        {!isManager && activeTab === "divers" && <TabDivers collaborateurId={collab.id} />}
      </div>
      </div>
      </div>

      {/* Modal départ */}
      {showDepartForm && (
        <DepartForm
          collaborateurId={collab.id}
          onClose={() => setShowDepartForm(false)}
          onSuccess={() => {
            setShowDepartForm(false);
            loadCollab();
            queryClient.invalidateQueries({ queryKey: ["departs"] });
          }}
        />
      )}
    </div>
  );
};

export default FicheCollaborateur;
