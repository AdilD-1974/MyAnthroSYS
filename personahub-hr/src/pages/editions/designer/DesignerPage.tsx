/**
 * DesignerPage.tsx — Concepteur visuel d'un modèle d'édition (/editions/:modeleId/designer).
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Ouvre le brouillon du modèle, sinon sa version publiée en lecture seule
 * (bouton « Modifier » = nouveau brouillon ; modèle système = « Copier »).
 *
 * Raccourcis : Ctrl+S enregistrer · Ctrl+Z / Ctrl+Y annuler / rétablir ·
 * Suppr supprimer · Ctrl+D dupliquer · flèches déplacer (Maj : 5 mm) · Échap désélectionner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, Braces, CheckCircle2, Copy, Eye, Loader2, Lock, Pencil, Redo2, Save, Send,
  Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  editionsApi, ErreurEdition, type ErreurValidation, type Fonction, type Masque, type SourceCatalogue, type Version,
} from "@/lib/editionsApi";
import { activerForme, cibleErreur, copie, type Definition, type Element } from "@/pages/editions/types";
import ParametresForm, { parametresManquants, type Valeurs } from "@/pages/editions/ParametresForm";
import Canevas from "./Canevas";
import Inspecteur, { renommerSousParties } from "./Inspecteur";
import Structure from "./Structure";
import Donnees from "./Donnees";
import { ContexteDesigner } from "./contexte";
import { useEditeur } from "./useEditeur";

const LIBELLES_STATUT: Record<string, string> = {
  BROUILLON: "Brouillon", EN_REVUE: "En revue", PUBLIEE: "Publiée", RETIREE: "Retirée",
};

export default function DesignerPage() {
  const { modeleId } = useParams<{ modeleId: string }>();
  const [recherche] = useSearchParams();
  const navigate = useNavigate();
  const editeur = useEditeur(null);

  const [version, setVersion] = useState<Version | null>(null);
  // jeton de concurrence : une référence, car « Publier » enregistre puis publie
  // dans le même clic et doit utiliser le jeton renvoyé par l'enregistrement
  const jeton = useRef<string>("");
  const [ref, setRef] = useState<{ sources: SourceCatalogue[]; fonctions: Fonction[]; rubriques: { code: string; libelle: string }[]; masques: Masque[] }>(
    { sources: [], fonctions: [], rubriques: [], masques: [] });
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<ErreurValidation[] | null>(null);
  const [occupe, setOccupe] = useState<"" | "enregistrer" | "valider" | "publier" | "apercu" | "brouillon">("");
  const [zoom, setZoom] = useState(1);
  // RG-EDT-DONNEES-01 : on définit ce que l'état contient (Données) avant sa mise en forme
  const [etape, setEtape] = useState<"donnees" | "forme">("donnees");
  const [apercu, setApercu] = useState<{ ouvert: boolean; url?: string; valeurs: Valeurs }>({ ouvert: false, valeurs: {} });
  const [json, setJson] = useState<{ ouvert: boolean; texte: string; erreur?: string }>({ ouvert: false, texte: "" });
  const [copieDlg, setCopieDlg] = useState<{ ouvert: boolean; code: string; libelle: string }>({ ouvert: false, code: "", libelle: "" });

  const lectureSeule = !version || !["BROUILLON", "EN_REVUE"].includes(version.statut);

  // ── chargement ───────────────────────────────────────────────────────────
  const charger = useCallback(async () => {
    if (!modeleId) return;
    setChargement(true);
    setErreurChargement(null);
    try {
      const [m, sources, fonctions, rubriques, masques] = await Promise.all([
        editionsApi.modele(modeleId), editionsApi.catalogue(), editionsApi.fonctions(),
        editionsApi.rubriques(), editionsApi.masques(),
      ]);
      setRef({ sources, fonctions, rubriques, masques });
      const vid = recherche.get("version") ?? m.brouillon_id ?? m.version_publiee_id
        ?? (await editionsApi.versions(modeleId))[0]?.id;
      if (!vid) throw new Error("Ce modèle n'a aucune version.");
      const v = await editionsApi.version(vid);
      setVersion(v);
      jeton.current = v.jeton_concurrence;
      editeur.charger(v.definition);
      editeur.setSelection({ bande: null, element: null });
      setErreurs(null);
    } catch (e: any) {
      setErreurChargement(e.message ?? "Chargement impossible");
    } finally {
      setChargement(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeleId, recherche]);

  useEffect(() => { charger(); }, [charger]);

  // ── quitter sans enregistrer ─────────────────────────────────────────────
  useEffect(() => {
    const avertir = (e: BeforeUnloadEvent) => { if (editeur.modifie) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, [editeur.modifie]);

  const quitter = () => {
    if (editeur.modifie && !confirm("Des modifications ne sont pas enregistrées. Quitter quand même ?")) return;
    navigate("/editions");
  };

  // ── actions serveur ──────────────────────────────────────────────────────
  const enregistrer = useCallback(async (silencieux = false): Promise<boolean> => {
    if (!version || lectureSeule || !editeur.definition) return false;
    if (!editeur.modifie) return true;
    setOccupe("enregistrer");
    try {
      const r = await editionsApi.enregistrer(version.id, editeur.definition, jeton.current);
      jeton.current = r.jeton;
      setErreurs(r.erreurs);
      editeur.setModifie(false);
      if (!silencieux) toast({ title: "Enregistré", description: r.valide ? "Le modèle est valide." : `${r.erreurs.length} point(s) à corriger avant publication.` });
      return true;
    } catch (e: any) {
      if (e instanceof ErreurEdition && e.statut === 409) {
        if (confirm(`${e.message}\n\nRecharger la version enregistrée ? Vos modifications non enregistrées seront perdues.`)) charger();
      } else {
        toast({ title: "Enregistrement impossible", description: e.message, variant: "destructive" });
      }
      return false;
    } finally {
      setOccupe("");
    }
  }, [version, lectureSeule, editeur, charger]);

  const valider = async () => {
    if (!version) return;
    if (!(await enregistrer(true))) return;
    setOccupe("valider");
    try {
      const r = await editionsApi.valider(version.id);
      setErreurs(r.erreurs);
      toast({ title: r.valide ? "Modèle valide" : "Modèle à corriger", description: r.valide ? "Aucune erreur." : `${r.erreurs.length} erreur(s).`,
        variant: r.valide ? undefined : "destructive" });
    } catch (e: any) {
      toast({ title: "Validation impossible", description: e.message, variant: "destructive" });
    } finally { setOccupe(""); }
  };

  const publier = async () => {
    if (!version) return;
    if (!(await enregistrer(true))) return;
    if (!confirm("Publier cette version ? Elle sera utilisée pour toutes les productions et ne pourra plus être modifiée.")) return;
    setOccupe("publier");
    try {
      const r = await editionsApi.publier(version.id, jeton.current);
      toast({ title: `Version ${r.numero} publiée`, description: `Empreinte ${r.empreinte.slice(0, 12)}…` });
      navigate(`/editions/${modeleId}/designer`, { replace: true });
      charger();
    } catch (e: any) {
      if (e instanceof ErreurEdition && e.statut === 422 && e.details?.erreurs) {
        setErreurs(e.details.erreurs);
        toast({ title: "Publication refusée", description: `${e.details.erreurs.length} erreur(s) à corriger.`, variant: "destructive" });
      } else {
        toast({ title: "Publication impossible", description: e.message, variant: "destructive" });
      }
    } finally { setOccupe(""); }
  };

  const ouvrirBrouillon = async () => {
    if (!modeleId) return;
    setOccupe("brouillon");
    try {
      const r = await editionsApi.ouvrirBrouillon(modeleId);
      navigate(`/editions/${modeleId}/designer?version=${r.version_id}`, { replace: true });
    } catch (e: any) {
      toast({ title: "Modification impossible", description: e.message, variant: "destructive" });
    } finally { setOccupe(""); }
  };

  const copier = async () => {
    if (!version) return;
    try {
      const r = await editionsApi.creerModele({
        code: copieDlg.code, libelle: copieDlg.libelle, categorie: version.modele.categorie,
        visibilite: "SOCIETE", origine_id: version.modele.id,
      });
      setCopieDlg({ ouvert: false, code: "", libelle: "" });
      toast({ title: "Copie créée", description: "Vous modifiez maintenant votre propre modèle." });
      navigate(`/editions/${r.modele_id}/designer`);
    } catch (e: any) {
      toast({ title: "Copie impossible", description: e.message, variant: "destructive" });
    }
  };

  const lancerApercu = async () => {
    if (!version || !editeur.definition) return;
    const manquants = parametresManquants(editeur.definition.parametres, apercu.valeurs);
    if (manquants.length) { toast({ title: "Paramètres manquants", description: manquants.join(", "), variant: "destructive" }); return; }
    if (!lectureSeule && !(await enregistrer(true))) return;
    setOccupe("apercu");
    try {
      const blob = await editionsApi.apercu(version.id, apercu.valeurs, editeur.definition.forme_code);
      if (apercu.url) URL.revokeObjectURL(apercu.url);
      setApercu((a) => ({ ...a, url: URL.createObjectURL(blob) }));
    } catch (e: any) {
      toast({ title: "Aperçu impossible", description: e.message, variant: "destructive" });
    } finally { setOccupe(""); }
  };

  // ── édition au clavier ───────────────────────────────────────────────────
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.tagName === "SELECT" || cible.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); enregistrer(); return; }
      if (lectureSeule || etape !== "forme") return;
      if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); editeur.annuler(); return; }
      if (ctrl && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); editeur.retablir(); return; }
      const sel = editeur.selection;
      if (e.key === "Escape") { editeur.setSelection({ bande: sel.bande, element: null }); return; }
      if (!sel.element || !sel.bande) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        editeur.modifier((d) => { const b = d.bandes.find((x) => x.id === sel.bande)!; b.elements = b.elements.filter((x) => x.id !== sel.element); });
        editeur.setSelection({ bande: sel.bande, element: null });
        return;
      }
      if (ctrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        let id = "";
        editeur.modifier((d) => {
          const b = d.bandes.find((x) => x.id === sel.bande)!;
          const n = copie(b.elements.find((x) => x.id === sel.element)!) as Element;
          renommerSousParties(d, n);
          n.x += 2; n.y += 2; id = n.id;
          b.elements.push(n);
          b.hauteur = Math.max(b.hauteur, n.y + n.h);
        });
        editeur.setSelection({ bande: sel.bande, element: id });
        return;
      }
      const fleches: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (fleches[e.key]) {
        e.preventDefault();
        const pas = e.shiftKey ? 5 : 0.5;
        const [dx, dy] = fleches[e.key];
        editeur.modifierElement(sel.element, (el, b) => {
          el.x = Math.max(0, Math.round((el.x + dx * pas) * 10) / 10);
          el.y = Math.max(0, Math.round((el.y + dy * pas) * 10) / 10);
          b.hauteur = Math.max(b.hauteur, el.y + el.h);
        }, `fleche:${sel.element}`);
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [editeur, lectureSeule, enregistrer, etape]);

  // ── erreurs rattachées aux éléments du canevas ───────────────────────────
  const erreursParElement = useMemo(() => {
    const m = new Map<string, string>();
    const d = editeur.definition;
    if (!d || !erreurs) return m;
    for (const err of erreurs) {
      const c = cibleErreur(err.chemin);
      const el = c.bande !== undefined && c.element !== undefined ? d.bandes[c.bande]?.elements[c.element] : undefined;
      if (el && !m.has(el.id)) m.set(el.id, err.message);
    }
    return m;
  }, [erreurs, editeur.definition]);

  const allerA = (err: ErreurValidation) => {
    const d = editeur.definition;
    if (!d) return;
    const c = cibleErreur(err.chemin);
    const b = c.bande !== undefined ? d.bandes[c.bande] : undefined;
    const el = b && c.element !== undefined ? b.elements[c.element] : undefined;
    editeur.setSelection({ bande: b?.id ?? null, element: el?.id ?? null });
  };

  const referentiels = useMemo(() => ({ ...ref, definition: editeur.definition, lectureSeule }), [ref, editeur.definition, lectureSeule]);

  // ── rendu ────────────────────────────────────────────────────────────────
  if (chargement && !version) {
    return <div className="flex h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Chargement du modèle…</div>;
  }
  if (erreurChargement || !version || !editeur.definition) {
    return (
      <div className="p-8">
        <p className="mb-4 text-destructive">{erreurChargement ?? "Modèle introuvable."}</p>
        <Button variant="outline" onClick={() => navigate("/editions")}><ArrowLeft className="mr-1 h-4 w-4" />Retour aux éditions</Button>
      </div>
    );
  }

  const m = version.modele;
  return (
    <ContexteDesigner.Provider value={referentiels}>
      <div className="flex h-[calc(100vh-4rem)] flex-col bg-background">
        {/* barre d'outils */}
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="sm" onClick={quitter}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{m.libelle}</div>
            <div className="text-[11px] text-muted-foreground">
              {m.code} · version {version.numero} · <span className={version.statut === "PUBLIEE" ? "text-emerald-700" : ""}>{LIBELLES_STATUT[version.statut]}</span>
              {m.est_systeme && " · modèle système"}
              {editeur.modifie && <span className="text-amber-600"> · modifications non enregistrées</span>}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {!lectureSeule && <>
              <Button variant="ghost" size="sm" title="Annuler (Ctrl+Z)" disabled={!editeur.peutAnnuler} onClick={editeur.annuler}><Undo2 className="h-4 w-4" /></Button>
              <Button variant="ghost" size="sm" title="Rétablir (Ctrl+Y)" disabled={!editeur.peutRetablir} onClick={editeur.retablir}><Redo2 className="h-4 w-4" /></Button>
            </>}
            <Button variant="ghost" size="sm" title="Zoom arrière" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}><ZoomOut className="h-4 w-4" /></Button>
            <span className="w-10 text-center text-xs">{Math.round(zoom * 100)} %</span>
            <Button variant="ghost" size="sm" title="Zoom avant" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))}><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" title="Définition JSON" onClick={() => setJson({ ouvert: true, texte: JSON.stringify(editeur.definition, null, 2) })}><Braces className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setApercu((a) => ({ ...a, ouvert: true }))}><Eye className="mr-1 h-4 w-4" />Aperçu</Button>
            {lectureSeule ? (
              m.est_systeme
                ? <Button size="sm" onClick={() => setCopieDlg({ ouvert: true, code: `${m.code}_PERSO`, libelle: `${m.libelle} (personnalisé)` })}><Copy className="mr-1 h-4 w-4" />Copier pour personnaliser</Button>
                : <Button size="sm" disabled={occupe === "brouillon"} onClick={ouvrirBrouillon}><Pencil className="mr-1 h-4 w-4" />Modifier</Button>
            ) : <>
              <Button variant="outline" size="sm" disabled={!!occupe} onClick={valider}>
                {occupe === "valider" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}Valider</Button>
              <Button variant="outline" size="sm" disabled={!!occupe || !editeur.modifie} onClick={() => enregistrer()}>
                {occupe === "enregistrer" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Enregistrer</Button>
              <Button size="sm" disabled={!!occupe} onClick={publier}>
                {occupe === "publier" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}Publier</Button>
            </>}
          </div>
        </div>

        {lectureSeule && (
          <div className="flex items-center gap-2 border-b bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            <Lock className="h-3.5 w-3.5" />
            {m.est_systeme
              ? "Modèle système livré avec l'application : il ne se modifie pas. Copiez-le pour le personnaliser."
              : `Version ${LIBELLES_STATUT[version.statut].toLowerCase()} : lecture seule. « Modifier » crée un brouillon à partir de cette version.`}
          </div>
        )}

        {/* étapes : 1. Données  2. Mise en forme */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
          {([["donnees", "1. Données", "ce que l'état contient"], ["forme", "2. Mise en forme", "où et comment l'imprimer"]] as const).map(([k, l, aide]) => (
            <button key={k} type="button" onClick={() => setEtape(k)}
              className={`rounded-md px-3 py-1 text-sm ${etape === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              <b>{l}</b> <span className={`text-xs ${etape === k ? "opacity-80" : "text-muted-foreground"}`}>— {aide}</span>
            </button>
          ))}
          {etape === "forme" && <SelecteurForme editeur={editeur} lectureSeule={lectureSeule} />}
        </div>

        {etape === "donnees" ? (
          <div className="min-h-0 flex-1"><Donnees editeur={editeur} version={version} lectureSeule={lectureSeule} enregistrer={enregistrer} /></div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <aside className="w-64 shrink-0 border-r"><Structure editeur={editeur} lectureSeule={lectureSeule} /></aside>
            <main className="min-w-0 flex-1 overflow-auto bg-muted/40 p-4"
              onPointerDown={(e) => { if (e.target === e.currentTarget) editeur.setSelection({ bande: null, element: null }); }}>
              <Canevas editeur={editeur} zoom={zoom} lectureSeule={lectureSeule} erreursParElement={erreursParElement} />
            </main>
            <aside className="w-96 shrink-0 overflow-auto border-l"><Inspecteur editeur={editeur} lectureSeule={lectureSeule} /></aside>
          </div>
        )}

        {/* erreurs */}
        {erreurs && erreurs.length > 0 && (
          <div className="max-h-40 overflow-auto border-t bg-destructive/5 px-3 py-2">
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />{erreurs.length} point(s) à corriger avant publication
              <button type="button" className="ml-auto font-normal text-muted-foreground" onClick={() => setErreurs(null)}>Masquer</button>
            </div>
            {erreurs.map((err, i) => (
              <button key={i} type="button" onClick={() => allerA(err)} className="block w-full truncate text-left text-xs hover:underline">
                <span className="font-mono text-muted-foreground">{err.chemin}</span> — {err.message}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* aperçu */}
      <Dialog open={apercu.ouvert} onOpenChange={(o) => setApercu((a) => ({ ...a, ouvert: o }))}>
        <DialogContent className={apercu.url ? "max-w-5xl" : "max-w-lg"}>
          <DialogHeader><DialogTitle>Aperçu{version.statut !== "PUBLIEE" ? " du brouillon" : ""}</DialogTitle></DialogHeader>
          <div className={apercu.url ? "grid grid-cols-[260px_1fr] gap-4" : ""}>
            <div>
              <ParametresForm parametres={editeur.definition.parametres} valeurs={apercu.valeurs}
                onChange={(v) => setApercu((a) => ({ ...a, valeurs: v }))} />
              <Button className="mt-4 w-full" disabled={occupe === "apercu"} onClick={lancerApercu}>
                {occupe === "apercu" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-4 w-4" />}
                {apercu.url ? "Actualiser" : "Afficher l'aperçu"}
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">Les 5 premiers documents, marqués « APERÇU ». Rien n'est conservé.</p>
            </div>
            {apercu.url && <iframe title="Aperçu" src={apercu.url} className="h-[75vh] w-full rounded border" />}
          </div>
        </DialogContent>
      </Dialog>

      {/* JSON */}
      <Dialog open={json.ouvert} onOpenChange={(o) => setJson((j) => ({ ...j, ouvert: o }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Définition JSON</DialogTitle></DialogHeader>
          <textarea value={json.texte} readOnly={lectureSeule} spellCheck={false}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => setJson((j) => ({ ...j, texte: e.target.value, erreur: undefined }))}
            className="h-[60vh] w-full rounded border bg-muted/30 p-2 font-mono text-xs" />
          {json.erreur && <p className="text-xs text-destructive">{json.erreur}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => navigator.clipboard?.writeText(json.texte)}>Copier</Button>
            {!lectureSeule && <Button onClick={() => {
              try {
                const d = JSON.parse(json.texte) as Definition;
                if (!d || !Array.isArray(d.bandes) || !Array.isArray(d.jeux)) throw new Error("bandes et jeux sont obligatoires");
                editeur.modifier((x) => { Object.keys(x).forEach((k) => delete (x as any)[k]); Object.assign(x, d); });
                editeur.setSelection({ bande: null, element: null });
                setJson({ ouvert: false, texte: "" });
              } catch (e: any) { setJson((j) => ({ ...j, erreur: `JSON invalide : ${e.message}` })); }
            }}>Appliquer</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* copie d'un modèle système */}
      <Dialog open={copieDlg.ouvert} onOpenChange={(o) => setCopieDlg((c) => ({ ...c, ouvert: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Copier pour personnaliser</DialogTitle></DialogHeader>
          <label className="block text-xs font-medium">Code
            <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm uppercase" value={copieDlg.code}
              onChange={(e) => setCopieDlg((c) => ({ ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") }))} />
          </label>
          <label className="block text-xs font-medium">Libellé
            <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={copieDlg.libelle}
              onChange={(e) => setCopieDlg((c) => ({ ...c, libelle: e.target.value }))} />
          </label>
          <p className="text-xs text-muted-foreground">La copie est visible par toute la société active ; elle démarre en brouillon.</p>
          <DialogFooter><Button onClick={copier} disabled={!copieDlg.code || !copieDlg.libelle}>Créer la copie</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </ContexteDesigner.Provider>
  );
}

const codeForme = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "_$1").slice(0, 40);

/** Plusieurs mises en forme des mêmes données (« Multiple modèle ») : choix, création, défaut. */
function SelecteurForme({ editeur, lectureSeule }: { editeur: ReturnType<typeof useEditeur>; lectureSeule: boolean }) {
  const d = editeur.definition!;
  const courante = d.forme_code ?? "standard";
  const formes = [{ code: courante, libelle: d.forme_libelle ?? "Mise en forme standard" }, ...(d.formes ?? [])];
  const defaut = d.usages?.forme_par_defaut ?? courante;
  const choisir = (code: string) => {
    if (code === courante) return;
    editeur.modifier((x) => activerForme(x, code), "forme");
    editeur.setSelection({ bande: null, element: null });
  };
  const nouvelle = () => {
    const libelle = prompt("Nom de la nouvelle mise en forme (copie de la mise en forme affichée) :", "Bulletin paysage");
    if (!libelle?.trim()) return;
    let code = codeForme(libelle) || "forme";
    const codes = new Set(formes.map((f) => f.code));
    for (let n = 2; codes.has(code); n++) code = `${codeForme(libelle)}_${n}`;
    editeur.modifier((x) => {
      x.formes = [...(x.formes ?? []), { code, libelle: libelle.trim(), page: copie(x.page), bandes: copie(x.bandes), sortie: copie(x.sortie) }];
      activerForme(x, code);
    }, "forme-nouvelle");
  };
  const renommer = () => {
    const libelle = prompt("Nouveau nom :", d.forme_libelle ?? "Mise en forme standard");
    if (libelle?.trim()) editeur.modifier((x) => { x.forme_libelle = libelle.trim(); }, "forme-nom");
  };
  const supprimer = () => {
    if (!(d.formes ?? []).length || !confirm(`Supprimer la mise en forme « ${d.forme_libelle} » ?`)) return;
    editeur.modifier((x) => {
      const supprimee = x.forme_code ?? "standard";
      const f = x.formes!.shift()!;
      x.forme_code = f.code; x.forme_libelle = f.libelle; x.page = f.page; x.bandes = f.bandes; x.sortie = f.sortie;
      if (x.usages?.forme_par_defaut === supprimee) x.usages = { ...x.usages, forme_par_defaut: f.code };
      if (!x.formes!.length) delete x.formes;
    }, "forme-suppr");
    editeur.setSelection({ bande: null, element: null });
  };
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Mise en forme</span>
      <select className="rounded border bg-background px-2 py-1 text-sm" value={courante} onChange={(e) => choisir(e.target.value)}>
        {formes.map((f) => <option key={f.code} value={f.code}>{f.libelle}{f.code === defaut ? " ★" : ""}</option>)}
      </select>
      {courante === defaut
        ? <span className="text-muted-foreground" title="Imprimée quand on ne choisit pas">★ par défaut</span>
        : !lectureSeule && <button type="button" className="text-primary underline" onClick={() => editeur.modifier((x) => { x.usages = { ...(x.usages ?? {}), forme_par_defaut: courante }; }, "forme-defaut")}>Définir par défaut</button>}
      {!lectureSeule && <>
        <button type="button" className="text-primary underline" onClick={nouvelle}>Nouvelle</button>
        <button type="button" className="text-primary underline" onClick={renommer}>Renommer</button>
        {(d.formes ?? []).length > 0 && <button type="button" className="text-destructive underline" onClick={supprimer}>Supprimer</button>}
      </>}
    </div>
  );
}
