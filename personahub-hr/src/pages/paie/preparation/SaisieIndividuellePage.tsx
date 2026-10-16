/**
 * SaisieIndividuellePage — Gestion des Éléments Variables d'un collaborateur
 * pour une période de paie (saisie unitaire, à la ligne).
 * Modèle (migration 46) : element_variable (code_rubrique, valeur_base,
 * valeur_nombre, valeur_taux, valeur_montant, type, source, validité,
 * statut). Un EV = une ligne, avec une colonne dédiée par grandeur (au moins
 * une renseignée) — plus de colonne attribut/sens : le signe est porté
 * directement par la valeur saisie (un nombre négatif se tape "-500").
 * Le moteur ne consomme que les EV au statut VALIDE.
 * Auteur : Adil DAIA
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/api";
import { useFormatMasks, formatNumberWith, formatMoneyWith, formatDateWith, type FormatMasks, type DateMask } from "@/hooks/useFormatMasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, Loader2, CheckCircle2, AlertTriangle, Check, ChevronsUpDown, Calendar } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Collab = { id: string; matricule: string; nom: string; prenom: string };
type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; statut: string; date_ouverture: string | null; plan_paie_id: string; date_debut: string; date_fin: string };
type Rubrique = {
  code: string; libelle: string;
  v_ajout: boolean; v_forcage: boolean; v_regularisation: boolean;
  v_annulation: boolean; v_reprise: boolean;
};

// RG-EV-AUTORISATION : type d'EV -> colonne d'autorisation sur la rubrique
const AUTORISATION: Record<string, keyof Rubrique> = {
  AJOUT: "v_ajout", FORCAGE: "v_forcage", REGULARISATION: "v_regularisation",
  ANNULATION: "v_annulation", REPRISE: "v_reprise",
};
const estSaisissable = (r: Rubrique) =>
  r.v_ajout || r.v_forcage || r.v_regularisation || r.v_annulation || r.v_reprise;
type Ref = { code: string; libelle: string };

interface EV {
  id?: string;
  code_rubrique: string;
  valeur_base: string;
  valeur_nombre: string;
  valeur_taux: string;
  valeur_montant: string;
  code_type: string;
  code_source: string;
  date_debut: string | null;
  date_fin: string | null;
  statut: string;
  motif: string | null;
  _new?: boolean;
  _dirty?: boolean;
}

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// Style "cellule de liste dense" (façon Odoo) : invisible au repos, ne se
// révèle qu'au survol/focus — donne l'impression d'un tableur plutôt que
// d'un formulaire empilé. Toutes les couleurs viennent des variables CSS du
// thème (bordure, fond, accent) donc respectent les préférences d'apparence
// choisies par chaque utilisateur, aucune couleur codée en dur.
const CELL_INPUT = "h-8 text-xs border-transparent bg-transparent hover:border-border focus-visible:bg-background focus-visible:border-[hsl(var(--accent))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--accent)/0.3)] transition-colors";
// Reconstruit une date ISO ("AAAA-MM-JJ") à partir d'une saisie texte et du
// masque configuré (ex. "DD/MM/YYYY"), en générant dynamiquement la regex de
// parsing depuis le masque lui-même — fonctionne pour les 9 masques proposés
// par FormatMasksSettings sans logique dédiée par format. Retourne null si la
// saisie ne correspond pas au masque ou décrit une date invalide.
function parseDateAvecMasque(saisie: string, masque: DateMask): string | null {
  const troncons = masque.split(/(DD|MM|YYYY|YY)/).filter(Boolean);
  let pattern = "^";
  troncons.forEach((t) => {
    if (t === "DD" || t === "MM") pattern += "(\\d{1,2})";
    else if (t === "YYYY") pattern += "(\\d{4})";
    else if (t === "YY") pattern += "(\\d{2})";
    else pattern += t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // séparateur littéral échappé
  });
  pattern += "$";
  const m = saisie.trim().match(new RegExp(pattern));
  if (!m) return null;
  let jour = "", mois = "", annee = "";
  let idx = 1;
  troncons.forEach((t) => {
    if (t === "DD") jour = m[idx++].padStart(2, "0");
    else if (t === "MM") mois = m[idx++].padStart(2, "0");
    else if (t === "YYYY") annee = m[idx++];
    else if (t === "YY") annee = String(2000 + parseInt(m[idx++], 10));
  });
  if (!jour || !mois || !annee) return null;
  const iso = `${annee}-${mois}-${jour}`;
  // RG-DATECELL-UTC-01 (Adil DAIA) : NE PAS valider via `new Date(iso+"T00:00:00")`
  // puis `.toISOString()` — ce round-trip passe par l'heure LOCALE de la
  // machine, et le Maroc change de décalage selon la période de l'année
  // (UTC+1 la majeure partie du temps, UTC+0 sur la fenêtre du Ramadan).
  // Minuit local un jour où le décalage est UTC+1 devient 23h la veille en
  // UTC — `toISOString().slice(0,10)` renvoyait alors la mauvaise date, et
  // une saisie parfaitement valide (ex. "31/12/2026") était rejetée en
  // silence selon la date du jour testée et le fuseau du poste. Construire
  // et valider entièrement en UTC (Date.UTC + getUTC*) élimine toute
  // dépendance au fuseau horaire de la machine.
  const d = new Date(Date.UTC(Number(annee), Number(mois) - 1, Number(jour)));
  if (isNaN(d.getTime()) || d.getUTCFullYear() !== Number(annee)
      || d.getUTCMonth() !== Number(mois) - 1 || d.getUTCDate() !== Number(jour)) return null; // rejette ex. 31/02
  return iso;
}

// Cellule date respectant le masque configuré (ex. "31/12/2026" au lieu du
// "2026-12-31" imposé par <input type="date">, contrainte HTML native
// incontournable). Saisie texte au masque, calendrier natif du navigateur
// accessible via l'icône (input type=date invisible synchronisé, ouvert par
// showPicker() quand disponible, sinon focus() en repli).
const DateCell: React.FC<{
  value: string | null; onChange: (v: string | null) => void; disabled?: boolean; masks: FormatMasks; title?: string;
}> = ({ value, onChange, disabled, masks, title }) => {
  const [edition, setEdition] = useState<string | null>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const affichage = edition !== null ? edition : (value ? formatDateWith(value, masks) : "");

  const ouvrirCalendrier = () => {
    if (disabled) return;
    const el = hiddenRef.current;
    if (!el) return;
    if (typeof (el as any).showPicker === "function") { try { (el as any).showPicker(); return; } catch { /* repli ci-dessous */ } }
    el.focus();
  };

  return (
    <div className="relative flex items-center">
      <Input
        type="text" inputMode="numeric" disabled={disabled} title={title}
        value={affichage} placeholder={masks.dateMask.toLowerCase()}
        onFocus={() => setEdition(value ? formatDateWith(value, masks) : "")}
        onChange={(e) => setEdition(e.target.value)}
        onBlur={() => {
          if (edition !== null) {
            if (edition.trim() === "") onChange(null);
            else {
              const iso = parseDateAvecMasque(edition, masks.dateMask);
              if (iso) onChange(iso);
              // Saisie invalide (ex. "32/13") : ignorée, l'ancienne valeur reste affichée.
            }
          }
          setEdition(null);
        }}
        className={`${CELL_INPUT} pr-6`}
      />
      <button type="button" tabIndex={-1} disabled={disabled} onClick={ouvrirCalendrier}
        className="absolute right-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
        <Calendar size={12} />
      </button>
      <input
        ref={hiddenRef} type="date" tabIndex={-1} disabled={disabled}
        value={value || ""} onChange={(e) => onChange(e.target.value || null)}
        className="absolute opacity-0 w-4 h-4 pointer-events-none"
      />
    </div>
  );
};

