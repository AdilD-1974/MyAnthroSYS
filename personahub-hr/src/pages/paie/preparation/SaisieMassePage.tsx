/**
 * SaisieMassePage — Saisie de masse des éléments variables :
 * UNE rubrique + UNE grandeur (Base/Nombre/Taux/Montant) + une valeur par
 * collaborateur.
 *
 * Modèle (migration 46) : element_variable porte 4 colonnes explicites
 * (valeur_base/nombre/taux/montant), une ligne par (collaborateur, rubrique,
 * période) pouvant déjà porter d'autres grandeurs que celle éditée ici — on
 * les préserve donc à la mise à jour (voir `autres` sur LigneMasse). Plus de
 * colonne sens : les valeurs négatives se saisissent directement.
 *
 * Règles métier :
 *  • Seuls les collaborateurs RATTACHÉS AU PLAN choisi et actifs à la date de
 *    référence de la période sont proposés (collaborateur_plan_paie).
 *  • Périodes triées chronologiquement (ascendant) ; présélection de la première
 *    période OUVERTE.
 *  • Source imposée à SAISIE (saisie manuelle) — non modifiable.
 *  • Dates de début / fin de validité de l'élément variable saisissables.
 *  • Seuls les EV VALIDE sont pris en compte par le moteur de paie.
 * Auteur : Adil DAIA
 */
import React, { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/api";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, Loader2, CheckCircle2, AlertTriangle, Check, ChevronsUpDown, Search, Wand2, Eraser, Filter, X, ClipboardPaste } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import CollaborateursFiltresAvances, {
  EMPTY_FILTRES,
  countFiltres,
  type FiltresAvances,
} from "@/components/collaborateurs/CollaborateursFiltresAvances";

type Collab = { id: string; matricule: string; nom: string; prenom: string; statut_collaborateur: string };
type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; numero_periode: number; statut: string; date_ouverture: string | null; date_reference: string; date_debut: string; date_fin: string };
type Rubrique = {
  code: string; libelle: string;
  v_ajout: boolean; v_forcage: boolean; v_regularisation: boolean;
  v_annulation: boolean; v_reprise: boolean;
};

// RG-EV-AUTORISATION : correspondance type d'EV -> colonne d'autorisation
const AUTORISATION: Record<string, keyof Rubrique> = {
  AJOUT: "v_ajout", FORCAGE: "v_forcage", REGULARISATION: "v_regularisation",
  ANNULATION: "v_annulation", REPRISE: "v_reprise",
};
const estSaisissable = (r: Rubrique) =>
  r.v_ajout || r.v_forcage || r.v_regularisation || r.v_annulation || r.v_reprise;
type Ref = { code: string; libelle: string };
type UO = { id: string; code: string | null; libelle: string; parent_id: string | null; niveau: number | null; actif?: boolean };

interface InfoCollab {
  uo_id?: string | null;
  poste_code?: string | null;
  type_contrat_code?: string | null;
  societe_id?: string | null;
  etablissement_id?: string | null;
  date_embauche?: string | null;
}

interface LigneMasse {
  collaborateur: Collab;
  info: InfoCollab;
  evId?: string;
  valeur: string;
  valeurInitiale: string;
  // Autres grandeurs déjà présentes sur la ligne EV (si elle existe), à
  // préserver telles quelles à la mise à jour — ce n'est pas parce qu'on
  // édite le Montant ici que la Base ou le Nombre de la même ligne doivent
  // disparaître.
  autres: Partial<Record<"valeur_base" | "valeur_nombre" | "valeur_taux" | "valeur_montant", number | null>>;
  statut?: string;
  coche: boolean;
}

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const ATTRIBUTS = ["NOMBRE", "TAUX", "MONTANT", "BASE"];
const COLONNE_PAR_ATTRIBUT: Record<string, "valeur_base" | "valeur_nombre" | "valeur_taux" | "valeur_montant"> = {
  BASE: "valeur_base", NOMBRE: "valeur_nombre", TAUX: "valeur_taux", MONTANT: "valeur_montant",
};

