// src/pages/espaces/TacheEtapesConfig.tsx
// Page de configuration des étapes du Kanban
import React, { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical, Save, X, Loader2, Settings2 } from "lucide-react";
import { tacheEtapesApi, TacheEtape } from "@/lib/tacheEtapesApi";

const COULEURS_PRESETS = [
  "#6B7280", "#3B82F6", "#8B5CF6", "#F59E0B",
  "#10B981", "#EF4444", "#EC4899", "#14B8A6",
];

const ETAPES_FIXES = ["terminee", "annulee"];

export default function TacheEtapesConfig({ onClose }: { onClose: () => void }) {
  const [etapes, setEtapes]     = useState<TacheEtape[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState<string | null>(null);

  // Formulaire nouvelle étape
  const [showForm, setShowForm]   = useState(false);
  const [newLibelle, setNewLibelle] = useState("");
  const [newCouleur, setNewCouleur] = useState("#6B7280");
  const [creating,  setCreating]  = useState(false);

  useEffect(() => {
    tacheEtapesApi.list().then(setEtapes).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (etape: TacheEtape) => {
    if (ETAPES_FIXES.includes(etape.code)) return;
    setSaving(etape.id);
    try {
      await tacheEtapesApi.delete(etape.id);
      setEtapes(prev => prev.filter(e => e.id !== etape.id));
    } finally { setSaving(null); }
  };

  const handleCreate = async () => {
    if (!newLibelle.trim()) return;
    setCreating(true);
    try {
      const code = newLibelle.trim()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .slice(0, 30);
      const ordre = Math.max(...etapes.filter(e => !e.est_finale).map(e => e.ordre), 10) + 10;
      const created = await tacheEtapesApi.create({
        code:       `custom_${code}_${Date.now()}`,
        libelle:    newLibelle.trim(),
        couleur:    newCouleur,
        icone:      "Circle",
        ordre,
        est_finale: false,
      });
      setEtapes(prev => {
        const finales = prev.filter(e => e.est_finale);
        const actives = prev.filter(e => !e.est_finale);
        return [...actives, created, ...finales];
      });
      setNewLibelle("");
      setNewCouleur("#6B7280");
      setShowForm(false);
    } finally { setCreating(false); }
  };

  const etapesActives = etapes.filter(e => !e.est_finale);
  const etapesFinales = etapes.filter(e => e.est_finale);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "hsl(0 0% 0% / 0.5)" }}>
      <div className="rounded-2xl shadow-2xl w-full max-w-lg mx-4"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <Settings2 size={18} style={{ color: "hsl(var(--accent))" }} />
          <h2 className="font-semibold text-base flex-1" style={{ fontFamily: "'Poppins', sans-serif", color: "hsl(var(--foreground))" }}>
            Configurer les étapes du Kanban
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>
        </div>

        {/* Corps */}
        <div className="px-6 py-5">
          <p className="text-xs mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
            Les étapes intermédiaires apparaissent entre "En cours" et les étapes finales. Les étapes <strong>Terminée</strong> et <strong>Annulée</strong> sont fixes et restent toujours en fin de tableau.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {/* Étapes actives */}
              {etapesActives.map(e => (
                <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: e.couleur }} />
                  <span className="flex-1 text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                    {e.libelle}
                  </span>
                  {ETAPES_FIXES.includes(e.code) ? (
                    <span className="text-[10px] px-2 py-0.5 rounded"
                      style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      Fixe
                    </span>
                  ) : (
                    <button onClick={() => handleDelete(e)} disabled={saving === e.id}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                      {saving === e.id
                        ? <Loader2 size={13} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
                        : <Trash2 size={13} style={{ color: "hsl(0 70% 50%)" }} />
                      }
                    </button>
                  )}
                </div>
              ))}

              {/* Séparateur étapes finales */}
              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 border-t border-dashed" style={{ borderColor: "hsl(var(--border))" }} />
                <span className="text-[10px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                  ÉTAPES FINALES (fixes)
                </span>
                <div className="flex-1 border-t border-dashed" style={{ borderColor: "hsl(var(--border))" }} />
              </div>

              {etapesFinales.map(e => (
                <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border opacity-60"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: e.couleur }} />
                  <span className="flex-1 text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                    {e.libelle}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                    Finale
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Formulaire nouvelle étape */}
          {showForm ? (
            <div className="rounded-xl border p-4 space-y-3"
              style={{ borderColor: "hsl(var(--accent) / 0.3)", background: "hsl(var(--accent) / 0.04)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>
                Nouvelle étape
              </p>
              <input
                placeholder="Nom de l'étape (ex: En validation)"
                value={newLibelle}
                onChange={e => setNewLibelle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                autoFocus
              />
              <div>
                <p className="text-[11px] mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Couleur</p>
                <div className="flex gap-2 flex-wrap">
                  {COULEURS_PRESETS.map(c => (
                    <button key={c} onClick={() => setNewCouleur(c)}
                      className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                      style={{
                        background: c,
                        outline: newCouleur === c ? `2px solid hsl(var(--foreground))` : "none",
                        outlineOffset: 2,
                      }} />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowForm(false); setNewLibelle(""); }}
                  className="px-3 py-1.5 rounded-lg text-sm border"
                  style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  Annuler
                </button>
                <button onClick={handleCreate} disabled={creating || !newLibelle.trim()}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
                  style={{ background: "hsl(var(--accent))", color: "white", opacity: !newLibelle.trim() ? 0.5 : 1 }}>
                  {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Ajouter
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed text-sm font-medium transition-colors hover:bg-muted"
              style={{ borderColor: "hsl(var(--accent) / 0.4)", color: "hsl(var(--accent))" }}>
              <Plus size={15} /> Ajouter une étape intermédiaire
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end" style={{ borderColor: "hsl(var(--border))" }}>
          <button onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
