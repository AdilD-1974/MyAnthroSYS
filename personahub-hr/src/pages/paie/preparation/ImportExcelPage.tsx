/**
 * ImportExcelPage — Import d'éléments variables depuis un fichier Excel/CSV.
 *
 * Modèle (migration 46) : une ligne du fichier = une ligne element_variable
 * complète, avec des colonnes explicites base/nombre/taux/montant (au moins
 * une renseignée), au lieu d'un couple attribut/valeur/sens. Les valeurs
 * négatives se saisissent directement dans la cellule Excel (ex. "-500").
 *
 * Principe : rien n'est écrit tant que le fichier n'a pas été CONTRÔLÉ ligne à
 * ligne. Chaque ligne est validée (matricule connu et rattaché au plan, rubrique
 * existante, au moins une grandeur numérique correcte) ; les lignes en erreur
 * sont affichées et exclues. L'import crée des EV au statut SAISI (source
 * IMPORT) : ils devront être validés pour être pris en compte par le calcul.
 * Auteur : Adil DAIA
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { db } from "@/lib/api";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, Trash2, Play } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; numero_periode: number; statut: string; date_ouverture: string | null; date_debut: string; date_fin: string; date_reference: string };
type Collab = { id: string; matricule: string; nom: string; prenom: string; statut_collaborateur: string };
type Rubrique = {
  code: string; libelle: string;
  v_import: boolean;
  v_ajout: boolean; v_forcage: boolean; v_regularisation: boolean;
  v_annulation: boolean; v_reprise: boolean;
};

// Correspondance type d'EV -> colonne d'autorisation de la rubrique
const AUTORISATION: Record<string, keyof Rubrique> = {
  AJOUT: "v_ajout", FORCAGE: "v_forcage", REGULARISATION: "v_regularisation",
  ANNULATION: "v_annulation", REPRISE: "v_reprise",
};
type Ref = { code: string; libelle: string };

interface LigneImport {
  numero: number;              // n° de ligne dans le fichier
  matricule: string;
  code_rubrique: string;
  valeur_base: string;
  valeur_nombre: string;
  valeur_taux: string;
  valeur_montant: string;
  code_type: string;
  date_debut: string;
  date_fin: string;
  // Résultat du contrôle
  collaborateur_id?: string;
  nom?: string;
  erreurs: string[];
}

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const COLONNES = ["matricule", "rubrique", "base", "nombre", "taux", "montant", "type", "date_debut", "date_fin"];
const GRANDEURS: { colonneFichier: "base" | "nombre" | "taux" | "montant"; champ: keyof LigneImport }[] = [
  { colonneFichier: "base", champ: "valeur_base" },
  { colonneFichier: "nombre", champ: "valeur_nombre" },
  { colonneFichier: "taux", champ: "valeur_taux" },
  { colonneFichier: "montant", champ: "valeur_montant" },
];

const actifA = (d1: string | null, d2: string | null, d: string) => (!d1 || d1 <= d) && (!d2 || d2 >= d);
const norm = (v: any) => String(v ?? "").trim();

const ImportExcelPage: React.FC = () => {
  const { formatDate, formatNumber, formatMoney } = useFormatMasks();
  const affNum = (brut: string, money = false) => {
    if (!brut) return "—";
    const n = Number(brut.replace(",", "."));
    if (!Number.isFinite(n)) return brut; // valeur non numérique : affichée telle quelle pour que l'erreur reste visible
    return money ? formatMoney(n) : formatNumber(n);
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [types, setTypes] = useState<Ref[]>([]);

  const [planId, setPlanId] = useState("");
  const [periodeId, setPeriodeId] = useState("");

  const [lignes, setLignes] = useState<LigneImport[]>([]);
  const [nomFichier, setNomFichier] = useState("");
  const [analyse, setAnalyse] = useState(false);
  const [importation, setImportation] = useState(false);

  const periodeEstOuverte = (p: Periode) => {
    if (p.statut === "CLOTUREE" || p.statut === "FERMEE") return false;
    if (p.date_ouverture && p.date_ouverture > new Date().toISOString().slice(0, 10)) return false;
    return true;
  };


  useEffect(() => {
    db.list<Plan>("plan_paie", { actif: true, select: "id,code,libelle", order: "code", limit: 200 })
      .then((p) => { setPlans(p); if (p[0]) setPlanId((x) => x || p[0].id); }).catch(() => {});
    db.list<Rubrique>("rubrique_paie", { archive: false, order: "code", limit: 2000,
      select: "code,libelle,v_import,v_ajout,v_forcage,v_regularisation,v_annulation,v_reprise" })
      .then(setRubriques).catch(() => {});
    db.list<Ref>("ref_ev_type", { actif: true, select: "code,libelle", order: "ordre", limit: 100 }).then(setTypes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!planId) return;
    db.list<Periode>("calendrier_paie", {
      plan_paie_id: planId, select: "id,annee,mois,numero_periode,statut,date_ouverture,date_debut,date_fin,date_reference", limit: 1000,
    }).then((ps) => {
      ps.sort((a, b) => a.annee - b.annee || a.mois - b.mois || (a.numero_periode || 0) - (b.numero_periode || 0));
      setPeriodes(ps);
      const ouverte = ps.find(periodeEstOuverte);
      setPeriodeId((x) => (x && ps.some((p) => p.id === x) ? x : (ouverte?.id || ps[0]?.id || "")));
    }).catch(() => setPeriodes([]));
  }, [planId]);

  const periode = periodes.find((p) => p.id === periodeId);
  const periodeOuverte = periode ? periodeEstOuverte(periode) : false;

  // ---------- Modèle à télécharger ----------
  const telechargerModele = () => {
    const exemple = [{
      matricule: "MAT001", rubrique: rubriques.find((r) => r.v_import)?.code || "HSUP",
      base: "", nombre: 10, taux: "", montant: "",
      type: "AJOUT", date_debut: "", date_fin: "",
    }];
    const ws = XLSX.utils.json_to_sheet(exemple, { header: COLONNES });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Elements variables");
    XLSX.writeFile(wb, "modele_elements_variables.xlsx");
  };

  // ---------- Lecture + contrôle ----------
  const analyser = async (file: File) => {
    if (!periode) { toast({ title: "Choisissez une période", variant: "destructive" }); return; }
    setAnalyse(true); setLignes([]); setNomFichier(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const brut: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (!brut.length) { toast({ title: "Fichier vide", variant: "destructive" }); setAnalyse(false); return; }

      // Référentiels de contrôle
      const ref = periode.date_reference;
      const [ratt, collabs] = await Promise.all([
        db.list<any>("collaborateur_plan_paie", { plan_paie_id: planId, archive: false, select: "collaborateur_id,date_debut,date_fin", limit: 10000 }),
        db.list<Collab>("collaborateurs", { archive: false, select: "id,matricule,nom,prenom,statut_collaborateur", limit: 10000 }),
      ]);
      const idsPlan = new Set(ratt.filter((r) => actifA(r.date_debut, r.date_fin, ref)).map((r) => r.collaborateur_id));
      const parMatricule = new Map<string, Collab>();
      collabs.forEach((c) => parMatricule.set(c.matricule.toUpperCase(), c));
      const parRubrique = new Map<string, Rubrique>();
      rubriques.forEach((r) => parRubrique.set(r.code.toUpperCase(), r));
      const codesType = new Set(types.map((t) => t.code.toUpperCase()));

      const res: LigneImport[] = brut.map((r: any, i: number) => {
        const L: LigneImport = {
          numero: i + 2, // ligne 1 = en-têtes
          matricule: norm(r.matricule || r.Matricule),
          code_rubrique: norm(r.rubrique || r.Rubrique).toUpperCase(),
          valeur_base: norm(r.base ?? r.Base),
          valeur_nombre: norm(r.nombre ?? r.Nombre),
          valeur_taux: norm(r.taux ?? r.Taux),
          valeur_montant: norm(r.montant ?? r.Montant),
          code_type: (norm(r.type || r.Type) || "AJOUT").toUpperCase(),
          date_debut: norm(r.date_debut),
          date_fin: norm(r.date_fin),
          erreurs: [],
        };

        // Contrôles
        if (!L.matricule) L.erreurs.push("matricule manquant");
        else {
          const c = parMatricule.get(L.matricule.toUpperCase());
          if (!c) L.erreurs.push(`matricule « ${L.matricule} » inconnu`);
          else if (c.statut_collaborateur === "SORTI") L.erreurs.push("collaborateur sorti");
          else if (!idsPlan.has(c.id)) L.erreurs.push("non rattaché au plan de paie sur cette période");
          else { L.collaborateur_id = c.id; L.nom = `${c.nom} ${c.prenom}`; }
        }
        const rub = L.code_rubrique ? parRubrique.get(L.code_rubrique) : undefined;
        if (!L.code_rubrique) L.erreurs.push("rubrique manquante");
        else if (!rub) L.erreurs.push(`rubrique « ${L.code_rubrique} » inconnue`);
        else {
          // RG-EV-AUTORISATION : la rubrique doit autoriser l'import…
          if (!rub.v_import) L.erreurs.push(`rubrique « ${L.code_rubrique} » : import non autorisé`);
          // …et le type d'élément variable importé.
          const col = AUTORISATION[L.code_type];
          if (col && !rub[col]) L.erreurs.push(`type « ${L.code_type} » non autorisé sur cette rubrique`);
        }

        // Au moins une grandeur (base/nombre/taux/montant) renseignée, chacune
        // numérique si présente — miroir de la contrainte CHECK
        // element_variable_au_moins_une_valeur (migration 46).
        let auMoinsUneGrandeur = false;
        GRANDEURS.forEach(({ colonneFichier, champ }) => {
          const val = L[champ] as string;
          if (val === "") return;
          auMoinsUneGrandeur = true;
          if (isNaN(Number(val))) L.erreurs.push(`${colonneFichier} « ${val} » : valeur numérique attendue`);
        });
        if (!auMoinsUneGrandeur) L.erreurs.push("au moins une grandeur (base/nombre/taux/montant) obligatoire");
        if (!codesType.has(L.code_type)) L.erreurs.push(`type « ${L.code_type} » inconnu`);
        if (L.date_debut && L.date_fin && L.date_fin < L.date_debut) L.erreurs.push("fin de validité avant le début");

        return L;
      });

      // Doublons (même matricule + rubrique — une seule ligne EV possible par
      // collaborateur/rubrique/période depuis la migration 46).
      const vus = new Map<string, number>();
      res.forEach((L) => {
        const k = `${L.matricule}|${L.code_rubrique}`;
        if (vus.has(k)) L.erreurs.push(`doublon avec la ligne ${vus.get(k)}`);
        else vus.set(k, L.numero);
      });

      setLignes(res);
      const ok = res.filter((l) => !l.erreurs.length).length;
      toast({
        title: "Fichier analysé",
        description: `${res.length} ligne(s) — ${ok} valide(s), ${res.length - ok} en erreur.`,
        variant: res.length - ok ? "destructive" : undefined,
      });
    } catch (e: any) {
      toast({ title: "Lecture impossible", description: e.message, variant: "destructive" });
    }
    setAnalyse(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const valides = useMemo(() => lignes.filter((l) => !l.erreurs.length), [lignes]);
  const enErreur = useMemo(() => lignes.filter((l) => l.erreurs.length), [lignes]);

  // ---------- Import ----------
  const importer = async () => {
    if (!valides.length || !periode) return;
    if (!confirm(`Importer ${valides.length} élément(s) variable(s) au statut SAISI ?`)) return;
    setImportation(true);
    try {
      await db.create("element_variable", valides.map((l) => ({
        collaborateur_id: l.collaborateur_id, periode_id: periodeId,
        code_rubrique: l.code_rubrique,
        valeur_base: l.valeur_base !== "" ? Number(l.valeur_base) : null,
        valeur_nombre: l.valeur_nombre !== "" ? Number(l.valeur_nombre) : null,
        valeur_taux: l.valeur_taux !== "" ? Number(l.valeur_taux) : null,
        valeur_montant: l.valeur_montant !== "" ? Number(l.valeur_montant) : null,
        code_type: l.code_type, code_source: "IMPORT", statut: "SAISI",
        date_debut: l.date_debut || periode.date_debut,
        date_fin: l.date_fin || periode.date_fin,
      })));
      toast({ title: "Import réussi", description: `${valides.length} élément(s) créé(s) au statut SAISI. Validez-les pour les prendre en compte.` });
      setLignes([]); setNomFichier("");
    } catch (e: any) {
      toast({ title: "Erreur d'import", description: e.message, variant: "destructive" });
    }
    setImportation(false);
  };

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Import des éléments variables</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Importez un fichier Excel ou CSV. Chaque ligne est contrôlée avant écriture ; les éléments sont créés au statut <strong>SAISI</strong>.
        </p>
      </div>

      {/* Contexte */}
      <div className="rounded-xl border border-border p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Plan de paie</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
            <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Période</Label>
          <Select value={periodeId} onValueChange={setPeriodeId}>
            <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
            <SelectContent>
              {periodes.map((p) => {
                const cloturee = p.statut === "CLOTUREE" || p.statut === "FERMEE";
                const nonOuverte = !cloturee && p.date_ouverture && p.date_ouverture > new Date().toISOString().slice(0, 10);
                return (
                  <SelectItem key={p.id} value={p.id}>
                    {MOIS[p.mois]} {p.annee}
                    {cloturee && <span style={{ color: "hsl(var(--destructive))" }}> · clôturée</span>}
                    {nonOuverte && <span style={{ color: "hsl(var(--warning))" }}> · non ouverte</span>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button variant="outline" onClick={telechargerModele} className="gap-1.5 w-full">
            <Download size={14} /> Télécharger le modèle
          </Button>
        </div>
      </div>

      {periode && !periodeOuverte && (() => {
        const cloturee = periode.statut === "CLOTUREE" || periode.statut === "FERMEE";
        const token = cloturee ? "destructive" : "warning";
        return (
          <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
            style={{ border: `1px solid hsl(var(--${token}) / 0.3)`, background: `hsl(var(--${token}) / 0.08)`, color: `hsl(var(--${token}))` }}>
            <AlertTriangle size={14} />
            {cloturee
              ? "Cette période est clôturée — l'import est désactivé."
              : `Cette période n'est pas ouverte ${periode.date_ouverture ? `(ouverture le ${formatDate(periode.date_ouverture)})` : ""} — l'import est désactivé.`}
          </div>
        );
      })()}

      {/* Colonnes attendues */}
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-foreground">Colonnes attendues :</strong>{" "}
        {COLONNES.map((c) => <code key={c} className="mx-1 px-1 rounded bg-background text-accent">{c}</code>)}
        <div className="mt-1">
          <em>base</em>/<em>nombre</em>/<em>taux</em>/<em>montant</em> : au moins une renseignée par ligne, valeurs négatives
          saisies directement (ex. « -500 ») ·{" "}
          <em>date_debut</em>/<em>date_fin</em> facultatives (par défaut : bornes de la période).
        </div>
      </div>

      {/* Dépôt du fichier */}
      <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) analyser(f); }} />
        <FileSpreadsheet className="mx-auto mb-2 text-muted-foreground" size={32} />
        <p className="text-sm text-muted-foreground mb-3">
          {nomFichier ? <>Fichier chargé : <strong className="text-foreground">{nomFichier}</strong></> : "Sélectionnez un fichier Excel (.xlsx) ou CSV"}
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={!periodeOuverte || analyse} className="gap-1.5">
            {analyse ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />} Choisir un fichier
          </Button>
          {lignes.length > 0 && (
            <Button variant="ghost" onClick={() => { setLignes([]); setNomFichier(""); }} className="gap-1.5">
              <Trash2 size={14} /> Vider
            </Button>
          )}
        </div>
      </div>

      {/* Résultat du contrôle */}
      {lignes.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
                style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}>
                <CheckCircle2 size={14} /> {valides.length} ligne(s) valide(s)
              </span>
              {enErreur.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
                  style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }}>
                  <AlertTriangle size={14} /> {enErreur.length} en erreur (exclue(s))
                </span>
              )}
            </div>
            <Button onClick={importer} disabled={!valides.length || importation || !periodeOuverte} className="gap-1.5">
              {importation ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
              Importer {valides.length} élément(s)
            </Button>
          </div>

          <div className="rounded-xl border border-border overflow-x-auto max-h-[28rem]">
            <Table>
              <TableHeader className="sticky top-0" style={{ background: "hsl(var(--muted) / 0.5)" }}>
                <TableRow className="text-[10px] uppercase tracking-wide font-semibold hover:bg-transparent">
                  <TableHead className="w-14 py-2">Ligne</TableHead>
                  <TableHead className="w-28 py-2">Matricule</TableHead>
                  <TableHead className="w-40 py-2">Collaborateur</TableHead>
                  <TableHead className="w-28 py-2">Rubrique</TableHead>
                  <TableHead className="w-20 text-right py-2">Base</TableHead>
                  <TableHead className="w-20 text-right py-2">Nombre</TableHead>
                  <TableHead className="w-20 text-right py-2">Taux</TableHead>
                  <TableHead className="w-24 text-right py-2">Montant</TableHead>
                  <TableHead className="py-2">Contrôle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lignes.map((l) => (
                  <TableRow key={l.numero}
                    className="text-xs border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    style={l.erreurs.length ? { background: "hsl(var(--destructive) / 0.05)" } : undefined}>
                    <TableCell className="py-1 text-muted-foreground">{l.numero}</TableCell>
                    <TableCell className="py-1"><code className="text-[11px]">{l.matricule || "—"}</code></TableCell>
                    <TableCell className="py-1 truncate max-w-[11rem]">{l.nom || "—"}</TableCell>
                    <TableCell className="py-1"><code className="text-[11px] text-accent">{l.code_rubrique || "—"}</code></TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{affNum(l.valeur_base)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{affNum(l.valeur_nombre)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{affNum(l.valeur_taux)}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{affNum(l.valeur_montant, true)}</TableCell>
                    <TableCell className="py-1">
                      {l.erreurs.length ? (
                        <span className="text-destructive flex items-start gap-1">
                          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                          {l.erreurs.join(" · ")}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1" style={{ color: "hsl(var(--success))" }}>
                          <CheckCircle2 size={11} /> OK
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
};

export default ImportExcelPage;
