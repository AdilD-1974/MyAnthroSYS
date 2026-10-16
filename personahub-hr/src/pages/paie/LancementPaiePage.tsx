/**
 * LancementPaiePage — Lancement de la paie en masse pour un plan.
 * Auteur : Adil DAIA
 *
 * Route : /paie/traitement/preparation
 * Plan → année → période, puis filtres de population (organisation, poste,
 * type/statut de contrat, régime, statut collaborateur, matricule, sélection
 * nominative). Aperçu du nombre de collaborateurs ciblés, puis lancement du
 * calcul en lot (bulletins temporaires) avec récapitulatif.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  Rocket, Users, Loader2, CheckCircle2, XCircle, ChevronsUpDown, Filter,
  ShieldCheck, AlertTriangle, RotateCcw, ChevronDown, ChevronRight,
} from "lucide-react";
import { db } from "@/lib/api";
import {
  apercuPopulation, calculerLot, validerLot, listerBulletins, devaliderBulletin,
  type PopulationFiltres, type CollaborateurCible, type LotCalculResult, type LotValidationResult,
} from "@/lib/paieApi";
import { useTableSort } from "@/hooks/useTableSort";
import { buildTrail } from "@/components/navigation/ReturnTrail";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

const MOIS = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const fmt = (n?: number | null) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; statut: string; date_ouverture?: string | null };
type Opt = { value: string; label: string };

// ---- Multi-select réutilisable ------------------------------------------
function MultiSelect({ label, options, value, onChange, placeholder = "Tous" }: {
  label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const resume = value.length === 0 ? placeholder : value.length === 1
    ? (options.find((o) => o.value === value[0])?.label ?? "1 sélectionné")
    : `${value.length} sélectionnés`;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className={value.length ? "" : "text-muted-foreground"}>{resume}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Rechercher…" />
            <CommandList>
              <CommandEmpty>Aucun résultat.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                    <Checkbox checked={value.includes(o.value)} className="mr-2 pointer-events-none" />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Contexte du lancement, mémorisé pour survivre au bouton « retour » du navigateur. */
const CLE_CONTEXTE = "paie.lancement.contexte";

/** Aplatit l'arbre des UO : parent avant enfants, avec indentation visuelle. */
function arbreUo(rows: any[]): Opt[] {
  const enfants = new Map<string | null, any[]>();
  rows.forEach((u) => {
    const k = u.parent_id ?? null;
    if (!enfants.has(k)) enfants.set(k, []);
    enfants.get(k)!.push(u);
  });
  enfants.forEach((L) => L.sort((a, b) => a.libelle.localeCompare(b.libelle)));
  const out: Opt[] = [];
  const descendre = (parent: string | null, prof: number) => {
    (enfants.get(parent) || []).forEach((u) => {
      out.push({ value: u.id, label: `${"\u00A0\u00A0".repeat(prof)}${prof ? "└ " : ""}${u.libelle}` });
      descendre(u.id, prof + 1);
    });
  };
  descendre(null, 0);
  // UO orphelines (parent absent de la liste)
  const vus = new Set(out.map((o) => o.value));
  rows.filter((u) => !vus.has(u.id)).forEach((u) => out.push({ value: u.id, label: u.libelle }));
  return out;
}

