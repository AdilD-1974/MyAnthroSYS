/**
 * DeclarationIrPage.tsx — Déclaration IR / État 9421 (DTS)
 *
 * Notes d'intégration confirmées le 20/08 via le vrai src/lib/api.ts :
 *   - `api` (get/post/patch/put/delete) et `postForBlob` (export nommé
 *     séparé, PAS api.postForBlob) — vérifiés directement dans api.ts.
 *   - Les couleurs utilisent les variables CSS du thème
 *     (`--info`, `--accent`, `--success`, `--destructive`,
 *     `--muted-foreground`, `--border`, `--background`), conformément à
 *     la règle "pas de couleur Tailwind en dur".
 *   - Toutes les tailles de police passent par `var(--font-scale)`
 *     (comme dans ReferentielsPage.tsx) plutôt que par les classes
 *     Tailwind text-xs/text-sm figées, pour respecter les réglages
 *     d'apparence de l'utilisateur (AppearancePage).
 *   - Pas de `max-w-7xl mx-auto` sur le conteneur racine (pleine largeur,
 *     cf. correction faite sur l'écran CNSS).
 *   - Aucune route/menu dédié pour l'Historique pour l'instant : toggle
 *     interne, comme pour la CNSS.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api, postForBlob } from "@/lib/api"; // ✅ confirmé via api.ts le 20/08

/* ─────────────────── Échelle de police (respect AppearancePage) ─────────────────── */
const FS_XS = "calc(11px * var(--font-scale))";
const FS_SM = "calc(13px * var(--font-scale))";
const FS_LG = "calc(16px * var(--font-scale))";
const FS_XL = "calc(20px * var(--font-scale))";

/* ─────────────────── Types ─────────────────── */

interface LigneIr {
  id: string;
  collaborateur_id: string;
  type_personnel: "PERMANENT" | "OCCASIONNEL" | "STAGIAIRE_ANAPEC" | null;
  nom: string;
  prenom: string;
  cin: string | null;
  cnss: string | null;
  nb_mois_travailles: number;
  salaire_brut: number;
  elements_exoneres: number;
  salaire_brut_imposable: number;
  frais_professionnels: number;
  cotisation_assurance: number;
  revenu_net_imposable: number;
  ir_preleve: number;
  nombre_deductions: number;
  nb_mois_bulletin_manquant: number;
}

interface KpisIr {
  declaration_id: string;
  statut: string;
  total_lignes: number;
  sans_cin: number;
  sans_cnss: number;
  sans_categorie_dts: number;
  lignes_avec_mois_manquants: number;
  total_salaire_brut: number;
  total_brut_imposable: number;
  total_ir_preleve: number;
  total_cotisation_assurance: number;
  bloquant: boolean;
}

interface DeclarationHistorique {
  id: string;
  annee: number;
  statut: "GENEREE" | "CONTROLEE" | "DEPOSEE" | "ARCHIVEE";
  nombre_total_salaries: number;
  montant_total_ir: number;
  fichier_xml_path: string | null;
  created_at: string;
  updated_at: string;
}

interface LigneComposition {
  code_rubrique_paie: string;
  libelle_rubrique_paie: string;
  attribut: "montant" | "nombre" | "taux";
  signe: "+" | "-";
}

interface ConstanteIr {
  code_constante: string;
  libelle: string;
  lignes: LigneComposition[];
}

interface RubriquePaie {
  code: string;
  libelle: string;
}

interface MappingExoneration {
  code_rubrique_paie: string;
  libelle_rubrique: string;
  code_dgi: string;
  libelle_dgi: string;
  signe: "+" | "-";
}

interface CodeDgi {
  code: string;
  libelle: string;
}

interface ParametrageIr {
  constantes: ConstanteIr[];
  rubriques_disponibles: RubriquePaie[];
  mappings_exoneration: MappingExoneration[];
  codes_dgi: CodeDgi[];
}

type Etape = "parametrage" | "alimentation" | "controle" | "generation";

const STATUT_COLORS: Record<string, string> = {
  GENEREE: "hsl(var(--info))",
  CONTROLEE: "hsl(var(--accent))",
  DEPOSEE: "hsl(var(--success))",
  ARCHIVEE: "hsl(var(--muted-foreground))",
};

const STATUT_LABELS: Record<string, string> = {
  GENEREE: "Générée",
  CONTROLEE: "Contrôlée",
  DEPOSEE: "Déposée",
  ARCHIVEE: "Archivée",
};

const fmtMontant = (v: number) =>
  new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

/* ─────────────────── Composant ─────────────────── */

/* ─────────────────── Sous-composant en-tête triable ─────────────────── */

