/**
 * ProcessusDepartConfig — Configuration des processus de départ (RH/admin).
 * Intégré comme catégorie "Processus de départ" dans ParametresRHPage.
 *
 * Backend : /depart-processus (GET liste, GET /catalogue, POST, PUT /{id}, DELETE /{id})
 */
import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  Workflow, Plus, Trash2, Check, Loader2, ChevronUp, ChevronDown,
  GripVertical, X, ListChecks, ShieldCheck, PencilLine, Save,
} from "lucide-react";

type EtapeType = "CHECKLIST" | "VALIDATION" | "SAISIE";

interface CatalogueItem { code: string; libelle: string; type: string; }
interface Traitement { code_traitement: string; libelle: string; obligatoire: boolean; ordre?: number; }
interface Etape {
  id?: string; code: string; libelle: string; description?: string | null;
  type: EtapeType; validation_role?: string | null; ordre?: number; traitements: Traitement[];
}
interface Processus {
  id: string; code: string; libelle: string; description?: string | null;
  actif: boolean; ordre: number; etapes: Etape[];
}

const ROLES = [
  { v: "gestionnaire_rh", l: "Gestionnaire RH" },
  { v: "administrateur", l: "Administrateur" },
  { v: "gestionnaire_paie", l: "Gestionnaire Paie" },
  { v: "manager", l: "Manager" },
];

const TYPE_META: Record<EtapeType, { label: string; icon: React.ReactNode; color: string }> = {
  CHECKLIST: { label: "Check-list", icon: <ListChecks size={13} />, color: "hsl(210 70% 50%)" },
  SAISIE: { label: "Saisie", icon: <PencilLine size={13} />, color: "hsl(265 60% 55%)" },
  VALIDATION: { label: "Validation", icon: <ShieldCheck size={13} />, color: "hsl(150 55% 42%)" },
};