export default function LancementPaiePage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [annee, setAnnee] = useState<number | null>(null);
  const [periodeId, setPeriodeId] = useState("");

  // Options de filtres
  const [orgs, setOrgs] = useState<Opt[]>([]);
  const [postes, setPostes] = useState<Opt[]>([]);
  const [typesContrat, setTypesContrat] = useState<Opt[]>([]);
  const [statutsCollab, setStatutsCollab] = useState<Opt[]>([]);
  const [regimes, setRegimes] = useState<Opt[]>([]);

  // Filtres sélectionnés
  const [orgSel, setOrgSel] = useState<string[]>([]);
  const [posteSel, setPosteSel] = useState<string[]>([]);
  const [typeSel, setTypeSel] = useState<string[]>([]);
  const [statutSel, setStatutSel] = useState<string[]>([]);
  const [regimeSel, setRegimeSel] = useState<string[]>([]);
  const [matricule, setMatricule] = useState("");
  // RG-LOT-MATRICULES-01 (Adil DAIA) : sélection directe d'un NOMBRE précis de
  // collaborateurs par matricule — en plus de la recherche "contient" existante,
  // pour cibler une liste exacte sans devoir passer par les filtres organisationnels.
  const [collabsOpt, setCollabsOpt] = useState<Opt[]>([]);
  const [matriculesSel, setMatriculesSel] = useState<string[]>([]);
  const [pendingSel, setPendingSel] = useState<{ annee?: number; periodeId?: string } | null>(null);

  const [population, setPopulation] = useState<CollaborateurCible[] | null>(null);
  const [resultat, setResultat] = useState<LotCalculResult | null>(null);
  // Collaborateurs cochés : si non vide, seuls ceux-là sont validés.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [validation, setValidation] = useState<LotValidationResult | null>(null);
  // RG-LOT-DEVALIDATION-01 (Adil DAIA) : pas de endpoint lot côté API pour la
  // dévalidation (contrairement à validerLot) — agrégé côté client à partir
  // de devaliderBulletin() (déjà utilisée, unitairement, dans CyclePaie.tsx).
  const [devalidation, setDevalidation] = useState<{ nb_ok: number; nb_echec: number; nb_ignores: number; erreurs: string[] } | null>(null);
  const [busy, setBusy] = useState<null | "apercu" | "lancer" | "valider" | "devalider">(null);
  // RG-LANCEMENT-COMPACT-01 (Adil DAIA) : filtres de population repliés par
  // défaut — la grande majorité des lancements se font sans filtre (toute la
  // population du plan), pas la peine d'occuper l'écran en permanence avec 7
  // champs "Tous". Un badge de résumé reste visible même replié.
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Ouvre le bulletin dans l'écran individuel, avec un retour vers ce lancement
  // Tri des colonnes du tableau de résultats (matricule, net à payer…)
  const { sortedData: resultatsTries, toggleSort, SortIcon } = useTableSort(
    resultat?.resultats ?? [],
    "matricule",
  );

  // --- Sélection des bulletins à valider ---
  const basculer = (id: string) =>
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toutCocher = (v: boolean) =>
    setSelection(v ? new Set(resultatsTries.map((r) => r.collaborateur_id)) : new Set());
  const tousCoches = resultatsTries.length > 0 && selection.size === resultatsTries.length;

  const voirBulletin = (collabId: string) => {
    if (!periodeId) return;
    // Contexte complet (plan/période + filtres de population + la population
    // EXACTE déjà calculée), pour que le retour restaure exactement l'écran
    // quitté — pas tous les bulletins de la période, qui peuvent inclure
    // d'autres lancements/lots que celui-ci.
    const ctx = {
      planId, annee, periodeId,
      orgSel, posteSel, typeSel, statutSel, regimeSel, matricule,
      collaborateurIds: resultat ? resultat.resultats.map((r) => r.collaborateur_id) : undefined,
    };
    // Mémorisé en session : permet de revenir par le bouton du navigateur.
    try {
      sessionStorage.setItem(CLE_CONTEXTE, JSON.stringify(ctx));
    } catch { /* stockage indisponible : le fil d'Ariane reste opérant */ }
    navigate("/paie/traitement/calcul", {
      state: {
        restore: { collabId, annee, periodeId },
        returnTo: buildTrail({
          path: "/paie/traitement/lancement",
          label: "Lancement de la paie",
          state: { restore: ctx },
        }),
      },
    });
  };

  useEffect(() => {
    const opt = (rows: any[], v: string, l: string) => rows.map((r) => ({ value: r[v], label: r[l] ?? r[v] }));
    const aujourdhui = new Date().toISOString().slice(0, 10);
    Promise.allSettled([
      db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 }),
      // Rattachements actifs, pour ne garder que les plans ayant un effectif
      // réel (RG-LANCEMENT-PLAN-EFFECTIF-01) — un plan sans aucun
      // collaborateur rattaché n'a aucun intérêt à apparaître ici.
      db.list<any>("collaborateur_plan_paie", {
        archive: false, select: "plan_paie_id,date_debut,date_fin", limit: 5000,
      }),
      // UO hiérarchiques (26 lignes) et référentiel des postes (17 codes).
      // Les tables `organisations` et `postes` sont vides : elles ne sont plus alimentées.
      db.list<any>("unites_organisationnelles", { select: "id,libelle,parent_id", actif: true, order: "libelle", limit: 2000 }),
      db.list<any>("ref_poste", { select: "code,libelle", actif: true, order: "libelle", limit: 2000 }),
      db.list<any>("ref_type_contrat", { select: "code,libelle", limit: 200 }),
      db.list<any>("ref_statut_collaborateur", { select: "code,libelle", limit: 200 }),
      db.list<any>("ref_regime_cotisation", { select: "code,libelle", limit: 200 }),
      // RG-LOT-MATRICULES-01 : liste complète pour la sélection directe par matricule.
      db.list<any>("collaborateurs", { select: "id,matricule,nom,prenom", archive: false, order: "matricule", limit: 5000 }),
    ]).then((r) => {
      if (r[0].status === "fulfilled") {
        const rattachementsActifs = r[1].status === "fulfilled" ? r[1].value : [];
        const plansAvecEffectif = new Set(
          rattachementsActifs
            .filter((l: any) => l.date_debut <= aujourdhui && (!l.date_fin || l.date_fin >= aujourdhui))
            .map((l: any) => l.plan_paie_id),
        );
        const plansFiltres = r[1].status === "fulfilled"
          ? r[0].value.filter((p) => plansAvecEffectif.has(p.id))
          : r[0].value; // repli : si le chargement des rattachements échoue, ne pas masquer tous les plans
        setPlans(plansFiltres);
        // Ne pas écraser un plan déjà restauré (retour depuis le bulletin) :
        // ce chargement est asynchrone et se résout APRÈS l'effet de restauration.
        if (plansFiltres[0]) setPlanId((actuel) => actuel || plansFiltres[0].id);
      }
      // UO : aplaties en respectant la hiérarchie (parent avant enfants, indentées).
      if (r[2].status === "fulfilled") setOrgs(arbreUo(r[2].value));
      // Postes : la valeur est le CODE du référentiel, pas un UUID.
      if (r[3].status === "fulfilled") setPostes(opt(r[3].value, "code", "libelle"));
      if (r[4].status === "fulfilled") setTypesContrat(opt(r[4].value, "code", "libelle"));
      if (r[5].status === "fulfilled") setStatutsCollab(opt(r[5].value, "code", "libelle"));
      if (r[6].status === "fulfilled") setRegimes(opt(r[6].value, "code", "libelle"));
      if (r[7].status === "fulfilled") {
        setCollabsOpt(r[7].value.map((c: any) => ({ value: c.id, label: `${c.matricule} — ${c.nom} ${c.prenom}` })));
      }
    });
  }, []);

  // Restauration du contexte au retour depuis le bulletin individuel.
  //
  // Deux chemins de retour possibles : le fil d'Ariane (qui transmet
  // `location.state`) et le bouton « précédent » du navigateur (qui, lui, ne le
  // transmet PAS). On mémorise donc aussi le contexte en session : la page se
  // reconstitue quel que soit le chemin emprunté.
  // Vrai le temps d'une restauration : empêche l'effet [planId] d'effacer
  // les résultats qu'on vient de recharger.
  const restauration = useRef(false);

  useEffect(() => {
    let ctx = (location.state as any)?.restore as
      {
        planId?: string; annee?: number; periodeId?: string;
        orgSel?: string[]; posteSel?: string[]; typeSel?: string[];
        statutSel?: string[]; regimeSel?: string[]; matricule?: string;
        collaborateurIds?: string[];
      } | undefined;

    if (!ctx?.planId) {
      try {
        const brut = sessionStorage.getItem(CLE_CONTEXTE);
        if (brut) ctx = JSON.parse(brut);
      } catch { /* stockage indisponible : on ignore */ }
    }

    if (ctx?.planId) {
      restauration.current = true;
      setPlanId(ctx.planId);
      setPendingSel({ annee: ctx.annee, periodeId: ctx.periodeId });
      // Filtres de population : pas d'API pour les recharger, on les réapplique tels quels.
      if (ctx.orgSel) setOrgSel(ctx.orgSel);
      if (ctx.posteSel) setPosteSel(ctx.posteSel);
      if (ctx.typeSel) setTypeSel(ctx.typeSel);
      if (ctx.statutSel) setStatutSel(ctx.statutSel);
      if (ctx.regimeSel) setRegimeSel(ctx.regimeSel);
      if (ctx.matricule) setMatricule(ctx.matricule);
      // Les résultats ne sont pas sérialisés : on les RECHARGE depuis l'API,
      // seule source de vérité (elle reflète les validations entre-temps).
      // Restreint à la population du lancement quitté (collaborateurIds) :
      // sans ça, periode_id seul renverrait TOUS les bulletins de la période,
      // y compris ceux d'autres lancements/filtres.
      if (ctx.periodeId) setRestaurerBulletins({ periodeId: ctx.periodeId, collaborateurIds: ctx.collaborateurIds });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recharge la liste des bulletins de la période (et de la population d'origine) et reconstitue l'affichage
  const [restaurerBulletins, setRestaurerBulletins] = useState<{ periodeId: string; collaborateurIds?: string[] } | null>(null);
  useEffect(() => {
    if (!restaurerBulletins) return;
    (async () => {
      try {
        const bulletins = await listerBulletins({
          periode_id: restaurerBulletins.periodeId,
          collaborateur_ids: restaurerBulletins.collaborateurIds,
        });
        const resultats = bulletins.map((b) => ({
          collaborateur_id: b.collaborateur_id,
          matricule: b.matricule ?? null,
          nom: null,
          net_a_payer: b.net_a_payer,
          a_erreur: b.a_erreur,
          message: null,
          origine: b.origine,
        }));
        setResultat({
          nb_total: bulletins.length,
          nb_ok: bulletins.filter((b) => !b.a_erreur).length,
          nb_erreur: bulletins.filter((b) => b.a_erreur).length,
          nb_ignores: 0,
          total_net: bulletins.reduce((s, b) => s + Number(b.net_a_payer || 0), 0),
          total_cout: bulletins.reduce((s, b) => s + Number(b.cout_employeur || 0), 0),
          resultats: resultats as any,
        });
      } catch (e: any) {
        // Ne plus avaler l'erreur en silence : sinon l'écran reste vide sans le moindre indice.
        toast.error("Impossible de recharger la paie calculée", { description: e?.message });
      }
      finally { setRestaurerBulletins(null); }
    })();
  }, [restaurerBulletins]);

  useEffect(() => {
    if (!planId) return;
    db.list<Periode>("calendrier_paie", { plan_paie_id: planId, select: "id,annee,mois,statut,date_ouverture", order: "-annee", limit: 1000 })
      .then((ps) => {
        ps.sort((a, b) => a.annee - b.annee || a.mois - b.mois);
        setPeriodes(ps);
        const annees = Array.from(new Set(ps.map((p) => p.annee))).sort((a, b) => b - a);
        const an = (pendingSel?.annee && annees.includes(pendingSel.annee)) ? pendingSel.annee : (annees[0] ?? null);
        setAnnee(an);
        const dans = ps.filter((p) => p.annee === an);
        const today = new Date().toISOString().slice(0, 10);
        const ouvertes = dans.filter((p) => p.statut !== "CLOTUREE" && (!p.date_ouverture || p.date_ouverture <= today));
        const per = (pendingSel?.periodeId && dans.some((p) => p.id === pendingSel.periodeId))
          ? pendingSel.periodeId
          : ((ouvertes[0] || dans[0])?.id) || "";
        setPeriodeId(per);
        setPendingSel(null);
      })
      .catch((e) => toast.error("Chargement des périodes impossible", { description: e.message }));

    // Changer de plan invalide les résultats affichés — SAUF pendant une
    // restauration : l'effet de retour vient justement de poser ce plan et de
    // recharger les bulletins ; les effacer ici rendrait la page vide.
    if (!restauration.current) {
      setPopulation(null); setResultat(null); setValidation(null); setSelection(new Set());
    }
    restauration.current = false;
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  const anneesDispo = useMemo(() => Array.from(new Set(periodes.map((p) => p.annee))).sort((a, b) => b - a), [periodes]);
  const periodesAnnee = useMemo(() => periodes.filter((p) => p.annee === annee), [periodes, annee]);
  const _today = new Date().toISOString().slice(0, 10);
  const estOuverte = (p?: Periode) => !!p && p.statut !== "CLOTUREE" && (!p.date_ouverture || p.date_ouverture <= _today);
  const periodeSel = periodes.find((p) => p.id === periodeId);
  const periodeOuverte = estOuverte(periodeSel);

  // RG-LOT-MATRICULES-01 : pas d'annotation de retour stricte (: PopulationFiltres)
  // ici volontairement — collaborateur_ids n'est peut-être pas déclaré dans ce
  // type (fichier paieApi.ts non disponible pour vérifier), et ce champ est
  // déjà utilisé avec succès en production via le même motif de spread non
  // typé dans valider()/devalider() (`{...filtres(), collaborateur_ids: [...]}`).
  const nbFiltresActifs = orgSel.length + posteSel.length + typeSel.length + statutSel.length
    + regimeSel.length + matriculesSel.length + (matricule.trim() ? 1 : 0);

  const filtres = () => {
    const base: PopulationFiltres = {
      unite_ids: orgSel, codes_poste: posteSel, types_contrat: typeSel,
      statuts_collaborateur: statutSel, regimes: regimeSel,
      matricule: matricule.trim() || null,
    };
    return matriculesSel.length ? { ...base, collaborateur_ids: matriculesSel } : base;
  };

  const changerAnnee = (an: number) => {
    setAnnee(an);
    const dans = periodes.filter((p) => p.annee === an);
    setPeriodeId(((dans.find((p) => p.statut === "OUVERTE") || dans[0])?.id) || "");
  };

  async function apercu() {
    if (!planId || !periodeId) return;
    setBusy("apercu"); setResultat(null);
    try {
      setPopulation(await apercuPopulation(planId, periodeId, filtres()));
    } catch (e: any) {
      toast.error("Aperçu impossible", { description: e.message });
    } finally { setBusy(null); }
  }

  async function lancer() {
    if (!planId || !periodeId) return;
    setBusy("lancer"); setValidation(null);
    try {
      const res = await calculerLot(planId, periodeId, filtres(), true);
      setResultat(res);
      const details = [
        res.nb_erreur ? `${res.nb_erreur} en erreur` : null,
        res.nb_ignores ? `${res.nb_ignores} déjà validé(s), non recalculé(s)` : null,
      ].filter(Boolean).join(" · ");
      toast.success(`Paie lancée : ${res.nb_ok} bulletin(s) calculé(s)`, {
        description: details || undefined,
      });
    } catch (e: any) {
      toast.error("Lancement impossible", { description: e.message });
    } finally { setBusy(null); }
  }

  async function valider(forcer: boolean) {
    if (!planId || !periodeId) return;
    setBusy("valider");
    try {
      // Sélection explicite → on ne valide que ces collaborateurs.
      // Sélection vide → toute la population filtrée (comportement d'origine).
      const cibles = selection.size
        ? { ...filtres(), collaborateur_ids: [...selection] }
        : filtres();
      const res = await validerLot(planId, periodeId, cibles, forcer);
      setValidation(res);
      const total = res.nb_valides + res.nb_deja_valide;
      if (res.nb_valides > 0 && res.nb_bloques === 0 && res.nb_alertes === 0) {
        toast.success(
          res.nb_deja_valide > 0
            ? `${res.nb_valides} bulletin(s) validé(s) à l'instant (${total} validé(s) au total sur la période)`
            : `${res.nb_valides} bulletin(s) validé(s)`,
        );
      } else if (res.nb_alertes > 0 && !forcer) {
        toast.warning(`${res.nb_alertes} bulletin(s) en alerte — confirmer pour valider`);
      } else if (res.nb_bloques > 0) {
        toast.error(`${res.nb_bloques} bulletin(s) bloqué(s) par un contrôle`);
      } else {
        toast.success(`Validation : ${res.nb_valides} validé(s)${res.nb_deja_valide > 0 ? ` (+ ${res.nb_deja_valide} déjà validé(s) avant)` : ""}`);
      }
    } catch (e: any) {
      toast.error("Validation impossible", { description: e.message });
    } finally { setBusy(null); }
  }

  // RG-LOT-DEVALIDATION-01 : dévalidation en masse — même logique de ciblage
  // que valider() (sélection explicite sinon toute la population filtrée),
  // mais agrégée côté client : on relit l'état RÉEL des bulletins (jamais
  // celui, potentiellement obsolète, déjà en mémoire dans `resultat`) puis on
  // dévalide un par un ceux effectivement VALIDE (les TEMP n'ont rien à
  // dévalider ; les HISTORIQUE — période clôturée — nécessitent une
  // réouverture de période au préalable, faite depuis l'écran individuel).
  async function devalider() {
    if (!planId || !periodeId) return;
    const cibleIds = selection.size ? [...selection] : (resultat?.resultats.map((r) => r.collaborateur_id) ?? []);
    if (!cibleIds.length) return;
    if (!confirm(
      selection.size
        ? `Dévalider ${selection.size} bulletin(s) sélectionné(s) ? Ils repasseront en temporaire.`
        : `Dévalider tous les bulletins validés de cette population ? Ils repasseront en temporaire.`
    )) return;

    setBusy("devalider"); setDevalidation(null);
    try {
      const bulletins = await listerBulletins({ periode_id: periodeId, collaborateur_ids: cibleIds });
      const aValider = bulletins.filter((b) => b.origine === "VALIDE");
      const nbIgnores = bulletins.length - aValider.length;
      let nbOk = 0;
      const erreurs: string[] = [];
      for (const b of aValider) {
        try {
          await devaliderBulletin(b.id);
          nbOk++;
        } catch (e: any) {
          erreurs.push(`${b.matricule ?? b.collaborateur_id} : ${e.message}`);
        }
      }
      setDevalidation({ nb_ok: nbOk, nb_echec: erreurs.length, nb_ignores: nbIgnores, erreurs });
      if (erreurs.length === 0) {
        toast.success(`${nbOk} bulletin(s) dévalidé(s)`, {
          description: nbIgnores ? `${nbIgnores} déjà non validé(s), ignoré(s).` : undefined,
        });
      } else {
        toast.error(`${nbOk} dévalidé(s), ${erreurs.length} échec(s)`);
      }
      // L'origine a changé pour ceux dévalidés : on recharge pour refléter l'état réel.
      setRestaurerBulletins({ periodeId, collaborateurIds: cibleIds });
    } catch (e: any) {
      toast.error("Dévalidation impossible", { description: e.message });
    } finally { setBusy(null); }
  }

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lancement de la paie</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calcule la paie de toute la population d'un plan, ou d'une population filtrée, pour une période.
        </p>
      </div>

      {/* Plan / période + population ciblée — une seule carte compacte :
          la ligne du haut (toujours visible) suffit pour l'immense majorité
          des lancements (toute la population, sans filtre). Les filtres
          détaillés se déplient à la demande (RG-LANCEMENT-COMPACT-01). */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 w-[220px]">
              <label className="text-xs font-medium text-muted-foreground">Plan de paie</label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-[100px]">
              <label className="text-xs font-medium text-muted-foreground">Année</label>
              <Select value={annee ? String(annee) : ""} onValueChange={(v) => changerAnnee(Number(v))} disabled={!anneesDispo.length}>
                <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {anneesDispo.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-[190px]">
              <label className="text-xs font-medium text-muted-foreground">Période</label>
              <Select value={periodeId} onValueChange={setPeriodeId} disabled={!annee}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>
                  {periodesAnnee.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {MOIS[p.mois]} {p.annee}{!estOuverte(p)
                        ? <span style={{ color: "hsl(var(--warning))" }}> · {p.statut === "CLOTUREE" ? "clôturée" : "non ouverte"}</span>
                        : p.statut !== "OUVERTE" && <span className="text-muted-foreground"> · {p.statut.toLowerCase()}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <button
              onClick={() => setFiltresOuverts((v) => !v)}
              className="h-9 inline-flex items-center gap-1.5 px-3 rounded-md border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Filter className="h-3.5 w-3.5" /> Filtres
              {nbFiltresActifs > 0 && <Badge variant="secondary" className="ml-0.5 h-5 px-1.5">{nbFiltresActifs}</Badge>}
              {filtresOuverts ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>

            <div className="flex items-center gap-2 ml-auto">
              {population && !resultat && (
                <span className="text-sm text-muted-foreground mr-1">
                  <Badge variant="secondary" className="mr-1.5">{population.length}</Badge> ciblé(s)
                </span>
              )}
              <Button size="sm" variant="outline" onClick={apercu} disabled={!planId || !periodeId || !periodeOuverte || !!busy}>
                {busy === "apercu" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                Aperçu
              </Button>
              <Button size="sm" onClick={lancer} disabled={!planId || !periodeId || !periodeOuverte || !!busy}>
                {busy === "lancer" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Lancer la paie
              </Button>
            </div>
          </div>

          {periodeId && !periodeOuverte && (
            <div
              className="flex items-center gap-2 text-sm rounded px-3 py-2 mt-3"
              style={{ color: "hsl(var(--warning))", background: "hsl(var(--warning) / 0.08)", border: "1px solid hsl(var(--warning) / 0.3)" }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Cette période n'est pas ouverte au traitement{periodeSel?.date_ouverture ? ` (ouverture le ${periodeSel.date_ouverture})` : ""}.
            </div>
          )}

          {filtresOuverts && (
            <div className="mt-4 pt-4 border-t grid gap-3 md:grid-cols-4">
              <MultiSelect label="Organisation / UO" options={orgs} value={orgSel} onChange={setOrgSel} />
              <MultiSelect label="Poste" options={postes} value={posteSel} onChange={setPosteSel} />
              <MultiSelect label="Type de contrat" options={typesContrat} value={typeSel} onChange={setTypeSel} />
              <MultiSelect label="Statut collaborateur" options={statutsCollab} value={statutSel} onChange={setStatutSel} />
              <MultiSelect label="Régime de cotisation" options={regimes} value={regimeSel} onChange={setRegimeSel} />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Matricule (contient)</label>
                <Input value={matricule} onChange={(e) => setMatricule(e.target.value)} placeholder="ex. 000" />
              </div>
              <MultiSelect label="Matricules (sélection directe)" options={collabsOpt} value={matriculesSel} onChange={setMatriculesSel} placeholder="Tous" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aperçu population */}
      {population && !resultat && population.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[280px]">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Matricule</TableHead><TableHead>Collaborateur</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {population.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => voirBulletin(c.id)} title="Cliquez pour visualiser le bulletin">
                      <TableCell className="text-primary font-medium hover:underline">{c.matricule}</TableCell>
                      <TableCell className="font-medium">{c.nom} {c.prenom}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Récapitulatif du lot */}
      {resultat && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Bulletins calculés" value={`${resultat.nb_ok}/${resultat.nb_total}`} />
            <Stat label="En erreur" value={String(resultat.nb_erreur)} danger={resultat.nb_erreur > 0} />
            {!!resultat.nb_ignores && (
              <Stat label="Déjà validés" value={String(resultat.nb_ignores)} />
            )}
            <Stat label="Total net à payer" value={`${fmt(resultat.total_net)} DH`} />
            <Stat label="Coût employeur" value={`${fmt(resultat.total_cout)} DH`} />
          </div>

          {/* Processus : la paie lancée est temporaire → validation → historisation */}
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5"
            style={{ background: "hsl(var(--warning) / 0.06)", borderColor: "hsl(var(--warning) / 0.3)" }}
          >
            <span
              className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
            >
              Paie temporaire
            </span>
            <span className="text-sm text-muted-foreground">
              {selection.size
                ? `${selection.size} bulletin(s) sélectionné(s) — seuls ceux-ci seront validés.`
                : "Validez pour figer les bulletins (l'action est historisée). Cochez des lignes pour n'en valider qu'une partie."}
            </span>
            {selection.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelection(new Set())} disabled={!!busy}>
                Tout désélectionner
              </Button>
            )}
            <Button variant="outline" onClick={devalider} disabled={!!busy || resultat.nb_total === 0}>
              {busy === "devalider" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {selection.size ? `Dévalider la sélection (${selection.size})` : "Dévalider tout"}
            </Button>
            <Button className="ml-auto" onClick={() => valider(false)} disabled={!!busy || resultat.nb_total === 0}>
              {busy === "valider" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {selection.size ? `Valider la sélection (${selection.size})` : "Valider la paie"}
            </Button>
          </div>

          {/* Récapitulatif de dévalidation */}
          {devalidation && (
            <Card style={{ borderColor: "hsl(var(--warning) / 0.4)" }}>
              <CardContent className="pt-5 space-y-2">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4" style={{ color: "hsl(var(--warning))" }} /> {devalidation.nb_ok} dévalidé(s)
                  </span>
                  {devalidation.nb_ignores > 0 && (
                    <span className="text-muted-foreground">{devalidation.nb_ignores} déjà non validé(s) (ignoré(s))</span>
                  )}
                  {devalidation.nb_echec > 0 && (
                    <span className="inline-flex items-center gap-1.5" style={{ color: "hsl(var(--destructive))" }}>
                      <XCircle className="h-4 w-4" /> {devalidation.nb_echec} échec(s)
                    </span>
                  )}
                </div>
                {devalidation.erreurs.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
                    {devalidation.erreurs.slice(0, 12).map((msg, i) => <div key={i}>{msg}</div>)}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Récapitulatif de validation */}
          {validation && (
            <Card style={{ borderColor: "hsl(var(--success) / 0.35)" }}>
              <CardContent className="pt-5 space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5" style={{ color: "hsl(var(--success))" }}>
                    <CheckCircle2 className="h-4 w-4" /> {validation.nb_valides} validé(s)
                  </span>
                  {validation.nb_deja_valide > 0 && (
                    <span className="text-muted-foreground">
                      + {validation.nb_deja_valide} déjà validé(s) avant = <b className="text-foreground">{validation.nb_valides + validation.nb_deja_valide}</b> au total
                    </span>
                  )}
                  {validation.nb_alertes > 0 && (
                    <span className="inline-flex items-center gap-1.5" style={{ color: "hsl(var(--warning))" }}>
                      <AlertTriangle className="h-4 w-4" /> {validation.nb_alertes} en alerte
                    </span>
                  )}
                  {validation.nb_bloques > 0 && (
                    <span className="inline-flex items-center gap-1.5" style={{ color: "hsl(var(--destructive))" }}>
                      <XCircle className="h-4 w-4" /> {validation.nb_bloques} bloqué(s)
                    </span>
                  )}
                  {validation.nb_sans_bulletin > 0 && <span className="text-muted-foreground">{validation.nb_sans_bulletin} sans bulletin</span>}
                  {validation.nb_alertes > 0 && (
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => valider(true)} disabled={!!busy}>
                      {busy === "valider" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      Valider malgré les alertes
                    </Button>
                  )}
                </div>
                {(validation.nb_bloques > 0 || validation.nb_alertes > 0) && (
                  <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
                    {validation.resultats.filter((r) => r.statut === "BLOQUE" || r.statut === "ALERTE").slice(0, 12).map((r) => (
                      <div key={r.collaborateur_id}>
                        <span
                          className="font-medium"
                          style={{ color: r.statut === "BLOQUE" ? "hsl(var(--destructive))" : "hsl(var(--warning))" }}
                        >
                          {r.matricule} {r.nom}
                        </span>
                        {" — "}{r.message}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="p-0">
              <div className="px-1 pb-2 text-xs text-muted-foreground">
                {resultatsTries.length} collaborateur(s) — faites défiler pour tout voir.
                {selection.size > 0 && ` · ${selection.size} sélectionné(s)`}
              </div>
              <ScrollArea className="max-h-[70vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[44px]">
                        <Checkbox checked={tousCoches} onCheckedChange={(v) => toutCocher(!!v)}
                          aria-label="Tout sélectionner" />
                      </TableHead>
                      <TableHead className="w-[44px]" />
                      <TableHead onClick={() => toggleSort("matricule")} className="cursor-pointer select-none hover:text-foreground">
                        Matricule <SortIcon column="matricule" />
                      </TableHead>
                      <TableHead onClick={() => toggleSort("nom")} className="cursor-pointer select-none hover:text-foreground">
                        Collaborateur <SortIcon column="nom" />
                      </TableHead>
                      <TableHead onClick={() => toggleSort("net_a_payer")} className="cursor-pointer select-none hover:text-foreground text-right">
                        Net à payer <SortIcon column="net_a_payer" />
                      </TableHead>
                      <TableHead>Remarque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultatsTries.map((r) => (
                      <TableRow
                        key={r.collaborateur_id}
                        className="cursor-pointer hover:bg-muted/50"
                        style={r.a_erreur ? { background: "hsl(var(--destructive) / 0.05)" } : undefined}
                        onClick={() => voirBulletin(r.collaborateur_id)}
                        title="Cliquez pour visualiser le bulletin"
                      >
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selection.has(r.collaborateur_id)}
                            onCheckedChange={() => basculer(r.collaborateur_id)}
                            aria-label={`Sélectionner ${r.matricule}`}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          {r.a_erreur
                            ? <XCircle className="h-4 w-4 inline" style={{ color: "hsl(var(--destructive))" }} />
                            : <CheckCircle2 className="h-4 w-4 inline" style={{ color: "hsl(var(--success))" }} />}
                        </TableCell>
                        <TableCell className="text-primary font-medium hover:underline">{r.matricule}</TableCell>
                        <TableCell className="font-medium">{r.nom}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.net_a_payer != null ? fmt(r.net_a_payer) : ""}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate" title={r.message ?? ""}>{r.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card style={danger ? { borderColor: "hsl(var(--destructive) / 0.35)", background: "hsl(var(--destructive) / 0.05)" } : undefined}>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums" style={danger ? { color: "hsl(var(--destructive))" } : undefined}>{value}</div>
      </CardContent>
    </Card>
  );
}