const CELL_SELECT = "w-full h-8 px-1.5 rounded border border-transparent bg-transparent text-xs hover:border-border focus:border-[hsl(var(--accent))] focus:bg-background outline-none transition-colors disabled:opacity-50";

// Cellule numérique respectant les masques d'affichage paramétrés (séparateurs
// de milliers/décimale, devise) : affiche la valeur formatée au repos, bascule
// sur la valeur brute éditable au focus (impossible de taper directement dans
// un champ déjà formaté "4 000,00"), puis reformate au blur. La valeur stockée
// en state (celle transmise à onChange) reste toujours un nombre "propre"
// (séparateur décimal ".") pour rester compatible avec Number(...) ailleurs.
const NumberCell: React.FC<{
  value: string; onChange: (v: string) => void; disabled?: boolean; masks: FormatMasks; money?: boolean;
}> = ({ value, onChange, disabled, masks, money }) => {
  const [edition, setEdition] = useState<string | null>(null);
  const affichage = edition !== null
    ? edition
    : (value.trim() === "" ? "" : (money ? formatMoneyWith(value, masks) : formatNumberWith(value, masks)));
  return (
    <Input
      type="text" inputMode="decimal" disabled={disabled}
      value={affichage}
      onFocus={() => setEdition(value)}
      onChange={(e) => setEdition(e.target.value)}
      onBlur={() => {
        if (edition !== null) {
          const normalise = edition.trim().replace(/\s/g, "").replace(masks.decimalSep, ".");
          onChange(normalise);
        }
        setEdition(null);
      }}
      className={`${CELL_INPUT} text-right tabular-nums`} placeholder="—"
    />
  );
};

