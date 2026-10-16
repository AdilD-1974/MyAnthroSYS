/**
 * useEditeur.ts — État du designer : définition, sélection, historique.
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Toute modification passe par `modifier(fn, libelle)` : fn reçoit une copie de
 * la définition et la transforme sur place. Les modifications successives d'un
 * même objet en moins d'une seconde (glisser, taper au clavier) forment UNE
 * seule étape d'annulation, sinon Ctrl+Z reviendrait pixel par pixel.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { copie, type Bande, type Definition, type Element } from "@/pages/editions/types";

export interface Selection {
  bande: string | null;    // id de bande
  element: string | null;  // id d'élément
  colonne?: string | null; // id de colonne (tableau)
}

const HISTORIQUE_MAX = 100;
const FUSION_MS = 1000;

export function useEditeur(initiale: Definition | null) {
  // La définition vit dans une référence (source de vérité) recopiée dans l'état
  // pour le rendu : les mises à jour restent pures même sous React StrictMode.
  const courante = useRef<Definition | null>(initiale);
  const [definition, setDefinition] = useState<Definition | null>(initiale);
  const [selection, setSelection] = useState<Selection>({ bande: null, element: null });
  const [modifie, setModifie] = useState(false);
  const passe = useRef<Definition[]>([]);
  const futur = useRef<Definition[]>([]);
  const derniere = useRef<{ cle: string; t: number }>({ cle: "", t: 0 });

  const poser = (d: Definition | null) => {
    courante.current = d;
    setDefinition(d);
  };

  const charger = useCallback((d: Definition) => {
    passe.current = [];
    futur.current = [];
    derniere.current = { cle: "", t: 0 };
    poser(d);
    setModifie(false);
  }, []);

  const modifier = useCallback((fn: (d: Definition) => void, cle = "") => {
    const actuelle = courante.current;
    if (!actuelle) return;
    const suivante = copie(actuelle);
    fn(suivante);
    const maintenant = Date.now();
    const fusion = cle !== "" && cle === derniere.current.cle && maintenant - derniere.current.t < FUSION_MS;
    if (!fusion) {
      passe.current.push(actuelle);
      if (passe.current.length > HISTORIQUE_MAX) passe.current.shift();
    }
    derniere.current = { cle, t: maintenant };
    futur.current = [];
    poser(suivante);
    setModifie(true);
  }, []);

  const annuler = useCallback(() => {
    const precedente = passe.current.pop();
    if (!precedente || !courante.current) return;
    futur.current.push(courante.current);
    derniere.current = { cle: "", t: 0 };
    poser(precedente);
    setModifie(true);
  }, []);

  const retablir = useCallback(() => {
    const suivante = futur.current.pop();
    if (!suivante || !courante.current) return;
    passe.current.push(courante.current);
    derniere.current = { cle: "", t: 0 };
    poser(suivante);
    setModifie(true);
  }, []);

  const trouve = useMemo(() => {
    if (!definition) return { bande: null as Bande | null, element: null as Element | null, iBande: -1, iElement: -1 };
    const iBande = definition.bandes.findIndex((b) => b.id === selection.bande);
    const bande = iBande >= 0 ? definition.bandes[iBande] : null;
    const iElement = bande ? bande.elements.findIndex((e) => e.id === selection.element) : -1;
    return { bande, element: iElement >= 0 ? bande!.elements[iElement] : null, iBande, iElement };
  }, [definition, selection]);

  /** Modifie l'élément sélectionné (ou celui désigné), où qu'il soit. */
  const modifierElement = useCallback((idElement: string, fn: (e: Element, b: Bande) => void, cle?: string) => {
    modifier((d) => {
      for (const b of d.bandes) {
        const e = b.elements.find((x) => x.id === idElement);
        if (e) { fn(e, b); return; }
      }
    }, cle ?? `el:${idElement}`);
  }, [modifier]);

  const modifierBande = useCallback((idBande: string, fn: (b: Bande) => void, cle?: string) => {
    modifier((d) => {
      const b = d.bandes.find((x) => x.id === idBande);
      if (b) fn(b);
    }, cle ?? `bande:${idBande}`);
  }, [modifier]);

  return {
    definition, charger, modifier, modifierElement, modifierBande,
    selection, setSelection, ...trouve,
    annuler, retablir,
    peutAnnuler: passe.current.length > 0, peutRetablir: futur.current.length > 0,
    modifie, setModifie,
  };
}

export type Editeur = ReturnType<typeof useEditeur>;
