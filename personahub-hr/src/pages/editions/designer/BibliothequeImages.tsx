/**
 * BibliothequeImages.tsx — Images de la société (cachet, signature, bandeau, filigrane…)
 * déposées une fois et utilisées dans les modèles par ASSET("CODE").
 * Auteur : Adil DAIA — lot 2 bis (17/10/2026) — RG-EDT-IMAGE-01..03
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Building2, ImageOff, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { editionsApi, ErreurEdition, type ImageEdition } from "@/lib/editionsApi";
import type { ElImage, Rognage } from "@/pages/editions/types";

/** Glisser une image de la bibliothèque vers le canevas. */
export const TYPE_DND_IMAGE = "application/x-edt-image";
const LOGO = "__LOGO__";

// ── petit magasin partagé : la liste et les vignettes, rafraîchies après un dépôt ──
let liste: ImageEdition[] | null = null;
let chargement: Promise<void> | null = null;
let version = 0;
const vignettes = new Map<string, Promise<string | null>>();
const abonnes = new Set<() => void>();
const prevenir = () => { version++; abonnes.forEach((f) => f()); };

function recharger(): Promise<void> {
  chargement = editionsApi.images()
    .then((l) => { liste = l; })
    .catch(() => { liste = []; })
    .finally(() => { chargement = null; prevenir(); });
  return chargement;
}
function oublier(code: string) {
  const p = vignettes.get(code);
  vignettes.delete(code);
  p?.then((u) => u && URL.revokeObjectURL(u));
}

function useImages(): ImageEdition[] | null {
  useSyncExternalStore((f) => { abonnes.add(f); return () => abonnes.delete(f); }, () => version);
  useEffect(() => { if (liste === null && !chargement) void recharger(); }, []);
  return liste;
}

export function useUrlImage(code: string | null): string | null {
  const v = useSyncExternalStore((f) => { abonnes.add(f); return () => abonnes.delete(f); }, () => version);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!code) { setUrl(null); return; }
    let actif = true;
    if (!vignettes.has(code)) vignettes.set(code, (code === LOGO ? editionsApi.urlLogo() : editionsApi.urlImage(code)).catch(() => null));
    vignettes.get(code)!.then((u) => { if (actif) setUrl(u); });
    return () => { actif = false; };
  }, [code, v]);
  return url;
}

export const codeAsset = (valeur?: string | null) => /^\s*ASSET\(\s*"([A-Za-z0-9_]+)"\s*\)\s*$/.exec(valeur ?? "")?.[1]?.toUpperCase() ?? null;
const estLogo = (valeur?: string | null) => /^\s*CHARTE\(\s*"logo"\s*\)\s*$/i.test(valeur ?? "");

const codeDepuisNom = (nom: string) =>
  nom.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "IMG_$1").slice(0, 40);

/** Dépose un fichier image dans la bibliothèque, sous un code tiré de son nom (suffixe si déjà pris). */
export async function deposerFichier(f: File): Promise<ImageEdition> {
  const base = codeDepuisNom(f.name) || "IMAGE";
  for (let n = 1; n < 50; n++) {
    const code = n === 1 ? base : `${base.slice(0, 36)}_${n}`;
    try {
      const r = await editionsApi.deposerImage(f, code);
      oublier(r.code);
      await recharger();
      return r;
    } catch (e) {
      if (!(e instanceof ErreurEdition && /existe déjà/.test(e.message))) throw e;
    }
  }
  throw new Error("Trop d'images portent déjà ce nom");
}

/** Taille naturelle d'une image (pour garder ses proportions à la pose). */
export function tailleNaturelle(url: string): Promise<{ w: number; h: number }> {
  return new Promise((ok) => {
    const i = new Image();
    i.onload = () => ok({ w: i.naturalWidth || 1, h: i.naturalHeight || 1 });
    i.onerror = () => ok({ w: 1, h: 1 });
    i.src = url;
  });
}
export const urlDe = (code: string) => {
  if (!vignettes.has(code)) vignettes.set(code, editionsApi.urlImage(code).catch(() => null));
  return vignettes.get(code)!;
};

