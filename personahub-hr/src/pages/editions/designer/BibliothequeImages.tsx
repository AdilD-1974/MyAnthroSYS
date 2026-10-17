/**
 * BibliothequeImages.tsx — Images de la société (cachet, signature, bandeau, filigrane…)
 * déposées une fois et utilisées dans les modèles par ASSET("CODE").
 * Auteur : Adil DAIA — lot 2 bis (17/10/2026) — RG-EDT-IMAGE-01..03
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Building2, ImageOff, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { editionsApi, type ImageEdition } from "@/lib/editionsApi";

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
    if (!vignettes.has(code)) vignettes.set(code, editionsApi.urlImage(code).catch(() => null));
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

/** Rendu dans le canevas : la vraie image pour ASSET("CODE"), sinon un repère. */
export function ApercuImage({ valeur }: { valeur: string }) {
  const code = codeAsset(valeur);
  const url = useUrlImage(code);
  if (url) return <img src={url} alt={code ?? ""} className="h-full w-full object-contain" draggable={false} />;
  return (
    <div className="flex h-full w-full items-center justify-center border border-dashed border-muted-foreground/40 text-[10px] text-muted-foreground">
      {code ? <><ImageOff className="mr-1 h-3 w-3" />{code} ?</> : estLogo(valeur) ? <><Building2 className="mr-1 h-3 w-3" />logo</> : "image"}
    </div>
  );
}

function Vignette({ img, choisie, onChoisir, onSupprimer, ro }: {
  img: ImageEdition; choisie: boolean; onChoisir: () => void; onSupprimer: () => void; ro: boolean;
}) {
  const url = useUrlImage(img.code);
  return (
    <div className={`group relative rounded border p-1 ${choisie ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"}`}>
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
