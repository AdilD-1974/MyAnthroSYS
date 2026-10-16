// ============================================================
// GestionEnfantsPage.tsx — src/pages/famille/GestionEnfantsPage.tsx
// Premier écran piloté par schéma : gestion des enfants d'un
// collaborateur, rendu via DynamicForm. Tout en tokens (Apparence).
// ============================================================

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Baby, Plus, Pencil, Archive, Loader2, X } from "lucide-react";
import DynamicForm, { type FormSchema } from "@/components/dynamic/DynamicForm";

// ─── Schéma de l'entité (futur : stocké en base / produit par le designer) ───
const ENFANT_SCHEMA: FormSchema = {
  code: "collaborateur_enfants",
  titre: "Enfant",
  entite: "collaborateur_enfants",
  sections: [
    {
      id: "identite", titre: "Identité", icone: "User", colonnes: 3,
      champs: [
        { id: "f_nom",    source: "nom",            label: "Nom",              type: "text" },
        { id: "f_pre",    source: "prenom",         label: "Prénom",           type: "text", obligatoire: true },
        { id: "f_dn",     source: "date_naissance", label: "Date de naissance",type: "date", obligatoire: true },
        { id: "f_lieu",   source: "lieu_naissance", label: "Lieu de naissance",type: "text" },
        { id: "f_genre",  source: "code_genre",     label: "Genre",            type: "select", obligatoire: true,
          refTable: "ref_genre", refValueCol: "code", refLabelCol: "libelle" },
        { id: "f_nat",    source: "code_nationalite", label: "Nationalité",    type: "select",
          refTable: "ref_nationalite", refValueCol: "code", refLabelCol: "libelle" },
      ],
    },
    {
      id: "statut", titre: "Statut & prise en charge", icone: "Shield", colonnes: 3,
      champs: [
        // ⚠️ code_statut : à passer en select dès que sa table de référence est connue
        { id: "f_stat",   source: "code_statut",   label: "Statut",            type: "select", obligatoire: true,
          options: [{ value: "ACTIF", label: "Actif" }] },
        { id: "f_pc",     source: "est_pris_en_charge", label: "À charge",      type: "boolean" },
        { id: "f_pcfin",  source: "date_fin_prise_en_charge", label: "Fin de prise en charge", type: "date" },
        { id: "f_couv",   source: "couverture_medicale", label: "Couverture médicale", type: "text" },
        { id: "f_hand",   source: "handicap",       label: "Situation de handicap", type: "boolean" },
        { id: "f_hcode",  source: "code_handicap",  label: "Type de handicap", type: "select",
          refTable: "ref_type_handicap", refValueCol: "code", refLabelCol: "libelle" },
      ],
    },
    {
      id: "scolarite", titre: "Scolarité", icone: "GraduationCap", colonnes: 3,
      champs: [
        { id: "f_sco",    source: "est_scolarise",  label: "Scolarisé", type: "boolean" },
        { id: "f_etab",   source: "etablissement_scolaire", label: "Établissement", type: "text" },
        { id: "f_niv",    source: "niveau_scolaire", label: "Niveau", type: "text" },
        { id: "f_scod",   source: "date_debut_scolarite", label: "Début de scolarité", type: "date" },
        { id: "f_scof",   source: "date_fin_scolarite",   label: "Fin de scolarité",   type: "date" },
      ],
    },
    {
      id: "autres", titre: "Autres informations", icone: "FileText", colonnes: 1,
      champs: [
        { id: "f_dec",    source: "date_deces",    label: "Date de décès", type: "date" },
        { id: "f_obs",    source: "observations",  label: "Observations",  type: "textarea" },
      ],
    },
  ],
};

const COLS = "id,collaborateur_id,nom,prenom,date_naissance,code_genre,code_statut," +
  "est_pris_en_charge,est_scolarise,handicap,archive";

const fdate = (v?: string | null) => {
  if (!v) return "—";
  try { return format(parseISO(v), "dd/MM/yyyy", { locale: fr }); } catch { return v; }
};
const ouiNon = (v: boolean) =>
  <span style={{ color: v ? "hsl(142 55% 38%)" : "hsl(var(--muted-foreground))", fontWeight: v ? 600 : 400 }}>{v ? "Oui" : "Non"}</span>;

