import React, { useEffect, useState, useCallback, useRef, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ManagerReadOnlyContext } from "@/contexts/ManagerContext";
import {
  Building2, Network, Plus, Pencil, Trash2, Search,
  ChevronRight, ChevronDown, Check, X, AlertTriangle,
  ArrowLeft, CreditCard, FileText, Landmark, Shield, Link2, ExternalLink,
  List, GitBranch, GripVertical, MoveRight, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

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
    const ext = file.name.split(".").pop();
    const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { data, error: uploadError } = await supabase.storage
      .from("logos_societes")
      .upload(path, file, { upsert: true });
    if (uploadError) { setError(uploadError.message); setUploadingLogo(false); return; }
    const { data: { publicUrl } } = supabase.storage.from("logos_societes").getPublicUrl(data.path);
    setField("logo_path", publicUrl);
    setUploadingLogo(false);
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
                                      <button onClick={() => setDeleteCompteId(c.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400">
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
   Utilitaire : Obtenir ou créer un établissement
   par défaut pour une société (transparent pour l'UO)
══════════════════════════════════════════════ */
async function getOrCreateDefaultEtab(societeId: string, societeNom: string): Promise<{ id: string | null; error: string | null }> {
  // Appel RPC SECURITY DEFINER pour bypass le RLS
  const { data, error } = await supabase.rpc("get_or_create_default_etablissement", {
    p_societe_id: societeId,
    p_libelle: societeNom,
  });
  if (error) return { id: null, error: error.message };
  return { id: data as string, error: null };
}

/* ══════════════════════════════════════════════
   TAB 2 - UNITÉS ORGANISATIONNELLES (liées aux sociétés)
══════════════════════════════════════════════ */
type UOFormTab = "identification" | "localisation" | "rattachements" | "organigramme";

const UOTab: React.FC<{
  societes: Societe[];
  typesUo: RefTypeUo[];
  pays: RefItem[];
  regions: RefRegion[];
  villes: RefVille[];
}> = ({ societes, typesUo, pays, regions, villes }) => {
  const [rows, setRows] = useState<UniteOrg[]>([]);
  const [etabs, setEtabs] = useState<EtabMinimal[]>([]);
  // RG-UO-RESP-01 (Adil DAIA) : Données collaborateurs pour afficher le nom du responsable
  const [collaborateursMap, setCollaborateursMap] = useState<Map<string, { matricule: string; nom: string; prenom: string }>>(new Map());
  const [search, setSearch] = useState("");
  const [filterSociete, setFilterSociete] = useState<string>("");
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
  // Organigramme vue principale
  const [viewMode, setViewMode] = useState<"liste" | "organigramme">("liste");
  const [draggedUo, setDraggedUo] = useState<UniteOrg | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showDropDialog, setShowDropDialog] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ child: UniteOrg; parent: UniteOrg } | null>(null);
  const [dropRatForm, setDropRatForm] = useState({ date_debut: new Date().toISOString().split("T")[0], reference_decision: "", date_decision: "" });
  const [savingDrop, setSavingDrop] = useState(false);
  // Refs pour éviter les stale closures dans les handlers drag
  const draggedUoRef = useRef<UniteOrg | null>(null);
  const dragOverIdRef = useRef<string | null>(null);

  // RG-UO-RESP-02 (Adil DAIA) : État du poste responsable et du collaborateur titulaire
  // postes disponibles dans le référentiel
  const [postesRef, setPostesRef] = useState<{ code: string; libelle: string; code_etat_poste?: string }[]>([]);
  // collaborateur résolu depuis le poste sélectionné (affectation active)
  const [posteResponsableTitulaire, setPosteResponsableTitulaire] = useState<{
    id: string; matricule: string; nom: string; prenom: string
  } | null>(null);
  // true si le poste est sélectionné mais aucun collaborateur n'y est affecté
  const [posteVacantAlert, setPosteVacantAlert] = useState(false);
  const [resolvingPoste, setResolvingPoste] = useState(false);
  // RG-UO-RESP-02c (Adil DAIA) : En cas de vacance, l'utilisateur peut désigner manuellement un responsable temporaire.
  // Dès que le poste est attribué à un collaborateur, le titulaire du poste remplace automatiquement ce responsable manuel.
  const [vacanceSearch, setVacanceSearch] = useState("");
  const [vacanceSuggestions, setVacanceSuggestions] = useState<{ id: string; matricule: string; nom: string; prenom: string }[]>([]);
  const [manualResponsable, setManualResponsable] = useState<{ id: string; matricule: string; nom: string; prenom: string } | null>(null);

  // ─── RG-UO-RESP-03 (Adil DAIA) : Calcul de la chaîne ascendante d'une UO ───
  // Retourne l'UO elle-même + toutes ses UOs parentes jusqu'à la racine.
  // Utilisé pour filtrer les postes éligibles comme poste responsable de l'UO.
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

  // ─── RG-UO-RESP-03 (Adil DAIA) : Chargement des postes éligibles comme responsable de l'UO ───
  // Règle 1 : Le poste doit être lié à un "Emploi de responsabilité" (est_emploi_responsabilite = true).
  // Règle 2 : Le poste doit être rattaché à l'UO elle-même OU à l'une de ses UOs ascendantes.
  // En mode création (uoId = undefined) : on se base sur le parent sélectionné s'il existe.
  const loadPostesEligibles = useCallback(async (uoId: string | undefined) => {
    // Étape 1 : Récupérer les codes des emplois de responsabilité
    const { data: emploisResp } = await supabase
      .from("ref_emploi")
      .select("code")
      .eq("est_emploi_responsabilite", true)
      .eq("actif", true);

    if (!emploisResp?.length) {
      // Aucun emploi de responsabilité défini → aucun poste éligible
      setPostesRef([]);
      return;
    }
    const codesEmploisResp = emploisResp.map(e => e.code);

    // Étape 2 : Construire la chaîne ascendante (UO courante + parents)
    const ancestorIds = getAncestorChain(uoId, rows);

    // Étape 3 : Requête des postes filtrés
    let query = supabase
      .from("ref_poste")
      .select("code, libelle, code_etat_poste, unite_id")
      .eq("actif", true)
      .in("code_emploi", codesEmploisResp);

    if (ancestorIds.length > 0) {
      // Filtrer sur l'UO courante et ses ascendants
      query = query.in("unite_id", ancestorIds);
    }
    // Si aucune UO connue (création sans parent) : montrer tous les postes de responsabilité sans filtre UO

    const { data } = await query.order("libelle");
    setPostesRef(data || []);
  }, [rows, getAncestorChain]);

  // RG-UO-RESP-02 (Adil DAIA) : Résoudre le collaborateur affecté au poste responsable sélectionné
  // Les affectations se font sur les instances (ex: DG-001), pas directement sur le code poste (ex: DG).
  // On doit donc d'abord récupérer toutes les instances du poste, puis chercher une affectation active.
  // Si le poste a un titulaire (affectation active sans date_fin_poste) → on l'affiche comme responsable
  // Si le poste est vacant → on affiche une alerte et on invite à affecter un collaborateur
  const resolvePosteResponsable = useCallback(async (codePoste: string | undefined) => {
    if (!codePoste) {
      setPosteResponsableTitulaire(null);
      setPosteVacantAlert(false);
      return;
    }
    setResolvingPoste(true);

    // RG-UO-RESP-02 étape 1 : Récupérer les codes d'instances du poste (ex: DG → [DG-001])
    const { data: instances } = await supabase
      .from("ref_poste_instances")
      .select("code_instance")
      .eq("code_poste", codePoste)
      .eq("archive", false);

    const instanceCodes = (instances || []).map(i => i.code_instance);

    let collaborateurId: string | null = null;

    if (instanceCodes.length > 0) {
      // RG-UO-RESP-02 étape 2 : Chercher une affectation active sur l'une des instances du poste
      const { data: aff } = await supabase
        .from("collaborateur_affectations")
        .select("collaborateur_id")
        .in("code_poste", instanceCodes)
        .is("date_fin_poste", null)
        .eq("archive", false)
        .maybeSingle();
      collaborateurId = aff?.collaborateur_id ?? null;
    }

    if (collaborateurId) {
      // RG-UO-RESP-02a : Un collaborateur est affecté → le désigner automatiquement comme responsable
      const { data: collab } = await supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom")
        .eq("id", collaborateurId)
        .single();
      setPosteResponsableTitulaire(collab || null);
      setPosteVacantAlert(false);
    } else {
      // RG-UO-RESP-02b : Poste vacant → aucun responsable, alerte affichée
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
      // RG-UO-RESP-01 (Adil DAIA) : Chargement des collaborateurs pour l'affichage du responsable
      supabase.from("collaborateurs").select("id, matricule, nom, prenom").eq("archive", false),
    ]);
    if (etabRes.error) setError(etabRes.error.message);
    else setEtabs(etabRes.data || []);
    if (uoRes.error) setError(uoRes.error.message);
    else setRows(uoRes.data || []);
    if (collabRes.data) {
      const map = new Map<string, { matricule: string; nom: string; prenom: string }>();
      collabRes.data.forEach(c => map.set(c.id, { matricule: c.matricule, nom: c.nom, prenom: c.prenom }));
      setCollaborateursMap(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadRattachements = useCallback(async (uoId: string) => {
    const { data } = await supabase.from("uo_rattachement").select("*")
      .or(`parent_uo_id.eq.${uoId},enfant_uo_id.eq.${uoId}`)
      .order("date_debut", { ascending: false });
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
    setEditing(null);
    setForm({ ...EMPTY_UO });
    setFormSocieteId(filterSociete || "");
    setFormTab("identification");
    setRattachements([]);
    setShowRatForm(false);
    // RG-UO-RESP-02 (Adil DAIA) : Réinitialiser le poste responsable lors de la création
    setPosteResponsableTitulaire(null);
    setPosteVacantAlert(false);
    setManualResponsable(null);
    setVacanceSearch("");
    setVacanceSuggestions([]);
    // RG-UO-RESP-03 (Adil DAIA) : En création, aucun parent défini → charger tous les postes de responsabilité
    loadPostesEligibles(undefined);
    setShowForm(true);
  };
  const openEdit = (r: UniteOrg) => {
    setEditing(r);
    setForm({ ...r });
    const socId = getSocieteIdForUo(r);
    setFormSocieteId(socId || "");
    setFormTab("identification");
    setShowRatForm(false);
    setVacanceSearch("");
    setVacanceSuggestions([]);
    // RG-UO-RESP-05 (Adil DAIA) : En édition, si le responsable est temporaire (responsable_temporaire = true),
    // on pré-charge le collaborateur dans manualResponsable pour qu'il soit affiché dans le formulaire.
    // Si c'est un Manager UO officiel, on laisse resolvePosteResponsable le résoudre depuis le poste.
    if (r.responsable_temporaire === true && r.responsable_id) {
      const collab = collaborateursMap.get(r.responsable_id);
      if (collab) {
        setManualResponsable({ id: r.responsable_id, ...collab });
        setPosteVacantAlert(true);
        setPosteResponsableTitulaire(null);
      } else {
        // Fallback : charger depuis la base si absent de la map
        supabase.from("collaborateurs")
          .select("id, matricule, nom, prenom")
          .eq("id", r.responsable_id)
          .single()
          .then(({ data }) => {
            if (data) {
              setManualResponsable(data);
              setPosteVacantAlert(true);
              setPosteResponsableTitulaire(null);
            }
          });
        setManualResponsable(null);
      }
    } else {
      setManualResponsable(null);
      // RG-UO-RESP-02 (Adil DAIA) : Résoudre le collaborateur du poste responsable lors de l'édition
      resolvePosteResponsable(r.poste_responsable_code);
    }
    // RG-UO-RESP-03 (Adil DAIA) : Charger les postes éligibles en filtrant par l'UO et ses ascendants
    loadRattachements(r.id);
    loadPostesEligibles(r.id);
    setShowForm(true);
  };
  const cancel = () => {
    setShowForm(false);
    setEditing(null);
    setRattachements([]);
    // RG-UO-RESP-02 (Adil DAIA) : Réinitialiser le poste responsable à la fermeture
    setPosteResponsableTitulaire(null);
    setPosteVacantAlert(false);
    setManualResponsable(null);
    setVacanceSearch("");
    setVacanceSuggestions([]);
  };

  const setField = (k: string, v: string | number | boolean) => {
    if (k === "type_uo") {
      const typeRef = typesUo.find(t => t.code === v);
      setForm(f => ({ ...f, type_uo: v as string, niveau: typeRef?.niveau ?? f.niveau }));
    } else {
      setForm(f => ({ ...f, [k]: v }));
    }
  };

  const save = async () => {
    if (!form.libelle?.trim() || !formSocieteId) return;
    setSaving(true);
    setError(null);
    const soc = societes.find(s => s.id === formSocieteId);
    const { id: etabId, error: etabError } = await getOrCreateDefaultEtab(formSocieteId, soc?.raison_sociale || "Établissement");
    if (!etabId) {
      setError(etabError || "Impossible de créer l'établissement par défaut");
      setSaving(false);
      return;
    }
    const newParentId = form.parent_id || null;
    const payload = {
      ...form,
      etablissement_id: etabId,
      parent_id: newParentId,
      code_pays: form.adresse_societe ? null : (form.code_pays || null),
      code_region: form.adresse_societe ? null : (form.code_region || null),
      code_ville: form.adresse_societe ? null : (form.code_ville || null),
      code_postal: form.adresse_societe ? null : (form.code_postal || null),
      // RG-UO-RESP-02 (Adil DAIA) : Persistance du poste responsable et du responsable résolu
      // Priorité : 1) titulaire actif du poste → responsable_temporaire = false
      //            2) responsable manuel saisi en cas de vacance → responsable_temporaire = true
      poste_responsable_code: form.poste_responsable_code || null,
      responsable_id: posteResponsableTitulaire?.id || manualResponsable?.id || null,
      // RG-UO-RESP-05 (Adil DAIA) : Enregistrement du type de responsable
      responsable_temporaire: posteResponsableTitulaire ? false : manualResponsable ? true : null,
    } as UniteOrg;
    let saveError: string | null = null;
    let savedUoId: string | null = null;

    if (editing) {
      const { error } = await supabase.from("unites_organisationnelles").update(payload).eq("id", editing.id);
      if (error) { saveError = error.message; }
      else { savedUoId = editing.id; }
    } else {
      const { data, error } = await supabase.from("unites_organisationnelles").insert([payload]).select("id").single();
      if (error) { saveError = error.message; }
      else { savedUoId = data?.id ?? null; }
    }

    // Synchronisation dans uo_rattachement si un parent est défini ou a changé
    if (!saveError && savedUoId && newParentId) {
      const oldParentId = editing?.parent_id || null;
      const parentChanged = oldParentId !== newParentId;

      if (parentChanged) {
        // Clôturer l'ancien rattachement structurel si existant
        if (oldParentId) {
          await supabase.from("uo_rattachement")
            .update({ actif: false, date_fin: new Date().toISOString().split("T")[0] })
            .eq("parent_uo_id", oldParentId)
            .eq("enfant_uo_id", savedUoId)
            .is("date_fin", null);
        }
        // Vérifier si un rattachement actif existe déjà pour ce couple parent/enfant
        const { data: existing } = await supabase.from("uo_rattachement")
          .select("id")
          .eq("parent_uo_id", newParentId)
          .eq("enfant_uo_id", savedUoId)
          .eq("actif", true)
          .maybeSingle();

        if (!existing) {
          await supabase.from("uo_rattachement").insert([{
            parent_uo_id: newParentId,
            enfant_uo_id: savedUoId,
            date_debut: new Date().toISOString().split("T")[0],
            actif: true,
          }]);
        }
      }
    }

    // Si le parent est retiré (était défini, maintenant null), clôturer le rattachement
    if (!saveError && savedUoId && !newParentId && editing?.parent_id) {
      await supabase.from("uo_rattachement")
        .update({ actif: false, date_fin: new Date().toISOString().split("T")[0] })
        .eq("parent_uo_id", editing.parent_id)
        .eq("enfant_uo_id", savedUoId)
        .is("date_fin", null);
    }

    setSaving(false);
    if (saveError) { setError(saveError); } else { await loadAll(); cancel(); }
  };

  const doDelete = async (id: string) => {
    // Point 5 : Archiver au lieu de supprimer physiquement
    const { error } = await supabase.from("unites_organisationnelles").update({ actif: false } as any).eq("id", id);
    if (error) setError(error.message);
    else { setDeleteId(null); await loadAll(); }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveRattachement = async () => {
    if (!editing || !ratForm.enfant_uo_id || !ratForm.date_debut) return;
    setSavingRat(true);

    // 1. Clore l'éventuel rattachement actif existant de l'UO enfant vers un autre parent
    const { data: existingRat } = await supabase
      .from("uo_rattachement")
      .select("id, parent_uo_id")
      .eq("enfant_uo_id", ratForm.enfant_uo_id)
      .is("date_fin", null)
      .eq("actif", true)
      .maybeSingle();

    if (existingRat && existingRat.parent_uo_id !== editing.id) {
      // date_fin = date d'effet - 1 jour
      const dateEffet = new Date(ratForm.date_debut!);
      dateEffet.setDate(dateEffet.getDate() - 1);
      const dateFinAncien = dateEffet.toISOString().split("T")[0];
      await supabase.from("uo_rattachement")
        .update({ actif: false, date_fin: dateFinAncien })
        .eq("id", existingRat.id);
    }

    // 2. Insérer le nouveau rattachement
    const payload = {
      parent_uo_id: editing.id,
      enfant_uo_id: ratForm.enfant_uo_id,
      date_debut: ratForm.date_debut,
      date_fin: ratForm.date_fin || null,
      actif: ratForm.actif ?? true,
      reference_decision: ratForm.reference_decision || null,
      date_decision: ratForm.date_decision || null,
    };
    const { error } = await supabase.from("uo_rattachement").insert([payload]);

    if (!error) {
      // 3. Mettre à jour le parent_id de l'UO enfant pour refléter la structure
      await supabase
        .from("unites_organisationnelles")
        .update({ parent_id: editing.id })
        .eq("id", ratForm.enfant_uo_id);

      // Rafraîchir la liste locale des UOs
      setRows(prev => prev.map(r =>
        r.id === ratForm.enfant_uo_id ? { ...r, parent_id: editing.id } : r
      ));

      await loadRattachements(editing.id);
      setRatForm({ actif: true });
      setShowRatForm(false);
    } else {
      setError(error.message);
    }
    setSavingRat(false);
  };

  const deleteRattachement = async (id: string) => {
    await supabase.from("uo_rattachement").delete().eq("id", id);
    if (editing) loadRattachements(editing.id);
  };

  /* ─── Drag & Drop organigramme ─── */
  const isDescendant = useCallback((childId: string, ancestorId: string, visited = new Set<string>()): boolean => {
    if (visited.has(childId)) return false;
    visited.add(childId);
    const uo = rows.find(r => r.id === childId);
    if (!uo || !uo.parent_id) return false;
    if (uo.parent_id === ancestorId) return true;
    return isDescendant(uo.parent_id, ancestorId, visited);
  }, [rows]);

  const isValidDrop = useCallback((child: UniteOrg, parent: UniteOrg): boolean => {
    if (child.id === parent.id) return false;
    if (isDescendant(parent.id, child.id)) return false;
    const parentType = typesUo.find(t => t.code === parent.type_uo);
    const childType = typesUo.find(t => t.code === child.type_uo);
    // Si les deux types ont des niveaux définis, la parente doit avoir un niveau STRICTEMENT inférieur
    if (parentType?.niveau != null && childType?.niveau != null) {
      if (parentType.niveau >= childType.niveau) return false;
    }
    // Si pas de types ou niveaux non définis, on autorise quand même (pas de contrainte)
    return true;
  }, [typesUo, isDescendant]);


  const applyDrop = async () => {
    if (!pendingDrop) return;
    const { child, parent } = pendingDrop;
    setSavingDrop(true);

    // Clore l'ancien rattachement actif de l'enfant (J-1)
    const { data: existingRat } = await supabase
      .from("uo_rattachement").select("id, parent_uo_id")
      .eq("enfant_uo_id", child.id).is("date_fin", null).eq("actif", true).maybeSingle();

    if (existingRat && existingRat.parent_uo_id !== parent.id) {
      const d = new Date(dropRatForm.date_debut);
      d.setDate(d.getDate() - 1);
      await supabase.from("uo_rattachement")
        .update({ actif: false, date_fin: d.toISOString().split("T")[0] })
        .eq("id", existingRat.id);
    }

    // Insérer le nouveau rattachement
    const { error: ratErr } = await supabase.from("uo_rattachement").insert([{
      parent_uo_id: parent.id,
      enfant_uo_id: child.id,
      date_debut: dropRatForm.date_debut,
      date_fin: null,
      actif: true,
      reference_decision: dropRatForm.reference_decision || null,
      date_decision: dropRatForm.date_decision || null,
    }]);

    if (!ratErr) {
      // Mettre à jour parent_id
      await supabase.from("unites_organisationnelles")
        .update({ parent_id: parent.id }).eq("id", child.id);
      await loadAll();
    } else {
      setError(ratErr.message);
    }
    setSavingDrop(false);
    setShowDropDialog(false);
    setPendingDrop(null);
    setDropRatForm({ date_debut: new Date().toISOString().split("T")[0], reference_decision: "", date_decision: "" });
  };

  const filteredRegions = form.code_pays ? regions.filter(r => r.code_pays === form.code_pays) : regions;
  const filteredVilles = form.code_region ? villes.filter(v => v.code_region === form.code_region) : villes;

  const UORow = ({ uo, depth = 0 }: { uo: UniteOrg; depth?: number }) => {
    const children = getChildren(uo.id);
    const isExpanded = expanded.has(uo.id);
    const socId = getSocieteIdForUo(uo);
    const soc = societes.find(s => s.id === socId);
    const typeUo = typesUo.find(t => t.code === uo.type_uo);
    // RG-UO-RESP-01 (Adil DAIA) : Résolution du responsable depuis la map collaborateurs
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
          {/* RG-UO-RESP-01 (Adil DAIA) : Affichage du responsable dans la liste
              RG-UO-RESP-05 (Adil DAIA) : Distinguer le type de responsable via le champ responsable_temporaire :
              - false = Manager UO officiel (titulaire du poste de responsabilité)
              - true  = Responsable temporaire (désigné manuellement, poste vacant) */}
          <td className="px-3 py-2.5 text-xs">
            {responsable ? (
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{responsable.matricule}</span>
                  <span style={{ color: "hsl(var(--foreground))" }}>{responsable.nom} {responsable.prenom}</span>
                </span>
                {uo.responsable_temporaire === true ? (
                  // Responsable désigné manuellement en cas de vacance du poste
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium w-fit"
                    style={{ background: "hsl(38 92% 50% / 0.1)", color: "hsl(38 60% 40%)", border: "1px solid hsl(38 92% 50% / 0.25)" }}>
                    <AlertTriangle size={9} />
                    Temporaire
                  </span>
                ) : (
                  // Titulaire du poste de responsabilité → Manager officiel de l'UO
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium w-fit"
                    style={{ background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))" }}>
                    <Check size={9} />
                    Manager UO
                  </span>
                )}
              </span>
            ) : <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
          </td>
          <td className="px-3 py-2.5">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={uo.actif
                ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" }
                : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              {uo.actif ? "Active" : "Inactive"}
            </span>
          </td>
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => openEdit(uo)} className="p-1.5 rounded hover:bg-muted/60 transition-colors" style={{ color: "hsl(var(--muted-foreground))" }}>
                <Pencil size={13} />
              </button>
              {deleteId === uo.id ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => doDelete(uo.id)} className="p-1.5 rounded text-red-500 hover:bg-red-50"><Check size={13} /></button>
                  <button onClick={() => setDeleteId(null)} className="p-1.5 rounded hover:bg-muted/60"><X size={13} /></button>
                </div>
              ) : (
                <button onClick={() => setDeleteId(uo.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors text-red-400">
                  <Trash2 size={13} />
                </button>
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
  ];

  return (
    <div className="space-y-4">
      {/* Barre de recherche + filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
          <Input className="pl-8 h-8 text-sm" placeholder="Rechercher une UO…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterSociete || NONE_VALUE} onValueChange={v => setFilterSociete(v === NONE_VALUE ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-52">
            <SelectValue placeholder="Toutes les sociétés" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Toutes les sociétés</SelectItem>
            {societes.map(s => <SelectItem key={s.id} value={s.id}>{s.raison_sociale}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Basculer vue */}
        <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <button
            onClick={() => setViewMode("liste")}
            className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium transition-colors"
            style={{
              background: viewMode === "liste" ? "hsl(var(--primary))" : "transparent",
              color: viewMode === "liste" ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
            }}
          >
            <List size={13} /> Liste
          </button>
          <button
            onClick={() => setViewMode("organigramme")}
            className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium transition-colors"
            style={{
              background: viewMode === "organigramme" ? "hsl(var(--primary))" : "transparent",
              color: viewMode === "organigramme" ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
            }}
          >
            <GitBranch size={13} /> Organigramme
          </button>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5 ml-auto">
          <Plus size={14} /> Nouvelle UO
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm p-3 rounded-lg border"
          style={{ background: "hsl(var(--destructive) / 0.08)", borderColor: "hsl(var(--destructive) / 0.3)", color: "hsl(var(--destructive))" }}>
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto p-0.5"><X size={13} /></button>
        </div>
      )}

      {/* ── Formulaire à onglets ── */}
      {showForm && (
        <div className="border rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
            <h3 className="font-semibold text-sm">
              {editing ? `Modifier : ${editing.libelle}` : "Nouvelle unité organisationnelle"}
            </h3>
            <button onClick={cancel} className="p-1 rounded hover:bg-muted/60" style={{ color: "hsl(var(--muted-foreground))" }}><X size={15} /></button>
          </div>

          {/* Onglets */}
          <div className="flex border-b" style={{ borderColor: "hsl(var(--border))" }}>
            {UO_FORM_TABS.map(t => (
              <button key={t.key} onClick={() => setFormTab(t.key)}
                className="px-4 py-2.5 text-xs font-medium transition-colors"
                style={{
                  color: formTab === t.key ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  borderBottom: formTab === t.key ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  background: formTab === t.key ? "hsl(var(--primary) / 0.04)" : "transparent",
                }}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {/* ─── Onglet Identification ─── */}
            {formTab === "identification" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <FieldSelect label="Société *" name="formSocieteId" value={formSocieteId}
                  onChange={(_k, v) => setFormSocieteId(v)} required
                  options={societes.map(s => ({ value: s.id, label: s.raison_sociale }))} />
                <FieldInput label="Code" name="code" value={form.code} onChange={setField} placeholder="Ex: DIR-GEN" />
                <FieldInput label="Libellé *" name="libelle" value={form.libelle} onChange={setField} required />
                <FieldSelectCreatable label="Type d'UO *" name="type_uo" value={form.type_uo ?? ""}
                  onChange={setField}
                  options={typesUo.map(t => ({ value: t.code, label: t.libelle }))}
                  refTable="ref_type_uo" />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Niveau hiérarchique</label>
                  <div className="h-8 px-3 flex items-center rounded-md border text-sm"
                    style={{ background: "hsl(var(--muted) / 0.4)", borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                    {form.niveau != null ? `Niveau ${form.niveau}` : <span className="opacity-50 text-xs">— sélectionner un type —</span>}
                  </div>
                </div>
                {/* UO parente : seulement celles dont le niveau type < niveau type de l'UO courante */}
                <FieldSelect label="UO parente" name="parent_id" value={form.parent_id ?? ""}
                  onChange={(_k, v) => {
                    const newParentId = v || undefined;
                    setForm(f => ({ ...f, parent_id: newParentId }));
                    // RG-UO-RESP-03 (Adil DAIA) : Quand le parent change en mode création,
                    // recharger les postes éligibles en se basant sur la nouvelle chaîne ascendante.
                    // En mode édition, la chaîne est basée sur l'UO existante (déjà chargée à l'ouverture).
                    if (!editing) {
                      loadPostesEligibles(newParentId);
                    }
                  }}
                  options={[
                    { value: "", label: "— Racine (aucune) —" },
                    ...rows
                      .filter(r => {
                        if (r.id === editing?.id) return false;
                        // Si le type de l'UO courante est connu, n'afficher que les UOs
                        // dont le niveau de type est strictement inférieur (niveau hiérarchique plus haut)
                        if (form.niveau != null) {
                          const parentType = typesUo.find(t => t.code === r.type_uo);
                          if (parentType?.niveau != null && parentType.niveau >= form.niveau) return false;
                        }
                        return true;
                      })
                      .map(r => ({
                        value: r.id,
                        label: `${r.code ? `[${r.code}] ` : ""}${r.libelle}${r.niveau ? ` (Niv. ${r.niveau})` : ""}`,
                      }))
                  ]} />
                <ToggleField label="Active" value={form.actif ?? true} onChange={v => setField("actif", v)} />

                {/* ─── RG-UO-RESP-02 (Adil DAIA) : Poste Responsable de l'UO ───
                    L'utilisateur sélectionne un poste dans le référentiel.
                    Le système résout automatiquement le collaborateur titulaire du poste.
                    Si le poste est vacant, une alerte invite à affecter un collaborateur à ce poste. */}
                <div className="col-span-2 md:col-span-3 border-t pt-3" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Poste Responsable de l'UO
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Sélecteur de poste */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium block" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Poste désigné comme responsable
                      </label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={form.poste_responsable_code || "__none__"}
                          onValueChange={v => {
                            const code = v === "__none__" ? undefined : v;
                            setForm(f => ({ ...f, poste_responsable_code: code }));
                            // RG-UO-RESP-02 (Adil DAIA) : Résoudre automatiquement le titulaire du poste sélectionné
                            resolvePosteResponsable(code);
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Sélectionner un poste…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Aucun —</SelectItem>
                            {postesRef.map(p => (
                              <SelectItem key={p.code} value={p.code}>
                                {p.libelle} <span className="opacity-50 text-xs ml-1">({p.code})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {form.poste_responsable_code && (
                          <button
                            type="button"
                            onClick={() => {
                              setForm(f => ({ ...f, poste_responsable_code: undefined }));
                              setPosteResponsableTitulaire(null);
                              setPosteVacantAlert(false);
                            }}
                            className="p-1.5 rounded hover:bg-muted/60 flex-shrink-0"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                            title="Retirer le poste responsable"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Résultat : titulaire, saisie manuelle si vacant, ou placeholder */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium block" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Collaborateur responsable
                      </label>
                      {resolvingPoste ? (
                        <div className="h-8 flex items-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Résolution en cours…
                        </div>
                      ) : posteResponsableTitulaire ? (
                        // RG-UO-RESP-02a (Adil DAIA) : Titulaire trouvé — affichage automatique du collaborateur affecté au poste
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium h-8"
                          style={{ background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.2)" }}>
                          <Check size={12} className="flex-shrink-0" />
                          <span className="font-mono font-bold">{posteResponsableTitulaire.matricule}</span>
                          <span>—</span>
                          <span>{posteResponsableTitulaire.nom} {posteResponsableTitulaire.prenom}</span>
                        </div>
                      ) : posteVacantAlert ? (
                        // RG-UO-RESP-02b (Adil DAIA) : Poste vacant — permettre la saisie manuelle d'un responsable temporaire.
                        // Dès qu'un collaborateur sera affecté au poste, il deviendra automatiquement le responsable de l'UO.
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs"
                            style={{ background: "hsl(38 92% 50% / 0.08)", color: "hsl(38 60% 40%)", border: "1px solid hsl(38 92% 50% / 0.25)" }}>
                            <AlertTriangle size={11} className="flex-shrink-0" />
                            <span>Poste vacant — désignez un responsable temporaire ci-dessous</span>
                          </div>
                          {manualResponsable ? (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium flex-1"
                                style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))" }}>
                                <span className="font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{manualResponsable.matricule}</span>
                                <span>—</span>
                                <span>{manualResponsable.nom} {manualResponsable.prenom}</span>
                                <span className="ml-1 italic text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>(temporaire)</span>
                              </div>
                              <button type="button" onClick={() => setManualResponsable(null)}
                                className="p-1.5 rounded hover:bg-muted/60 flex-shrink-0"
                                style={{ color: "hsl(var(--muted-foreground))" }} title="Retirer le responsable temporaire">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <div className="relative">
                              <Input
                                className="h-8 text-xs pr-8"
                                placeholder="Rechercher par matricule ou nom…"
                                value={vacanceSearch}
                                onChange={async e => {
                                  const q = e.target.value;
                                  setVacanceSearch(q);
                                  if (q.length < 2) { setVacanceSuggestions([]); return; }
                                  // RG-UO-RESP-02c (Adil DAIA) : Recherche de collaborateur pour responsable temporaire en cas de vacance
                                  const { data } = await supabase
                                    .from("collaborateurs")
                                    .select("id, matricule, nom, prenom")
                                    .eq("archive", false)
                                    .or(`matricule.ilike.%${q}%,nom.ilike.%${q}%,prenom.ilike.%${q}%`)
                                    .limit(6);
                                  setVacanceSuggestions(data || []);
                                }}
                              />
                              {vacanceSuggestions.length > 0 && (
                                <div className="absolute top-full left-0 right-0 z-50 rounded-md shadow-lg border mt-1 overflow-hidden"
                                  style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))" }}>
                                  {vacanceSuggestions.map(c => (
                                    <button key={c.id} type="button"
                                      className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                                      onClick={() => {
                                        setManualResponsable(c);
                                        setVacanceSearch("");
                                        setVacanceSuggestions([]);
                                      }}>
                                      <span className="font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{c.matricule}</span>
                                      <span>{c.nom} {c.prenom}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-8 flex items-center text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {form.poste_responsable_code ? "—" : "Sélectionner un poste ci-contre"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Onglet Localisation ─── */}
            {formTab === "localisation" && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Position physique</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <FieldInput label="Lieu" name="lieu" value={form.lieu} onChange={setField} />
                    <FieldInput label="Bâtiment" name="batiment" value={form.batiment} onChange={setField} />
                    <FieldInput label="Étage" name="etage" value={form.etage} onChange={setField} />
                    <FieldInput label="Bureau" name="bureau" value={form.bureau} onChange={setField} />
                  </div>
                </div>
                <div className="border rounded-lg p-3" style={{ borderColor: "hsl(var(--border))" }}>
                  <ToggleField
                    label="Utiliser l'adresse de la société"
                    value={form.adresse_societe ?? false}
                    onChange={v => setField("adresse_societe", v)}
                  />
                  {form.adresse_societe && (
                    <p className="mt-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                      L'adresse de la société rattachée sera utilisée pour cette unité.
                    </p>
                  )}
                </div>
                {!form.adresse_societe && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Adresse spécifique</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <FieldSelectCreatable label="Pays" name="code_pays" value={form.code_pays ?? ""}
                        onChange={(_k, v) => setForm(f => ({ ...f, code_pays: v, code_region: "", code_ville: "" }))}
                        options={pays.map(p => ({ value: p.code, label: p.libelle }))}
                        refTable="ref_pays" />
                      <FieldSelectCreatable label="Région" name="code_region" value={form.code_region ?? ""}
                        onChange={(_k, v) => setForm(f => ({ ...f, code_region: v, code_ville: "" }))}
                        options={filteredRegions.map(r => ({ value: r.code, label: r.libelle }))}
                        refTable="ref_region" />
                      <FieldSelectCreatable label="Ville" name="code_ville" value={form.code_ville ?? ""}
                        onChange={setField}
                        options={filteredVilles.map(v => ({ value: v.code, label: v.libelle }))}
                        refTable="ref_ville" />
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

            {/* ─── Onglet Rattachements ─── */}
            {formTab === "rattachements" && editing && (() => {
              // UOs enfants valides : niveau type strictement supérieur à celui de l'UO courante
              const editingNiveau = form.niveau ?? editing.niveau;
              const validEnfants = rows.filter(r => {
                if (r.id === editing.id) return false;
                // Exclure les UOs déjà directement rattachées via parent_id
                if (r.parent_id === editing.id) return false;
                // Exclure si déjà un rattachement actif dans uo_rattachement
                if (rattachements.some(rat => rat.enfant_uo_id === r.id && rat.actif)) return false;
                if (editingNiveau != null) {
                  const childType = typesUo.find(t => t.code === r.type_uo);
                  // L'enfant doit avoir un niveau strictement supérieur (plus bas dans la hiérarchie)
                  if (childType?.niveau != null && childType.niveau <= editingNiveau) return false;
                }
                return true;
              });

              // Toutes les UOs enfants visibles : via parent_id OU via uo_rattachement
              const directChildren = rows.filter(r => r.parent_id === editing.id);
              const rattachementChildren = rattachements
                .filter(rat => rat.parent_uo_id === editing.id)
                .map(rat => ({ ...rat, uo: rows.find(r => r.id === rat.enfant_uo_id) }))
                .filter(rat => rat.uo);

              return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                      UOs rattachées à « {editing.libelle} »
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>
                      Inclut les rattachements directs (onglet Identification) et les rattachements historiques ci-dessous
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowRatForm(v => !v)} className="gap-1.5 h-7 text-xs">
                    <Plus size={12} /> Ajouter un rattachement
                  </Button>
                </div>

                {showRatForm && (
                  <div className="border rounded-lg p-3 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.2)" }}>
                    <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>
                      Nouveau rattachement
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <FieldSelect label="UO enfant *" name="enfant_uo_id" value={ratForm.enfant_uo_id ?? ""}
                        onChange={(_k, v) => setRatForm(f => ({ ...f, enfant_uo_id: v }))}
                        options={[
                          { value: "", label: "— Sélectionner —" },
                          ...validEnfants.map(r => ({
                            value: r.id,
                            label: `${r.code ? `[${r.code}] ` : ""}${r.libelle}${r.niveau ? ` (Niv. ${r.niveau})` : ""}`,
                          }))
                        ]} />
                      <FieldInput label="Date d'effet *" name="date_debut" value={ratForm.date_debut ?? ""}
                        onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} type="date" />
                      <FieldInput label="Date fin" name="date_fin" value={ratForm.date_fin ?? ""}
                        onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} type="date" />
                      <FieldInput label="Réf. décision" name="reference_decision" value={ratForm.reference_decision ?? ""}
                        onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} />
                      <FieldInput label="Date décision" name="date_decision" value={ratForm.date_decision ?? ""}
                        onChange={(k, v) => setRatForm(f => ({ ...f, [k]: v as string }))} type="date" />
                      <ToggleField label="Actif" value={ratForm.actif ?? true} onChange={v => setRatForm(f => ({ ...f, actif: v }))} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveRattachement} disabled={savingRat} className="gap-1.5 h-7 text-xs">
                        <Check size={12} /> {savingRat ? "…" : "Enregistrer"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowRatForm(false)} className="h-7 text-xs"><X size={12} /></Button>
                    </div>
                  </div>
                )}

                {/* Rattachements */}
                {rattachementChildren.length > 0 && (
                  <div className="rounded-lg overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
                      style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                      Rattachements
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "hsl(var(--muted) / 0.3)" }}>
                          {["UO enfant", "Du", "Au", "Réf. décision", "Statut", ""].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rattachementChildren.map(rat => (
                          <tr key={rat.id} className="border-t hover:bg-muted/20" style={{ borderColor: "hsl(var(--border))" }}>
                            <td className="px-3 py-2 font-medium">
                              {rat.uo ? `${rat.uo.code ? `[${rat.uo.code}] ` : ""}${rat.uo.libelle}` : "—"}
                            </td>
                            <td className="px-3 py-2">{rat.date_debut}</td>
                            <td className="px-3 py-2">{rat.date_fin || "—"}</td>
                            <td className="px-3 py-2">{rat.reference_decision || "—"}</td>
                            <td className="px-3 py-2">
                              <span className="px-1.5 py-0.5 rounded text-xs"
                                style={rat.actif
                                  ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" }
                                  : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                                {rat.actif ? "Actif" : "Inactif"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => deleteRattachement(rat.id)} className="p-1 rounded hover:bg-red-50 text-red-400">
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {directChildren.length === 0 && rattachementChildren.length === 0 && !showRatForm && (
                  <div className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucune UO rattachée — utilisez le champ « UO parente » dans l'onglet Identification ou ajoutez un rattachement historique ci-dessus.
                  </div>
                )}
              </div>
              );
            })()}

            {/* ─── Onglet Organigramme ─── */}
            {formTab === "organigramme" && editing && (() => {
              // Construire l'arbre complet de la société de l'UO courante
              const socId = getSocieteIdForUo(editing);
              // Toutes les UOs de la même société
              const sameSOcUOs = rows.filter(r => getSocieteIdForUo(r) === socId);

              // Rendu récursif d'un nœud
              const renderNode = (uo: UniteOrg, depth: number): React.ReactNode => {
                const children = sameSOcUOs.filter(r => r.parent_id === uo.id);
                const typeUo = typesUo.find(t => t.code === uo.type_uo);
                // RG-UO-COULEUR-01 (Adil DAIA) : Couleur du type UO sur les libellés
                const typeColor = typeUo?.couleur || null;
                const isCurrent = uo.id === editing.id;
                const isParent = editing.parent_id === uo.id;

                return (
                  <div key={uo.id} style={{ marginLeft: depth * 24 }}>
                    <div
                      className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg my-0.5 transition-colors"
                      style={{
                        background: isCurrent
                          ? "hsl(var(--primary) / 0.12)"
                          : isParent
                          ? "hsl(var(--accent) / 0.6)"
                          : depth === 0
                          ? "hsl(var(--muted) / 0.5)"
                          : "transparent",
                        border: isCurrent ? "1.5px solid hsl(var(--primary) / 0.4)" : "1.5px solid transparent",
                      }}
                    >
                      {/* Ligne de connexion visuelle */}
                      {depth > 0 && (
                        <div className="flex items-center flex-shrink-0" style={{ marginLeft: -20 }}>
                          <div className="w-4 h-px" style={{ background: "hsl(var(--border))" }} />
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "hsl(var(--border))" }} />
                        </div>
                      )}
                      <Network size={12} style={{ color: typeColor || (isCurrent ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"), flexShrink: 0 }} />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-xs font-medium truncate"
                            style={{ color: typeColor || (isCurrent ? "hsl(var(--primary))" : "hsl(var(--foreground))") }}
                          >
                            {uo.libelle}
                          </span>
                          {uo.code && (
                            <span className="text-[10px] font-mono px-1 rounded flex-shrink-0"
                              style={{ background: typeColor ? `${typeColor}20` : "hsl(var(--muted))", color: typeColor || "hsl(var(--muted-foreground))" }}>
                              {uo.code}
                            </span>
                          )}
                          {isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                              style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}>
                              ← En cours
                            </span>
                          )}
                        </div>
                        {typeUo && (
                          <span className="text-[10px]" style={{ color: typeColor ? `${typeColor}cc` : "hsl(var(--muted-foreground))" }}>
                            {typeUo.libelle}{uo.niveau ? ` · Niveau ${uo.niveau}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="ml-auto flex-shrink-0">
                        <span
                          className="text-[10px] px-1.5 rounded-full"
                          style={uo.actif
                            ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" }
                            : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
                        >
                          {uo.actif ? "Actif" : "Inactif"}
                        </span>
                      </div>
                    </div>
                    {/* Ligne verticale pour les enfants */}
                    {children.length > 0 && (
                      <div style={{ marginLeft: 20, borderLeft: `1px dashed ${typeColor || "hsl(var(--border))"}`, paddingLeft: 4 }}>
                        {children.map(child => renderNode(child, depth + 1))}
                      </div>
                    )}
                  </div>
                );
              };

              // Trouver les racines de la société (UOs sans parent dans la même société)
              const roots = sameSOcUOs.filter(r => !r.parent_id || !sameSOcUOs.find(p => p.id === r.parent_id));
              const soc = societes.find(s => s.id === socId);

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Organigramme — {soc?.raison_sociale || "Société"}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>
                        {sameSOcUOs.length} unité{sameSOcUOs.length > 1 ? "s" : ""} organisationnelle{sameSOcUOs.length > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <div
                    className="rounded-lg border p-4 overflow-auto"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)", maxHeight: 420 }}
                  >
                    {roots.length === 0 ? (
                      <div className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
                        <Network size={28} className="mx-auto mb-2 opacity-30" />
                        Aucune UO dans cette société
                      </div>
                    ) : (
                      roots.map(r => renderNode(r, 0))
                    )}
                  </div>
                  {/* Légende */}
                  <div className="flex items-center gap-4 text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded border-[1.5px]" style={{ borderColor: "hsl(var(--primary) / 0.4)", background: "hsl(var(--primary) / 0.12)" }} />
                      UO sélectionnée
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded" style={{ background: "hsl(var(--accent) / 0.6)" }} />
                      UO parente
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-8 h-px border-t border-dashed" style={{ borderColor: "hsl(var(--border))" }} />
                      Lien hiérarchique
                    </div>
                  </div>
                </div>
              );
            })()}

            {formTab !== "rattachements" && formTab !== "organigramme" && (
              <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
                  <Check size={14} /> {saving ? "Enregistrement…" : "Enregistrer"}
                </Button>
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
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                {/* RG-UO-RESP-01 (Adil DAIA) : Ajout colonne Responsable dans la liste des UO */}
                {["Unité organisationnelle", "Société", "Type", "Niveau", "Responsable", "Statut", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roots.map(uo => <UORow key={uo.id} uo={uo} />)}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Vue Organigramme avec Drag & Drop ── */
        (() => {
          // Grouper par société
          const societeGroups = societes
            .filter(s => !filterSociete || s.id === filterSociete)
            .map(soc => ({
              soc,
              uos: filtered.filter(r => getSocieteIdForUo(r) === soc.id),
            }))
            .filter(g => g.uos.length > 0);

          // Rendu récursif — utilise les REFS pour éviter stale closures dans les handlers drag
          const renderOrgNode = (uo: UniteOrg, depth: number): React.ReactNode => {
            const children = filtered.filter(r => r.parent_id === uo.id);
            const typeUo = typesUo.find(t => t.code === uo.type_uo);
            const isDragging = draggedUo?.id === uo.id;
            const isDragOver = dragOverId === uo.id;
            const canDrop = draggedUo ? !isDragging && isValidDrop(draggedUo, uo) : false;

            return (
              <div key={uo.id}>
                <div
                  draggable
                  onDragStart={e => {
                    e.stopPropagation();
                    // Stocker dans la ref ET dans le state
                    draggedUoRef.current = uo;
                    setDraggedUo(uo);
                    e.dataTransfer.effectAllowed = "move";
                    // Stocker l'id en dataTransfer comme fallback
                    e.dataTransfer.setData("text/plain", uo.id);
                  }}
                  onDragEnd={e => {
                    e.stopPropagation();
                    draggedUoRef.current = null;
                    dragOverIdRef.current = null;
                    setDraggedUo(null);
                    setDragOverId(null);
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dragged = draggedUoRef.current;
                    if (dragged && dragged.id !== uo.id && isValidDrop(dragged, uo)) {
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverIdRef.current !== uo.id) {
                        dragOverIdRef.current = uo.id;
                        setDragOverId(uo.id);
                      }
                    } else {
                      e.dataTransfer.dropEffect = "none";
                      if (dragOverIdRef.current === uo.id) {
                        dragOverIdRef.current = null;
                        setDragOverId(null);
                      }
                    }
                  }}
                  onDragLeave={e => {
                    e.stopPropagation();
                    // Vérifier qu'on quitte réellement l'élément (pas un enfant)
                    const related = e.relatedTarget as Node | null;
                    if (!e.currentTarget.contains(related)) {
                      if (dragOverIdRef.current === uo.id) {
                        dragOverIdRef.current = null;
                        setDragOverId(null);
                      }
                    }
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dragged = draggedUoRef.current;
                    if (dragged && dragged.id !== uo.id && isValidDrop(dragged, uo)) {
                      setPendingDrop({ child: dragged, parent: uo });
                      setDropRatForm({ date_debut: new Date().toISOString().split("T")[0], reference_decision: "", date_decision: "" });
                      setShowDropDialog(true);
                    }
                    draggedUoRef.current = null;
                    dragOverIdRef.current = null;
                    setDraggedUo(null);
                    setDragOverId(null);
                  }}
                  className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg my-0.5 select-none transition-all"
                  style={{
                    marginLeft: depth * 28,
                    opacity: isDragging ? 0.35 : 1,
                    cursor: isDragging ? "grabbing" : "grab",
                    background: isDragOver && canDrop
                      ? "hsl(var(--primary) / 0.15)"
                      : isDragOver
                      ? "hsl(var(--destructive) / 0.08)"
                      : "hsl(var(--card))",
                    border: isDragOver && canDrop
                      ? "2px dashed hsl(var(--primary))"
                      : isDragOver
                      ? "2px dashed hsl(var(--destructive) / 0.5)"
                      : "2px solid hsl(var(--border))",
                    boxShadow: isDragOver && canDrop ? "0 0 0 3px hsl(var(--primary) / 0.1)" : "none",
                    transform: isDragging ? "scale(0.98)" : "none",
                  }}
                >
                  <GripVertical size={12} style={{ color: "hsl(var(--muted-foreground))", opacity: 0.5, flexShrink: 0 }} />
                  {/* RG-UO-COULEUR-01 (Adil DAIA) : Icône colorisée par type d'UO */}
                  <Network size={13} style={{ color: typeUo?.couleur || (typeUo ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"), flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate"
                        style={{ color: typeUo?.couleur || "hsl(var(--foreground))" }}>
                        {uo.libelle}
                      </span>
                      {uo.code && (
                        <span className="text-[10px] font-mono px-1 rounded flex-shrink-0"
                          style={{
                            background: typeUo?.couleur ? `${typeUo.couleur}22` : "hsl(var(--muted))",
                            color: typeUo?.couleur || "hsl(var(--muted-foreground))"
                          }}>
                          {uo.code}
                        </span>
                      )}
                    </div>
                    {typeUo && (
                      <span className="text-[11px]"
                        style={{ color: typeUo.couleur ? `${typeUo.couleur}bb` : "hsl(var(--muted-foreground))" }}>
                        {typeUo.libelle}{uo.niveau != null ? ` · Niv. ${uo.niveau}` : ""}
                      </span>
                    )}
                  </div>
                  {isDragOver && canDrop && (
                    <div className="flex items-center gap-1 text-[10px] font-medium flex-shrink-0" style={{ color: "hsl(var(--primary))" }}>
                      <MoveRight size={11} /> Rattacher ici
                    </div>
                  )}
                  {isDragOver && !canDrop && draggedUoRef.current && (
                    <div className="flex items-center gap-1 text-[10px] flex-shrink-0" style={{ color: "hsl(var(--destructive))" }}>
                      <X size={11} /> Niveau invalide
                    </div>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-1 flex-shrink-0"
                    style={uo.actif
                      ? { background: "hsl(142 71% 45% / 0.12)", color: "hsl(142 71% 35%)" }
                      : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                    {uo.actif ? "Actif" : "Inactif"}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(uo)} className="p-1 rounded hover:bg-muted/60" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <Pencil size={12} />
                    </button>
                  </div>
                </div>
                {children.length > 0 && (
                  <div style={{ marginLeft: 28 + depth * 28, paddingLeft: 8, borderLeft: "2px solid hsl(var(--border) / 0.6)" }}>
                    {children.map(child => renderOrgNode(child, depth + 1))}
                  </div>
                )}
              </div>
            );
          };

          return (
            <div className="space-y-4">
              {draggedUo && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ background: "hsl(var(--primary) / 0.08)", color: "hsl(var(--primary))", border: "1px dashed hsl(var(--primary) / 0.3)" }}>
                  <GripVertical size={13} />
                  Déplacement de <strong>«&nbsp;{draggedUo.libelle}&nbsp;»</strong> — Glissez sur une UO parente valide pour la rattacher
                </div>
              )}
              {societeGroups.map(({ soc, uos }) => {
                const socRoots = uos.filter(r => !r.parent_id || !uos.find(p => p.id === r.parent_id));
                return (
                  <div key={soc.id} className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b"
                      style={{ background: "hsl(var(--muted) / 0.4)", borderColor: "hsl(var(--border))" }}>
                      <Building2 size={14} style={{ color: "hsl(var(--primary))" }} />
                      <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{soc.raison_sociale}</span>
                      <span className="text-xs ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {uos.length} UO{uos.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="p-4">
                      {socRoots.map(uo => renderOrgNode(uo, 0))}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-5 text-[11px] px-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                <div className="flex items-center gap-1.5"><GripVertical size={12} /> Glisser-déposer pour déplacer</div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-px border-t-2" style={{ borderColor: "hsl(var(--border) / 0.6)" }} />
                  Lien hiérarchique
                </div>
              </div>
            </div>
          );
        })()
      )}

      {/* ── Dialog rattachement par drag & drop ── */}
      <Dialog open={showDropDialog} onOpenChange={open => { if (!open) { setShowDropDialog(false); setPendingDrop(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MoveRight size={18} style={{ color: "hsl(var(--primary))" }} />
              Nouveau rattachement
            </DialogTitle>
          </DialogHeader>
          {pendingDrop && (
            <div className="space-y-4 py-2">
              {/* Résumé du déplacement */}
              <div className="flex items-center gap-3 p-3 rounded-lg text-sm"
                style={{ background: "hsl(var(--muted) / 0.4)", border: "1px solid hsl(var(--border))" }}>
                <div className="flex flex-col items-center text-center min-w-0 flex-1">
                  <Network size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                  <span className="text-xs font-medium mt-0.5 truncate w-full" style={{ color: "hsl(var(--foreground))" }}>
                    {pendingDrop.child.libelle}
                  </span>
                  <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {typesUo.find(t => t.code === pendingDrop.child.type_uo)?.libelle || "—"}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                  <MoveRight size={16} style={{ color: "hsl(var(--primary))" }} />
                  <span className="text-[9px] font-medium" style={{ color: "hsl(var(--primary))" }}>rattaché à</span>
                </div>
                <div className="flex flex-col items-center text-center min-w-0 flex-1">
                  <Network size={14} style={{ color: "hsl(var(--primary))" }} />
                  <span className="text-xs font-medium mt-0.5 truncate w-full" style={{ color: "hsl(var(--primary))" }}>
                    {pendingDrop.parent.libelle}
                  </span>
                  <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {typesUo.find(t => t.code === pendingDrop.parent.type_uo)?.libelle || "—"}
                  </span>
                </div>
              </div>

              {/* Champs rattachement */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Date d'effet <span style={{ color: "hsl(var(--destructive))" }}>*</span>
                  </label>
                  <Input type="date" className="h-8 text-sm" value={dropRatForm.date_debut}
                    onChange={e => setDropRatForm(f => ({ ...f, date_debut: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Réf. décision</label>
                  <Input className="h-8 text-sm" placeholder="Ex: DEC-2026-001" value={dropRatForm.reference_decision}
                    onChange={e => setDropRatForm(f => ({ ...f, reference_decision: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Date décision</label>
                  <Input type="date" className="h-8 text-sm" value={dropRatForm.date_decision}
                    onChange={e => setDropRatForm(f => ({ ...f, date_decision: e.target.value }))} />
                </div>
              </div>

              <div className="text-xs p-2.5 rounded-lg" style={{ background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--muted-foreground))" }}>
                L'ancien rattachement actif sera automatiquement clôturé à la veille de la date d'effet (J−1).
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowDropDialog(false); setPendingDrop(null); }}>
              <X size={13} className="mr-1" /> Annuler
            </Button>
            <Button size="sm" onClick={applyDrop} disabled={savingDrop || !dropRatForm.date_debut} className="gap-1.5">
              <Check size={13} /> {savingDrop ? "Enregistrement…" : "Confirmer le rattachement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        supabase.from("ref_type_uo").select("code, libelle, niveau, ordre").eq("actif", true).order("ordre"),
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

  useEffect(() => {
    if (tab !== "societes") refreshSocietes();
  }, [tab, refreshSocietes]);

  const isReadOnly = useContext(ManagerReadOnlyContext);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--primary) / 0.1)" }}>
            <Building2 size={20} style={{ color: "hsl(var(--primary))" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Organisations</h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              Gestion des sociétés et unités organisationnelles
            </p>
          </div>
        </div>
        {isReadOnly && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }}>
            <Eye size={12} /> Lecture seule
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Sociétés", icon: Building2, color: "hsl(var(--primary))" },
          { label: "Unités Org.", icon: Network, color: "hsl(38 92% 50%)" },
        ].map(({ label, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-4 flex items-center gap-3"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}1a` }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
              <p className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>
                {label === "Sociétés" ? societes.filter(s => s.actif).length : (uoCount ?? "—")}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="flex border-b" style={{ borderColor: "hsl(var(--border))" }}>
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors relative"
                style={{
                  color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  borderBottom: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  background: active ? "hsl(var(--primary) / 0.04)" : "transparent",
                }}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {tab === "societes" && (
            <SocietesTab
              conventions={conventions} secteurs={secteurs}
              regions={regions} pays={pays} villes={villes}
              banques={banques} devises={devises}
            />
          )}
          {tab === "uo" && <UOTab societes={societes} typesUo={typesUo} pays={pays} regions={regions} villes={villes} />}
        </div>
      </div>
    </div>
  );
};

export default OrganisationsPage;
