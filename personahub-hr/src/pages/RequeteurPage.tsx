import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trash2, Plus, Play, Save, Loader2, Link2, Pencil } from "lucide-react";

// ---------------------------------------------------------------------------
// Types (miroir des schémas Pydantic du backend)
// ---------------------------------------------------------------------------

type TypeDonnee = "text" | "number" | "date" | "boolean" | "uuid";

interface TableInfo {
  nom_table: string;
  libelle_affiche: string;
}

interface ColonneInfo {
  nom_colonne: string;
  libelle_affiche: string;
  type_donnee: TypeDonnee;
  filtrable: boolean;
  triable: boolean;
  est_cle_etrangere: boolean;
  table_referencee: string | null;
  libelle_table_referencee: string | null;
}

interface RelationSortante {
  colonne: string;
  table_referencee: string;
  libelle_table_referencee: string;
  colonne_referencee: string;
}

interface RelationEntrante {
  table_source: string;
  libelle_table_source: string;
  colonne_source: string;
}

interface RelationsTable {
  sortantes: RelationSortante[];
  entrantes: RelationEntrante[];
}

interface Filtre {
  colonne: string;
  operateur: string;
  valeur?: string | number | boolean;
  valeur_fin?: string | number;
}

interface Tri {
  colonne: string;
  direction: "asc" | "desc";
}

interface ResultatExecution {
  table: string;
  colonnes: string[];
  colonnes_resultat: string[];
  resultats: Record<string, unknown>[];
  total_retourne: number;
}

interface RequeteSauvegardee {
  id: string;
  nom: string;
  description: string | null;
  table_principale: string;
  configuration: {
    colonnes: string[];
    filtres: Filtre[];
    tri: Tri | null;
    limite: number;
  };
  is_public: boolean;
  created_at: string;
}

const OPERATEURS_LABELS: Record<string, string> = {
  "=": "égal à",
  "!=": "différent de",
  ">": "supérieur à",
  ">=": "supérieur ou égal à",
  "<": "inférieur à",
  "<=": "inférieur ou égal à",
  entre: "entre",
  contient: "contient",
  commence_par: "commence par",
  est_vide: "est vide",
  n_est_pas_vide: "n'est pas vide",
};

const OPERATEURS_PAR_TYPE: Record<TypeDonnee, string[]> = {
  text: ["=", "!=", "contient", "commence_par", "est_vide", "n_est_pas_vide"],
  number: ["=", "!=", ">", ">=", "<", "<=", "entre"],
  date: ["=", "!=", ">", ">=", "<", "<=", "entre"],
  boolean: ["=", "!="],
  uuid: ["=", "!=", "est_vide", "n_est_pas_vide"],
};

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

