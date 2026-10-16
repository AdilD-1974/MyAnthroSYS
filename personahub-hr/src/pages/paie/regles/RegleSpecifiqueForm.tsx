/**
 * RegleSpecifiqueForm – Éditeur multi-instructions des règles spécifiques.
 * Deux modes : TABLEUR (lignes numérotées) et TEXTE (script libre).
 * DSL : attributs MT/NB/TX/BASE/DATE/TEXTE, registres R/T/D, accesseurs [RUB].attr / #CONST,
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, db } from "@/lib/api";
import SmartRuleEditor, { type PaletteItem, type RefItem } from "./SmartRuleEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft, Save, Loader2, Info, Plus, Trash2, ArrowUp, ArrowDown, FileText, Table2, Play, AlertTriangle, CheckCircle2, RotateCcw,
  Search, Sigma, GitBranch, CalendarDays, Wallet, Sparkles, GripVertical, ListTree,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import SimulationPanel from "./SimulationPanel";

interface Props {
  editId: string | null;
  duplicateId: string | null;
  onBack: () => void;
}

interface Instruction {
  id?: string;
  numero: number;
  instruction: string;
  label: string | null;
  commentaire: string | null;
  est_actif: boolean;
  _new?: boolean;
  _deleted?: boolean;
}

const SYNTAX_HELP = [
  { syntax: "MT  NB  TX  BASE  DATE  TEXTE", desc: "Attributs de la rubrique courante" },
  { syntax: "Rxx / Txx / Dxx",              desc: "Registres de travail : nombre / texte / date (00-99)" },
  { syntax: "[RUB].MT",                      desc: "Attribut d'une autre rubrique de la paie (défaut .MT)" },
  { syntax: "#CONST",                        desc: "Constante de paie" },
  { syntax: "CUMUL(\"RUB\")",                desc: "Cumul annuel d'une rubrique" },
  { syntax: "PREC(\"RUB\", n)",              desc: "Valeur il y a n périodes (1 = mois précédent)" },
  { syntax: "SOMME / MOYENNE(\"RUB\", n)",   desc: "Somme / moyenne des n dernières périodes" },
  { syntax: "BAREME(\"IGR\", clé)",          desc: "Recherche dans un barème" },
  { syntax: "+  −  *  /  %",                 desc: "Opérateurs arithmétiques" },
  { syntax: "=  <>  <  >  <=  >=",           desc: "Comparaisons" },
  { syntax: "ET  OU  NON",                   desc: "Opérateurs logiques" },
  { syntax: "MIN  MAX  ARRONDI  ABS …",      desc: "Fonctions math (liste complète dans la doc)" },
  { syntax: "SI(cond, a, b)",                desc: "Condition en expression (valeur si vrai / si faux)" },
  { syntax: "SI <cond> ALORS <label>",       desc: "Branchement conditionnel vers un label (ou FIN)" },
  { syntax: "ALLER <label>",                 desc: "Branchement inconditionnel (GOTO)" },
  { syntax: "FIN",                           desc: "Fin de traitement" },
  { syntax: "DATEJOUR()  DATEPAIE()",        desc: "Date du jour / date de paie courante" },
];

// Validation syntaxique sommaire d'une instruction (mini-langage)
const VALID_INSTR = /^\s*((R\d{2}|T\d{2}|D\d{2}|MT|NB|TX|BASE|DATE|TEXTE)\s*=|SI\s+.+\s+(ALORS|=>)\s+\w+|(ALLER|GOTO)\s+\w+|(FIN|END|STOP))\s*/i;

// Met la saisie en MAJUSCULE, en préservant le texte entre guillemets ("...").
const upperKeepStrings = (s: string): string =>
  s.replace(/"[^"]*"?|[^"]+/g, (m) => (m.startsWith('"') ? m : m.toUpperCase()));

// Exemples curatés pour l'info-bulle de la sidebar — bien plus parlant qu'une
// simple description quand on découvre une fonction. Repli générique (signature
// + valeurs plausibles) pour tout ce qui n'est pas dans cette liste.
const EXEMPLES: Record<string, string> = {
  ARRONDI: 'ARRONDI(R01, 2)  →  123,46',
  TRONQUER: 'TRONQUER(R01, 0)  →  123',
  MIN: "MIN(R01, R02, 100)",
  MAX: "MAX(R01, R02, 0)",
  ABS: "ABS(R01 - R02)",
  PLAFOND: "PLAFOND(R01)",
  PLANCHER: "PLANCHER(R01)",
  PUISSANCE: "PUISSANCE(1.02, 12)",
  RACINE: "RACINE(R01)",
  MOD: "MOD(R01, 7)",
  SIGNE: "SIGNE(R01 - R02)",
  SI: 'SI(R01 > 1000, "OUI", "NON")',
  ET: "ET(R01 > 0, R02 > 0)",
  OU: "OU(R01 > 0, R02 > 0)",
  NON: "NON(R01 = 0)",
  ESTVIDE: "ESTVIDE([PRIME].MT)",
  COALESCE: "COALESCE([PRIME].MT, 0)",
  ENTRE: "ENTRE(R01, 0, 100)",
  DATEJOUR: "DATE = DATEJOUR()",
  DATEPAIE: "DATE = DATEPAIE()",
  ANNEE: "ANNEE(D01)  →  2026",
  MOIS: "MOIS(D01)  →  7",
  JOUR: "JOUR(D01)  →  17",
  ANNEES: 'R02 = ANNEES(DATEPAIE(), D01)  // ancienneté',
  MOISENTRE: "MOISENTRE(DATEPAIE(), D01)",
  JOURS: "JOURS(D01, D02)",
  DATEPLUS: "DATEPLUS(D01, 30)",
  DATEMOINS: "DATEMOINS(D01, 30)",
  FINMOIS: "FINMOIS(DATEPAIE())",
  VALEUR: 'VALEUR("SALBASE").MT  //  = [SALBASE].MT\nVALEUR("SALBASE", "NB")  // autre syntaxe, même résultat',
  CUMUL: 'R01 = CUMUL("IGRA").MT   // cumul annuel des montants IGRA\nR02 = CUMUL("PRIME_ANC", "NB")  // cumul du nombre (portée ANNEE par défaut)',
  PREC: 'R01 = PREC("SALBASE").MT     // = mois précédent (n=1 par défaut)\nR02 = PREC("SALBASE", 3).NB  // il y a 3 périodes, sur le NOMBRE',
  SOMME: 'R01 = SOMME("SALBASE", 3).MT   // somme des 3 derniers MONTANTS\nR02 = SOMME("HSUP", 12).NB      // total des 12 derniers NOMBRES',
  MOYENNE: 'R01 = MOYENNE("SALBASE", 3).MT   // moyenne des 3 derniers MONTANTS\nR02 = MOYENNE("HSUP", 12).NB      // moyenne des 12 derniers NOMBRES',
  BAREME: 'TX = BAREME("IGR", R02).TAUX     // sortie "taux"\nMT = BAREME("IGR", R02).MONTANT  // sortie "montant" (même barème, même clé)',
  "[RUB].MT": "R01 = [SALBASE].MT",
  "#CONST": "R01 = R02 * #TAUX_ANC / 100",
  "SI <cond> ALORS <label>": "SI R01 <= 0 ALORS FIN",
  "ALLER <label>": "ALLER SUITE",
};