export default function GestionEnfantsPage() {
  const [collabs, setCollabs] = useState<any[]>([]);
  const [collabId, setCollabId] = useState<string>("");
  const [enfants, setEnfants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<null | { recordId?: string }>(null);

  // Charger les collaborateurs (sélecteur)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("collaborateurs").select("id,matricule,nom,prenom");
      const list = (data || []).slice().sort((a: any, b: any) =>
        `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`));
      setCollabs(list);
    })();
  }, []);

  const chargerEnfants = async (cid: string) => {
    if (!cid) { setEnfants([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from("collaborateur_enfants").select(COLS)
      .eq("collaborateur_id", cid).eq("archive", false);
    const list = (data || []).slice().sort((a: any, b: any) =>
      (a.date_naissance || "").localeCompare(b.date_naissance || ""));
    setEnfants(list);
    setLoading(false);
  };

  useEffect(() => { chargerEnfants(collabId); /* eslint-disable-next-line */ }, [collabId]);

  const archiver = async (id: string) => {
    await supabase.from("collaborateur_enfants").update({ archive: true }).eq("id", id);
    chargerEnfants(collabId);
  };

  const collabLabel = useMemo(() => {
    const c = collabs.find(x => x.id === collabId);
    return c ? `${c.prenom} ${c.nom}` : "";
  }, [collabs, collabId]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Gestion des enfants</span>
      </div>
      <div style={{ borderBottom: "1px solid hsl(var(--border))" }} />

      <div className="p-6">
      <p className="text-sm mb-5" style={{ color: "hsl(var(--muted-foreground))" }}>
        Sélectionnez un collaborateur pour gérer ses enfants.
      </p>

      {/* Sélecteur de collaborateur */}
      <div className="mb-5 max-w-md">
        <label className="text-xs font-medium block mb-1" style={{ color: "hsl(var(--foreground))" }}>Collaborateur</label>
        <select value={collabId} onChange={e => setCollabId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: "hsl(var(--background))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))" }}>
          <option value="">— Choisir —</option>
          {collabs.map(c => (
            <option key={c.id} value={c.id}>{c.matricule ? `${c.matricule} · ` : ""}{c.nom} {c.prenom}</option>
          ))}
        </select>
      </div>

      {collabId && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ background: "hsl(var(--muted) / 0.2)" }}>
            <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
              Enfants de {collabLabel} <span style={{ color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>({enfants.length})</span>
            </span>
            <button onClick={() => setModal({})}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              <Plus size={15} /> Ajouter
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              <Loader2 size={15} className="animate-spin" /> Chargement…
            </div>
          ) : enfants.length === 0 ? (
            <div className="p-6 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun enfant enregistré.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted) / 0.1)" }}>
                  <th className="text-left font-medium px-4 py-2">Nom &amp; prénom</th>
                  <th className="text-left font-medium px-4 py-2">Naissance</th>
                  <th className="text-left font-medium px-4 py-2">Genre</th>
                  <th className="text-center font-medium px-4 py-2">À charge</th>
                  <th className="text-center font-medium px-4 py-2">Scolarisé</th>
                  <th className="text-center font-medium px-4 py-2">Handicap</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {enfants.map(e => (
                  <tr key={e.id} style={{ borderTop: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                    <td className="px-4 py-2.5">{[e.nom, e.prenom].filter(Boolean).join(" ")}</td>
                    <td className="px-4 py-2.5">{fdate(e.date_naissance)}</td>
                    <td className="px-4 py-2.5">{(() => { const g = (e.code_genre || "").trim(); return g === "H" ? "Masculin" : g === "F" ? "Féminin" : g; })()}</td>
                    <td className="px-4 py-2.5 text-center">{ouiNon(!!e.est_pris_en_charge)}</td>
                    <td className="px-4 py-2.5 text-center">{ouiNon(!!e.est_scolarise)}</td>
                    <td className="px-4 py-2.5 text-center">{ouiNon(!!e.handicap)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setModal({ recordId: e.id })} title="Modifier"
                          className="p-1.5 rounded-lg" style={{ color: "hsl(var(--muted-foreground))" }}
                          onMouseEnter={ev => (ev.currentTarget.style.background = "hsl(var(--accent) / 0.5)")}
                          onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}>
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => archiver(e.id)} title="Archiver"
                          className="p-1.5 rounded-lg" style={{ color: "hsl(var(--destructive))" }}
                          onMouseEnter={ev => (ev.currentTarget.style.background = "hsl(var(--destructive) / 0.1)")}
                          onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}>
                          <Archive size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal ajout / édition */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(0 0% 0% / 0.5)" }} onClick={() => setModal(null)}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl"
            style={{ background: "hsl(var(--background))" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
              <h3 className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>
                {modal.recordId ? "Modifier l'enfant" : "Nouvel enfant"} — {collabLabel}
              </h3>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
            </div>
            <div className="p-6">
              <DynamicForm
                schema={ENFANT_SCHEMA}
                recordId={modal.recordId}
                defaults={{ collaborateur_id: collabId, ...(modal.recordId ? {} : { code_statut: "ACTIF" }) }}
                onCancel={() => setModal(null)}
                onSaved={() => { setModal(null); chargerEnfants(collabId); }}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