const EnteteTriable: React.FC<{
  label: string;
  actif: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}> = ({ label, actif, direction, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-1 font-semibold uppercase transition-all"
    style={{ color: actif ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}
  >
    {label}
    {actif ? (
      direction === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
    ) : (
      <ChevronDown size={12} style={{ opacity: 0.3 }} />
    )}
  </button>
);

const DeclarationIrPage: React.FC = () => {
  const [ongletActif, setOngletActif] = useState<"encours" | "historique">("encours");
  const [annee, setAnnee] = useState<number>(new Date().getFullYear() - 1);
  const [etape, setEtape] = useState<Etape>("parametrage");

  const [lignes, setLignes] = useState<LigneIr[]>([]);
  const [kpis, setKpis] = useState<KpisIr | null>(null);
  const [historique, setHistorique] = useState<DeclarationHistorique[]>([]);
  const [parametrage, setParametrage] = useState<ParametrageIr | null>(null);
  const [nouvelleExoneration, setNouvelleExoneration] = useState<{ code_rubrique_paie: string; code_dgi: string; signe: string }>({
    code_rubrique_paie: "",
    code_dgi: "",
    signe: "+",
  });

  const [triExoneration, setTriExoneration] = useState<{ colonne: "signe" | "rubrique" | "code_dgi"; direction: "asc" | "desc" }>({
    colonne: "rubrique",
    direction: "asc",
  });

  const trierExoneration = (colonne: "signe" | "rubrique" | "code_dgi") => {
    setTriExoneration((prev) =>
      prev.colonne === colonne
        ? { colonne, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { colonne, direction: "asc" }
    );
  };

  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [bulletinsParPlan, setBulletinsParPlan] = useState<Record<string, number>>({});
  const [modeConsultation, setModeConsultation] = useState(false);
  const [filtreKpi, setFiltreKpi] = useState<
    "sans_cin" | "sans_cnss" | "sans_categorie" | "mois_manquants" | null
  >(null);
  const [accordeonOuvert, setAccordeonOuvert] = useState<Record<string, boolean>>({
    constantes: true,
    exonerations: false,
  });

  const toggleAccordeon = (cle: string) =>
    setAccordeonOuvert((prev) => ({ ...prev, [cle]: !prev[cle] }));

  /* ---------- Chargement ---------- */

  const chargerDeclaration = useCallback(async (a: number) => {
    setChargement(true);
    setErreur(null);
    try {
      const k = await api.get(`/paie/declarations/ir/${a}/kpis`).catch(() => null);
      if (k) {
        setKpis(k);
        setModeConsultation(k.statut === "ARCHIVEE");
        const l = await api.get(`/paie/declarations/ir/${a}/lignes`);
        setLignes(l);
        setEtape("controle");
      } else {
        setKpis(null);
        setLignes([]);
        setEtape("parametrage");
      }
    } catch (e: any) {
      setErreur(e?.message || "Erreur de chargement de la déclaration IR.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (ongletActif === "encours") chargerDeclaration(annee);
  }, [annee, ongletActif, chargerDeclaration]);

  const chargerHistorique = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const h = await api.get("/paie/declarations/ir/historique");
      setHistorique(h);
    } catch (e: any) {
      setErreur(e?.message || "Erreur de chargement de l'historique.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (ongletActif === "historique") chargerHistorique();
  }, [ongletActif, chargerHistorique]);

  const chargerParametrage = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const p = await api.get("/paie/declarations/ir/parametrage");
      setParametrage(p);
    } catch (e: any) {
      setErreur(e?.message || "Erreur de chargement du paramétrage.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (ongletActif === "encours" && etape === "parametrage") chargerParametrage();
  }, [ongletActif, etape, chargerParametrage]);

  /* ---------- Actions paramétrage ---------- */

  const [nouvelleLigneParConstante, setNouvelleLigneParConstante] = useState<
    Record<string, { code_rubrique_paie: string; attribut: string; signe: string }>
  >({});
  const [ajoutOuvertParConstante, setAjoutOuvertParConstante] = useState<Record<string, boolean>>({});

  const toggleAjout = (code_constante: string) =>
    setAjoutOuvertParConstante((prev) => ({ ...prev, [code_constante]: !prev[code_constante] }));

  const getNouvelleLigne = (code_constante: string) =>
    nouvelleLigneParConstante[code_constante] || { code_rubrique_paie: "", attribut: "montant", signe: "+" };

  const setNouvelleLigne = (code_constante: string, patch: Partial<{ code_rubrique_paie: string; attribut: string; signe: string }>) => {
    setNouvelleLigneParConstante((prev) => ({
      ...prev,
      [code_constante]: { ...getNouvelleLigne(code_constante), ...patch },
    }));
  };

  const ajouterRubriqueLigne = async (code_constante: string) => {
    const saisie = getNouvelleLigne(code_constante);
    if (!saisie.code_rubrique_paie) return;
    setErreur(null);
    try {
      await api.post("/paie/declarations/ir/parametrage/rubrique-ligne", {
        code_constante,
        code_rubrique_paie: saisie.code_rubrique_paie,
        attribut: saisie.attribut,
        signe: saisie.signe,
      });
      setNouvelleLigneParConstante((prev) => ({ ...prev, [code_constante]: { code_rubrique_paie: "", attribut: "montant", signe: "+" } }));
      await chargerParametrage();
    } catch (e: any) {
      setErreur(e?.message || `Erreur lors de l'ajout de la ligne sur ${code_constante}.`);
    }
  };

  const supprimerRubriqueLigne = async (code_constante: string, code_rubrique_paie: string) => {
    setErreur(null);
    try {
      await api.delete(`/paie/declarations/ir/parametrage/rubrique-ligne/${code_constante}/${code_rubrique_paie}`);
      await chargerParametrage();
    } catch (e: any) {
      setErreur(e?.message || "Erreur lors de la suppression de la ligne.");
    }
  };

  const ajouterExoneration = async () => {
    if (!nouvelleExoneration.code_rubrique_paie || !nouvelleExoneration.code_dgi) return;
    setErreur(null);
    try {
      await api.post("/paie/declarations/ir/parametrage/exoneration", nouvelleExoneration);
      setNouvelleExoneration({ code_rubrique_paie: "", code_dgi: "", signe: "+" });
      await chargerParametrage();
    } catch (e: any) {
      setErreur(e?.message || "Erreur lors de l'ajout du mapping.");
    }
  };

  const supprimerExoneration = async (code_rubrique_paie: string) => {
    setErreur(null);
    try {
      await api.delete(`/paie/declarations/ir/parametrage/exoneration/${code_rubrique_paie}`);
      await chargerParametrage();
    } catch (e: any) {
      setErreur(e?.message || "Erreur lors de la suppression du mapping.");
    }
  };

  /* ---------- Actions ---------- */

  const alimenterAutomatiquement = async () => {
    setChargement(true);
    setErreur(null);
    setAvertissements([]);
    setBulletinsParPlan({});
    try {
      const result = await api.post(`/paie/declarations/ir/${annee}/alimenter`, {});
      setAvertissements(result.avertissements || []);
      setBulletinsParPlan(result.bulletins_par_plan || {});
      const k = await api.get(`/paie/declarations/ir/${annee}/kpis`);
      const l = await api.get(`/paie/declarations/ir/${annee}/lignes`);
      setKpis(k);
      setLignes(l);
      setFiltreKpi(null);
      setEtape("controle");
    } catch (e: any) {
      setErreur(e?.message || "Erreur lors de l'alimentation automatique.");
    } finally {
      setChargement(false);
    }
  };

  const genererXml = async () => {
    setChargement(true);
    setErreur(null);
    try {
      // ✅ postForBlob est un export nommé de api.ts, pas api.postForBlob
      const blob = await postForBlob(`/paie/declarations/ir/${annee}/generer-xml`, {});
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${annee}_DTS_9421.xml`;
      a.click();
      window.URL.revokeObjectURL(url);
      setEtape("generation");
      await chargerDeclaration(annee);
    } catch (e: any) {
      setErreur(e?.message || "Erreur lors de la génération du fichier XML.");
    } finally {
      setChargement(false);
    }
  };

  const ouvrirDepuisHistorique = (d: DeclarationHistorique) => {
    setAnnee(d.annee);
    setOngletActif("encours");
  };

  /* ---------- Rendu ---------- */

  const etapes: { id: Etape; label: string }[] = [
    { id: "parametrage", label: "1. Paramétrage" },
    { id: "alimentation", label: "2. Alimentation" },
    { id: "controle", label: "3. Contrôle" },
    { id: "generation", label: "4. Génération XML" },
  ];

  return (
    <div className="w-full px-6 py-4" style={{ background: "hsl(var(--background))" }}>
      <h1 className="font-bold mb-4" style={{ color: "hsl(var(--foreground))", fontSize: FS_XL }}>
        Déclaration IR — État 9421
      </h1>

      {/* Onglets */}
      <div className="flex items-center border-b mb-4" style={{ borderColor: "hsl(var(--border))" }}>
        <button
          onClick={() => setOngletActif("encours")}
          className="px-4 py-2.5 font-semibold transition-all"
          style={{
            fontSize: FS_SM,
            borderBottom: ongletActif === "encours" ? "2px solid hsl(var(--accent))" : "2px solid transparent",
            color: ongletActif === "encours" ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
          }}
        >
          Déclaration en cours
        </button>
        <button
          onClick={() => setOngletActif("historique")}
          className="px-4 py-2.5 font-semibold transition-all"
          style={{
            fontSize: FS_SM,
            borderBottom: ongletActif === "historique" ? "2px solid hsl(var(--accent))" : "2px solid transparent",
            color: ongletActif === "historique" ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
          }}
        >
          🗂 Historique
        </button>
      </div>

      {erreur && (
        <div
          className="mb-4 px-4 py-2 rounded-lg"
          style={{
            fontSize: FS_SM,
            background: "hsl(var(--destructive) / 0.08)",
            color: "hsl(var(--destructive))",
            border: "1px solid hsl(var(--destructive) / 0.25)",
          }}
        >
          {erreur}
        </div>
      )}

      {ongletActif === "encours" ? (
        <>
          {/* Sélecteur année */}
          <div className="flex items-center gap-3 mb-4">
            <label className="font-medium" style={{ color: "hsl(var(--foreground))", fontSize: FS_SM }}>
              Exercice :
            </label>
            <ThemedSelect
              className="w-28"
              value={String(annee)}
              onChange={(v) => setAnnee(Number(v))}
              disabled={modeConsultation}
              options={Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 - i).map((a) => ({
                value: String(a),
                label: String(a),
              }))}
            />

            {modeConsultation && (
              <span
                className="font-semibold px-3 py-1.5 rounded-lg"
                style={{ fontSize: FS_XS, background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
              >
                🔒 Mode consultation — déclaration archivée
              </span>
            )}
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-2 mb-6">
            {etapes.map((e) => (
              <button
                key={e.id}
                onClick={() => setEtape(e.id)}
                className="font-semibold px-3 py-2 rounded-lg transition-all"
                style={{
                  fontSize: FS_XS,
                  background: etape === e.id ? "hsl(var(--accent))" : "hsl(var(--muted))",
                  color: etape === e.id ? "white" : "hsl(var(--muted-foreground))",
                }}
              >
                {e.label}
              </button>
            ))}
          </div>

          {etape === "parametrage" && (
            <div className="space-y-6">
              {!parametrage ? (
                <p style={{ color: "hsl(var(--muted-foreground))", fontSize: FS_SM }}>
                  {chargement ? "Chargement…" : "Aucune donnée."}
                </p>
              ) : (
                <>
                  {/* ---- Constantes IR_RUBRIQUE_* ---- */}
                  <AccordionSection
                    title="1. Composition des agrégats (constantes IR_RUBRIQUE_*)"
                    description="Chaque agrégat attendu par l'État 9421 peut être la somme (ou la différence) de plusieurs rubriques de paie. Ajoute une ligne par rubrique contributive, avec l'attribut à lire (Montant / Nombre / Taux) et son signe."
                    isOpen={accordeonOuvert.constantes}
                    onToggle={() => toggleAccordeon("constantes")}
                  >
                    <div className="space-y-4">
                      {parametrage.constantes.map((c) => {
                        const saisie = getNouvelleLigne(c.code_constante);
                        return (
                          <div
                            key={c.code_constante}
                            className="rounded-lg border"
                            style={{ borderColor: c.lignes.length === 0 ? "hsl(var(--destructive) / 0.4)" : "hsl(var(--border))" }}
                          >
                            {/* En-tête de la carte */}
                            <div className="px-3 py-2 rounded-t-lg" style={{ background: "hsl(var(--muted) / 0.4)" }}>
                              <div className="font-bold" style={{ fontSize: FS_XS }}>{c.code_constante}</div>
                              <div style={{ fontSize: FS_XS, color: "hsl(var(--muted-foreground))" }}>{c.libelle}</div>
                            </div>

                            {/* Lignes de composition existantes */}
                            {c.lignes.length > 0 && (
                              <div>
                                {c.lignes.map((l) => (
                                  <div
                                    key={l.code_rubrique_paie}
                                    className="flex items-center gap-3 px-3 py-2 border-t"
                                    style={{ borderColor: "hsl(var(--border))", fontSize: FS_XS }}
                                  >
                                    <span
                                      className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
                                      style={{
                                        width: 20,
                                        height: 20,
                                        background: l.signe === "+" ? "hsl(var(--success) / 0.15)" : "hsl(var(--destructive) / 0.15)",
                                        color: l.signe === "+" ? "hsl(var(--success))" : "hsl(var(--destructive))",
                                      }}
                                    >
                                      {l.signe}
                                    </span>
                                    <span className="flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      {l.code_rubrique_paie}
                                    </span>
                                    <span className="font-bold flex-1 truncate">{l.libelle_rubrique_paie}</span>
                                    <span
                                      className="flex-shrink-0 px-2 py-0.5 rounded-full"
                                      style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
                                    >
                                      {ATTRIBUT_OPTIONS.find((a) => a.value === l.attribut)?.label || l.attribut}
                                    </span>
                                    <button
                                      onClick={() => supprimerRubriqueLigne(c.code_constante, l.code_rubrique_paie)}
                                      className="flex-shrink-0 font-semibold px-2 py-0.5 rounded"
                                      style={{ color: "hsl(var(--destructive))" }}
                                    >
                                      Retirer
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            {c.lignes.length === 0 && (
                              <div className="px-3 py-2 border-t" style={{ borderColor: "hsl(var(--border))", fontSize: FS_XS, color: "hsl(var(--destructive))" }}>
                                Aucune rubrique associée — l'alimentation échouera tant qu'aucune ligne n'est ajoutée.
                              </div>
                            )}

                            {/* Bouton pour révéler le formulaire d'ajout */}
                            {!ajoutOuvertParConstante[c.code_constante] ? (
                              <button
                                onClick={() => toggleAjout(c.code_constante)}
                                className="w-full text-left px-3 py-2 border-t font-semibold transition-all rounded-b-lg"
                                style={{ borderColor: "hsl(var(--border))", fontSize: FS_XS, color: "hsl(var(--accent))" }}
                              >
                                + Ajouter une rubrique
                              </button>
                            ) : (
                              <div className="flex items-center gap-2 px-3 py-2 border-t rounded-b-lg" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                                <div className="flex rounded-lg border overflow-hidden flex-shrink-0" style={{ borderColor: "hsl(var(--border))" }}>
                                  <button
                                    type="button"
                                    onClick={() => setNouvelleLigne(c.code_constante, { signe: "+" })}
                                    className="px-2.5 py-1.5 font-bold transition-all"
                                    style={{
                                      fontSize: FS_XS,
                                      background: saisie.signe === "+" ? "hsl(var(--success) / 0.15)" : "transparent",
                                      color: saisie.signe === "+" ? "hsl(var(--success))" : "hsl(var(--muted-foreground))",
                                    }}
                                  >
                                    +
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setNouvelleLigne(c.code_constante, { signe: "-" })}
                                    className="px-2.5 py-1.5 font-bold transition-all"
                                    style={{
                                      fontSize: FS_XS,
                                      background: saisie.signe === "-" ? "hsl(var(--destructive) / 0.15)" : "transparent",
                                      color: saisie.signe === "-" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                                    }}
                                  >
                                    −
                                  </button>
                                </div>
                                <ThemedSelect
                                  className="flex-1"
                                  value={saisie.code_rubrique_paie}
                                  onChange={(v) => setNouvelleLigne(c.code_constante, { code_rubrique_paie: v })}
                                  placeholder="Choisir une rubrique…"
                                  options={parametrage.rubriques_disponibles
                                    .filter((r) => !c.lignes.some((l) => l.code_rubrique_paie === r.code))
                                    .map((r) => ({ value: r.code, code: r.code, label: r.libelle }))}
                                />
                                <ThemedSelect
                                  className="w-32 flex-shrink-0"
                                  value={saisie.attribut}
                                  onChange={(v) => setNouvelleLigne(c.code_constante, { attribut: v })}
                                  options={ATTRIBUT_OPTIONS}
                                />
                                <button
                                  onClick={() => ajouterRubriqueLigne(c.code_constante)}
                                  disabled={!saisie.code_rubrique_paie}
                                  className="flex-shrink-0 px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                                  style={{ fontSize: FS_XS, background: "hsl(var(--accent))", color: "white" }}
                                >
                                  Ajouter
                                </button>
                                <button
                                  onClick={() => toggleAjout(c.code_constante)}
                                  className="flex-shrink-0 px-2 py-1.5 rounded-lg font-semibold"
                                  style={{ fontSize: FS_XS, color: "hsl(var(--muted-foreground))" }}
                                >
                                  Fermer
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </AccordionSection>

                  {/* ---- Mapping rubriques exonérées ---- */}
                  <AccordionSection
                    title="2. Rubriques exonérées → code DGI (optionnel)"
                    description="Détaille par code DGI les indemnités entrant dans le total des éléments exonérés (bloc justificatif du XML). Non bloquant si vide."
                    isOpen={accordeonOuvert.exonerations}
                    onToggle={() => toggleAccordeon("exonerations")}
                  >
                    <div className="rounded-lg border overflow-hidden mb-3" style={{ borderColor: "hsl(var(--border))" }}>
                      <table className="w-full border-collapse" style={{ fontSize: FS_XS }}>
                        <thead>
                          <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                            <th className="py-2 px-3 text-left">
                              <EnteteTriable
                                label="Signe"
                                actif={triExoneration.colonne === "signe"}
                                direction={triExoneration.direction}
                                onClick={() => trierExoneration("signe")}
                              />
                            </th>
                            <th className="py-2 px-3 text-left">
                              <EnteteTriable
                                label="Rubrique de paie"
                                actif={triExoneration.colonne === "rubrique"}
                                direction={triExoneration.direction}
                                onClick={() => trierExoneration("rubrique")}
                              />
                            </th>
                            <th className="py-2 px-3 text-left">
                              <EnteteTriable
                                label="Code DGI"
                                actif={triExoneration.colonne === "code_dgi"}
                                direction={triExoneration.direction}
                                onClick={() => trierExoneration("code_dgi")}
                              />
                            </th>
                            <th className="w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {[...parametrage.mappings_exoneration]
                            .sort((a, b) => {
                              const dir = triExoneration.direction === "asc" ? 1 : -1;
                              if (triExoneration.colonne === "signe") return a.signe.localeCompare(b.signe) * dir;
                              if (triExoneration.colonne === "code_dgi") return a.code_dgi.localeCompare(b.code_dgi) * dir;
                              return a.libelle_rubrique.localeCompare(b.libelle_rubrique) * dir;
                            })
                            .map((m) => (
                            <tr key={m.code_rubrique_paie} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                              <td className="py-2 px-3">
                                <span
                                  className="flex items-center justify-center rounded-full font-bold"
                                  style={{
                                    width: 20,
                                    height: 20,
                                    background: m.signe === "+" ? "hsl(var(--success) / 0.15)" : "hsl(var(--destructive) / 0.15)",
                                    color: m.signe === "+" ? "hsl(var(--success))" : "hsl(var(--destructive))",
                                  }}
                                >
                                  {m.signe}
                                </span>
                              </td>
                              <td className="py-2 px-3">{m.libelle_rubrique} <span style={{ color: "hsl(var(--muted-foreground))" }}>({m.code_rubrique_paie})</span></td>
                              <td className="py-2 px-3">{m.code_dgi} — {m.libelle_dgi}</td>
                              <td className="py-2 px-3">
                                <button
                                  onClick={() => supprimerExoneration(m.code_rubrique_paie)}
                                  className="font-semibold px-2 py-1 rounded"
                                  style={{ fontSize: FS_XS, color: "hsl(var(--destructive))" }}
                                >
                                  Retirer
                                </button>
                              </td>
                            </tr>
                          ))}
                          {parametrage.mappings_exoneration.length === 0 && (
                            <tr>
                              <td colSpan={4} className="text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                                Aucun mapping renseigné.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Ajout d'un mapping */}
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-lg border overflow-hidden flex-shrink-0" style={{ borderColor: "hsl(var(--border))" }}>
                        <button
                          type="button"
                          onClick={() => setNouvelleExoneration({ ...nouvelleExoneration, signe: "+" })}
                          className="px-2.5 py-1.5 font-bold transition-all"
                          style={{
                            fontSize: FS_XS,
                            background: nouvelleExoneration.signe === "+" ? "hsl(var(--success) / 0.15)" : "transparent",
                            color: nouvelleExoneration.signe === "+" ? "hsl(var(--success))" : "hsl(var(--muted-foreground))",
                          }}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => setNouvelleExoneration({ ...nouvelleExoneration, signe: "-" })}
                          className="px-2.5 py-1.5 font-bold transition-all"
                          style={{
                            fontSize: FS_XS,
                            background: nouvelleExoneration.signe === "-" ? "hsl(var(--destructive) / 0.15)" : "transparent",
                            color: nouvelleExoneration.signe === "-" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                          }}
                        >
                          −
                        </button>
                      </div>
                      <ThemedSelect
                        className="flex-1"
                        value={nouvelleExoneration.code_rubrique_paie}
                        onChange={(v) => setNouvelleExoneration({ ...nouvelleExoneration, code_rubrique_paie: v })}
                        placeholder="Choisir une rubrique…"
                        options={parametrage.rubriques_disponibles
                          .filter((r) => !parametrage.mappings_exoneration.some((m) => m.code_rubrique_paie === r.code))
                          .map((r) => ({ value: r.code, code: r.code, label: r.libelle }))}
                      />
                      <ThemedSelect
                        className="w-64"
                        value={nouvelleExoneration.code_dgi}
                        onChange={(v) => setNouvelleExoneration({ ...nouvelleExoneration, code_dgi: v })}
                        placeholder="Code DGI…"
                        options={parametrage.codes_dgi.map((c) => ({ value: c.code, code: c.code, label: c.libelle }))}
                      />
                      <button
                        onClick={ajouterExoneration}
                        disabled={!nouvelleExoneration.code_rubrique_paie || !nouvelleExoneration.code_dgi}
                        className="px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                        style={{ fontSize: FS_XS, background: "hsl(var(--accent))", color: "white" }}
                      >
                        Ajouter
                      </button>
                    </div>
                  </AccordionSection>

                  <button
                    onClick={() => setEtape("alimentation")}
                    className="px-4 py-2 rounded-lg font-semibold"
                    style={{ fontSize: FS_XS, background: "hsl(var(--primary))", color: "white" }}
                  >
                    Passer à l'alimentation →
                  </button>
                </>
              )}
            </div>
          )}

          {etape === "alimentation" && (
            <div className="p-4 rounded-lg" style={{ background: "hsl(var(--muted) / 0.4)", fontSize: FS_SM }}>
              <p className="mb-3" style={{ color: "hsl(var(--foreground))" }}>
                L'alimentation automatique recalcule l'intégralité des lignes de la déclaration{" "}
                <strong>{annee}</strong> à partir des bulletins clôturés/validés de l'exercice
                (remplace toute alimentation précédente).
              </p>
              <button
                onClick={alimenterAutomatiquement}
                disabled={chargement || modeConsultation}
                className="px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                style={{ fontSize: FS_XS, background: "hsl(var(--accent))", color: "white" }}
              >
                {chargement ? "Alimentation en cours…" : "Alimenter automatiquement"}
              </button>

              {avertissements.length > 0 && (
                <div
                  className="mt-4 p-3 rounded-lg"
                  style={{
                    fontSize: FS_XS,
                    background: "hsl(var(--warning, 38 92% 50%) / 0.1)",
                    color: "hsl(var(--foreground))",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  <p className="font-semibold mb-1">⚠ {avertissements.length} avertissement(s) :</p>
                  <ul className="list-disc pl-5 space-y-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {avertissements.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {Object.keys(bulletinsParPlan).length > 0 && (
                <div
                  className="mt-4 p-3 rounded-lg"
                  style={{
                    fontSize: FS_XS,
                    background: "hsl(var(--muted) / 0.5)",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  <p className="font-semibold mb-2" style={{ color: "hsl(var(--foreground))" }}>
                    Bulletins traités par plan de paie :
                  </p>
                  <table className="w-full border-collapse">
                    <tbody>
                      {Object.entries(bulletinsParPlan)
                        .sort((a, b) => b[1] - a[1])
                        .map(([plan, nb]) => (
                          <tr key={plan} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                            <td className="py-1 pr-3" style={{ color: "hsl(var(--foreground))" }}>{plan}</td>
                            <td className="py-1 font-bold" style={{ color: "hsl(var(--accent))" }}>{nb} bulletin(s)</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {etape === "controle" && (
            <div>
              {/* KPIs */}
              {kpis && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <KpiCard label="Total lignes" value={kpis.total_lignes} />
                  <KpiCard
                    label="Sans CIN"
                    value={kpis.sans_cin}
                    alerte={kpis.sans_cin > 0}
                    cliquable={kpis.sans_cin > 0}
                    actif={filtreKpi === "sans_cin"}
                    onClick={() => setFiltreKpi(filtreKpi === "sans_cin" ? null : "sans_cin")}
                  />
                  <KpiCard
                    label="Sans CNSS"
                    value={kpis.sans_cnss}
                    alerte={kpis.sans_cnss > 0}
                    cliquable={kpis.sans_cnss > 0}
                    actif={filtreKpi === "sans_cnss"}
                    onClick={() => setFiltreKpi(filtreKpi === "sans_cnss" ? null : "sans_cnss")}
                  />
                  <KpiCard
                    label="Sans catégorie DTS"
                    value={kpis.sans_categorie_dts}
                    alerte={kpis.sans_categorie_dts > 0}
                    cliquable={kpis.sans_categorie_dts > 0}
                    actif={filtreKpi === "sans_categorie"}
                    onClick={() => setFiltreKpi(filtreKpi === "sans_categorie" ? null : "sans_categorie")}
                  />
                  <KpiCard
                    label="Mois manquants"
                    value={kpis.lignes_avec_mois_manquants}
                    alerte={kpis.lignes_avec_mois_manquants > 0}
                    cliquable={kpis.lignes_avec_mois_manquants > 0}
                    actif={filtreKpi === "mois_manquants"}
                    onClick={() => setFiltreKpi(filtreKpi === "mois_manquants" ? null : "mois_manquants")}
                  />
                  <KpiCard label="Brut imposable" value={fmtMontant(kpis.total_brut_imposable)} />
                  <KpiCard label="IR prélevé" value={fmtMontant(kpis.total_ir_preleve)} />
                  <KpiCard label="Cotisations déduites" value={fmtMontant(kpis.total_cotisation_assurance)} />
                </div>
              )}

              {/* Bandeau de filtre actif */}
              {filtreKpi && (
                <div
                  className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg"
                  style={{ background: "hsl(var(--destructive) / 0.08)", border: "1px solid hsl(var(--destructive) / 0.25)" }}
                >
                  <span style={{ fontSize: FS_XS, color: "hsl(var(--destructive))" }}>
                    Filtré sur :{" "}
                    <strong>
                      {filtreKpi === "sans_cin" && "Sans CIN"}
                      {filtreKpi === "sans_cnss" && "Sans CNSS"}
                      {filtreKpi === "sans_categorie" && "Sans catégorie DTS"}
                      {filtreKpi === "mois_manquants" && "Mois manquants"}
                    </strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEtape("parametrage")}
                      className="font-semibold px-3 py-1 rounded-lg"
                      style={{ fontSize: FS_XS, background: "hsl(var(--accent))", color: "white" }}
                    >
                      Aller au Paramétrage →
                    </button>
                    <button
                      onClick={() => setFiltreKpi(null)}
                      className="font-semibold px-2 py-1 rounded-lg"
                      style={{ fontSize: FS_XS, color: "hsl(var(--muted-foreground))" }}
                    >
                      Réinitialiser
                    </button>
                  </div>
                </div>
              )}

              {/* Table des lignes */}
              <div className="overflow-auto rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
                <table className="w-full border-collapse" style={{ fontSize: FS_XS }}>
                  <thead>
                    <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                      {["Nom", "Prénom", "CIN", "CNSS", "Catégorie", "Mois", "Brut", "Exonéré",
                        "Brut imposable", "Frais pro", "Cotisations", "Net imposable", "IR prélevé"].map((h) => (
                        <th key={h} className="text-left py-2 px-2 font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lignes
                      .filter((l) => {
                        if (filtreKpi === "sans_cin") return !l.cin;
                        if (filtreKpi === "sans_cnss") return !l.cnss;
                        if (filtreKpi === "sans_categorie") return !l.type_personnel;
                        if (filtreKpi === "mois_manquants") return l.nb_mois_bulletin_manquant > 0;
                        return true;
                      })
                      .map((l) => (
                      <tr key={l.id} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                        <td className="py-1.5 px-2">{l.nom}</td>
                        <td className="py-1.5 px-2">{l.prenom}</td>
                        <td className="py-1.5 px-2" style={{ color: l.cin ? undefined : "hsl(var(--destructive))" }}>{l.cin || "—"}</td>
                        <td className="py-1.5 px-2" style={{ color: l.cnss ? undefined : "hsl(var(--destructive))" }}>{l.cnss || "—"}</td>
                        <td className="py-1.5 px-2" style={{ color: l.type_personnel ? undefined : "hsl(var(--destructive))" }}>
                          {l.type_personnel || "Non mappé"}
                        </td>
                        <td className="py-1.5 px-2" style={{ color: l.nb_mois_bulletin_manquant > 0 ? "hsl(var(--destructive))" : undefined }}>
                          {l.nb_mois_travailles}/12
                        </td>
                        <td className="py-1.5 px-2">{fmtMontant(l.salaire_brut)}</td>
                        <td className="py-1.5 px-2">{fmtMontant(l.elements_exoneres)}</td>
                        <td className="py-1.5 px-2">{fmtMontant(l.salaire_brut_imposable)}</td>
                        <td className="py-1.5 px-2">{fmtMontant(l.frais_professionnels)}</td>
                        <td className="py-1.5 px-2">{fmtMontant(l.cotisation_assurance)}</td>
                        <td className="py-1.5 px-2">{fmtMontant(l.revenu_net_imposable)}</td>
                        <td className="py-1.5 px-2">{fmtMontant(l.ir_preleve)}</td>
                      </tr>
                    ))}
                    {lignes.length === 0 && (
                      <tr>
                        <td colSpan={13} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Aucune ligne — lancez l'alimentation automatique.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <button
                onClick={() => setEtape("generation")}
                disabled={!kpis || kpis.bloquant}
                className="mt-4 px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                style={{ fontSize: FS_XS, background: "hsl(var(--primary))", color: "white" }}
                title={kpis?.bloquant ? "Corriger les anomalies bloquantes avant de continuer" : undefined}
              >
                Passer à la génération XML →
              </button>
            </div>
          )}

          {etape === "generation" && (
            <div className="p-4 rounded-lg" style={{ background: "hsl(var(--muted) / 0.4)", fontSize: FS_SM }}>
              <p className="mb-3" style={{ color: "hsl(var(--foreground))" }}>
                Génère le fichier XML conforme au format DTS/État 9421 attendu par
                SIMPL-IR, pour l'exercice <strong>{annee}</strong>.
              </p>
              <button
                onClick={genererXml}
                disabled={chargement || modeConsultation || !kpis || kpis.bloquant}
                className="px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
                style={{ fontSize: FS_XS, background: "hsl(var(--success))", color: "white" }}
              >
                {chargement ? "Génération en cours…" : "Générer et télécharger le XML"}
              </button>
            </div>
          )}
        </>
      ) : (
        /* ---------- Historique ---------- */
        <div className="overflow-auto rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full border-collapse" style={{ fontSize: FS_SM }}>
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                {["Année", "Statut", "Salariés déclarés", "Total IR", "Dernière mise à jour", ""].map((h) => (
                  <th key={h} className="text-left py-2 px-3 font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historique.map((d) => (
                <tr key={d.id} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                  <td className="py-2 px-3 font-semibold">{d.annee}</td>
                  <td className="py-2 px-3">
                    <span
                      className="font-semibold px-2 py-1 rounded-full"
                      style={{ fontSize: FS_XS, background: `${STATUT_COLORS[d.statut]} / 0.12`, color: STATUT_COLORS[d.statut] }}
                    >
                      {STATUT_LABELS[d.statut] || d.statut}
                    </span>
                  </td>
                  <td className="py-2 px-3">{d.nombre_total_salaries}</td>
                  <td className="py-2 px-3">{fmtMontant(d.montant_total_ir)}</td>
                  <td className="py-2 px-3">{new Date(d.updated_at).toLocaleString("fr-FR")}</td>
                  <td className="py-2 px-3">
                    <button
                      onClick={() => ouvrirDepuisHistorique(d)}
                      className="font-semibold px-3 py-1.5 rounded-lg"
                      style={{ fontSize: FS_XS, background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}
                    >
                      Consulter / Ouvrir
                    </button>
                  </td>
                </tr>
              ))}
              {historique.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucune déclaration IR générée pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ─────────────────── Sous-composant Accordéon ─────────────────── */

const AccordionSection: React.FC<{
  title: string;
  description?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, description, isOpen, onToggle, children }) => (
  <div className="rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-all rounded-t-lg ${!isOpen ? "rounded-b-lg" : ""}`}
      style={{ background: "hsl(var(--muted) / 0.3)" }}
    >
      <div>
        <div className="font-bold" style={{ fontSize: FS_SM, color: "hsl(var(--foreground))" }}>
          {title}
        </div>
        {description && (
          <div className="mt-0.5" style={{ fontSize: FS_XS, color: "hsl(var(--muted-foreground))" }}>
            {description}
          </div>
        )}
      </div>
      {isOpen ? (
        <ChevronUp size={16} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
      ) : (
        <ChevronDown size={16} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
      )}
    </button>
    {isOpen && (
      <div className="p-4 rounded-b-lg" style={{ borderTop: "1px solid hsl(var(--border))" }}>
        {children}
      </div>
    )}
  </div>
);

/* ─────────────────── Sous-composant déroulant thémé ─────────────────── */
/* Remplace le <select> natif : le popup natif ignore color-scheme sur
   certains environnements (Edge/Windows observé) et affiche un menu
   sombre même en thème clair. Ce composant construit son propre panel
   d'options stylé avec les variables CSS du thème, sur le modèle du
   ColorPicker de ReferentielsPage.tsx. Combobox avec champ de
   recherche intégré (utile dès qu'il y a beaucoup d'options, ex. les
   ~70 rubriques de paie). */

interface ThemedOption {
  value: string;
  code?: string;   // code court, affiché en normal avant le libellé
  label: string;   // libellé, affiché en gras quand un code est fourni
}

const OptionDisplay: React.FC<{ option: ThemedOption; bold?: boolean }> = ({ option, bold }) => (
  <span className="flex items-baseline gap-2 min-w-0">
    {option.code && (
      <span className="flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>
        {option.code}
      </span>
    )}
    <span className={`truncate ${bold && option.code ? "font-bold" : ""}`}>{option.label}</span>
  </span>
);

const ThemedSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: ThemedOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}> = ({ value, onChange, options, placeholder, disabled, invalid, className }) => {
  const [open, setOpen] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const boutonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const calculerPosition = useCallback(() => {
    const rect = boutonRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  const ouvrir = () => {
    calculerPosition();
    setOpen(true);
  };

  const fermer = () => {
    setOpen(false);
    setRecherche("");
  };

  // Ferme sur clic extérieur (bouton ET panel, puisque le panel est
  // porté dans document.body et n'est donc plus un descendant DOM du
  // bouton).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (
        boutonRef.current && !boutonRef.current.contains(cible) &&
        panelRef.current && !panelRef.current.contains(cible)
      ) {
        fermer();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Reposition si la page défile ou si la fenêtre est redimensionnée
  // pendant que le panel est ouvert (le panel étant en position:fixed
  // via portail, il ne suit plus automatiquement son ancre).
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => calculerPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, calculerPosition]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const q = recherche.trim().toLowerCase();
  const optionsFiltrees = q
    ? options.filter((o) => `${o.code || ""} ${o.label}`.toLowerCase().includes(q))
    : options;

  return (
    <div className={className} style={{ position: "relative" }}>
      <button
        ref={boutonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? fermer() : ouvrir())}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border transition-all"
        style={{
          fontSize: FS_XS,
          borderColor: invalid ? "hsl(var(--destructive) / 0.5)" : "hsl(var(--border))",
          background: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {selected ? (
          <OptionDisplay option={selected} bold />
        ) : (
          <span className="truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
            {placeholder || "—"}
          </span>
        )}
        {open ? (
          <ChevronUp size={12} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
        ) : (
          <ChevronDown size={12} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
        )}
      </button>
      {open && position && createPortal(
        <div
          ref={panelRef}
          className="fixed rounded-lg border overflow-hidden"
          style={{
            zIndex: 9999,
            top: position.top,
            left: position.left,
            minWidth: position.width,
            width: "max-content",
            maxWidth: 420,
            background: "hsl(var(--popover))",
            borderColor: "hsl(var(--border))",
            boxShadow: "0 8px 24px hsl(0 0% 0% / 0.15)",
          }}
        >
          <div className="p-1.5" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
            <input
              ref={inputRef}
              type="text"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher…"
              className="w-full px-2 py-1 rounded-md border"
              style={{
                colorScheme: "light",
                fontSize: FS_XS,
                borderColor: "hsl(var(--border))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="overflow-auto" style={{ maxHeight: 240 }}>
            {optionsFiltrees.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  fermer();
                }}
                className="w-full text-left px-3 py-1.5 transition-all"
                style={{
                  fontSize: FS_XS,
                  background: o.value === value ? "hsl(var(--accent) / 0.12)" : "transparent",
                  color: o.value === value ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                }}
              >
                <OptionDisplay option={o} bold={o.value === value} />
              </button>
            ))}
            {optionsFiltrees.length === 0 && (
              <div className="px-3 py-2" style={{ fontSize: FS_XS, color: "hsl(var(--muted-foreground))" }}>
                Aucun résultat.
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const ATTRIBUT_OPTIONS: ThemedOption[] = [
  { value: "montant", label: "Montant" },
  { value: "nombre", label: "Nombre" },
  { value: "taux", label: "Taux" },
];

/* ─────────────────── Sous-composant KPI ─────────────────── */

const KpiCard: React.FC<{
  label: string;
  value: string | number;
  alerte?: boolean;
  cliquable?: boolean;
  actif?: boolean;
  onClick?: () => void;
}> = ({ label, value, alerte, cliquable, actif, onClick }) => (
  <div
    onClick={cliquable ? onClick : undefined}
    className="p-3 rounded-lg border transition-all"
    style={{
      borderColor: actif
        ? "hsl(var(--accent))"
        : alerte
        ? "hsl(var(--destructive) / 0.4)"
        : "hsl(var(--border))",
      background: actif
        ? "hsl(var(--accent) / 0.08)"
        : alerte
        ? "hsl(var(--destructive) / 0.06)"
        : "hsl(var(--background))",
      cursor: cliquable ? "pointer" : "default",
      boxShadow: actif ? "0 0 0 1px hsl(var(--accent))" : undefined,
    }}
  >
    <p className="font-semibold uppercase tracking-wide mb-1" style={{ color: "hsl(var(--muted-foreground))", fontSize: FS_XS }}>
      {label}
      {cliquable && !actif && <span style={{ color: "hsl(var(--accent))" }}> ↗</span>}
    </p>
    <p className="font-bold" style={{ color: alerte ? "hsl(var(--destructive))" : "hsl(var(--foreground))", fontSize: FS_LG }}>
      {value}
    </p>
  </div>
);

export default DeclarationIrPage;