// Style "cellule de liste dense" (façon Odoo) — identique à SaisieIndividuellePage.tsx
// pour une cohérence visuelle entre les deux écrans de saisie.
const CELL_INPUT = "h-8 text-xs border-transparent bg-transparent hover:border-border focus-visible:bg-background focus-visible:border-[hsl(var(--accent))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--accent)/0.3)] transition-colors";

// Une ligne d'historique est active à la date `d` si date_debut <= d et (date_fin nulle ou >= d)
const actifA = (debut: string | null, fin: string | null, d: string) =>
  (!debut || debut <= d) && (!fin || fin >= d);

const SaisieMassePage: React.FC = () => {
  const { formatDate } = useFormatMasks();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [types, setTypes] = useState<Ref[]>([]);
  const [typesContrat, setTypesContrat] = useState<Ref[]>([]);
  const [uos, setUos] = useState<UO[]>([]);

  const [planId, setPlanId] = useState("");
  const [periodeId, setPeriodeId] = useState("");
  const [codeRubrique, setCodeRubrique] = useState("");
  const [attribut, setAttribut] = useState("MONTANT");
  const [codeType, setCodeType] = useState("AJOUT");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");

  // Filtres : recherche libre + panneau avancé partagé (même composant que l'écran Collaborateurs)
  const [recherche, setRecherche] = useState("");
  const [filtres, setFiltres] = useState<FiltresAvances>(EMPTY_FILTRES);
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [fSaisie, setFSaisie] = useState<"all" | "avec" | "sans">("all");

  // Options du panneau
  const [optTypesContrat, setOptTypesContrat] = useState<{ value: string; label: string }[]>([]);
  const [optSocietes, setOptSocietes] = useState<{ value: string; label: string }[]>([]);
  const [optEtablissements, setOptEtablissements] = useState<{ value: string; label: string }[]>([]);
  const [optUOs, setOptUOs] = useState<{ value: string; label: string; parent_id: string | null }[]>([]);

  const [rubOpen, setRubOpen] = useState(false);
  const [valeurGroupee, setValeurGroupee] = useState("");
  const [lignes, setLignes] = useState<LigneMasse[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---------- Référentiels ----------
  useEffect(() => {
    db.list<Plan>("plan_paie", { actif: true, select: "id,code,libelle", order: "code", limit: 200 })
      .then((p) => { setPlans(p); if (p[0]) setPlanId((x) => x || p[0].id); }).catch(() => {});
    db.list<Rubrique>("rubrique_paie", { archive: false, order: "code", limit: 2000,
      select: "code,libelle,v_ajout,v_forcage,v_regularisation,v_annulation,v_reprise" })
      .then((rs) => setRubriques(rs.filter(estSaisissable))).catch(() => {});
    db.list<Ref>("ref_ev_type", { actif: true, select: "code,libelle", order: "ordre", limit: 100 }).then(setTypes).catch(() => {});
    db.list<Ref>("ref_type_contrat", { select: "code,libelle", order: "code", limit: 200 })
      .then((ts) => { setTypesContrat(ts); setOptTypesContrat(ts.map((t) => ({ value: t.code, label: t.libelle }))); }).catch(() => {});
    db.list<UO>("unites_organisationnelles", { actif: true, select: "id,code,libelle,parent_id,niveau", order: "libelle", limit: 5000 })
      .then((us) => { setUos(us); setOptUOs(us.map((u) => ({ value: u.id, label: u.libelle, parent_id: u.parent_id ?? null }))); }).catch(() => {});
    db.list<any>("organisations", { select: "id,libelle", order: "libelle", limit: 500 })
      .then((os) => setOptSocietes(os.map((o) => ({ value: o.id, label: o.libelle })))).catch(() => {});
    db.list<any>("etablissements", { select: "id,libelle", order: "libelle", limit: 1000 })
      .then((es) => setOptEtablissements(es.map((e) => ({ value: e.id, label: e.libelle })))).catch(() => {});
  }, []);

  // ---------- Périodes : tri ASC + présélection de la 1re OUVERTE ----------
  const periodeEstOuverte = (p: Periode) => {
    if (p.statut === "CLOTUREE" || p.statut === "FERMEE") return false;
    if (p.date_ouverture && p.date_ouverture > new Date().toISOString().slice(0, 10)) return false;
    return true;
  };


  useEffect(() => {
    if (!planId) return;
    db.list<Periode>("calendrier_paie", {
      plan_paie_id: planId, select: "id,annee,mois,numero_periode,statut,date_ouverture,date_reference,date_debut,date_fin", limit: 1000,
    }).then((ps) => {
      // Chronologique ASCENDANT (Janvier en premier)
      ps.sort((a, b) => a.annee - b.annee || a.mois - b.mois || (a.numero_periode || 0) - (b.numero_periode || 0));
      setPeriodes(ps);
      const premiereOuverte = ps.find(periodeEstOuverte);
      setPeriodeId((x) => (x && ps.some((p) => p.id === x) ? x : (premiereOuverte?.id || ps[0]?.id || "")));
    }).catch(() => setPeriodes([]));
  }, [planId]);

  const periode = periodes.find((p) => p.id === periodeId);
  const periodeOuverte = useMemo(() => (periode ? periodeEstOuverte(periode) : false), [periode]);

  // ---------- Population : collaborateurs rattachés AU PLAN, actifs à la date de référence ----------
  const charger = async () => {
    if (!periodeId || !planId || !periode) { setLignes([]); return; }   // la rubrique n'est pas requise
    setLoading(true);
    try {
      const ref = periode.date_reference;

      // 1) Rattachements au plan (le proxy interdit les jointures -> filtrage client)
      const rattachements = await db.list<any>("collaborateur_plan_paie", {
        plan_paie_id: planId, archive: false, select: "collaborateur_id,date_debut,date_fin", limit: 10000,
      });
      const idsPlan = new Set(
        rattachements.filter((r) => actifA(r.date_debut, r.date_fin, ref)).map((r) => r.collaborateur_id),
      );
      if (!idsPlan.size) { setLignes([]); setLoading(false); return; }

      // 2) Collaborateurs (non archivés, non sortis)
      const collabs = (await db.list<Collab>("collaborateurs", {
        archive: false, select: "id,matricule,nom,prenom,statut_collaborateur", order: "matricule", limit: 10000,
      })).filter((c) => idsPlan.has(c.id) && c.statut_collaborateur !== "SORTI");

      // 3) Contexte de filtrage : affectation (UO) + contrat, actifs à la date de référence
      const [affs, contrats, unites, evs] = await Promise.all([
        db.list<any>("collaborateur_affectations", { archive: false, select: "collaborateur_id,unite_id,code_poste,date_debut_uo,date_fin_uo,date_debut_poste,date_fin_poste", limit: 10000 }).catch(() => []),
        db.list<any>("collaborateur_contrats", { archive: false, select: "collaborateur_id,code_type_contrat,date_debut,date_fin", limit: 10000 }).catch(() => []),
        db.list<any>("unites_organisationnelles", { select: "id,etablissement_id", limit: 5000 }).catch(() => []),
        codeRubrique
          ? db.list<any>("element_variable", {
              periode_id: periodeId, code_rubrique: codeRubrique,
              select: "id,collaborateur_id,valeur_base,valeur_nombre,valeur_taux,valeur_montant,statut", limit: 10000,
            })
          : Promise.resolve([]),
      ]);

      const etabParUo = new Map<string, string>();
      (unites as any[]).forEach((u) => etabParUo.set(u.id, u.etablissement_id));

      const info = new Map<string, InfoCollab>();
      const majInfo = (id: string, patch: Partial<InfoCollab>) =>
        info.set(id, { ...(info.get(id) || {}), ...patch });

      affs.forEach((a: any) => {
        if (actifA(a.date_debut_uo, a.date_fin_uo, ref) && a.unite_id) {
          majInfo(a.collaborateur_id, { uo_id: a.unite_id, etablissement_id: etabParUo.get(a.unite_id) || null });
        }
        if (actifA(a.date_debut_poste, a.date_fin_poste, ref) && a.code_poste) {
          majInfo(a.collaborateur_id, { poste_code: a.code_poste });
        }
      });
      contrats.filter((c: any) => actifA(c.date_debut, c.date_fin, ref))
        .forEach((c: any) => majInfo(c.collaborateur_id, { type_contrat_code: c.code_type_contrat, date_embauche: c.date_debut }));

      const evParCollab = new Map<string, any>();
      (evs as any[]).forEach((e) => evParCollab.set(e.collaborateur_id, e));

      const colonneCible = COLONNE_PAR_ATTRIBUT[attribut];
      setLignes(collabs.map((c) => {
        const ev = evParCollab.get(c.id);
        const v = ev && ev[colonneCible] != null ? String(ev[colonneCible]) : "";
        return {
          collaborateur: c, info: info.get(c.id) || {},
          evId: ev?.id, valeur: v, valeurInitiale: v,
          autres: ev ? {
            valeur_base: ev.valeur_base, valeur_nombre: ev.valeur_nombre,
            valeur_taux: ev.valeur_taux, valeur_montant: ev.valeur_montant,
          } : {},
          statut: ev?.statut, coche: false,
        };
      }));
    } catch (e: any) {
      toast({ title: "Erreur de chargement", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };
  useEffect(() => { charger(); /* eslint-disable-next-line */ }, [planId, periodeId, codeRubrique, attribut]);

  // ---------- Filtres avancés (client) ----------
  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const f = filtres;
    return lignes.filter((l) => {
      const i = l.info;
      if (q && !`${l.collaborateur.matricule} ${l.collaborateur.nom} ${l.collaborateur.prenom}`.toLowerCase().includes(q)) return false;
      if (f.type_contrat_codes.length && (!i.type_contrat_code || !f.type_contrat_codes.includes(i.type_contrat_code))) return false;
      if (f.societe_ids.length && (!i.societe_id || !f.societe_ids.includes(i.societe_id))) return false;
      if (f.etablissement_ids.length && (!i.etablissement_id || !f.etablissement_ids.includes(i.etablissement_id))) return false;
      if (f.sans_uo && i.uo_id) return false;
      if (f.sans_poste && i.poste_code) return false;
      // uo_ids contient déjà les descendants si la racine a été cochée en cascade
      if (!f.sans_uo && f.uo_ids.length && (!i.uo_id || !f.uo_ids.includes(i.uo_id))) return false;
      if (f.date_embauche_debut && (!i.date_embauche || i.date_embauche < f.date_embauche_debut)) return false;
      if (f.date_embauche_fin && (!i.date_embauche || i.date_embauche > f.date_embauche_fin)) return false;
      if (fSaisie === "avec" && l.valeur === "") return false;
      if (fSaisie === "sans" && l.valeur !== "") return false;
      return true;
    });
  }, [lignes, recherche, filtres, fSaisie]);

  const nbFiltres = countFiltres(filtres) + (fSaisie !== "all" ? 1 : 0);

  const setValeur = (id: string, v: string) => setLignes((L) => L.map((l) => (l.collaborateur.id === id ? { ...l, valeur: v } : l)));
  const setCoche = (id: string, v: boolean) => setLignes((L) => L.map((l) => (l.collaborateur.id === id ? { ...l, coche: v } : l)));

  // RG-SAISIE-MASSE-COLLER-01 (Adil DAIA) : colle une colonne de valeurs
  // copiée depuis Excel, une valeur par ligne, à partir de la cellule où le
  // collage a eu lieu — dans l'ordre d'affichage courant (visibles), en
  // respectant les filtres/tri déjà appliqués. Si plusieurs colonnes sont
  // collées (tabulations), seule la dernière est retenue par ligne (colonne
  // la plus probable pour la valeur elle-même quand Excel embarque
  // matricule + nom + valeur sur une même sélection).
  const collerValeurs = (idDepart: string, texte: string) => {
    const idxDepart = visibles.findIndex((l) => l.collaborateur.id === idDepart);
    if (idxDepart === -1) return;
    const valeurs = texte
      .replace(/\r/g, "")
      .split("\n")
      .filter((ligne, i, arr) => !(i === arr.length - 1 && ligne === ""))
      .map((ligne) => {
        const parts = ligne.split("\t");
        return parts[parts.length - 1].trim().replace(",", ".");
      });
    if (!valeurs.length) return;
    setLignes((L) => {
      const map = new Map(L.map((l) => [l.collaborateur.id, l]));
      valeurs.forEach((v, i) => {
        const cible = visibles[idxDepart + i];
        if (!cible) return;
        const l = map.get(cible.collaborateur.id);
        if (l) map.set(cible.collaborateur.id, { ...l, valeur: v });
      });
      return L.map((l) => map.get(l.collaborateur.id) || l);
    });
    const nbAppliques = Math.min(valeurs.length, visibles.length - idxDepart);
    toast({ title: `${nbAppliques} valeur(s) collée(s)`, description: valeurs.length > nbAppliques ? "Certaines lignes collées dépassaient la liste visible et ont été ignorées." : undefined });
  };
  const cocherTout = (v: boolean) => {
    const ids = new Set(visibles.map((l) => l.collaborateur.id));
    setLignes((L) => L.map((l) => (ids.has(l.collaborateur.id) ? { ...l, coche: v } : l)));
  };

  const ciblesGroupees = () => {
    const coches = lignes.filter((l) => l.coche);
    return new Set((coches.length ? coches : visibles).map((l) => l.collaborateur.id));
  };
  const appliquer = () => {
    if (valeurGroupee === "") { toast({ title: "Saisissez une valeur à appliquer" }); return; }
    const cibles = ciblesGroupees();
    setLignes((L) => L.map((l) => (cibles.has(l.collaborateur.id) ? { ...l, valeur: valeurGroupee } : l)));
    toast({ title: "Valeur appliquée", description: `${cibles.size} collaborateur(s).` });
  };
  const effacer = () => {
    const cibles = ciblesGroupees();
    setLignes((L) => L.map((l) => (cibles.has(l.collaborateur.id) ? { ...l, valeur: "" } : l)));
  };

  const modifiees = lignes.filter((l) => l.valeur !== l.valeurInitiale);
  const aValider = lignes.filter((l) => l.evId && l.statut === "SAISI");

  const enregistrer = async () => {
    if (!codeRubrique) { toast({ title: "Choisissez une rubrique", variant: "destructive" }); return; }
    // Garde-fou : le type doit être autorisé sur la rubrique (RG-EV-AUTORISATION)
    if (rub && !typesAutorises.some((t) => t.code === codeType)) {
      toast({ title: "Type non autorisé",
              description: `Le type « ${codeType} » n'est pas autorisé sur la rubrique ${codeRubrique}.`,
              variant: "destructive" });
      return;
    }
    if (dateDebut && dateFin && dateFin < dateDebut) {
      toast({ title: "Dates incohérentes", description: "La fin de validité précède le début.", variant: "destructive" }); return;
    }
    // RG-EV-VALIDITE : à défaut de saisie, la validité couvre toute la période de paie.
    const vDebut = dateDebut || periode?.date_debut || null;
    const vFin = dateFin || periode?.date_fin || null;
    if (!modifiees.length) { toast({ title: "Aucune modification" }); return; }
    setSaving(true);
    const colonneCible = COLONNE_PAR_ATTRIBUT[attribut];
    try {
      const aCreer = modifiees.filter((l) => !l.evId && l.valeur !== "");
      const aMaj = modifiees.filter((l) => l.evId && l.valeur !== "");
      const aSuppr = modifiees.filter((l) => l.evId && l.valeur === "");

      if (aCreer.length) {
        await db.create("element_variable", aCreer.map((l) => ({
          collaborateur_id: l.collaborateur.id, periode_id: periodeId,
          code_rubrique: codeRubrique, [colonneCible]: Number(l.valeur) || 0,
          code_type: codeType, code_source: "SAISIE", statut: "SAISI",
          date_debut: vDebut, date_fin: vFin,
        })));
      }
      for (const l of aMaj) {
        // Les autres grandeurs déjà présentes sur cette ligne (Base/Nombre/
        // Taux/Montant hors celle éditée ici) sont réécrites telles quelles —
        // sans ça, éditer le Montant effacerait silencieusement la Base.
        await db.update("element_variable", { id: l.evId! }, {
          ...l.autres, [colonneCible]: Number(l.valeur) || 0,
          code_type: codeType, code_source: "SAISIE",
          date_debut: vDebut, date_fin: vFin,
        });
      }
      for (const l of aSuppr) {
        const autresGrandeursRestantes = Object.entries(l.autres)
          .some(([col, v]) => col !== colonneCible && v != null);
        if (autresGrandeursRestantes) {
          // Il reste au moins une autre grandeur sur la ligne : on vide
          // juste celle-ci, la ligne EV survit pour les autres.
          await db.update("element_variable", { id: l.evId! }, { [colonneCible]: null });
        } else {
          // Plus aucune grandeur : la ligne ne sert plus à rien, on la supprime.
          await db.remove("element_variable", { id: l.evId! });
        }
      }

      toast({ title: "Éléments enregistrés", description: `${aCreer.length} créé(s), ${aMaj.length} modifié(s), ${aSuppr.length} vidé(s)/supprimé(s).` });
      charger();
    } catch (e: any) {
      toast({ title: "Erreur d'enregistrement", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const validerTout = async () => {
    if (!aValider.length) { toast({ title: "Aucun élément à valider" }); return; }
    if (!confirm(`Valider ${aValider.length} élément(s) ? Ils seront pris en compte par le calcul de paie.`)) return;
    setSaving(true);
    try {
      for (const l of aValider) {
        await db.update("element_variable", { id: l.evId! }, { statut: "VALIDE", valide_le: new Date().toISOString() });
      }
      toast({ title: "Éléments validés", description: `${aValider.length} élément(s).` });
      charger();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const rub = rubriques.find((r) => r.code === codeRubrique);

  // Types d'EV réellement autorisés sur la rubrique choisie
  const typesAutorises = useMemo(() => {
    if (!rub) return types;
    return types.filter((t) => {
      const col = AUTORISATION[t.code];
      return col ? !!rub[col] : false;
    });
  }, [types, rub]);

  // Si le type courant n'est plus autorisé, basculer sur le premier disponible
  useEffect(() => {
    if (!rub || !typesAutorises.length) return;
    if (!typesAutorises.some((t) => t.code === codeType)) setCodeType(typesAutorises[0].code);
  }, [rub, typesAutorises, codeType]);
  const nbCoches = lignes.filter((l) => l.coche).length;
  const nbSaisis = lignes.filter((l) => l.valeur !== "").length;
  const libUo = (id?: string | null) => uos.find((u) => u.id === id)?.libelle || "—";
  const libContrat = (code?: string | null) => typesContrat.find((t) => t.code === code)?.libelle || code || "—";

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Saisie de masse des éléments variables</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Une rubrique, une valeur par collaborateur. Seuls les collaborateurs rattachés au plan de paie sélectionné sont proposés.
          Les éléments <strong>validés</strong> sont pris en compte par le calcul.
        </p>
      </div>

      {/* Contexte */}
      <div className="rounded-xl border border-border p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
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
        <div className="space-y-1.5">
          <Label className="text-xs">Rubrique</Label>
          <Popover open={rubOpen} onOpenChange={setRubOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                <span className="truncate">{rub ? `${rub.code} — ${rub.libelle}` : "Sélectionner…"}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
                <CommandInput placeholder="Code ou intitulé…" />
                <CommandList>
                  <CommandEmpty>Aucune rubrique.</CommandEmpty>
                  <CommandGroup>
                    {rubriques.map((r) => (
                      <CommandItem key={r.code} value={`${r.code} ${r.libelle}`}
                        onSelect={() => { setCodeRubrique(r.code); setRubOpen(false); }}>
                        <Check className={`mr-2 h-4 w-4 ${r.code === codeRubrique ? "opacity-100" : "opacity-0"}`} />
                        <code className="text-xs text-accent mr-2">{r.code}</code>
                        <span className="text-muted-foreground truncate">{r.libelle}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label className="text-xs">Attribut</Label>
          <Select value={attribut} onValueChange={setAttribut}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ATTRIBUTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Paramètres de l'élément variable */}
      <div className="rounded-xl border border-border p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={codeType} onValueChange={setCodeType} disabled={!codeRubrique}>
            <SelectTrigger><SelectValue placeholder={codeRubrique ? "…" : "Choisir une rubrique"} /></SelectTrigger>
            <SelectContent>{typesAutorises.map((t) => <SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>)}</SelectContent>
          </Select>
          {rub && typesAutorises.length < types.length && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {typesAutorises.length} type(s) autorisé(s) sur cette rubrique.
            </p>
          )}
        </div>
        <div>
          <Label className="text-xs">Source</Label>
          <Input value="Saisie manuelle" readOnly disabled className="bg-muted/40 cursor-not-allowed" />
        </div>
        <div>
          <Label className="text-xs">Début de validité</Label>
          <Input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} disabled={!periodeOuverte} />
          {!dateDebut && periode && (
            <p className="text-[10px] text-muted-foreground mt-0.5">Défaut : {formatDate(periode.date_debut)} (début de période)</p>
          )}
        </div>
        <div>
          <Label className="text-xs">Fin de validité</Label>
          <Input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} disabled={!periodeOuverte} />
          {!dateFin && periode && (
            <p className="text-[10px] text-muted-foreground mt-0.5">Défaut : {formatDate(periode.date_fin)} (fin de période)</p>
          )}
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
              ? "Cette période est clôturée — la saisie est désactivée."
              : `Cette période n'est pas ouverte ${periode.date_ouverture ? `(ouverture le ${formatDate(periode.date_ouverture)})` : ""} — la saisie est désactivée.`}
          </div>
        );
      })()}

      {/* Barre d'outils */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-end gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Matricule, nom, prénom…" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="pl-8 h-9 text-sm w-56" />
          </div>
          <Button size="sm" variant={nbFiltres ? "default" : "outline"} onClick={() => setPanneauOuvert(true)} className="gap-1.5 h-9">
            <Filter size={14} /> Filtres avancés {nbFiltres > 0 && `(${nbFiltres})`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFiltresOuverts((v) => !v)} className="gap-1.5 h-9">
            Saisie
          </Button>
          <div>
            <Label className="text-xs">Valeur à appliquer</Label>
            <Input type="number" step="0.0001" value={valeurGroupee} onChange={(e) => setValeurGroupee(e.target.value)}
              disabled={!periodeOuverte} className="h-9 text-sm w-32 text-right tabular-nums" placeholder="0" />
          </div>
          <Button size="sm" variant="outline" onClick={appliquer} disabled={!periodeOuverte || !codeRubrique} className="gap-1.5 h-9">
            <Wand2 size={14} /> Appliquer {nbCoches > 0 ? `(${nbCoches})` : "à tous"}
          </Button>
          <Button size="sm" variant="ghost" onClick={effacer} disabled={!periodeOuverte || !codeRubrique} className="gap-1.5 h-9">
            <Eraser size={14} /> Effacer
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={validerTout} disabled={saving || !aValider.length || !periodeOuverte} className="gap-1.5">
            <CheckCircle2 size={14} /> Valider ({aValider.length})
          </Button>
          <Button size="sm" onClick={enregistrer} disabled={saving || !modifiees.length || !periodeOuverte} className="gap-1.5">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Enregistrer ({modifiees.length})
          </Button>
        </div>
      </div>

      {/* Filtre « saisie » propre à la paie */}
      {filtresOuverts && (
        <div className="rounded-xl border border-border p-3 bg-muted/20 flex items-center gap-3">
          <Label className="text-xs">Saisie</Label>
          <Select value={fSaisie} onValueChange={(v) => setFSaisie(v as any)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="avec">Avec valeur</SelectItem>
              <SelectItem value="sans">Sans valeur</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">Les autres critères sont dans « Filtres avancés ».</span>
        </div>
      )}

      {!codeRubrique && lignes.length > 0 && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
          Population filtrée : choisissez une <strong>rubrique</strong> pour activer la saisie.
        </div>
      )}

      {/* Grille — style liste dense (cellules sans bordure jusqu'au survol/focus,
          filets horizontaux uniquement), couleurs dérivées du thème. */}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <ClipboardPaste size={12} /> Copiez une colonne de valeurs depuis Excel et collez-la dans une cellule pour remplir les lignes suivantes d'un coup.
      </p>
      <div className="rounded-xl border border-border overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={16} /> Chargement…
          </div>
        ) : lignes.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Aucun collaborateur rattaché à ce plan de paie sur cette période.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-[10px] uppercase tracking-wide font-semibold hover:bg-transparent" style={{ background: "hsl(var(--muted) / 0.5)" }}>
                <TableHead className="w-10 py-2">
                  <Checkbox checked={nbCoches > 0 && nbCoches === visibles.length}
                    onCheckedChange={(v) => cocherTout(!!v)} disabled={!periodeOuverte} />
                </TableHead>
                <TableHead className="w-24 py-2">Matricule</TableHead>
                <TableHead className="w-52 py-2">Collaborateur</TableHead>
                <TableHead className="w-64 py-2">Unité</TableHead>
                <TableHead className="w-56 py-2">Contrat</TableHead>
                <TableHead className="w-40 text-right py-2">{codeRubrique ? attribut : "—"}</TableHead>
                <TableHead className="w-24 py-2">Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((l) => {
                const modif = l.valeur !== l.valeurInitiale;
                return (
                  <TableRow
                    key={l.collaborateur.id}
                    className="text-xs border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    style={modif ? { borderLeft: "2px solid hsl(var(--warning))" } : { borderLeft: "2px solid transparent" }}
                  >
                    <TableCell className="py-1">
                      <Checkbox checked={l.coche} onCheckedChange={(v) => setCoche(l.collaborateur.id, !!v)} disabled={!periodeOuverte} />
                    </TableCell>
                    <TableCell className="py-1"><code className="text-[11px] text-muted-foreground">{l.collaborateur.matricule}</code></TableCell>
                    <TableCell className="py-1 font-medium truncate max-w-[13rem]" title={`${l.collaborateur.nom} ${l.collaborateur.prenom}`}>
                      {l.collaborateur.nom} {l.collaborateur.prenom}
                    </TableCell>
                    <TableCell className="py-1 text-muted-foreground truncate max-w-[16rem]" title={libUo(l.info.uo_id)}>
                      {libUo(l.info.uo_id)}
                    </TableCell>
                    <TableCell className="py-1 text-muted-foreground truncate max-w-[14rem]" title={libContrat(l.info.type_contrat_code)}>
                      {libContrat(l.info.type_contrat_code)}
                    </TableCell>
                    <TableCell className="py-1">
                      <Input type="number" step="0.0001" value={l.valeur}
                        disabled={!periodeOuverte || !codeRubrique}
                        title={!codeRubrique ? "Choisissez une rubrique pour saisir" : "Collez une colonne de valeurs copiée depuis Excel pour remplir plusieurs lignes d'un coup"}
                        onChange={(e) => setValeur(l.collaborateur.id, e.target.value)}
                        onPaste={(e) => {
                          const texte = e.clipboardData.getData("text");
                          if (texte.includes("\n") || texte.includes("\t")) {
                            e.preventDefault();
                            collerValeurs(l.collaborateur.id, texte);
                          }
                        }}
                        placeholder={codeRubrique ? "—" : "Choisir une rubrique"}
                        className={`${CELL_INPUT} text-right tabular-nums`} />
                    </TableCell>
                    <TableCell className="py-1">
                      {l.statut ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: `hsl(var(${l.statut === "VALIDE" ? "--success" : "--warning"}) / 0.12)`,
                            color: `hsl(var(${l.statut === "VALIDE" ? "--success" : "--warning"}))`,
                          }}>
                          {l.statut}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibles.length === 0 && (
                <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Aucun collaborateur ne correspond aux filtres.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {visibles.length} affiché(s) sur {lignes.length} rattaché(s) au plan ·{" "}
        <span className="font-medium" style={{ color: "hsl(var(--accent))" }}>{nbSaisis} valeur(s) saisie(s)</span>.
        Vider une valeur existante la supprime à l'enregistrement.
      </p>
      {/* Panneau de filtres partagé avec l'écran Collaborateurs */}
      <CollaborateursFiltresAvances
        open={panneauOuvert}
        onClose={() => setPanneauOuvert(false)}
        value={filtres}
        onApply={setFiltres}
        optTypesContrat={optTypesContrat}
        optSocietes={optSocietes}
        optEtablissements={optEtablissements}
        optUOs={optUOs}
        optGenres={[]}
        optNationalites={[]}
      />
    </div>
  );
};

export default SaisieMassePage;
