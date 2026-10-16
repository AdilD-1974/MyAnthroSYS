/**
 * AssistantFormule.tsx — Construire une formule sans la connaître par cœur.
 * Auteur : Adil DAIA — lot 2 bis (16/10/2026)
 *
 * Tout ce qu'on peut écrire, rangé et cherchable (recettes, rubriques et leurs
 * attributs, champs, variables et cases des corps, paramètres, fonctions avec
 * exemple, opérateurs) ; un clic insère au curseur. « Tester » évalue la
 * formule sur de vrais bulletins avec la définition EN COURS, non enregistrée.
 */
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { editionsApi } from "@/lib/editionsApi";
import ParametresForm, { parametresManquants, type Valeurs } from "@/pages/editions/ParametresForm";
import { ATTRIBUTS_RUBRIQUE, RUBRIQUES_EN_TETE } from "@/pages/editions/types";
import { sourceDuJeu, useReferentiels } from "./contexte";

type Rubrique = "recettes" | "rubriques" | "champs" | "donnees" | "parametres" | "fonctions" | "operateurs";
const RUBRIQUES: [Rubrique, string][] = [
  ["recettes", "Recettes"], ["rubriques", "Rubriques de paie"], ["donnees", "Corps et variables"],
  ["champs", "Champs du bulletin"], ["parametres", "Paramètres"], ["fonctions", "Fonctions"], ["operateurs", "Opérateurs"],
];

interface Element { insert: string; titre: string; detail?: string; exemple?: string }

/** Recettes : les formules qu'on écrit le plus souvent sur un bulletin. Codes à adapter. */
function recettes(corps: { code: string; nature: string; colonnes: { code: string }[] }[]): (Element & { groupe: string })[] {
  const lignes = corps.find((c) => c.nature === "LIGNES");
  const cases = corps.find((c) => c.nature === "CASES");
  const col = lignes?.colonnes.find((c) => c.code === "gains")?.code ?? lignes?.colonnes[0]?.code ?? "gains";
  return [
    { groupe: "Totaux", titre: "Somme de rubriques", insert: "[INDTRSP].MT + [INDREPR].MT", detail: "Ex. total des indemnités non imposables : remplacez par vos codes." },
    { groupe: "Totaux", titre: "Total d'une colonne d'un groupe de lignes", insert: `TOTAL_CORPS("${lignes?.code ?? "detail"}", "${col}", "Indemnités non imposables")`,
      detail: "Somme des lignes du groupe dans le corps ; une ligne « formule » d'un corps peut totaliser ce même corps." },
    { groupe: "Totaux", titre: "Total d'une colonne, tout le corps", insert: `TOTAL_CORPS("${lignes?.code ?? "detail"}", "${col}")` },
    { groupe: "Totaux", titre: "Rubrique absente comptée 0", insert: "SIVIDE([PRIM_ANC].MT, 0)", detail: "Une rubrique absente du bulletin vaut VIDE ; VIDE + 1 = VIDE." },
    { groupe: "Totaux", titre: "Total du bulletin", insert: "[NET_IMPOSABLE].MT", detail: "Totaux : TOTAL_BRUT, BRUT_IMPOSABLE, NET_IMPOSABLE, NET_A_PAYER, COT_SALARIALES, COT_PATRONALES…" },
    { groupe: "Cumuls", titre: "Cumul annuel d'une rubrique", insert: "[SALBASE].CMT", detail: "CMT montant, CNB nombre, CBASE base ; de janvier au mois édité inclus." },
    { groupe: "Cumuls", titre: "Cumul annuel d'un total", insert: "cumul.total_brut", detail: "Aussi : cumul.net_imposable, cumul.total_cot_salariale, cumul.nb_bulletins…" },
    ...(cases ? [{ groupe: "Cumuls", titre: "Case d'un corps « cases »", insert: `corps.${cases.code}.${"mois"}.${cases.colonnes[0]?.code ?? "brut"}`, detail: "corps.<corps>.<ligne>.<colonne>" }] : []),
    { groupe: "Conditions", titre: "Si … alors … sinon", insert: 'SI([NET_A_PAYER].MT > 0, "Virement", "Néant")' },
    { groupe: "Conditions", titre: "Seulement si la rubrique existe", insert: "SI([PRIM_ANC].MT <> VIDE, [PRIM_ANC].BASE)" },
    { groupe: "Calculs", titre: "Pourcentage d'une base", insert: "[CNSS_SAL].MT / [CNSS_SAL].BASE * 100" },
    { groupe: "Calculs", titre: "Arrondi à 2 décimales", insert: "ARRONDI([SALBASE].MT / 26, 2)" },
    { groupe: "Calculs", titre: "Constante de paie", insert: "#CNSS_PLAFOND", detail: "Valeur en vigueur à la date de la période." },
    { groupe: "Textes", titre: "Nom et prénom", insert: 'identite.nom + " " + identite.prenom' },
    { groupe: "Textes", titre: "Période en toutes lettres", insert: 'FORMAT(@periode.date_fin, "MOIS_ANNEE")' },
    { groupe: "Textes", titre: "Période du … au …", insert: '"Du " + FORMAT(@periode.date_debut, "DATE_FR") + " au " + FORMAT(@periode.date_fin, "DATE_FR")' },
    { groupe: "Textes", titre: "Net à payer en lettres", insert: "MONTANT_EN_LETTRES(net_a_payer)" },
    { groupe: "Textes", titre: "Texte fixe", insert: '"Total non imposable"', detail: "Un texte s'écrit entre guillemets." },
    { groupe: "Textes", titre: "Ancienneté en années", insert: "ANNEES(contrat.date_embauche, @periode.date_fin)" },
  ];
}

