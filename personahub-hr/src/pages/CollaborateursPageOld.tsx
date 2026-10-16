import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { setListNavigationContext } from "@/hooks/useListNavigationContext";
import { Search, Plus, User, Mail, ChevronRight, LayoutGrid, List, Building2, Briefcase, X, Filter, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCollaborateurNotifications } from "@/hooks/useCollaborateurNotifications";
import CollabNotifBadge from "@/components/CollabNotifBadge";
import CollaborateursFiltresAvances, {
  EMPTY_FILTRES,
  countFiltres,
  type FiltresAvances,
} from "@/components/collaborateurs/CollaborateursFiltresAvances";

interface Collaborateur {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  code_genre: string;
  code_nationalite?: string;
  statut_collaborateur: string;
  gsm?: string;
  telephone?: string;
  email_professionnel?: string;
  email_personnel?: string;
  photo_path?: string;
  date_naissance?: string;
  cin?: string;
  created_at: string;
  archive: boolean;
}

interface ListeInfo {
  poste_code?: string;
  poste_libelle?: string;
  uo_id?: string;
  uo_libelle?: string;
  etablissement_id?: string;
  etablissement_libelle?: string;
  societe_id?: string;
  societe_libelle?: string;
  type_contrat_code?: string;
  type_contrat_libelle?: string;
  date_embauche?: string;
  has_mandat_syndical?: boolean;
  manager_n1_id?: string;
  manager_n1_nom?: string;
  plan_paie_libelle?: string;
  salaire_base?: number;
  statut_contrat?: string;
}

const STATUTS = [
  { value: "hors_sortis", label: "Tous (hors sortis)" },
  { value: "all", label: "Tous" },
  { value: "ACTIF", label: "Actif" },
  { value: "EN_DEPART", label: "En départ" },
  { value: "SORTI", label: "Sorti" },
  { value: "INACTIF", label: "Inactif" },
  { value: "SUSPENDU", label: "Suspendu" },
];

const CollaborateursPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role } = useAuth();
  const isManager = role === "manager";
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();
  const { notifMap } = useCollaborateurNotifications();

  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [listeInfoMap, setListeInfoMap] = useState<Record<string, ListeInfo>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  const [retentionYears, setRetentionYears] = useState<number | null>(null);

  // Filtres avancés
  const [filtresAvances, setFiltresAvances] = useState<FiltresAvances>(EMPTY_FILTRES);
  const [showFilters, setShowFilters] = useState(false);

  // Modèle d'affichage du tableau (n'affecte pas la vue cartes)
  type ModeleAffichage = "standard" | "identite" | "contrats" | "paie" | "affectation";
  const [modele, setModele] = useState<ModeleAffichage>("standard");

  // Options pour les multi-selects (chargées en même temps que la liste)
  const [optTypesContrat, setOptTypesContrat] = useState<{ value: string; label: string }[]>([]);
  const [optSocietes, setOptSocietes] = useState<{ value: string; label: string }[]>([]);
  const [optEtablissements, setOptEtablissements] = useState<{ value: string; label: string }[]>([]);
  const [optUOs, setOptUOs] = useState<{ value: string; label: string; parent_id: string | null }[]>([]);
  const [optGenres, setOptGenres] = useState<{ value: string; label: string }[]>([]);
  const [optNationalites, setOptNationalites] = useState<{ value: string; label: string }[]>([]);

  // Lire le filtre depuis l'URL (paramètre ?statut=…) — par défaut hors sortis
  const urlStatut = searchParams.get("statut") || "hors_sortis";
  const filterStatut = urlStatut;
  const setFilterStatut = (val: string) => {
    if (val === "hors_sortis") {
      searchParams.delete("statut");
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ statut: val }, { replace: true });
    }
  };

  useEffect(() => {
    // Pour le manager, attendre que la population soit chargée
    if (isManager && popLoading) return;
    loadAll();
  }, [isManager, popLoading, managerCollabIds.join(",")]);

  const loadAll = async () => {
    setLoading(true);

    // RG-MGR-POP-01 : le manager ne voit que sa population
    if (isManager && managerCollabIds.length === 0) {
      setCollaborateurs([]);
      setListeInfoMap({});
      setLoading(false);
      return;
    }

    // Filtre population manager : si aucun ID, on évite la requête
    let collabPromise: Promise<any[]>;
    if (isManager && managerCollabIds.length === 0) {
      collabPromise = Promise.resolve([]);
    } else if (isManager) {
      collabPromise = db.list("collaborateurs", {
        archive: false,
        order: "nom",
        id: `in.(${managerCollabIds.join(",")})`,
      });
    } else {
      collabPromise = db.list("collaborateurs", {
        archive: false,
        order: "nom",
      });
    }

    const [collabs, affectations, contrats, refPostes, refUOs, refTypeContrats, retentionParam, departsData] =
      await Promise.all([
        collabPromise,
        db.list<any>("collaborateur_affectations", { archive: false }),
        db.list<any>("collaborateur_contrats", { archive: false }),
        db.list<any>("ref_poste"),
        // Fetch UO avec hiérarchie (parent_id) ET rattachement étab (utilisé plus bas)
        db.list<any>("unites_organisationnelles"),
        db.list<any>("ref_type_contrat"),
        db.findOne<any>("parametres_rh", { code: "DUREE_RETENTION_SORTIS", actif: true }),
        db.list<any>("collaborateur_departs", { statut: "TRAITE" }),
      ]);

    // CNDP : durée de rétention des sortis
    const retYears = retentionParam?.valeur ? parseInt(retentionParam.valeur, 10) : null;
    setRetentionYears(retYears);

    // Build departure date map for retention filtering
    const departDateMap: Record<string, string> = {};
    ((departsData as any[]) || []).forEach((d: any) => {
      if (!departDateMap[d.collaborateur_id] || d.date_depart > departDateMap[d.collaborateur_id]) {
        departDateMap[d.collaborateur_id] = d.date_depart;
      }
    });

    // Filter out SORTI beyond retention
    let filteredCollabs = collabs || [];
    if (retYears && retYears > 0) {
      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - retYears);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];
      filteredCollabs = filteredCollabs.filter((c: any) => {
        if (c.statut_collaborateur !== "SORTI") return true;
        const lastDepart = departDateMap[c.id];
        if (!lastDepart) return true;
        return lastDepart >= cutoffStr;
      });
    }

    if (filteredCollabs) setCollaborateurs(filteredCollabs as Collaborateur[]);

    // Build reference maps
    const posteMap: Record<string, string> = {};
    ((refPostes as any[]) || []).forEach((r: any) => { posteMap[r.code] = r.libelle; });

    const uoMap: Record<string, string> = {};
    ((refUOs as any[]) || []).forEach((r: any) => { uoMap[r.id] = r.libelle; });

    const typeContratMap: Record<string, string> = {};
    ((refTypeContrats as any[]) || []).forEach((r: any) => { typeContratMap[r.code] = r.libelle; });

    // Build per-collaborateur info map
    const infoMap: Record<string, ListeInfo> = {};

    const resolvePosteLibelle = (codeInstance: string): string | undefined => {
      if (posteMap[codeInstance]) return posteMap[codeInstance];
      const parentCode = codeInstance.includes("-") ? codeInstance.split("-").slice(0, -1).join("-") : codeInstance;
      return posteMap[parentCode] || codeInstance;
    };

    ((affectations as any[]) || []).forEach((a: any) => {
      const cid = a.collaborateur_id;
      if (!infoMap[cid]) infoMap[cid] = {};
      if (!a.date_fin_uo || new Date(a.date_fin_uo) >= new Date()) {
        infoMap[cid].poste_code = a.code_poste;
        infoMap[cid].poste_libelle = a.code_poste ? resolvePosteLibelle(a.code_poste) : undefined;
        infoMap[cid].uo_id = a.unite_id;
        infoMap[cid].uo_libelle = a.unite_id ? (uoMap[a.unite_id] || undefined) : undefined;
        if (a.manager_n1_id) infoMap[cid].manager_n1_id = a.manager_n1_id;
      }
    });

    ((contrats as any[]) || []).forEach((c: any) => {
      const cid = c.collaborateur_id;
      if (!infoMap[cid]) infoMap[cid] = {};
      if (c.code_statut_contrat === "ACTIF" || !infoMap[cid].type_contrat_code) {
        infoMap[cid].type_contrat_code = c.code_type_contrat;
        infoMap[cid].type_contrat_libelle = c.code_type_contrat ? (typeContratMap[c.code_type_contrat] || c.code_type_contrat) : undefined;
      }
    });

    // Compléter infoMap avec date d'embauche (1ère date_debut de contrat)
    ((contrats as any[]) || []).forEach((c: any) => {
      const cid = c.collaborateur_id;
      if (!infoMap[cid]) infoMap[cid] = {};
      if (c.date_debut) {
        if (!infoMap[cid].date_embauche || c.date_debut < infoMap[cid].date_embauche!) {
          infoMap[cid].date_embauche = c.date_debut;
        }
      }
    });

    // Charger les données complémentaires pour les filtres avancés + modèles d'affichage.
    // NB : étab et société se déduisent via UO → étab → société (3 jointures côté JS)
    // uoFull n'est plus nécessaire : refUOs (récupéré plus haut) contient déjà
    // id + libelle + parent_id + etablissement_id (table complète).
    const uoFull = refUOs;
    const [etabs, societes2, refGenres, refNats, syndiques, cppData, planPaieList, salairesFixes] =
      await Promise.all([
        db.list<any>("etablissements", { actif: true }),
        db.list<any>("societes", { actif: true }),
        db.list<any>("ref_genre"),
        db.list<any>("ref_nationalite"),
        db.list<any>("collaborateur_syndiques", { archive: false }),
        db.list<any>("collaborateur_plan_paie", { archive: false }),
        db.list<any>("plan_paie"),
        db.list<any>("collaborateur_salaires_fixes", { archive: false }),
      ]);

    // Maps pour enrichir infoMap
    const etabLibMap: Record<string, string> = {};      // etab_id → libelle
    const etabToSoc: Record<string, string> = {};        // etab_id → societe_id
    ((etabs as any[]) || []).forEach((e: any) => {
      etabLibMap[e.id] = e.libelle;
      if (e.societe_id) etabToSoc[e.id] = e.societe_id;
    });
    const societeMap: Record<string, string> = {};       // soc_id → raison_sociale
    ((societes2 as any[]) || []).forEach((s: any) => { societeMap[s.id] = s.raison_sociale; });
    const uoToEtab: Record<string, string> = {};         // uo_id → etab_id
    ((uoFull as any[]) || []).forEach((u: any) => {
      if (u.etablissement_id) uoToEtab[u.id] = u.etablissement_id;
    });

    // Pour chaque collab : on a déjà uo_id dans infoMap (via affectations).
    // On déduit etablissement_id puis societe_id.
    Object.keys(infoMap).forEach((cid) => {
      const uoId = infoMap[cid].uo_id;
      if (uoId && uoToEtab[uoId]) {
        const etabId = uoToEtab[uoId];
        infoMap[cid].etablissement_id = etabId;
        infoMap[cid].etablissement_libelle = etabLibMap[etabId];
        if (etabToSoc[etabId]) {
          infoMap[cid].societe_id = etabToSoc[etabId];
          infoMap[cid].societe_libelle = societeMap[etabToSoc[etabId]];
        }
      }
    });

    // Plan de paie courant (date_fin null OR >= today)
    const planPaieMap: Record<string, string> = {};
    ((planPaieList as any[]) || []).forEach((p: any) => { planPaieMap[p.id] = p.libelle; });
    const todayStr = new Date().toISOString().split("T")[0];
    ((cppData as any[]) || []).forEach((cpp: any) => {
      const cid = cpp.collaborateur_id;
      if (!infoMap[cid]) infoMap[cid] = {};
      const isActive = cpp.date_debut <= todayStr && (!cpp.date_fin || cpp.date_fin >= todayStr);
      if (isActive && !infoMap[cid].plan_paie_libelle) {
        infoMap[cid].plan_paie_libelle = planPaieMap[cpp.plan_paie_id] || cpp.plan_paie_id;
      }
    });

    // Salaire de base courant
    ((salairesFixes as any[]) || []).forEach((s: any) => {
      const cid = s.collaborateur_id;
      if (!infoMap[cid]) infoMap[cid] = {};
      const isActive = s.date_debut <= todayStr && (!s.date_fin || s.date_fin >= todayStr);
      if (isActive && infoMap[cid].salaire_base === undefined) {
        infoMap[cid].salaire_base = s.salaire_base;
      }
    });

    // Statut du contrat courant
    ((contrats as any[]) || []).forEach((c: any) => {
      const cid = c.collaborateur_id;
      if (!infoMap[cid]) infoMap[cid] = {};
      if (c.code_statut_contrat === "ACTIF" && !infoMap[cid].statut_contrat) {
        infoMap[cid].statut_contrat = "ACTIF";
      }
    });

    // Noms des managers N+1 (lookup parmi les collabs déjà chargés)
    const collabNomMap: Record<string, string> = {};
    (filteredCollabs || []).forEach((c: any) => {
      collabNomMap[c.id] = `${c.prenom} ${c.nom}`;
    });
    Object.keys(infoMap).forEach((cid) => {
      const mid = infoMap[cid].manager_n1_id;
      if (mid && collabNomMap[mid]) {
        infoMap[cid].manager_n1_nom = collabNomMap[mid];
      }
    });

    // Mandats syndicaux (set d'IDs)
    const syndiqueIds = new Set<string>(((syndiques as any[]) || []).map((s: any) => s.collaborateur_id));
    Object.keys(infoMap).forEach((cid) => { infoMap[cid].has_mandat_syndical = syndiqueIds.has(cid); });
    // Et pour ceux qui n'ont aucune autre info :
    syndiqueIds.forEach((cid) => {
      if (!infoMap[cid]) infoMap[cid] = { has_mandat_syndical: true };
    });

    setListeInfoMap(infoMap);

    // Construire les options pour les multi-selects
    setOptTypesContrat(
      Object.entries(typeContratMap).map(([code, libelle]) => ({ value: code, label: libelle as string }))
    );
    setOptSocietes(
      Object.entries(societeMap).map(([id, lib]) => ({ value: id, label: lib as string }))
    );
    setOptEtablissements(
      Object.entries(etabLibMap).map(([id, lib]) => ({ value: id, label: lib as string }))
    );
    // optUOs : on inclut parent_id pour permettre l'affichage en arbre
    setOptUOs(
      ((refUOs as any[]) || []).map((u: any) => ({
        value: u.id,
        label: u.libelle,
        parent_id: u.parent_id ?? null,
      }))
    );
    setOptGenres(
      ((refGenres as any[]) || []).map((g: any) => ({ value: g.code, label: g.libelle }))
    );
    setOptNationalites(
      ((refNats as any[]) || []).map((n: any) => ({ value: n.code, label: n.libelle }))
    );

    setLoading(false);
  };

  /**
   * Définition des colonnes du tableau selon le modèle d'affichage actif.
   * Chaque colonne a un label + une fonction render(collab, info) → ReactNode | string.
   */
  type Colonne = {
    label: string;
    render: (c: Collaborateur, info: ListeInfo) => React.ReactNode;
    csv: (c: Collaborateur, info: ListeInfo) => string;  // valeur pour l'export
    hideOnMobile?: boolean;
    hideOnTablet?: boolean;
  };

  const colonnesAvatarNom: Colonne = {
    label: "Collaborateur",
    render: (c) => (
      <div className="flex items-center gap-3">
        {c.photo_path ? (
          <img src={c.photo_path} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0 border" style={{ borderColor: "hsl(var(--border))" }} />
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
            {getInitials(c.prenom, c.nom)}
          </div>
        )}
        <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{c.prenom} {c.nom}</span>
      </div>
    ),
    csv: (c) => `${c.prenom} ${c.nom}`,
  };

  const colonneMatricule: Colonne = {
    label: "Matricule",
    render: (c) => (
      <span className="text-xs font-bold font-mono" style={{ color: "hsl(var(--accent))" }}>#{c.matricule}</span>
    ),
    csv: (c) => c.matricule,
  };

  const colonneStatut: Colonne = {
    label: "Statut",
    render: (c) => {
      const s = getStatutStyle(c.statut_collaborateur);
      return (
        <span
          className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
          style={{ background: s.bg, color: s.color }}
        >
          {s.label}
        </span>
      );
    },
    csv: (c) => c.statut_collaborateur,
  };

  const colonnesParModele: Record<ModeleAffichage, Colonne[]> = {
    standard: [
      colonneMatricule,
      colonnesAvatarNom,
      { label: "Poste", render: (_, i) => i.poste_libelle, csv: (_, i) => i.poste_libelle ?? "", hideOnMobile: true },
      { label: "UO", render: (_, i) => i.uo_libelle, csv: (_, i) => i.uo_libelle ?? "", hideOnTablet: true },
      { label: "Type contrat", render: (_, i) => i.type_contrat_libelle, csv: (_, i) => i.type_contrat_libelle ?? "", hideOnTablet: true },
      colonneStatut,
    ],
    identite: [
      colonneMatricule,
      colonnesAvatarNom,
      { label: "Genre", render: (c) => c.code_genre, csv: (c) => c.code_genre ?? "" },
      { label: "Naissance", render: (c) => c.date_naissance ? new Date(c.date_naissance).toLocaleDateString("fr-FR") : "", csv: (c) => c.date_naissance ?? "", hideOnMobile: true },
      { label: "Téléphone", render: (c) => c.gsm || c.telephone, csv: (c) => c.gsm || c.telephone || "", hideOnMobile: true },
      { label: "Email", render: (c) => c.email_professionnel, csv: (c) => c.email_professionnel ?? "", hideOnTablet: true },
      { label: "CIN", render: (c) => c.cin, csv: (c) => c.cin ?? "", hideOnTablet: true },
    ],
    contrats: [
      colonneMatricule,
      colonnesAvatarNom,
      { label: "Type contrat", render: (_, i) => i.type_contrat_libelle, csv: (_, i) => i.type_contrat_libelle ?? "" },
      { label: "Date embauche", render: (_, i) => i.date_embauche ? new Date(i.date_embauche).toLocaleDateString("fr-FR") : "", csv: (_, i) => i.date_embauche ?? "", hideOnMobile: true },
      { label: "Statut contrat", render: (_, i) => i.statut_contrat, csv: (_, i) => i.statut_contrat ?? "", hideOnTablet: true },
      { label: "Société", render: (_, i) => i.societe_libelle, csv: (_, i) => i.societe_libelle ?? "", hideOnTablet: true },
      colonneStatut,
    ],
    paie: [
      colonneMatricule,
      colonnesAvatarNom,
      { label: "Plan paie", render: (_, i) => i.plan_paie_libelle, csv: (_, i) => i.plan_paie_libelle ?? "" },
      { label: "Salaire base", render: (_, i) => i.salaire_base !== undefined ? i.salaire_base.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "", csv: (_, i) => i.salaire_base !== undefined ? String(i.salaire_base) : "", hideOnMobile: true },
      { label: "Société", render: (_, i) => i.societe_libelle, csv: (_, i) => i.societe_libelle ?? "", hideOnTablet: true },
      colonneStatut,
    ],
    affectation: [
      colonneMatricule,
      colonnesAvatarNom,
      { label: "UO", render: (_, i) => i.uo_libelle, csv: (_, i) => i.uo_libelle ?? "" },
      { label: "Poste", render: (_, i) => i.poste_libelle, csv: (_, i) => i.poste_libelle ?? "", hideOnMobile: true },
      { label: "Établissement", render: (_, i) => i.etablissement_libelle, csv: (_, i) => i.etablissement_libelle ?? "", hideOnTablet: true },
      { label: "Manager N+1", render: (_, i) => i.manager_n1_nom, csv: (_, i) => i.manager_n1_nom ?? "", hideOnTablet: true },
    ],
  };

  const colonnes = colonnesParModele[modele];

  /**
   * Exporte la liste filtrée en CSV (UTF-8 BOM pour Excel).
   * N'exporte QUE les colonnes du modèle d'affichage actif.
   */
  function exportCSV(rows: Collaborateur[], infoMap: Record<string, ListeInfo>, mod: ModeleAffichage) {
    const cols = colonnesParModele[mod];
    const escape = (v: string) => {
      const s = String(v ?? "");
      if (s.includes(";") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const header = cols.map(c => escape(c.label)).join(";");
    const lines = rows.map(c => {
      const info = infoMap[c.id] || {};
      return cols.map(col => escape(col.csv(c, info))).join(";");
    });
    const csv = "\uFEFF" + header + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = `collaborateurs-${mod}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Calcule l'ancienneté en années depuis la date d'embauche. */
  const calcAnciennete = (dateEmbauche?: string): number | null => {
    if (!dateEmbauche) return null;
    const d = new Date(dateEmbauche);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
  };

  const filtered = collaborateurs.filter((c) => {
    const info = listeInfoMap[c.id] || {};

    // 1) Recherche texte
    const matchSearch = `${c.prenom} ${c.nom} ${c.matricule} ${c.email_professionnel || ""} ${info.poste_libelle || ""} ${info.uo_libelle || ""}`.toLowerCase().includes(search.toLowerCase());

    // 2) Filtre statut (filtres rapides)
    let matchStatut: boolean;
    if (filterStatut === "all") matchStatut = true;
    else if (filterStatut === "hors_sortis") matchStatut = c.statut_collaborateur !== "SORTI";
    else matchStatut = c.statut_collaborateur === filterStatut;

    // 3) Filtres avancés (cumulables)
    const f = filtresAvances;

    if (f.type_contrat_codes.length > 0 && (!info.type_contrat_code || !f.type_contrat_codes.includes(info.type_contrat_code))) return false;
    if (f.societe_ids.length > 0 && (!info.societe_id || !f.societe_ids.includes(info.societe_id))) return false;
    if (f.etablissement_ids.length > 0 && (!info.etablissement_id || !f.etablissement_ids.includes(info.etablissement_id))) return false;
    // Sans UO / sans poste (mutuellement exclusifs avec leurs filtres positifs respectifs)
    if (f.sans_uo && info.uo_id) return false;
    if (f.sans_poste && info.poste_code) return false;
    // Filtre positif sur UO (les uo_ids incluent déjà les descendants si racine cochée)
    if (!f.sans_uo && f.uo_ids.length > 0 && (!info.uo_id || !f.uo_ids.includes(info.uo_id))) return false;
    if (f.genres.length > 0 && (!c.code_genre || !f.genres.includes(c.code_genre))) return false;
    if (f.code_nationalites.length > 0 && (!c.code_nationalite || !f.code_nationalites.includes(c.code_nationalite))) return false;

    if (f.date_embauche_debut && (!info.date_embauche || info.date_embauche < f.date_embauche_debut)) return false;
    if (f.date_embauche_fin && (!info.date_embauche || info.date_embauche > f.date_embauche_fin)) return false;

    if (f.anciennete_min || f.anciennete_max) {
      const anc = calcAnciennete(info.date_embauche);
      if (anc === null) return false;
      if (f.anciennete_min && anc < parseInt(f.anciennete_min, 10)) return false;
      if (f.anciennete_max && anc > parseInt(f.anciennete_max, 10)) return false;
    }

    if (f.has_mandat_syndical !== null && (info.has_mandat_syndical ?? false) !== f.has_mandat_syndical) return false;

    return matchSearch && matchStatut;
  });

  const nbFiltresActifs = countFiltres(filtresAvances);

  const getStatutStyle = (s: string) => {
    if (s === "ACTIF") return { bg: "hsl(84 55% 50% / 0.15)", color: "hsl(84 55% 35%)" };
    if (s === "INACTIF") return { bg: "hsl(215 20% 55% / 0.15)", color: "hsl(215 20% 40%)" };
    return { bg: "hsl(39 95% 50% / 0.15)", color: "hsl(39 95% 35%)" };
  };

  const getInitials = (prenom: string, nom: string) =>
    `${prenom?.[0] || ""}${nom?.[0] || ""}`.toUpperCase();

  const showLoadingSpinner = loading || (isManager && popLoading);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Collaborateurs</h1>
          <p className="page-subtitle">
            {showLoadingSpinner ? "Chargement…" : `${filtered.length} collaborateur(s)`}
            {isManager && !showLoadingSpinner && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full"
                style={{ background: "hsl(39 95% 50% / 0.15)", color: "hsl(39 95% 35%)" }}>
                Ma population
              </span>
            )}
          </p>
        </div>
        {/* RG-MGR-COLLAB-01 : le manager ne peut pas créer de collaborateur */}
        {!isManager && (
          <Button
            onClick={() => navigate("/collaborateurs/nouveau")}
            className="flex items-center gap-2"
            style={{ background: "hsl(var(--accent))", color: "white" }}
          >
            <Plus size={16} /> Nouveau collaborateur
          </Button>
        )}
      </div>

      {/* Filtres + toggle vue */}
      <div className="flex items-center gap-3 mb-5 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (nom, matricule, poste, UO)…"
              className="pl-9 pr-4 py-2 rounded-lg text-sm border outline-none w-80"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {STATUTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setFilterStatut(s.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                style={{
                  background: filterStatut === s.value ? "hsl(var(--accent))" : "transparent",
                  borderColor: filterStatut === s.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                  color: filterStatut === s.value ? "white" : "hsl(var(--foreground))",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sélecteur de modèles d'affichage (uniquement en vue tableau) */}
        {viewMode === "list" && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
              Modèle :
            </span>
            {([
              { value: "standard", label: "Standard" },
              { value: "identite", label: "Identité" },
              { value: "contrats", label: "Contrats" },
              { value: "paie", label: "Paie" },
              { value: "affectation", label: "Affectation" },
            ] as { value: ModeleAffichage; label: string }[]).map(m => (
              <button
                key={m.value}
                onClick={() => setModele(m.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={{
                  background: modele === m.value ? "hsl(var(--accent))" : "transparent",
                  borderColor: modele === m.value ? "hsl(var(--accent))" : "hsl(var(--border))",
                  color: modele === m.value ? "white" : "hsl(var(--foreground))",
                }}
                type="button"
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Bouton Filtres avancés */}
        <button
          onClick={() => setShowFilters(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors relative"
          style={{
            borderColor: nbFiltresActifs > 0 ? "hsl(var(--accent))" : "hsl(var(--border))",
            background: nbFiltresActifs > 0 ? "hsl(var(--accent) / 0.08)" : "transparent",
            color: nbFiltresActifs > 0 ? "hsl(var(--accent))" : "hsl(var(--foreground))",
          }}
          type="button"
        >
          <Filter size={14} /> Filtres avancés
          {nbFiltresActifs > 0 && (
            <span
              className="ml-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full w-5 h-5"
              style={{ background: "hsl(var(--accent))", color: "white" }}
            >
              {nbFiltresActifs}
            </span>
          )}
        </button>

        {/* Bouton Export CSV */}
        <button
          onClick={() => exportCSV(filtered, listeInfoMap, modele)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
          type="button"
          title="Exporter la liste filtrée en CSV"
        >
          <Download size={14} /> Export CSV
        </button>

        {/* Boutons de bascule mode étiquette / liste */}
        <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <button
            onClick={() => setViewMode("card")}
            title="Mode étiquettes"
            className="p-2 transition-colors"
            style={{
              background: viewMode === "card" ? "hsl(var(--accent))" : "hsl(var(--card))",
              color: viewMode === "card" ? "white" : "hsl(var(--muted-foreground))",
            }}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            title="Mode liste"
            className="p-2 transition-colors"
            style={{
              background: viewMode === "list" ? "hsl(var(--accent))" : "hsl(var(--card))",
              color: viewMode === "list" ? "white" : "hsl(var(--muted-foreground))",
            }}
          >
            <List size={15} />
          </button>
        </div>
      </div>

      {/* Contenu */}
      {showLoadingSpinner ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <User size={32} className="mb-3" style={{ color: "hsl(var(--muted-foreground))" }} />
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            {isManager ? "Aucun collaborateur dans votre population" : "Aucun collaborateur trouvé"}
          </p>
        </div>
      ) : viewMode === "card" ? (
        /* ── Mode étiquettes (grille de cartes) ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((c) => {
            const statut = getStatutStyle(c.statut_collaborateur);
            const info = listeInfoMap[c.id] || {};
            return (
              <div
                key={c.id}
                onClick={() => {
                  // RG-NAV-CTX-01 (Adil DAIA) : alimenter le contexte de navigation
                  setListNavigationContext("collaborateurs", filtered.map(x => x.id));
                  navigate(`/collaborateurs/${c.id}`);
                }}
                className="text-left rounded-xl p-4 border transition-all hover:shadow-md group cursor-pointer relative"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {c.photo_path ? (
                      <img src={c.photo_path} alt={`${c.prenom} ${c.nom}`} className="w-10 h-10 rounded-full object-cover flex-shrink-0 border" style={{ borderColor: "hsl(var(--border))" }} />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                        {getInitials(c.prenom, c.nom)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: "hsl(var(--foreground))" }}>{c.prenom} {c.nom}</p>
                      <p className="text-xs font-bold" style={{ color: "hsl(var(--accent))" }}>#{c.matricule}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(notifMap[c.id] || []).length > 0 && (
                      <CollabNotifBadge collaborateurId={c.id} notifications={notifMap[c.id]} />
                    )}
                    <ChevronRight size={14} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "hsl(var(--accent))" }} />
                  </div>
                </div>

                <div className="space-y-1">
                  {info.poste_libelle && (
                    <div className="flex items-center gap-1.5 text-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <Briefcase size={11} /><span className="truncate">{info.poste_libelle}</span>
                    </div>
                  )}
                  {info.uo_libelle && (
                    <div className="flex items-center gap-1.5 text-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <Building2 size={11} /><span className="truncate">{info.uo_libelle}</span>
                    </div>
                  )}
                  {c.email_professionnel && (
                    <div className="flex items-center gap-1.5 text-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <Mail size={11} /><span className="truncate">{c.email_professionnel}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: statut.bg, color: statut.color }}>
                    {c.statut_collaborateur}
                  </span>
                  {info.type_contrat_libelle && (
                    <span className="text-xs truncate max-w-[100px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {info.type_contrat_libelle}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Mode liste (tableau) ── */
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
                {colonnes.map((col, i) => (
                  <th
                    key={i}
                    className={`text-left px-4 py-3 font-medium text-xs ${col.hideOnMobile ? "hidden md:table-cell" : ""} ${col.hideOnTablet ? "hidden lg:table-cell" : ""}`}
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => {
                const info = listeInfoMap[c.id] || {};
                return (
                  <tr
                    key={c.id}
                    onClick={() => {
                  // RG-NAV-CTX-01 (Adil DAIA) : alimenter le contexte de navigation
                  setListNavigationContext("collaborateurs", filtered.map(x => x.id));
                  navigate(`/collaborateurs/${c.id}`);
                }}
                    className="cursor-pointer transition-colors group"
                    style={{
                      background: idx % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.3)",
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--accent) / 0.05)")}
                    onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.3)")}
                  >
                    {colonnes.map((col, i) => (
                      <td
                        key={i}
                        className={`px-4 py-3 text-xs ${col.hideOnMobile ? "hidden md:table-cell" : ""} ${col.hideOnTablet ? "hidden lg:table-cell" : ""}`}
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {col.render(c, info) || <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "hsl(var(--accent))" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modale Filtres avancés */}
      <CollaborateursFiltresAvances
        open={showFilters}
        onClose={() => setShowFilters(false)}
        value={filtresAvances}
        onApply={setFiltresAvances}
        optTypesContrat={optTypesContrat}
        optSocietes={optSocietes}
        optEtablissements={optEtablissements}
        optUOs={optUOs}
        optGenres={optGenres}
        optNationalites={optNationalites}
      />
    </div>
  );
};

export default CollaborateursPage;
