/**
 * LanceurEcran.tsx — Les éditions dans les menus métier.
 * Auteur : Adil DAIA — 19/10/2026 (migration 077)
 *
 *  - EditionMenuPage : page d'un menu (ex. Paie › Édition des bulletins) — choix du modèle
 *    proposé sur l'écran, paramètres du modèle, production et impression en un seul PDF.
 *  - BoutonImprimer  : bouton « Imprimer » d'un écran (traitement, consultation du bulletin) ;
 *    l'écran transmet son contexte (période, collaborateur, bulletin) — RG-EDT-ECRAN-05.
 *
 * Les modèles proposés et le modèle par défaut se règlent dans les éditions (bouton « Menus »
 * du modèle) — RG-EDT-ECRAN-01..04.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, Download, ExternalLink, FileText, Loader2, Printer, Settings2, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  editionsApi, type ContexteEcran, type DocumentProduit, type Ecran, type ModeleEcran,
} from "@/lib/editionsApi";
import ParametresForm, { parametresManquants, type Valeurs } from "./ParametresForm";

const classe = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const CLE_CHOIX = (ecran: string) => `editions.ecran.${ecran}.modele`;

function lireChoix(ecran: string): string | null {
  try { return localStorage.getItem(CLE_CHOIX(ecran)); } catch { return null; }
}
function memoriserChoix(ecran: string, id: string) {
  try { localStorage.setItem(CLE_CHOIX(ecran), id); } catch { /* préférence facultative */ }
}

