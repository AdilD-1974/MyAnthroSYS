/**
 * ContratForm – Formulaire complet de saisie/édition d'un contrat collaborateur.
 * Aligné sur le schéma SQL CollaborateurContrat.
 * Utilise RefSelectCreatable pour permettre la création inline de référentiels.
 * Calcule automatiquement la date de départ prévisionnelle depuis les paramètres RH.
 */
import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import RefSelectCreatable from "@/components/RefSelectCreatable";
import { X, Save, Loader2, Calculator } from "lucide-react";

interface ContratFormProps {
  collaborateurId: string;
  contrat?: any;
  onClose: () => void;
  onSaved: () => void;
}

type FormState = {
  code_type_contrat: string;
  date_debut: string;
  date_fin: string;
  societe_id: string;
  code_devise: string;
  code_temps: string;
  code_statut_contrat: string;
  reference_contrat: string;
  code_motif_recrutement: string;
  code_source_recrutement: string;
  responsable_recrutement: string;
  reference_decision_recrutement: string;
  date_titularisation: string;
  duree_contrat: string;
  code_unite_duree: string;
  date_depart_previsionnelle: string;
  motif_sortie: string;
  date_sortie: string;
  commentaire_sortie: string;
};

const EMPTY: FormState = {
  code_type_contrat: "",
  date_debut: "",
  date_fin: "",
  societe_id: "",
  code_devise: "",
  code_temps: "",
  code_statut_contrat: "ACTIF",
  reference_contrat: "",
  code_motif_recrutement: "",
  code_source_recrutement: "",
  responsable_recrutement: "",
  reference_decision_recrutement: "",
  date_titularisation: "",
  duree_contrat: "",
  code_unite_duree: "",
  date_depart_previsionnelle: "",
  motif_sortie: "",
  date_sortie: "",
  commentaire_sortie: "",
};

/** Règles par type de contrat (chargées depuis ref_type_contrat) */
interface TypeContratRule {
  code: string;
  duree_requise: boolean;
  duree_defaut_valeur: number | null;
  code_unite_duree_defaut: string | null;
  a_titularisation: boolean;
  auto_cloture: boolean;
}