const OPERATEURS: Element[] = [
  { insert: " + ", titre: "+", detail: "addition, ou mise bout à bout de textes" }, { insert: " - ", titre: "−", detail: "soustraction" },
  { insert: " * ", titre: "×", detail: "multiplication" }, { insert: " / ", titre: "÷", detail: "division" },
  { insert: "(", titre: "( )", detail: "parenthèses" }, { insert: " = ", titre: "=", detail: "égal" }, { insert: " <> ", titre: "<>", detail: "différent" },
  { insert: " > ", titre: ">", detail: "supérieur" }, { insert: " >= ", titre: "≥", detail: "supérieur ou égal" },
  { insert: " < ", titre: "<", detail: "inférieur" }, { insert: " <= ", titre: "≤", detail: "inférieur ou égal" },
  { insert: "ET(", titre: "ET( )", detail: "toutes les conditions" }, { insert: "OU(", titre: "OU( )", detail: "une des conditions" },
  { insert: '""', titre: '"texte"', detail: "texte fixe entre guillemets" }, { insert: "VIDE", titre: "VIDE", detail: "absence de valeur" },
  { insert: "VRAI", titre: "VRAI", detail: "" }, { insert: "FAUX", titre: "FAUX", detail: "" },
];

export default function AssistantFormule({ valeur, jeu, onValider, onFermer }: {
  valeur: string; jeu?: string | null; onValider: (v: string) => void; onFermer: () => void;
}) {
  const { sources, fonctions, rubriques, definition } = useReferentiels();
  const [formule, setFormule] = useState(valeur ?? "");
  const [onglet, setOnglet] = useState<Rubrique>("recettes");
  const [q, setQ] = useState("");
  const [rubChoisie, setRubChoisie] = useState<string | null>(null);
  const [valeurs, setValeurs] = useState<Valeurs>({});
  const [test, setTest] = useState<Awaited<ReturnType<typeof editionsApi.testerFormule>> | null>(null);
  const [erreurTest, setErreurTest] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const zone = useRef<HTMLTextAreaElement>(null);
  const bas = q.trim().toLowerCase();
  const filtre = (...t: (string | undefined | null)[]) => !bas || t.some((x) => (x ?? "").toLowerCase().includes(bas));

  const inserer = (texte: string) => {
    const el = zone.current;
    const debut = el?.selectionStart ?? formule.length;
    const fin = el?.selectionEnd ?? formule.length;
    const nouveau = formule.slice(0, debut) + texte + formule.slice(fin);
    setFormule(nouveau);
    const curseur = debut + texte.length - (texte === '""' ? 1 : 0);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(curseur, curseur); });
  };

  const corpsCtx = jeu?.startsWith("corps:") ? (definition?.corps ?? []).find((c) => c.code === jeu.slice(6)) : undefined;
  const source = corpsCtx ? sourceDuJeu(definition, undefined) : sourceDuJeu(definition, jeu);

  const contenu: { groupe: string; elements: Element[] }[] = useMemo(() => {
    const parGroupe = (items: (Element & { groupe: string })[]) => {
      const m = new Map<string, Element[]>();
      items.forEach((i) => { if (!m.has(i.groupe)) m.set(i.groupe, []); m.get(i.groupe)!.push(i); });
      return [...m.entries()].map(([groupe, elements]) => ({ groupe, elements }));
    };
    switch (onglet) {
      case "recettes":
        return parGroupe(recettes(definition?.corps ?? []).filter((r) => filtre(r.titre, r.insert, r.detail)));
      case "champs": {
        const champs = [
          ...(sources.find((s) => s.code === source)?.champs ?? []),
          ...(sources.find((s) => s.code === "SOCIETE")?.champs ?? []).map((c) => ({ ...c, code: `societe.${c.code}`, groupe: "Société" })),
        ].filter((c) => !c.code.includes("*") && filtre(c.code, c.libelle));
        return parGroupe(champs.map((c) => ({ groupe: c.groupe ?? "Général", insert: c.code, titre: c.libelle, detail: c.code + (c.sensible ? " · donnée sensible" : "") })));
      }
      case "donnees": {
        const items: (Element & { groupe: string })[] = [];
        if (corpsCtx) {
          items.push(...[["libelle", "Libellé de la ligne"], ["code_rubrique", "Code rubrique"], ["groupe", "Groupe"]]
            .map(([c, l]) => ({ groupe: `Ligne du corps « ${corpsCtx.libelle} »`, insert: c, titre: l, detail: c })));
          items.push(...corpsCtx.colonnes.map((c) => ({ groupe: `Ligne du corps « ${corpsCtx.libelle} »`, insert: c.code, titre: c.libelle, detail: c.code })));
        }
        (definition?.variables ?? []).forEach((v) => items.push({ groupe: "Variables", insert: `var.${v.code}`, titre: v.libelle, detail: `var.${v.code}` }));
        (definition?.corps ?? []).forEach((c) => {
          if (c.nature === "CASES") (c.lignes ?? []).forEach((l) => c.colonnes.forEach((col) => items.push({
            groupe: `Cases du corps « ${c.libelle} »`, insert: `corps.${c.code}.${l.code}.${col.code}`, titre: `${l.libelle} · ${col.libelle}`, detail: `corps.${c.code}.${l.code}.${col.code}` })));
          else c.colonnes.forEach((col) => items.push({ groupe: `Totaux du corps « ${c.libelle} »`, insert: `TOTAL_CORPS("${c.code}", "${col.code}")`,
            titre: `Total ${col.libelle}`, detail: `ajoutez un 3e argument pour un seul groupe` }));
        });
        return parGroupe(items.filter((i) => filtre(i.titre, i.insert, i.groupe)));
      }
      case "parametres": {
        const items: (Element & { groupe: string })[] = [];
        (definition?.parametres ?? []).forEach((p) => {
          items.push({ groupe: p.libelle, insert: `@${p.code}`, titre: `@${p.code}`, detail: p.libelle });
          if (p.type === "PERIODE") ["code", "intitule", "date_debut", "date_fin", "annee", "mois"].forEach((a) =>
            items.push({ groupe: p.libelle, insert: `@${p.code}.${a}`, titre: `@${p.code}.${a}`, detail: a }));
        });
        return parGroupe(items.filter((i) => filtre(i.titre, i.detail)));
      }
      case "fonctions":
        return parGroupe(fonctions.filter((f) => filtre(f.nom, f.description, f.categorie))
          .map((f) => ({ groupe: f.categorie, insert: `${f.nom}(`, titre: f.signature, detail: f.description, exemple: f.exemple })));
      case "operateurs":
        return [{ groupe: "Opérateurs et valeurs", elements: OPERATEURS }];
      default:
        return [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, bas, sources, source, fonctions, definition, corpsCtx]);

  const listeRubriques = useMemo(() => [...rubriques.map((r) => ({ ...r, total: false })), ...RUBRIQUES_EN_TETE.map((r) => ({ ...r, total: true }))]
    .filter((r) => filtre(r.code, r.libelle)).slice(0, 200), [rubriques, bas]); // eslint-disable-line react-hooks/exhaustive-deps

  const tester = async () => {
    if (!definition) return;
    const manquants = parametresManquants(definition.parametres, valeurs);
    if (manquants.length) { setErreurTest(`Paramètres manquants : ${manquants.join(", ")}`); return; }
    setOccupe(true); setErreurTest(null);
    try { setTest(await editionsApi.testerFormule(definition, formule, valeurs, jeu?.startsWith("corps:") ? jeu : undefined)); }
    catch (e: any) { setErreurTest(e.message); setTest(null); }
    finally { setOccupe(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="max-w-5xl" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader><DialogTitle>Assistant de formule</DialogTitle></DialogHeader>

        <textarea ref={zone} value={formule} onChange={(e) => setFormule(e.target.value)} rows={3} spellCheck={false}
          placeholder="Cliquez les éléments ci-dessous pour les insérer, ou tapez directement…"
          className="w-full rounded-md border bg-background p-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" />

        <div className="grid h-[380px] grid-cols-[170px_1fr_300px] gap-3">
          <nav className="overflow-auto rounded border bg-muted/30 p-1">
            {RUBRIQUES.map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setOnglet(k); setRubChoisie(null); }}
                className={`block w-full rounded px-2 py-1.5 text-left text-sm ${onglet === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l}</button>
            ))}
          </nav>

          <div className="flex min-h-0 flex-col">
            {onglet !== "operateurs" && (
              <div className="relative mb-2">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher…"
                  className="w-full rounded border bg-background py-1.5 pl-8 pr-2 text-sm" />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto rounded border">
              {onglet === "rubriques" ? (
                listeRubriques.map((r) => (
                  <div key={r.code} className={`border-b px-2 py-1 ${rubChoisie === r.code ? "bg-primary/5" : ""}`}>
                    <button type="button" className="flex w-full items-baseline gap-2 text-left text-sm" onClick={() => setRubChoisie(rubChoisie === r.code ? null : r.code)}>
                      <span className="w-28 shrink-0 font-mono text-xs">{r.code}</span>
                      <span className="truncate">{r.libelle}</span>
                      {r.total && <span className="ml-auto text-[10px] uppercase text-muted-foreground">total du bulletin</span>}
                    </button>
                    {rubChoisie === r.code && (
                      <div className="mt-1 flex flex-wrap gap-1 pb-1">
                        {ATTRIBUTS_RUBRIQUE.filter((a) => !r.total || a.code === "MT" || a.code === "CMT").map((a) => (
                          <button key={a.code} type="button" onClick={() => inserer(`[${r.code}].${a.code}`)}
                            className="rounded border bg-background px-2 py-0.5 text-xs hover:bg-primary hover:text-primary-foreground" title={a.libelle}>
                            <span className="font-mono">.{a.code}</span> <span className="text-muted-foreground">{a.libelle}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : contenu.map((g) => (
                <div key={g.groupe}>
                  <div className="sticky top-0 bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">{g.groupe}</div>
                  {g.elements.map((e, i) => (
                    <button key={i} type="button" onClick={() => inserer(e.insert)}
                      className="block w-full border-b px-2 py-1 text-left hover:bg-primary/5">
                      <div className="text-sm">{e.titre}</div>
                      {e.detail && <div className="text-[11px] text-muted-foreground">{e.detail}</div>}
                      {(e.exemple || (onglet === "recettes" && e.insert)) && (
                        <div className="mt-0.5 font-mono text-[11px] text-sky-800">{e.exemple ?? e.insert}</div>
                      )}
                    </button>
                  ))}
                </div>
              ))}
              {onglet === "rubriques" && !listeRubriques.length && <p className="p-3 text-sm text-muted-foreground">Aucune rubrique.</p>}
            </div>
            {onglet === "rubriques" && <p className="mt-1 text-[11px] text-muted-foreground">Cliquez une rubrique puis l'attribut : .MT montant, .NB nombre, .TX taux, .BASE base, .PAT patronal ; .CMT/.CNB/.CBASE cumuls annuels.</p>}
          </div>

          <div className="flex min-h-0 flex-col rounded border p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Tester sur de vrais bulletins</div>
            <div className="mb-2 max-h-40 overflow-auto text-xs"><ParametresForm parametres={definition?.parametres ?? []} valeurs={valeurs} onChange={setValeurs} /></div>
            <Button size="sm" variant="outline" disabled={occupe || !formule.trim()} onClick={tester}>
              {occupe ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}Tester
            </Button>
            <div className="mt-2 min-h-0 flex-1 overflow-auto text-xs">
              {erreurTest && <p className="text-destructive">{erreurTest}</p>}
              {test?.resultats.map((r, i) => (
                <div key={i} className="mb-1.5 rounded bg-muted/40 p-1.5">
                  <div className="text-[11px] text-muted-foreground">{r.titre}</div>
                  {r.erreur ? <div className="text-destructive">{r.erreur}</div>
                    : <div className="font-mono font-medium">{r.type === "VIDE" ? <span className="text-muted-foreground">VIDE</span> : r.texte}</div>}
                  {r.manques.length > 0 && <div className="text-[10px] text-amber-700">Introuvable : {r.manques.join(", ")}</div>}
                </div>
              ))}
              {test && !test.resultats.length && <p className="text-muted-foreground">Aucun document pour ces paramètres.</p>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">La formule est vérifiée à l'enregistrement ; « Tester » utilise vos modifications non enregistrées.</span>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button onClick={() => { onValider(formule); onFermer(); }}><CheckCircle2 className="mr-1 h-4 w-4" />Utiliser cette formule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
