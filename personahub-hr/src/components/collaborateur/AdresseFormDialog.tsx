/**
 * AdresseFormDialog — Formulaire de saisie/édition d'une adresse collaborateur.
 *
 * Style aligné sur ContratForm :
 *   - Overlay custom (pas de Dialog shadcn)
 *   - Card centrée max-w-3xl, header + body scrollable + footer
 *   - Sections en SectionTitle accent uppercase
 *   - Helpers Label / Input / Textarea / Select custom
 *   - Boutons Annuler (border) / Enregistrer (accent + Save icon)
 *
 * Logique métier :
 *   - Cascading intelligent pays → région → ville (saisir une ville pré-remplit tout)
 *   - API FastAPI (cohérent avec le module backend Adresses)
 *   - Au moins un rôle d'adresse coché (validation locale + serveur)
 */
import React, { useEffect, useState } from "react";
import { X, Save, Loader2 } from "lucide-react";

import {
  usePays,
  useRegions,
  useVilles,
} from "@/hooks/useReferentielsAdresse";
import {
  useCollaborateurAdresses,
  type CollaborateurAdresse,
} from "@/hooks/useCollaborateurAdresses";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collaborateurId: string;
  adresse?: CollaborateurAdresse | null;
}

interface FormState {
  adresse: string;
  complement_adresse: string;
  code_postal: string;
  code_pays: string;
  code_region: string;
  code_ville: string;
  telephone: string;
  telephone_bis: string;
  email: string;
  is_adresse_principale: boolean;
  is_adresse_correspondance: boolean;
  is_adresse_residence: boolean;
  is_adresse_professionnelle: boolean;
}

const EMPTY: FormState = {
  adresse: "",
  complement_adresse: "",
  code_postal: "",
  code_pays: "",
  code_region: "",
  code_ville: "",
  telephone: "",
  telephone_bis: "",
  email: "",
  is_adresse_principale: false,
  is_adresse_correspondance: false,
  is_adresse_residence: false,
  is_adresse_professionnelle: false,
};