const ligneVide = (): EV => ({
  code_rubrique: "", valeur_base: "", valeur_nombre: "", valeur_taux: "", valeur_montant: "0",
  code_type: "AJOUT", code_source: "SAISIE", date_debut: null, date_fin: null,
  statut: "SAISI", motif: null, _new: true, _dirty: true,
});

const SaisieIndividuellePage: React.FC = () => {
  const { formatDate, masks } = useFormatMasks();
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [types, setTypes] = useState<Ref[]>([]);
  const [sources, setSources] = useState<Ref[]>([]);

  const [collabId, setCollabId] = useState("");
  const [planId, setPlanId] = useState("");
  const [periodeId, setPeriodeId] = useState("");
  const [collabOpen, setCollabOpen] = useState(false);

  const [lignes, setLignes] = useState<EV[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Référentiels
  useEffect(() => {
    db.list<Collab>("collaborateurs", { archive: false, select: "id,matricule,nom,prenom", order: "matricule", limit: 5000 }).then(setCollabs).catch(() => {});
    db.list<Plan>("plan_paie", { actif: true, select: "id,code,libelle", order: "code", limit: 200 }).then((p) => { setPlans(p); if (p[0]) setPlanId((x) => x || p[0].id); }).catch(() => {});
    db.list<Rubrique>("rubrique_paie", { archive: false, order: "code", limit: 2000,
      select: "code,libelle,v_ajout,v_forcage,v_regularisation,v_annulation,v_reprise" })
      .then((rs) => setRubriques(rs.filter(estSaisissable))).catch(() => {});
    db.list<Ref>("ref_ev_type", { actif: true, select: "code,libelle", order: "ordre", limit: 100 }).then(setTypes).catch(() => {});
    db.list<Ref>("ref_ev_source", { actif: true, select: "code,libelle", order: "ordre", limit: 100 }).then(setSources).catch(() => {});
  }, []);

  // Une période est ouverte si non clôturée et si sa date d'ouverture est atteinte
  const periodeEstOuverte = (p: Periode) => {
    if (p.statut === "CLOTUREE" || p.statut === "FERMEE") return false;
    if (p.date_ouverture && p.date_ouverture > new Date().toISOString().slice(0, 10)) return false;
    return true;
  };


  // Périodes du plan : tri chronologique ASCENDANT, présélection de la 1re OUVERTE
  useEffect(() => {
    if (!planId) return;
    db.list<Periode>("calendrier_paie", { plan_paie_id: planId, select: "id,annee,mois,statut,date_ouverture,plan_paie_id,date_debut,date_fin", limit: 1000 })
      .then((ps) => {
        ps.sort((a, b) => a.annee - b.annee || a.mois - b.mois);
        setPeriodes(ps);
        const premiereOuverte = ps.find(periodeEstOuverte);
        setPeriodeId((x) => (x && ps.some((p) => p.id === x) ? x : (premiereOuverte?.id || ps[0]?.id || "")));
      }).catch(() => setPeriodes([]));
  }, [planId]);

  // Chargement des EV
  const charger = async () => {
    if (!collabId || !periodeId) { setLignes([]); return; }
    setLoading(true);
    try {
      const p = periodes.find((x) => x.id === periodeId);
      // RG-EV-VALIDITE-MULTIPERIODE-01 (Adil DAIA) : un EV dont l'intervalle
      // de validité (date_debut/date_fin) déborde de sa période de création
      // doit rester visible dans toute période que cet intervalle recouvre —
      // pas seulement dans celle où il a été saisi à l'origine. On charge
      // donc tous les EV du collaborateur (pas de filtre periode_id côté
      // requête) et on filtre côté client par chevauchement de dates.
      // Un EV SANS dates reste rattaché à sa seule période de création,
      // faute d'autre critère pour le positionner ("couvre toute la période").
      const evs = await db.list<any>("element_variable", {
        collaborateur_id: collabId, select: "*", order: "created_at", limit: 2000,
      });
      const visibles = p
        ? evs.filter((e) => {
            if (!e.date_debut && !e.date_fin) return e.periode_id === periodeId;
            if (e.date_debut && e.date_debut > p.date_fin) return false;
            if (e.date_fin && e.date_fin < p.date_debut) return false;
            return true;
          })
        : evs.filter((e) => e.periode_id === periodeId);
      setLignes(visibles.map((e) => ({
        id: e.id, code_rubrique: e.code_rubrique,
        valeur_base: e.valeur_base != null ? String(e.valeur_base) : "",
        valeur_nombre: e.valeur_nombre != null ? String(e.valeur_nombre) : "",
        valeur_taux: e.valeur_taux != null ? String(e.valeur_taux) : "",
        valeur_montant: e.valeur_montant != null ? String(e.valeur_montant) : "",
        code_type: e.code_type,
        code_source: e.code_source, date_debut: e.date_debut, date_fin: e.date_fin,
        statut: e.statut, motif: e.motif,
      })));
    } catch (e: any) {
      toast({ title: "Erreur de chargement", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };
  useEffect(() => { charger(); /* eslint-disable-next-line */ }, [collabId, periodeId]);

  const periode = periodes.find((p) => p.id === periodeId);
  const periodeOuverte = useMemo(() => (periode ? periodeEstOuverte(periode) : false), [periode]);

  const patch = (idx: number, p: Partial<EV>) =>
    setLignes((L) => L.map((l, i) => (i === idx ? { ...l, ...p, _dirty: true } : l)));

  const ajouter = () => setLignes((L) => [...L, ligneVide()]);

  const supprimer = async (idx: number) => {
    const l = lignes[idx];
    if (l.id) {
      if (!confirm("Supprimer cet élément variable ?")) return;
      try { await db.remove("element_variable", { id: l.id }); } catch (e: any) {
        toast({ title: "Erreur", description: e.message, variant: "destructive" }); return;
      }
    }
    setLignes((L) => L.filter((_, i) => i !== idx));
    toast({ title: "Élément supprimé" });
  };

  const enregistrer = async () => {
    if (!collabId || !periodeId) { toast({ title: "Sélectionnez un collaborateur et une période", variant: "destructive" }); return; }
    const invalides = lignes.filter((l) => !l.code_rubrique.trim());
    if (invalides.length) { toast({ title: "Rubrique obligatoire", description: `${invalides.length} ligne(s) sans rubrique.`, variant: "destructive" }); return; }
    // Garde-fou : au moins une grandeur (Base/Nombre/Taux/Montant) par ligne
    // (miroir de la contrainte CHECK element_variable_au_moins_une_valeur).
    const sansValeur = lignes.filter((l) =>
      [l.valeur_base, l.valeur_nombre, l.valeur_taux, l.valeur_montant].every((v) => v.trim() === ""));
    if (sansValeur.length) {
      toast({ title: "Valeur obligatoire",
              description: `${sansValeur.length} ligne(s) sans aucune grandeur renseignée (Base/Nombre/Taux/Montant).`,
              variant: "destructive" });
      return;
    }
    // Garde-fou : chaque ligne doit utiliser un type autorisé sur sa rubrique (RG-EV-AUTORISATION)
    const nonAutorisees = lignes.filter((l) => l.code_rubrique && !typesPour(l.code_rubrique).some((t) => t.code === l.code_type));
    if (nonAutorisees.length) {
      toast({ title: "Type non autorisé",
              description: `${nonAutorisees.length} ligne(s) utilisent un type interdit sur leur rubrique.`,
              variant: "destructive" });
      return;
    }

    setSaving(true);
    // RG-EV-VALIDITE : à défaut de saisie, la validité couvre toute la période de paie.
    const vD = (d: string | null) => d || periode?.date_debut || null;
    const vF = (d: string | null) => d || periode?.date_fin || null;
    // Chaîne vide -> NULL (grandeur non concernée), sinon nombre signé direct
    // (plus de colonne `sens` séparée : "-500" se tape tel quel).
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    try {
      const aCreer = lignes.filter((l) => l._new && l._dirty);
      const aMaj = lignes.filter((l) => !l._new && l._dirty && l.id);

      if (aCreer.length) {
        await db.create("element_variable", aCreer.map((l) => ({
          collaborateur_id: collabId, periode_id: periodeId,
          code_rubrique: l.code_rubrique,
          valeur_base: num(l.valeur_base), valeur_nombre: num(l.valeur_nombre),
          valeur_taux: num(l.valeur_taux), valeur_montant: num(l.valeur_montant),
          code_type: l.code_type, code_source: l.code_source,
          date_debut: vD(l.date_debut), date_fin: vF(l.date_fin),
          statut: l.statut, motif: l.motif || null,
        })));
      }
      for (const l of aMaj) {
        await db.update("element_variable", { id: l.id! }, {
          code_rubrique: l.code_rubrique,
          valeur_base: num(l.valeur_base), valeur_nombre: num(l.valeur_nombre),
          valeur_taux: num(l.valeur_taux), valeur_montant: num(l.valeur_montant),
          code_type: l.code_type, code_source: l.code_source,
          date_debut: vD(l.date_debut), date_fin: vF(l.date_fin),
          statut: l.statut, motif: l.motif || null,
        });
      }
      toast({ title: "Éléments enregistrés", description: `${aCreer.length} créé(s), ${aMaj.length} modifié(s).` });
      charger();
    } catch (e: any) {
      toast({ title: "Erreur d'enregistrement", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  // Valider en masse : les EV VALIDE sont pris par le moteur de paie
  const validerTout = async () => {
    const aValider = lignes.filter((l) => l.id && l.statut === "SAISI");
    if (!aValider.length) { toast({ title: "Aucun élément à valider" }); return; }
    if (!confirm(`Valider ${aValider.length} élément(s) ? Ils seront pris en compte par le calcul de paie.`)) return;
    setSaving(true);
    try {
      for (const l of aValider) {
        await db.update("element_variable", { id: l.id! }, { statut: "VALIDE", valide_le: new Date().toISOString() });
      }
      toast({ title: "Éléments validés", description: `${aValider.length} élément(s) pris en compte au calcul.` });
      charger();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const collab = collabs.find((c) => c.id === collabId);


  const libRub = (code: string) => rubriques.find((r) => r.code === code)?.libelle || "";

  // Types d'EV autorisés sur une rubrique donnée
  const typesPour = (codeRub: string) => {
    const r = rubriques.find((x) => x.code === codeRub);
    if (!r) return types;
    return types.filter((t) => { const c = AUTORISATION[t.code]; return c ? !!r[c] : false; });
  };
  const nbDirty = lignes.filter((l) => l._dirty).length;
  const nbSaisi = lignes.filter((l) => l.statut === "SAISI").length;

  const badgeStatut = (s: string) => {
    const varName = s === "VALIDE" ? "--success" : s === "REJETE" ? "--destructive" : "--warning";
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
        style={{ background: `hsl(var(${varName}) / 0.12)`, color: `hsl(var(${varName}))` }}>
        {s}
      </span>
    );
  };

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Saisie individuelle des éléments variables</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Saisissez les éléments variables d'un collaborateur pour une période. Seuls les éléments <strong>validés</strong> sont pris en compte par le calcul de paie.
        </p>
      </div>

      {/* Sélecteurs */}
      <div className="rounded-xl border border-border p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 space-y-1.5">
          <Label className="text-xs">Collaborateur</Label>
          <Popover open={collabOpen} onOpenChange={setCollabOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                {collab ? `${collab.nom} ${collab.prenom} — ${collab.matricule}` : "Sélectionner…"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
                <CommandInput placeholder="Nom, prénom ou matricule…" />
                <CommandList>
                  <CommandEmpty>Aucun collaborateur.</CommandEmpty>
                  <CommandGroup>
                    {collabs.map((c) => (
                      <CommandItem key={c.id} value={`${c.nom} ${c.prenom} ${c.matricule}`}
                        onSelect={() => { setCollabId(c.id); setCollabOpen(false); }}>
                        <Check className={`mr-2 h-4 w-4 ${c.id === collabId ? "opacity-100" : "opacity-0"}`} />
                        <span className="flex-1">{c.nom} {c.prenom}</span>
                        <span className="text-xs text-muted-foreground">{c.matricule}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
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
      </div>

      {/* Période non ouverte / clôturée */}
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

      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{lignes.length} élément(s)</span>
          {nbSaisi > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
              style={{ background: "hsl(var(--info) / 0.12)", color: "hsl(var(--info))" }}
              title="Saisis mais pas encore validés : ignorés par le calcul de paie">
              {nbSaisi} à valider
            </span>
          )}
          {nbDirty > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
              style={{ background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }}>
              {nbDirty} non enregistré(s)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={ajouter} disabled={!collabId || !periodeId || !periodeOuverte} className="gap-1.5">
            <Plus size={14} /> Ajouter une ligne
          </Button>
          <Button size="sm" variant="outline" onClick={validerTout} disabled={saving || !nbSaisi || !periodeOuverte} className="gap-1.5">
            <CheckCircle2 size={14} /> Valider ({nbSaisi})
          </Button>
          <Button size="sm" onClick={enregistrer} disabled={saving || !nbDirty || !periodeOuverte} className="gap-1.5">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Enregistrer
          </Button>
        </div>
      </div>

      {/* Grille — style liste dense (cellules sans bordure jusqu'au survol/focus,
          filets horizontaux uniquement, pas de bordures verticales), toutes
          couleurs dérivées des variables CSS du thème choisi par l'utilisateur. */}
      <div className="rounded-xl border border-border overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={16} /> Chargement…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-[10px] uppercase tracking-wide font-semibold hover:bg-transparent" style={{ background: "hsl(var(--muted) / 0.5)" }}>
                <TableHead className="min-w-[75px] max-w-[100px] py-2">Rubrique</TableHead>
                <TableHead className="w-32 text-right py-2">Base</TableHead>
                <TableHead className="w-32 text-right py-2">Nombre</TableHead>
                <TableHead className="w-32 text-right py-2">Taux</TableHead>
                <TableHead className="w-32 text-right py-2">Montant</TableHead>
                <TableHead className="w-32 py-2">Type</TableHead>
                <TableHead className="w-32 py-2">Source</TableHead>
                <TableHead className="w-40 py-2">Début validité</TableHead>
                <TableHead className="w-40 py-2">Fin validité</TableHead>
                <TableHead className="w-24 py-2">Statut</TableHead>
                <TableHead className="w-12 sticky right-0 py-2" style={{ background: "hsl(var(--muted) / 0.5)" }}></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.map((l, idx) => (
                <TableRow
                  key={l.id || `new-${idx}`}
                  className="text-xs border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                  style={l._dirty ? { borderLeft: "2px solid hsl(var(--warning))" } : { borderLeft: "2px solid transparent" }}
                >
                  <TableCell className="py-1">
                    <select value={l.code_rubrique}
                      onChange={(e) => {
                        const rc = e.target.value;
                        const ok = typesPour(rc);
                        // Si le type courant n'est pas autorisé, on prend le premier disponible.
                        const t = ok.some((x) => x.code === l.code_type) ? l.code_type : (ok[0]?.code || l.code_type);
                        patch(idx, { code_rubrique: rc, code_type: t });
                      }}
                      disabled={!periodeOuverte}
                      className={CELL_SELECT}>
                      <option value="">— Choisir —</option>
                      {rubriques.map((r) => <option key={r.code} value={r.code}>{r.code} — {r.libelle}</option>)}
                    </select>
                  </TableCell>
                  <TableCell className="py-1">
                    <NumberCell value={l.valeur_base} disabled={!periodeOuverte} masks={masks}
                      onChange={(v) => patch(idx, { valeur_base: v })} />
                  </TableCell>
                  <TableCell className="py-1">
                    <NumberCell value={l.valeur_nombre} disabled={!periodeOuverte} masks={masks}
                      onChange={(v) => patch(idx, { valeur_nombre: v })} />
                  </TableCell>
                  <TableCell className="py-1">
                    <NumberCell value={l.valeur_taux} disabled={!periodeOuverte} masks={masks}
                      onChange={(v) => patch(idx, { valeur_taux: v })} />
                  </TableCell>
                  <TableCell className="py-1">
                    <NumberCell value={l.valeur_montant} disabled={!periodeOuverte} masks={masks} money
                      onChange={(v) => patch(idx, { valeur_montant: v })} />
                  </TableCell>
                  <TableCell className="py-1">
                    <select value={l.code_type} onChange={(e) => patch(idx, { code_type: e.target.value })}
                      disabled={!periodeOuverte || !l.code_rubrique}
                      title={!l.code_rubrique ? "Choisissez d'abord une rubrique" : undefined}
                      className={CELL_SELECT}>
                      {typesPour(l.code_rubrique).map((t) => <option key={t.code} value={t.code}>{t.libelle}</option>)}
                    </select>
                  </TableCell>
                  <TableCell className="py-1">
                    <span className="text-[11px] text-muted-foreground px-1.5">
                      {sources.find((s) => s.code === l.code_source)?.libelle || l.code_source}
                    </span>
                  </TableCell>
                  <TableCell className="py-1">
                    <DateCell value={l.date_debut} disabled={!periodeOuverte} masks={masks}
                      title={!l.date_debut && periode ? `Défaut : ${formatDate(periode.date_debut)}` : undefined}
                      onChange={(v) => patch(idx, { date_debut: v })} />
                  </TableCell>
                  <TableCell className="py-1">
                    <DateCell value={l.date_fin} disabled={!periodeOuverte} masks={masks}
                      title={!l.date_fin && periode ? `Défaut : ${formatDate(periode.date_fin)}` : undefined}
                      onChange={(v) => patch(idx, { date_fin: v })} />
                  </TableCell>
                  <TableCell className="py-1">{badgeStatut(l.statut)}</TableCell>
                  <TableCell className="py-1 sticky right-0 bg-background">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => supprimer(idx)} disabled={!periodeOuverte} title="Supprimer">
                      <Trash2 size={12} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {lignes.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={11} className="text-center py-10 text-sm text-muted-foreground">
                    {collabId && periodeId ? "Aucun élément variable pour cette période." : "Sélectionnez un collaborateur et une période."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        <strong>Type</strong> : « Ajout » cumule la valeur avec le calcul, « Forçage » la remplace.
        Les éléments au statut <em>SAISI</em> ne sont pas encore pris en compte : validez-les.{" "}
        Sans dates de validité, l'élément couvre toute la période de paie. Une ligne peut renseigner
        plusieurs grandeurs à la fois (ex. Base + Nombre + Montant pour un même élément) — au moins une
        est obligatoire. Les valeurs négatives se saisissent directement (ex. « -500 »).
      </p>
    </div>
  );
};

export default SaisieIndividuellePage;