const ProcessusDepartConfig: React.FC = () => {
  const { role } = useAuth();
  const roleQ = `?role_actif=${encodeURIComponent(role || "")}`;
  const canEdit = role === "gestionnaire_rh" || role === "administrateur";

  const [procs, setProcs] = useState<Processus[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Processus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingTraitFor, setAddingTraitFor] = useState<number | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [p, c] = await Promise.all([
        api.get<Processus[]>("/depart-processus"),
        api.get<CatalogueItem[]>("/depart-processus/catalogue"),
      ]);
      setProcs(p || []); setCatalogue(c || []);
      if (selectedId) {
        const found = (p || []).find(x => x.id === selectedId);
        setDraft(found ? structuredClone(found) : null);
      }
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const selectProc = (p: Processus) => { setSelectedId(p.id); setDraft(structuredClone(p)); setError(null); setAddingTraitFor(null); };

  const creer = async () => {
    setError(null);
    const code = prompt("Code du processus (ex. RETRAITE) :")?.trim().toUpperCase();
    if (!code) return;
    const libelle = prompt("Libellé du processus :")?.trim();
    if (!libelle) return;
    try {
      const created = await api.post<Processus>("/depart-processus" + roleQ, { code, libelle });
      await load();
      setSelectedId(created.id);
      setDraft(structuredClone(created));
    } catch (e: any) { setError(e?.message ?? "Création impossible"); }
  };

  const supprimer = async (id: string) => {
    if (!confirm("Supprimer ce processus et toute sa configuration ?")) return;
    try {
      await api.delete("/depart-processus/" + id + roleQ);
      if (selectedId === id) { setSelectedId(null); setDraft(null); }
      load();
    } catch (e: any) { setError(e?.message ?? "Suppression impossible"); }
  };

  const enregistrer = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const saved = await api.put<Processus>("/depart-processus/" + draft.id + roleQ, {
        libelle: draft.libelle, description: draft.description, actif: draft.actif, ordre: draft.ordre,
        etapes: draft.etapes.map((e, i) => ({
          code: e.code || `E${i + 1}`, libelle: e.libelle, description: e.description,
          type: e.type, validation_role: e.type === "VALIDATION" ? e.validation_role : null, ordre: i,
          traitements: e.traitements.map((t, j) => ({
            code_traitement: t.code_traitement, libelle: t.libelle, obligatoire: t.obligatoire, ordre: j,
          })),
        })),
      });
      setDraft(structuredClone(saved));
      load();
    } catch (e: any) { setError(e?.message ?? "Enregistrement impossible"); }
    finally { setSaving(false); }
  };

  // ── Mutations locales du draft ──
  const upd = (fn: (d: Processus) => void) => setDraft(prev => { if (!prev) return prev; const c = structuredClone(prev); fn(c); return c; });
  const addEtape = () => upd(d => d.etapes.push({ code: `E${d.etapes.length + 1}`, libelle: "Nouvelle étape", type: "CHECKLIST", traitements: [] }));
  const removeEtape = (i: number) => upd(d => d.etapes.splice(i, 1));
  const moveEtape = (i: number, dir: -1 | 1) => upd(d => {
    const j = i + dir; if (j < 0 || j >= d.etapes.length) return;
    [d.etapes[i], d.etapes[j]] = [d.etapes[j], d.etapes[i]];
  });
  const addTraitement = (ei: number, code: string) => upd(d => {
    const cat = catalogue.find(c => c.code === code); if (!cat) return;
    if (d.etapes[ei].traitements.some(t => t.code_traitement === code)) return;
    d.etapes[ei].traitements.push({ code_traitement: code, libelle: cat.libelle, obligatoire: true });
  });
  const removeTraitement = (ei: number, ti: number) => upd(d => d.etapes[ei].traitements.splice(ti, 1));
  const toggleOblig = (ei: number, ti: number) => upd(d => { const t = d.etapes[ei].traitements[ti]; t.obligatoire = !t.obligatoire; });

  const usedCodes = (ei: number) => new Set(draft?.etapes[ei].traitements.map(t => t.code_traitement) || []);

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} /></div>;

  if (!canEdit) return (
    <div className="rounded-xl border p-6 text-sm" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
      La configuration des processus de départ est réservée au gestionnaire RH et à l'administrateur.
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)", border: "1px solid hsl(0 84% 55% / 0.3)" }}>{error}</div>
      )}

      {/* Liste des processus */}
      <div className="flex items-center gap-2 flex-wrap">
        {procs.map(p => (
          <button key={p.id} onClick={() => selectProc(p)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all border"
            style={{
              background: selectedId === p.id ? "hsl(var(--accent))" : "hsl(var(--muted) / 0.4)",
              color: selectedId === p.id ? "white" : "hsl(var(--foreground))",
              borderColor: selectedId === p.id ? "hsl(var(--accent))" : "hsl(var(--border))",
            }}>
            <Workflow size={13} /> {p.libelle}
            <span className="text-[10px] opacity-70">({p.etapes?.length ?? 0})</span>
            {!p.actif && <span className="text-[9px] px-1 rounded" style={{ background: "hsl(var(--muted))" }}>inactif</span>}
          </button>
        ))}
        <button onClick={creer} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
          <Plus size={13} /> Nouveau processus
        </button>
      </div>

      {!draft ? (
        <div className="rounded-xl border p-8 text-center text-sm" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          Sélectionnez un processus à configurer, ou créez-en un nouveau.
        </div>
      ) : (
        <div className="rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          {/* En-tête éditeur */}
          <div className="p-4 border-b flex items-start justify-between gap-3" style={{ borderColor: "hsl(var(--border))" }}>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé</label>
                <input value={draft.libelle} onChange={e => upd(d => { d.libelle = e.target.value; })}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Description</label>
                <input value={draft.description || ""} onChange={e => upd(d => { d.description = e.target.value; })}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
              </div>
              <label className="flex items-center gap-2 text-xs" style={{ color: "hsl(var(--foreground))" }}>
                <input type="checkbox" checked={draft.actif} onChange={e => upd(d => { d.actif = e.target.checked; })} />
                Processus actif
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded ml-2" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>{draft.code}</span>
              </label>
            </div>
            <button onClick={() => supprimer(draft.id)} title="Supprimer le processus"
              className="p-2 rounded-lg" style={{ color: "hsl(0 84% 55%)" }}>
              <Trash2 size={15} />
            </button>
          </div>

          {/* Étapes */}
          <div className="p-4 space-y-3">
            {draft.etapes.length === 0 && (
              <p className="text-sm text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune étape. Ajoutez-en une.</p>
            )}
            {draft.etapes.map((e, ei) => {
              const meta = TYPE_META[e.type];
              return (
                <div key={ei} className="rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                  <div className="p-3 flex items-center gap-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="flex flex-col">
                      <button onClick={() => moveEtape(ei, -1)} className="p-0.5" style={{ color: "hsl(var(--muted-foreground))" }}><ChevronUp size={13} /></button>
                      <button onClick={() => moveEtape(ei, 1)} className="p-0.5" style={{ color: "hsl(var(--muted-foreground))" }}><ChevronDown size={13} /></button>
                    </div>
                    <span className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0"
                      style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>{ei + 1}</span>
                    <input value={e.libelle} onChange={ev => upd(d => { d.etapes[ei].libelle = ev.target.value; })}
                      className="flex-1 px-2 py-1.5 rounded-lg border text-sm font-medium outline-none"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
                    <select value={e.type} onChange={ev => upd(d => { d.etapes[ei].type = ev.target.value as EtapeType; })}
                      className="px-2 py-1.5 rounded-lg border text-xs outline-none"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: meta.color }}>
                      <option value="CHECKLIST">Check-list</option>
                      <option value="SAISIE">Saisie</option>
                      <option value="VALIDATION">Validation</option>
                    </select>
                    {e.type === "VALIDATION" && (
                      <select value={e.validation_role || ""} onChange={ev => upd(d => { d.etapes[ei].validation_role = ev.target.value; })}
                        className="px-2 py-1.5 rounded-lg border text-xs outline-none"
                        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
                        <option value="">Rôle validateur…</option>
                        {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                      </select>
                    )}
                    <button onClick={() => removeEtape(ei)} className="p-1.5 rounded" style={{ color: "hsl(0 84% 55%)" }}><Trash2 size={13} /></button>
                  </div>

                  {/* Traitements de l'étape */}
                  <div className="p-3 space-y-1.5">
                    {e.type === "VALIDATION" ? (
                      <p className="text-xs flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                        <ShieldCheck size={13} style={{ color: meta.color }} />
                        Étape validée d'un clic par {ROLES.find(r => r.v === e.validation_role)?.l || "le rôle requis"}.
                      </p>
                    ) : (
                      <>
                        {e.traitements.length === 0 && (
                          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun traitement. Ajoutez-en depuis le catalogue.</p>
                        )}
                        {e.traitements.map((t, ti) => (
                          <div key={ti} className="flex items-center gap-2 text-sm">
                            <span className="flex-1 truncate" style={{ color: "hsl(var(--foreground))" }}>{t.libelle}
                              <span className="font-mono text-[10px] ml-2" style={{ color: "hsl(var(--muted-foreground))" }}>{t.code_traitement}</span>
                            </span>
                            <button onClick={() => toggleOblig(ei, ti)}
                              className="text-[10px] px-2 py-0.5 rounded-full"
                              style={{ background: t.obligatoire ? "hsl(var(--accent) / 0.12)" : "hsl(var(--muted) / 0.5)", color: t.obligatoire ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>
                              {t.obligatoire ? "Obligatoire" : "Facultatif"}
                            </button>
                            <button onClick={() => removeTraitement(ei, ti)} className="p-1 rounded" style={{ color: "hsl(0 84% 55%)" }}><X size={13} /></button>
                          </div>
                        ))}

                        {addingTraitFor === ei ? (
                          <select autoFocus value="" onChange={ev => { if (ev.target.value) { addTraitement(ei, ev.target.value); setAddingTraitFor(null); } }}
                            onBlur={() => setAddingTraitFor(null)}
                            className="mt-1 px-2 py-1.5 rounded-lg border text-xs outline-none"
                            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
                            <option value="">Choisir un traitement…</option>
                            {catalogue.filter(c => !usedCodes(ei).has(c.code)).map(c => (
                              <option key={c.code} value={c.code}>{c.libelle} ({c.type})</option>
                            ))}
                          </select>
                        ) : (
                          <button onClick={() => setAddingTraitFor(ei)}
                            className="mt-1 flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                            style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                            <Plus size={12} /> Ajouter un traitement
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            <button onClick={addEtape}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed text-sm"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
              <Plus size={14} /> Ajouter une étape
            </button>
          </div>

          {/* Pied : enregistrer */}
          <div className="p-4 border-t flex items-center justify-end gap-2" style={{ borderColor: "hsl(var(--border))" }}>
            <button onClick={() => selectProc(procs.find(p => p.id === draft.id) || draft)}
              className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              Réinitialiser
            </button>
            <button onClick={enregistrer} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Enregistrement…" : "Enregistrer le processus"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessusDepartConfig;