// ---------------------------------------------------------------------------
// Helpers (alignés sur ContratForm)
// ---------------------------------------------------------------------------
const Label: React.FC<{ children: React.ReactNode; required?: boolean }> = ({
  children, required,
}) => (
  <label
    className="block text-xs font-medium mb-1"
    style={{ color: "hsl(var(--muted-foreground))" }}
  >
    {children}
    {required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
  </label>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all"
    style={{
      borderColor: "hsl(var(--border))",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      minHeight: 40,
    }}
    onFocus={(e) => (e.currentTarget.style.borderColor = "hsl(var(--accent))")}
    onBlur={(e) => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
  />
);

const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    rows={props.rows ?? 2}
    className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all resize-none"
    style={{
      borderColor: "hsl(var(--border))",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
    }}
    onFocus={(e) => (e.currentTarget.style.borderColor = "hsl(var(--accent))")}
    onBlur={(e) => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
  />
);

const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }
> = ({ children, ...props }) => (
  <select
    {...props}
    className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all"
    style={{
      borderColor: "hsl(var(--border))",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      minHeight: 40,
    }}
    onFocus={(e) => (e.currentTarget.style.borderColor = "hsl(var(--accent))")}
    onBlur={(e) => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
  >
    {children}
  </select>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="col-span-full">
    <p
      className="text-xs font-bold uppercase tracking-wider pb-1 mb-2 border-b"
      style={{ color: "hsl(var(--accent))", borderColor: "hsl(var(--border))" }}
    >
      {children}
    </p>
  </div>
);

const Checkbox: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border cursor-pointer"
      style={{ accentColor: "hsl(var(--accent))" }}
    />
    <span style={{ color: "hsl(var(--foreground))" }}>{label}</span>
  </label>
);

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
export function AdresseFormDialog({ open, onOpenChange, collaborateurId, adresse }: Props) {
  const isEdit = !!adresse;
  const { create, update } = useCollaborateurAdresses(collaborateurId);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [villeSearch, setVilleSearch] = useState("");

  // Référentiels (cascading)
  const { data: pays = [], isLoading: loadingPays } = usePays();
  const { data: regions = [] } = useRegions(form.code_pays || null);
  const { data: villes = [] } = useVilles({
    codeRegion: form.code_region || null,
    codePays: !form.code_region ? form.code_pays || null : null,
    search: villeSearch || undefined,
    limit: 200,
    enabled: open,
  });

  // Pré-remplit en mode édition
  useEffect(() => {
    if (open) {
      setError(null);
      setVilleSearch("");
      if (adresse) {
        setForm({
          adresse: adresse.adresse,
          complement_adresse: adresse.complement_adresse ?? "",
          code_postal: adresse.code_postal ?? "",
          code_pays: adresse.code_pays ?? "",
          code_region: adresse.code_region ?? "",
          code_ville: adresse.code_ville ?? "",
          telephone: adresse.telephone ?? "",
          telephone_bis: adresse.telephone_bis ?? "",
          email: adresse.email ?? "",
          is_adresse_principale: adresse.is_adresse_principale,
          is_adresse_correspondance: adresse.is_adresse_correspondance,
          is_adresse_residence: adresse.is_adresse_residence,
          is_adresse_professionnelle: adresse.is_adresse_professionnelle,
        });
      } else {
        setForm(EMPTY);
      }
    }
  }, [open, adresse]);

  // -------------------------------------------------------------------------
  // Helpers de mise à jour + cascading
  // -------------------------------------------------------------------------
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  /** Sélection d'un pays → on RAZ région et ville */
  const handlePays = (codePays: string) => {
    setForm((f) => ({ ...f, code_pays: codePays, code_region: "", code_ville: "" }));
  };

  /** Sélection d'une région → auto-remplit pays + RAZ ville */
  const handleRegion = (codeRegion: string) => {
    const region = regions.find((r) => r.code === codeRegion);
    setForm((f) => ({
      ...f,
      code_region: codeRegion,
      code_pays: region?.code_pays ?? f.code_pays,
      code_ville: "",
    }));
  };

  /** Sélection d'une ville → auto-remplit région, pays et code postal */
  const handleVille = (codeVille: string) => {
    const ville = villes.find((v) => v.code === codeVille);
    if (!ville) {
      set("code_ville", codeVille);
      return;
    }
    setForm((f) => ({
      ...f,
      code_ville: codeVille,
      code_region: ville.code_region,
      code_pays: ville.code_pays ?? f.code_pays,
      code_postal: f.code_postal || ville.code_postal || "",
    }));
  };

  // -------------------------------------------------------------------------
  // Validation et sauvegarde
  // -------------------------------------------------------------------------
  const validate = (): string | null => {
    if (!form.adresse.trim()) return "L'adresse est obligatoire";
    if (
      !form.is_adresse_principale &&
      !form.is_adresse_correspondance &&
      !form.is_adresse_residence &&
      !form.is_adresse_professionnelle
    ) {
      return "Au moins un rôle d'adresse doit être coché (principale, correspondance, résidence ou professionnelle)";
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return "Format d'email invalide";
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);

    const payload = {
      adresse: form.adresse,
      complement_adresse: form.complement_adresse || null,
      code_postal: form.code_postal || null,
      code_pays: form.code_pays || null,
      code_region: form.code_region || null,
      code_ville: form.code_ville || null,
      telephone: form.telephone || null,
      telephone_bis: form.telephone_bis || null,
      email: form.email || null,
      is_adresse_principale: form.is_adresse_principale,
      is_adresse_correspondance: form.is_adresse_correspondance,
      is_adresse_residence: form.is_adresse_residence,
      is_adresse_professionnelle: form.is_adresse_professionnelle,
    };

    try {
      if (isEdit && adresse) {
        await update.mutateAsync({ id: adresse.id, payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------------
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "hsl(0 0% 0% / 0.5)" }}
      onClick={(e) => {
        // Fermer en cliquant sur le fond noir
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border shadow-2xl flex flex-col"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <h2 className="font-semibold text-base" style={{ color: "hsl(var(--foreground))" }}>
            {isEdit ? "Modifier l'adresse" : "Nouvelle adresse"}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            type="button"
          >
            <X size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {/* Hint */}
          <div
            className="mb-4 px-3 py-2 rounded-lg text-xs flex items-center gap-2"
            style={{
              background: "hsl(var(--accent) / 0.06)",
              color: "hsl(var(--muted-foreground))",
              border: "1px solid hsl(var(--accent) / 0.15)",
            }}
          >
            <span style={{ color: "hsl(var(--accent))" }}>💡</span>
            Saisissez la <strong>ville</strong> et la région, le pays et le code postal seront
            renseignés automatiquement.
          </div>

          {error && (
            <div
              className="mb-4 px-3 py-2 rounded-lg text-sm"
              style={{
                background: "hsl(0 84% 55% / 0.1)",
                color: "hsl(0 84% 45%)",
                border: "1px solid hsl(0 84% 55% / 0.3)",
              }}
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* ── Adresse postale ── */}
            <SectionTitle>Adresse postale</SectionTitle>

            <div className="col-span-full">
              <Label required>Adresse</Label>
              <Textarea
                rows={2}
                value={form.adresse}
                onChange={(e) => set("adresse", e.target.value)}
                placeholder="N° et nom de rue"
              />
            </div>

            <div className="col-span-full">
              <Label>Complément d'adresse</Label>
              <Input
                value={form.complement_adresse}
                onChange={(e) => set("complement_adresse", e.target.value)}
                placeholder="Bâtiment, escalier, étage…"
              />
            </div>

            {/* ── Localisation (cascading) ── */}
            <SectionTitle>Localisation</SectionTitle>

            <div>
              <Label>Pays</Label>
              <Select
                value={form.code_pays}
                onChange={(e) => handlePays(e.target.value)}
              >
                <option value="">{loadingPays ? "Chargement…" : "— Sélectionner —"}</option>
                {pays.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.libelle}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Région</Label>
              <Select
                value={form.code_region}
                onChange={(e) => handleRegion(e.target.value)}
              >
                <option value="">— Sélectionner —</option>
                {regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.libelle}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Ville</Label>
              <div className="space-y-2">
                <Input
                  type="search"
                  placeholder="Rechercher une ville…"
                  value={villeSearch}
                  onChange={(e) => setVilleSearch(e.target.value)}
                />
                <Select
                  value={form.code_ville}
                  onChange={(e) => handleVille(e.target.value)}
                >
                  <option value="">— Sélectionner —</option>
                  {villes.map((v) => (
                    <option key={v.code} value={v.code}>
                      {v.libelle}
                      {v.code_postal && ` (${v.code_postal})`}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label>Code postal</Label>
              <Input
                value={form.code_postal}
                onChange={(e) => set("code_postal", e.target.value)}
              />
            </div>

            {/* ── Coordonnées ── */}
            <SectionTitle>Coordonnées</SectionTitle>

            <div>
              <Label>Téléphone</Label>
              <Input
                value={form.telephone}
                onChange={(e) => set("telephone", e.target.value)}
              />
            </div>

            <div>
              <Label>Téléphone bis</Label>
              <Input
                value={form.telephone_bis}
                onChange={(e) => set("telephone_bis", e.target.value)}
              />
            </div>

            <div className="col-span-full">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>

            {/* ── Rôles de l'adresse ── */}
            <SectionTitle>Rôles de cette adresse</SectionTitle>

            <div className="col-span-full">
              <p
                className="text-xs mb-3"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Au moins un rôle doit être coché. Une adresse peut cumuler plusieurs rôles.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Checkbox
                  label="Principale"
                  checked={form.is_adresse_principale}
                  onChange={(v) => set("is_adresse_principale", v)}
                />
                <Checkbox
                  label="Correspondance"
                  checked={form.is_adresse_correspondance}
                  onChange={(v) => set("is_adresse_correspondance", v)}
                />
                <Checkbox
                  label="Résidence"
                  checked={form.is_adresse_residence}
                  onChange={(v) => set("is_adresse_residence", v)}
                />
                <Checkbox
                  label="Professionnelle"
                  checked={form.is_adresse_professionnelle}
                  onChange={(v) => set("is_adresse_professionnelle", v)}
                />
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 border-t"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
            type="button"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: "hsl(var(--accent))",
              color: "white",
              opacity: saving ? 0.7 : 1,
            }}
            type="button"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