/** Image rognée puis ajustée dans un cadre de l × h pixels (même calcul que le PDF). */
export function ImageAjustee({ url, l, h, ajustement = "CONTENIR", rognage }: {
  url: string; l: number; h: number; ajustement?: ElImage["ajustement"]; rognage?: Rognage | null;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const g = (rognage?.gauche ?? 0) / 100, d = (rognage?.droite ?? 0) / 100, ha = (rognage?.haut ?? 0) / 100, ba = (rognage?.bas ?? 0) / 100;
  const fw = Math.max(0.05, 1 - g - d), fh = Math.max(0.05, 1 - ha - ba);
  // zone visible (en px) de l'image rognée dans le cadre
  let vw = l, vh = h;
  if (nat && ajustement === "CONTENIR") {
    const rw = nat.w * fw, rh = nat.h * fh;
    const k = Math.min(l / rw, h / rh);
    vw = rw * k; vh = rh * k;
  }
  let iw = vw / fw, ih = vh / fh, dx = -g * iw, dy = -ha * ih;
  if (nat && ajustement === "REMPLIR") {
    const rw = nat.w * fw, rh = nat.h * fh;
    const k = Math.max(l / rw, h / rh);
    iw = nat.w * k; ih = nat.h * k;
    dx = -g * iw - (rw * k - l) / 2; dy = -ha * ih - (rh * k - h) / 2;
  }
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      <div className="relative overflow-hidden" style={{ width: vw, height: vh }}>
        <img src={url} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
          className="absolute max-w-none" style={{ left: dx, top: dy, width: iw, height: ih }} />
      </div>
    </div>
  );
}

/** Rendu dans le canevas : la vraie image (bibliothèque ou logo), rognée et ajustée comme au PDF. */
export function ApercuImage({ el, l, h }: { el: ElImage; l: number; h: number }) {
  const valeur = el.valeur;
  const code = codeAsset(valeur) ?? (estLogo(valeur) ? LOGO : null);
  const url = useUrlImage(code);
  if (url) return <ImageAjustee url={url} l={l} h={h} ajustement={el.ajustement} rognage={el.rognage} />;
  return (
    <div className="flex h-full w-full items-center justify-center border border-dashed border-muted-foreground/40 text-[10px] text-muted-foreground">
      {code === LOGO ? <><Building2 className="mr-1 h-3 w-3" />logo (absent de la fiche société)</> : code ? <><ImageOff className="mr-1 h-3 w-3" />{code} ?</> : "image (formule)"}
    </div>
  );
}