/** Ouvre un PDF dans l'onglet préparé au clic (évite le blocage des fenêtres surgissantes). */
async function ouvrirPdf(charger: () => Promise<Blob>, onglet: Window | null, nom = "edition.pdf", telecharger = false) {
  try {
    const url = URL.createObjectURL(await charger());
    if (telecharger) {
      onglet?.close();
      const a = document.createElement("a");
      a.href = url; a.download = nom; a.click();
    } else if (onglet && !onglet.closed) {
      onglet.location.href = url;
    } else {
      window.open(url, "_blank");
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e: any) {
    onglet?.close();
    toast.error("Ouverture impossible", { description: e.message });
  }
}

function ongletDAttente(): Window | null {
  const w = window.open("", "_blank");
  if (w) {
    w.document.title = "Édition en cours…";
    w.document.body.innerHTML = '<p style="font:14px system-ui;color:#555;padding:24px">Préparation du document…</p>';
  }
  return w;
}

function useModelesEcran(ecran: string, actif = true) {
  const [etat, setEtat] = useState<{ ecran?: Ecran; modeles: ModeleEcran[]; defaut: string | null; erreur?: string; charge: boolean }>(
    { modeles: [], defaut: null, charge: false });
  useEffect(() => {
    if (!actif || etat.charge) return;
    editionsApi.modelesEcran(ecran)
      .then((r) => setEtat({ ...r, charge: true }))
      .catch((e) => setEtat({ modeles: [], defaut: null, charge: true, erreur: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecran, actif]);
  return etat;
}

// ════════════════════════════════════════════════════════════════════════════
// Bouton « Imprimer » d'un écran métier
// ════════════════════════════════════════════════════════════════════════════
export function BoutonImprimer({ ecran, contexte, desactive, className }: {
  ecran: string;
  contexte: ContexteEcran;
  /** Raison pour laquelle l'impression n'est pas possible (affichée en info-bulle). */
  desactive?: string | null;
  className?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const { modeles, defaut, erreur } = useModelesEcran(ecran, ouvert);
  const choixMemorise = lireChoix(ecran);

  const imprimer = async (modeleId?: string) => {
    if (desactive || occupe) return;
    setOuvert(false);
    const onglet = ongletDAttente();
    setOccupe(true);
    try {
      const r = await editionsApi.lancerEcran(ecran, { modele_id: modeleId ?? choixMemorise ?? undefined, contexte });
      const anomalies = r.documents.reduce((n, d) => n + d.anomalies.length, 0);
      if (anomalies) toast.warning(`${anomalies} anomalie(s) d'édition`, { description: r.documents.flatMap((d) => d.anomalies.map((a) => a.message)).slice(0, 3).join(" · ") });
      await ouvrirPdf(() => editionsApi.pdfDemande(r.demande_id), onglet);
    } catch (e: any) {
      onglet?.close();
      // modèle mémorisé retiré de l'écran : on oublie le choix et on réessaie avec le défaut
      if (!modeleId && choixMemorise && e.statut === 403) {
        try { localStorage.removeItem(CLE_CHOIX(ecran)); } catch { /* */ }
      }
      toast.error("Impression impossible", { description: e.message });
    } finally {
      setOccupe(false);
    }
  };

  const base = "inline-flex items-center gap-1.5 border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className={`inline-flex ${className ?? ""}`}>
      <button type="button" onClick={() => imprimer()} disabled={!!desactive || occupe}
        title={desactive ?? "Imprimer le bulletin avec le modèle d'édition de ce menu"}
        className={`${base} rounded-l-md`}>
        {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} Imprimer
      </button>
      <Popover open={ouvert} onOpenChange={setOuvert}>
        <PopoverTrigger asChild>
          <button type="button" disabled={!!desactive || occupe} title="Choisir le modèle d'édition" className={`${base} -ml-px rounded-r-md px-1.5`}>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1">
          <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Imprimer avec</div>
          {erreur && <div className="px-2 py-1.5 text-xs text-destructive">{erreur}</div>}
          {!erreur && !modeles.length && <div className="flex items-center px-2 py-1.5 text-xs text-muted-foreground"><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Chargement…</div>}
          {modeles.map((m) => {
            const courant = (choixMemorise && modeles.some((x) => x.id === choixMemorise) ? choixMemorise : defaut) === m.id;
            return (
              <button key={m.id} type="button"
                onClick={() => { memoriserChoix(ecran, m.id); imprimer(m.id); }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${courant ? "font-medium" : ""}`}>
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{m.libelle}</span>
                {m.par_defaut && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
                {m.est_systeme && <ShieldCheck className="h-3 w-3 shrink-0 text-sky-600" />}
              </button>
            );
          })}
          <p className="border-t px-2 pt-1.5 text-[10px] leading-snug text-muted-foreground">
            Le choix est mémorisé sur ce poste. Les modèles proposés se règlent dans Éditions › Menus.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Page d'un menu d'éditions (ex. Paie › Édition des bulletins)
// ════════════════════════════════════════════════════════════════════════════
export default function EditionMenuPage({ ecran, titre, description }: { ecran: string; titre: string; description?: string }) {
  const navigate = useNavigate();
  const { modeles, defaut, erreur, charge } = useModelesEcran(ecran);
  const [modeleId, setModeleId] = useState<string | null>(null);
  const [valeurs, setValeurs] = useState<Valeurs>({});
  const [forme, setForme] = useState<string | undefined>();
  const [occupe, setOccupe] = useState<null | "ouvrir" | "produire">(null);
  const [resultat, setResultat] = useState<{ demande_id: string; documents: DocumentProduit[]; modele: string } | null>(null);

  useEffect(() => {
    if (!charge || modeleId) return;
    const memo = lireChoix(ecran);
    setModeleId(modeles.some((m) => m.id === memo) ? memo : defaut);
  }, [charge, modeles, defaut, ecran, modeleId]);

  const modele = useMemo(() => modeles.find((m) => m.id === modeleId) ?? null, [modeles, modeleId]);
  useEffect(() => { setForme(modele?.forme_par_defaut ?? undefined); setResultat(null); }, [modele]);

  const produire = async (ouvrir: boolean) => {
    if (!modele) return;
    const manquants = parametresManquants(modele.parametres, valeurs);
    if (manquants.length) { toast.error("Paramètres manquants", { description: manquants.join(", ") }); return; }
    const onglet = ouvrir ? ongletDAttente() : null;
    setOccupe(ouvrir ? "ouvrir" : "produire");
    setResultat(null);
    try {
      const r = await editionsApi.lancerEcran(ecran, {
        modele_id: modele.id, parametres: valeurs, forme: modele.formes.length ? forme : undefined,
      });
      setResultat({ demande_id: r.demande_id, documents: r.documents, modele: r.modele.code });
      toast.success("Édition produite", { description: `${r.documents.length} document(s)` });
      if (ouvrir) await ouvrirPdf(() => editionsApi.pdfDemande(r.demande_id), onglet);
    } catch (e: any) {
      onglet?.close();
      toast.error("Production impossible", { description: e.message });
    } finally {
      setOccupe(null);
    }
  };

  const nbAnomalies = resultat?.documents.reduce((n, d) => n + d.anomalies.length, 0) ?? 0;
  const nbPages = resultat?.documents.reduce((n, d) => n + d.nb_pages, 0) ?? 0;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Printer className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{titre}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/editions")} title="Concevoir les modèles et régler les menus où ils sont proposés">
          <Settings2 className="mr-1.5 h-4 w-4" />Gérer les modèles
        </Button>
      </div>

      {erreur && <div className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{erreur}</div>}
      {!charge && <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement…</div>}
      {charge && !erreur && !modeles.length && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucun modèle publié n'est proposé dans ce menu.<br />
          Publiez un modèle de la catégorie dans <button className="text-primary underline" onClick={() => navigate("/editions")}>Éditions</button>, ou rattachez-en un à ce menu (bouton « Menus » du modèle).
        </div>
      )}

      {modeles.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* modèles proposés */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Modèle</div>
            {modeles.map((m) => (
              <button key={m.id} type="button" onClick={() => { setModeleId(m.id); memoriserChoix(ecran, m.id); }}
                className={`flex w-full items-start gap-2 rounded-lg border p-3 text-left transition-colors ${m.id === modeleId ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card hover:bg-muted/60"}`}>
                <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${m.id === modeleId ? "text-primary" : "text-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.libelle}</div>
                  <div className="text-[11px] text-muted-foreground">{m.code} · version {m.numero_publie}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.par_defaut && <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"><Star className="h-2.5 w-2.5 fill-current" />Par défaut</span>}
                    {m.est_systeme && <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800"><ShieldCheck className="h-2.5 w-2.5" />Système</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* paramètres et production */}
          <div className="rounded-lg border bg-card p-4">
            {modele && (
              <>
                <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Paramètres</div>
                {modele.formes.length > 1 && (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-xs font-medium">Mise en forme</span>
                    <select className={classe} value={forme} onChange={(e) => { setForme(e.target.value); setResultat(null); }}>
                      {modele.formes.map((f) => <option key={f.code} value={f.code}>{f.libelle}</option>)}
                    </select>
                  </label>
                )}
                <ParametresForm parametres={modele.parametres} valeurs={valeurs}
                  onChange={(v) => { setValeurs(v); setResultat(null); }} />
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                  <Button disabled={!!occupe} onClick={() => produire(true)}>
                    {occupe === "ouvrir" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}
                    Produire et imprimer
                  </Button>
                  <Button variant="outline" disabled={!!occupe} onClick={() => produire(false)}
                    title="Produire sans ouvrir : la liste des documents s'affiche ci-dessous">
                    {occupe === "produire" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Produire seulement
                  </Button>
                </div>
              </>
            )}

            {resultat && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{resultat.documents.length} document(s)</span>
                  <span className="text-muted-foreground">· {nbPages} page(s)</span>
                  {nbAnomalies > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{nbAnomalies} anomalie(s)</span>}
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => ouvrirPdf(() => editionsApi.pdfDemande(resultat.demande_id), ongletDAttente())}>
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />Tout ouvrir
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={() => ouvrirPdf(() => editionsApi.pdfDemande(resultat.demande_id), null, `${resultat.modele.toLowerCase()}.pdf`, true)}>
                      <Download className="mr-1 h-3.5 w-3.5" />Tout télécharger
                    </Button>
                  </div>
                </div>
                <div className="max-h-80 overflow-auto rounded border">
                  {resultat.documents.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 border-b px-2 py-1.5 text-sm last:border-0">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{d.nom_fichier}</span>
                      <span className="text-xs text-muted-foreground">{d.nb_pages} p.</span>
                      {d.anomalies.length > 0 && (
                        <span className="text-xs text-amber-700" title={d.anomalies.map((a) => `${a.element} : ${a.message}`).join("\n")}>
                          {d.anomalies.length} anomalie(s)
                        </span>
                      )}
                      <button type="button" title="Ouvrir" onClick={() => ouvrirPdf(() => editionsApi.pdfDocumentEcran(d.id), ongletDAttente())}><ExternalLink className="h-4 w-4" /></button>
                      <button type="button" title="Télécharger" onClick={() => ouvrirPdf(() => editionsApi.pdfDocumentEcran(d.id), null, d.nom_fichier, true)}><Download className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Paie › Édition des bulletins (/paie/edition-bulletins). */
export function EditionBulletinsPage() {
  return (
    <EditionMenuPage ecran="edition_bulletins" titre="Édition des bulletins"
      description="Imprimez les bulletins d'une période avec les modèles conçus dans les éditions : tous les salariés, un plan de paie ou une sélection." />
  );
}
