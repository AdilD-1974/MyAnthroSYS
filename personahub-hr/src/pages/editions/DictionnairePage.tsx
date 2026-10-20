/**
 * DictionnairePage.tsx — Dictionnaire des données des éditions (/editions/dictionnaire).
 * Auteur : Adil DAIA — 20/10/2026 — RG-EDT-DICO-01..08
 *
 * Le configurateur où l'administrateur associe lui-même les informations, sans développement :
 *   - Champs d'une source : libellé, groupe, masque, visibilité, sensibilité (champs système),
 *     et champs ajoutés : une valeur de la ligne cherchée dans une table de la base
 *     (code → référentiel → intitulé, collaborateur → table historisée, nombre, somme, liste…).
 *   - Sources personnalisées : une table principale filtrée par société, ses colonnes.
 *   - Relations : d'une source vers une source personnalisée (jeux secondaires, tableaux).
 * Aucune requête SQL saisie : tables et colonnes sont choisies dans la structure réelle de la
 * base (tables techniques, comptes et mots de passe exclus côté serveur). Consulter : droit
 * « concevoir » ; modifier : droit « administrer ».
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight, Database, Eye, Link2, Loader2, Pencil, Play, Plus, RotateCcw, Search, ShieldAlert, Table2, Trash2,
} from "lucide-react";
import ReturnTrail from "@/components/navigation/ReturnTrail";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  editionsApi, type Agregat, type ChampDico, type ConditionDico, type DefinitionChamp, type DefinitionSource,
  type Masque, type SourceDico, type TableDico,
} from "@/lib/editionsApi";
import ActionIcone from "./ActionIcone";
import Liste, { type OptionListe } from "./Liste";
import "./editions.css";

const TYPES = [
  { v: "", l: "Automatique (selon la colonne)" }, { v: "TEXTE", l: "Texte" }, { v: "NOMBRE", l: "Nombre" },
  { v: "MONTANT", l: "Montant" }, { v: "DATE", l: "Date" }, { v: "BOOLEEN", l: "Oui / non" },
];
const LIB_TYPE: Record<string, string> = { TEXTE: "Texte", NOMBRE: "Nombre", MONTANT: "Montant", DATE: "Date", BOOLEEN: "Oui / non", IMAGE: "Image" };
const AGREGATS: { v: Agregat; l: string }[] = [
  { v: "PREMIER", l: "La première (ou la seule)" }, { v: "DERNIER", l: "La dernière" },
  { v: "NB", l: "Le nombre de lignes" }, { v: "SOMME", l: "La somme" }, { v: "LISTE", l: "La liste des valeurs" },
];
const OPERATEURS = [
  { v: "=", l: "=" }, { v: "<>", l: "≠" }, { v: "<", l: "<" }, { v: "<=", l: "≤" }, { v: ">", l: ">" }, { v: ">=", l: "≥" },
  { v: "VIDE", l: "est vide" }, { v: "NON_VIDE", l: "n'est pas vide" },
];
const NATURES: Record<string, string> = {
  PAIE_SNAPSHOT: "Paie (figée au calcul)", RH_DATE: "RH à date", REFERENTIEL: "Référentiel", CALCULEE: "Calculée", PERSONNALISEE: "Personnalisée",
};

const slug = (t: string) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "champ";
const erreur = (titre: string) => (e: any) => toast({
  title: titre, variant: "destructive",
  description: [e?.message, Array.isArray(e?.details) ? e.details.join(" · ") : null].filter(Boolean).join(" — "),
});
const afficher = (v: unknown) => v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

// ─────────────────────────────────────────────────────────────────────────────
export default function DictionnairePage() {
  const [sources, setSources] = useState<SourceDico[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [choix, setChoix] = useState<string>(() => new URLSearchParams(window.location.search).get("source") ?? "BULLETIN");
  const [q, setQ] = useState("");
  const [tables, setTables] = useState<TableDico[] | null>(null);
  const [masques, setMasques] = useState<Masque[]>([]);
  const [nouvelleSource, setNouvelleSource] = useState(false);

  const charger = () => editionsApi.dictionnaire()
    .then((r) => { setSources(r.sources); setAdmin(r.peut_administrer); setErreurChargement(null); })
    .catch((e) => setErreurChargement(e.message));
  useEffect(() => {
    charger();
    editionsApi.masques().then(setMasques).catch(() => setMasques([]));
  }, []);
  useEffect(() => { if (admin && !tables) editionsApi.dicoTables().then(setTables).catch(() => setTables([])); }, [admin, tables]);

  const source = sources?.find((s) => s.code === choix) ?? sources?.[0] ?? null;
  const filtrees = (sources ?? []).filter((s) => !q || `${s.libelle} ${s.code}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="ecran-editions w-full">
      <ReturnTrail current="Dictionnaire des données" />
      <div className="w-full space-y-3 px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="titre-ecran text-xl font-semibold tracking-tight">Dictionnaire des données</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Les informations proposées dans le designer des éditions : associez vos champs, vos sources et leurs relations aux tables de la base.
            </p>
          </div>
          {admin && (
            <Button className="ml-auto" onClick={() => setNouvelleSource(true)}>
              <Plus className="mr-1 h-4 w-4" />Nouvelle source
            </Button>
          )}
        </div>
        {!admin && sources && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />Consultation seule : modifier le dictionnaire demande le droit « Administrer » des éditions.
          </div>
        )}
        {erreurChargement && <div className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{erreurChargement}</div>}
        {!sources && !erreurChargement && <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement…</div>}

        {sources && (
          <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
            <Card className="carte-edition h-fit p-2">
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une source…" className="h-9 pl-8" />
              </div>
              {[["Sources du système", false], ["Sources personnalisées", true]].map(([titre, perso]) => {
                const liste = filtrees.filter((s) => s.perso === perso);
                return (
                  <div key={String(titre)} className="mb-2">
                    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titre as string}</div>
                    {!liste.length && <p className="px-2 py-1 text-xs text-muted-foreground">{perso ? "Aucune : « Nouvelle source »." : "—"}</p>}
                    {liste.map((s) => (
                      <button key={s.code} type="button" onClick={() => setChoix(s.code)}
                        className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm ${source?.code === s.code ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                        <Database className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{s.libelle}</span>
                          <span className={`block text-[11px] ${source?.code === s.code ? "opacity-80" : "text-muted-foreground"}`}>
                            {s.code} · {s.champs.length} champ(s)
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </Card>
            {source && (
              <FicheSource key={source.code} source={source} sources={sources} admin={admin} tables={tables ?? []}
                masques={masques} onChange={charger} onSupprimee={() => { setChoix("BULLETIN"); charger(); }} />
            )}
          </div>
        )}
      </div>

      {nouvelleSource && (
        <DialogueSource tables={tables ?? []} onFermer={() => setNouvelleSource(false)}
          onOk={(code) => { setNouvelleSource(false); setChoix(code); charger(); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function FicheSource({ source, sources, admin, tables, masques, onChange, onSupprimee }: {
  source: SourceDico; sources: SourceDico[]; admin: boolean; tables: TableDico[]; masques: Masque[];
  onChange: () => void; onSupprimee: () => void;
}) {
  const [q, setQ] = useState("");
  const [groupe, setGroupe] = useState("");
  const [masques_, setMasquesVus] = useState(true);
  const [edition, setEdition] = useState<ChampDico | "NOUVEAU" | null>(null);
  const [relation, setRelation] = useState(false);
  const [apercu, setApercu] = useState<{ total: number; lignes: Record<string, unknown>[] } | null>(null);
  const [definitionOuverte, setDefinitionOuverte] = useState(false);

  const groupes = useMemo(() => [...new Set(source.champs.map((c) => c.groupe || "Sans groupe"))], [source]);
  const champs = source.champs.filter((c) => (masques_ || c.visible)
    && (!groupe || (c.groupe || "Sans groupe") === groupe)
    && (!q || `${c.libelle} ${c.code}`.toLowerCase().includes(q.toLowerCase())));
  const parGroupe = groupes.map((g) => [g, champs.filter((c) => (c.groupe || "Sans groupe") === g)] as const).filter(([, l]) => l.length);

  const regler = (c: ChampDico, maj: Parameters<typeof editionsApi.dicoModifierChamp>[2]) =>
    editionsApi.dicoModifierChamp(source.code, c.code, maj).then(onChange).catch(erreur("Modification impossible"));
  const supprimerChamp = (c: ChampDico) => {
    if (!window.confirm(`Supprimer le champ « ${c.libelle} » (${c.code}) ?`)) return;
    editionsApi.dicoSupprimerChamp(source.code, c.code).then(() => { toast({ title: "Champ supprimé", description: c.libelle }); onChange(); })
      .catch(erreur("Suppression impossible"));
  };
  const supprimerSource = () => {
    if (!window.confirm(`Supprimer la source « ${source.libelle} » et tous ses champs ?`)) return;
    editionsApi.dicoSupprimerSource(source.code).then(() => { toast({ title: "Source supprimée", description: source.libelle }); onSupprimee(); })
      .catch(erreur("Suppression impossible"));
  };
  const voirApercu = () => editionsApi.dicoApercuSource(source.code).then(setApercu).catch(erreur("Aperçu impossible"));

  return (
    <Card className="carte-edition min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <Database className="mt-1 h-5 w-5 text-primary" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{source.libelle}</h2>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{source.code}</span> · {NATURES[source.nature] ?? source.nature}
            {source.definition && <> · table <span className="font-mono">{source.definition.table_principale}</span></>}
            {source.contexte_requis.length > 0 && <> · paramètre requis : {source.contexte_requis.join(", ")}</>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {source.perso && <ActionIcone icone={Eye} nature="voir" libelle="Aperçu" titre="Premières lignes de la source (société active)" onClick={voirApercu} />}
          {source.perso && admin && <ActionIcone icone={Pencil} nature="voir" libelle="Définition" titre="Table, filtre société, conditions" onClick={() => setDefinitionOuverte(true)} />}
          {source.perso && admin && <ActionIcone icone={Trash2} nature="supprimer" titre="Supprimer la source" onClick={supprimerSource} />}
        </div>
      </div>

      <Tabs defaultValue="champs">
        <TabsList>
          <TabsTrigger value="champs">Champs <span className="ml-1 opacity-60">{source.champs.length}</span></TabsTrigger>
          <TabsTrigger value="relations">Relations <span className="ml-1 opacity-60">{source.relations.length}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="champs" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un champ…" className="h-9 pl-8" />
            </div>
            <Liste className="w-56" value={groupe} onChange={setGroupe} vide="Tous les groupes" options={groupes.map((g) => ({ v: g, l: g }))} />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={masques_} onCheckedChange={setMasquesVus} />Champs masqués</label>
            {admin && <Button className="ml-auto" size="sm" onClick={() => setEdition("NOUVEAU")}><Plus className="mr-1 h-4 w-4" />Ajouter un champ</Button>}
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Champ</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Origine</th>
                  <th className="px-3 py-2 font-medium">Lu dans</th>
                  <th className="px-3 py-2 text-center font-medium">Visible</th>
                  <th className="px-3 py-2 text-center font-medium">Sensible</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {parGroupe.map(([g, liste]) => (
                  <GroupeLignes key={g} titre={g} nb={liste.length}>
                    {liste.map((c) => (
                      <tr key={c.code} className={`border-t hover:bg-muted/30 ${c.visible ? "" : "text-muted-foreground"}`}>
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{c.libelle}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{c.code}</div>
                        </td>
                        <td className="px-3 py-1.5 text-xs">{LIB_TYPE[c.type_donnee] ?? c.type_donnee}{c.masque_defaut ? <span className="text-muted-foreground"> · {c.masque_defaut}</span> : null}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {c.perso
                            ? <span className="rounded bg-[hsl(var(--accent)/0.12)] px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--accent))]">Ajouté</span>
                            : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">Système</span>}
                          {!c.perso && (c.libelle_modifie || c.groupe_modifie) && <span className="ml-1 text-[11px] text-[hsl(var(--warning))]">modifié</span>}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground"><Provenance c={c} source={source} /></td>
                        <td className="px-3 py-1.5 text-center"><Switch checked={c.visible} disabled={!admin} onCheckedChange={(v) => regler(c, { visible: v })} /></td>
                        <td className="px-3 py-1.5 text-center"><Switch checked={c.sensible} disabled={!admin} onCheckedChange={(v) => regler(c, { sensible: v })} /></td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-0.5">
                            {admin && <ActionIcone icone={Pencil} nature="voir" titre="Modifier" onClick={() => setEdition(c)} />}
                            {admin && !c.perso && (c.libelle_modifie || c.groupe_modifie) &&
                              <ActionIcone icone={RotateCcw} nature="archiver" titre="Réinitialiser (libellé, groupe, masque, sensibilité du système)" onClick={() => regler(c, { reinitialiser: true })} />}
                            {admin && c.perso && c.code !== "id" && c.code !== "collaborateur_id" &&
                              <ActionIcone icone={Trash2} nature="supprimer" titre="Supprimer le champ ajouté" onClick={() => supprimerChamp(c)} />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </GroupeLignes>
                ))}
                {!parGroupe.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun champ.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="relations" className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Une relation relie chaque ligne de cette source aux lignes d'une source personnalisée : elle alimente un jeu secondaire (tableau) dans le designer.</p>
            {admin && <Button className="ml-auto" size="sm" onClick={() => setRelation(true)}><Plus className="mr-1 h-4 w-4" />Nouvelle relation</Button>}
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Relation</th><th className="px-3 py-2 font-medium">Mène à</th>
                  <th className="px-3 py-2 font-medium">Association</th><th className="px-3 py-2 font-medium">Lignes</th>
                  <th className="px-3 py-2 font-medium">Origine</th><th className="px-3 py-2 text-right font-medium">Actions</th></tr>
              </thead>
              <tbody>
                {source.relations.map((r) => (
                  <tr key={r.code} className="border-t">
                    <td className="px-3 py-1.5"><div className="font-medium">{r.libelle || r.code}</div><div className="font-mono text-[11px] text-muted-foreground">{r.code}</div></td>
                    <td className="px-3 py-1.5 text-xs">{sources.find((s) => s.code === r.cible)?.libelle ?? r.cible}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{r.cle_source} <ArrowRight className="inline h-3 w-3" /> {r.cle_cible}</td>
                    <td className="px-3 py-1.5 text-xs">{r.cardinalite === "UN" ? "Une" : "Plusieurs"}</td>
                    <td className="px-3 py-1.5 text-xs">{r.perso ? "Ajoutée" : "Système"}</td>
                    <td className="px-3 py-1.5 text-right">
                      {admin && r.perso && <ActionIcone icone={Trash2} nature="supprimer" titre="Supprimer la relation"
                        onClick={() => window.confirm(`Supprimer la relation « ${r.code} » ?`) && editionsApi.dicoSupprimerRelation(source.code, r.code).then(onChange).catch(erreur("Suppression impossible"))} />}
                    </td>
                  </tr>
                ))}
                {!source.relations.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">Aucune relation.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {edition && (
        <DialogueChamp source={source} champ={edition === "NOUVEAU" ? null : edition} tables={tables} masques={masques}
          groupes={groupes} onFermer={() => setEdition(null)} onOk={() => { setEdition(null); onChange(); }} />
      )}
      {relation && (
        <DialogueRelation source={source} sources={sources} tables={tables} onFermer={() => setRelation(false)}
          onOk={() => { setRelation(false); onChange(); }} />
      )}
      {definitionOuverte && source.definition && (
        <DialogueSource tables={tables} source={source} onFermer={() => setDefinitionOuverte(false)}
          onOk={() => { setDefinitionOuverte(false); onChange(); }} />
      )}
      {apercu && (
        <Dialog open onOpenChange={(o) => !o && setApercu(null)}>
          <DialogContent className="ecran-editions-texte max-w-5xl">
            <DialogHeader><DialogTitle>Aperçu — {source.libelle} <span className="text-sm font-normal text-muted-foreground">({apercu.total} ligne(s), société active)</span></DialogTitle></DialogHeader>
            <TableauValeurs lignes={apercu.lignes} />
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function GroupeLignes({ titre, nb, children }: { titre: string; nb: number; children: ReactNode }) {
  return (
    <>
      <tr className="border-t bg-muted/30"><td colSpan={7} className="px-3 py-1 text-xs font-semibold text-primary">{titre} <span className="font-normal text-muted-foreground">· {nb}</span></td></tr>
      {children}
    </>
  );
}

function Provenance({ c, source }: { c: ChampDico; source: SourceDico }) {
  const d = c.definition;
  if (!d) return <span>{c.perso ? (source.definition ? `${source.definition.table_principale} (clé)` : "—") : "calculé par l'application"}</span>;
  if (d.mode === "COLONNE") return <span className="font-mono">{source.definition?.table_principale}.{d.colonne}</span>;
  const ag = AGREGATS.find((a) => a.v === d.agregat)?.l.toLowerCase();
  return (
    <span>
      <span className="font-mono">{d.cle_ligne}</span> <ArrowRight className="inline h-3 w-3" /> <span className="font-mono">{d.table_cible}.{d.colonne_cle}</span>
      {d.agregat !== "NB" && <> · lit <span className="font-mono">{d.colonne_valeur}</span></>}
      {d.agregat !== "PREMIER" && <> · {ag}</>}
      {d.colonne_date_debut && <> · en vigueur {d.date_reference === "AUJOURDHUI" ? "aujourd'hui" : "à la période"}</>}
    </span>
  );
}

function TableauValeurs({ lignes, colonnes }: { lignes: Record<string, unknown>[]; colonnes?: string[] }) {
  const aplatir = (o: Record<string, unknown>, p = ""): Record<string, unknown> => Object.entries(o).reduce((acc, [k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? { ...acc, ...aplatir(v as Record<string, unknown>, `${p}${k}.`) } : { ...acc, [`${p}${k}`]: v }, {});
  const plates = lignes.map((l) => aplatir(l));
  const cols = colonnes ?? [...new Set(plates.flatMap((l) => Object.keys(l)))];
  if (!lignes.length) return <p className="py-4 text-center text-xs text-muted-foreground">Aucune ligne.</p>;
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-left"><tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">{c}</th>)}</tr></thead>
        <tbody>{plates.map((l, i) => <tr key={i} className="border-t">{cols.map((c) => <td key={c} className="whitespace-nowrap px-2 py-1">{afficher(l[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sélecteurs de tables et de colonnes (structure réelle de la base)
function ChoixTable({ tables, value, onChange, referentiels }: { tables: TableDico[]; value: string; onChange: (t: string) => void; referentiels?: boolean }) {
  const [filtre, setFiltre] = useState("");
  const options = tables.filter((t) => (!referentiels || t.referentiel) && (!filtre || t.nom.includes(filtre.toLowerCase())) || t.nom === value)
    .slice(0, 300).map((t) => ({ v: t.nom, l: <span className="font-mono">{t.nom}</span>, titre: `${t.colonnes.length} colonnes${t.a_societe ? " · par société" : ""}` }));
  return (
    <div className="flex gap-2">
      <Input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer…" className="h-9 w-32" />
      <Liste className="flex-1" value={value} onChange={onChange} options={options} placeholder={referentiels ? "Choisir un référentiel…" : "Choisir une table…"} largeurMenu="min-w-[22rem]" />
    </div>
  );
}

function ChoixColonne({ table, value, onChange, vide, placeholder }: { table?: TableDico; value?: string | null; onChange: (c: string) => void; vide?: string; placeholder?: string }) {
  return (
    <Liste value={value ?? ""} onChange={onChange} vide={vide} disabled={!table} placeholder={placeholder ?? "Choisir une colonne…"}
      options={(table?.colonnes ?? []).map((c) => ({ v: c.nom, l: <span><span className="font-mono">{c.nom}</span> <span className="text-muted-foreground">· {c.type}</span></span> }))} />
  );
}

function Champ({ libelle, aide, children, className }: { libelle: string; aide?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{libelle}</span>
      {children}
      {aide && <span className="mt-0.5 block text-[11px] text-muted-foreground">{aide}</span>}
    </label>
  );
}

function Conditions({ table, valeur, onChange }: { table?: TableDico; valeur: ConditionDico[]; onChange: (c: ConditionDico[]) => void }) {
  return (
    <div className="space-y-1.5">
      {valeur.map((c, i) => (
        <div key={i} className="flex gap-1.5">
          <div className="flex-1"><ChoixColonne table={table} value={c.colonne} onChange={(v) => onChange(valeur.map((x, k) => k === i ? { ...x, colonne: v } : x))} /></div>
          <Liste className="w-36" value={c.operateur} onChange={(v) => onChange(valeur.map((x, k) => k === i ? { ...x, operateur: v } : x))} options={OPERATEURS} />
          {!["VIDE", "NON_VIDE"].includes(c.operateur) &&
            <Input className="h-9 w-36" value={c.valeur ?? ""} placeholder="valeur" onChange={(e) => onChange(valeur.map((x, k) => k === i ? { ...x, valeur: e.target.value } : x))} />}
          <ActionIcone icone={Trash2} nature="supprimer" titre="Retirer la condition" onClick={() => onChange(valeur.filter((_, k) => k !== i))} />
        </div>
      ))}
      <button type="button" disabled={!table} className="flex items-center gap-1 text-xs text-primary disabled:opacity-40"
        onClick={() => onChange([...valeur, { colonne: "", operateur: "=", valeur: "" }])}><Plus className="h-3 w-3" />Condition</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ajouter / modifier un champ (RG-EDT-DICO-01, -04)
function DialogueChamp({ source, champ, tables, masques, groupes, onFermer, onOk }: {
  source: SourceDico; champ: ChampDico | null; tables: TableDico[]; masques: Masque[]; groupes: string[];
  onFermer: () => void; onOk: () => void;
}) {
  const ajout = champ === null;
  const avecDefinition = ajout || champ.perso && !!champ.definition;
  const [libelle, setLibelle] = useState(champ?.libelle ?? "");
  const [groupeChamp, setGroupeChamp] = useState(champ?.groupe ?? "Compléments");
  const [code, setCode] = useState(champ?.code ?? "");
  const [codeManuel, setCodeManuel] = useState(!ajout);
  const [type, setType] = useState(champ?.perso ? champ.type_donnee : "");
  const [masque, setMasque] = useState(champ?.masque_defaut ?? "");
  const [sensible, setSensible] = useState(champ?.sensible ?? false);
  const [description, setDescription] = useState(champ?.description ?? "");
  const [d, setD] = useState<DefinitionChamp>(() => champ?.definition
    ? { ...champ.definition, conditions: champ.definition.conditions ?? [] }
    : { mode: source.perso ? "COLONNE" : "RECHERCHE", agregat: "PREMIER", date_reference: "PERIODE", conditions: [] });
  const [referentiel, setReferentiel] = useState(false);
  const [historise, setHistorise] = useState(!!(champ?.definition?.colonne_date_debut || champ?.definition?.colonne_date_fin));
  const [cles, setCles] = useState("");
  const [essai, setEssai] = useState<{ cle: string; valeur: unknown; nb_lignes: number }[] | null>(null);
  const [apercuTable, setApercuTable] = useState<{ colonnes: string[]; lignes: Record<string, unknown>[] } | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => { if (ajout && !codeManuel) setCode(`${slug(groupeChamp)}.${slug(libelle)}`); }, [libelle, groupeChamp, ajout, codeManuel]);
  const maj = (m: Partial<DefinitionChamp>) => { setD((x) => ({ ...x, ...m })); setEssai(null); };
  const table = tables.find((t) => t.nom === d.table_cible);
  const tablePrincipale = tables.find((t) => t.nom === source.definition?.table_principale);

  // valeurs de la ligne pouvant servir de clé : les champs de la source
  const clesLigne: OptionListe[] = source.champs.filter((c) => c.code !== champ?.code)
    .map((c) => ({ v: c.code, l: <span>{c.libelle} <span className="font-mono text-muted-foreground">· {c.code}</span></span>, groupe: c.groupe || "Sans groupe" }));
  const choisirTable = (t: string) => {
    const tb = tables.find((x) => x.nom === t);
    const noms = new Set(tb?.colonnes.map((c) => c.nom));
    // propositions : code / libelle (référentiel), collaborateur_id (table du salarié)
    const cleProposee = noms.has("code") ? "code" : d.cle_ligne?.endsWith("collaborateur_id") && noms.has("collaborateur_id") ? "collaborateur_id" : noms.has("id") ? "id" : null;
    maj({ table_cible: t, colonne_cle: cleProposee, colonne_valeur: noms.has("libelle") ? "libelle" : null, colonne_date_debut: null, colonne_date_fin: null, colonne_ordre: null, conditions: [] });
    setApercuTable(null);
  };
  const definitionEnvoyee = (): DefinitionChamp => ({
    ...d, colonne_date_debut: historise ? d.colonne_date_debut : null, colonne_date_fin: historise ? d.colonne_date_fin : null,
    conditions: (d.conditions ?? []).filter((c) => c.colonne),
  });

  const tester = () => editionsApi.dicoTesterChamp(source.code, definitionEnvoyee(), cles.split(/[,;\s]+/).filter(Boolean))
    .then((r) => setEssai(r.resultats)).catch(erreur("Essai impossible"));
  const voirTable = () => d.table_cible && editionsApi.dicoApercuTable(d.table_cible,
    [d.colonne_cle, d.colonne_valeur, d.colonne_date_debut, d.colonne_date_fin, d.colonne_ordre].filter(Boolean) as string[])
    .then(setApercuTable).catch(erreur("Aperçu impossible"));

  const enregistrer = async () => {
    setOccupe(true);
    try {
      if (ajout) {
        await editionsApi.dicoCreerChamp(source.code, { ...definitionEnvoyee(), code, libelle, groupe: groupeChamp, type_donnee: type || undefined,
          masque_defaut: masque || null, sensible, description: description || null });
        toast({ title: "Champ ajouté", description: `${libelle} — disponible dans le designer (${code})` });
      } else {
        await editionsApi.dicoModifierChamp(source.code, champ.code, { libelle, groupe: groupeChamp, masque_defaut: masque || null, sensible,
          description: description || null, ...(champ.perso ? { type_donnee: type as ChampDico["type_donnee"] } : {}),
          ...(avecDefinition && champ.definition ? { definition: definitionEnvoyee() } : {}) });
        toast({ title: "Champ modifié", description: libelle });
      }
      onOk();
    } catch (e) { erreur("Enregistrement impossible")(e); } finally { setOccupe(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="ecran-editions-texte max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{ajout ? `Ajouter un champ à « ${source.libelle} »` : `Champ « ${champ.libelle} »`}</DialogTitle></DialogHeader>

        <Section titre="1. Le champ" aide="Ce que verra le concepteur dans le designer.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Libellé"><Input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="ex. Intitulé du grade" /></Champ>
            <Champ libelle="Groupe" aide="Rubrique où il apparaît (Qualification, Prêts…)">
              <Input value={groupeChamp} list="groupes-dico" onChange={(e) => setGroupeChamp(e.target.value)} />
              <datalist id="groupes-dico">{groupes.map((g) => <option key={g} value={g} />)}</datalist>
            </Champ>
            <Champ libelle="Code (dans les formules)" aide={ajout ? "Proposé à partir du groupe et du libellé" : "Non modifiable : les modèles l'utilisent"}>
              <Input className="font-mono" value={code} disabled={!ajout} onChange={(e) => { setCodeManuel(true); setCode(e.target.value); }} />
            </Champ>
            {(ajout || champ.perso) && <Champ libelle="Type"><Liste value={type} onChange={setType} options={TYPES} /></Champ>}
            <Champ libelle="Masque d'affichage par défaut">
              <Liste value={masque} onChange={setMasque} vide="Aucun" options={masques.map((m) => ({ v: m.code, l: `${m.libelle} (${m.exemple})` }))} />
            </Champ>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={sensible} onCheckedChange={(v) => setSensible(!!v)} />
              Donnée sensible <span className="text-[11px] text-muted-foreground">(masquée sans le droit « Données sensibles »)</span></label>
            <Champ libelle="Description (aide du concepteur)" className="sm:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Champ>
          </div>
        </Section>

        {avecDefinition && (
          <Section titre="2. Où lire l'information" aide="Choisissez dans la structure réelle de la base : aucune requête à écrire.">
            {source.perso && (
              <div className="mb-3 inline-flex rounded-md border bg-card p-0.5 text-xs" role="group">
                {([["COLONNE", "Colonne de la table principale"], ["RECHERCHE", "Rechercher dans une autre table"]] as const).map(([m, l]) => (
                  <button key={m} type="button" disabled={!ajout} onClick={() => maj({ mode: m })}
                    className={`rounded px-2.5 py-1 ${d.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
                ))}
              </div>
            )}
            {d.mode === "COLONNE" ? (
              <Champ libelle={`Colonne de ${source.definition?.table_principale ?? "la table"}`}>
                <ChoixColonne table={tablePrincipale} value={d.colonne} onChange={(v) => { maj({ colonne: v }); if (ajout && !libelle) setLibelle(v.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase())); }} />
              </Champ>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Champ libelle="Valeur de la ligne qui sert de clé" aide="ex. Code grade, Collaborateur (identifiant), Matricule">
                    <Liste value={d.cle_ligne ?? ""} onChange={(v) => maj({ cle_ligne: v })} options={clesLigne} placeholder="Choisir un champ…" largeurMenu="min-w-[24rem]" />
                  </Champ>
                  <Champ libelle="Table où la chercher">
                    <ChoixTable tables={tables} value={d.table_cible ?? ""} onChange={choisirTable} referentiels={referentiel} />
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Switch checked={referentiel} onCheckedChange={setReferentiel} />Référentiels seulement (code → intitulé)
                    </label>
                  </Champ>
                  <Champ libelle="Colonne de la table égale à la clé"><ChoixColonne table={table} value={d.colonne_cle} onChange={(v) => maj({ colonne_cle: v })} /></Champ>
                  <Champ libelle="Colonne à lire" aide={d.agregat === "NB" ? "Inutile pour un nombre de lignes" : "ex. libelle, montant"}>
                    <ChoixColonne table={table} value={d.colonne_valeur} onChange={(v) => maj({ colonne_valeur: v })} vide={d.agregat === "NB" ? "—" : undefined} />
                  </Champ>
                  <Champ libelle="S'il y a plusieurs lignes, prendre">
                    <Liste value={d.agregat ?? "PREMIER"} onChange={(v) => maj({ agregat: v as Agregat })} options={AGREGATS} />
                  </Champ>
                  {["PREMIER", "DERNIER", "LISTE"].includes(d.agregat ?? "PREMIER") && (
                    <Champ libelle="Dans l'ordre de" aide="ex. date d'octroi, numéro">
                      <ChoixColonne table={table} value={d.colonne_ordre} onChange={(v) => maj({ colonne_ordre: v || null })} vide="Ordre de la base" />
                    </Champ>
                  )}
                </div>
                <div className="rounded-md border p-2.5">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={historise} onCheckedChange={setHistorise} />
                    Table historisée : ligne en vigueur à une date</label>
                  {historise && (
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      <Champ libelle="Date de début"><ChoixColonne table={table} value={d.colonne_date_debut} onChange={(v) => maj({ colonne_date_debut: v || null })} vide="—" /></Champ>
                      <Champ libelle="Date de fin"><ChoixColonne table={table} value={d.colonne_date_fin} onChange={(v) => maj({ colonne_date_fin: v || null })} vide="—" /></Champ>
                      <Champ libelle="À la date">
                        <Liste value={d.date_reference ?? "PERIODE"} onChange={(v) => maj({ date_reference: v as "PERIODE" | "AUJOURDHUI" })}
                          options={[{ v: "PERIODE", l: "De fin de la période de paie" }, { v: "AUJOURDHUI", l: "Du jour de l'édition" }]} />
                      </Champ>
                    </div>
                  )}
                </div>
                <Champ libelle="Conditions fixes (facultatif)" aide="ex. archive = false, statut = ACTIF">
                  <Conditions table={table} valeur={d.conditions ?? []} onChange={(c) => maj({ conditions: c })} />
                </Champ>
                {d.table_cible && (
                  <div>
                    <ActionIcone icone={Table2} nature="copier" libelle="Voir les premières lignes de la table" titre="Aperçu de la table (société active)" onClick={voirTable} />
                    {apercuTable && <div className="mt-1"><TableauValeurs lignes={apercuTable.lignes} colonnes={apercuTable.colonnes} /></div>}
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {avecDefinition && d.mode === "RECHERCHE" && (
          <Section titre="3. Essai" aide="Valeurs trouvées pour quelques clés : saisissez-en (séparées par des virgules) ou laissez vide pour prendre les premières de la table.">
            <div className="flex gap-2">
              <Input value={cles} onChange={(e) => setCles(e.target.value)} placeholder="ex. CAD, EMP" className="h-9" />
              <Button variant="outline" size="sm" onClick={tester} disabled={!d.table_cible || !d.colonne_cle}><Play className="mr-1 h-4 w-4" />Tester</Button>
            </div>
            {essai && (
              <div className="mt-2 overflow-hidden rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left"><tr><th className="px-2 py-1.5">Clé</th><th className="px-2 py-1.5">Valeur obtenue</th><th className="px-2 py-1.5 text-right">Lignes trouvées</th></tr></thead>
                  <tbody>{essai.map((r) => <tr key={r.cle} className="border-t"><td className="px-2 py-1 font-mono">{r.cle}</td><td className="px-2 py-1">{afficher(r.valeur)}</td><td className="px-2 py-1 text-right">{r.nb_lignes}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </Section>
        )}
        {!avecDefinition && !champ?.perso && (
          <p className="text-xs text-muted-foreground">Champ calculé par l'application : seuls son libellé, son groupe, son masque et sa sensibilité se règlent ici. Pour une autre information, ajoutez un champ.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button onClick={enregistrer} disabled={occupe || !libelle.trim() || !code.trim()}>
            {occupe && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{ajout ? "Ajouter le champ" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ titre, aide, children }: { titre: string; aide?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      <h3 className="text-sm font-semibold text-primary">{titre}</h3>
      {aide && <p className="mb-2 text-[11px] text-muted-foreground">{aide}</p>}
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Source personnalisée : création et définition (RG-EDT-DICO-02)
function DialogueSource({ tables, source, onFermer, onOk }: { tables: TableDico[]; source?: SourceDico; onFermer: () => void; onOk: (code: string) => void }) {
  const ajout = !source;
  const def = source?.definition;
  const [libelle, setLibelle] = useState(source?.libelle ?? "");
  const [code, setCode] = useState(source?.code ?? "");
  const [codeManuel, setCodeManuel] = useState(!ajout);
  const [s, setS] = useState<DefinitionSource>({
    table_principale: def?.table_principale ?? "", colonne_cle: def?.colonne_cle ?? "id", colonne_societe: def?.colonne_societe ?? null,
    colonne_collaborateur: def?.colonne_collaborateur ?? null, conditions: def?.conditions ?? [], description: def?.description ?? "",
  });
  const [colonnes, setColonnes] = useState<string[]>([]);
  const [occupe, setOccupe] = useState(false);
  const table = tables.find((t) => t.nom === s.table_principale);
  useEffect(() => { if (ajout && !codeManuel) setCode(slug(libelle).toUpperCase().slice(0, 40)); }, [libelle, ajout, codeManuel]);

  const choisirTable = (t: string) => {
    const tb = tables.find((x) => x.nom === t);
    const noms = new Set(tb?.colonnes.map((c) => c.nom));
    setS((x) => ({ ...x, table_principale: t, colonne_cle: noms.has("id") ? "id" : null, colonne_societe: noms.has("societe_id") ? "societe_id" : null,
      colonne_collaborateur: noms.has("collaborateur_id") ? "collaborateur_id" : null, conditions: [] }));
    setColonnes((tb?.colonnes ?? []).map((c) => c.nom).filter((c) => !["id", "societe_id", "collaborateur_id"].includes(c)).slice(0, 12));
    if (ajout && !libelle) setLibelle(t.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()));
  };
  const enregistrer = async () => {
    setOccupe(true);
    try {
      const corps = { ...s, conditions: (s.conditions ?? []).filter((c) => c.colonne), libelle, code };
      const r = ajout ? await editionsApi.dicoCreerSource({ ...corps, colonnes }) : await editionsApi.dicoModifierSource(source.code, corps);
      toast({ title: ajout ? "Source créée" : "Source modifiée", description: `${libelle} (${r.code})` });
      onOk(r.code);
    } catch (e) { erreur("Enregistrement impossible")(e); } finally { setOccupe(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="ecran-editions-texte max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{ajout ? "Nouvelle source de données" : `Définition de « ${source.libelle} »`}</DialogTitle></DialogHeader>
        <Section titre="La source" aide="Une ligne de la table = une ligne de la source (un document, ou une ligne de tableau via une relation).">
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Libellé"><Input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="ex. Prêts et avances" /></Champ>
            <Champ libelle="Code" aide={ajout ? "Majuscules, chiffres et _" : "Non modifiable"}>
              <Input className="font-mono" value={code} disabled={!ajout} onChange={(e) => { setCodeManuel(true); setCode(e.target.value.toUpperCase()); }} />
            </Champ>
            <Champ libelle="Table principale" className="sm:col-span-2"><ChoixTable tables={tables} value={s.table_principale} onChange={choisirTable} /></Champ>
            <Champ libelle="Colonne identifiant (une valeur par ligne)"><ChoixColonne table={table} value={s.colonne_cle} onChange={(v) => setS({ ...s, colonne_cle: v })} /></Champ>
            <Champ libelle="Description"><Input value={s.description ?? ""} onChange={(e) => setS({ ...s, description: e.target.value })} /></Champ>
          </div>
        </Section>
        <Section titre="Filtre société (obligatoire)" aide="Chaque édition ne lit que les lignes de la société active : par la colonne société de la table, ou par le collaborateur rattaché à la société.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Colonne société"><ChoixColonne table={table} value={s.colonne_societe} vide="—" onChange={(v) => setS({ ...s, colonne_societe: v || null })} /></Champ>
            <Champ libelle="Colonne collaborateur" aide="Sert aussi au paramètre « Collaborateurs » et aux relations depuis les bulletins">
              <ChoixColonne table={table} value={s.colonne_collaborateur} vide="—" onChange={(v) => setS({ ...s, colonne_collaborateur: v || null })} />
            </Champ>
          </div>
        </Section>
        <Section titre="Conditions fixes (facultatif)" aide="ex. archive = false"><Conditions table={table} valeur={s.conditions ?? []} onChange={(c) => setS({ ...s, conditions: c })} /></Section>
        {ajout && table && (
          <Section titre="Colonnes proposées comme champs" aide="Chaque colonne cochée devient un champ (libellé et groupe modifiables ensuite).">
            <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-3">
              {table.colonnes.filter((c) => c.nom !== s.colonne_cle && c.nom !== s.colonne_collaborateur).map((c) => (
                <label key={c.nom} className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={colonnes.includes(c.nom)} onCheckedChange={(v) => setColonnes((x) => v ? [...x, c.nom] : x.filter((y) => y !== c.nom))} />
                  <span className="font-mono">{c.nom}</span><span className="text-muted-foreground">· {LIB_TYPE[c.type_donnee]}</span>
                </label>
              ))}
            </div>
          </Section>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button onClick={enregistrer} disabled={occupe || !libelle.trim() || !s.table_principale}>
            {occupe && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{ajout ? "Créer la source" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Relation vers une source personnalisée (RG-EDT-DICO-03)
function DialogueRelation({ source, sources, tables, onFermer, onOk }: { source: SourceDico; sources: SourceDico[]; tables: TableDico[]; onFermer: () => void; onOk: () => void }) {
  const cibles = sources.filter((s) => s.perso);
  const [cible, setCible] = useState(cibles[0]?.code ?? "");
  const [cleSource, setCleSource] = useState(source.champs.some((c) => c.code === "collaborateur_id") ? "collaborateur_id" : "id");
  const [cleCible, setCleCible] = useState("");
  const [libelle, setLibelle] = useState("");
  const [code, setCode] = useState("");
  const [cardinalite, setCardinalite] = useState<"UN" | "PLUSIEURS">("PLUSIEURS");
  const sc = sources.find((s) => s.code === cible);
  const table = tables.find((t) => t.nom === sc?.definition?.table_principale);
  useEffect(() => {
    if (sc) { setCode(slug(sc.libelle)); setLibelle(sc.libelle); setCleCible(sc.definition?.colonne_collaborateur ?? sc.definition?.colonne_cle ?? ""); }
  }, [cible]); // eslint-disable-line react-hooks/exhaustive-deps

  const creer = () => editionsApi.dicoCreerRelation({ source: source.code, cible, code, libelle, cle_source: cleSource, cle_cible: cleCible, cardinalite })
    .then(() => { toast({ title: "Relation créée", description: `${source.libelle} → ${sc?.libelle}` }); onOk(); })
    .catch(erreur("Création impossible"));

  return (
    <Dialog open onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="ecran-editions-texte max-w-2xl">
        <DialogHeader><DialogTitle>Nouvelle relation depuis « {source.libelle} »</DialogTitle></DialogHeader>
        {!cibles.length ? (
          <p className="text-sm text-muted-foreground">Créez d'abord une source personnalisée (bouton « Nouvelle source ») : une relation mène toujours à une source personnalisée.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Mène à la source" className="sm:col-span-2">
              <Liste value={cible} onChange={setCible} options={cibles.map((s) => ({ v: s.code, l: `${s.libelle} (${s.code})` }))} />
            </Champ>
            <Champ libelle={`Valeur de « ${source.libelle} »`} aide="ex. Collaborateur (identifiant)">
              <Liste value={cleSource} onChange={setCleSource} largeurMenu="min-w-[22rem]"
                options={source.champs.map((c) => ({ v: c.code, l: <span>{c.libelle} <span className="font-mono text-muted-foreground">· {c.code}</span></span>, groupe: c.groupe || "Sans groupe" }))} />
            </Champ>
            <Champ libelle={`égale à la colonne de ${sc?.definition?.table_principale ?? "la table"}`}>
              <ChoixColonne table={table} value={cleCible} onChange={setCleCible} />
            </Champ>
            <Champ libelle="Nom de la relation (dans le designer)"><Input value={libelle} onChange={(e) => setLibelle(e.target.value)} /></Champ>
            <Champ libelle="Code"><Input className="font-mono" value={code} onChange={(e) => setCode(slug(e.target.value))} /></Champ>
            <Champ libelle="Pour une ligne de la source">
              <Liste value={cardinalite} onChange={(v) => setCardinalite(v as "UN" | "PLUSIEURS")}
                options={[{ v: "PLUSIEURS", l: "Plusieurs lignes liées" }, { v: "UN", l: "Une ligne liée" }]} />
            </Champ>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button onClick={creer} disabled={!cible || !cleSource || !cleCible}><Link2 className="mr-1 h-4 w-4" />Créer la relation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
