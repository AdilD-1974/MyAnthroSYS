/**
 * ComptesEmetteursPage.tsx
 * Complète les 3 champs propres au virement SIMT (code_simt_effectif, rib,
 * raison_sociale_emetteur) sur les comptes bancaires existants de
 * societe_comptes_bancaires, et associe chaque compte à un ou plusieurs
 * types de virement (net à payer, retenues tiers, prêts externes) via
 * societe_compte_bancaire_type_virement.
 *
 * La création du compte bancaire lui-même reste dans Organisations >
 * Sociétés > Banques & Comptes, pas ici.
 * Route suggérée : /configuration/comptes-emetteurs
 *
 * Nouveautés de cette version :
 *  - Tri cliquable sur toutes les colonnes de la liste des comptes.
 *  - Badges de type de virement en trames de couleurs dynamiques (issues du
 *    thème --primary/--secondary/--accent, jamais codées en dur), donc
 *    cohérentes avec les préférences d'apparence de l'utilisateur.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, AlertTriangle, Info, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/lib/api";
import type { TypeOrdreVirement, AssociationCompteTypeVirement } from "@/lib/virementsApi";

interface CompteBancaire {
  id: string;
  societe_id: string;
  code_banque: string;
  agence: string | null;
  numero_compte: string;
  code_simt_effectif: string | null;
  rib: string | null;
  raison_sociale_emetteur: string | null;
  actif: boolean;
}

interface RefBanque {
  code: string;
  libelle: string;
  code_simt: string | null;
}

const LIBELLE_TYPE_VIREMENT: Record<TypeOrdreVirement, string> = {
  SALAIRE: "Net à payer",
  RETENUE_TIERS: "Retenues tiers",
  PRET_EXTERNE: "Prêts externes",
};

// Trame de couleur dynamique par type — chaque type pointe vers une
// variable CSS du thème (jamais une couleur figée), donc s'adapte
// automatiquement aux préférences d'apparence de l'utilisateur.
const VARIABLE_COULEUR_TYPE: Record<TypeOrdreVirement, string> = {
  SALAIRE: "--primary",
  RETENUE_TIERS: "--secondary",
  PRET_EXTERNE: "--accent",
};

function badgeTypeVirement(type: TypeOrdreVirement) {
  const v = VARIABLE_COULEUR_TYPE[type];
  return (
    <span
      key={type}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `hsl(var(${v}) / 0.15)`,
        color: `hsl(var(${v}))`,
        border: `1px solid hsl(var(${v}) / 0.4)`,
      }}
    >
      {LIBELLE_TYPE_VIREMENT[type]}
    </span>
  );
}

const TOUS_LES_TYPES: TypeOrdreVirement[] = ["SALAIRE", "RETENUE_TIERS", "PRET_EXTERNE"];

// ---------------------------------------------------------------------------
// Tri générique (même pattern que TiersRetenuesPage.tsx)
// ---------------------------------------------------------------------------

type Ordre = "asc" | "desc";

function useTri<T extends Record<string, any>>(donnees: T[]) {
  const [colonne, setColonne] = useState<string | null>(null);
  const [ordre, setOrdre] = useState<Ordre>("asc");

  const trier = (col: string) => {
    if (colonne === col) setOrdre((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setColonne(col);
      setOrdre("asc");
    }
  };

  const donneesTriees = useMemo(() => {
    if (!colonne) return donnees;
    return [...donnees].sort((a, b) => {
      const va = a[colonne];
      const vb = b[colonne];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return ordre === "asc" ? va - vb : vb - va;
      }
      return ordre === "asc"
        ? String(va).localeCompare(String(vb), "fr")
        : String(vb).localeCompare(String(va), "fr");
    });
  }, [donnees, colonne, ordre]);

  return { donneesTriees, colonne, ordre, trier };
}

function EnteteTriable({
  label,
  col,
  tri,
  className,
}: {
  label: string;
  col: string;
  tri: ReturnType<typeof useTri>;
  className?: string;
}) {
  const actif = tri.colonne === col;
  return (
    <TableHead className={`cursor-pointer select-none ${className ?? ""}`} onClick={() => tri.trier(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {actif ? (
          tri.ordre === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------

export default function ComptesEmetteursPage() {
  const { toast } = useToast();
  const [comptes, setComptes] = useState<CompteBancaire[]>([]);
  const [banques, setBanques] = useState<RefBanque[]>([]);
  const [associations, setAssociations] = useState<AssociationCompteTypeVirement[]>([]);
  const [chargement, setChargement] = useState(true);
  const [dialogOuvert, setDialogOuvert] = useState(false);
  const [enEdition, setEnEdition] = useState<CompteBancaire | null>(null);
  const [form, setForm] = useState({ code_simt_effectif: "", rib: "", raison_sociale_emetteur: "" });
  const [typesChoisis, setTypesChoisis] = useState<Set<TypeOrdreVirement>>(new Set());

  const chargerDonnees = async () => {
    setChargement(true);
    const [resComptes, resBanques, resAssociations] = await Promise.allSettled([
      db.list<CompteBancaire>("societe_comptes_bancaires", { actif: true }),
      db.list<RefBanque>("ref_banque", { select: "code,libelle,code_simt", actif: true }),
      db.list<AssociationCompteTypeVirement>("societe_compte_bancaire_type_virement"),
    ]);
    if (resComptes.status === "fulfilled") setComptes(resComptes.value);
    else toast({ variant: "destructive", title: "Comptes bancaires non chargés" });
    if (resBanques.status === "fulfilled") setBanques(resBanques.value);
    else toast({ variant: "destructive", title: "Référentiel banques non chargé" });
    if (resAssociations.status === "fulfilled") setAssociations(resAssociations.value);
    else toast({ variant: "destructive", title: "Associations compte/virement non chargées" });
    setChargement(false);
  };

  useEffect(() => {
    chargerDonnees();
  }, []);

  const libelleBanque = (code: string) => banques.find((b) => b.code === code)?.libelle ?? code;

  const typesDuCompte = (compteId: string) =>
    associations.filter((a) => a.compte_bancaire_id === compteId).map((a) => a.type_virement);

  const ouvrirCompletion = (compte: CompteBancaire) => {
    setEnEdition(compte);
    setForm({
      code_simt_effectif: compte.code_simt_effectif ?? banques.find((b) => b.code === compte.code_banque)?.code_simt ?? "",
      rib: compte.rib ?? "",
      raison_sociale_emetteur: compte.raison_sociale_emetteur ?? "",
    });
    setTypesChoisis(new Set(typesDuCompte(compte.id)));
    setDialogOuvert(true);
  };

  const basculerType = (type: TypeOrdreVirement) => {
    setTypesChoisis((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(type)) suivant.delete(type);
      else suivant.add(type);
      return suivant;
    });
  };

  const enregistrer = async () => {
    if (!enEdition) return;
    if (form.rib.length !== 24) {
      toast({ variant: "destructive", title: "RIB invalide", description: "Le RIB doit comporter exactement 24 chiffres." });
      return;
    }
    if (!form.rib.startsWith(form.code_simt_effectif)) {
      toast({ variant: "destructive", title: "Incohérence RIB / code banque", description: "Le RIB doit commencer par le code SIMT effectif saisi." });
      return;
    }
    try {
      await db.update("societe_comptes_bancaires", { id: enEdition.id }, form);

      const typesActuels = new Set(typesDuCompte(enEdition.id));
      const aAjouter = [...typesChoisis].filter((t) => !typesActuels.has(t));
      const aRetirer = [...typesActuels].filter((t) => !typesChoisis.has(t));

      await Promise.all([
        ...aAjouter.map((type) =>
          db.create("societe_compte_bancaire_type_virement", { compte_bancaire_id: enEdition.id, type_virement: type })
        ),
        ...aRetirer.map((type) =>
          db.remove("societe_compte_bancaire_type_virement", { compte_bancaire_id: enEdition.id, type_virement: type })
        ),
      ]);

      toast({ title: "Compte mis à jour pour les virements" });
      setDialogOuvert(false);
      chargerDonnees();
    } catch {
      toast({ variant: "destructive", title: "Échec de l'enregistrement" });
    }
  };

  const estComplet = (c: CompteBancaire) => !!(c.code_simt_effectif && c.rib && c.raison_sociale_emetteur);

  const comptesAffiches = useMemo(
    () => comptes.map((c) => ({ ...c, banque_libelle: libelleBanque(c.code_banque) })),
    [comptes, banques]
  );
  const tri = useTri(comptesAffiches);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Comptes émetteurs</h1>
        <p className="text-sm text-muted-foreground">
          Complétez les informations nécessaires aux virements de masse et associez chaque compte
          aux types de virement qu'il doit traiter.
        </p>
      </div>

      <div
        className="flex items-start gap-2 rounded-md border p-3 text-sm"
        style={{
          borderColor: "hsl(var(--accent))",
          backgroundColor: "hsl(var(--accent) / 0.08)",
          color: "hsl(var(--accent-foreground, var(--foreground)))",
        }}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "hsl(var(--accent))" }} />
        <span>
          Pour ajouter un nouveau compte bancaire, utilisez{" "}
          <strong>Organisations &gt; Sociétés &gt; Banques &amp; Comptes</strong>. Cet écran complète
          les champs requis pour les virements et détermine quels comptes sont proposés selon le
          type d'ordre généré.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comptes bancaires de l'entreprise</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <EnteteTriable label="Banque" col="banque_libelle" tri={tri} />
                <EnteteTriable label="N° compte" col="numero_compte" tri={tri} />
                <EnteteTriable label="Code SIMT" col="code_simt_effectif" tri={tri} />
                <TableHead>Types de virement</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chargement && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">Chargement...</TableCell>
                </TableRow>
              )}
              {!chargement && comptes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Aucun compte bancaire actif. Ajoutez-en un depuis Organisations.
                  </TableCell>
                </TableRow>
              )}
              {tri.donneesTriees.map((compte) => (
                <TableRow key={compte.id}>
                  <TableCell>{compte.banque_libelle}</TableCell>
                  <TableCell className="font-mono">{compte.numero_compte}</TableCell>
                  <TableCell className="font-mono">{compte.code_simt_effectif ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {typesDuCompte(compte.id).length === 0 && (
                        <span className="text-xs text-muted-foreground">Aucun</span>
                      )}
                      {typesDuCompte(compte.id).map((type) => badgeTypeVirement(type))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {estComplet(compte) ? (
                      <Badge>Prêt pour virement</Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        À compléter
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <button onClick={() => ouvrirCompletion(compte)} title="Modifier" aria-label="Modifier">
                      <Pencil className="h-4 w-4" style={{ color: "hsl(var(--primary))" }} />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Compléter pour les virements — {enEdition ? libelleBanque(enEdition.code_banque) : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Code SIMT effectif (3 chiffres)</Label>
              <Input
                maxLength={3}
                value={form.code_simt_effectif}
                onChange={(e) => setForm((f) => ({ ...f, code_simt_effectif: e.target.value.replace(/\D/g, "") }))}
                placeholder="ex. 021"
              />
            </div>
            <div>
              <Label>RIB (24 chiffres)</Label>
              <Input
                maxLength={24}
                className="font-mono"
                value={form.rib}
                onChange={(e) => setForm((f) => ({ ...f, rib: e.target.value.replace(/\D/g, "") }))}
              />
            </div>
            <div>
              <Label>Raison sociale émetteur (ligne 04 du fichier SIMT, 35 car. max)</Label>
              <Input
                maxLength={35}
                value={form.raison_sociale_emetteur}
                onChange={(e) => setForm((f) => ({ ...f, raison_sociale_emetteur: e.target.value.toUpperCase() }))}
              />
            </div>

            <div>
              <Label>Types de virement associés à ce compte</Label>
              <div className="mt-2 space-y-2">
                {TOUS_LES_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={typesChoisis.has(type)}
                      onCheckedChange={() => basculerType(type)}
                    />
                    {badgeTypeVirement(type)}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Un même compte peut être utilisé pour plusieurs types. La génération d'un ordre ne
                proposera que les comptes associés au type demandé.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOuvert(false)}>Annuler</Button>
            <Button onClick={enregistrer}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