const CAT_ICONES: Record<string, React.ElementType> = {
  Math: Sigma, Logique: GitBranch, Dates: CalendarDays, Paie: Wallet, Langage: Info,
};

function exempleUsage(item: PaletteItem): string {
  const nom = item.syntax.split(/[\s(]/)[0].replace(/[.…]/g, "").trim();
  return EXEMPLES[nom] || EXEMPLES[item.syntax] || item.syntax;
}

// Texte inséré au clic depuis la sidebar : ouvre l'appel pour les fonctions
// (curseur prêt à saisir les arguments, comme l'autocomplétion en direct),
// insère le gabarit littéral tel quel pour le reste (ex. "[RUB].MT",
// "SI <cond> ALORS <label>") — l'utilisateur édite ensuite les placeholders.
function texteAInserer(item: PaletteItem): string {
  const nom = item.syntax.split(/[\s(]/)[0].replace(/[.…]/g, "").trim();
  return item.syntax.includes("(") ? `${nom}(` : item.syntax;
}

const RegleSpecifiqueForm: React.FC<Props> = ({ editId, duplicateId, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [mode, setMode] = useState<"TABLEUR" | "TEXTE">("TABLEUR");
  const [form, setForm] = useState({
    code: "",
    libelle: "",
    description: "",
    attribut_calcule: "MONTANT",
    expression: "",
    instructions_text: "",
    date_application: "",
    date_debut_validite: "",
    date_fin_validite: "",
    decision_reference: "",
    commentaire: "",
    actif: true,
    // Workflow de validation
    statut: "BROUILLON" as "BROUILLON" | "VALIDEE" | "ARCHIVEE",
    date_validation: null as string | null,
    valide_par: null as string | null,
    commentaire_validation: "",
  });
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [rubriques, setRubriques] = useState<{ code: string; libelle: string }[]>([]);
  const [constantes, setConstantes] = useState<{ code: string; libelle: string; valeur?: string | null }[]>([]);
  // Palette : catalogue RÉEL du moteur (aucune liste en dur ; repli local si API muette)
  const [palette, setPalette] = useState<{ syntax: string; desc: string; cat?: string }[]>(SYNTAX_HELP);
  // Dernière version VALIDEE (snapshot lu/écrit en base) pour le retour arrière
  const [versionValidee, setVersionValidee] = useState<{ form: any; instructions: Instruction[] } | null>(null);
  // Référence de comparaison (état chargé/enregistré) pour détecter les modifications
  const [snapshot, setSnapshot] = useState<{ form: any; instructions: Instruction[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  // Erreurs de syntaxe renvoyées par le MOTEUR (clé = numéro de ligne)
  const [erreursLignes, setErreursLignes] = useState<Record<number, string>>({});
  // Avertissements sémantiques (référence introuvable) : signalés, non bloquants
  const [avertsLignes, setAvertsLignes] = useState<Record<number, string>>({});
  // Filtre de recherche du panneau "Syntaxe disponible"
  const [rechercheSyntaxe, setRechercheSyntaxe] = useState("");
  // Dernier éditeur (ligne tableur ou texte libre) focalisé — la sidebar y
  // insère au clic. Un ref (pas un state) : pas besoin de re-render sur changement.
  const inserteurActifRef = useRef<((texte: string) => void) | null>(null);
  const enregistrerInserteur = useCallback((fn: ((texte: string) => void) | null) => {
    inserteurActifRef.current = fn;
  }, []);
  const insererDepuisSidebar = useCallback((texte: string) => {
    if (!inserteurActifRef.current) {
      toast({ title: "Cliquez d'abord dans une instruction", description: "Placez le curseur où insérer, puis recliquez.", variant: "destructive" });
      return;
    }
    inserteurActifRef.current(texte);
  }, []);

  // RG-RULE-DND-01 : glisser-déposer pour réordonner les instructions
  const [dragVIdx, setDragVIdx] = useState<number | null>(null);
  const [dragOverVIdx, setDragOverVIdx] = useState<number | null>(null);

  // RG-SIM-INLINE-01 : dernier résultat de simulation, affiché en ligne dans
  // le tableau (colonne "Résultat") en plus du panneau détaillé.
  const [dernierResultat, setDernierResultat] = useState<{ sorties: Record<string, any>; trace: any[]; avertissements: string[] } | null>(null);

  useEffect(() => {
    db.list<{ code: string; libelle: string }>("rubrique_paie", { archive: false, select: "code,libelle", order: "code", limit: 2000 })
      .then(setRubriques).catch(() => {});
    db.list<{ code: string; libelle: string; valeur: string }>("ref_constante_paie", { actif: true, select: "code,libelle,valeur", order: "code", limit: 1000 })
      .then(setConstantes).catch(() => {});
    api.get<{ fonctions: { nom: string; cat: string; signature: string; desc: string }[]; grammaire: Record<string, { nom: string; desc: string }[]> }>("/paie/regles/catalogue")
      .then((c) => {
        const g = Object.values(c.grammaire || {}).flat().map((x) => ({ syntax: x.nom, desc: x.desc, cat: "Langage" }));
        const f = (c.fonctions || []).map((x) => ({ syntax: x.signature, desc: x.desc, cat: x.cat }));
        if (g.length || f.length) setPalette([...g, ...f]);
      })
      .catch(() => { /* repli : SYNTAX_HELP */ });
  }, []);

  useEffect(() => {
    const id = editId || duplicateId;
    if (!id) {
      // Initial : une ligne vide en mode tableur
      setInstructions([{ numero: 10, instruction: "", label: null, commentaire: null, est_actif: true, _new: true }]);
      return;
    }
    setLoading(true);
    (async () => {
      let data: any = null;
      try {
        const rows = await db.list<any>("regle_calcul_specifique", { id, select: "*", limit: 1 });
        data = rows[0] || null;
      } catch { /* ignore */ }
      if (!data) {
        toast({ title: "Erreur", description: "Règle introuvable", variant: "destructive" });
        setLoading(false);
        return;
      }
      setForm({
        code: duplicateId ? `${data.code}_COPY` : data.code,
        libelle: duplicateId ? `${data.libelle} (copie)` : data.libelle,
        description: data.description || "",
        attribut_calcule: data.attribut_calcule,
        expression: data.expression || "",
        instructions_text: (data as any).instructions_text || "",
        date_application: (data as any).date_application || "",
        date_debut_validite: data.date_debut_validite || "",
        date_fin_validite: data.date_fin_validite || "",
        decision_reference: data.decision_reference || "",
        commentaire: data.commentaire || "",
        actif: data.actif,
        // Workflow de validation - une duplication revient à BROUILLON
        statut: duplicateId ? "BROUILLON" : ((data as any).statut || "BROUILLON"),
        date_validation: duplicateId ? null : ((data as any).date_validation || null),
        valide_par: duplicateId ? null : ((data as any).valide_par || null),
        commentaire_validation: duplicateId ? "" : ((data as any).commentaire_validation || ""),
      });
      setMode(((data as any).mode_edition || "TABLEUR") as "TABLEUR" | "TEXTE");
      // Dernière version validée archivée en base (pour le retour arrière)
      const vv = (data as any).version_validee;
      if (vv && !duplicateId) setVersionValidee(typeof vv === "string" ? JSON.parse(vv) : vv);

      // Charger les instructions ligne par ligne
      let instr: any[] = [];
      try { instr = await db.list<any>("regle_specifique_instruction", { regle_id: id, select: "*", order: "numero" }); } catch { /* ignore */ }

      if (instr && (instr as any[]).length) {
        setInstructions(
          (instr as any[]).map((i: any) => ({
            id: duplicateId ? undefined : i.id,
            numero: i.numero,
            instruction: i.instruction,
            label: i.label,
            commentaire: i.commentaire,
            est_actif: i.est_actif,
            _new: !!duplicateId,
          }))
        );
      } else {
        setInstructions([{ numero: 10, instruction: "", label: null, commentaire: null, est_actif: true, _new: true }]);
      }
      setLoading(false);
      setSnapshotInitial(true);   // capture la version chargée comme référence
    })();
  }, [editId, duplicateId]);

  // Capture de la version de référence une fois les données chargées
  const [snapshotInitial, setSnapshotInitial] = useState(false);
  useEffect(() => {
    if (!snapshotInitial || snapshot) return;
    setSnapshot({ form: { ...form }, instructions: instructions.map((i) => ({ ...i })) });
  }, [snapshotInitial, snapshot, form, instructions]);

  // ----- Tableur helpers -----
  // Toute modification après enregistrement marque la règle comme « modifiée ».
  // Si elle était VALIDEE, elle repasse en BROUILLON (le moteur n'utilise que les VALIDEE).
  useEffect(() => {
    if (!snapshot) return;
    // Les champs de WORKFLOW ne comptent pas comme une « modification » de la règle :
    // sinon la validation (qui les renseigne) déclencherait un retour en brouillon.
    const sansWorkflow = (f: any) => {
      const { statut, date_validation, valide_par, commentaire_validation, actif, ...reste } = f || {};
      return reste;
    };
    const memeForm = JSON.stringify(sansWorkflow(form)) === JSON.stringify(sansWorkflow(snapshot.form));
    const cle = (L: any[]) => JSON.stringify(L.filter((i) => !i._deleted)
      .map((i) => [i.numero, i.instruction, i.label, i.est_actif]));
    const memeInstr = cle(instructions) === cle(snapshot.instructions);
    const modifie = !(memeForm && memeInstr);
    setDirty(modifie);
    if (modifie && form.statut === "VALIDEE") {
      setForm((f) => ({ ...f, statut: "BROUILLON", date_validation: null, valide_par: null }));
      toast({
        title: "Règle repassée en brouillon",
        description: "Vos modifications ne seront prises en compte qu'après validation.",
      });
    }
  }, [form, instructions, snapshot]);

  // Validation SYNTAXIQUE par le moteur (source de vérité), débattue à la frappe.
  useEffect(() => {
    const lignes = (mode === "TABLEUR"
      ? instructions.filter((i) => !i._deleted && i.instruction.trim())
          .map((i) => ({ numero: i.numero, instruction: i.instruction, label: i.label }))
      : form.instructions_text.split("\n").map((l, idx) => ({ numero: (idx + 1) * 10, instruction: l.trim(), label: null }))
          .filter((l) => l.instruction));
    if (!lignes.length) { setErreursLignes({}); return; }
    const t = setTimeout(() => {
      api.post<{ ok: boolean; erreurs: string[]; avertissements?: string[] }>("/paie/regles/valider", { instructions: lignes })
        .then((r) => {
          const parse = (L?: string[]) => {
            const map: Record<number, string> = {};
            (L || []).forEach((e) => {
              const m = e.match(/Ligne\s+(\d+)\s*:\s*(.+)/i);
              if (m) map[parseInt(m[1], 10)] = m[2];
            });
            return map;
          };
          setErreursLignes(parse(r.erreurs));
          setAvertsLignes(parse(r.avertissements));
        })
        .catch(() => { /* moteur muet : on garde la validation locale */ });
    }, 400);
    return () => clearTimeout(t);
  }, [instructions, form.instructions_text, mode]);

  // Revenir à la dernière version VALIDÉE (snapshot conservé en base)
  const handleRevert = () => {
    if (!versionValidee) {
      toast({ title: "Aucune version validée", description: "Cette règle n'a jamais été validée.", variant: "destructive" });
      return;
    }
    if (!confirm("Abandonner les modifications et revenir à la dernière version VALIDÉE ?")) return;
    setForm({ ...versionValidee.form, statut: "VALIDEE" });
    setInstructions(versionValidee.instructions.map((i: any) => ({ ...i, _new: true, id: undefined })));
    setSnapshot({ form: { ...versionValidee.form, statut: "VALIDEE" }, instructions: versionValidee.instructions.map((i: any) => ({ ...i })) });
    setDirty(false);
    toast({ title: "Version validée restaurée", description: "Enregistrez pour confirmer ce retour arrière." });
  };

  const updateInstr = (idx: number, patch: Partial<Instruction>) => {
    setInstructions((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addInstr = () => {
    const visible = instructions.filter((i) => !i._deleted);
    const lastNum = visible.length ? Math.max(...visible.map((i) => i.numero)) : 0;
    setInstructions((prev) => [
      ...prev,
      { numero: lastNum + 5, instruction: "", label: null, commentaire: null, est_actif: true, _new: true },
    ]);
  };
  const removeInstr = (idx: number) => {
    setInstructions((prev) => {
      const it = prev[idx];
      if (it.id) return prev.map((x, i) => (i === idx ? { ...x, _deleted: true } : x));
      return prev.filter((_, i) => i !== idx);
    });
  };
  const moveInstr = (idx: number, dir: -1 | 1) => {
    const visible = instructions.filter((i) => !i._deleted);
    const realIdx = instructions.indexOf(visible[idx]);
    const targetVisIdx = idx + dir;
    if (targetVisIdx < 0 || targetVisIdx >= visible.length) return;
    const realTarget = instructions.indexOf(visible[targetVisIdx]);
    setInstructions((prev) => {
      const next = [...prev];
      const a = next[realIdx].numero;
      next[realIdx] = { ...next[realIdx], numero: next[realTarget].numero };
      next[realTarget] = { ...next[realTarget], numero: a };
      return next.sort((x, y) => x.numero - y.numero);
    });
  };

  // RG-RULE-DND-01 (Adil DAIA) : glisser une ligne et la déposer sur une
  // autre l'insère juste avant la cible — toute la liste visible est ensuite
  // renumérotée par pas de 10 dans son nouvel ordre (contrairement aux
  // rubriques, les instructions n'appartiennent qu'à cette seule règle : pas
  // besoin de préserver les numéros existants pour éviter des collisions
  // externes, une renumérotation complète est plus simple et tout aussi sûre).
  const handleDropInstr = (targetVIdx: number) => {
    const sourceVIdx = dragVIdx;
    setDragVIdx(null); setDragOverVIdx(null);
    if (sourceVIdx == null || sourceVIdx === targetVIdx) return;
    const visible = instructions.filter((i) => !i._deleted);
    const reordonnee = [...visible];
    const [deplacee] = reordonnee.splice(sourceVIdx, 1);
    const posInsertion = sourceVIdx < targetVIdx ? targetVIdx - 1 : targetVIdx;
    reordonnee.splice(posInsertion, 0, deplacee);
    const nouveauxNumeros = new Map(reordonnee.map((it, i) => [it, (i + 1) * 10]));
    setInstructions((prev) => prev.map((it) => (nouveauxNumeros.has(it) ? { ...it, numero: nouveauxNumeros.get(it)! } : it)));
  };

  // ----- Synchronisation TABLEUR <-> TEXTE -----
  const tableurToText = () => {
    return instructions
      .filter((i) => !i._deleted)
      .sort((a, b) => a.numero - b.numero)
      .map((i) => `${String(i.numero).padStart(3, " ")}  ${i.instruction}${i.label ? `   :${i.label}` : ""}${i.commentaire ? `   ; ${i.commentaire}` : ""}`)
      .join("\n");
  };
  const textToTableur = (txt: string): Instruction[] => {
    const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((l, idx) => {
      // Format attendu : "<num>  <instruction>   :LABEL   ; commentaire"
      const m = l.match(/^(\d+)\s+(.+)$/);
      let numero = (idx + 1) * 10;
      let body = l;
      if (m) {
        numero = parseInt(m[1], 10);
        body = m[2];
      }
      let commentaire: string | null = null;
      let label: string | null = null;
      const cIdx = body.indexOf(";");
      if (cIdx >= 0) {
        commentaire = body.slice(cIdx + 1).trim();
        body = body.slice(0, cIdx).trim();
      }
      const lblMatch = body.match(/\s:(\w+)\s*$/);
      if (lblMatch) {
        label = lblMatch[1];
        body = body.replace(/\s:\w+\s*$/, "").trim();
      }
      return { numero, instruction: body, label, commentaire, est_actif: true, _new: true };
    });
  };

  const handleModeSwitch = (next: "TABLEUR" | "TEXTE") => {
    if (next === mode) return;
    if (next === "TEXTE") {
      setForm((f) => ({ ...f, instructions_text: tableurToText() }));
    } else {
      // Repasser en tableur : reconstruire depuis le texte
      const reb = textToTableur(form.instructions_text);
      setInstructions(reb.length ? reb : [{ numero: 10, instruction: "", label: null, commentaire: null, est_actif: true, _new: true }]);
    }
    setMode(next);
  };

  // Validation : numéros uniques + au moins une instruction non vide
  const validate = (): string | null => {
    const visible = mode === "TABLEUR"
      ? instructions.filter((i) => !i._deleted && i.instruction.trim())
      : textToTableur(form.instructions_text);
    if (!form.code.trim() || !form.libelle.trim()) return "Code et libellé sont obligatoires.";
    if (visible.length === 0) return "Au moins une instruction est requise.";
    const nums = visible.map((i) => i.numero);
    if (new Set(nums).size !== nums.length) return "Les numéros de ligne doivent être uniques.";
    return null;
  };

  const handleSave = async () => {
    if (Object.keys(erreursLignes).length) {
      toast({
        title: "Instructions en erreur",
        description: "Corrigez les lignes signalées en rouge avant d'enregistrer.",
        variant: "destructive",
      });
      return;
    }
    const err = validate();
    if (err) {
      toast({ title: "Validation", description: err, variant: "destructive" });
      return;
    }
    setSaving(true);

    // 1) Synchroniser texte/tableur avant envoi
    let finalInstructions: Instruction[];
    let finalText: string;
    if (mode === "TABLEUR") {
      finalInstructions = instructions.filter((i) => !i._deleted && i.instruction.trim());
      finalText = tableurToText();
    } else {
      finalInstructions = textToTableur(form.instructions_text);
      finalText = form.instructions_text;
    }

    // L'expression "courte" reste = concaténation des instructions (rétro-compat colonne expression)
    const expressionSummary = finalInstructions.map((i) => i.instruction).join(" ; ");

    // Inférer la (les) sortie(s) depuis les instructions finales
    const inferredSet = new Set<string>();
    finalInstructions.forEach((i) => {
      const m = i.instruction.trim().match(/^(MT|NB|TX|BASE|DATE|TEXTE)\s*=/i);
      if (m) inferredSet.add(m[1].toUpperCase());
    });
    const inferred = Array.from(inferredSet);
    const attributCalcule =
      inferred.length === 0 ? "AUCUN" :
      inferred.length === 1 ? (inferred[0] === "MT" ? "MONTANT" : inferred[0] === "NB" ? "NOMBRE" : inferred[0] === "TX" ? "TAUX" : inferred[0] === "DATE" ? "DATE" : inferred[0] === "TEXTE" ? "TEXTE" : "BASE") :
      "MULTI";

    const payload: any = {
      code: form.code,
      libelle: form.libelle,
      description: form.description || null,
      attribut_calcule: attributCalcule,
      expression: expressionSummary,
      mode_edition: mode,
      instructions_text: finalText,
      date_application: form.date_application || null,
      date_debut_validite: form.date_debut_validite || null,
      date_fin_validite: form.date_fin_validite || null,
      decision_reference: form.decision_reference || null,
      commentaire: form.commentaire || null,
      actif: form.actif,
      // Workflow de validation
      // Si on modifie une règle VALIDEE, on la repasse en BROUILLON
      // pour qu'elle soit re-validée avant d'être utilisée en paie
      statut: editId && form.statut === "VALIDEE" ? "BROUILLON" : form.statut,
      date_validation: editId && form.statut === "VALIDEE" ? null : form.date_validation,
      valide_par: editId && form.statut === "VALIDEE" ? null : form.valide_par,
      commentaire_validation: editId && form.statut === "VALIDEE" ? null : (form.commentaire_validation || null),
    };

    let regleId = editId;
    if (editId) {
      try {
        await db.update("regle_calcul_specifique", { id: editId }, payload);
      } catch (e: any) {
        setSaving(false);
        toast({ title: "Erreur d'enregistrement", description: e.message, variant: "destructive" });
        return;
      }
    } else {
      try {
        const created: any = await db.create("regle_calcul_specifique", payload);
        regleId = Array.isArray(created) ? created[0]?.id : created?.id;
      } catch (e: any) {
        setSaving(false);
        toast({ title: "Erreur d'enregistrement", description: e.message, variant: "destructive" });
        return;
      }
      if (!regleId) {
        setSaving(false);
        toast({ title: "Erreur d'enregistrement", description: "Échec création", variant: "destructive" });
        return;
      }
    }

    // 2) Synchroniser les instructions en base
    if (regleId) {
      // Suppressions
      // Stratégie simple : remplacer toutes les instructions (delete-all puis insert-all).
      try { await db.remove("regle_specifique_instruction", { regle_id: regleId }); } catch { /* ignore */ }
      if (finalInstructions.length) {
        await db.create("regle_specifique_instruction",
          finalInstructions.map((i) => ({
            regle_id: regleId!,
            numero: i.numero,
            instruction: i.instruction,
            label: i.label,
            commentaire: i.commentaire,
            est_actif: i.est_actif,
          }))
        );
      }
    }

    setSaving(false);
    // On RESTE sur la règle : mémorisation de la version enregistrée.
    setSnapshot({ form: { ...form }, instructions: finalInstructions.map((i: any) => ({ ...i })) });
    setDirty(false);
    toast({
      title: editId ? "Règle enregistrée" : "Règle créée",
      description: form.statut !== "VALIDEE"
        ? "Pensez à la valider pour qu'elle soit utilisée par le moteur de paie."
        : undefined,
    });
  };

  // Valider la règle (passer de BROUILLON à VALIDEE)
  // Une règle VALIDEE est utilisée par le moteur de paie réel.
  const handleValider = async () => {
    if (!editId) {
      toast({ title: "Validation impossible", description: "Veuillez d'abord enregistrer la règle.", variant: "destructive" });
      return;
    }
    if (!confirm("Valider cette règle ? Elle sera utilisée dans le calcul de paie.")) return;

    setSaving(true);
    const commentaire = window.prompt("Commentaire de validation (optionnel) :", "") || null;

    // Utilisateur courant : géré côté serveur via le token (non requis ici).
    const userId: string | null = null;

    // Instantané de la version validée : permet d'y revenir après modifications.
    const snap = {
      form: { ...form, statut: "VALIDEE" },
      instructions: instructions.filter((i) => !i._deleted).map((i) => ({
        numero: i.numero, instruction: i.instruction, label: i.label,
        commentaire: i.commentaire, est_actif: i.est_actif,
      })),
      date_validation: new Date().toISOString(),
    };

    try {
      await db.update("regle_calcul_specifique", { id: editId }, {
        statut: "VALIDEE",
        date_validation: new Date().toISOString(),
        valide_par: userId,
        commentaire_validation: commentaire,
        actif: true,
        version_validee: snap,
      });
    } catch (e: any) {
      setSaving(false);
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
      return;
    }
    setSaving(false);
    setVersionValidee({ form: snap.form, instructions: snap.instructions as any });
    setSnapshot({ form: snap.form, instructions: snap.instructions as any });
    setDirty(false);
    toast({ title: "Règle validée", description: "Cette règle est maintenant utilisée en production." });
    setForm((f) => ({
      ...f,
      statut: "VALIDEE",
      date_validation: new Date().toISOString(),
      valide_par: userId,
      commentaire_validation: commentaire || "",
      actif: true,
    }));
  };

  // Archiver la règle (passer de VALIDEE à ARCHIVEE)
  // Une règle archivée n'est plus utilisée en production.
  const handleArchiver = async () => {
    if (!editId) return;
    if (!confirm("Archiver cette règle ? Elle ne sera plus utilisée dans le calcul de paie.")) return;

    setSaving(true);
    try {
      await db.update("regle_calcul_specifique", { id: editId }, {
        statut: "ARCHIVEE",
        actif: false,
      });
    } catch (e: any) {
      setSaving(false);
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
      return;
    }
    setSaving(false);
    toast({ title: "Règle archivée" });
    setForm((f) => ({ ...f, statut: "ARCHIVEE", actif: false }));
  };

  // Réactiver une règle archivée (passer de ARCHIVEE à BROUILLON)
  const handleReactiver = async () => {
    if (!editId) return;
    if (!confirm("Réactiver cette règle ? Elle devra être re-validée avant utilisation.")) return;

    setSaving(true);
    try {
      await db.update("regle_calcul_specifique", { id: editId }, {
        statut: "BROUILLON",
        date_validation: null,
        valide_par: null,
        commentaire_validation: null,
        actif: false,
      });
    } catch (e: any) {
      setSaving(false);
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
      return;
    }
    setSaving(false);
    toast({ title: "Règle réactivée", description: "Vous pouvez maintenant la modifier puis la valider." });
    setForm((f) => ({
      ...f,
      statut: "BROUILLON",
      date_validation: null,
      valide_par: null,
      commentaire_validation: "",
      actif: false,
    }));
  };

  // RG-RULE-REGISTRES-01 : vue d'ensemble des registres (Rxx/Txx/Dxx) et
  // rubriques [CODE] déjà utilisés dans la règle — pour repérer une collision
  // de registre ou retrouver où une rubrique est référencée, sans relire
  // toutes les lignes une à une.
  // IMPORTANT : ce hook doit être appelé AVANT tout retour anticipé (if
  // (loading) return ...) — les Rules of Hooks interdisent un nombre de
  // hooks variable d'un rendu à l'autre ("Rendered fewer hooks than
  // expected"). D'où le recalcul local de la liste visible (sur `instructions`,
  // déjà disponible ici) plutôt que de dépendre de `visibleInstr`, défini
  // plus bas après le retour anticipé.
  const usagesRegistresEtRubriques = React.useMemo(() => {
    const registres = new Map<string, number[]>();
    const rubs = new Map<string, number[]>();
    const reReg = /\b([RTD]\d{2})\b/g;
    const reRub = /\[([A-Z0-9_]+)\]/g;
    instructions.filter((i) => !i._deleted).forEach((it) => {
      if (!it.instruction.trim()) return;
      let m: RegExpExecArray | null;
      reReg.lastIndex = 0;
      while ((m = reReg.exec(it.instruction))) {
        const l = registres.get(m[1]) || [];
        if (!l.includes(it.numero)) l.push(it.numero);
        registres.set(m[1], l);
      }
      reRub.lastIndex = 0;
      while ((m = reRub.exec(it.instruction))) {
        const l = rubs.get(m[1]) || [];
        if (!l.includes(it.numero)) l.push(it.numero);
        rubs.set(m[1], l);
      }
    });
    const trie = (m: Map<string, number[]>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { registres: trie(registres), rubriques: trie(rubs) };
  }, [instructions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={18} /> Chargement…
      </div>
    );
  }

  const visibleInstr = instructions.filter((i) => !i._deleted);

  // Inférence des sorties à partir des instructions (MT=, NB=, TY=, BASE=)
  const sourceForDetect = mode === "TABLEUR"
    ? visibleInstr.map((i) => i.instruction).join("\n")
    : form.instructions_text;
  const OUTPUT_LABELS: Record<string, string> = {
    MT: "Montant",
    NB: "Nombre",
    TX: "Taux",
    BASE: "Base",
    DATE: "Date",
    TEXTE: "Texte",
  };
  const detectedSet = new Set<string>();
  sourceForDetect.split(/[\n;]/).forEach((line) => {
    const l = line.trim();
    // Affectation directe (CIBLE = expr) OU conditionnelle inline
    // (SI <cond> ALORS CIBLE = expr) — RG-DSL-SI-INLINE-01.
    const m = l.match(/^(MT|NB|TX|BASE|DATE|TEXTE)\s*=/i) || l.match(/\bALORS\s+(MT|NB|TX|BASE|DATE|TEXTE)\s*=/i);
    if (m) detectedSet.add(m[1].toUpperCase());
  });
  const detectedOutputs = Array.from(detectedSet).map((k) => `${k} (${OUTPUT_LABELS[k]})`);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft size={14} /> Retour
        </Button>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[11px] flex items-center gap-1 mr-1" style={{ color: "hsl(var(--warning))" }}>
              <AlertTriangle size={12} /> Modifications non enregistrées
            </span>
          )}
          {dirty && versionValidee && (
            <Button size="sm" variant="ghost" onClick={handleRevert} className="gap-1.5"
              title="Abandonner les modifications et revenir à la dernière version validée">
              <RotateCcw size={14} /> Version validée
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSimOpen(true)}
            className="gap-1.5"
            title="Tester la règle avant mise en production (sandbox)"
          >
            <Play size={14} /> Simuler
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {editId ? "Enregistrer" : "Créer"}
          </Button>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-foreground mb-1">
        {editId ? "Modifier" : duplicateId ? "Dupliquer" : "Nouvelle"} règle spécifique
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        Composez votre règle ligne par ligne (tableur) ou en script libre (texte).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Colonne principale */}
        <div className="lg:col-span-3 space-y-4">
          {/* Identité */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="code" className="text-xs">Code <span className="text-destructive">*</span></Label>
              <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="EX: REGLE_IGR" className="h-9 text-sm font-mono" />
            </div>
            <div>
              <Label htmlFor="libelle" className="text-xs">Libellé <span className="text-destructive">*</span></Label>
              <Input id="libelle" value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                placeholder="Calcul de l'IGR" className="h-9 text-sm" />
            </div>
          </div>

          <div>
            <Label htmlFor="description" className="text-xs">Description</Label>
            <Textarea id="description" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Décrivez la finalité de cette règle…" className="text-sm min-h-[60px]" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Sorties détectées</Label>
              <div className="flex flex-wrap gap-1.5 min-h-[36px] items-center px-3 py-2 rounded-lg border border-dashed border-border bg-muted/20">
                {detectedOutputs.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">
                    Aucune sortie détectée — affectez un attribut : <code className="font-mono">MT =</code>, <code className="font-mono">NB =</code>, <code className="font-mono">TX =</code>, <code className="font-mono">BASE =</code>, <code className="font-mono">DATE =</code> ou <code className="font-mono">TEXTE =</code>
                  </span>
                ) : (
                  detectedOutputs.map((o) => (
                    <Badge key={o} variant="secondary" className="text-[10px] font-mono">
                      {o}
                    </Badge>
                  ))
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 italic">
                Inférées depuis vos instructions — pas besoin de les déclarer.
              </p>
            </div>
            <div>
              <Label htmlFor="dapp" className="text-xs">Date d'application</Label>
              <Input id="dapp" type="date" value={form.date_application}
                onChange={(e) => setForm({ ...form, date_application: e.target.value })}
                className="h-9 text-sm" />
            </div>
          </div>

          {/* Bascule de mode */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Label className="text-sm font-semibold">Instructions de la règle</Label>
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
              <button type="button" onClick={() => handleModeSwitch("TABLEUR")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  mode === "TABLEUR" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <Table2 size={13} /> Tableur
              </button>
              <button type="button" onClick={() => handleModeSwitch("TEXTE")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  mode === "TEXTE" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <FileText size={13} /> Texte libre
              </button>
            </div>
          </div>

          {/* RG-RULE-REGISTRES-01 : registres & rubriques déjà utilisés */}
          {(usagesRegistresEtRubriques.registres.length > 0 || usagesRegistresEtRubriques.rubriques.length > 0) && (
            <div className="rounded-lg border border-border bg-muted/10 px-3 py-2 flex flex-wrap items-start gap-x-5 gap-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold shrink-0 pt-0.5">
                <ListTree size={12} /> Utilisés
              </div>
              {usagesRegistresEtRubriques.registres.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {usagesRegistresEtRubriques.registres.map(([code, lignes]) => (
                    <span key={code} title={`Ligne(s) ${lignes.join(", ")}`}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground cursor-help">
                      {code}
                    </span>
                  ))}
                </div>
              )}
              {usagesRegistresEtRubriques.rubriques.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {usagesRegistresEtRubriques.rubriques.map(([code, lignes]) => (
                    <span key={code} title={`Ligne(s) ${lignes.join(", ")}`}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded cursor-help"
                      style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                      [{code}]
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mode TABLEUR */}
          {mode === "TABLEUR" && (
            <>
            {Object.keys(erreursLignes).length > 0 && (
              <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <div className="font-semibold flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={12} /> {Object.keys(erreursLignes).length} instruction(s) en erreur — la règle ne peut pas être enregistrée
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {Object.entries(erreursLignes).map(([num, msg]) => (
                    <li key={num}>Ligne {num} : {msg}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-1 py-2 w-5" title="Glisser pour réordonner" />
                    <th className="px-2 py-2 font-semibold w-14">N°</th>
                    <th className="px-2 py-2 font-semibold">Instruction</th>
                    <th className="px-2 py-2 font-semibold w-20">Label</th>
                    {dernierResultat && <th className="px-2 py-2 font-semibold w-40">Résultat</th>}
                    <th className="px-2 py-2 font-semibold w-32">Commentaire</th>
                    <th className="px-2 py-2 font-semibold w-12 text-center">✓</th>
                    <th className="px-2 py-2 font-semibold w-24 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleInstr.map((it, vIdx) => {
                    const realIdx = instructions.indexOf(it);
                    const errServeur = erreursLignes[it.numero];
                    const avertServeur = avertsLignes[it.numero];
                    const isValid = !errServeur && (!it.instruction.trim() || VALID_INSTR.test(it.instruction.trim()));
                    // RG-SIM-INLINE-01 : dernière trace correspondant à cette ligne
                    // (par numero — fiable même avec des branchements/boucles,
                    // contrairement à un simple appariement par position).
                    const traceLigne = dernierResultat?.trace?.filter((t: any) => t.numero === it.numero).pop();
                    return (
                      <tr
                        key={`${realIdx}-${it.numero}`}
                        draggable
                        onDragStart={(e) => { setDragVIdx(vIdx); e.dataTransfer.effectAllowed = "move"; }}
                        onDragOver={(e) => { e.preventDefault(); if (dragVIdx != null && dragVIdx !== vIdx) setDragOverVIdx(vIdx); }}
                        onDragLeave={() => setDragOverVIdx((v) => (v === vIdx ? null : v))}
                        onDrop={(e) => { e.preventDefault(); handleDropInstr(vIdx); }}
                        onDragEnd={() => { setDragVIdx(null); setDragOverVIdx(null); }}
                        className={`hover:bg-muted/20 transition-colors ${dragOverVIdx === vIdx ? "border-t-2 border-t-accent" : ""} ${dragVIdx === vIdx ? "opacity-40" : ""}`}
                      >
                        <td className="px-1 py-2 cursor-grab active:cursor-grabbing text-center" title="Glisser pour réordonner">
                          <GripVertical size={12} className="text-muted-foreground/50 inline-block" />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" value={it.numero}
                            onChange={(e) => updateInstr(realIdx, { numero: parseInt(e.target.value, 10) || 0 })}
                            className="h-8 text-xs font-mono w-14 text-center" />
                        </td>
                        <td className="px-2 py-2">
                          <SmartRuleEditor value={it.instruction}
                            palette={palette}
                            rubriques={rubriques}
                            constantes={constantes}
                            registerInserter={enregistrerInserteur}
                            onChange={(v) => updateInstr(realIdx, { instruction: upperKeepStrings(v) })}
                            placeholder={'Ex : R01 = [SALBASE].MT + CUMUL("SALBASE")'}
                            className={`h-8 px-2 py-1.5 text-xs font-mono rounded-md border ${!isValid ? "border-destructive text-destructive bg-destructive/5 animate-pulse" : avertServeur ? "border-[hsl(var(--warning)/0.7)] bg-[hsl(var(--warning)/0.05)]" : "border-input bg-background"}`} />
                          {errServeur && (
                            <div className="text-[10px] text-destructive mt-0.5 ml-1 flex items-start gap-1">
                              <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {errServeur}
                            </div>
                          )}
                          {!errServeur && !isValid && (
                            <div className="text-[10px] text-destructive mt-0.5 ml-1 flex items-start gap-1">
                              <AlertTriangle size={10} className="mt-0.5 shrink-0" /> Instruction non reconnue
                            </div>
                          )}
                          {!errServeur && isValid && avertServeur && (
                            <div className="text-[10px] mt-0.5 ml-1 flex items-start gap-1" style={{ color: "hsl(var(--warning))" }}>
                              <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {avertServeur}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Input value={it.label || ""}
                            onChange={(e) => updateInstr(realIdx, { label: e.target.value || null })}
                            placeholder="—"
                            className="h-8 text-[11px] font-mono w-20" />
                        </td>
                        {dernierResultat && (
                          <td className="px-2 py-2">
                            {traceLigne ? (
                              <span
                                className="text-[11px] font-mono px-1.5 py-0.5 rounded inline-block max-w-[9rem] truncate align-middle"
                                style={traceLigne.avert
                                  ? { background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }
                                  : { background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}
                                title={traceLigne.resolu || traceLigne.avert || ""}
                              >
                                {traceLigne.resolu || traceLigne.avert || "—"}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground/40">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-2 py-2">
                          <Input value={it.commentaire || ""}
                            onChange={(e) => updateInstr(realIdx, { commentaire: e.target.value || null })}
                            placeholder="Annotation…"
                            title={it.commentaire || ""}
                            className="h-8 text-[11px] italic w-32 text-muted-foreground" />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <Switch checked={it.est_actif}
                            onCheckedChange={(v) => updateInstr(realIdx, { est_actif: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => moveInstr(vIdx, -1)} disabled={vIdx === 0} title="Monter">
                              <ArrowUp size={12} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => moveInstr(vIdx, 1)} disabled={vIdx === visibleInstr.length - 1} title="Descendre">
                              <ArrowDown size={12} />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeInstr(realIdx)} title="Supprimer">
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between p-2 bg-muted/20 border-t border-border">
                <span className="text-[11px] text-muted-foreground">
                  {visibleInstr.length} ligne{visibleInstr.length > 1 ? "s" : ""}
                </span>
                <Button size="sm" variant="outline" onClick={addInstr} className="gap-1.5 h-8">
                  <Plus size={13} /> Ajouter une ligne
                </Button>
              </div>
            </div>
            </>
          )}

          {/* Mode TEXTE */}
          {mode === "TEXTE" && (
            <div>
              <SmartRuleEditor
                multiline
                value={form.instructions_text}
                palette={palette}
                rubriques={rubriques}
                constantes={constantes}
                registerInserter={enregistrerInserteur}
                onChange={(v) => setForm({ ...form, instructions_text: upperKeepStrings(v) })}
                placeholder={`10  R01 = [SALBASE].MT\n20  R02 = NB / 26\n30  MT = ARRONDI(R01 * R02, 2)\n40  SI MT <= 0 ALORS FIN`}
                className="text-xs font-mono min-h-[260px] leading-relaxed p-3 rounded-md border border-input bg-background" />
              <p className="text-[11px] text-muted-foreground mt-1">
                Format : <code>numéro  instruction  :LABEL  ; commentaire</code>. Une ligne par instruction.
              </p>
            </div>
          )}

          {/* Validité */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
            <div>
              <Label htmlFor="dd" className="text-xs">Date début validité</Label>
              <Input id="dd" type="date" value={form.date_debut_validite}
                onChange={(e) => setForm({ ...form, date_debut_validite: e.target.value })}
                className="h-9 text-sm" />
            </div>
            <div>
              <Label htmlFor="df" className="text-xs">Date fin validité</Label>
              <Input id="df" type="date" value={form.date_fin_validite}
                onChange={(e) => setForm({ ...form, date_fin_validite: e.target.value })}
                className="h-9 text-sm" />
            </div>
          </div>

          <div>
            <Label htmlFor="decision" className="text-xs">Référence de décision</Label>
            <Input id="decision" value={form.decision_reference}
              onChange={(e) => setForm({ ...form, decision_reference: e.target.value })}
              placeholder="Note interne, Convention CCN art…" className="h-9 text-sm" />
          </div>

          <div>
            <Label htmlFor="commentaire" className="text-xs">Commentaire interne</Label>
            <Textarea id="commentaire" value={form.commentaire}
              onChange={(e) => setForm({ ...form, commentaire: e.target.value })}
              className="text-sm min-h-[60px]" />
          </div>

          {/* Workflow de validation */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <Label className="text-sm font-medium">Statut de la règle</Label>
                <p className="text-[11px] text-muted-foreground">
                  Seules les règles VALIDÉES sont utilisées dans le calcul de paie.
                </p>
              </div>
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                style={
                  form.statut === "VALIDEE"
                    ? { background: "hsl(145 60% 90%)", color: "hsl(145 60% 30%)" }
                    : form.statut === "ARCHIVEE"
                    ? { background: "hsl(0 0% 90%)", color: "hsl(0 0% 40%)" }
                    : { background: "hsl(45 95% 90%)", color: "hsl(35 85% 35%)" }
                }
              >
                {form.statut === "VALIDEE" && "✓ Validée — En production"}
                {form.statut === "ARCHIVEE" && "○ Archivée"}
                {form.statut === "BROUILLON" && "✎ Brouillon"}
              </span>
            </div>

            {form.statut === "VALIDEE" && form.date_validation && (
              <div className="text-[11px] text-muted-foreground bg-background/60 rounded p-2 border border-border">
                <p>
                  Validée le{" "}
                  <strong>{new Date(form.date_validation).toLocaleString("fr-FR")}</strong>
                </p>
                {form.commentaire_validation && (
                  <p className="mt-1 italic">"{form.commentaire_validation}"</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {form.statut === "BROUILLON" && editId && (
                <Button
                  size="sm"
                  type="button"
                  onClick={handleValider}
                  disabled={saving}
                  className="gap-1.5"
                  style={{ background: "hsl(145 60% 42%)", color: "white" }}
                >
                  ✓ Valider la règle
                </Button>
              )}
              {form.statut === "VALIDEE" && (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={handleArchiver}
                  disabled={saving}
                  className="gap-1.5"
                >
                  📦 Archiver
                </Button>
              )}
              {form.statut === "ARCHIVEE" && (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={handleReactiver}
                  disabled={saving}
                  className="gap-1.5"
                >
                  ↺ Réactiver (en brouillon)
                </Button>
              )}
              {!editId && (
                <p className="text-[11px] text-muted-foreground italic">
                  Enregistrez la règle pour pouvoir la valider.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Aide à la syntaxe */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 sticky top-4 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Syntaxe disponible</h3>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-2">
              Cliquez un élément pour l'insérer où votre curseur se trouve.
            </p>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={rechercheSyntaxe}
                onChange={(e) => setRechercheSyntaxe(e.target.value)}
                placeholder="Rechercher une fonction…"
                className="w-full h-7 pl-6 pr-2 text-[11px] rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <ul className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {Object.entries(
                palette
                  .filter((v) => !rechercheSyntaxe.trim()
                    || v.syntax.toUpperCase().includes(rechercheSyntaxe.toUpperCase())
                    || v.desc.toUpperCase().includes(rechercheSyntaxe.toUpperCase()))
                  .reduce((acc, v) => { (acc[v.cat || "Général"] ||= []).push(v); return acc; }, {} as Record<string, typeof palette>)
              ).map(([cat, items]) => {
                const Icone = CAT_ICONES[cat] || Info;
                return (
                  <li key={cat}>
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mt-2 mb-1">
                      <Icone size={11} /> {cat}
                    </div>
                    <ul className="space-y-1">
                      {items.map((v) => (
                        <li key={v.syntax}>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                onClick={() => insererDepuisSidebar(texteAInserer(v))}
                                className="w-full text-left rounded-md px-1.5 py-1 hover:bg-accent/15 transition-colors group"
                              >
                                <code className="text-[11px] font-mono text-accent block group-hover:underline">{v.syntax}</code>
                                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{v.desc}</p>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="left" className="w-64 p-3 text-xs space-y-1.5">
                              <p className="font-semibold text-foreground">{v.syntax}</p>
                              <p className="text-muted-foreground leading-snug">{v.desc}</p>
                              <div className="pt-1.5 mt-1.5 border-t border-border">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mb-1">Exemple</p>
                                <code className="block text-[11px] font-mono bg-muted rounded px-2 py-1 whitespace-pre-line">{exempleUsage(v)}</code>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>

            <div className="pt-3 border-t border-accent/20">
              <h4 className="text-[11px] font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                <Play size={11} /> Exemple (calcul IGR)
              </h4>
              <pre className="text-[10px] font-mono leading-relaxed text-muted-foreground bg-background/50 p-2 rounded border border-border whitespace-pre">{`10  R10 = [IGRA].MT + CUMUL("IGRA")
15  R12 = [FP].MT + CUMUL("FP")
20  R11 = R10 - R12
45  R11 = R11 * 10 / 100
50  R22 = MIN(R20, R21)
55  R01 = R11 - R22
250 SI R02 = 0 ALORS FIN
300 MT = R01 / R02
500 TX = BAREME("IGR", MT)`}</pre>
            </div>

            <div className="pt-3 border-t border-accent/20">
              <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
                <CheckCircle2 size={11} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--success))" }} />
                Les numéros (10, 15, 20…) ordonnent l'exécution. Laissez des trous pour insérer plus tard.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5 mt-1.5">
                <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--warning))" }} />
                Le label <code>FIN</code> est la cible standard de fin de règle.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Panneau de simulation (sandbox) */}
      <SimulationPanel
        open={simOpen}
        onClose={() => setSimOpen(false)}
        onResult={setDernierResultat}
        regleLibelle={form.libelle || form.code}
        lignes={
          mode === "TABLEUR"
            ? visibleInstr.map((i) => ({ numero: i.numero, instruction: i.instruction, label: i.label }))
            : form.instructions_text
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l, idx) => {
                  const m = l.match(/^(\d+)\s+(.+)$/);
                  let numero = (idx + 1) * 10;
                  let body = l;
                  if (m) { numero = parseInt(m[1], 10); body = m[2]; }
                  let label: string | null = null;
                  const cIdx = body.indexOf(";");
                  if (cIdx >= 0) body = body.slice(0, cIdx).trim();
                  const lblMatch = body.match(/\s:(\w+)\s*$/);
                  if (lblMatch) {
                    label = lblMatch[1];
                    body = body.replace(/\s:\w+\s*$/, "").trim();
                  }
                  return { numero, instruction: body, label };
                })
        }
      />
    </div>
  );
};

export default RegleSpecifiqueForm;
