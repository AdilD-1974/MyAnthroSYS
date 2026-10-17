/**
 * glisser.tsx — Réordonner les lignes d'un tableau par glisser-déposer.
 * Auteur : Adil DAIA — lot 2 bis (17/10/2026)
 *
 * On saisit la ligne par sa poignée (⋮⋮) : les champs de la ligne restent utilisables.
 * Un trait indique où la ligne sera déposée (au-dessus ou au-dessous de la ligne survolée).
 */
import { useState, type DragEvent } from "react";
import { GripVertical } from "lucide-react";

/** Déplace `nb` éléments à partir de `de` pour les insérer avant l'indice `vers` (indices d'origine). */
export function deplacer<T>(liste: T[], de: number, vers: number, nb = 1): number {
  if (vers >= de && vers <= de + nb) return de;          // déposé sur lui-même
  const bloc = liste.splice(de, nb);
  const cible = vers > de ? vers - nb : vers;
  liste.splice(cible, 0, ...bloc);
  return cible;
}

export function useGlisser(onDeposer: (de: number, vers: number) => void, actif = true) {
  const [source, setSource] = useState<number | null>(null);
  const [cible, setCible] = useState<{ i: number; apres: boolean } | null>(null);
  const fin = () => { setSource(null); setCible(null); };

  const poignee = (i: number) => (
    <span
      draggable={actif}
      title={actif ? "Glisser pour déplacer" : undefined}
      onDragStart={(e: DragEvent<HTMLSpanElement>) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));       // requis par Firefox
        const tr = e.currentTarget.closest("tr");
        if (tr) e.dataTransfer.setDragImage(tr, 12, 12);
        setSource(i);
      }}
      onDragEnd={fin}
      className={`inline-flex ${actif ? "cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing" : "text-muted-foreground/30"}`}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );

  const ligne = (i: number) => {
    if (!actif) return { className: "" };
    const survol = cible?.i === i && source !== null && source !== i;
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (source === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        const apres = e.clientY > r.top + r.height / 2;
        if (cible?.i !== i || cible.apres !== apres) setCible({ i, apres });
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        if (source !== null && cible) onDeposer(source, cible.apres ? cible.i + 1 : cible.i);
        fin();
      },
      className: [
        source === i ? "opacity-40" : "",
        survol && !cible!.apres ? "[&>td]:border-t-2 [&>td]:border-t-primary" : "",
        survol && cible!.apres ? "[&>td]:border-b-2 [&>td]:border-b-primary" : "",
      ].join(" "),
    };
  };

  return { poignee, ligne };
}
