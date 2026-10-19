/**
 * EditionsPage.tsx — Bibliothèque des modèles d'édition (/editions).
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Lister, créer (vierge ou par copie), concevoir et lancer les modèles visibles
 * dans la société active. L'accès au menu et les droits fins (voir, lancer,
 * concevoir, publier) sont contrôlés par le serveur : un bouton refusé renvoie
 * un message clair, jamais un écran blanc.
 */
import { useEffect, useMemo, useState } from "react";
import ReturnTrail from "@/components/navigation/ReturnTrail";
import { useRetour } from "./retour";
import "./editions.css";
import {
  Archive, ArchiveRestore, Copy, Download, ExternalLink, FileText, Folder, Globe, Building2, LayoutGrid, List, Loader2, Lock,
  Pencil, Play, Plus, Search, ShieldCheck, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  CATEGORIES, editionsApi, ErreurEdition, type Categorie, type DocumentProduit, type Modele, type Visibilite,
} from "@/lib/editionsApi";
import type { Parametre } from "./types";
import ParametresForm, { parametresManquants, type Valeurs } from "./ParametresForm";
import { BoutonMenus, libelleEcran, useEcransCategorie } from "./MenusModele";
import { Switch } from "@/components/ui/switch";

const classe = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

export default function EditionsPage() {
  const retour = useRetour();
  // RG-EDT-NAV-01 : le designer ramène ici, et d'ici à l'écran qui a ouvert les éditions
  const concevoir = (id: string) => retour.ouvrir(`/editions/${id}/designer`, "Éditions");
  const [modeles, setModeles] = useState<Modele[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [categorie, setCategorie] = useState<Categorie | "">("");
  const [q, setQ] = useState("");
  // affichage par badges (cartes) ou par liste, mémorisé sur le poste
  const [vue, setVue] = useState<"BADGES" | "LISTE">(() => { try { return localStorage.getItem("editions.vue") === "LISTE" ? "LISTE" : "BADGES"; } catch { return "BADGES"; } });
  const changerVue = (v: "BADGES" | "LISTE") => { setVue(v); try { localStorage.setItem("editions.vue", v); } catch { /* préférence facultative */ } };
  const [archives, setArchives] = useState(false);
  const [tri, setTri] = useState<{ cle: "libelle" | "categorie" | "dossier" | "version"; sens: 1 | -1 }>({ cle: "libelle", sens: 1 });
  const trier = (cle: typeof tri.cle) => setTri((t) => ({ cle, sens: t.cle === cle ? (-t.sens as 1 | -1) : 1 }));
  const [creation, setCreation] = useState<{ ouvert: boolean; code: string; libelle: string; categorie: Categorie; visibilite: Visibilite; origine: string; occupe?: boolean }>(
    { ouvert: false, code: "", libelle: "", categorie: "LISTE", visibilite: "SOCIETE", origine: "" });
  const [lancement, setLancement] = useState<{ modele: Modele; parametres: Parametre[]; valeurs: Valeurs; occupe?: boolean; documents?: DocumentProduit[];
    formes: { code: string; libelle: string }[]; forme?: string } | null>(null);

  const charger = () => {
    editionsApi.modeles(undefined, archives)
      .then((m) => { setModeles(m); setErreur(null); })
      .catch((e: ErreurEdition) => setErreur(e.statut === 403 ? "Vous n'avez pas accès au module Éditions. Demandez à l'administrateur de cocher le menu « Éditions » pour votre rôle." : e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(charger, [archives]);

  const visibles = useMemo(() => {
    const bas = q.trim().toLowerCase();
    return (modeles ?? [])
      .filter((m) => !categorie || m.categorie === categorie)
      .filter((m) => !bas || m.libelle.toLowerCase().includes(bas) || m.code.toLowerCase().includes(bas) || (m.description ?? "").toLowerCase().includes(bas));
  }, [modeles, categorie, q]);

  const tries = useMemo(() => {
    const cle = (m: Modele) => tri.cle === "categorie" ? m.categorie : tri.cle === "dossier" ? (m.theme_libelle ?? "")
      : tri.cle === "version" ? String(m.numero_publie ?? 0).padStart(5, "0") : m.libelle;
    return [...visibles].sort((a, b) => cle(a).localeCompare(cle(b), "fr", { numeric: true }) * tri.sens);
  }, [visibles, tri]);
  const nbParCategorie = useMemo(() => (modeles ?? []).reduce<Record<string, number>>((n, m) => ({ ...n, [m.categorie]: (n[m.categorie] ?? 0) + 1 }), {}), [modeles]);

  // RG-EDT-MODELE-04/05 : archiver (réversible, garde l'historique) ≠ supprimer (définitif, jamais publié)
  const archiver = async (m: Modele, archive: boolean) => {
    if (archive && !confirm(`Archiver « ${m.libelle} » ?\n\nIl disparaît des listes, des menus et des lancements, mais reste conservé avec ses versions et ses éditions produites. Vous pourrez le désarchiver (« Afficher les archives »).`)) return;
    try {
      await editionsApi.archiver(m.id, archive);
      toast({ title: archive ? "Modèle archivé" : "Modèle désarchivé", description: m.libelle });
      charger();
    } catch (e: any) { toast({ title: "Action impossible", description: e.message, variant: "destructive" }); }
  };
  const supprimer = async (m: Modele) => {
    if (!confirm(`Supprimer définitivement « ${m.libelle} » (${m.code}) ?\n\nCette action est irréversible : le modèle et ses brouillons sont effacés.`)) return;
    try {
      await editionsApi.supprimerModele(m.id);
      toast({ title: "Modèle supprimé", description: m.libelle });
      charger();
    } catch (e: any) { toast({ title: "Suppression impossible", description: e.message, variant: "destructive" }); }
  };

  const actionsPrincipales = (m: Modele, compact = false) => (
    <>
      <Button size="sm" disabled={!m.version_publiee_id || m.actif === false || m.archive} onClick={() => ouvrirLancement(m)}
        title={m.archive ? "Modèle archivé" : m.actif === false ? "État inactif : activez-le pour le lancer" : m.version_publiee_id ? "Lancer" : "Publiez une version pour pouvoir lancer"}>
        <Play className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "Lancer"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => concevoir(m.id)} title={m.est_systeme ? "Voir" : "Concevoir"}>
        {m.est_systeme ? <Lock className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} /> : <Pencil className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />}
        {!compact && (m.est_systeme ? "Voir" : "Concevoir")}
      </Button>
      <Button size="sm" variant="ghost" title="Créer un modèle à partir de celui-ci"
        onClick={() => setCreation({ ouvert: true, code: `${m.code}_COPIE`, libelle: `${m.libelle} (copie)`, categorie: m.categorie, visibilite: "SOCIETE", origine: m.id })}>
        <Copy className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "Copier"}
      </Button>
      <BoutonMenus modele={m} onChange={charger} compact={compact} />
    </>
  );

  const actionsGestion = (m: Modele) => {
    if (m.est_systeme) return null;            // système : on le désactive (Actif), on ne l'archive ni ne le supprime
    const publie = !!m.version_publiee_id;
    return (
      <>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => archiver(m, !m.archive)}
          title={m.archive ? "Désarchiver" : "Archiver (réversible, l'historique est conservé)"}>
          {m.archive ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:text-muted-foreground"
          disabled={publie} onClick={() => supprimer(m)}
          title={publie ? "Modèle publié : des éditions ont pu en sortir, archivez-le au lieu de le supprimer" : "Supprimer définitivement (jamais publié)"}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </>
    );
  };

  const creer = async () => {
    setCreation((c) => ({ ...c, occupe: true }));
    try {
      const r = await editionsApi.creerModele({
        code: creation.code, libelle: creation.libelle, categorie: creation.categorie,
        visibilite: creation.visibilite, origine_id: creation.origine || undefined,
      });
      concevoir(r.modele_id);
    } catch (e: any) {
      toast({ title: "Création impossible", description: e.message, variant: "destructive" });
      setCreation((c) => ({ ...c, occupe: false }));
    }
  };

  const basculerActif = async (m: Modele, actif: boolean) => {
    setModeles((l) => l && l.map((x) => (x.id === m.id ? { ...x, actif } : x)));
    try {
      await editionsApi.reglerModele(m.id, { actif });
      toast({ title: actif ? "État activé" : "État désactivé", description: actif ? "Il est de nouveau proposé dans les menus." : "Il n'est plus proposé dans les menus ni lançable." });
    } catch (e: any) {
      setModeles((l) => l && l.map((x) => (x.id === m.id ? { ...x, actif: !actif } : x)));
      toast({ title: "Modification impossible", description: e.message, variant: "destructive" });
    }
  };

  const ouvrirLancement = async (m: Modele) => {
    if (!m.version_publiee_id) return;
    try {
      const v = await editionsApi.version(m.version_publiee_id);
      const d = v.definition;
      // « Autoriser choix Qrp » : les mises en forme proposées au lancement
      const formes = d.usages?.formes_au_choix
        ? [{ code: d.forme_code ?? "standard", libelle: d.forme_libelle ?? "Mise en forme standard" }, ...(d.formes ?? []).map((f) => ({ code: f.code, libelle: f.libelle }))]
        : [];
      setLancement({ modele: m, parametres: d.parametres, valeurs: {}, formes, forme: d.usages?.forme_par_defaut ?? d.forme_code ?? undefined });
    } catch (e: any) {
      toast({ title: "Lancement impossible", description: e.message, variant: "destructive" });
    }
  };

  const lancer = async () => {
    if (!lancement) return;
    const manquants = parametresManquants(lancement.parametres, lancement.valeurs);
    if (manquants.length) { toast({ title: "Paramètres manquants", description: manquants.join(", "), variant: "destructive" }); return; }
    setLancement({ ...lancement, occupe: true, documents: undefined });
    try {
      const r = await editionsApi.lancer(lancement.modele.id, lancement.valeurs, lancement.formes.length ? lancement.forme : undefined);
      setLancement((l) => l && { ...l, occupe: false, documents: r.documents });
      toast({ title: "Édition produite", description: `${r.documents.length} document(s).` });
    } catch (e: any) {
      setLancement((l) => l && { ...l, occupe: false });
      toast({ title: "Production impossible", description: e.message, variant: "destructive" });
    }
  };

  const ouvrirDoc = (d: DocumentProduit, telecharger = false) =>
    editionsApi.ouvrirDocument(d.id, telecharger, d.nom_fichier).catch((e) => toast({ title: "Ouverture impossible", description: e.message, variant: "destructive" }));

  return (
    <div className="ecran-editions w-full">
      <ReturnTrail current="Éditions" />
      <div className="w-full space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="titre-ecran font-semibold">Éditions</h1>
          <p className="text-sm text-muted-foreground">Bulletins, journaux, attestations et états : concevez, publiez et produisez vos documents.</p>
        </div>
        <Button className="ml-auto" onClick={() => setCreation({ ouvert: true, code: "", libelle: "", categorie: categorie || "LISTE", visibilite: "SOCIETE", origine: "" })}>
          <Plus className="mr-1 h-4 w-4" />Nouveau modèle
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setCategorie("")}
          className={`rounded-full px-3 py-1 text-xs ${categorie === "" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>Tous <span className="opacity-60">{modeles?.length ?? ""}</span></button>
        {CATEGORIES.map((c) => (
          <button key={c.code} type="button" onClick={() => setCategorie(c.code)}
            className={`rounded-full px-3 py-1 text-xs ${categorie === c.code ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
            {c.libelle}{nbParCategorie[c.code] ? <span className="ml-1 opacity-60">{nbParCategorie[c.code]}</span> : null}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" title="Montrer aussi les modèles archivés">
          <Switch checked={archives} onCheckedChange={setArchives} />Afficher les archives
        </label>
        <div className="inline-flex rounded-md border bg-card p-0.5" role="group" aria-label="Affichage">
          <button type="button" onClick={() => changerVue("BADGES")} title="Affichage par badges"
            className={`rounded px-2 py-1 ${vue === "BADGES" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}><LayoutGrid className="h-4 w-4" /></button>
          <button type="button" onClick={() => changerVue("LISTE")} title="Affichage en liste"
            className={`rounded px-2 py-1 ${vue === "LISTE" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}><List className="h-4 w-4" /></button>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className={`${classe} pl-8`} />
        </div>
      </div>

      {erreur && <div className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{erreur}</div>}
      {!modeles && !erreur && <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement…</div>}

      {vue === "BADGES" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibles.map((m) => (
            <div key={m.id} className={`carte-edition flex flex-col rounded-lg border bg-card p-4 ${m.actif === false || m.archive ? "bg-muted/40" : ""}`}>
              <div className="mb-2 flex items-start gap-2">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-medium ${m.actif === false ? "text-muted-foreground line-through decoration-1" : ""}`}>{m.libelle}</div>
                  <div className="text-xs text-muted-foreground">{m.code} · {CATEGORIES.find((c) => c.code === m.categorie)?.libelle}</div>
                </div>
                <Badges m={m} />
                <InterrupteurActif m={m} onChange={(v) => basculerActif(m, v)} />
              </div>
              <Dossier m={m} />
              {m.description && <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">{m.description}</p>}
              <div className="mb-3 text-xs text-muted-foreground"><EtatVersion m={m} /></div>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                {actionsPrincipales(m)}
                <span className="ml-auto flex items-center">{actionsGestion(m)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="carte-edition overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {([["libelle", "Modèle"], ["categorie", "Type"], ["dossier", "Dossier"], ["version", "Version"]] as const).map(([cle, t]) => (
                  <th key={cle} className="cursor-pointer select-none px-3 py-2 font-medium hover:text-foreground" onClick={() => trier(cle)}>
                    {t}{tri.cle === cle && (tri.sens === 1 ? " ▲" : " ▼")}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Visibilité</th>
                <th className="px-3 py-2 font-medium">Actif</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tries.map((m) => (
                <tr key={m.id} className={`border-t hover:bg-muted/30 ${m.actif === false || m.archive ? "text-muted-foreground" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <button type="button" className={`truncate text-left font-medium hover:underline ${m.actif === false ? "line-through decoration-1" : ""}`}
                          onClick={() => concevoir(m.id)} title={m.est_systeme ? "Voir" : "Concevoir"}>{m.libelle}</button>
                        <div className="text-[11px] text-muted-foreground">{m.code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{CATEGORIES.find((c) => c.code === m.categorie)?.libelle}</td>
                  <td className="px-3 py-2"><Dossier m={m} compact /></td>
                  <td className="px-3 py-2 text-xs"><EtatVersion m={m} /></td>
                  <td className="px-3 py-2"><Badges m={m} /></td>
                  <td className="px-3 py-2"><InterrupteurActif m={m} onChange={(v) => basculerActif(m, v)} /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">{actionsPrincipales(m, true)}{actionsGestion(m)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modeles && !visibles.length && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Aucun modèle{categorie ? ` de type « ${CATEGORIES.find((c) => c.code === categorie)?.libelle} »` : ""}.
          {categorie && <><br />Créez-en un (« Nouveau modèle »), ou changez le type d'un modèle existant : onglet « Tous », bouton « Classement » du modèle.</>}
        </p>
      )}

      </div>

      {/* création */}
      <Dialog open={creation.ouvert} onOpenChange={(o) => setCreation((c) => ({ ...c, ouvert: o }))}>
        <DialogContent className="ecran-editions-texte max-w-md">
          <DialogHeader><DialogTitle>{creation.origine ? "Copier un modèle" : "Nouveau modèle"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs font-medium">Libellé
              <input className={`${classe} mt-1`} value={creation.libelle} onChange={(e) => setCreation((c) => ({ ...c, libelle: e.target.value }))} />
            </label>
            <label className="block text-xs font-medium">Code (unique dans la société)
              <input className={`${classe} mt-1 uppercase`} value={creation.code}
                onChange={(e) => setCreation((c) => ({ ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") }))} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium">Catégorie
                <select className={`${classe} mt-1`} value={creation.categorie} onChange={(e) => setCreation((c) => ({ ...c, categorie: e.target.value as Categorie }))}>
                  {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium">Visible par
                <select className={`${classe} mt-1`} value={creation.visibilite} onChange={(e) => setCreation((c) => ({ ...c, visibilite: e.target.value as Visibilite }))}>
                  <option value="SOCIETE">Toute la société</option>
                  <option value="PRIVE">Moi seulement</option>
                </select>
              </label>
            </div>
            <MenusProposes categorie={creation.categorie} />
            <label className="block text-xs font-medium">Partir de
              <select className={`${classe} mt-1`} value={creation.origine} onChange={(e) => setCreation((c) => ({ ...c, origine: e.target.value }))}>
                <option value="">Un modèle vierge</option>
                {(modeles ?? []).map((m) => <option key={m.id} value={m.id}>{m.libelle} ({m.code})</option>)}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button disabled={!creation.code || !creation.libelle || creation.occupe} onClick={creer}>
              {creation.occupe && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Créer et concevoir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* lancement */}
      <Dialog open={!!lancement} onOpenChange={(o) => !o && setLancement(null)}>
        <DialogContent className="ecran-editions-texte max-w-lg">
          <DialogHeader><DialogTitle>Lancer — {lancement?.modele.libelle}</DialogTitle></DialogHeader>
          {lancement && (
            <>
              {lancement.formes.length > 1 && (
                <label className="mb-3 block">
                  <span className="mb-1 block text-xs font-medium">Mise en forme</span>
                  <select className={classe} value={lancement.forme} onChange={(e) => setLancement((l) => l && { ...l, forme: e.target.value, documents: undefined })}>
                    {lancement.formes.map((f) => <option key={f.code} value={f.code}>{f.libelle}</option>)}
                  </select>
                </label>
              )}
              <ParametresForm parametres={lancement.parametres} valeurs={lancement.valeurs}
                onChange={(v) => setLancement((l) => l && { ...l, valeurs: v, documents: undefined })} />
              {lancement.documents && (
                <div className="mt-2 max-h-64 overflow-auto rounded border">
                  {lancement.documents.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 border-b px-2 py-1.5 text-sm last:border-0">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{d.nom_fichier}</span>
                      <span className="text-xs text-muted-foreground">{d.nb_pages} p.</span>
                      {d.anomalies.length > 0 && <span className="text-xs text-[hsl(var(--warning))]" title={d.anomalies.map((a) => `${a.element} : ${a.message}`).join("\n")}>{d.anomalies.length} anomalie(s)</span>}
                      <button type="button" title="Ouvrir" onClick={() => ouvrirDoc(d)}><ExternalLink className="h-4 w-4" /></button>
                      <button type="button" title="Télécharger" onClick={() => ouvrirDoc(d, true)}><Download className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <DialogFooter>
            <Button disabled={lancement?.occupe} onClick={lancer}>
              {lancement?.occupe ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              {lancement?.documents ? "Relancer" : "Produire"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** RG-EDT-ECRAN-02 : où le modèle sera proposé une fois publié. */
function MenusProposes({ categorie }: { categorie: Categorie }) {
  const ecrans = useEcransCategorie(categorie);
  if (!ecrans.length) return null;
  return (
    <div className="rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px] text-muted-foreground">
      Une fois publié, il sera proposé dans : <span className="font-medium text-foreground">{ecrans.map(libelleEcran).join(" · ")}</span>
      <span className="block">(dossier et menus réglables ensuite par le bouton « Classement »)</span>
    </div>
  );
}

function InterrupteurActif({ m, onChange }: { m: Modele; onChange: (v: boolean) => void }) {
  // RG-EDT-ACTIF-01 : indicateur Actif (par société)
  return (
    <label className="ml-1 flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title="Inactif : l'état n'est plus proposé dans les menus ni lançable">
      <Switch checked={m.actif !== false} disabled={!!m.archive} onCheckedChange={onChange} />
      {m.actif === false ? "Inactif" : "Actif"}
    </label>
  );
}

function Dossier({ m, compact }: { m: Modele; compact?: boolean }) {
  if (!m.theme_libelle) return compact ? <span className="text-xs text-muted-foreground">—</span> : null;
  return (
    <div className={`flex items-center gap-1 text-[11px] text-muted-foreground ${compact ? "" : "mb-1"}`}>
      <Folder className="h-3 w-3 shrink-0 fill-[hsl(var(--warning)/0.3)] text-[hsl(var(--warning))]" />
      <span className="truncate">{m.theme_module === "RH" ? "RH" : "Paie"} › {m.theme_libelle}</span>
    </div>
  );
}

function EtatVersion({ m }: { m: Modele }) {
  return (
    <>
      {m.numero_publie ? `Version ${m.numero_publie} publiée${m.publie_le ? ` le ${new Date(m.publie_le).toLocaleDateString("fr-FR")}` : ""}` : "Jamais publié"}
      {m.brouillon_id && <span className="ml-2 whitespace-nowrap rounded bg-[hsl(var(--warning)/0.15)] px-1.5 py-0.5 text-[hsl(var(--warning))]">brouillon en cours</span>}
      {m.archive && <span className="ml-2 whitespace-nowrap rounded bg-muted px-1.5 py-0.5">archivé</span>}
    </>
  );
}

function Badges({ m }: { m: Modele }) {
  if (m.est_systeme) return <span title="Livré avec l'application" className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"><ShieldCheck className="h-3 w-3" />Système</span>;
  if (m.visibilite === "GLOBAL") return <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]"><Globe className="h-3 w-3" />Toutes sociétés</span>;
  if (m.visibilite === "SOCIETE") return <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]"><Building2 className="h-3 w-3" />Société</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]"><Lock className="h-3 w-3" />Privé</span>;
}