const Label: React.FC<{ children: React.ReactNode; required?: boolean }> = ({ children, required }) => (
  <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
    {children}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
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
    onFocus={e => (e.currentTarget.style.borderColor = "hsl(var(--accent))")}
    onBlur={e => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
  />
);

const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    rows={3}
    className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all resize-none"
    style={{
      borderColor: "hsl(var(--border))",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
    }}
    onFocus={e => (e.currentTarget.style.borderColor = "hsl(var(--accent))")}
    onBlur={e => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
  />
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="col-span-full">
    <p className="text-xs font-bold uppercase tracking-wider pb-1 mb-2 border-b" style={{ color: "hsl(var(--accent))", borderColor: "hsl(var(--border))" }}>
      {children}
    </p>
  </div>
);

const ContratForm: React.FC<ContratFormProps> = ({ collaborateurId, contrat, onClose, onSaved }) => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [societes, setSocietes] = useState<{ value: string; label: string }[]>([]);
  const [collaborateurs, setCollaborateurs] = useState<{ value: string; label: string }[]>([]);
  const [ageRetraite, setAgeRetraite] = useState<number | null>(null);
  const [collaborateurDateNaissance, setCollaborateurDateNaissance] = useState<string | null>(null);
  const [dateFinPrevueSource, setDateFinPrevueSource] = useState<string>("");
  const [typeContratRules, setTypeContratRules] = useState<Record<string, TypeContratRule>>({});

  // Charger sociétés + collaborateurs + AGE_RETRAITE + date naissance + règles par type
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      try {
        const [societesData, collabsData, ageParam, collabNaissance, typesContrats] = await Promise.all([
          db.list<any>("societes", { actif: true }),
          db.list<any>("collaborateurs", { archive: false, order: "nom" }),
          db.findOne<any>("parametres_rh", { code: "AGE_RETRAITE" }),
          db.findOne<any>("collaborateurs", { id: collaborateurId }),
          db.list<TypeContratRule>("ref_type_contrat"),
        ]);
        if (cancelled) return;

        setSocietes((societesData || []).map((s: any) => ({
          value: s.id,
          label: s.code_societe ? `${s.code_societe} – ${s.raison_sociale}` : s.raison_sociale,
        })));
        setCollaborateurs((collabsData || []).map((c: any) => ({
          value: c.matricule,
          label: `${c.matricule} – ${c.nom} ${c.prenom}`,
        })));
        if (ageParam?.valeur) setAgeRetraite(parseInt(ageParam.valeur));
        if (collabNaissance?.date_naissance) setCollaborateurDateNaissance(collabNaissance.date_naissance);

        // Indexer les règles par code pour lookup rapide
        const rulesMap: Record<string, TypeContratRule> = {};
        (typesContrats || []).forEach((r: any) => {
          rulesMap[r.code] = {
            code: r.code,
            duree_requise: !!r.duree_requise,
            duree_defaut_valeur: r.duree_defaut_valeur ?? null,
            code_unite_duree_defaut: r.code_unite_duree_defaut ?? null,
            a_titularisation: !!r.a_titularisation,
            auto_cloture: !!r.auto_cloture,
          };
        });
        setTypeContratRules(rulesMap);
      } catch (e: any) {
        console.error("ContratForm load error:", e);
      }
    };
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [collaborateurId]);

  // Pré-remplir en mode édition
  useEffect(() => {
    if (contrat) {
      setForm({
        code_type_contrat: contrat.code_type_contrat || "",
        date_debut: contrat.date_debut || "",
        date_fin: contrat.date_fin || "",
        societe_id: contrat.societe_id || "",
        code_devise: contrat.code_devise || "",
        code_temps: contrat.code_temps || "",
        code_statut_contrat: contrat.code_statut_contrat || "ACTIF",
        reference_contrat: contrat.reference_contrat || "",
        code_motif_recrutement: contrat.code_motif_recrutement || "",
        code_source_recrutement: contrat.code_source_recrutement || "",
        responsable_recrutement: contrat.responsable_recrutement || "",
        reference_decision_recrutement: contrat.reference_decision_recrutement || "",
        date_titularisation: contrat.date_titularisation || "",
        duree_contrat: contrat.duree_contrat != null ? String(contrat.duree_contrat) : "",
        code_unite_duree: contrat.code_unite_duree || "",
        date_depart_previsionnelle: contrat.date_depart_previsionnelle || "",
        motif_sortie: contrat.motif_sortie || "",
        date_sortie: contrat.date_sortie || "",
        commentaire_sortie: contrat.commentaire_sortie || "",
      });
    }
  }, [contrat]);

  // ── Auto-fill durée/unité au changement du type, uniquement si vides ──
  // (ne pas écraser une saisie utilisateur ou une valeur reprise en édition)
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
        // CDI : si l'utilisateur change vers CDI, on vide la durée
        next.duree_contrat = "";
        next.code_unite_duree = "";
      }
      return next;
    });
  }, [form.code_type_contrat, typeContratRules]);

  /** Règle courante (peut être undefined si le type n'est pas encore chargé) */
  const currentRule = typeContratRules[form.code_type_contrat];
  const showDuree = currentRule ? currentRule.duree_requise : true;
  const showTitularisation = currentRule ? currentRule.a_titularisation : true;

  /**
   * Date de fin calculée automatiquement à partir de la durée + unité.
   * Non saisissable par l'utilisateur (règle métier).
   * Pour CDI (showDuree=false) → "" (pas de date de fin).
   */
  const dateFinCalculee = React.useMemo(() => {
    if (!showDuree || !form.date_debut || !form.duree_contrat || !form.code_unite_duree) return "";
    const n = parseInt(form.duree_contrat);
    if (!n || n <= 0) return "";
    const d = new Date(form.date_debut);
    if (isNaN(d.getTime())) return "";
    switch (form.code_unite_duree) {
      case "J": d.setDate(d.getDate() + n); break;
      case "M": d.setMonth(d.getMonth() + n); break;
      case "A": case "AN": d.setFullYear(d.getFullYear() + n); break;
      default: return "";
    }
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }, [showDuree, form.date_debut, form.duree_contrat, form.code_unite_duree]);

  // Synchronise form.date_fin avec la valeur calculée
  // (le payload de save utilise form.date_fin, donc on garde la source de vérité unique)
  useEffect(() => {
    setForm(f => f.date_fin === dateFinCalculee ? f : { ...f, date_fin: dateFinCalculee });
  }, [dateFinCalculee]);

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  /**
   * RG-CTR-03 : Calcul automatique de la Date Fin Prévue
   * Priorité :
   *  1. date_fin saisie manuellement
   *  2. date_debut + durée (si contrat non-CDI et durée renseignée)
   *  3. date_naissance + AGE_RETRAITE (si CDI)
   */
  useEffect(() => {
    const isCDI = form.code_type_contrat.toUpperCase().includes("CDI");

    // Priorité 1 : date_fin saisie
    if (form.date_fin) {
      setForm(f => ({ ...f, date_depart_previsionnelle: form.date_fin }));
      setDateFinPrevueSource("Date de fin saisie");
      return;
    }

    // Priorité 2 : date_debut + durée (non-CDI)
    if (!isCDI && form.date_debut && form.duree_contrat && form.code_unite_duree) {
      const duree = parseInt(form.duree_contrat);
      if (!isNaN(duree) && duree > 0) {
        const debut = new Date(form.date_debut);
        const fin = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate());
        const codeUnite = form.code_unite_duree.toUpperCase();
        if (codeUnite.includes("AN") || codeUnite.includes("YEAR") || codeUnite === "A") {
          fin.setFullYear(fin.getFullYear() + duree);
        } else if (codeUnite.includes("MOIS") || codeUnite.includes("MONTH") || codeUnite === "M") {
          fin.setMonth(fin.getMonth() + duree);
        } else {
          // Jours par défaut
          fin.setDate(fin.getDate() + duree);
        }
        // Dernier jour = veille de la date calculée
        fin.setDate(fin.getDate() - 1);
        const y = fin.getFullYear();
        const m = String(fin.getMonth() + 1).padStart(2, "0");
        const d = String(fin.getDate()).padStart(2, "0");
        setForm(f => ({ ...f, date_depart_previsionnelle: `${y}-${m}-${d}` }));
        setDateFinPrevueSource(`Date début + ${duree} ${form.code_unite_duree}`);
        return;
      }
    }

    // Priorité 3 : CDI → date retraite
    if (isCDI && collaborateurDateNaissance && ageRetraite) {
      const dn = new Date(collaborateurDateNaissance);
      const retraite = new Date(dn.getFullYear() + ageRetraite, dn.getMonth() + 1, 1);
      const y = retraite.getFullYear();
      const m = String(retraite.getMonth() + 1).padStart(2, "0");
      const d = String(retraite.getDate()).padStart(2, "0");
      setForm(f => ({ ...f, date_depart_previsionnelle: `${y}-${m}-${d}` }));
      setDateFinPrevueSource(`CDI : date naissance + ${ageRetraite} ans (retraite)`);
      return;
    }

    // Aucune règle applicable : vider la source si le champ est vide
    if (!form.date_depart_previsionnelle) {
      setDateFinPrevueSource("");
    }
  }, [form.date_fin, form.date_debut, form.duree_contrat, form.code_unite_duree, form.code_type_contrat, collaborateurDateNaissance, ageRetraite]);

  const handleSave = async () => {
    if (!form.code_type_contrat) { setError("Le type de contrat est obligatoire."); return; }
    if (!form.date_debut) { setError("La date de début est obligatoire."); return; }
    if (!form.code_statut_contrat) { setError("Le statut du contrat est obligatoire."); return; }
    setError(null);
    setSaving(true);

    const isNewContrat = !contrat?.id;
    const isContratEnCours = form.code_statut_contrat === "ACTIF" || form.code_statut_contrat === "EN_COURS";

    try {
      // ─────────────────────────────────────────────────────────────────────
      // RG-CTR-01 : Exclusivité du contrat actif (un seul contrat en cours)
      // Lors de la création d'un nouveau contrat en statut ACTIF ou EN_COURS,
      // tous les contrats précédents encore actifs sont automatiquement clôturés :
      //   - Statut → ECHU
      //   - date_fin → veille (J-1) de la date de début du nouveau contrat
      // Cela garantit qu'un collaborateur ne peut avoir qu'un seul contrat actif.
      // ─────────────────────────────────────────────────────────────────────
      if (isNewContrat && isContratEnCours) {
        const contratsEnCours = await db.list<any>("collaborateur_contrats", {
          collaborateur_id: collaborateurId,
          archive: false,
          code_statut_contrat: "in.(ACTIF,EN_COURS)",
        });
        if (contratsEnCours.length > 0) {
          // Date de fin du contrat précédent = veille du début du nouveau contrat
          const veilleDebut = new Date(form.date_debut);
          veilleDebut.setDate(veilleDebut.getDate() - 1);
          const veilleDateStr = veilleDebut.toISOString().split("T")[0];

          for (const c of contratsEnCours) {
            await db.update("collaborateur_contrats", { id: c.id }, {
              code_statut_contrat: "ECHU",
              date_fin: veilleDateStr,
            });
          }
        }
      }

      // Persistance du contrat (création ou modification)
      const payload: any = {
        collaborateur_id: collaborateurId,
        code_type_contrat: form.code_type_contrat,
        date_debut: form.date_debut,
        date_fin: form.date_fin || null,
        societe_id: form.societe_id || null,
        code_devise: form.code_devise || null,
        code_temps: form.code_temps || null,
        code_statut_contrat: form.code_statut_contrat,
        reference_contrat: form.reference_contrat || null,
        code_motif_recrutement: form.code_motif_recrutement || null,
        code_source_recrutement: form.code_source_recrutement || null,
        responsable_recrutement: form.responsable_recrutement || null,
        reference_decision_recrutement: form.reference_decision_recrutement || null,
        date_titularisation: form.date_titularisation || null,
        duree_contrat: form.duree_contrat ? parseInt(form.duree_contrat) : null,
        code_unite_duree: form.code_unite_duree || null,
        date_depart_previsionnelle: form.date_depart_previsionnelle || null,
        motif_sortie: form.motif_sortie || null,
        date_sortie: form.date_sortie || null,
        commentaire_sortie: form.commentaire_sortie || null,
      };

      if (contrat?.id) {
        await db.update("collaborateur_contrats", { id: contrat.id }, payload);
      } else {
        await db.create("collaborateur_contrats", payload);
      }

      // ─────────────────────────────────────────────────────────────────────
      // RG-CTR-02 : Synchronisation du statut du collaborateur
      // Le statut du collaborateur est automatiquement synchronisé selon
      // l'état de son contrat :
      //   - Si le contrat est ECHU ou que la date_fin est dépassée ET qu'aucun
      //     autre contrat actif n'existe → collaborateur passe à INACTIF
      //   - Si le contrat est ACTIF ou EN_COURS → collaborateur passe à ACTIF
      // ─────────────────────────────────────────────────────────────────────
      const statutContrat = form.code_statut_contrat;
      const dateFinPassee = form.date_fin && new Date(form.date_fin) < new Date();

      if (statutContrat === "ECHU" || (dateFinPassee && !isContratEnCours)) {
        // Vérifier qu'aucun autre contrat actif n'existe avant de désactiver le collaborateur
        const filtres: any = {
          collaborateur_id: collaborateurId,
          archive: false,
          code_statut_contrat: "in.(ACTIF,EN_COURS)",
        };
        if (contrat?.id) filtres.id = `neq.${contrat.id}`;
        const autresActifs = await db.list<any>("collaborateur_contrats", filtres);
        if (autresActifs.length === 0) {
          // Aucun contrat actif restant → le collaborateur devient INACTIF
          await db.update("collaborateurs", { id: collaborateurId }, {
            statut_collaborateur: "INACTIF",
          });
        }
      } else if (isContratEnCours) {
        // Contrat actif ou en cours → le collaborateur est ACTIF
        await db.update("collaborateurs", { id: collaborateurId }, {
          statut_collaborateur: "ACTIF",
        });
      }

      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || "Erreur inattendue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(0 0% 0% / 0.5)" }}>
      <div
        className="w-full max-w-3xl rounded-2xl border shadow-2xl flex flex-col"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <h2 className="font-semibold text-base" style={{ color: "hsl(var(--foreground))" }}>
            {contrat ? "Modifier le contrat" : "Nouveau contrat"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {/* Hint */}
          <div className="mb-4 px-3 py-2 rounded-lg text-xs flex items-center gap-2" style={{ background: "hsl(var(--accent) / 0.06)", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--accent) / 0.15)" }}>
            <span style={{ color: "hsl(var(--accent))" }}>💡</span>
            Les listes déroulantes permettent de créer un nouveau référentiel directement depuis ce formulaire via le bouton <strong>«&nbsp;Créer un nouveau référentiel&nbsp;»</strong>.
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)", border: "1px solid hsl(0 84% 55% / 0.3)" }}>
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* ── Identification du contrat ── */}
            <SectionTitle>Identification du contrat</SectionTitle>

            <RefSelectCreatable
              table="ref_type_contrat"
              valueCol="code"
              labelCol="libelle"
              value={form.code_type_contrat}
              onChange={v => set("code_type_contrat", v)}
              label="Type de contrat"
              required
            />

            <RefSelectCreatable
              table="ref_statut_contrat"
              valueCol="code"
              labelCol="libelle"
              value={form.code_statut_contrat}
              onChange={v => set("code_statut_contrat", v)}
              label="Statut du contrat"
              required
            />

            <div>
              <Label required>Date de début</Label>
              <Input type="date" value={form.date_debut} onChange={e => set("date_debut", e.target.value)} />
            </div>

            <div>
              <Label>Date de fin (calculée)</Label>
              <Input
                type="date"
                value={dateFinCalculee}
                readOnly
                disabled
                title="Calculée automatiquement à partir de la durée. Non saisissable."
              />
            </div>

            <div>
              <Label>Référence contrat</Label>
              <Input type="text" value={form.reference_contrat} onChange={e => set("reference_contrat", e.target.value)} placeholder="Ex: CTR-2025-001" />
            </div>

            <RefSelectCreatable
              table=""
              staticOptions={societes}
              value={form.societe_id}
              onChange={v => set("societe_id", v)}
              label="Société"
            />

            <RefSelectCreatable
              table="ref_temps_travail"
              valueCol="code"
              labelCol="libelle"
              value={form.code_temps}
              onChange={v => set("code_temps", v)}
              label="Temps de travail"
            />

            <RefSelectCreatable
              table="ref_devise"
              valueCol="code"
              labelCol="libelle"
              value={form.code_devise}
              onChange={v => set("code_devise", v)}
              label="Devise"
            />

            {/* ── Durée ── (masquée pour les types sans durée requise, ex: CDI) */}
            {showDuree && (
              <>
                <SectionTitle>Durée</SectionTitle>
                <div>
                  <Label>Durée du contrat</Label>
                  <Input type="number" min={0} value={form.duree_contrat} onChange={e => set("duree_contrat", e.target.value)} placeholder="Ex: 12" />
                </div>
                <RefSelectCreatable
                  table="ref_unite_duree_contrat"
                  valueCol="code"
                  labelCol="libelle"
                  value={form.code_unite_duree}
                  onChange={v => set("code_unite_duree", v)}
                  label="Unité de durée"
                />
              </>
            )}

            {/* Date de titularisation — affichée selon la règle a_titularisation du type */}
            {showTitularisation && (
              <div>
                <Label>Date de titularisation</Label>
                <Input type="date" value={form.date_titularisation} onChange={e => set("date_titularisation", e.target.value)} />
              </div>
            )}

            <div>
              <Label>Date fin prévue</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={form.date_depart_previsionnelle}
                  onChange={e => set("date_depart_previsionnelle", e.target.value)}
                />
              </div>
              {dateFinPrevueSource && (
                <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "hsl(var(--accent))" }}>
                  <Calculator size={10} />
                  {dateFinPrevueSource}
                </p>
              )}
              {!dateFinPrevueSource && (
                <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Auto-calculé depuis : date fin saisie · date début + durée · ou retraite (CDI)
                </p>
              )}
            </div>

            {/* ── Recrutement ── */}
            <SectionTitle>Recrutement</SectionTitle>

            <RefSelectCreatable
              table="ref_motif_recrutement"
              valueCol="code"
              labelCol="libelle"
              value={form.code_motif_recrutement}
              onChange={v => set("code_motif_recrutement", v)}
              label="Motif de recrutement"
            />

            <RefSelectCreatable
              table="ref_source_recrutement"
              valueCol="code"
              labelCol="libelle"
              value={form.code_source_recrutement}
              onChange={v => set("code_source_recrutement", v)}
              label="Source de recrutement"
            />

            <RefSelectCreatable
              table=""
              staticOptions={collaborateurs}
              value={form.responsable_recrutement}
              onChange={v => set("responsable_recrutement", v)}
              label="Responsable recrutement"
            />

            <div>
              <Label>Réf. décision de recrutement</Label>
              <Input type="text" value={form.reference_decision_recrutement} onChange={e => set("reference_decision_recrutement", e.target.value)} />
            </div>

            {/* ── Sortie ── */}
            <SectionTitle>Sortie</SectionTitle>

            <RefSelectCreatable
              table="ref_motif_sortie"
              valueCol="code"
              labelCol="libelle"
              value={form.motif_sortie}
              onChange={v => set("motif_sortie", v)}
              label="Motif de sortie"
            />

            <div>
              <Label>Date de sortie</Label>
              <Input type="date" value={form.date_sortie} onChange={e => set("date_sortie", e.target.value)} />
            </div>

            <div className="col-span-full">
              <Label>Commentaire de sortie</Label>
              <Textarea value={form.commentaire_sortie} onChange={e => set("commentaire_sortie", e.target.value)} placeholder="Observations sur la sortie..." />
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "hsl(var(--accent))", color: "white", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContratForm;
