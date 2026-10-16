/**
 * JournalGrilleConfigPage — Configuration du Journal de paie en grille
 * (format réglementaire : jours travaillés, congés, indemnités, CNSS/AMO,
 * IR, net à payer…).
 *
 * C'est ICI que se configurent les rubriques à imprimer : chaque case du
 * tableau (ligne, colonne) est associée soit à un champ d'identité du
 * collaborateur, soit à une rubrique de paie (avec son attribut MT/NB/TX),
 * soit à un texte fixe. Rien n'est codé en dur côté serveur — tout est
 * modifiable ici et sauvegardé en base.
 *
 * Route suggérée : /paie/editions/journal-grille
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Save, Check, ChevronsUpDown, AlertTriangle, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { db } from "@/lib/api";
import {
  rapportsApi,
  type GrilleCase,
  type ChampsDisponibles,
  type RapportTemplate,
  type PerimetreJournal,
  type GrilleApercuResponse,
  type GrilleCondition,
  type GrilleMasque,
  type OperateurCondition,
} from "@/lib/rapportsApi";

const TEMPLATE_CODE_GRILLE = "JOURNAL_GRILLE_STD";

// Plan/Période : mêmes types et même table (calendrier_paie) que
// JournalPaiePage.tsx, pour rester cohérent avec le reste du module Paie.
type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; plan_paie_id: string | null; statut: string; numero_periode: number };
const MOIS = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const periodeLabel = (p: Periode) => `${MOIS[p.mois]} ${p.annee}`;

type RubriquePaieOption = ChampsDisponibles["rubriques"][number];

// Dimensions FIXES (pas de 1fr/auto) : indispensable pour convertir un
// déplacement en pixels (pointermove) en delta ligne/colonne exact pendant
// le drag — avec des tailles flexibles, la grille se redimensionnerait
// sous le curseur et fausserait le calcul.
const LARGEUR_CELLULE = 100;
const HAUTEUR_CELLULE = 56;
const ESPACEMENT = 3;

const COULEUR_SOURCE: Record<GrilleCase["type_source"], { bg: string; border: string }> = {
  IDENTITE: { bg: "hsl(217 91% 60% / 0.12)", border: "hsl(217 91% 60%)" },
  RUBRIQUE: { bg: "hsl(142 71% 45% / 0.12)", border: "hsl(142 71% 45%)" },
  CONSTANTE: { bg: "hsl(var(--muted))", border: "hsl(var(--border))" },
};

// Combobox mono-sélection pour un code de rubrique — même pattern que les
// sélecteurs collaborateur déjà utilisés ailleurs (BulletinConfigPage,
// JournalPaiePage) ; remplace la saisie libre, source d'erreurs silencieuses.
function RubriqueCombobox({
  value, onChange, options,
}: {
  value: string;
  onChange: (code: string) => void;
  options: RubriquePaieOption[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const selection = options.find((o) => o.code === value);
  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-44 justify-between font-normal h-9">
          <span className="truncate text-xs">{selection ? `${selection.code}` : (value || "Choisir…")}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Code ou libellé…" />
          <CommandList>
            <CommandEmpty>Aucune rubrique.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.code}
                  value={`${o.code} ${o.libelle}`}
                  onSelect={() => { onChange(o.code); setOuvert(false); }}
                >
                  <Check className={`mr-2 h-4 w-4 ${o.code === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="font-mono text-xs mr-2">{o.code}</span>
                  <span className="text-muted-foreground">{o.libelle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Inspecteur de case : onglets « Affichage » et « Condition ».
// L'onglet « Donnée » (d'où vient la valeur) est le formulaire historique.
// Toute la mise en forme est calculée côté serveur : ces onglets ne font que
// choisir des réglages, ils ne formatent rien eux-mêmes.
// ---------------------------------------------------------------------------

type ModeSiVide = "tiret" | "vide" | "texte";

function OngletAffichage({
  c, onChange, masques,
}: {
  c: GrilleCase;
  onChange: (patch: Partial<GrilleCase>) => void;
  masques: GrilleMasque[];
}) {
  // valeur_si_vide : null = tiret (défaut historique) ; "" = vide ; texte = ce texte.
  // Le mode est mémorisé à part : sinon vider le champ texte basculerait en « vide »
  // et le champ disparaîtrait pendant la frappe.
  const [modeSiVide, setModeSiVide] = useState<ModeSiVide>(
    c.valeur_si_vide == null ? "tiret" : c.valeur_si_vide === "" ? "vide" : "texte",
  );
  const masque = masques.find((m) => m.code === c.masque);

  function changerMode(mode: ModeSiVide) {
    setModeSiVide(mode);
    if (mode === "tiret") onChange({ valeur_si_vide: null });
    else if (mode === "vide") onChange({ valeur_si_vide: "" });
    else onChange({ valeur_si_vide: c.valeur_si_vide || "n/a" });
  }

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Masque d'affichage</label>
        <Select value={c.masque || "__aucun"} onValueChange={(v) => onChange({ masque: v === "__aucun" ? null : v })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__aucun">Aucun (valeur telle quelle)</SelectItem>
            {masques.map((m) => (
              <SelectItem key={m.code} value={m.code}>
                {m.libelle}{m.exemple ? ` — ${m.exemple}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Texte avant</label>
          <Input className="h-8" placeholder="ex. Né(e) le " value={c.texte_avant ?? ""}
            onChange={(e) => onChange({ texte_avant: e.target.value || null })} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Texte après</label>
          <Input className="h-8" placeholder="ex.  DH" value={c.texte_apres ?? ""}
            onChange={(e) => onChange({ texte_apres: e.target.value || null })} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Quand il n'y a pas de valeur</label>
        <div className="flex gap-1.5">
          <Select value={modeSiVide} onValueChange={(v) => changerMode(v as ModeSiVide)}>
            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tiret">Afficher un tiret</SelectItem>
              <SelectItem value="vide">Laisser vide</SelectItem>
              <SelectItem value="texte">Afficher un texte</SelectItem>
            </SelectContent>
          </Select>
          {modeSiVide === "texte" && (
            <Input className="h-8 flex-1" value={c.valeur_si_vide ?? ""}
              onChange={(e) => onChange({ valeur_si_vide: e.target.value })} />
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground rounded-md bg-muted/50 px-2 py-1.5">
        {masque
          ? <>Exemple : <span className="font-medium text-foreground">{c.texte_avant ?? ""}{masque.exemple}{c.texte_apres ?? ""}</span></>
          : "Choisis un masque pour reformater la valeur (dates, montants, majuscules…)."}
      </p>
    </div>
  );
}

const OPERATEURS: { code: OperateurCondition; libelle: string; avecValeur: boolean }[] = [
  { code: "RENSEIGNEE", libelle: "est renseignée", avecValeur: false },
  { code: "NON_ZERO", libelle: "est différente de zéro", avecValeur: false },
  { code: "EGAL", libelle: "est égale à", avecValeur: true },
  { code: "DIFFERENT", libelle: "est différente de", avecValeur: true },
  { code: "SUPERIEUR", libelle: "est supérieure à", avecValeur: true },
  { code: "INFERIEUR", libelle: "est inférieure à", avecValeur: true },
  { code: "CONTIENT", libelle: "contient", avecValeur: true },
];

function OngletCondition({
  c, onChange, toutesLesCases,
}: {
  c: GrilleCase;
  onChange: (patch: Partial<GrilleCase>) => void;
  toutesLesCases: GrilleCase[];
}) {
  const cond = c.condition_affichage;
  const maClef = `${c.ligne}_${c.colonne}`;
  const operateur = OPERATEURS.find((o) => o.code === cond?.operateur);

  function majCondition(patch: Partial<GrilleCondition>) {
    onChange({
      condition_affichage: { cible: "SELF", operateur: "RENSEIGNEE", sinon: "VIDE", ...cond, ...patch },
    });
  }

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Afficher cette case</label>
        <Select
          value={cond ? "conditionnel" : "toujours"}
          onValueChange={(v) => onChange({ condition_affichage: v === "toujours" ? null : { cible: "SELF", operateur: "RENSEIGNEE", sinon: "VIDE" } })}
        >
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="toujours">Toujours</SelectItem>
            <SelectItem value="conditionnel">Seulement si…</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {cond && (
        <>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Si la valeur de</label>
            <Select value={cond.cible || "SELF"} onValueChange={(v) => majCondition({ cible: v })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SELF">cette case</SelectItem>
                {toutesLesCases
                  .filter((o) => `${o.ligne}_${o.colonne}` !== maClef)
                  .map((o) => (
                    <SelectItem key={`${o.ligne}_${o.colonne}`} value={`${o.ligne}_${o.colonne}`}>
                      {o.libelle || "(sans libellé)"} · L{o.ligne} C{o.colonne}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-1.5">
            <Select value={cond.operateur} onValueChange={(v) => majCondition({ operateur: v as OperateurCondition })}>
              <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATEURS.map((o) => <SelectItem key={o.code} value={o.code}>{o.libelle}</SelectItem>)}
              </SelectContent>
            </Select>
            {operateur?.avecValeur && (
              <Input className="h-8 w-28" placeholder="valeur" value={cond.valeur ?? ""}
                onChange={(e) => majCondition({ valeur: e.target.value })} />
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Sinon</label>
            <Select value={cond.sinon} onValueChange={(v) => majCondition({ sinon: v as GrilleCondition["sinon"] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="VIDE">laisser la valeur vide (la case reste en place)</SelectItem>
                <SelectItem value="MASQUER">effacer toute la case (libellé compris)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}

// Formulaire affiché dans le popup ouvert au clic sur une case de la grille —
// reprend les mêmes champs que la ligne du tableau, pour éditer sans y aller.
function PropertesCase({
  c, onChange, onSupprimer, champs, masques, toutesLesCases,
}: {
  c: GrilleCase;
  onChange: (patch: Partial<GrilleCase>) => void;
  onSupprimer: () => void;
  champs: ChampsDisponibles | null;
  masques: GrilleMasque[];
  toutesLesCases: GrilleCase[];
}) {
  const [onglet, setOnglet] = useState<"donnee" | "affichage" | "condition">("donnee");
  const habillee = !!(c.masque || c.texte_avant || c.texte_apres || c.valeur_si_vide != null);
  const conditionnelle = !!c.condition_affichage;
  const ONGLETS: { id: typeof onglet; libelle: string; actif: boolean }[] = [
    { id: "donnee", libelle: "Donnée", actif: false },
    { id: "affichage", libelle: "Affichage", actif: habillee },
    { id: "condition", libelle: "Condition", actif: conditionnelle },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground truncate pr-2">{c.libelle || "Case sans libellé"}</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onSupprimer}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>

      <div className="flex gap-0.5 border-b" style={{ borderColor: "hsl(var(--border))" }}>
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOnglet(o.id)}
            className="px-2.5 py-1.5 text-xs -mb-px border-b-2 transition-colors"
            style={{
              borderColor: onglet === o.id ? "hsl(var(--primary))" : "transparent",
              color: onglet === o.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
              fontWeight: onglet === o.id ? 600 : 400,
            }}
          >
            {o.libelle}
            {o.actif && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ background: "hsl(var(--primary))" }} />}
          </button>
        ))}
      </div>

      {onglet === "affichage" && <OngletAffichage c={c} onChange={onChange} masques={masques} />}
      {onglet === "condition" && <OngletCondition c={c} onChange={onChange} toutesLesCases={toutesLesCases} />}

      {onglet === "donnee" && (<>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Libellé imprimé</label>
        <Input className="h-8" value={c.libelle} onChange={(e) => onChange({ libelle: e.target.value })} />
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Ligne</label>
          <Input type="number" className="h-8" value={c.ligne} onChange={(e) => onChange({ ligne: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Col.</label>
          <Input type="number" className="h-8" value={c.colonne} onChange={(e) => onChange({ colonne: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Fusion L</label>
          <Input type="number" className="h-8" value={c.rowspan} onChange={(e) => onChange({ rowspan: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Fusion C</label>
          <Input type="number" className="h-8" value={c.colspan} onChange={(e) => onChange({ colspan: Number(e.target.value) })} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Source</label>
        <Select value={c.type_source} onValueChange={(v) => onChange({ type_source: v as GrilleCase["type_source"] })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="IDENTITE">Identité</SelectItem>
            <SelectItem value="RUBRIQUE">Rubrique</SelectItem>
            <SelectItem value="CONSTANTE">Texte fixe</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {c.type_source === "IDENTITE" && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Champ</label>
          <Select value={c.cle_identite ?? ""} onValueChange={(v) => onChange({ cle_identite: v })}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Choisir un champ…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="identite.nom_complet">Civilité + Nom + Prénom</SelectItem>
              {champs?.champs_snapshot.map((f) => (
                <SelectItem key={f.cle} value={f.cle}>{f.libelle}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {c.type_source === "RUBRIQUE" && (
        <>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Rubrique</label>
            <RubriqueCombobox
              value={c.code_rubrique ?? ""}
              options={champs?.rubriques || []}
              onChange={(code) => onChange({ code_rubrique: code })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Attribut</label>
            <Select value={c.attribut ?? "MT"} onValueChange={(v) => onChange({ attribut: v as GrilleCase["attribut"] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MT">Montant</SelectItem>
                <SelectItem value="NB">Nombre</SelectItem>
                <SelectItem value="TX">Taux</SelectItem>
                <SelectItem value="BASE">Base</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      {c.type_source === "CONSTANTE" && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Texte à afficher</label>
          <Input className="h-8" value={c.valeur_constante ?? ""} onChange={(e) => onChange({ valeur_constante: e.target.value })} />
        </div>
      )}
      </>)}
    </div>
  );
}

export default function JournalGrilleConfigPage() {
  const navigate = useNavigate();
  const [template, setTemplate] = useState<RapportTemplate | null>(null);
  const [cases, setCases] = useState<GrilleCase[]>([]);
  const [champs, setChamps] = useState<ChampsDisponibles | null>(null);
  const [masques, setMasques] = useState<GrilleMasque[]>([]);
  const [chargement, setChargement] = useState(true);
  const [sauvegarde, setSauvegarde] = useState(false);

  const [apercu, setApercu] = useState<GrilleApercuResponse | null>(null);
  const [apercuEnCours, setApercuEnCours] = useState(false);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState<string>("");
  const [periodesDuPlan, setPeriodesDuPlan] = useState<Periode[]>([]);
  const [periodeId, setPeriodeId] = useState<string>("");
  const [indexSelectionne, setIndexSelectionne] = useState<number | null>(null);
  const lignesRef = useRef<(HTMLTableRowElement | null)[]>([]);

  // -- Drag & drop de la grille visuelle (déplacement + redimensionnement) --
  const dragInfo = useRef<{
    index: number;
    mode: "deplacer" | "redimensionner";
    startX: number; startY: number;
    ligneDepart: number; colonneDepart: number;
    rowspanDepart: number; colspanDepart: number;
    aBouge: boolean;
  } | null>(null);
  const [dragApercu, setDragApercu] = useState<{
    index: number; ligne: number; colonne: number; rowspan: number; colspan: number;
  } | null>(null);
  const dragJustEnded = useRef(false);
  const [caseOuverte, setCaseOuverte] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [tpls, ch, pls, mqs] = await Promise.all([
          rapportsApi.listerTemplates("JOURNAL"),
          rapportsApi.champsDisponibles(),
          db.list<Plan>("plan_paie", { select: "id,code,libelle", limit: 200 }),
          // Les masques viennent du serveur (registre unique) : un nouveau masque
          // ajouté côté moteur apparaît ici sans modifier l'écran. Un échec ne doit
          // pas bloquer la configuration de la grille.
          rapportsApi.masquesGrille().catch(() => [] as GrilleMasque[]),
        ]);
        const tpl = tpls.find((t) => t.code === TEMPLATE_CODE_GRILLE);
        if (!tpl) {
          toast.error(`Template ${TEMPLATE_CODE_GRILLE} introuvable — vérifie que la migration SQL a été exécutée.`);
          return;
        }
        setTemplate(tpl);
        setChamps(ch);
        setPlans(pls);
        setMasques(mqs);
        const cs = await rapportsApi.lireConfigGrille(tpl.id);
        setCases(cs.sort((a, b) => a.ordre_affichage - b.ordre_affichage));
      } catch (e: any) {
        toast.error("Chargement impossible", { description: e.message });
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  // À la sélection du plan, charger ses périodes — même cascade que
  // JournalPaiePage.tsx (mode "periode_plan").
  useEffect(() => {
    if (!planId) { setPeriodesDuPlan([]); setPeriodeId(""); return; }
    (async () => {
      try {
        const pers = await db.list<Periode>("calendrier_paie", {
          plan_paie_id: planId,
          select: "id,annee,mois,plan_paie_id,statut,numero_periode",
          order: "-annee", limit: 600,
        });
        pers.sort((a, b) => b.annee - a.annee || b.mois - a.mois);
        setPeriodesDuPlan(pers);
        setPeriodeId(pers[0]?.id || "");
      } catch (e: any) {
        toast.error("Chargement des périodes impossible", { description: e.message });
      }
    })();
  }, [planId]);

  function majCase(index: number, patch: Partial<GrilleCase>) {
    setCases((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function ajouterCase() {
    setCases((prev) => [
      ...prev,
      {
        ligne: 1, colonne: 1, rowspan: 1, colspan: 1,
        libelle: "Nouvelle case", type_source: "RUBRIQUE",
        code_rubrique: "", attribut: "MT",
        ordre_affichage: (prev.at(-1)?.ordre_affichage ?? 0) + 10,
      },
    ]);
  }

  function supprimerCase(index: number) {
    setCases((prev) => prev.filter((_, i) => i !== index));
  }

  function demarrerDrag(e: React.PointerEvent, index: number, mode: "deplacer" | "redimensionner") {
    e.preventDefault();
    e.stopPropagation();
    const c = cases[index];
    dragInfo.current = {
      index, mode,
      startX: e.clientX, startY: e.clientY,
      ligneDepart: c.ligne, colonneDepart: c.colonne,
      rowspanDepart: Math.max(1, c.rowspan || 1), colspanDepart: Math.max(1, c.colspan || 1),
      aBouge: false,
    };
    setDragApercu({ index, ligne: c.ligne, colonne: c.colonne, rowspan: c.rowspan || 1, colspan: c.colspan || 1 });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function pendantDrag(e: React.PointerEvent) {
    const info = dragInfo.current;
    if (!info) return;
    const dx = e.clientX - info.startX;
    const dy = e.clientY - info.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) info.aBouge = true;
    if (!info.aBouge) return;

    const deltaColonnes = Math.round(dx / (LARGEUR_CELLULE + ESPACEMENT));
    const deltaLignes = Math.round(dy / (HAUTEUR_CELLULE + ESPACEMENT));

    if (info.mode === "deplacer") {
      setDragApercu({
        index: info.index,
        ligne: Math.max(1, info.ligneDepart + deltaLignes),
        colonne: Math.max(1, info.colonneDepart + deltaColonnes),
        rowspan: info.rowspanDepart, colspan: info.colspanDepart,
      });
    } else {
      setDragApercu({
        index: info.index,
        ligne: info.ligneDepart, colonne: info.colonneDepart,
        rowspan: Math.max(1, info.rowspanDepart + deltaLignes),
        colspan: Math.max(1, info.colspanDepart + deltaColonnes),
      });
    }
  }

  function terminerDrag(e: React.PointerEvent) {
    const info = dragInfo.current;
    if (!info) return;
    if (info.aBouge && dragApercu) {
      if (info.mode === "deplacer") {
        majCase(info.index, { ligne: dragApercu.ligne, colonne: dragApercu.colonne });
      } else {
        majCase(info.index, { rowspan: dragApercu.rowspan, colspan: dragApercu.colspan });
      }
      // Un vrai drag vient de se produire : le "click" de souris qui suit
      // encore le relâchement (même élément down/up) ne doit pas rouvrir
      // le popup — intercepté dans l'onClick du déclencheur ci-dessous.
      dragJustEnded.current = true;
    }
    dragInfo.current = null;
    setDragApercu(null);
  }

  function clicCase(e: React.MouseEvent, index: number) {
    if (dragJustEnded.current) {
      dragJustEnded.current = false;
      e.preventDefault();
      return;
    }
    setIndexSelectionne(index);
  }

  async function sauvegarderTout() {
    if (!template) return;
    setSauvegarde(true);
    try {
      const cs = await rapportsApi.sauvegarderConfigGrille(template.id, cases);
      setCases(cs.sort((a, b) => a.ordre_affichage - b.ordre_affichage));
      toast.success("Configuration enregistrée");
      navigate(-1);
    } catch (e: any) {
      toast.error("Échec de l'enregistrement", { description: e.message });
    } finally {
      setSauvegarde(false);
    }
  }

  function construirePerimetre(): PerimetreJournal | null {
    if (!planId || !periodeId) return null;
    return { mode: "periode_plan", plan_paie_id: planId, periode_id: periodeId };
  }

  async function lancerApercu() {
    const perimetre = construirePerimetre();
    if (!template || !perimetre) {
      toast.error("Choisis un plan de paie et une période avant de générer l'aperçu.");
      return;
    }
    setApercuEnCours(true);
    try {
      const res = await rapportsApi.apercuGrille(template.id, perimetre);
      setApercu(res);
    } catch (e: any) {
      toast.error("Aperçu impossible", { description: e.message });
    } finally {
      setApercuEnCours(false);
    }
  }

  async function exporterPdf() {
    const perimetre = construirePerimetre();
    if (!template || !perimetre) {
      toast.error("Choisis un plan de paie et une période avant d'exporter.");
      return;
    }
    setExportEnCours(true);
    try {
      const blob = await rapportsApi.genererGrillePdf(template.id, perimetre);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "journal_grille.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("Export impossible", { description: e.message });
    } finally {
      setExportEnCours(false);
    }
  }

  // Dimensions de la grille + détection des chevauchements (deux cases
  // revendiquant la même cellule) — invisible dans le tableau plat, source
  // réelle d'erreurs quand ligne/colonne/fusion sont saisis à la main.
  const { nbLignes, nbColonnes, indexEnConflit } = useMemo(() => {
    let maxLigne = 1, maxColonne = 1;
    const occupation = new Map<string, number[]>();
    cases.forEach((c, i) => {
      const rowspan = Math.max(1, c.rowspan || 1);
      const colspan = Math.max(1, c.colspan || 1);
      maxLigne = Math.max(maxLigne, c.ligne + rowspan - 1);
      maxColonne = Math.max(maxColonne, c.colonne + colspan - 1);
      for (let dl = 0; dl < rowspan; dl++) {
        for (let dc = 0; dc < colspan; dc++) {
          const clef = `${c.ligne + dl}_${c.colonne + dc}`;
          occupation.set(clef, [...(occupation.get(clef) || []), i]);
        }
      }
    });
    const conflits = new Set<number>();
    occupation.forEach((indices) => {
      if (indices.length > 1) indices.forEach((i) => conflits.add(i));
    });
    return { nbLignes: maxLigne, nbColonnes: maxColonne, indexEnConflit: conflits };
  }, [cases]);

  const nbLignesAffiche = dragApercu ? Math.max(nbLignes, dragApercu.ligne + dragApercu.rowspan - 1) : nbLignes;
  const nbColonnesAffiche = dragApercu ? Math.max(nbColonnes, dragApercu.colonne + dragApercu.colspan - 1) : nbColonnes;

  function selectionner(index: number) {
    setIndexSelectionne(index);
    lignesRef.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (chargement) {
    return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  }

  if (!template) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          Le template "{TEMPLATE_CODE_GRILLE}" n'existe pas encore. Exécute la migration
          <code className="mx-1 px-1 bg-muted rounded">24_journal_grille.sql</code>
          puis recharge cette page.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuration du Journal (grille officielle)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Chaque case du tableau imprimé est associée à un champ ou une rubrique de paie.
          Modifie librement ce qui est imprimé, sans toucher au code.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Cases de la grille
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={ajouterCase}>
                <Plus className="h-4 w-4 mr-1" /> Ajouter une case
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate(-1)} disabled={sauvegarde}>
                Annuler
              </Button>
              <Button size="sm" onClick={sauvegarderTout} disabled={sauvegarde}>
                {sauvegarde ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Enregistrer
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {indexEnConflit.size > 0 && (
            <div className="mb-3 flex items-center gap-2 text-sm rounded-md border px-3 py-2"
                 style={{ borderColor: "hsl(0 72% 51% / 0.4)", background: "hsl(0 72% 51% / 0.08)", color: "hsl(0 72% 40%)" }}>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {indexEnConflit.size} case(s) se chevauchent (même ligne/colonne) — repérables en rouge ci-dessous et dans le tableau.
            </div>
          )}

          {/* Grille visuelle : aperçu en temps réel de la mise en page imprimée.
              Cliquer une case fait défiler jusqu'à sa ligne dans le tableau
              d'édition ci-dessous. */}
          <div
            className="mb-5 rounded-lg border p-3 overflow-auto"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)", maxHeight: 520 }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${nbColonnesAffiche}, ${LARGEUR_CELLULE}px)`,
                gridTemplateRows: `repeat(${nbLignesAffiche}, ${HAUTEUR_CELLULE}px)`,
                gap: `${ESPACEMENT}px`,
                position: "relative",
              }}
            >
              {cases.map((c, i) => {
                const couleur = COULEUR_SOURCE[c.type_source] || COULEUR_SOURCE.CONSTANTE;
                const enConflit = indexEnConflit.has(i);
                const selectionnee = indexSelectionne === i;
                const enDrag = dragApercu?.index === i;
                // Pendant un drag, la case affiche sa position/taille en
                // cours (dragApercu) plutôt que sa valeur persistée — le
                // commit réel n'a lieu qu'au relâchement (terminerDrag).
                const ligne = enDrag ? dragApercu!.ligne : c.ligne;
                const colonne = enDrag ? dragApercu!.colonne : c.colonne;
                const rowspan = enDrag ? dragApercu!.rowspan : Math.max(1, c.rowspan || 1);
                const colspan = enDrag ? dragApercu!.colspan : Math.max(1, c.colspan || 1);
                return (
                  <Popover
                    key={c.id ?? i}
                    open={caseOuverte === i}
                    onOpenChange={(ouvert) => setCaseOuverte(ouvert ? i : null)}
                  >
                    <PopoverTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCaseOuverte(i); }}
                        onPointerDown={(e) => demarrerDrag(e, i, "deplacer")}
                        onPointerMove={pendantDrag}
                        onPointerUp={terminerDrag}
                        onClick={(e) => clicCase(e, i)}
                        className="group relative rounded-md border px-2 py-1.5 text-left text-xs select-none"
                        style={{
                          gridColumn: `${colonne} / span ${colspan}`,
                          gridRow: `${ligne} / span ${rowspan}`,
                          background: enConflit ? "hsl(0 72% 51% / 0.15)" : couleur.bg,
                          borderColor: enConflit ? "hsl(0 72% 51%)" : couleur.border,
                          boxShadow: selectionnee ? `0 0 0 2px ${enConflit ? "hsl(0 72% 51%)" : couleur.border}` : "none",
                          cursor: enDrag ? "grabbing" : "grab",
                          zIndex: enDrag ? 10 : 1,
                          opacity: enDrag ? 0.9 : 1,
                          touchAction: "none",
                        }}
                      >
                        <GripVertical className="absolute top-1 right-1 h-3 w-3 opacity-0 group-hover:opacity-40 pointer-events-none" />
                        <div className="font-medium truncate pr-3">{c.libelle || "(sans libellé)"}</div>
                        <div className="text-[10px] opacity-70 truncate">
                          {enDrag
                            ? `L${ligne} · C${colonne} · ${rowspan}×${colspan}`
                            : (c.type_source === "RUBRIQUE" ? (c.code_rubrique || "—")
                              : c.type_source === "IDENTITE" ? (c.cle_identite || "—")
                              : (c.valeur_constante || "—"))}
                        </div>
                        {/* Poignée de redimensionnement : coin inférieur droit, visible au survol */}
                        <div
                          onPointerDown={(e) => demarrerDrag(e, i, "redimensionner")}
                          onPointerMove={pendantDrag}
                          onPointerUp={terminerDrag}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute bottom-0 right-0 w-3.5 h-3.5 opacity-0 group-hover:opacity-70 cursor-nwse-resize"
                          style={{
                            background: `linear-gradient(135deg, transparent 50%, ${couleur.border} 50%)`,
                            touchAction: "none",
                          }}
                          title="Glisser pour redimensionner (fusion L×C)"
                        />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 p-3" align="start" side="bottom">
                      <PropertesCase
                        c={c}
                        onChange={(patch) => majCase(i, patch)}
                        onSupprimer={() => { supprimerCase(i); setCaseOuverte(null); }}
                        champs={champs}
                        masques={masques}
                        toutesLesCases={cases}
                      />
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COULEUR_SOURCE.IDENTITE.border }} /> Identité</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COULEUR_SOURCE.RUBRIQUE.border }} /> Rubrique</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--border))" }} /> Texte fixe</span>
              <span className="ml-auto italic">Glisser une case pour la déplacer · glisser son coin pour la redimensionner</span>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ligne</TableHead>
                <TableHead>Colonne</TableHead>
                <TableHead>Fusion (L×C)</TableHead>
                <TableHead>Libellé imprimé</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Rubrique / champ</TableHead>
                <TableHead>Attribut</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c, i) => (
                <TableRow
                  key={c.id ?? i}
                  ref={(el) => (lignesRef.current[i] = el)}
                  onClick={() => setIndexSelectionne(i)}
                  style={{
                    background: indexEnConflit.has(i)
                      ? "hsl(0 72% 51% / 0.08)"
                      : indexSelectionne === i ? "hsl(var(--muted))" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <TableCell>
                    <Input type="number" className="w-16" value={c.ligne}
                      onChange={(e) => majCase(i, { ligne: Number(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" className="w-16" value={c.colonne}
                      onChange={(e) => majCase(i, { colonne: Number(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 items-center">
                      <Input type="number" className="w-14" value={c.rowspan}
                        onChange={(e) => majCase(i, { rowspan: Number(e.target.value) })} />
                      <span>×</span>
                      <Input type="number" className="w-14" value={c.colspan}
                        onChange={(e) => majCase(i, { colspan: Number(e.target.value) })} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input className="w-48" value={c.libelle}
                      onChange={(e) => majCase(i, { libelle: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Select value={c.type_source} onValueChange={(v) => majCase(i, { type_source: v as GrilleCase["type_source"] })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IDENTITE">Identité</SelectItem>
                        <SelectItem value="RUBRIQUE">Rubrique</SelectItem>
                        <SelectItem value="CONSTANTE">Texte fixe</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {c.type_source === "IDENTITE" && (
                      <Select value={c.cle_identite ?? ""} onValueChange={(v) => majCase(i, { cle_identite: v })}>
                        <SelectTrigger className="w-56"><SelectValue placeholder="Choisir un champ…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="identite.nom_complet">Civilité + Nom + Prénom</SelectItem>
                          {champs?.champs_snapshot.map((f) => (
                            <SelectItem key={f.cle} value={f.cle}>{f.libelle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {c.type_source === "RUBRIQUE" && (
                      <RubriqueCombobox
                        value={c.code_rubrique ?? ""}
                        options={champs?.rubriques || []}
                        onChange={(code) => majCase(i, { code_rubrique: code })}
                      />
                    )}
                    {c.type_source === "CONSTANTE" && (
                      <Input className="w-40" placeholder="Texte à afficher"
                        value={c.valeur_constante ?? ""}
                        onChange={(e) => majCase(i, { valeur_constante: e.target.value })} />
                    )}
                  </TableCell>
                  <TableCell>
                    {c.type_source === "RUBRIQUE" && (
                      <Select value={c.attribut ?? "MT"} onValueChange={(v) => majCase(i, { attribut: v as GrilleCase["attribut"] })}>
                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MT">Montant</SelectItem>
                          <SelectItem value="NB">Nombre</SelectItem>
                          <SelectItem value="TX">Taux</SelectItem>
                          <SelectItem value="BASE">Base</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => supprimerCase(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(champs?.rubriques?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {champs?.rubriques.length} rubrique(s) disponibles — choisis-les dans la liste déroulante,
              aucune saisie manuelle de code n'est nécessaire.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Aperçu & export</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-xl">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan de paie</label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Période</label>
              <Select value={periodeId} onValueChange={setPeriodeId} disabled={!planId}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>
                  {periodesDuPlan.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{periodeLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={lancerApercu} disabled={apercuEnCours}>
              {apercuEnCours && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Aperçu
            </Button>
            <Button onClick={exporterPdf} disabled={exportEnCours}>
              {exportEnCours && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Exporter en PDF
            </Button>
          </div>

          {apercu && (
            <p className="text-sm text-muted-foreground">
              {apercu.nb_collaborateurs > 0
                ? `${apercu.nb_collaborateurs} collaborateur(s) correspondent à ce périmètre — utilise "Exporter en PDF" pour voir la mise en page fidèle.`
                : "Aucun bulletin ne correspond à ce périmètre."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
