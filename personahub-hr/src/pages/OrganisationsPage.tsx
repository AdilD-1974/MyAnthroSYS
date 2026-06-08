import React, { useEffect, useState, useCallback, useRef, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ManagerReadOnlyContext } from "@/contexts/ManagerContext";
import {
  Building2, Network, Plus, Pencil, Trash2, Search,
  ChevronRight, ChevronDown, Check, X, AlertTriangle,
  ArrowLeft, CreditCard, FileText, Landmark, Shield, Link2, ExternalLink,
  List, GitBranch, GripVertical, MoveRight, Eye, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import InterimSelector from "@/components/affectation/InterimSelector";

/* ─── Types ─── */
interface Societe {
  id: string;
  code_societe?: string;
  siret?: string;
  raison_sociale: string;
  nom_commercial?: string;
  code_convention_collective?: string;
  code_secteur_activite?: string;
  code_naf?: string;
  adresse?: string;
  code_postal?: string;
  ville?: string;
  code_ville?: string;
  code_departement?: string;
  code_region?: string;
  code_pays?: string;
  telephone?: string;
  email?: string;
  site_web?: string;
  effectif?: number;
  actif: boolean;
  forme_juridique?: string;
  identifiant_fiscal?: string;
  registre_commerce?: string;
  ice?: string;
  patente?: string;
  capital_social?: number;
  code_devise_capital?: string;
  nom_gerant?: string;
  conseil_administration?: string;
  logo_path?: string;
  date_creation_societe?: string;
}

interface CompteBancaire {
  id: string;
  societe_id: string;
  code_banque: string;
  agence?: string;
  numero_compte: string;
  iban?: string;
  swift?: string;
  code_devise: string;
  date_ouverture?: string;
  actif: boolean;
}

interface Affiliation {
  id: string;
  societe_id: string;
  code_type_affiliation: string;
  numero_affiliation?: string;
  date_adhesion?: string;
  date_fin?: string;
}

interface UniteOrg {
  id: string; etablissement_id: string; parent_id?: string; code?: string; libelle: string;
  type_uo?: string; niveau?: number; actif: boolean;
  lieu?: string; batiment?: string; etage?: string; bureau?: string;
  adresse_societe?: boolean; adresse_complete?: string;
  code_pays?: string; code_region?: string; code_ville?: string; code_postal?: string;
  telephone?: string; email?: string;
  // RG-UO-RESP-01 (Adil DAIA) : Responsable de l'UO (collaborateur résolu dynamiquement)
  responsable_id?: string;
  // RG-UO-RESP-02 (Adil DAIA) : Poste désigné comme poste de responsable de l'UO
  // Le collaborateur titulaire de ce poste devient automatiquement le responsable de l'UO
  poste_responsable_code?: string;
  // RG-UO-RESP-05 (Adil DAIA) : Indicateur de type de responsable
  // false = titulaire du poste (Manager UO officiel), true = responsable temporaire saisi manuellement en cas de vacance
  responsable_temporaire?: boolean | null;
}

interface UORattachement {
  id: string;
  parent_uo_id: string;
  enfant_uo_id: string;
  date_debut: string;
  date_fin?: string;
  actif: boolean;
  reference_decision?: string;
  date_decision?: string;
}

interface RefItem { code: string; libelle: string; }
// RG-UO-COULEUR-01 (Adil DAIA) : Le champ couleur du type UO colorise les libellés dans l'organigramme
interface RefTypeUo { code: string; libelle: string; niveau?: number; ordre?: number; couleur?: string; }
interface RefRegion { code: string; libelle: string; code_pays?: string; }
interface RefVille { code: string; libelle: string; code_region?: string; code_postal?: string; }
interface RefBanque { code: string; libelle: string; swift?: string; }
interface RefDevise { code: string; libelle: string; symbole?: string; }

// Mapping établissement → société (pour résolution transparente)
interface EtabMinimal { id: string; societe_id: string; }

const EMPTY_SOCIETE: Partial<Societe> = {
  code_societe: "",
  raison_sociale: "", nom_commercial: "", siret: "", code_naf: "",
  adresse: "", code_postal: "", ville: "", telephone: "", email: "", site_web: "",
  effectif: 0, actif: true, code_pays: "FR",
  forme_juridique: "", identifiant_fiscal: "", registre_commerce: "", ice: "", patente: "",
  capital_social: undefined, nom_gerant: "", conseil_administration: "",
};

const EMPTY_UO: Partial<UniteOrg> = {
  libelle: "", code: "", type_uo: "", niveau: undefined, actif: true,
  etablissement_id: "", parent_id: undefined,
  adresse_societe: false,
  lieu: "", batiment: "", etage: "", bureau: "",
  adresse_complete: "", code_pays: "", code_region: "", code_ville: "", code_postal: "",
  telephone: "", email: "",
};

const EMPTY_COMPTE: Partial<CompteBancaire> = {
  code_banque: "", numero_compte: "", iban: "", swift: "",
  agence: "", code_devise: "EUR", actif: true,
};

/* ─── Field helpers ─── */
const FieldInput = ({ label, name, value, onChange, type = "text", required = false, placeholder = "", colSpan = 1 }: {
  label: string; name: string; value: string | number | undefined;
  onChange: (k: string, v: string | number | boolean) => void;
  type?: string; required?: boolean; placeholder?: string; colSpan?: number;
}) => (
  <div className={`space-y-1 ${colSpan === 2 ? "col-span-2" : ""}`}>
    <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <Input
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={e => onChange(name, type === "number" ? Number(e.target.value) : e.target.value)}
      className="h-8 text-sm"
    />
  </div>
);

const NONE_VALUE = "__none__";

const FieldSelect = ({ label, name, value, onChange, options, required = false, placeholder = "Sélectionner..." }: {
  label: string; name: string; value: string | undefined;
  onChange: (k: string, v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean; placeholder?: string;
}) => {
  const safeOptions = options.map(o => ({ ...o, value: o.value === "" ? NONE_VALUE : o.value }));
  const safeValue = !value ? NONE_VALUE : value;
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <Select value={safeValue} onValueChange={v => onChange(name, v === NONE_VALUE ? "" : v)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {safeOptions.map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

/* ─── FieldSelectCreatable : select avec recherche + création inline ─── */
interface CreatableOption { value: string; label: string; }
const FieldSelectCreatable = ({
  label, name, value, onChange, options, required = false, placeholder = "Rechercher ou créer…",
  refTable, codeField = "code", libelleField = "libelle", onCreated,
}: {
  label: string; name: string; value: string | undefined;
  onChange: (k: string, v: string) => void;
  options: CreatableOption[];
  required?: boolean; placeholder?: string;
  refTable: string;
  codeField?: string;
  libelleField?: string;
  onCreated?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newLibelle, setNewLibelle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localOptions, setLocalOptions] = useState<CreatableOption[]>([]);

  const allOptions = [
    ...options,
    ...localOptions.filter(lo => !options.some(o => o.value === lo.value)),
  ];

  const selectedLabel = allOptions.find(o => o.value === value)?.label;

  const filtered = allOptions.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase()) ||
    o.value.toLowerCase().includes(query.toLowerCase())
  );

  const exactMatch = allOptions.some(
    o => o.label.toLowerCase() === query.toLowerCase() || o.value.toLowerCase() === query.toLowerCase()
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (val: string) => {
    onChange(name, val);
    setOpen(false);
    setCreating(false);
    setQuery("");
  };

  const startCreate = () => {
    setNewLibelle(query);
    setNewCode("");
    setSaveError(null);
    setCreating(true);
  };

  const doCreate = async () => {
    if (!newCode.trim() || !newLibelle.trim()) { setSaveError("Code et libellé obligatoires"); return; }
    setSaving(true);
    setSaveError(null);
    const payload = { [codeField]: newCode.trim(), [libelleField]: newLibelle.trim(), actif: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)(refTable).insert([payload]);
    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    const created: CreatableOption = { value: newCode.trim(), label: newLibelle.trim() };
    setLocalOptions(prev => [...prev, created]);
    onCreated?.();
    onChange(name, newCode.trim());
    setOpen(false);
    setCreating(false);
    setQuery("");
  };

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setCreating(false); setQuery(""); }}
        className="flex h-8 w-full items-center justify-between rounded-md border px-3 py-1 text-sm text-left transition-colors"
        style={{
          background: "hsl(var(--background))",
          borderColor: open ? "hsl(var(--ring))" : "hsl(var(--border))",
          color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
        }}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronDown size={13} className="flex-shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          className="absolute z-50 w-full rounded-md border shadow-lg overflow-hidden"
          style={{ top: "calc(100% + 2px)", background: "hsl(var(--popover))", borderColor: "hsl(var(--border))" }}
        >
          {!creating ? (
            <>
              <div className="p-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-40" />
                  <input
                    autoFocus
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Rechercher…"
                    className="w-full pl-6 pr-2 py-1 text-xs rounded border outline-none"
                    style={{
                      background: "hsl(var(--muted) / 0.4)",
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto">
                {filtered.length === 0 && !query ? (
                  <div className="px-3 py-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune option</div>
                ) : filtered.length === 0 && query ? (
                  <div className="px-3 py-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat pour « {query} »</div>
                ) : (
                  filtered.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => handleSelect(o.value)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                      style={o.value === value ? { background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))" } : {}}
                    >
                      {o.value === value && <Check size={11} className="flex-shrink-0" />}
                      <span className="truncate">{o.label}</span>
                    </button>
                  ))
                )}
              </div>

              {query && !exactMatch && (
                <div className="border-t p-2" style={{ borderColor: "hsl(var(--border))" }}>
                  <button
                    type="button"
                    onClick={startCreate}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium transition-colors"
                    style={{
                      background: "hsl(var(--primary) / 0.08)",
                      color: "hsl(var(--primary))",
                      border: "1px dashed hsl(var(--primary) / 0.4)",
                    }}
                  >
                    <Plus size={12} />
                    Créer « {query} » dans le référentiel
                    <ExternalLink size={11} className="ml-auto opacity-60" />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Plus size={13} style={{ color: "hsl(var(--primary))" }} />
                <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Créer une nouvelle entrée
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Code *</label>
                  <input
                    autoFocus
                    value={newCode}
                    onChange={e => setNewCode(e.target.value.toUpperCase())}
                    placeholder="Ex: URSSAF"
                    className="w-full px-2 py-1 text-xs rounded border outline-none font-mono"
                    style={{
                      background: "hsl(var(--background))",
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-0.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé *</label>
                  <input
                    value={newLibelle}
                    onChange={e => setNewLibelle(e.target.value)}
                    placeholder="Libellé"
                    className="w-full px-2 py-1 text-xs rounded border outline-none"
                    style={{
                      background: "hsl(var(--background))",
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </div>
              </div>
              {saveError && (
                <div className="text-xs px-2 py-1 rounded" style={{ background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))" }}>
                  {saveError}
                </div>
              )}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={doCreate}
                  disabled={saving}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
                >
                  <Check size={11} /> {saving ? "Création…" : "Créer et sélectionner"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                  style={{ border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
                >
                  <X size={11} /> Retour
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ToggleField = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-center gap-2 pt-4">
    <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="w-10 h-5 rounded-full transition-colors flex-shrink-0"
      style={{ background: value ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
    >
      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${value ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  </div>
);

/* ══════════════════════════════════════════════
   FICHE SOCIÉTÉ (vue détaillée à onglets)
══════════════════════════════════════════════ */
type SocieteTab = "identification" | "immatriculation" | "juridique" | "banques";

const SOCIETE_TABS: { key: SocieteTab; label: string; icon: React.ElementType }[] = [
  { key: "identification", label: "Identification", icon: Building2 },
  { key: "immatriculation", label: "Immatriculation", icon: FileText },
  { key: "juridique", label: "Juridique", icon: Shield },
  { key: "banques", label: "Banques & Comptes", icon: CreditCard },
];

const EMPTY_AFFILIATION: Partial<Affiliation> = {
  code_type_affiliation: "", numero_affiliation: "", date_adhesion: "", date_fin: "",
};

const SocieteFiche: React.FC<{
  societe: Societe | null;
  onClose: () => void;
  onSaved: () => void;
  conventions: RefItem[]; secteurs: RefItem[];
  regions: RefRegion[]; pays: RefItem[]; villes: RefVille[];
  banques: RefBanque[]; devises: RefDevise[];
}> = ({ societe, onClose, onSaved, conventions, secteurs, regions, pays, villes, banques, devises }) => {
  const [tab, setTab] = useState<SocieteTab>("identification");
  const [form, setForm] = useState<Partial<Societe>>(societe ? { ...societe } : EMPTY_SOCIETE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const uploadLogo = async (file: File) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        "http://localhost:8000/api/v1/storage/logos_societes",
        {
          method: "POST",
          body: formData,
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Erreur lors de l'upload du logo");
      }
      const { publicUrl } = await response.json();
      setField("logo_path", publicUrl);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  // Comptes bancaires
  const [comptes, setComptes] = useState<CompteBancaire[]>([]);
  const [showCompteForm, setShowCompteForm] = useState(false);
  const [editingCompte, setEditingCompte] = useState<CompteBancaire | null>(null);
  const [compteForm, setCompteForm] = useState<Partial<CompteBancaire>>(EMPTY_COMPTE);
  const [savingCompte, setSavingCompte] = useState(false);
  const [deleteCompteId, setDeleteCompteId] = useState<string | null>(null);

  // Affiliations
  const [affiliations, setAffiliations] = useState<Affiliation[]>([]);
  const [typesAffiliation, setTypesAffiliation] = useState<RefItem[]>([]);
  const [showAffForm, setShowAffForm] = useState(false);
  const [editingAff, setEditingAff] = useState<Affiliation | null>(null);
  const [affForm, setAffForm] = useState<Partial<Affiliation>>(EMPTY_AFFILIATION);
  const [savingAff, setSavingAff] = useState(false);
  const [deleteAffId, setDeleteAffId] = useState<string | null>(null);

  const setField = (k: string, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }));
  const setCompteField = (k: string, v: string | number | boolean) => setCompteForm(f => ({ ...f, [k]: v }));
  const setAffField = (k: string, v: string | number | boolean) => setAffForm(f => ({ ...f, [k]: v }));

  const loadComptes = useCallback(async () => {
    if (!societe?.id) return;
    const { data } = await supabase.from("societe_comptes_bancaires").select("*").eq("societe_id", societe.id).order("code_banque");
    if (data) setComptes(data as CompteBancaire[]);
  }, [societe?.id]);

  const loadAffiliations = useCallback(async () => {
    if (!societe?.id) return;
    const { data } = await supabase.from("societe_affiliations").select("*").eq("societe_id", societe.id).order("code_type_affiliation");
    if (data) setAffiliations(data as Affiliation[]);
  }, [societe?.id]);

  const loadTypesAffiliation = useCallback(async () => {
    const { data } = await supabase.from("ref_type_affiliation").select("code, libelle").eq("actif", true).order("ordre");
    if (data) setTypesAffiliation(data);
  }, []);

  useEffect(() => {
    loadComptes();
    loadAffiliations();
    loadTypesAffiliation();
  }, [loadComptes, loadAffiliations, loadTypesAffiliation]);

  const save = async () => {
    if (!form.raison_sociale?.trim()) { setError("La raison sociale est obligatoire"); return; }
    // Point 4 : Empêcher la désactivation de la dernière société active
    if (societe && societe.actif && form.actif === false) {
      const { count } = await supabase.from("societes").select("id", { count: "exact", head: true }).eq("actif", true);
      if ((count ?? 0) <= 1) {
        setError("Impossible de désactiver cette société : il doit rester au moins une société active.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    let saveError: string | null = null;
    if (societe) {
      const { error } = await supabase.from("societes").update(form as Societe).eq("id", societe.id);
      if (error) saveError = error.message;
    } else {
      const { error } = await supabase.from("societes").insert([form as Societe]);
      if (error) saveError = error.message;
    }
    setSaving(false);
    if (saveError) setError(saveError);
    else { onSaved(); onClose(); }
  };

  const saveCompte = async () => {
    if (!compteForm.code_banque?.trim() || !compteForm.numero_compte?.trim()) return;
    if (!societe?.id) return;
    setSavingCompte(true);
    const payload = {
      ...compteForm,
      societe_id: societe.id,
      date_ouverture: compteForm.date_ouverture || null,
    } as CompteBancaire;
    if (editingCompte) {
      await supabase.from("societe_comptes_bancaires").update(payload).eq("id", editingCompte.id);
    } else {
      await supabase.from("societe_comptes_bancaires").insert([payload]);
    }
    setSavingCompte(false);
    setShowCompteForm(false);
    setEditingCompte(null);
    setCompteForm(EMPTY_COMPTE);
    await loadComptes();
  };

  const deleteCompte = async (id: string) => {
    await supabase.from("societe_comptes_bancaires").delete().eq("id", id);
    setDeleteCompteId(null);
    await loadComptes();
  };

  const openEditCompte = (c: CompteBancaire) => { setEditingCompte(c); setCompteForm({ ...c }); setShowCompteForm(true); };
  const cancelCompte = () => { setShowCompteForm(false); setEditingCompte(null); setCompteForm(EMPTY_COMPTE); };

  const saveAff = async () => {
    if (!affForm.code_type_affiliation) return;
    if (!societe?.id) return;
    setSavingAff(true);
    setError(null);
    const cleanPayload = {
      ...affForm,
      societe_id: societe.id,
      date_adhesion: affForm.date_adhesion || null,
      date_fin: affForm.date_fin || null,
    };
    let saveError: string | null = null;
    if (editingAff) {
      const { error } = await supabase.from("societe_affiliations").update(cleanPayload).eq("id", editingAff.id);
      if (error) saveError = error.message;
    } else {
      const { id: _id, ...insertPayload } = cleanPayload as Affiliation & { id?: string };
      const { error } = await supabase.from("societe_affiliations").insert([insertPayload]);
      if (error) saveError = error.message;
    }
    setSavingAff(false);
    if (saveError) { setError(saveError); return; }
    setShowAffForm(false);
    setEditingAff(null);
    setAffForm(EMPTY_AFFILIATION);
    await loadAffiliations();
  };

  const deleteAff = async (id: string) => {
    await supabase.from("societe_affiliations").delete().eq("id", id);
    setDeleteAffId(null);
    await loadAffiliations();
  };

  const openEditAff = (a: Affiliation) => { setEditingAff(a); setAffForm({ ...a }); setShowAffForm(true); };
  const cancelAff = () => { setShowAffForm(false); setEditingAff(null); setAffForm(EMPTY_AFFILIATION); };

  return (
    <div className="space-y-0">
      {/* Header fiche */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
          style={{ color: "hsl(var(--muted-foreground))" }}>
          <ArrowLeft size={15} /> Retour à la liste
        </button>
        <span style={{ color: "hsl(var(--muted-foreground))" }}>/</span>
        <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
          {societe ? societe.raison_sociale : "Nouvelle société"}
        </span>
        {societe && (
          <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={societe.actif
              ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" }
              : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            {societe.actif ? "Active" : "Inactive"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onClose}><X size={14} /></Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            <Check size={14} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm p-3 rounded-lg border mb-4"
          style={{ background: "hsl(var(--destructive) / 0.08)", borderColor: "hsl(var(--destructive) / 0.3)", color: "hsl(var(--destructive))" }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Onglets */}
      <div className="border rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="flex border-b" style={{ borderColor: "hsl(var(--border))" }}>
          {SOCIETE_TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors"
                style={{
                  color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  borderBottom: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  background: active ? "hsl(var(--primary) / 0.04)" : "transparent",
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-5">
          {/* ── ONGLET 1 : Identification ── */}
          {tab === "identification" && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Informations générales
              </p>
              {/* Logo upload */}
              <div className="flex items-center gap-4 mb-2">
                <div
                  className="h-20 w-20 rounded-xl border-2 border-dashed flex items-center justify-center overflow-hidden cursor-pointer transition-colors hover:border-primary"
                  style={{ borderColor: form.logo_path ? "hsl(var(--border))" : "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {form.logo_path ? (
                    <img src={form.logo_path} alt="Logo" className="h-full w-full object-contain p-1" />
                  ) : (
                    <div className="flex flex-col items-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <Building2 size={24} className="opacity-40" />
                      <span className="text-[10px]">Logo</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1.5"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                  >
                    {uploadingLogo ? "Envoi…" : form.logo_path ? "Changer le logo" : "Télécharger un logo"}
                  </Button>
                  {form.logo_path && (
                    <button
                      type="button"
                      className="block text-xs"
                      style={{ color: "hsl(var(--destructive))" }}
                      onClick={() => setField("logo_path", "")}
                    >
                      Supprimer le logo
                    </button>
                  )}
                  <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>PNG, JPG, SVG — max 2 Mo</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <FieldInput label="Code société" name="code_societe" value={form.code_societe} onChange={setField} required placeholder="Ex: SOC001" />
                <div className="md:col-span-2">
                  <FieldInput label="Raison sociale" name="raison_sociale" value={form.raison_sociale} onChange={setField} required />
                </div>
                <FieldInput label="Nom commercial" name="nom_commercial" value={form.nom_commercial} onChange={setField} />
                <FieldInput label="Code NAF" name="code_naf" value={form.code_naf} onChange={setField} placeholder="Ex: 6201Z" />
                {/* RG-SOC-EFF-01 (Adil DAIA) : Effectif calculé automatiquement — lecture seule */}
                <div className="space-y-1">
                  <label className="text-xs font-medium block" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Effectif <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))" }}>calculé auto.</span>
                  </label>
                  <div className="flex h-9 items-center px-3 rounded-md text-sm font-medium border"
                    style={{ background: "hsl(var(--muted) / 0.4)", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                    {form.effectif ?? 0}
                  </div>
                </div>
                <FieldSelectCreatable label="Convention collective" name="code_convention_collective" value={form.code_convention_collective}
                  onChange={setField} options={conventions.map(c => ({ value: c.code, label: c.libelle }))}
                  refTable="ref_convention_collective" onCreated={loadTypesAffiliation} />
                <FieldSelectCreatable label="Secteur d'activité" name="code_secteur_activite" value={form.code_secteur_activite}
                  onChange={setField} options={secteurs.map(c => ({ value: c.code, label: c.libelle }))}
                  refTable="ref_secteur_activite" onCreated={loadTypesAffiliation} />
              </div>

              <p className="text-xs font-semibold uppercase tracking-wider mt-4 mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Coordonnées & Localisation
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <FieldInput label="Adresse (siège social)" name="adresse" value={form.adresse} onChange={setField} />
                </div>
                <FieldInput label="Code postal" name="code_postal" value={form.code_postal} onChange={setField} />
                <FieldSelectCreatable label="Ville" name="code_ville" value={form.code_ville}
                  onChange={(k, v) => {
                    setField(k, v);
                    const ville = villes.find(vi => vi.code === v);
                    if (ville?.code_region) {
                      setField("code_region", ville.code_region);
                      const region = regions.find(r => r.code === ville.code_region);
                      if (region?.code_pays) setField("code_pays", region.code_pays);
                    }
                  }}
                  options={villes.map(v => ({ value: v.code, label: `${v.libelle}${v.code_postal ? ` (${v.code_postal})` : ""}` }))}
                  refTable="ref_ville" />
                <FieldSelectCreatable label="Région/Département" name="code_region" value={form.code_region}
                  onChange={setField} options={regions.map(c => ({ value: c.code, label: c.libelle }))}
                  refTable="ref_region" />
                <FieldSelectCreatable label="Pays" name="code_pays" value={form.code_pays}
                  onChange={setField} options={pays.map(c => ({ value: c.code, label: c.libelle }))}
                  refTable="ref_pays" />
                <FieldInput label="Téléphone" name="telephone" value={form.telephone} onChange={setField} />
                <FieldInput label="Email" name="email" value={form.email} onChange={setField} />
                <FieldInput label="Site web" name="site_web" value={form.site_web} onChange={setField} />
                <ToggleField label="Société active" value={form.actif ?? true} onChange={v => setField("actif", v)} />
              </div>
            </div>
          )}

          {/* ── ONGLET 2 : Immatriculation ── */}
          {tab === "immatriculation" && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Identifiants légaux & fiscaux
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FieldInput label="Registre du commerce (RC)" name="registre_commerce" value={form.registre_commerce} onChange={setField} />
                  <FieldInput label="ICE (Identifiant Commun de l'Entreprise)" name="ice" value={form.ice} onChange={setField} />
                  <FieldInput label="Identifiant fiscal (NIF / NIS)" name="identifiant_fiscal" value={form.identifiant_fiscal} onChange={setField} />
                  <FieldInput label="Patente" name="patente" value={form.patente} onChange={setField} />
                  <FieldInput label="SIRET" name="siret" value={form.siret} onChange={setField} placeholder="14 chiffres" />
                  <FieldInput label="Date de création" name="date_creation_societe" value={form.date_creation_societe} onChange={setField} type="date" />
                </div>
              </div>

              {/* Section affiliations */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Affiliations aux organismes sociaux
                  </p>
                  {societe && (
                    <Button size="sm" onClick={() => { setEditingAff(null); setAffForm({ ...EMPTY_AFFILIATION }); setShowAffForm(true); }} className="gap-1.5">
                      <Plus size={13} /> Ajouter
                    </Button>
                  )}
                </div>
                {!societe ? (
                  <div className="text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <Link2 size={24} className="mx-auto mb-2 opacity-30" />
                    Enregistrez d'abord la société pour gérer ses affiliations.
                  </div>
                ) : (
                  <>
                    {showAffForm && (
                      <div className="border rounded-lg p-4 space-y-3 mb-3" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
                        <p className="text-sm font-medium">{editingAff ? "Modifier l'affiliation" : "Nouvelle affiliation"}</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <FieldSelect label="Type d'affiliation" name="code_type_affiliation" value={affForm.code_type_affiliation}
                            onChange={setAffField} required options={typesAffiliation.map(t => ({ value: t.code, label: t.libelle }))} />
                          <FieldInput label="N° d'affiliation" name="numero_affiliation" value={affForm.numero_affiliation} onChange={setAffField} />
                          <FieldInput label="Date d'adhésion" name="date_adhesion" value={affForm.date_adhesion} onChange={setAffField} type="date" />
                          <FieldInput label="Date de fin" name="date_fin" value={affForm.date_fin} onChange={setAffField} type="date" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={saveAff} disabled={savingAff} className="gap-1.5">
                            <Check size={13} /> {savingAff ? "Enregistrement…" : "Enregistrer"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelAff}><X size={13} /></Button>
                        </div>
                      </div>
                    )}
                    {affiliations.length === 0 && !showAffForm ? (
                      <div className="text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
                        <Link2 size={24} className="mx-auto mb-2 opacity-30" />
                        Aucune affiliation enregistrée
                      </div>
                    ) : affiliations.length > 0 && (
                      <div className="rounded-lg overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                              {["Type", "N° Affiliation", "Date adhésion", "Date fin", ""].map(h => (
                                <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {affiliations.map(a => {
                              const typeAff = typesAffiliation.find(t => t.code === a.code_type_affiliation);
                              return (
                                <tr key={a.id} className="border-t hover:bg-muted/30 transition-colors" style={{ borderColor: "hsl(var(--border))" }}>
                                  <td className="px-3 py-2 font-medium">{typeAff?.libelle || a.code_type_affiliation}</td>
                                  <td className="px-3 py-2 font-mono text-xs">{a.numero_affiliation || "—"}</td>
                                  <td className="px-3 py-2 text-xs">{a.date_adhesion || "—"}</td>
                                  <td className="px-3 py-2 text-xs">{a.date_fin || "—"}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1 justify-end">
                                      <button onClick={() => openEditAff(a)} className="p-1.5 rounded hover:bg-muted/60" style={{ color: "hsl(var(--muted-foreground))" }}>
                                        <Pencil size={12} />
                                      </button>
                                      {deleteAffId === a.id ? (
                                        <div className="flex items-center gap-1">
                                          <button onClick={() => deleteAff(a.id)} className="p-1.5 rounded text-red-500 hover:bg-red-50"><Check size={12} /></button>
                                          <button onClick={() => setDeleteAffId(null)} className="p-1.5 rounded hover:bg-muted/60"><X size={12} /></button>
                                        </div>
                                      ) : (
                                        <button onClick={() => setDeleteAffId(a.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400">
                                          <Trash2 size={12} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── ONGLET 3 : Juridique ── */}
          {tab === "juridique" && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Informations juridiques
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <FieldInput label="Forme juridique" name="forme_juridique" value={form.forme_juridique} onChange={setField} placeholder="Ex: SARL, SA…" />
                <FieldInput label="Capital social" name="capital_social" value={form.capital_social} onChange={setField} type="number" placeholder="0.00" />
                <FieldSelectCreatable label="Devise du capital" name="code_devise_capital" value={form.code_devise_capital}
                  onChange={setField} options={devises.map(d => ({ value: d.code, label: `${d.libelle}${d.symbole ? ` (${d.symbole})` : ""}` }))}
                  refTable="ref_devise" />
                <FieldInput label="Nom du gérant / Président" name="nom_gerant" value={form.nom_gerant} onChange={setField} />
                <div className="md:col-span-3">
                  <FieldInput label="Conseil d'administration" name="conseil_administration" value={form.conseil_administration} onChange={setField} />
                </div>
              </div>
            </div>
          )}

          {/* ── ONGLET 4 : Banques & Comptes ── */}
          {tab === "banques" && (
            <div className="space-y-4">
              {!societe ? (
                <div className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Landmark size={28} className="mx-auto mb-2 opacity-30" />
                  Enregistrez d'abord la société pour gérer ses comptes bancaires.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Comptes bancaires
                    </p>
                    <Button size="sm" onClick={() => { setEditingCompte(null); setCompteForm(EMPTY_COMPTE); setShowCompteForm(true); }} className="gap-1.5">
                      <Plus size={13} /> Ajouter un compte
                    </Button>
                  </div>

                  {showCompteForm && (
                    <div className="border rounded-lg p-4 space-y-3" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
                      <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                        {editingCompte ? "Modifier le compte" : "Nouveau compte bancaire"}
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <FieldSelectCreatable
                          label="Banque" name="code_banque" value={compteForm.code_banque} required
                          onChange={setCompteField}
                          options={banques.map(b => ({ value: b.code, label: `${b.code} — ${b.libelle}${b.swift ? ` (${b.swift})` : ""}` }))}
                          refTable="ref_banque"
                        />
                        <FieldInput label="Agence" name="agence" value={compteForm.agence} onChange={setCompteField} />
                        <FieldInput label="Numéro de compte" name="numero_compte" value={compteForm.numero_compte} onChange={setCompteField} required />
                        <FieldSelectCreatable
                          label="Devise" name="code_devise" value={compteForm.code_devise} required
                          onChange={setCompteField}
                          options={devises.map(d => ({ value: d.code, label: `${d.code}${d.symbole ? ` (${d.symbole})` : ""} — ${d.libelle}` }))}
                          refTable="ref_devise"
                        />
                        <div className="md:col-span-2">
                          <FieldInput label="IBAN" name="iban" value={compteForm.iban} onChange={setCompteField} placeholder="FR76…" />
                        </div>
                        <FieldInput label="SWIFT / BIC" name="swift" value={compteForm.swift} onChange={setCompteField} />
                        <FieldInput label="Date d'ouverture" name="date_ouverture" value={compteForm.date_ouverture} onChange={setCompteField} type="date" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={saveCompte} disabled={savingCompte} className="gap-1.5">
                          <Check size={13} /> {savingCompte ? "Enregistrement…" : "Enregistrer"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelCompte}><X size={13} /></Button>
                      </div>
                    </div>
                  )}

                  {comptes.length === 0 && !showCompteForm ? (
                    <div className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <CreditCard size={28} className="mx-auto mb-2 opacity-30" />
                      Aucun compte bancaire enregistré
                    </div>
                  ) : (
                    <div className="rounded-lg overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                            {["Banque", "Agence", "N° Compte", "IBAN", "SWIFT", "Devise", "Ouverture", ""].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {comptes.map(c => {
                            const banque = banques.find(b => b.code === c.code_banque);
                            const devise = devises.find(d => d.code === c.code_devise);
                            return (
                              <tr key={c.id} className="border-t hover:bg-muted/30 transition-colors" style={{ borderColor: "hsl(var(--border))" }}>
                                <td className="px-3 py-2">
                                  <div className="font-medium">{banque?.libelle || c.code_banque}</div>
                                  {banque?.swift && <div className="text-xs opacity-50 font-mono">{banque.swift}</div>}
                                </td>
                                <td className="px-3 py-2 text-xs">{c.agence || "—"}</td>
                                <td className="px-3 py-2 font-mono text-xs">{c.numero_compte}</td>
                                <td className="px-3 py-2 font-mono text-xs">{c.iban || "—"}</td>
                                <td className="px-3 py-2 font-mono text-xs">{c.swift || "—"}</td>
                                <td className="px-3 py-2 text-xs">
                                  <span className="font-medium">{c.code_devise}</span>
                                  {devise?.symbole && <span className="ml-1 opacity-60">{devise.symbole}</span>}
                                </td>
                                <td className="px-3 py-2 text-xs">{c.date_ouverture || "—"}</td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1 justify-end">
                                    <button onClick={() => openEditCompte(c)} className="p-1.5 rounded hover:bg-muted/60" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      <Pencil size={12} />
                                    </button>
                                    {deleteCompteId === c.id ? (
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => deleteCompte(c.id)} className="p-1.5 rounded text-red-500 hover:bg-red-50"><Check size={12} /></button>
                                        <button onClick={() => setDeleteCompteId(null)} className="p-1.5 rounded hover:bg-muted/60"><X size={12} /></button>
                                      </div>
                                    ) : (
                                      <button onClick={() => setDeleteCompteId(c.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors text-red-400">
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════
   TAB 1 - SOCIÉTÉS (liste + fiche)
══════════════════════════════════════════════ */
const SocietesTab: React.FC<{
  conventions: RefItem[]; secteurs: RefItem[];
  regions: RefRegion[]; pays: RefItem[]; villes: RefVille[];
  banques: RefBanque[]; devises: RefDevise[];
}> = ({ conventions, secteurs, regions, pays, villes, banques, devises }) => {
  const [rows, setRows] = useState<Societe[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Societe | null | "new">(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("societes").select("*").order("raison_sociale");
    if (error) setError(error.message);
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    r.raison_sociale.toLowerCase().includes(search.toLowerCase()) ||
    (r.nom_commercial ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (r.siret ?? "").includes(search)
  );

  const doDelete = async (id: string) => {
    // Point 4 : Empêcher la suppression de la dernière société active
    const soc = rows.find(r => r.id === id);
    if (soc?.actif) {
      const activeCount = rows.filter(r => r.actif).length;
      if (activeCount <= 1) {
        setError("Impossible de supprimer cette société : il doit rester au moins une société active.");
        setDeleteId(null);
        return;
      }
    }
    // Point 5 : Archiver au lieu de supprimer physiquement
    const { error } = await supabase.from("societes").update({ actif: false } as any).eq("id", id);
    if (error) setError(error.message);
    else { setDeleteId(null); await load(); }
  };

  if (selected !== null) {
    return (
      <SocieteFiche
        societe={selected === "new" ? null : selected}
        onClose={() => setSelected(null)}
        onSaved={load}
        conventions={conventions}
        secteurs={secteurs}
        regions={regions}
        pays={pays}
        villes={villes}
        banques={banques}
        devises={devises}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
          <Input className="pl-8 h-8 text-sm" placeholder="Rechercher une société…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setSelected("new")} className="gap-1.5">
          <Plus size={14} /> Nouvelle société
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm p-3 rounded-lg border"
          style={{ background: "hsl(var(--destructive) / 0.08)", borderColor: "hsl(var(--destructive) / 0.3)", color: "hsl(var(--destructive))" }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-center py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Building2 size={32} className="mx-auto mb-2 opacity-30" />
          {search ? "Aucun résultat" : "Aucune société enregistrée"}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                {["Logo", "Code", "Raison sociale", "RC", "ICE", "Forme juridique", "Ville", "Pays", "Effectif", "Statut", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const villeLib = villes.find(v => v.code === r.code_ville)?.libelle || r.ville || "—";
                const paysLib = pays.find(p => p.code === r.code_pays)?.libelle || "—";
                return (
                  <tr
                    key={r.id}
                    className="border-t hover:bg-muted/30 transition-colors cursor-pointer"
                    style={{ borderColor: "hsl(var(--border))" }}
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-3 py-2.5">
                      {r.logo_path ? (
                        <img
                          src={r.logo_path}
                          alt={r.raison_sociale}
                          className="h-8 w-8 rounded object-contain border"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="h-8 w-8 rounded flex items-center justify-center border"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}>
                          <Building2 size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold" style={{ color: "hsl(var(--primary))" }}>
                      {r.code_societe || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{r.raison_sociale}</div>
                      {r.nom_commercial && <div className="text-xs opacity-60">{r.nom_commercial}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs opacity-70">{r.registre_commerce || "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-xs opacity-70">{r.ice || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{r.forme_juridique || "—"}</td>
                    <td className="px-3 py-2.5">{villeLib}</td>
                    <td className="px-3 py-2.5 text-xs">{paysLib}</td>
                    <td className="px-3 py-2.5">{r.effectif ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={r.actif
                          ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" }
                          : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                        {r.actif ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setSelected(r)}
                          className="p-1.5 rounded hover:bg-muted/60 transition-colors"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          <Pencil size={13} />
                        </button>
                        {deleteId === r.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => doDelete(r.id)} className="p-1.5 rounded text-red-500 hover:bg-red-50">
                              <Check size={13} />
                            </button>
                            <button onClick={() => setDeleteId(null)} className="p-1.5 rounded hover:bg-muted/60">
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteId(r.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors text-red-400">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════
   Utilitaire : Obtenir l'établissement par défaut
   d'une société (le trigger PostgreSQL garantit
   qu'il existe dès la création de la société)
══════════════════════════════════════════════ */
async function getOrCreateDefaultEtab(
  societeId: string,
  _societeNom: string  // conservé pour compatibilité de signature, non utilisé
): Promise<{ id: string | null; error: string | null }> {
  // Le trigger create_default_etablissement garantit qu'un établissement "Siège"
  // est automatiquement créé à chaque INSERT dans la table societes.
  // On fait donc un simple SELECT au lieu d'un RPC qui retournait un dict.
  const { data, error } = await supabase
    .from("etablissements")
    .select("id")
    .eq("societe_id", societeId)
    .eq("actif", true)
    .limit(1)
    .maybeSingle();

  if (error) return { id: null, error: error.message };
  if (!data?.id) return {
    id: null,
    error: "Aucun établissement trouvé pour cette société. Vérifiez que la société a bien été créée via l'application.",
  };
  return { id: data.id, error: null };
}


/* ══════════════════════════════════════════════
   ORGANIGRAMME GRAPHIQUE (arbre horizontal SVG)
══════════════════════════════════════════════ */
const OrganigrammeGraphique: React.FC<{
  uos: UniteOrg[];
  etabs: EtabMinimal[];
  typesUo: RefTypeUo[];
  societes: Societe[];
  collaborateursMap: Map<string, { matricule: string; nom: string; prenom: string }>;
  filterSociete: string;
  rootUoId?: string | null;
  onEdit: (uo: UniteOrg) => void;
  onReload: () => Promise<void>;
  onSetRootUo?: (id: string | null) => void;
}> = ({ uos, etabs, typesUo, collaborateursMap, filterSociete, rootUoId, onEdit, onReload, onSetRootUo }) => {
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [scale, setScale] = useState(0.85);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  // Modale d'export
  const [showExport, setShowExport] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "pdf">("png");
  const [exportScope, setExportScope] = useState<"current" | "full">("current");
  const [exporting, setExporting] = useState(false);

  // B3 : Orientation de l'organigramme + filtre par profondeur
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [maxDepth, setMaxDepth] = useState<number>(0); // 0 = pas de limite

  // Drag & drop state
  const [dragNode, setDragNode] = useState<{ uo: UniteOrg; ghostX: number; ghostY: number } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [showDropDialog, setShowDropDialog] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ child: UniteOrg; parent: UniteOrg } | null>(null);
  const [dropForm, setDropForm] = useState({ date_debut: new Date().toISOString().split("T")[0], reference_decision: "", date_decision: "" });
  const [savingDrop, setSavingDrop] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const NODE_W = 230; const NODE_H = 94; const H_GAP = 72; const V_GAP = 18;

  // ────────────────────────────────────────────────────────────
  // EXPORT (PNG / PDF) — utilise le SVG existant
  // ────────────────────────────────────────────────────────────
  const buildExportSVG = async (scope: "current" | "full"): Promise<{ svg: string; width: number; height: number }> => {
    if (!svgRef.current) throw new Error("SVG non disponible");

    // 1. Cloner le SVG d'origine
    const sourceSvg = svgRef.current.cloneNode(true) as SVGSVGElement;

    // 2. Si scope === "full", supprimer la transformation (pour avoir tout l'arbre)
    //    Sinon, garder la transformation actuelle (vue actuelle)
    const g = sourceSvg.querySelector("g");
    if (g && scope === "full") {
      g.removeAttribute("transform");
    }

    // 3. Calculer la taille réelle (bounding box) du contenu
    let bbox = { x: 0, y: 0, width: 1200, height: 800 };
    try {
      const tempContainer = document.createElement("div");
      tempContainer.style.position = "absolute";
      tempContainer.style.left = "-99999px";
      tempContainer.appendChild(sourceSvg);
      document.body.appendChild(tempContainer);
      const realBox = (sourceSvg.querySelector("g") as SVGGElement)?.getBBox?.();
      if (realBox && realBox.width > 0 && realBox.height > 0) {
        bbox = realBox;
      }
      document.body.removeChild(tempContainer);
    } catch (e) {
      // Si getBBox échoue, on garde les dimensions par défaut
    }

    const padding = 40;
    const visualRect = svgRef.current?.getBoundingClientRect();
    const width = scope === "full"
      ? Math.max(bbox.width + padding * 2, 800)
      : (visualRect?.width || 1200);
    const height = scope === "full"
      ? Math.max(bbox.height + padding * 2, 600)
      : (visualRect?.height || 700);

    // 4. Si full, recadrer le SVG sur le contenu
    if (scope === "full" && g) {
      sourceSvg.setAttribute("width", String(width));
      sourceSvg.setAttribute("height", String(height));
      sourceSvg.setAttribute("viewBox", `${bbox.x - padding} ${bbox.y - padding} ${width} ${height}`);
    } else {
      sourceSvg.setAttribute("width", String(width));
      sourceSvg.setAttribute("height", String(height));
    }

    // 5. Ajouter un fond blanc (pour PDF/PNG lisibles)
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", scope === "full" ? String(bbox.x - padding) : "0");
    bgRect.setAttribute("y", scope === "full" ? String(bbox.y - padding) : "0");
    bgRect.setAttribute("width", String(width));
    bgRect.setAttribute("height", String(height));
    bgRect.setAttribute("fill", "white");
    sourceSvg.insertBefore(bgRect, sourceSvg.firstChild);

    // 6. Inliner les styles CSS HSL (sinon les couleurs ne sont pas exportées)
    // On parcourt tous les éléments et on remplace les "hsl(var(--xxx))" par des couleurs réelles
    const computedRoot = getComputedStyle(document.documentElement);
    const cssVars = ["--accent", "--primary", "--foreground", "--background", "--border", "--muted", "--muted-foreground", "--card"];
    const cssMap: Record<string, string> = {};
    cssVars.forEach(v => {
      const val = computedRoot.getPropertyValue(v).trim();
      if (val) cssMap[v] = `hsl(${val})`;
    });
    const replaceHsl = (str: string): string => {
      let out = str;
      Object.entries(cssMap).forEach(([k, v]) => {
        out = out.replace(new RegExp(`hsl\\(var\\(${k}\\)([^)]*)\\)`, "g"), v);
      });
      return out;
    };
    sourceSvg.querySelectorAll("*").forEach(el => {
      const elem = el as SVGElement;
      ["fill", "stroke", "color"].forEach(attr => {
        const v = elem.getAttribute(attr);
        if (v) elem.setAttribute(attr, replaceHsl(v));
      });
      const style = elem.getAttribute("style");
      if (style) elem.setAttribute("style", replaceHsl(style));
    });

    return {
      svg: new XMLSerializer().serializeToString(sourceSvg),
      width, height,
    };
  };

  const exportToPNG = async (scope: "current" | "full") => {
    const { svg, width, height } = await buildExportSVG(scope);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    const dpr = 2; // export en 2x pour la qualité
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `organigramme-${new Date().toISOString().split("T")[0]}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };

  const exportToPDF = async (scope: "current" | "full") => {
    // jsPDF est chargé dynamiquement (évite d'alourdir le bundle initial)
    const { jsPDF } = await import("jspdf");
    const { svg, width, height } = await buildExportSVG(scope);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    const dpr = 2;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL("image/png");

    // Format paysage si plus large que haut, portrait sinon
    const orientation = width > height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "px", format: [width, height] });
    pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
    pdf.save(`organigramme-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      if (exportFormat === "png") await exportToPNG(exportScope);
      else await exportToPDF(exportScope);
      setShowExport(false);
    } catch (e: any) {
      console.error("Export erreur:", e);
      alert("Erreur lors de l'export : " + (e?.message || "Inconnue"));
    } finally {
      setExporting(false);
    }
  };


  const getSocId = (uo: UniteOrg) => etabs.find(e => e.id === uo.etablissement_id)?.societe_id;
  const filteredAll = filterSociete ? uos.filter(u => getSocId(u) === filterSociete) : uos;

  // Si rootUoId est défini, on ne garde que cette UO et ses descendants
  const filtered = (() => {
    if (!rootUoId) return filteredAll;
    const keep = new Set<string>();
    const walk = (id: string) => {
      keep.add(id);
      filteredAll.filter(u => u.parent_id === id).forEach(c => walk(c.id));
    };
    walk(rootUoId);
    return filteredAll.filter(u => keep.has(u.id));
  })();

  interface TNode { uo: UniteOrg; children: TNode[]; x: number; y: number; }

  const build = (parentId?: string, depth: number = 0): TNode[] => {
    // Limite de profondeur (B3)
    if (maxDepth > 0 && depth >= maxDepth) return [];
    // Si rootUoId est défini, l'arbre commence à cette UO (au lieu de chercher les sans-parent)
    if (rootUoId && parentId === undefined) {
      const root = filtered.find(u => u.id === rootUoId);
      return root ? [{ uo: root, children: build(root.id, depth + 1), x: 0, y: 0 }] : [];
    }
    return filtered.filter(u => (u.parent_id || undefined) === parentId)
      .map(u => ({ uo: u, children: build(u.id, depth + 1), x: 0, y: 0 }));
  };

  let leafIdx = 0;
  const layout = (nodes: TNode[], depth: number) => {
    for (const n of nodes) {
      if (orientation === "horizontal") {
        n.x = depth * (NODE_W + H_GAP);
        if (!n.children.length) { n.y = leafIdx * (NODE_H + V_GAP); leafIdx++; }
        else { layout(n.children, depth + 1); n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2; }
      } else {
        // Vertical : profondeur en Y, feuilles écartées en X
        // Espacement X plus grand pour éviter le chevauchement (cartes posées côte à côte)
        n.y = depth * (NODE_H + H_GAP);
        if (!n.children.length) { n.x = leafIdx * (NODE_W + V_GAP); leafIdx++; }
        else { layout(n.children, depth + 1); n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2; }
      }
    }
  };

  const roots = build(undefined); leafIdx = 0; layout(roots, 0);
  const flatten = (nodes: TNode[]): TNode[] => nodes.flatMap(n => [n, ...flatten(n.children)]);
  const allNodes = flatten(roots);
  const getEdges = (nodes: TNode[]): { f: TNode; t: TNode }[] =>
    nodes.flatMap(n => [...n.children.map(c => ({ f: n, t: c })), ...getEdges(n.children)]);
  const edges = getEdges(roots);

  // Convert screen coords to SVG space
  const toSVG = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - pan.x) / scale, y: (clientY - rect.top - pan.y) / scale };
  };

  // isDescendant check to prevent cycles
  const isDescendant = (childId: string, ancestorId: string): boolean => {
    const node = allNodes.find(n => n.uo.id === childId);
    if (!node?.uo.parent_id) return false;
    if (node.uo.parent_id === ancestorId) return true;
    return isDescendant(node.uo.parent_id, ancestorId);
  };

  const isValidDrop = (child: UniteOrg, parent: UniteOrg): boolean => {
    if (child.id === parent.id) return false;
    if (child.parent_id === parent.id) return false;
    if (isDescendant(parent.id, child.id)) return false;
    const pt = typesUo.find(t => t.code === parent.type_uo);
    const ct = typesUo.find(t => t.code === child.type_uo);
    if (pt?.niveau != null && ct?.niveau != null && pt.niveau >= ct.niveau) return false;
    return true;
  };

  // Hit test: find node at SVG position
  const hitTest = (svgX: number, svgY: number): TNode | null =>
    allNodes.find(n => svgX >= n.x && svgX <= n.x + NODE_W && svgY >= n.y && svgY <= n.y + NODE_H) || null;

  // Apply drop
  const applyDrop = async () => {
    if (!pendingDrop) return;
    setSavingDrop(true);
    setDropError(null);
    const { child, parent } = pendingDrop;

    // Close existing rattachement
    const { data: existing } = await supabase.from("uo_rattachement")
      .select("id").eq("enfant_uo_id", child.id).is("date_fin", null).eq("actif", true).maybeSingle();
    if (existing) {
      const d = new Date(dropForm.date_debut);
      d.setDate(d.getDate() - 1);
      await supabase.from("uo_rattachement")
        .update({ actif: false, date_fin: d.toISOString().split("T")[0] }).eq("id", existing.id);
    }

    // Insert new rattachement
    const { error } = await supabase.from("uo_rattachement").insert([{
      parent_uo_id: parent.id,
      enfant_uo_id: child.id,
      date_debut: dropForm.date_debut,
      date_fin: null,
      actif: true,
      reference_decision: dropForm.reference_decision || null,
      date_decision: dropForm.date_decision || null,
    }]);

    if (error) { setDropError(error.message); setSavingDrop(false); return; }

    // Update parent_id
    await supabase.from("unites_organisationnelles").update({ parent_id: parent.id }).eq("id", child.id);

    setSavingDrop(false);
    setShowDropDialog(false);
    setPendingDrop(null);
    await onReload();
  };

  // SVG mouse events
  // Wheel handler : attaché en useEffect avec { passive: false } pour pouvoir preventDefault
  // (sinon le navigateur émet un warning car les listeners JSX sont passifs par défaut sur React 17+)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      // Scroll horizontal (Maj+molette ou trackpad) ou avec Ctrl => on laisse passer pour le scroll de page
      if (e.shiftKey || e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      // Sinon, c'est un zoom dans l'organigramme
      e.preventDefault();
      setScale(s => Math.max(0.25, Math.min(2, s * (e.deltaY > 0 ? 0.9 : 1.1))));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  const onSVGMouseDown = (e: React.MouseEvent) => {
    if (dragNode) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  const onNodeMouseDown = (e: React.MouseEvent, node: TNode) => {
    e.stopPropagation();
    const svgPos = toSVG(e.clientX, e.clientY);
    setDragNode({ uo: node.uo, ghostX: svgPos.x - node.x, ghostY: svgPos.y - node.y });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragNode) {
      const svgPos = toSVG(e.clientX, e.clientY);
      setDragNode(d => d ? { ...d, ghostX: svgPos.x - NODE_W / 2, ghostY: svgPos.y - NODE_H / 2 } : null);
      const hit = hitTest(svgPos.x, svgPos.y);
      setDropTargetId(hit && hit.uo.id !== dragNode.uo.id && isValidDrop(dragNode.uo, hit.uo) ? hit.uo.id : null);
    } else if (isPanning.current) {
      setPan(p => ({ x: p.x + e.clientX - lastMouse.current.x, y: p.y + e.clientY - lastMouse.current.y }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (dragNode) {
      const svgPos = toSVG(e.clientX, e.clientY);
      const hit = hitTest(svgPos.x, svgPos.y);
      if (hit && hit.uo.id !== dragNode.uo.id && isValidDrop(dragNode.uo, hit.uo)) {
        setPendingDrop({ child: dragNode.uo, parent: hit.uo });
        setDropForm({ date_debut: new Date().toISOString().split("T")[0], reference_decision: "", date_decision: "" });
        setShowDropDialog(true);
      }
      setDragNode(null);
      setDropTargetId(null);
    }
    isPanning.current = false;
  };

  const curve = (f: TNode, t: TNode) => {
    if (orientation === "horizontal") {
      // Lien horizontal : sortie côté droit du parent → entrée côté gauche de l'enfant
      const x1 = f.x + NODE_W, y1 = f.y + NODE_H / 2, x2 = t.x, y2 = t.y + NODE_H / 2, mx = (x1 + x2) / 2;
      return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
    } else {
      // Lien vertical : sortie côté bas du parent → entrée côté haut de l'enfant
      const x1 = f.x + NODE_W / 2, y1 = f.y + NODE_H, x2 = t.x + NODE_W / 2, y2 = t.y, my = (y1 + y2) / 2;
      return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
    }
  };

  // Calculer les dimensions réelles du SVG d'après les positions des nœuds
  const svgWidth = allNodes.length > 0
    ? Math.max(...allNodes.map(n => n.x + NODE_W)) + 80
    : 800;
  const svgHeight = allNodes.length > 0
    ? Math.max(...allNodes.map(n => n.y + NODE_H)) + 80
    : 600;

  if (!allNodes.length) return (
    <div className="text-sm text-center py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
      <Network size={32} className="mx-auto mb-2 opacity-30" />Aucune UO
    </div>
  );

  const draggedNode = dragNode ? allNodes.find(n => n.uo.id === dragNode.uo.id) : null;

  return (
    <>
      <div style={{ position: "relative", width: "100%", height: 560,
          background: "hsl(var(--muted) / 0.12)", borderRadius: "var(--border-radius-lg)",
          border: "0.5px solid hsl(var(--border))",
          cursor: dragNode ? "grabbing" : "default", overflow: "hidden" }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>

        {/* Conteneur scrollable autour du SVG */}
        <div style={{ position: "absolute", inset: 0, overflow: "auto" }}>

        {/* Controles zoom + actions */}
        <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10, display: "flex", gap: 6, alignItems: "center" }}>
          {rootUoId && onSetRootUo && (
            <button
              onClick={() => onSetRootUo(null)}
              style={{ height: 30, padding: "0 12px", borderRadius: 6,
                border: "0.5px solid hsl(var(--accent))",
                background: "hsl(var(--accent) / 0.1)",
                color: "hsl(var(--accent))", cursor: "pointer",
                fontSize: 11, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 4 }}
              title="Remonter au sommet de l'organigramme"
            >
              ↑ Remonter
            </button>
          )}

          {/* Toggle orientation Horizontal / Vertical */}
          <div style={{ display: "flex", height: 30, borderRadius: 6, border: "0.5px solid hsl(var(--border))", overflow: "hidden" }}>
            {([
              { v: "horizontal" as const, label: "→", title: "Affichage horizontal" },
              { v: "vertical" as const, label: "↓", title: "Affichage vertical" },
            ]).map(o => (
              <button
                key={o.v}
                onClick={() => setOrientation(o.v)}
                title={o.title}
                style={{
                  width: 32, fontSize: 14, fontWeight: 700, cursor: "pointer",
                  background: orientation === o.v ? "hsl(var(--accent))" : "hsl(var(--background))",
                  color: orientation === o.v ? "white" : "hsl(var(--foreground))",
                  border: "none",
                  borderRight: o.v === "horizontal" ? "0.5px solid hsl(var(--border))" : "none",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Dropdown profondeur */}
          <select
            value={maxDepth}
            onChange={e => setMaxDepth(parseInt(e.target.value, 10))}
            title="Limiter la profondeur affichée"
            style={{
              height: 30, padding: "0 8px", borderRadius: 6,
              border: "0.5px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <option value={0}>Tous niveaux</option>
            <option value={1}>Niv. 1</option>
            <option value={2}>Niv. 1-2</option>
            <option value={3}>Niv. 1-3</option>
            <option value={4}>Niv. 1-4</option>
            <option value={5}>Niv. 1-5</option>
          </select>

          {[{ label: "+", fn: () => setScale(s => Math.min(2, s * 1.2)) },
            { label: "-", fn: () => setScale(s => Math.max(0.25, s * 0.8)) },
            { label: "Reset", fn: () => { setScale(0.85); } },
          ].map(btn => (
            <button key={btn.label} onClick={btn.fn} style={{ height: 30, minWidth: 30, padding: "0 8px", borderRadius: 6,
              border: "0.5px solid hsl(var(--border))", background: "hsl(var(--background))",
              color: "hsl(var(--foreground))", cursor: "pointer",
              fontSize: btn.label.length === 1 ? 18 : 11,
              display: "flex", alignItems: "center", justifyContent: "center" }}>{btn.label}</button>
          ))}
          <span style={{ height: 30, padding: "0 10px", borderRadius: 6,
            border: "0.5px solid hsl(var(--border))", background: "hsl(var(--background))",
            color: "hsl(var(--muted-foreground))", fontSize: 11,
            display: "flex", alignItems: "center" }}>{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setShowExport(true)}
            style={{ height: 30, padding: "0 12px", borderRadius: 6,
              border: "0.5px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))", cursor: "pointer",
              fontSize: 11, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 4 }}
            title="Exporter l'organigramme"
          >
            ⬇ Exporter
          </button>
        </div>

        {/* Banniere drag en cours */}
        {dragNode && (
          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10,
            display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
            borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: "hsl(var(--primary) / 0.1)",
            border: "1px dashed hsl(var(--primary) / 0.4)",
            color: "hsl(var(--primary))" }}>
            <GripVertical size={13} />
            Deplacer <strong>{dragNode.uo.libelle}</strong> — Deposer sur une UO valide
          </div>
        )}

        <svg ref={svgRef} width={svgWidth * scale} height={svgHeight * scale} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ userSelect: "none", display: "block" }}>
          <g>
            {/* Edges */}
            {edges.map((e, i) => (
              <path key={i} d={curve(e.f, e.t)} fill="none"
                stroke="hsl(var(--border))" strokeWidth={1.5} />
            ))}

            {/* Nodes */}
            {allNodes.map(node => {
              const typeUo = typesUo.find(t => t.code === node.uo.type_uo);
              const c = typeUo?.couleur || "hsl(var(--primary))";
              const resp = node.uo.responsable_id ? collaborateursMap.get(node.uo.responsable_id) : null;
              const respLabel = resp ? `${resp.matricule} - ${resp.nom} ${resp.prenom}`.slice(0, 30) : null;
              const isTemp = node.uo.responsable_temporaire === true;
              const isDragging = dragNode?.uo.id === node.uo.id;
              const isDropTarget = dropTargetId === node.uo.id;
              const isInvalidTarget = dragNode && dragNode.uo.id !== node.uo.id && dropTargetId !== node.uo.id && !isValidDrop(dragNode.uo, node.uo) && !isDragging;

              return (
                <g key={node.uo.id} transform={`translate(${node.x},${node.y})`}
                  style={{ cursor: dragNode ? (isDropTarget ? "copy" : "not-allowed") : "grab" }}
                  onMouseDown={e => onNodeMouseDown(e, node)}
                  onClick={e => { if (!dragNode) { e.stopPropagation(); onEdit(node.uo); } }}
                  onDoubleClick={e => { e.stopPropagation(); onSetRootUo?.(node.uo.id); }}>

                  {/* Ombre */}
                  {!isDragging && <rect x={3} y={3} width={NODE_W} height={NODE_H} rx={10} fill="rgba(0,0,0,0.07)" />}

                  {/* Fond */}
                  <rect width={NODE_W} height={NODE_H} rx={10}
                    fill={isDragging ? "hsl(var(--muted) / 0.3)" : "hsl(var(--background))"}
                    stroke={isDropTarget ? "#22c55e" : isDragging ? "hsl(var(--border))" : c}
                    strokeWidth={isDropTarget ? 2.5 : 1.5}
                    strokeDasharray={isDragging ? "6,3" : "none"}
                    opacity={isDragging ? 0.4 : 1} />

                  {!isDragging && (
                    <>
                      <rect width={7} height={NODE_H} rx={5} fill={c} />
                      <rect x={4} width={4} height={NODE_H} fill={c} />
                      <text x={18} y={24} fontSize={12.5} fontWeight={500}
                        fill="hsl(var(--foreground))" fontFamily="var(--font-sans)">
                        {node.uo.libelle.length > 24 ? node.uo.libelle.slice(0, 24) + "..." : node.uo.libelle}
                      </text>
                      {node.uo.code && (
                        <g>
                          <rect x={18} y={30} width={Math.min(node.uo.code.length * 7.5 + 12, 90)} height={17} rx={4} fill={c + "28"} />
                          <text x={23} y={43} fontSize={10} fontWeight={600} fill={c} fontFamily="var(--font-mono)">{node.uo.code}</text>
                        </g>
                      )}
                      <text x={18} y={63} fontSize={10.5} fill="hsl(var(--muted-foreground))" fontFamily="var(--font-sans)">
                        {(typeUo?.libelle || "-").slice(0, 26)}{node.uo.niveau != null ? ` - Niv. ${node.uo.niveau}` : ""}
                      </text>
                      {respLabel && (
                        <text x={18} y={80} fontSize={10}
                          fill={isTemp ? "hsl(38 60% 40%)" : "hsl(var(--muted-foreground))"}
                          fontFamily="var(--font-sans)" opacity={0.85}>
                          {respLabel}{isTemp ? " (temp.)" : ""}
                        </text>
                      )}
                      <circle cx={NODE_W - 14} cy={14} r={5} fill={node.uo.actif ? "#22c55e" : "#94a3b8"} />
                      {isDropTarget && (
                        <text x={NODE_W / 2} y={NODE_H + 16} fontSize={10} fontWeight={600}
                          textAnchor="middle" fill="#22c55e" fontFamily="var(--font-sans)">
                          Deposer ici
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}

            {/* Ghost node suivant la souris */}
            {dragNode && draggedNode && (
              <g transform={`translate(${dragNode.ghostX},${dragNode.ghostY})`} style={{ pointerEvents: "none" }}>
                <rect width={NODE_W} height={NODE_H} rx={10}
                  fill="hsl(var(--primary) / 0.15)"
                  stroke="hsl(var(--primary))" strokeWidth={2}
                  strokeDasharray="6,3" />
                {(() => {
                  const typeUo = typesUo.find(t => t.code === dragNode.uo.type_uo);
                  const c = typeUo?.couleur || "hsl(var(--primary))";
                  return (
                    <>
                      <rect width={7} height={NODE_H} rx={5} fill={c} opacity={0.6} />
                      <text x={18} y={32} fontSize={12} fontWeight={500}
                        fill="hsl(var(--primary))" fontFamily="var(--font-sans)">
                        {dragNode.uo.libelle.length > 24 ? dragNode.uo.libelle.slice(0, 24) + "..." : dragNode.uo.libelle}
                      </text>
                      {dragNode.uo.code && (
                        <text x={18} y={52} fontSize={10} fontWeight={600}
                          fill="hsl(var(--primary))" fontFamily="var(--font-mono)">{dragNode.uo.code}</text>
                      )}
                    </>
                  );
                })()}
              </g>
            )}
          </g>
        </svg>

        {/* Legende */}
        </div>

        <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", gap: 12, fontSize: 11,
          color: "hsl(var(--muted-foreground))", background: "hsl(var(--background))",
          padding: "4px 10px", borderRadius: 6, border: "0.5px solid hsl(var(--border))" }}>
          {[{ color: "#22c55e", label: "Actif" }, { color: "#94a3b8", label: "Inactif" }].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />{label}
            </span>
          ))}
          <span>Clic = modifier</span>
          <span>Double-clic = focus UO</span>
          <span>Glisser fond = déplacer la vue</span>
          <span>Glisser noeud = rattacher</span>
          <span>Molette = zoom</span>
        </div>
      </div>

      {/* Modale Export PNG / PDF */}
      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Exporter l'organigramme</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Format */}
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                Format
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "png" as const, label: "PNG (image)" },
                  { v: "pdf" as const, label: "PDF" },
                ]).map(o => (
                  <button
                    key={o.v}
                    onClick={() => setExportFormat(o.v)}
                    className="px-3 py-2 rounded-lg text-sm font-medium border transition-colors"
                    style={{
                      background: exportFormat === o.v ? "hsl(var(--accent))" : "transparent",
                      borderColor: exportFormat === o.v ? "hsl(var(--accent))" : "hsl(var(--border))",
                      color: exportFormat === o.v ? "white" : "hsl(var(--foreground))",
                    }}
                    type="button"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Périmètre */}
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                Périmètre
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "current" as const, label: "Vue actuelle" },
                  { v: "full" as const, label: "Organigramme complet" },
                ]).map(o => (
                  <button
                    key={o.v}
                    onClick={() => setExportScope(o.v)}
                    className="px-3 py-2 rounded-lg text-sm font-medium border transition-colors"
                    style={{
                      background: exportScope === o.v ? "hsl(var(--accent))" : "transparent",
                      borderColor: exportScope === o.v ? "hsl(var(--accent))" : "hsl(var(--border))",
                      color: exportScope === o.v ? "white" : "hsl(var(--foreground))",
                    }}
                    type="button"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                {exportScope === "current"
                  ? "Exporte uniquement ce que vous voyez à l'écran (avec le zoom et le pan actuels)."
                  : "Exporte l'organigramme entier (recadré automatiquement, ignore le zoom)."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExport(false)} disabled={exporting}>
              Annuler
            </Button>
            <Button onClick={handleExport} disabled={exporting} className="gap-2">
              {exporting ? "Export en cours…" : (<><Download size={14} /> Télécharger</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmation rattachement */}
      <Dialog open={showDropDialog} onOpenChange={open => { if (!open) { setShowDropDialog(false); setPendingDrop(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MoveRight size={18} style={{ color: "hsl(var(--primary))" }} />
              Nouveau rattachement
            </DialogTitle>
          </DialogHeader>
          {pendingDrop && (
            <div className="space-y-4 py-2">
              <div className="flex flex-col gap-2 p-3 rounded-lg text-sm"
                style={{ background: "hsl(var(--muted) / 0.4)", border: "1px solid hsl(var(--border))" }}>
                {/* UO à déplacer */}
                <div className="flex items-start gap-3">
                  <div className="w-16 flex-shrink-0 text-[10px] font-medium uppercase tracking-wide pt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Depuis
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Network size={12} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                      <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                        {pendingDrop.child.libelle}
                      </span>
                      {pendingDrop.child.code && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                          {pendingDrop.child.code}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {typesUo.find(t => t.code === pendingDrop.child.type_uo)?.libelle || "—"}
                      {pendingDrop.child.niveau != null ? ` · Niveau ${pendingDrop.child.niveau}` : ""}
                    </span>
                  </div>
                </div>

                {/* Flèche */}
                <div className="flex items-center gap-2 pl-16">
                  <MoveRight size={14} style={{ color: "hsl(var(--primary))" }} />
                  <span className="text-[11px] font-medium" style={{ color: "hsl(var(--primary))" }}>rattachée à</span>
                </div>

                {/* UO parente */}
                <div className="flex items-start gap-3">
                  <div className="w-16 flex-shrink-0 text-[10px] font-medium uppercase tracking-wide pt-0.5" style={{ color: "hsl(var(--primary))" }}>
                    Vers
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Network size={12} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
                      <span className="text-sm font-medium" style={{ color: "hsl(var(--primary))" }}>
                        {pendingDrop.parent.libelle}
                      </span>
                      {pendingDrop.parent.code && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                          {pendingDrop.parent.code}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {typesUo.find(t => t.code === pendingDrop.parent.type_uo)?.libelle || "—"}
                      {pendingDrop.parent.niveau != null ? ` · Niveau ${pendingDrop.parent.niveau}` : ""}
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Date d'effet <span style={{ color: "hsl(var(--destructive))" }}>*</span>
                  </label>
                  <Input type="date" className="h-8 text-sm" value={dropForm.date_debut}
                    onChange={e => setDropForm(f => ({ ...f, date_debut: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Ref. decision</label>
                  <Input className="h-8 text-sm" placeholder="Ex: DEC-2026-001" value={dropForm.reference_decision}
                    onChange={e => setDropForm(f => ({ ...f, reference_decision: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Date decision</label>
                  <Input type="date" className="h-8 text-sm" value={dropForm.date_decision}
                    onChange={e => setDropForm(f => ({ ...f, date_decision: e.target.value }))} />
                </div>
              </div>
              {dropError && (
                <div className="text-xs p-2 rounded" style={{ background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))" }}>
                  {dropError}
                </div>
              )}
              <div className="text-xs p-2.5 rounded-lg" style={{ background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--muted-foreground))" }}>
                L'ancien rattachement actif sera automatiquement cloture a la veille de la date d'effet.
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowDropDialog(false); setPendingDrop(null); }}>
              <X size={13} className="mr-1" /> Annuler
            </Button>
            <Button size="sm" onClick={applyDrop} disabled={savingDrop || !dropForm.date_debut} className="gap-1.5">
              <Check size={13} /> {savingDrop ? "Enregistrement..." : "Confirmer le rattachement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};



/* ══════════════════════════════════════════════
   TAB 2 - UNITÉS ORGANISATIONNELLES
══════════════════════════════════════════════ */
type UOFormTab = "identification" | "localisation" | "rattachements" | "organigramme" | "interims";

const UOTab: React.FC<{
  societes: Societe[];
  typesUo: RefTypeUo[];
  pays: RefItem[];
  regions: RefRegion[];
  villes: RefVille[];
}> = ({ societes, typesUo, pays, regions, villes }) => {
  const [rows, setRows] = useState<UniteOrg[]>([]);
  const [etabs, setEtabs] = useState<EtabMinimal[]>([]);
  const [collaborateursMap, setCollaborateursMap] = useState<Map<string, { matricule: string; nom: string; prenom: string }>>(new Map());
  const [search, setSearch] = useState("");
  const [filterSociete, setFilterSociete] = useState<string>("");
  // Focus sur une UO spécifique (rend cette UO comme racine de l'organigramme)
  const [rootUoId, setRootUoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UniteOrg | null>(null);
  const [form, setForm] = useState<Partial<UniteOrg>>(EMPTY_UO);
  const [formSocieteId, setFormSocieteId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formTab, setFormTab] = useState<UOFormTab>("identification");
  const [rattachements, setRattachements] = useState<UORattachement[]>([]);
  const [ratForm, setRatForm] = useState<Partial<UORattachement>>({ actif: true });
  const [savingRat, setSavingRat] = useState(false);
  const [showRatForm, setShowRatForm] = useState(false);
  const [viewMode, setViewMode] = useState<"liste" | "organigramme">("liste");
  const [postesRef, setPostesRef] = useState<{ code: string; libelle: string; code_etat_poste?: string }[]>([]);
  const [posteResponsableTitulaire, setPosteResponsableTitulaire] = useState<{ id: string; matricule: string; nom: string; prenom: string } | null>(null);
  const [posteVacantAlert, setPosteVacantAlert] = useState(false);
  const [resolvingPoste, setResolvingPoste] = useState(false);
  const [vacanceSearch, setVacanceSearch] = useState("");
  const [vacanceSuggestions, setVacanceSuggestions] = useState<{ id: string; matricule: string; nom: string; prenom: string }[]>([]);
  const [manualResponsable, setManualResponsable] = useState<{ id: string; matricule: string; nom: string; prenom: string } | null>(null);

  const getAncestorChain = useCallback((uoId: string | undefined, allUos: UniteOrg[]): string[] => {
    if (!uoId) return [];
    const chain: string[] = [];
    let currentId: string | undefined = uoId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      chain.push(currentId);
      const current = allUos.find(u => u.id === currentId);
      currentId = current?.parent_id;
    }
    return chain;
  }, []);

  const loadPostesEligibles = useCallback(async (uoId: string | undefined) => {
    const { data: emploisResp } = await supabase.from("ref_emploi").select("code").eq("est_emploi_responsabilite", true).eq("actif", true);
    if (!emploisResp?.length) { setPostesRef([]); return; }
    const codesEmploisResp = emploisResp.map(e => e.code);
    const ancestorIds = getAncestorChain(uoId, rows);
    let query = supabase.from("ref_poste").select("code, libelle, code_etat_poste, unite_id").eq("actif", true).in("code_emploi", codesEmploisResp);
    if (ancestorIds.length > 0) query = query.in("unite_id", ancestorIds);
    const { data } = await query.order("libelle");
    setPostesRef(data || []);
  }, [rows, getAncestorChain]);

  const resolvePosteResponsable = useCallback(async (codePoste: string | undefined) => {
    if (!codePoste) { setPosteResponsableTitulaire(null); setPosteVacantAlert(false); return; }
    setResolvingPoste(true);
    const { data: instances } = await supabase.from("ref_poste_instances").select("code_instance").eq("code_poste", codePoste).eq("archive", false);
    const instanceCodes = (instances || []).map(i => i.code_instance);
    let collaborateurId: string | null = null;
    if (instanceCodes.length > 0) {
      const { data: aff } = await supabase.from("collaborateur_affectations").select("collaborateur_id").in("code_poste", instanceCodes).is("date_fin_poste", null).eq("archive", false).maybeSingle();
      collaborateurId = aff?.collaborateur_id ?? null;
    }
    if (collaborateurId) {
      const { data: collab } = await supabase.from("collaborateurs").select("id, matricule, nom, prenom").eq("id", collaborateurId).single();
      setPosteResponsableTitulaire(collab || null);
      setPosteVacantAlert(false);
    } else {
      setPosteResponsableTitulaire(null);
      setPosteVacantAlert(true);
    }
    setResolvingPoste(false);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [etabRes, uoRes, collabRes] = await Promise.all([
      supabase.from("etablissements").select("id, societe_id").order("libelle"),
      supabase.from("unites_organisationnelles").select("*").order("niveau").order("libelle"),
      supabase.from("collaborateurs").select("id, matricule, nom, prenom").eq("archive", false),
    ]);
    if (etabRes.error) setError(etabRes.error.message); else setEtabs(etabRes.data || []);
    if (uoRes.error) setError(uoRes.error.message); else setRows(uoRes.data || []);
    if (collabRes.data) {
      const map = new Map<string, { matricule: string; nom: string; prenom: string }>();
      collabRes.data.forEach(c => map.set(c.id, { matricule: c.matricule, nom: c.nom, prenom: c.prenom }));
      setCollaborateursMap(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadRattachements = useCallback(async (uoId: string) => {
    const { data } = await supabase.from("uo_rattachement").select("*").or(`parent_uo_id.eq.${uoId},enfant_uo_id.eq.${uoId}`).order("date_debut", { ascending: false });
    setRattachements(data || []);
  }, []);

  const getSocieteIdForUo = (uo: UniteOrg): string | undefined => {
    const etab = etabs.find(e => e.id === uo.etablissement_id);
    return etab?.societe_id;
  };

  const filtered = rows.filter(r => {
    const matchSearch = r.libelle.toLowerCase().includes(search.toLowerCase()) || (r.code ?? "").toLowerCase().includes(search.toLowerCase());
    const socId = getSocieteIdForUo(r);
    const matchSociete = !filterSociete || socId === filterSociete;
    return matchSearch && matchSociete;
  });

  const roots = filtered.filter(r => !r.parent_id || !filtered.find(p => p.id === r.parent_id));
  const getChildren = (parentId: string) => filtered.filter(r => r.parent_id === parentId);

  const openCreate = () => {
    setEditing(null); setForm({ ...EMPTY_UO }); setFormSocieteId(filterSociete || "");
    setFormTab("identification"); setRattachements([]); setShowRatForm(false);
    setPosteResponsableTitulaire(null); setPosteVacantAlert(false);
    setManualResponsable(null); setVacanceSearch(""); setVacanceSuggestions([]);
    loadPostesEligibles(undefined); setShowForm(true);
  };

  const openEdit = (r: UniteOrg) => {
    setEditing(r); setForm({ ...r });
    const socId = getSocieteIdForUo(r);
    setFormSocieteId(socId || ""); setFormTab("identification");
    setShowRatForm(false); setVacanceSearch(""); setVacanceSuggestions([]);
    if (r.responsable_temporaire === true && r.responsable_id) {
      const collab = collaborateursMap.get(r.responsable_id);
      if (collab) { setManualResponsable({ id: r.responsable_id, ...collab }); setPosteVacantAlert(true); setPosteResponsableTitulaire(null); }
      else {
        supabase.from("collaborateurs").select("id, matricule, nom, prenom").eq("id", r.responsable_id).single().then(({ data }) => {
          if (data) { setManualResponsable(data); setPosteVacantAlert(true); setPosteResponsableTitulaire(null); }
        });
        setManualResponsable(null);
      }
    } else { setManualResponsable(null); resolvePosteResponsable(r.poste_responsable_code); }
    loadRattachements(r.id); loadPostesEligibles(r.id); setShowForm(true);
  };

  const cancel = () => {
    setShowForm(false); setEditing(null); setRattachements([]);
    setPosteResponsableTitulaire(null); setPosteVacantAlert(false);
    setManualResponsable(null); setVacanceSearch(""); setVacanceSuggestions([]);
  };

  const setField = (k: string, v: string | number | boolean) => {
    if (k === "type_uo") {
      const typeRef = typesUo.find(t => t.code === v);
      setForm(f => ({ ...f, type_uo: v as string, niveau: typeRef?.niveau ?? f.niveau }));
    } else { setForm(f => ({ ...f, [k]: v })); }
  };

  const save = async () => {
    if (!form.libelle?.trim() || !formSocieteId) return;
    setSaving(true); setError(null);
    const soc = societes.find(s => s.id === formSocieteId);
    const { id: etabId, error: etabError } = await getOrCreateDefaultEtab(formSocieteId, soc?.raison_sociale || "Établissement");
    if (!etabId) { setError(etabError || "Impossible de trouver l'établissement par défaut"); setSaving(false); return; }
    const newParentId = form.parent_id || null;
    const payload = {
      ...form, etablissement_id: etabId, parent_id: newParentId,
      code_pays: form.adresse_societe ? null : (form.code_pays || null),
      code_region: form.adresse_societe ? null : (form.code_region || null),
      code_ville: form.adresse_societe ? null : (form.code_ville || null),
      code_postal: form.adresse_societe ? null : (form.code_postal || null),
      poste_responsable_code: form.poste_responsable_code || null,
      responsable_id: posteResponsableTitulaire?.id || manualResponsable?.id || null,
      responsable_temporaire: posteResponsableTitulaire ? false : manualResponsable ? true : null,
    } as UniteOrg;
    let saveError: string | null = null;
    let savedUoId: string | null = null;
    if (editing) {
      const { error } = await supabase.from("unites_organisationnelles").update(payload).eq("id", editing.id);
      if (error) saveError = error.message; else savedUoId = editing.id;
    } else {
      const { data, error } = await supabase.from("unites_organisationnelles").insert([payload]).select("id").single();
      if (error) saveError = error.message; else savedUoId = data?.id ?? null;
    }
    if (!saveError && savedUoId && newParentId) {
      const oldParentId = editing?.parent_id || null;
      if (oldParentId !== newParentId) {
        if (oldParentId) await supabase.from("uo_rattachement").update({ actif: false, date_fin: new Date().toISOString().split("T")[0] }).eq("parent_uo_id", oldParentId).eq("enfant_uo_id", savedUoId).is("date_fin", null);
        const { data: existing } = await supabase.from("uo_rattachement").select("id").eq("parent_uo_id", newParentId).eq("enfant_uo_id", savedUoId).eq("actif", true).maybeSingle();
        if (!existing) await supabase.from("uo_rattachement").insert([{ parent_uo_id: newParentId, enfant_uo_id: savedUoId, date_debut: new Date().toISOString().split("T")[0], actif: true }]);
      }
    }
    if (!saveError && savedUoId && !newParentId && editing?.parent_id) {
      await supabase.from("uo_rattachement").update({ actif: false, date_fin: new Date().toISOString().split("T")[0] }).eq("parent_uo_id", editing.parent_id).eq("enfant_uo_id", savedUoId).is("date_fin", null);
    }
    setSaving(false);
    if (saveError) setError(saveError); else { await loadAll(); cancel(); }
  };

  const doDelete = async (id: string) => {
    const { error } = await supabase.from("unites_organisationnelles").update({ actif: false } as any).eq("id", id);
    if (error) setError(error.message); else { setDeleteId(null); await loadAll(); }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const saveRattachement = async () => {
    if (!editing || !ratForm.enfant_uo_id || !ratForm.date_debut) return;
    setSavingRat(true);
    const { data: existingRat } = await supabase.from("uo_rattachement").select("id, parent_uo_id").eq("enfant_uo_id", ratForm.enfant_uo_id).is("date_fin", null).eq("actif", true).maybeSingle();
    if (existingRat && existingRat.parent_uo_id !== editing.id) {
      const dateEffet = new Date(ratForm.date_debut!); dateEffet.setDate(dateEffet.getDate() - 1);
      await supabase.from("uo_rattachement").update({ actif: false, date_fin: dateEffet.toISOString().split("T")[0] }).eq("id", existingRat.id);
    }
    const { error } = await supabase.from("uo_rattachement").insert([{ parent_uo_id: editing.id, enfant_uo_id: ratForm.enfant_uo_id, date_debut: ratForm.date_debut, date_fin: ratForm.date_fin || null, actif: ratForm.actif ?? true, reference_decision: ratForm.reference_decision || null, date_decision: ratForm.date_decision || null }]);
    if (!error) {
      await supabase.from("unites_organisationnelles").update({ parent_id: editing.id }).eq("id", ratForm.enfant_uo_id);
      setRows(prev => prev.map(r => r.id === ratForm.enfant_uo_id ? { ...r, parent_id: editing.id } : r));
      await loadRattachements(editing.id); setRatForm({ actif: true }); setShowRatForm(false);
    } else { setError(error.message); }
    setSavingRat(false);
  };

  const deleteRattachement = async (id: string) => {
    await supabase.from("uo_rattachement").delete().eq("id", id);
    if (editing) loadRattachements(editing.id);
  };

  const filteredRegions = form.code_pays ? regions.filter(r => r.code_pays === form.code_pays) : regions;
  const filteredVilles = form.code_region ? villes.filter(v => v.code_region === form.code_region) : villes;

  const UORow = ({ uo, depth = 0 }: { uo: UniteOrg; depth?: number }) => {
    const children = getChildren(uo.id);
    const isExpanded = expanded.has(uo.id);
    const socId = getSocieteIdForUo(uo);
    const soc = societes.find(s => s.id === socId);
    const typeUo = typesUo.find(t => t.code === uo.type_uo);
    const responsable = uo.responsable_id ? collaborateursMap.get(uo.responsable_id) : null;
    return (
      <>
        <tr className="border-t hover:bg-muted/30 transition-colors" style={{ borderColor: "hsl(var(--border))" }}>
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
              {children.length > 0 ? (
                <button onClick={() => toggleExpand(uo.id)} className="p-0.5 hover:bg-muted/60 rounded">
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : <span className="w-5" />}
              <div>
                <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{uo.libelle}</span>
                {uo.code && <span className="ml-2 text-xs font-mono opacity-50">{uo.code}</span>}
              </div>
            </div>
          </td>
          <td className="px-3 py-2.5 text-xs">{soc?.raison_sociale || "—"}</td>
          <td className="px-3 py-2.5 text-xs">{typeUo?.libelle || uo.type_uo || "—"}</td>
          <td className="px-3 py-2.5 text-xs text-center">{uo.niveau ?? "—"}</td>
          <td className="px-3 py-2.5 text-xs">
            {responsable ? (
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{responsable.matricule}</span>
                  <span>{responsable.nom} {responsable.prenom}</span>
                </span>
                {uo.responsable_temporaire === true ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium w-fit" style={{ background: "hsl(38 92% 50% / 0.1)", color: "hsl(38 60% 40%)", border: "1px solid hsl(38 92% 50% / 0.25)" }}>
                    <AlertTriangle size={9} />Temporaire
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium w-fit" style={{ background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))" }}>
                    <Check size={9} />Manager UO
                  </span>
                )}
              </span>
            ) : <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
          </td>
          <td className="px-3 py-2.5">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={uo.actif ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" } : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              {uo.actif ? "Active" : "Inactive"}
            </span>
          </td>
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => openEdit(uo)} className="p-1.5 rounded hover:bg-muted/60 transition-colors" style={{ color: "hsl(var(--muted-foreground))" }}><Pencil size={13} /></button>
              {deleteId === uo.id ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => doDelete(uo.id)} className="p-1.5 rounded text-red-500 hover:bg-red-50"><Check size={13} /></button>
                  <button onClick={() => setDeleteId(null)} className="p-1.5 rounded hover:bg-muted/60"><X size={13} /></button>
                </div>
              ) : (
                <button onClick={() => setDeleteId(uo.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors text-red-400"><Trash2 size={13} /></button>
              )}
            </div>
          </td>
        </tr>
        {isExpanded && children.map(child => <UORow key={child.id} uo={child} depth={depth + 1} />)}
      </>
    );
  };

  const UO_FORM_TABS: { key: UOFormTab; label: string }[] = [
    { key: "identification", label: "Identification" },
    { key: "localisation", label: "Localisation" },
    ...(editing ? [{ key: "rattachements" as UOFormTab, label: "Rattachements" }] : []),
    ...(editing ? [{ key: "organigramme" as UOFormTab, label: "Organigramme" }] : []),
    ...(editing ? [{ key: "interims" as UOFormTab, label: "Intérims" }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
          <Input className="pl-8 h-8 text-sm" placeholder="Rechercher une UO…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterSociete || NONE_VALUE} onValueChange={v => setFilterSociete(v === NONE_VALUE ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-52"><SelectValue placeholder="Toutes les sociétés" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Toutes les sociétés</SelectItem>
            {societes.map(s => <SelectItem key={s.id} value={s.id}>{s.raison_sociale}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Dropdown "Afficher à partir de" — uniquement visible en vue organigramme */}
        {viewMode === "organigramme" && (
          <Select value={rootUoId || NONE_VALUE} onValueChange={v => setRootUoId(v === NONE_VALUE ? null : v)}>
            <SelectTrigger className="h-8 text-sm w-52">
              <SelectValue placeholder="À partir de toute l'organisation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Tout afficher</SelectItem>
              {rows
                .filter(u => !filterSociete || (etabs.find(e => e.id === u.etablissement_id)?.societe_id === filterSociete))
                .sort((a, b) => (a.niveau || 99) - (b.niveau || 99) || a.libelle.localeCompare(b.libelle))
                .map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {"  ".repeat(Math.max(0, (u.niveau || 1) - 1))}
                    {u.libelle}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          {(["liste", "organigramme"] as const).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium transition-colors"
              style={{ background: viewMode === mode ? "hsl(var(--primary))" : "transparent", color: viewMode === mode ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))" }}>
              {mode === "liste" ? <><List size={13} /> Liste</> : <><GitBranch size={13} /> Organigramme</>}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5 ml-auto"><Plus size={14} /> Nouvelle UO</Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm p-3 rounded-lg border" style={{ background: "hsl(var(--destructive) / 0.08)", borderColor: "hsl(var(--destructive) / 0.3)", color: "hsl(var(--destructive))" }}>
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto p-0.5"><X size={13} /></button>
        </div>
      )}

      {showForm && (
        <div className="border rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
            <h3 className="font-semibold text-sm">{editing ? `Modifier : ${editing.libelle}` : "Nouvelle unité organisationnelle"}</h3>
            <button onClick={cancel} className="p-1 rounded hover:bg-muted/60" style={{ color: "hsl(var(--muted-foreground))" }}><X size={15} /></button>
          </div>
          <div className="flex border-b" style={{ borderColor: "hsl(var(--border))" }}>
            {UO_FORM_TABS.map(t => (
              <button key={t.key} onClick={() => setFormTab(t.key)} className="px-4 py-2.5 text-xs font-medium transition-colors"
                style={{ color: formTab === t.key ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", borderBottom: formTab === t.key ? "2px solid hsl(var(--primary))" : "2px solid transparent", background: formTab === t.key ? "hsl(var(--primary) / 0.04)" : "transparent" }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="p-5 space-y-4">
            {formTab === "identification" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <FieldSelect label="Société *" name="formSocieteId" value={formSocieteId} onChange={(_k, v) => setFormSocieteId(v)} required options={societes.map(s => ({ value: s.id, label: s.raison_sociale }))} />
                <FieldInput label="Code" name="code" value={form.code} onChange={setField} placeholder="Ex: DIR-GEN" />
                <FieldInput label="Libellé *" name="libelle" value={form.libelle} onChange={setField} required />
                <FieldSelectCreatable label="Type d'UO *" name="type_uo" value={form.type_uo ?? ""} onChange={setField} options={typesUo.map(t => ({ value: t.code, label: t.libelle }))} refTable="ref_type_uo" />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Niveau hiérarchique</label>
                  <div className="h-8 px-3 flex items-center rounded-md border text-sm" style={{ background: "hsl(var(--muted) / 0.4)", borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                    {form.niveau != null ? `Niveau ${form.niveau}` : <span className="opacity-50 text-xs">— sélectionner un type —</span>}
                  </div>
                </div>
                <FieldSelect label="UO parente" name="parent_id" value={form.parent_id ?? ""}
                  onChange={(_k, v) => { const newParentId = v || undefined; setForm(f => ({ ...f, parent_id: newParentId })); if (!editing) loadPostesEligibles(newParentId); }}
                  options={[{ value: "", label: "— Racine (aucune) —" }, ...rows.filter(r => { if (r.id === editing?.id) return false; if (form.niveau != null) { const pt = typesUo.find(t => t.code === r.type_uo); if (pt?.niveau != null && pt.niveau >= form.niveau) return false; } return true; }).map(r => ({ value: r.id, label: `${r.code ? `[${r.code}] ` : ""}${r.libelle}${r.niveau ? ` (Niv. ${r.niveau})` : ""}` }))]} />
                <ToggleField label="Active" value={form.actif ?? true} onChange={v => setField("actif", v)} />
                <div className="col-span-2 md:col-span-3 border-t pt-3" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Poste Responsable de l'UO</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium block" style={{ color: "hsl(var(--muted-foreground))" }}>Poste désigné comme responsable</label>
                      <div className="flex items-center gap-2">
                        <Select value={form.poste_responsable_code || "__none__"} onValueChange={v => { const code = v === "__none__" ? undefined : v; setForm(f => ({ ...f, poste_responsable_code: code })); resolvePosteResponsable(code); }}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Sélectionner un poste…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Aucun —</SelectItem>
                            {postesRef.map(p => <SelectItem key={p.code} value={p.code}>{p.libelle} <span className="opacity-50 text-xs ml-1">({p.code})</span></SelectItem>)}
                          </SelectContent>
                        </Select>
                        {form.poste_responsable_code && <button type="button" onClick={() => { setForm(f => ({ ...f, poste_responsable_code: undefined })); setPosteResponsableTitulaire(null); setPosteVacantAlert(false); }} className="p-1.5 rounded hover:bg-muted/60 flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}><X size={13} /></button>}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium block" style={{ color: "hsl(var(--muted-foreground))" }}>Collaborateur responsable</label>
                      {resolvingPoste ? <div className="h-8 flex items-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Résolution en cours…</div>
                        : posteResponsableTitulaire ? <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium h-8" style={{ background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.2)" }}><Check size={12} className="flex-shrink-0" /><span className="font-mono font-bold">{posteResponsableTitulaire.matricule}</span><span>—</span><span>{posteResponsableTitulaire.nom} {posteResponsableTitulaire.prenom}</span></div>
                        : posteVacantAlert ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs" style={{ background: "hsl(38 92% 50% / 0.08)", color: "hsl(38 60% 40%)", border: "1px solid hsl(38 92% 50% / 0.25)" }}><AlertTriangle size={11} className="flex-shrink-0" /><span>Poste vacant — désignez un responsable temporaire</span></div>
                            {manualResponsable ? (
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium flex-1" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))" }}>
                                  <span className="font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{manualResponsable.matricule}</span><span>—</span><span>{manualResponsable.nom} {manualResponsable.prenom}</span><span className="ml-1 italic text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>(temporaire)</span>
                                </div>
                                <button type="button" onClick={() => setManualResponsable(null)} className="p-1.5 rounded hover:bg-muted/60 flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}><X size={12} /></button>
                              </div>
                            ) : (
                              <div className="relative">
                                <Input className="h-8 text-xs pr-8" placeholder="Rechercher par matricule ou nom…" value={vacanceSearch}
                                  onChange={async e => { const q = e.target.value; setVacanceSearch(q); if (q.length < 2) { setVacanceSuggestions([]); return; } const { data } = await supabase.from("collaborateurs").select("id, matricule, nom, prenom").eq("archive", false).or(`matricule.ilike.%${q}%,nom.ilike.%${q}%,prenom.ilike.%${q}%`).limit(6); setVacanceSuggestions(data || []); }} />
                                {vacanceSuggestions.length > 0 && (
                                  <div className="absolute top-full left-0 right-0 z-50 rounded-md shadow-lg border mt-1 overflow-hidden" style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))" }}>
                                    {vacanceSuggestions.map(c => <button key={c.id} type="button" className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2" onClick={() => { setManualResponsable(c); setVacanceSearch(""); setVacanceSuggestions([]); }}><span className="font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{c.matricule}</span><span>{c.nom} {c.prenom}</span></button>)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : <div className="h-8 flex items-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{form.poste_responsable_code ? "—" : "Sélectionner un poste ci-contre"}</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {formTab === "localisation" && (
              <div className="space-y-4">
                <div><p className="text-xs font-semibold mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Position physique</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <FieldInput label="Lieu" name="lieu" value={form.lieu} onChange={setField} />
                    <FieldInput label="Bâtiment" name="batiment" value={form.batiment} onChange={setField} />
                    <FieldInput label="Étage" name="etage" value={form.etage} onChange={setField} />
                    <FieldInput label="Bureau" name="bureau" value={form.bureau} onChange={setField} />
                  </div>
                </div>
                <div className="border rounded-lg p-3" style={{ borderColor: "hsl(var(--border))" }}>
                  <ToggleField label="Utiliser l'adresse de la société" value={form.adresse_societe ?? false} onChange={v => setField("adresse_societe", v)} />
                  {form.adresse_societe && <p className="mt-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>L'adresse de la société rattachée sera utilisée.</p>}
                </div>
                {!form.adresse_societe && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Adresse spécifique</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <FieldSelectCreatable label="Pays" name="code_pays" value={form.code_pays ?? ""} onChange={(_k, v) => setForm(f => ({ ...f, code_pays: v, code_region: "", code_ville: "" }))} options={pays.map(p => ({ value: p.code, label: p.libelle }))} refTable="ref_pays" />
                      <FieldSelectCreatable label="Région" name="code_region" value={form.code_region ?? ""} onChange={(_k, v) => setForm(f => ({ ...f, code_region: v, code_ville: "" }))} options={filteredRegions.map(r => ({ value: r.code, label: r.libelle }))} refTable="ref_region" />
                      <FieldSelectCreatable label="Ville" name="code_ville" value={form.code_ville ?? ""} onChange={setField} options={filteredVilles.map(v => ({ value: v.code, label: v.libelle }))} refTable="ref_ville" />
                      <FieldInput label="Code postal" name="code_postal" value={form.code_postal} onChange={setField} />
                      <FieldInput label="Adresse complète" name="adresse_complete" value={form.adresse_complete} onChange={setField} colSpan={2} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FieldInput label="Téléphone" name="telephone" value={form.telephone} onChange={setField} />
                      <FieldInput label="Email" name="email" value={form.email} onChange={setField} type="email" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {formTab === "rattachements" && editing && (() => {
              const editingNiveau = form.niveau ?? editing.niveau;
              const validEnfants = rows.filter(r => { if (r.id === editing.id || r.parent_id === editing.id) return false; if (rattachements.some(rat => rat.enfant_uo_id === r.id && rat.actif)) return false; if (editingNiveau != null) { const ct = typesUo.find(t => t.code === r.type_uo); if (ct?.niveau != null && ct.niveau <= editingNiveau) return false; } return true; });
              const rattachementChildren = rattachements.filter(rat => rat.parent_uo_id === editing.id).map(rat => ({ ...rat, uo: rows.find(r => r.id === rat.enfant_uo_id) })).filter(rat => rat.uo);
              const directChildren = rows.filter(r => r.parent_id === editing.id);
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>UOs rattachées à « {editing.libelle} »</p>
                    <Button size="sm" variant="outline" onClick={() => setShowRatForm(v => !v)} className="gap-1.5 h-7 text-xs"><Plus size={12} /> Ajouter un rattachement</Button>
                  </div>
                  {showRatForm && (
                    <div className="border rounded-lg p-3 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.2)" }}>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <FieldSelect label="UO enfant *" name="enfant_uo_id" value={ratForm.enfant_uo_id ?? ""} onChange={(_k, v) => setRatForm(f => ({ ...f, enfant_uo_id: v }))} options={[{ value: "", label: "— Sélectionner —" }, ...validEnfants.map(r => ({ value: r.id, label: `${r.code ? `[${r.code}] ` : ""}${r.libelle}${r.niveau ? ` (Niv. ${r.niveau})` : ""}` }))]} />
                        <FieldInput label="Date d'effet *" name="date_debut" value={ratForm.date_debut ?? ""} onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} type="date" />
                        <FieldInput label="Date fin" name="date_fin" value={ratForm.date_fin ?? ""} onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} type="date" />
                        <FieldInput label="Réf. décision" name="reference_decision" value={ratForm.reference_decision ?? ""} onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} />
                        <FieldInput label="Date décision" name="date_decision" value={ratForm.date_decision ?? ""} onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} type="date" />
                        <ToggleField label="Actif" value={ratForm.actif ?? true} onChange={v => setRatForm(f => ({ ...f, actif: v }))} />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveRattachement} disabled={savingRat} className="gap-1.5 h-7 text-xs"><Check size={12} /> {savingRat ? "…" : "Enregistrer"}</Button>
                        <Button size="sm" variant="outline" onClick={() => setShowRatForm(false)} className="h-7 text-xs"><X size={12} /></Button>
                      </div>
                    </div>
                  )}
                  {rattachementChildren.length > 0 && (
                    <div className="rounded-lg overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
                      <table className="w-full text-xs">
                        <thead><tr style={{ background: "hsl(var(--muted) / 0.3)" }}>{["UO enfant", "Du", "Au", "Réf. décision", "Statut", ""].map(h => <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>)}</tr></thead>
                        <tbody>
                          {rattachementChildren.map(rat => (
                            <tr key={rat.id} className="border-t hover:bg-muted/20" style={{ borderColor: "hsl(var(--border))" }}>
                              <td className="px-3 py-2 font-medium">{rat.uo ? `${rat.uo.code ? `[${rat.uo.code}] ` : ""}${rat.uo.libelle}` : "—"}</td>
                              <td className="px-3 py-2">{rat.date_debut}</td><td className="px-3 py-2">{rat.date_fin || "—"}</td><td className="px-3 py-2">{rat.reference_decision || "—"}</td>
                              <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-xs" style={rat.actif ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" } : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{rat.actif ? "Actif" : "Inactif"}</span></td>
                              <td className="px-3 py-2"><button onClick={() => deleteRattachement(rat.id)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 size={12} /></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {directChildren.length === 0 && rattachementChildren.length === 0 && !showRatForm && (
                    <div className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune UO rattachée — utilisez le champ UO parente ou ajoutez un rattachement ci-dessus.</div>
                  )}
                </div>
              );
            })()}

            {formTab === "interims" && editing && (
              <InterimSelector
                uoId={editing.id}
                uoLibelle={editing.libelle}
                hasTitulaire={!!editing.responsable_id}
              />
            )}

            {formTab === "organigramme" && editing && (() => {
              const socId = getSocieteIdForUo(editing);
              const sameSOcUOs = rows.filter(r => getSocieteIdForUo(r) === socId);
              const renderNode = (uo: UniteOrg, depth: number): React.ReactNode => {
                const children = sameSOcUOs.filter(r => r.parent_id === uo.id);
                const typeUo = typesUo.find(t => t.code === uo.type_uo);
                const typeColor = typeUo?.couleur || null;
                const isCurrent = uo.id === editing.id;
                const isParent = editing.parent_id === uo.id;
                return (
                  <div key={uo.id} style={{ marginLeft: depth * 24 }}>
                    <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg my-0.5 transition-colors" style={{ background: isCurrent ? "hsl(var(--primary) / 0.12)" : isParent ? "hsl(var(--accent) / 0.6)" : depth === 0 ? "hsl(var(--muted) / 0.5)" : "transparent", border: isCurrent ? "1.5px solid hsl(var(--primary) / 0.4)" : "1.5px solid transparent" }}>
                      {depth > 0 && <div className="flex items-center flex-shrink-0" style={{ marginLeft: -20 }}><div className="w-4 h-px" style={{ background: "hsl(var(--border))" }} /><div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "hsl(var(--border))" }} /></div>}
                      <Network size={12} style={{ color: typeColor || (isCurrent ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"), flexShrink: 0 }} />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate" style={{ color: typeColor || (isCurrent ? "hsl(var(--primary))" : "hsl(var(--foreground))") }}>{uo.libelle}</span>
                          {uo.code && <span className="text-[10px] font-mono px-1 rounded flex-shrink-0" style={{ background: typeColor ? `${typeColor}20` : "hsl(var(--muted))", color: typeColor || "hsl(var(--muted-foreground))" }}>{uo.code}</span>}
                          {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}>← En cours</span>}
                        </div>
                        {typeUo && <span className="text-[10px]" style={{ color: typeColor ? `${typeColor}cc` : "hsl(var(--muted-foreground))" }}>{typeUo.libelle}{uo.niveau ? ` · Niveau ${uo.niveau}` : ""}</span>}
                      </div>
                      <div className="ml-auto flex-shrink-0"><span className="text-[10px] px-1.5 rounded-full" style={uo.actif ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" } : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{uo.actif ? "Actif" : "Inactif"}</span></div>
                    </div>
                    {children.length > 0 && <div style={{ marginLeft: 20, borderLeft: `1px dashed ${typeColor || "hsl(var(--border))"}`, paddingLeft: 4 }}>{children.map(child => renderNode(child, depth + 1))}</div>}
                  </div>
                );
              };
              const orgRoots = sameSOcUOs.filter(r => !r.parent_id || !sameSOcUOs.find(p => p.id === r.parent_id));
              const soc = societes.find(s => s.id === socId);
              return (
                <div className="space-y-3">
                  <p className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Organigramme — {soc?.raison_sociale || "Société"} · {sameSOcUOs.length} UO{sameSOcUOs.length > 1 ? "s" : ""}</p>
                  <div className="rounded-lg border p-4 overflow-auto" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)", maxHeight: 420 }}>
                    {orgRoots.length === 0 ? <div className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}><Network size={28} className="mx-auto mb-2 opacity-30" />Aucune UO dans cette société</div> : orgRoots.map(r => renderNode(r, 0))}
                  </div>
                </div>
              );
            })()}

            {formTab !== "rattachements" && formTab !== "organigramme" && (
              <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                <Button size="sm" onClick={save} disabled={saving} className="gap-1.5"><Check size={14} /> {saving ? "Enregistrement…" : "Enregistrer"}</Button>
                <Button size="sm" variant="outline" onClick={cancel}><X size={14} /></Button>
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-center py-12" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Network size={32} className="mx-auto mb-2 opacity-30" />
          {search || filterSociete ? "Aucun résultat" : "Aucune unité organisationnelle"}
        </div>
      ) : viewMode === "liste" ? (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm">
            <thead><tr style={{ background: "hsl(var(--muted) / 0.5)" }}>{["Unité organisationnelle", "Société", "Type", "Niveau", "Responsable", "Statut", ""].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>)}</tr></thead>
            <tbody>{roots.map(uo => <UORow key={uo.id} uo={uo} />)}</tbody>
          </table>
        </div>
      ) : (
        <OrganigrammeGraphique
          uos={rows}
          etabs={etabs}
          typesUo={typesUo}
          societes={societes}
          collaborateursMap={collaborateursMap}
          filterSociete={filterSociete}
          rootUoId={rootUoId}
          onEdit={openEdit}
          onReload={loadAll}
          onSetRootUo={setRootUoId}
        />
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════
   PAGE PRINCIPALE
══════════════════════════════════════════════ */
const TABS = [
  { key: "societes", label: "Sociétés", icon: Building2 },
  { key: "uo", label: "Unités Organisationnelles", icon: Network },
] as const;

type TabKey = typeof TABS[number]["key"];

const OrganisationsPage: React.FC = () => {
  const [tab, setTab] = useState<TabKey>("societes");
  const [societes, setSocietes] = useState<Societe[]>([]);
  const [uoCount, setUoCount] = useState<number | null>(null);
  const [conventions, setConventions] = useState<RefItem[]>([]);
  const [secteurs, setSecteurs] = useState<RefItem[]>([]);
  const [regions, setRegions] = useState<RefRegion[]>([]);
  const [pays, setPays] = useState<RefItem[]>([]);
  const [villes, setVilles] = useState<RefVille[]>([]);
  const [typesUo, setTypesUo] = useState<RefTypeUo[]>([]);
  const [banques, setBanques] = useState<RefBanque[]>([]);
  const [devises, setDevises] = useState<RefDevise[]>([]);

  useEffect(() => {
    const loadRefs = async () => {
      const [convRes, secRes, regRes, paysRes, villesRes, typeUoRes, socRes, banqRes, devRes, uoRes] = await Promise.all([
        supabase.from("ref_convention_collective").select("code, libelle").eq("actif", true).order("libelle"),
        supabase.from("ref_secteur_activite").select("code, libelle").eq("actif", true).order("libelle"),
        supabase.from("ref_region").select("code, libelle, code_pays").eq("actif", true).order("libelle"),
        supabase.from("ref_pays").select("code, libelle").eq("actif", true).order("libelle"),
        supabase.from("ref_ville").select("code, libelle, code_region, code_postal").eq("actif", true).order("libelle"),
        supabase.from("ref_type_uo").select("code, libelle, niveau, ordre, couleur").eq("actif", true).order("ordre"),
        supabase.from("societes").select("*").order("raison_sociale"),
        supabase.from("ref_banque").select("code, libelle, swift").eq("actif", true).order("libelle"),
        supabase.from("ref_devise").select("code, libelle, symbole").eq("actif", true).order("code"),
        supabase.from("unites_organisationnelles").select("id", { count: "exact", head: true }).eq("actif", true),
      ]);
      if (convRes.data) setConventions(convRes.data);
      if (secRes.data) setSecteurs(secRes.data);
      if (regRes.data) setRegions(regRes.data as RefRegion[]);
      if (paysRes.data) setPays(paysRes.data);
      if (villesRes.data) setVilles(villesRes.data as RefVille[]);
      if (typeUoRes.data) setTypesUo(typeUoRes.data);
      if (socRes.data) setSocietes(socRes.data);
      if (banqRes.data) setBanques(banqRes.data as RefBanque[]);
      if (devRes.data) setDevises(devRes.data as RefDevise[]);
      if (uoRes.count != null) setUoCount(uoRes.count);
    };
    loadRefs();
  }, []);

  const refreshSocietes = useCallback(async () => {
    const { data } = await supabase.from("societes").select("*").order("raison_sociale");
    if (data) setSocietes(data);
  }, []);

  useEffect(() => { if (tab !== "societes") refreshSocietes(); }, [tab, refreshSocietes]);

  const isReadOnly = useContext(ManagerReadOnlyContext);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--primary) / 0.1)" }}>
            <Building2 size={20} style={{ color: "hsl(var(--primary))" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Organisations</h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Gestion des sociétés et unités organisationnelles</p>
          </div>
        </div>
        {isReadOnly && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }}>
            <Eye size={12} /> Lecture seule
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[{ label: "Sociétés", icon: Building2, color: "hsl(var(--primary))" }, { label: "Unités Org.", icon: Network, color: "hsl(38 92% 50%)" }].map(({ label, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-4 flex items-center gap-3" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}1a` }}><Icon size={18} style={{ color }} /></div>
            <div>
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
              <p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>{label === "Sociétés" ? societes.filter(s => s.actif).length : (uoCount ?? "—")}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="flex border-b" style={{ borderColor: "hsl(var(--border))" }}>
          {TABS.map(t => {
            const Icon = t.icon; const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors relative"
                style={{ color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", borderBottom: active ? "2px solid hsl(var(--primary))" : "2px solid transparent", background: active ? "hsl(var(--primary) / 0.04)" : "transparent" }}>
                <Icon size={15} />{t.label}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {tab === "societes" && <SocietesTab conventions={conventions} secteurs={secteurs} regions={regions} pays={pays} villes={villes} banques={banques} devises={devises} />}
          {tab === "uo" && <UOTab societes={societes} typesUo={typesUo} pays={pays} regions={regions} villes={villes} />}
        </div>
      </div>
    </div>
  );
};

export default OrganisationsPage;