export default function RequeteurPage() {
  const queryClient = useQueryClient();

  const [tableSelectionnee, setTableSelectionnee] = useState<string>("");
  const [colonnesChoisies, setColonnesChoisies] = useState<string[]>([]);
  const [filtres, setFiltres] = useState<Filtre[]>([]);
  const [tri, setTri] = useState<Tri | null>(null);
  const [limite, setLimite] = useState(100);
  const [resultat, setResultat] = useState<ResultatExecution | null>(null);
  const [dialogSauvegardeOuvert, setDialogSauvegardeOuvert] = useState(false);
  const [nomSauvegarde, setNomSauvegarde] = useState("");
  const [descriptionSauvegarde, setDescriptionSauvegarde] = useState("");
  const [editionLibelle, setEditionLibelle] = useState<{
    nomTable: string;
    nomColonne: string | null;
    valeur: string;
  } | null>(null);

  // -- Chargement des tables disponibles (découverte dynamique) --
  const { data: tables = [], isLoading: tablesEnChargement } = useQuery<TableInfo[]>({
    queryKey: ["requeteur", "tables"],
    queryFn: () => api.get("/requeteur/tables"),
  });

  // -- Chargement des colonnes de la table sélectionnée --
  const { data: colonnes = [], isLoading: colonnesEnChargement } = useQuery<ColonneInfo[]>({
    queryKey: ["requeteur", "colonnes", tableSelectionnee],
    queryFn: () => api.get(`/requeteur/tables/${tableSelectionnee}/colonnes`),
    enabled: !!tableSelectionnee,
  });

  // -- Relations détectées automatiquement (clés étrangères) --
  const { data: relations } = useQuery<RelationsTable>({
    queryKey: ["requeteur", "relations", tableSelectionnee],
    queryFn: () => api.get(`/requeteur/tables/${tableSelectionnee}/relations`),
    enabled: !!tableSelectionnee,
  });

  // -- Requêtes sauvegardées --
  const { data: requetesSauvegardees = [] } = useQuery<RequeteSauvegardee[]>({
    queryKey: ["requeteur", "sauvegardees"],
    queryFn: () => api.get("/requeteur/sauvegardees"),
  });

  const colonnesParNom = useMemo(
    () => Object.fromEntries(colonnes.map((c) => [c.nom_colonne, c])),
    [colonnes]
  );

  // -- Exécution de la requête --
  const executerMutation = useMutation({
    mutationFn: () =>
      api.post<ResultatExecution>("/requeteur/executer", {
        table: tableSelectionnee,
        colonnes: colonnesChoisies,
        filtres,
        tri,
        limite,
      }),
    onSuccess: (data) => setResultat(data),
  });

  // -- Sauvegarde de la configuration --
  const sauvegarderMutation = useMutation({
    mutationFn: () =>
      api.post("/requeteur/sauvegardees", {
        nom: nomSauvegarde,
        description: descriptionSauvegarde || null,
        table_principale: tableSelectionnee,
        configuration: { colonnes: colonnesChoisies, filtres, tri, limite },
        is_public: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requeteur", "sauvegardees"] });
      setDialogSauvegardeOuvert(false);
      setNomSauvegarde("");
      setDescriptionSauvegarde("");
    },
  });

  const supprimerSauvegardeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/requeteur/sauvegardees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requeteur", "sauvegardees"] }),
  });

  // -- Renommer une table ou une colonne (libellé personnalisé) --
  const definirLibelleMutation = useMutation({
    mutationFn: (payload: { nom_table: string; nom_colonne: string | null; libelle_affiche: string }) =>
      api.put("/requeteur/libelles", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requeteur", "tables"] });
      queryClient.invalidateQueries({ queryKey: ["requeteur", "colonnes"] });
      queryClient.invalidateQueries({ queryKey: ["requeteur", "relations"] });
      setEditionLibelle(null);
    },
  });

  function selectionnerTable(nomTable: string) {
    setTableSelectionnee(nomTable);
    setColonnesChoisies([]);
    setFiltres([]);
    setTri(null);
    setResultat(null);
  }

  function toggleColonne(nomColonne: string) {
    setColonnesChoisies((prev) =>
      prev.includes(nomColonne) ? prev.filter((c) => c !== nomColonne) : [...prev, nomColonne]
    );
  }

  function ajouterFiltre() {
    const premiereColonneFiltrable = colonnes.find((c) => c.filtrable);
    if (!premiereColonneFiltrable) return;
    setFiltres((prev) => [
      ...prev,
      {
        colonne: premiereColonneFiltrable.nom_colonne,
        operateur: OPERATEURS_PAR_TYPE[premiereColonneFiltrable.type_donnee][0],
        valeur: "",
      },
    ]);
  }

  function modifierFiltre(index: number, patch: Partial<Filtre>) {
    setFiltres((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function supprimerFiltre(index: number) {
    setFiltres((prev) => prev.filter((_, i) => i !== index));
  }

  function chargerRequeteSauvegardee(r: RequeteSauvegardee) {
    selectionnerTable(r.table_principale);
    // Les colonnes/filtres/tri seront réappliqués une fois les colonnes de la table chargées
    setTimeout(() => {
      setColonnesChoisies(r.configuration.colonnes);
      setFiltres(r.configuration.filtres);
      setTri(r.configuration.tri);
      setLimite(r.configuration.limite);
    }, 0);
  }

  const peutExecuter = !!tableSelectionnee && colonnesChoisies.length > 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">Requêteur</h1>
        <p className="page-subtitle">Construisez vos propres extractions de données, sans écrire de requête.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Colonne latérale : requêtes sauvegardées */}
        <aside className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
            Requêtes sauvegardées
          </div>
          <div className="space-y-2">
            {requetesSauvegardees.length === 0 && (
              <p className="text-sm text-[hsl(var(--muted))]">Aucune requête sauvegardée pour l'instant.</p>
            )}
            {requetesSauvegardees.map((r) => (
              <div
                key={r.id}
                className="group flex items-center justify-between rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2"
              >
                <button
                  onClick={() => chargerRequeteSauvegardee(r)}
                  className="text-left text-sm flex-1 truncate"
                  title={r.description ?? undefined}
                >
                  {r.nom}
                </button>
                <button
                  onClick={() => supprimerSauvegardeMutation.mutate(r.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[hsl(var(--muted))] hover:text-red-500"
                  aria-label={`Supprimer ${r.nom}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Zone principale : constructeur */}
        <div className="space-y-6">
          {/* 1. Sélection de la table */}
          <section className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
              1. Choisir une source de données
            </label>
            <Select value={tableSelectionnee} onValueChange={selectionnerTable} disabled={tablesEnChargement}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder={tablesEnChargement ? "Chargement..." : "Sélectionner une table"} />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => (
                  <SelectItem key={t.nom_table} value={t.nom_table}>
                    {t.libelle_affiche}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tableSelectionnee && (
              <button
                onClick={() =>
                  setEditionLibelle({
                    nomTable: tableSelectionnee,
                    nomColonne: null,
                    valeur: tables.find((t) => t.nom_table === tableSelectionnee)?.libelle_affiche ?? "",
                  })
                }
                className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted))] hover:text-[hsl(var(--accent))] mt-1"
              >
                <Pencil className="h-3 w-3" /> Renommer cette table
              </button>
            )}
          </section>

          {tableSelectionnee && (
            <>
              {/* 2. Choix des colonnes */}
              <section className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                  2. Choisir les colonnes à afficher
                </label>
                {colonnesEnChargement ? (
                  <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted))]">
                    <Loader2 className="h-4 w-4 animate-spin" /> Chargement des colonnes...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {colonnes.map((c) => (
                      <label
                        key={c.nom_colonne}
                        className="flex items-center gap-2 text-sm rounded-md border border-[hsl(var(--border))] px-3 py-2 cursor-pointer hover:bg-[hsl(var(--card))]"
                        title={
                          c.est_cle_etrangere
                            ? `Lien vers ${c.libelle_table_referencee}`
                            : undefined
                        }
                      >
                        <Checkbox
                          checked={colonnesChoisies.includes(c.nom_colonne)}
                          onCheckedChange={() => toggleColonne(c.nom_colonne)}
                        />
                        <span className="flex-1">{c.libelle_affiche}</span>
                        {c.est_cle_etrangere && (
                          <Link2 className="h-3 w-3 text-[hsl(var(--accent))] shrink-0" />
                        )}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditionLibelle({
                              nomTable: tableSelectionnee,
                              nomColonne: c.nom_colonne,
                              valeur: c.libelle_affiche,
                            });
                          }}
                          className="text-[hsl(var(--muted))] hover:text-[hsl(var(--accent))] shrink-0"
                          aria-label={`Renommer ${c.libelle_affiche}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {/* Tables liées (relations détectées automatiquement) */}
              {relations && (relations.sortantes.length > 0 || relations.entrantes.length > 0) && (
                <section className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                    Tables liées
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {relations.sortantes.map((r) => (
                      <button
                        key={`sortante-${r.colonne}`}
                        onClick={() => selectionnerTable(r.table_referencee)}
                        className="flex items-center gap-1.5 text-xs rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 hover:bg-[hsl(var(--accent))] hover:text-white transition-colors"
                        title={`via ${r.colonne}`}
                      >
                        <Link2 className="h-3 w-3" />
                        {r.libelle_table_referencee}
                      </button>
                    ))}
                    {relations.entrantes.map((r) => (
                      <button
                        key={`entrante-${r.table_source}-${r.colonne_source}`}
                        onClick={() => selectionnerTable(r.table_source)}
                        className="flex items-center gap-1.5 text-xs rounded-full border border-dashed border-[hsl(var(--border))] px-3 py-1 hover:bg-[hsl(var(--card))] transition-colors"
                        title={`${r.libelle_table_source} référence cette table via ${r.colonne_source}`}
                      >
                        <Link2 className="h-3 w-3 rotate-180" />
                        {r.libelle_table_source}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 3. Filtres */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                    3. Filtrer (optionnel)
                  </label>
                  <Button variant="outline" size="sm" onClick={ajouterFiltre} disabled={!colonnes.some((c) => c.filtrable)}>
                    <Plus className="h-4 w-4 mr-1" /> Ajouter un filtre
                  </Button>
                </div>

                <div className="space-y-2">
                  {filtres.map((f, index) => {
                    const colonneInfo = colonnesParNom[f.colonne];
                    const typeDonnee = colonneInfo?.type_donnee ?? "text";
                    const operateursDisponibles = OPERATEURS_PAR_TYPE[typeDonnee];
                    const necessiteValeur = !["est_vide", "n_est_pas_vide"].includes(f.operateur);
                    const estEntre = f.operateur === "entre";

                    return (
                      <div
                        key={index}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2"
                      >
                        <Select
                          value={f.colonne}
                          onValueChange={(val) => {
                            const nouvelleColonne = colonnesParNom[val];
                            modifierFiltre(index, {
                              colonne: val,
                              operateur: OPERATEURS_PAR_TYPE[nouvelleColonne.type_donnee][0],
                              valeur: "",
                            });
                          }}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {colonnes
                              .filter((c) => c.filtrable)
                              .map((c) => (
                                <SelectItem key={c.nom_colonne} value={c.nom_colonne}>
                                  {c.libelle_affiche}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={f.operateur}
                          onValueChange={(val) => modifierFiltre(index, { operateur: val })}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {operateursDisponibles.map((op) => (
                              <SelectItem key={op} value={op}>
                                {OPERATEURS_LABELS[op]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {necessiteValeur && (
                          <Input
                            type={typeDonnee === "number" ? "number" : typeDonnee === "date" ? "date" : "text"}
                            value={String(f.valeur ?? "")}
                            onChange={(e) => modifierFiltre(index, { valeur: e.target.value })}
                            placeholder="Valeur"
                            className="w-40"
                          />
                        )}

                        {estEntre && (
                          <>
                            <span className="text-sm text-[hsl(var(--muted))]">et</span>
                            <Input
                              type={typeDonnee === "date" ? "date" : "number"}
                              value={String(f.valeur_fin ?? "")}
                              onChange={(e) => modifierFiltre(index, { valeur_fin: e.target.value })}
                              placeholder="Valeur de fin"
                              className="w-40"
                            />
                          </>
                        )}

                        <button
                          onClick={() => supprimerFiltre(index)}
                          className="ml-auto text-[hsl(var(--muted))] hover:text-red-500"
                          aria-label="Supprimer ce filtre"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 4. Tri + limite */}
              <section className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                    Trier par
                  </label>
                  <Select
                    value={tri?.colonne ?? "__aucun__"}
                    onValueChange={(val) =>
                      setTri(val === "__aucun__" ? null : { colonne: val, direction: tri?.direction ?? "asc" })
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Aucun tri" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__aucun__">Aucun tri</SelectItem>
                      {colonnes
                        .filter((c) => c.triable)
                        .map((c) => (
                          <SelectItem key={c.nom_colonne} value={c.nom_colonne}>
                            {c.libelle_affiche}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {tri && (
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                      Direction
                    </label>
                    <Select
                      value={tri.direction}
                      onValueChange={(val: "asc" | "desc") => setTri({ ...tri, direction: val })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Croissant</SelectItem>
                        <SelectItem value="desc">Décroissant</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                    Limite de résultats
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={limite}
                    onChange={(e) => setLimite(Number(e.target.value))}
                    className="w-32"
                  />
                </div>

                <div className="flex gap-2 ml-auto">
                  <Dialog open={dialogSauvegardeOuvert} onOpenChange={setDialogSauvegardeOuvert}>
                    <DialogTrigger asChild>
                      <Button variant="outline" disabled={!peutExecuter}>
                        <Save className="h-4 w-4 mr-1" /> Sauvegarder
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Sauvegarder cette requête</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <Input
                          placeholder="Nom de la requête"
                          value={nomSauvegarde}
                          onChange={(e) => setNomSauvegarde(e.target.value)}
                        />
                        <Input
                          placeholder="Description (optionnel)"
                          value={descriptionSauvegarde}
                          onChange={(e) => setDescriptionSauvegarde(e.target.value)}
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={() => sauvegarderMutation.mutate()}
                          disabled={!nomSauvegarde || sauvegarderMutation.isPending}
                        >
                          {sauvegarderMutation.isPending ? "Sauvegarde..." : "Sauvegarder"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Button onClick={() => executerMutation.mutate()} disabled={!peutExecuter || executerMutation.isPending}>
                    {executerMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-1" />
                    )}
                    Exécuter
                  </Button>
                </div>
              </section>
            </>
          )}

          {/* 5. Résultats */}
          {executerMutation.isError && (
            <p className="text-sm text-red-500">
              Erreur lors de l'exécution : {(executerMutation.error as Error)?.message ?? "erreur inconnue"}
            </p>
          )}

          {resultat && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                  Résultats ({resultat.total_retourne})
                </label>
              </div>
              <div className="rounded-md border border-[hsl(var(--border))] overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {resultat.colonnes.map((c) => (
                        <TableHead key={c}>{colonnesParNom[c]?.libelle_affiche ?? c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultat.resultats.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={resultat.colonnes.length} className="text-center text-[hsl(var(--muted))]">
                          Aucun résultat pour ces critères.
                        </TableCell>
                      </TableRow>
                    ) : (
                      resultat.resultats.map((row, i) => (
                        <TableRow key={i}>
                          {resultat.colonnes.map((c) => {
                            const estFk = colonnesParNom[c]?.est_cle_etrangere;
                            const valeurBrute = row[c];
                            const valeurLibelle = estFk ? row[`${c}__libelle`] : undefined;
                            const valeurAffichee =
                              valeurLibelle !== undefined && valeurLibelle !== null
                                ? String(valeurLibelle)
                                : String(valeurBrute ?? "—");
                            return (
                              <TableCell
                                key={c}
                                title={estFk ? `ID : ${String(valeurBrute ?? "—")}` : undefined}
                              >
                                {valeurAffichee}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Dialog de renommage d'une table ou d'une colonne */}
      <Dialog open={!!editionLibelle} onOpenChange={(ouvert) => !ouvert && setEditionLibelle(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editionLibelle?.nomColonne ? "Renommer la colonne" : "Renommer la table"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[hsl(var(--muted))]">
              Nom technique : <code>{editionLibelle?.nomColonne ?? editionLibelle?.nomTable}</code>
            </p>
            <Input
              placeholder="Intitulé affiché"
              value={editionLibelle?.valeur ?? ""}
              onChange={(e) =>
                setEditionLibelle((prev) => (prev ? { ...prev, valeur: e.target.value } : prev))
              }
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                editionLibelle &&
                definirLibelleMutation.mutate({
                  nom_table: editionLibelle.nomTable,
                  nom_colonne: editionLibelle.nomColonne,
                  libelle_affiche: editionLibelle.valeur,
                })
              }
              disabled={!editionLibelle?.valeur.trim() || definirLibelleMutation.isPending}
            >
              {definirLibelleMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
