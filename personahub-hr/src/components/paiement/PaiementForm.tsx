/**
 * PaiementForm – Formulaire CRUD pour les coordonnées bancaires d'un collaborateur.
 * Basé sur la table collaborateur_paiements (FK RefBanques, RefModePaiement).
 * Règles : actif = true par défaut, auto-désactivé si date_fin < aujourd'hui.
 * Un seul compte peut être principal + actif.
 */
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import RefSelect from "@/components/RefSelect";
import { Plus, Pencil, Trash2, Save, X, Star, CheckCircle2, XCircle } from "lucide-react";

interface Paiement {
  id: string;
  collaborateur_id: string;
  code_mode: string;
  date_debut: string;
  date_fin: string | null;
  code_banque: string | null;
  code_agence: string | null;
  nom_agence: string | null;
  numero_compte: string | null;
  code_iban: string | null;
  code_bic: string | null;
  intitule_compte: string | null;
  principal: boolean;
  actif: boolean;
  archive: boolean;
}

const EMPTY: Omit<Paiement, "id" | "collaborateur_id" | "archive"> = {
  code_mode: "",
  date_debut: new Date().toISOString().split("T")[0],
  date_fin: null,
  code_banque: null,
  code_agence: null,
  nom_agence: null,
  numero_compte: null,
  code_iban: null,
  code_bic: null,
  intitule_compte: null,
  principal: false,
  actif: true,
};

interface Props {
  collaborateurId: string;
  readOnly?: boolean;
}