function Vignette({ img, choisie, onChoisir, onSupprimer, ro }: {
  img: ImageEdition; choisie: boolean; onChoisir: () => void; onSupprimer: () => void; ro: boolean;
}) {
  const url = useUrlImage(img.code);
  return (
    <div draggable={!ro} onDragStart={(e) => { e.dataTransfer.setData(TYPE_DND_IMAGE, img.code); e.dataTransfer.effectAllowed = "copy"; }}
      title="Cliquer pour l'utiliser ici, ou glisser sur la page pour créer une nouvelle image"
      className={`group relative cursor-grab rounded border p-1 ${choisie ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"}`}>
      <button type="button" disabled={ro} onClick={onChoisir} className="block w-full" title={`${img.code} · ${img.format} · ${Math.ceil(img.taille / 1024)} Ko`}>
        <div className="flex h-14 items-center justify-center bg-[repeating-conic-gradient(#f3f4f6_0%_25%,white_0%_50%)] bg-[length:10px_10px]">
          {url ? <img src={url} alt={img.code} className="max-h-14 max-w-full object-contain" /> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="mt-0.5 truncate text-center font-mono text-[10px]">{img.code}</div>
      </button>
      {!ro && (
        <button type="button" onClick={onSupprimer} title="Supprimer de la bibliothèque"
          className="absolute right-0.5 top-0.5 hidden rounded bg-white/90 p-0.5 group-hover:block">
          <Trash2 className="h-3 w-3 text-destructive" />
        </button>
      )}
    </div>
  );
}

/** Dans l'inspecteur d'une image : choisir le logo ou une image de la bibliothèque, ou en déposer une. */
export function ChoixImage({ valeur, onChoisir, ro }: { valeur: string; onChoisir: (formule: string) => void; ro: boolean }) {
  const images = useImages();
  const choisie = codeAsset(valeur);
  const champ = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [remplacer, setRemplacer] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const deposer = async () => {
    if (!fichier || !code) return;
    setEnvoi(true);
    try {
      const r = await editionsApi.deposerImage(fichier, code, remplacer);
      oublier(r.code);
      await recharger();
      onChoisir(r.formule);
      setFichier(null); setCode(""); setRemplacer(false);
      toast({ title: "Image ajoutée", description: `Utilisable dans tous les modèles : ${r.formule}` });
    } catch (e) {
      toast({ title: "Image refusée", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEnvoi(false);
    }
  };

  const supprimer = async (img: ImageEdition) => {
    if (!confirm(`Supprimer l'image « ${img.code} » de la bibliothèque ? Les modèles qui l'utilisent ne l'imprimeront plus.`)) return;
    try {
      await editionsApi.supprimerImage(img.code);
      oublier(img.code);
      await recharger();
    } catch (e) {
      toast({ title: "Suppression impossible", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">Bibliothèque d'images</div>
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" disabled={ro} onClick={() => onChoisir('CHARTE("logo")')} title="Logo de la société (fiche société)"
          className={`rounded border p-1 text-center ${estLogo(valeur) ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"}`}>
          <div className="flex h-14 items-center justify-center text-muted-foreground"><Building2 className="h-6 w-6" /></div>
          <div className="mt-0.5 text-[10px]">Logo société</div>
        </button>
        {images === null && <div className="col-span-2 flex items-center text-xs text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Chargement…</div>}
        {(images ?? []).map((img) => (
          <Vignette key={img.code} img={img} ro={ro} choisie={choisie === img.code}
            onChoisir={() => onChoisir(img.formule)} onSupprimer={() => supprimer(img)} />
        ))}
      </div>
      {!ro && (
        <div className="rounded border border-dashed p-2">
          <input ref={champ} type="file" accept="image/png,image/jpeg" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFichier(f);
              if (f) setCode(codeDepuisNom(f.name));
              e.target.value = "";
            }} />
          {!fichier ? (
            <Button size="sm" variant="outline" className="w-full" onClick={() => champ.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />Importer une image (PNG, JPEG · 2 Mo max.)
            </Button>
          ) : (
            <div className="space-y-1.5 text-xs">
              <div className="truncate text-muted-foreground">{fichier.name} · {Math.ceil(fichier.size / 1024)} Ko</div>
              <label className="block">Code
                <input className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs uppercase" value={code} maxLength={40}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} placeholder="ex. CACHET" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={remplacer} onChange={(e) => setRemplacer(e.target.checked)} />
                Remplacer l'image de même code
              </label>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={!code || envoi} onClick={deposer}>
                  {envoi ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}Déposer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFichier(null)}>Annuler</Button>
              </div>
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Les images sont propres à la société et réutilisables dans tous les modèles, sous la forme ASSET("CODE").
          </p>
        </div>
      )}
    </div>
  );
}


// ── rognage interactif (RG-EDT-IMAGE-04) ─────────────────────────────────────
type Bord = "haut" | "droite" | "bas" | "gauche";

/** Dialogue de rognage : on tire les bords ou les coins du cadre sur l'image, ou on saisit les %. */
export function DialogueRognage({ el, ouvert, onFermer, onValider }: {
  el: ElImage; ouvert: boolean; onFermer: () => void; onValider: (r: Rognage | null) => void;
}) {
  const code = codeAsset(el.valeur) ?? (estLogo(el.valeur) ? LOGO : null);
  const url = useUrlImage(ouvert ? code : null);
  const [r, setR] = useState<Required<Rognage>>({ haut: 0, droite: 0, bas: 0, gauche: 0 });
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ouvert) setR({ haut: el.rognage?.haut ?? 0, droite: el.rognage?.droite ?? 0, bas: el.rognage?.bas ?? 0, gauche: el.rognage?.gauche ?? 0 });
  }, [ouvert, el.rognage]);

  const borner = (n: Required<Rognage>): Required<Rognage> => {
    const c = (v: number) => Math.max(0, Math.min(95, Math.round(v * 10) / 10));
    const x = { haut: c(n.haut), droite: c(n.droite), bas: c(n.bas), gauche: c(n.gauche) };
    if (x.haut + x.bas > 95) x.bas = 95 - x.haut;
    if (x.gauche + x.droite > 95) x.droite = 95 - x.gauche;
    return x;
  };
  /** Tire un ou plusieurs bords (ou tout le cadre) à la souris. */
  const tirer = (e: React.PointerEvent, bords: Bord[] | "tout") => {
    e.preventDefault(); e.stopPropagation();
    const boite = zone.current!.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY, r0 = { ...r };
    const cible = e.currentTarget as HTMLElement;
    cible.setPointerCapture(e.pointerId);
    const bouger = (ev: PointerEvent) => {
      const dx = ((ev.clientX - x0) / boite.width) * 100, dy = ((ev.clientY - y0) / boite.height) * 100;
      if (bords === "tout") {
        const mx = Math.max(-r0.gauche, Math.min(r0.droite, dx)), my = Math.max(-r0.haut, Math.min(r0.bas, dy));
        setR(borner({ gauche: r0.gauche + mx, droite: r0.droite - mx, haut: r0.haut + my, bas: r0.bas - my }));
        return;
      }
      const n = { ...r0 };
      if (bords.includes("gauche")) n.gauche = r0.gauche + dx;
      if (bords.includes("droite")) n.droite = r0.droite - dx;
      if (bords.includes("haut")) n.haut = r0.haut + dy;
      if (bords.includes("bas")) n.bas = r0.bas - dy;
      setR(borner(n));
    };
    const finir = () => { cible.removeEventListener("pointermove", bouger); cible.removeEventListener("pointerup", finir); };
    cible.addEventListener("pointermove", bouger);
    cible.addEventListener("pointerup", finir);
  };
  const poignee = (bords: Bord[], cls: string, curseur: string) => (
    <div onPointerDown={(e) => tirer(e, bords)} className={`absolute z-10 h-3 w-3 rounded-sm border border-primary bg-white ${cls}`} style={{ cursor: curseur }} />
  );
  const champ = (k: Bord, l: string) => (
    <label className="text-xs">{l} (%)
      <input type="number" min={0} max={95} step={1} value={r[k]} onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => setR(borner({ ...r, [k]: Number(e.target.value) || 0 }))}
        className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" />
    </label>
  );

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="ecran-editions-texte max-w-3xl">
        <DialogHeader><DialogTitle>Rogner l'image</DialogTitle></DialogHeader>
        {!url ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {code ? <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Chargement de l'image…</>
              : "Le rognage visuel n'est possible que pour le logo ou une image de la bibliothèque (la formule de cette image est calculée)."}
          </p>
        ) : (
          <div className="flex gap-4">
            <div className="flex flex-1 items-center justify-center rounded bg-[repeating-conic-gradient(#f3f4f6_0%_25%,white_0%_50%)] bg-[length:16px_16px] p-3">
              <div ref={zone} className="relative inline-block select-none">
                <img src={url} alt="" draggable={false} className="block max-h-[55vh] max-w-full" />
                {/* zones retirées, assombries */}
                <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/50" style={{ height: `${r.haut}%` }} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/50" style={{ height: `${r.bas}%` }} />
                <div className="pointer-events-none absolute left-0 bg-black/50" style={{ top: `${r.haut}%`, bottom: `${r.bas}%`, width: `${r.gauche}%` }} />
                <div className="pointer-events-none absolute right-0 bg-black/50" style={{ top: `${r.haut}%`, bottom: `${r.bas}%`, width: `${r.droite}%` }} />
                {/* cadre conservé : on le déplace en le tirant, on le redimensionne par ses bords et coins */}
                <div onPointerDown={(e) => tirer(e, "tout")} className="absolute cursor-move border-2 border-dashed border-white outline outline-1 outline-primary"
                  style={{ top: `${r.haut}%`, bottom: `${r.bas}%`, left: `${r.gauche}%`, right: `${r.droite}%` }}>
                  {poignee(["haut", "gauche"], "-left-1.5 -top-1.5", "nwse-resize")}
                  {poignee(["haut", "droite"], "-right-1.5 -top-1.5", "nesw-resize")}
                  {poignee(["bas", "gauche"], "-bottom-1.5 -left-1.5", "nesw-resize")}
                  {poignee(["bas", "droite"], "-bottom-1.5 -right-1.5", "nwse-resize")}
                  {poignee(["haut"], "-top-1.5 left-1/2 -translate-x-1/2", "ns-resize")}
                  {poignee(["bas"], "-bottom-1.5 left-1/2 -translate-x-1/2", "ns-resize")}
                  {poignee(["gauche"], "-left-1.5 top-1/2 -translate-y-1/2", "ew-resize")}
                  {poignee(["droite"], "-right-1.5 top-1/2 -translate-y-1/2", "ew-resize")}
                </div>
              </div>
            </div>
            <div className="w-40 space-y-2">
              {champ("haut", "Haut")}{champ("bas", "Bas")}{champ("gauche", "Gauche")}{champ("droite", "Droite")}
              <Button size="sm" variant="ghost" className="w-full" onClick={() => setR({ haut: 0, droite: 0, bas: 0, gauche: 0 })}>Sans rognage</Button>
              <p className="text-[11px] text-muted-foreground">L'image d'origine n'est pas modifiée : le rognage est propre à cet emplacement.</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button disabled={!url} onClick={() => {
            const vide = !r.haut && !r.droite && !r.bas && !r.gauche;
            onValider(vide ? null : Object.fromEntries(Object.entries(r).filter(([, v]) => v)) as Rognage);
            onFermer();
          }}>Appliquer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Panneau de gauche : les images de la société, à glisser sur la page ; import par bouton ou glisser-déposer. */
export function PaletteImages({ ro }: { ro: boolean }) {
  const images = useImages();
  const champ = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState(false);
  const importer = async (fichiers: File[]) => {
    setEnvoi(true);
    for (const f of fichiers) {
      try {
        const r = await deposerFichier(f);
        toast({ title: "Image importée", description: `${r.code} : glissez-la sur la page` });
      } catch (e) {
        toast({ title: `Image refusée : ${f.name}`, description: (e as Error).message, variant: "destructive" });
      }
    }
    setEnvoi(false);
  };
  return (
    <div className="border-b p-2"
      onDragOver={(e) => { if (!ro && e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => {
        const f = Array.from(e.dataTransfer.files ?? []).filter((x) => /^image\/(png|jpe?g)$/.test(x.type));
        if (!ro && f.length) { e.preventDefault(); void importer(f); }
      }}>
      <div className="mb-1 flex items-center text-[11px] font-medium uppercase text-muted-foreground">
        Images
        {!ro && (
          <button type="button" className="ml-auto flex items-center gap-1 normal-case hover:text-foreground" onClick={() => champ.current?.click()}
            title="Importer des images PNG ou JPEG (ou les glisser ici, ou directement sur la page)">
            {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}Importer
          </button>
        )}
        <input ref={champ} type="file" multiple accept="image/png,image/jpeg" className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void importer(f); }} />
      </div>
      {images === null ? <div className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Chargement…</div>
        : !images.length ? <p className="text-[11px] text-muted-foreground">Aucune image. Importez un cachet, une signature, un bandeau… ou glissez un fichier sur la page.</p>
        : (
          <div className="grid max-h-40 grid-cols-4 gap-1 overflow-auto">
            {images.map((img) => <VignettePalette key={img.code} img={img} ro={ro} />)}
          </div>
        )}
    </div>
  );
}

function VignettePalette({ img, ro }: { img: ImageEdition; ro: boolean }) {
  const url = useUrlImage(img.code);
  return (
    <div draggable={!ro} onDragStart={(e) => { e.dataTransfer.setData(TYPE_DND_IMAGE, img.code); e.dataTransfer.effectAllowed = "copy"; }}
      title={`${img.code} — glisser sur la page`} className="cursor-grab rounded border p-0.5 hover:border-primary/60">
      <div className="flex h-9 items-center justify-center">
        {url ? <img src={url} alt={img.code} draggable={false} className="max-h-9 max-w-full object-contain" /> : <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="truncate text-center font-mono text-[9px]">{img.code}</div>
    </div>
  );
}