const PaiementForm: React.FC<Props> = ({ collaborateurId, readOnly }) => {
  const [items, setItems] = useState<Paiement[]>([]);
  const [editing, setEditing] = useState<Paiement | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [refModes, setRefModes] = useState<Record<string, string>>({});
  const [refBanques, setRefBanques] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    // FIX : on liste les colonnes explicitement (le proxy FastAPI ne supporte pas le "*").
    const { data, error } = await supabase
      .from("collaborateur_paiements")
      .select("id,collaborateur_id,code_mode,date_debut,date_fin,code_banque,code_agence,nom_agence,numero_compte,code_iban,code_bic,intitule_compte,principal,actif,archive")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_debut", { ascending: false });
    if (error) {
      console.error("Load paiements:", error);
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    }
    // Tri JS additionnel : le compte principal ACTIF du moment passe en tête.
    // "Actif du moment" = principal=true, actif=true et (date_fin null ou >= aujourd'hui).
    const todayStr = new Date().toISOString().split("T")[0];
    const sorted = ((data || []) as Paiement[]).slice().sort((a, b) => {
      const aIsMain = a.principal && a.actif && (!a.date_fin || a.date_fin >= todayStr);
      const bIsMain = b.principal && b.actif && (!b.date_fin || b.date_fin >= todayStr);
      if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;
      // Sinon on conserve l'ordre date_debut DESC déjà appliqué par PostgreSQL
      return (b.date_debut || "").localeCompare(a.date_debut || "");
    });
    setItems(sorted);
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  // Load reference labels
  useEffect(() => {
    const loadRefs = async () => {
      const [{ data: modes }, { data: banques }] = await Promise.all([
        supabase.from("ref_mode_paiement" as never).select("code, libelle" as never),
        supabase.from("ref_banque" as never).select("code, libelle" as never),
      ]);
      const mMap: Record<string, string> = {};
      ((modes || []) as any[]).forEach((r: any) => { mMap[r.code] = r.libelle; });
      setRefModes(mMap);
      const bMap: Record<string, string> = {};
      ((banques || []) as any[]).forEach((r: any) => { bMap[r.code] = r.libelle; });
      setRefBanques(bMap);
    };
    loadRefs();
  }, []);

  // Auto-compute actif based on date_fin
  const computeActif = (dateFin: string | null): boolean => {
    if (!dateFin) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const df = new Date(dateFin);
    df.setHours(0, 0, 0, 0);
    return df >= today;
  };

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setCreating(true);
  };

  const startEdit = (p: Paiement) => {
    setCreating(false);
    setEditing(p);
    setForm({
      code_mode: p.code_mode,
      date_debut: p.date_debut,
      date_fin: p.date_fin,
      code_banque: p.code_banque,
      code_agence: p.code_agence,
      nom_agence: p.nom_agence,
      numero_compte: p.numero_compte,
      code_iban: p.code_iban,
      code_bic: p.code_bic,
      intitule_compte: p.intitule_compte,
      principal: p.principal,
      actif: computeActif(p.date_fin),
    });
  };

  const cancel = () => { setCreating(false); setEditing(null); };

  const handleSave = async () => {
    if (!form.code_mode || !form.date_debut) {
      toast({ title: "Mode de paiement et date début sont obligatoires", variant: "destructive" });
      return;
    }

    // Use the user-set actif value from the form
    const actif = form.actif;

    // If setting as principal, check there isn't already a principal+actif account
    if (form.principal && actif) {
      const existing = items.find(
        p => p.principal && p.actif && p.id !== editing?.id
      );
      if (existing) {
        toast({
          title: "Un compte principal actif existe déjà",
          description: "Désactivez ou retirez le statut principal de l'autre compte d'abord.",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    try {
      const payload = { ...form, actif };

      if (creating) {
        const { error } = await supabase.from("collaborateur_paiements").insert({
          collaborateur_id: collaborateurId,
          ...payload,
        } as never);
        if (error) throw error;
        toast({ title: "Coordonnée bancaire ajoutée" });
      } else if (editing) {
        const { error } = await supabase.from("collaborateur_paiements")
          .update({ ...payload, updated_at: new Date().toISOString() } as never)
          .eq("id", editing.id);
        if (error) throw error;
        toast({ title: "Coordonnée bancaire mise à jour" });
      }
      cancel();
      load();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Archiver cette coordonnée bancaire ?")) return;
    await supabase.from("collaborateur_paiements").update({ archive: true } as never).eq("id", id);
    toast({ title: "Coordonnée archivée" });
    load();
  };

  const isFormOpen = creating || !!editing;

  return (
    <div>
      {/* Header */}
      {!readOnly && !isFormOpen && (
        <div className="flex justify-end mb-3">
          <button
            onClick={startCreate}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-accent-foreground"
          >
            <Plus size={12} /> Ajouter
          </button>
        </div>
      )}

      {/* Formulaire */}
      {isFormOpen && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.03] p-4 mb-4">
          <h4 className="text-sm font-semibold mb-3 text-foreground">
            {creating ? "Nouvelle coordonnée bancaire" : "Modifier la coordonnée"}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Mode paiement */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Mode de paiement *</label>
              <RefSelect
                table="ref_mode_paiement"
                value={form.code_mode}
                onChange={(v) => setForm(f => ({ ...f, code_mode: v }))}
                placeholder="Sélectionner..."
              />
            </div>

            {/* Banque */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Banque</label>
              <RefSelect
                table="ref_banque"
                value={form.code_banque || ""}
                onChange={(v) => setForm(f => ({ ...f, code_banque: v || null }))}
                placeholder="Sélectionner..."
              />
            </div>

            {/* Code agence */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Code agence</label>
              <input
                type="text"
                value={form.code_agence || ""}
                onChange={e => setForm(f => ({ ...f, code_agence: e.target.value || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                maxLength={20}
              />
            </div>

            {/* Nom agence */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Nom agence</label>
              <input
                type="text"
                value={form.nom_agence || ""}
                onChange={e => setForm(f => ({ ...f, nom_agence: e.target.value || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
              />
            </div>

            {/* Numéro compte */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Numéro de compte</label>
              <input
                type="text"
                value={form.numero_compte || ""}
                onChange={e => setForm(f => ({ ...f, numero_compte: e.target.value || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                maxLength={50}
              />
            </div>

            {/* IBAN */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">IBAN</label>
              <input
                type="text"
                value={form.code_iban || ""}
                onChange={e => setForm(f => ({ ...f, code_iban: e.target.value.toUpperCase() || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-mono"
                maxLength={34}
                placeholder="MA00 0000 0000 0000 0000 0000 000"
              />
            </div>

            {/* BIC */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">BIC / SWIFT</label>
              <input
                type="text"
                value={form.code_bic || ""}
                onChange={e => setForm(f => ({ ...f, code_bic: e.target.value.toUpperCase() || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-mono"
                maxLength={11}
              />
            </div>

            {/* Intitulé compte */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Intitulé du compte</label>
              <input
                type="text"
                value={form.intitule_compte || ""}
                onChange={e => setForm(f => ({ ...f, intitule_compte: e.target.value || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                maxLength={100}
              />
            </div>

            {/* Date début */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Date début *</label>
              <input
                type="date"
                value={form.date_debut}
                onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
              />
            </div>

            {/* Date fin */}
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Date fin</label>
              <input
                type="date"
                value={form.date_fin || ""}
                onChange={e => {
                  const val = e.target.value || null;
                  setForm(f => ({ ...f, date_fin: val, actif: computeActif(val) }));
                }}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
              />
              {form.date_fin && !computeActif(form.date_fin) && (
                <p className="text-[10px] mt-1 text-destructive font-medium">
                  ⚠ Date fin dépassée — le compte sera marqué inactif
                </p>
              )}
            </div>

            {/* Principal + Actif */}
            <div className="flex flex-col gap-2 justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.principal}
                  onChange={e => setForm(f => ({ ...f, principal: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <span className="text-xs font-medium text-foreground">Compte principal</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.actif}
                  onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <span className={`text-xs font-medium ${form.actif ? "text-green-600" : "text-destructive"}`}>
                  {form.actif ? "Actif" : "Inactif"}
                </span>
              </label>
              {form.date_fin && !computeActif(form.date_fin) && form.actif && (
                <p className="text-[10px] text-amber-600 font-medium">
                  ⚠ Date fin dépassée — pensez à désactiver le compte
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-accent-foreground transition-colors disabled:opacity-60"
            >
              <Save size={13} /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              onClick={cancel}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground transition-colors"
            >
              <X size={13} /> Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {items.length === 0 && !isFormOpen ? (
        <p className="text-sm text-center py-6 text-muted-foreground">
          Aucune coordonnée bancaire enregistrée
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(p => {
            const isActif = p.actif && computeActif(p.date_fin);
            return (
              <div
                key={p.id}
                className={`p-4 rounded-xl border transition-colors ${!isActif ? "opacity-60" : ""}`}
                style={{
                  borderColor: p.principal && isActif
                    ? "hsl(var(--accent) / 0.3)"
                    : !isActif
                    ? "hsl(var(--destructive) / 0.2)"
                    : "hsl(var(--border))",
                  background: p.principal && isActif
                    ? "hsl(var(--accent) / 0.03)"
                    : !isActif
                    ? "hsl(var(--destructive) / 0.03)"
                    : "hsl(var(--muted) / 0.3)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Actif/Inactif badge */}
                    {isActif ? (
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <CheckCircle2 size={10} /> Actif
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-destructive/10 text-destructive">
                        <XCircle size={10} /> Inactif
                      </span>
                    )}
                    {p.principal && (
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-accent/10 text-accent">
                        <Star size={10} /> Principal
                      </span>
                    )}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {p.date_debut ? new Date(p.date_debut).toLocaleDateString("fr-FR") : ""} — {p.date_fin ? new Date(p.date_fin).toLocaleDateString("fr-FR") : "En cours"}
                    </span>
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(p)} className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-md hover:bg-muted/60 text-destructive">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <FieldDisplay label="Mode paiement" value={refModes[p.code_mode] || p.code_mode} />
                  <FieldDisplay label="Banque" value={p.code_banque ? (refBanques[p.code_banque] || p.code_banque) : null} />
                  <FieldDisplay label="Code agence" value={p.code_agence} />
                  <FieldDisplay label="Nom agence" value={p.nom_agence} />
                  <FieldDisplay label="N° compte" value={p.numero_compte} />
                  <FieldDisplay label="IBAN" value={p.code_iban} mono />
                  <FieldDisplay label="BIC" value={p.code_bic} mono />
                  <FieldDisplay label="Intitulé" value={p.intitule_compte} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const FieldDisplay: React.FC<{ label: string; value?: string | null; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <p className="text-[10px] font-medium mb-0.5 text-muted-foreground">{label}</p>
    <p className={`text-xs font-medium ${mono ? "font-mono" : ""} ${value ? "text-foreground" : "text-muted-foreground/50"}`}>
      {value || "—"}
    </p>
  </div>
);

export default PaiementForm;
