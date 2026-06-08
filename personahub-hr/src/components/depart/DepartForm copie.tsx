import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { api, db } from "@/lib/api"; // db: encore utilisé pour db.create
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, DoorOpen, AlertTriangle, CalendarDays, Info, Briefcase, Building2, UserCircle2 } from "lucide-react";
import { format, isPast, isToday, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

// =====================================================
// RG-DEP-FORM-01 (Adil DAIA) : Formulaire de saisie d'un départ
// - Date passée ou aujourd'hui → RG-DEP-01 (exécution immédiate)
// - Date future               → RG-DEP-02 (phase de départ planifiée)
// =====================================================

const MOTIFS_DEPART = [
  "Démission",
  "Fin de contrat (CDD)",
  "Licenciement",
  "Retraite",
  "Rupture conventionnelle",
  "Décès",
  "Invalidité",
  "Abandon de poste",
  "Mobilité externe",
  "Fin de mission",
  "Autre",
];

const schema = z.object({
  collaborateur_id: z.string().uuid("Collaborateur requis"),
  date_depart: z.string().min(1, "Date de départ requise"),
  motif_depart: z.string().min(1, "Motif requis"),
  commentaire: z.string().optional(),
  reference_decision: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  collaborateurId?: string; // pré-rempli depuis la fiche collab
  onClose: () => void;
  onSuccess: () => void;
}

const DepartForm: React.FC<Props> = ({ collaborateurId, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [searchCollab, setSearchCollab] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      collaborateur_id: collaborateurId ?? "",
      date_depart: "",
      motif_depart: "",
      commentaire: "",
      reference_decision: "",
    },
  });

  const watchDate = watch("date_depart");
  const watchCollabId = watch("collaborateur_id");

  // Détermination du mode selon la date
  const isImmediate = watchDate
    ? isPast(parseISO(watchDate)) || isToday(parseISO(watchDate))
    : false;

  // Recherche de collaborateurs actifs
  const { data: collaborateurs = [] } = useQuery({
    queryKey: ["collabs-depart-search", searchCollab],
    queryFn: async () => {
      const params = new URLSearchParams({
        select: "id,nom,prenom,matricule,statut_collaborateur",
        archive: "eq.false",
        statut_collaborateur: "in.(ACTIF,EN_DEPART)",
        order: "nom",
        limit: "30",
      });
      if (searchCollab.trim()) {
        const words = searchCollab.trim().split(/\s+/);
        const conds = words
          .flatMap(w => [`nom.ilike.*${w}*`, `prenom.ilike.*${w}*`, `matricule.ilike.*${w}*`])
          .join(",");
        params.set("or", `(${conds})`);
      }
      const data: any[] = await api.get(`/db/collaborateurs?${params.toString()}`);
      return data || [];
    },
  });

  // ── Référentiels (libellés + couleurs) chargés une seule fois, mis en cache ──
  const { data: typesContrats = [] } = useQuery<any[]>({
    queryKey: ["ref_type_contrat-depart"],
    queryFn: async () => {
      try { return await api.get("/db/ref_type_contrat"); } catch { return []; }
    },
    staleTime: 5 * 60 * 1000,
  });
  const { data: statutsContrat = [] } = useQuery<any[]>({
    queryKey: ["ref_statut_contrat-depart"],
    queryFn: async () => {
      try { return await api.get("/db/ref_statut_contrat"); } catch { return []; }
    },
    staleTime: 5 * 60 * 1000,
  });

  // ── Pavé récapitulatif : contrat actif + affectation courante ──────────
  // Queries découplées : si l'une plante, l'autre s'affiche quand même.
  // collaborateur_affectations a unite_id + code_poste, dates par date_debut_uo/date_fin_uo.
  // Les libellés UO et poste viennent de unite_organisationnelle + ref_poste.
  const { data: collabContext, isLoading: loadingInfo, error: contextError } = useQuery({
    queryKey: ["collab-context-depart", watchCollabId],
    enabled: !!watchCollabId,
    queryFn: async () => {
      if (!watchCollabId) return null;
      const today = new Date().toISOString().split("T")[0];

      // 0. Infos collab (photo + nom)
      let collabInfos: any = null;
      try {
        const c: any[] = await api.get(`/db/collaborateurs?id=eq.${watchCollabId}&limit=1`);
        collabInfos = c?.[0] || null;
      } catch (e) {
        console.warn("[DepartForm] Erreur chargement collab:", e);
      }

      // 1. Contrat actif
      let contrat: any = null;
      try {
        const contrats: any[] = await api.get(
          `/db/collaborateur_contrats?` +
          `collaborateur_id=eq.${watchCollabId}` +
          `&archive=eq.false` +
          `&date_sortie=is.null` +
          `&order=date_debut.desc&limit=1`
        );
        contrat = contrats?.[0] || null;
      } catch (e) {
        console.error("[DepartForm] Erreur chargement contrat:", e);
      }

      // 2. Affectation la plus récente non archivée
      let aRaw: any = null;
      try {
        const affs: any[] = await api.get(
          `/db/collaborateur_affectations?` +
          `collaborateur_id=eq.${watchCollabId}` +
          `&archive=eq.false` +
          `&order=date_debut_uo.desc&limit=1`
        );
        aRaw = affs?.[0] || null;
        // Filtre côté JS : si date_fin_uo dans le passé → considérer comme non active
        if (aRaw?.date_fin_uo && aRaw.date_fin_uo < today) {
          aRaw = null;
        }
      } catch (e) {
        console.error("[DepartForm] Erreur chargement affectation:", e);
      }

      // 3. Libellés UO + intitulé du POSTE PARENT (pas l'instance)
      // Schéma identifié :
      //   - unites_organisationnelles (id uuid, code, libelle, couleur?)
      //   - ref_poste_instances (code = "DIRPLCMC-001", code_poste = "DIRPLCMC")
      //   - ref_poste (code = "DIRPLCMC", libelle = "Directeur ...")
      //   - vue v_postes_avec_instances qui peut déjà joindre les deux
      let uo: any = null;
      if (aRaw?.unite_id) {
        try {
          const uoData: any[] = await api.get(
            `/db/unites_organisationnelles?id=eq.${aRaw.unite_id}&limit=1`
          );
          uo = uoData?.[0] || null;
        } catch (e) {
          console.warn("[DepartForm] UO lookup unites_organisationnelles:", e);
        }
      }

      // Pour le poste, on veut le libellé du POSTE PARENT (pas l'instance "-001")
      let poste: any = null;
      if (aRaw?.code_poste) {
        const codePosteInst = String(aRaw.code_poste);
        const codePosteParent = codePosteInst.split("-")[0]; // "DIRPLCMC-001" → "DIRPLCMC"

        // 1. Tentative via la vue (1 requête qui joint tout)
        try {
          const vData: any[] = await api.get(
            `/db/v_postes_avec_instances?code_instance=eq.${encodeURIComponent(codePosteInst)}&limit=1`
          );
          if (vData?.[0]) poste = vData[0];
        } catch { /* la vue n'a peut-être pas ce nom de colonne — on continue */ }

        // 2. Fallback : ref_poste directement par code parent
        if (!poste?.libelle_poste && !poste?.libelle) {
          try {
            const rpData: any[] = await api.get(
              `/db/ref_poste?code=eq.${encodeURIComponent(codePosteParent)}&limit=1`
            );
            if (rpData?.[0]) {
              poste = { ...(poste || {}), code_poste_parent: codePosteParent, ...rpData[0] };
            }
          } catch (e) {
            console.warn("[DepartForm] ref_poste lookup:", e);
          }
        }
      }

      const affectation = aRaw ? {
        code_uo: uo?.code || null,
        libelle_uo: uo?.libelle || uo?.intitule || uo?.nom || null,
        couleur_uo: uo?.couleur || uo?.color || null,
        code_instance_poste: aRaw.code_poste || null,
        code_poste_parent: poste?.code_poste_parent || poste?.code_poste || null,
        libelle_poste: poste?.libelle_poste || poste?.libelle || poste?.intitule || poste?.nom || null,
        date_debut_uo: aRaw.date_debut_uo || null,
        date_debut_poste: aRaw.date_debut_poste || null,
        raw: aRaw,
      } : null;

      return { contrat, affectation, collabInfos };
    },
  });

  // Helpers : libellé + couleur depuis les référentiels paramétrés
  const getTypeContratInfo = (code: string | null | undefined) => {
    if (!code) return { libelle: "", couleur: "hsl(210 80% 50%)" };
    const t = typesContrats.find((x: any) => x.code === code);
    return {
      libelle: t?.libelle || code,
      couleur: t?.couleur || "hsl(210 80% 50%)", // bleu par défaut
    };
  };
  const getStatutInfo = (code: string | null | undefined) => {
    if (!code) return { libelle: "", couleur: "hsl(0 0% 50%)" };
    const s = statutsContrat.find((x: any) => x.code === code);
    // Fallback : ACTIF/EN_COURS → vert, sinon gris
    const fallback = (code === "ACTIF" || code === "EN_COURS") ? "hsl(140 60% 40%)" : "hsl(0 0% 50%)";
    return {
      libelle: s?.libelle || code,
      couleur: s?.couleur || fallback,
    };
  };

  const selectedCollab = collaborateurs.find(c => c.id === watchCollabId) ?? null;

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      await db.create("collaborateur_departs", {
        collaborateur_id: data.collaborateur_id,
        date_depart: data.date_depart,
        motif_depart: data.motif_depart,
        commentaire: data.commentaire || null,
        reference_decision: data.reference_decision || null,
        created_by: user?.id,
        updated_by: user?.id,
      });

      toast({
        title: isImmediate ? "Départ enregistré et traité" : "Départ planifié",
        description: isImmediate
          ? "Le collaborateur est marqué SORTI et tous ses éléments ont été clôturés."
          : `Le collaborateur sera traité le ${format(parseISO(data.date_depart), "dd/MM/yyyy", { locale: fr })}.`,
      });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Résoudre l'URL de la photo (différents noms de colonnes possibles)
  const getPhotoUrl = (info: any): string | null => {
    if (!info) return null;
    const raw = info.photo_path || info.photo_url || info.avatar_url || info.photo || info.image_url || null;
    if (!raw) return null;
    // Si chemin relatif → préfixer avec /api/v1/storage
    if (raw.startsWith("http")) return raw;
    if (raw.startsWith("/")) return raw;
    return `/api/v1/storage/${raw}`;
  };
  const photoUrl = getPhotoUrl(collabContext?.collabInfos);

  // Composant Avatar : photo si dispo, sinon initiales
  const Avatar: React.FC<{ size?: number; initiales: string }> = ({ size = 32, initiales }) => (
    photoUrl ? (
      <img src={photoUrl} alt=""
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, border: "1px solid hsl(var(--border))" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
    ) : (
      <div className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
        style={{
          width: size, height: size,
          fontSize: size <= 24 ? 10 : 12,
          background: "hsl(var(--primary) / 0.1)",
          color: "hsl(var(--primary))",
        }}>
        {initiales}
      </div>
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
          <div className="flex items-center gap-2">
            <DoorOpen size={18} style={{ color: "hsl(var(--accent))" }} />
            <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>
              Enregistrer un départ
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
            style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
          {/* Sélection collaborateur */}
          {collaborateurId ? (
            // Affiché en lecture seule si pré-rempli
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
                Collaborateur
              </Label>
              {selectedCollab && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
                  <Avatar size={36} initiales={`${selectedCollab.prenom?.[0] || ""}${selectedCollab.nom?.[0] || ""}`} />
                  <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                    {selectedCollab.prenom} {selectedCollab.nom}
                  </span>
                  <span className="text-xs ml-auto" style={{ color: "hsl(var(--muted-foreground))" }}>
                    #{selectedCollab.matricule}
                  </span>
                </div>
              )}
              <input type="hidden" {...register("collaborateur_id")} />
            </div>
          ) : (
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
                Collaborateur *
              </Label>
              <Input
                placeholder="Rechercher par nom, prénom ou matricule…"
                value={searchCollab}
                onChange={e => {
                  setSearchCollab(e.target.value);
                  // si on retape après sélection, on invalide la sélection courante
                  if (watchCollabId) setValue("collaborateur_id", "", { shouldValidate: false });
                }}
                className="mb-2 h-9 text-sm"
                autoComplete="off"
              />
              {/* La liste n'apparaît que si :
                  - on a tapé au moins 2 caractères
                  - ET on n'a pas encore validé une sélection */}
              {searchCollab.trim().length >= 2 && !watchCollabId && (
                <div className="max-h-48 overflow-y-auto rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
                  {collaborateurs.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Aucun collaborateur trouvé
                    </p>
                  ) : collaborateurs.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => {
                        setValue("collaborateur_id", c.id, { shouldValidate: true });
                        setSearchCollab(`${c.prenom} ${c.nom}`);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:opacity-80 transition-opacity border-b last:border-0"
                      style={{
                        borderColor: "hsl(var(--border) / 0.4)",
                        background: "hsl(var(--card))",
                        color: "hsl(var(--foreground))",
                      }}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                        {c.prenom?.[0]}{c.nom?.[0]}
                      </div>
                      <span>{c.prenom} {c.nom}</span>
                      <span className="ml-auto text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>#{c.matricule}</span>
                      {c.statut_collaborateur === "EN_DEPART" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
                          style={{ background: "hsl(45 100% 50% / 0.15)", color: "hsl(45 100% 30%)" }}>
                          En départ
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {/* Aperçu du collab sélectionné après recherche libre */}
              {watchCollabId && selectedCollab && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg mt-1"
                  style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
                  <Avatar size={36} initiales={`${selectedCollab.prenom?.[0] || ""}${selectedCollab.nom?.[0] || ""}`} />
                  <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                    {selectedCollab.prenom} {selectedCollab.nom}
                  </span>
                  <span className="text-xs ml-auto" style={{ color: "hsl(var(--muted-foreground))" }}>
                    #{selectedCollab.matricule}
                  </span>
                </div>
              )}
              {errors.collaborateur_id && (
                <p className="text-xs mt-1" style={{ color: "hsl(var(--destructive))" }}>{errors.collaborateur_id.message}</p>
              )}
            </div>
          )}

          {/* Pavé récapitulatif : situation actuelle du collaborateur */}
          {watchCollabId && (() => {
            const c = collabContext?.contrat;
            const a = collabContext?.affectation;
            const ti = getTypeContratInfo(c?.code_type_contrat);
            const si = getStatutInfo(c?.code_statut_contrat);
            return (
              <div className="rounded-xl border overflow-hidden shadow-sm"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                {/* En-tête */}
                <div className="px-4 py-2.5 border-b flex items-center justify-between"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}>
                  <div className="flex items-center gap-1.5">
                    <Briefcase size={13} style={{ color: "hsl(var(--accent))" }} />
                    <span className="text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: "hsl(var(--foreground))" }}>
                      Situation actuelle
                    </span>
                  </div>
                  {loadingInfo && (
                    <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Chargement…
                    </span>
                  )}
                  {contextError && (
                    <span className="text-[10px]" style={{ color: "hsl(0 70% 45%)" }}>
                      Erreur de chargement
                    </span>
                  )}
                </div>

                {!loadingInfo && (
                  <div className="grid grid-cols-2 divide-x" style={{ borderColor: "hsl(var(--border))" }}>
                    {/* ─ Colonne CONTRAT ───────────────────────────── */}
                    <div className="p-4 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: "hsl(var(--muted-foreground))" }}>
                        Contrat
                      </p>
                      {c ? (
                        <>
                          <div className="space-y-1">
                            {/* Libellé du type contrat — gros, dans la couleur paramétrée */}
                            <p className="text-sm font-bold leading-tight"
                              style={{ color: ti.couleur }}
                              title={c.code_type_contrat}>
                              {ti.libelle}
                            </p>
                            {/* Statut — petit, clignotant doux */}
                            {c.code_statut_contrat && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider animate-pulse"
                                style={{ color: si.couleur }}>
                                <span className="inline-block w-1.5 h-1.5 rounded-full"
                                  style={{ background: si.couleur }} />
                                {si.libelle}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] space-y-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                            <p>
                              Du <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                {c.date_debut ? format(parseISO(c.date_debut), "dd/MM/yyyy", { locale: fr }) : "—"}
                              </span>
                              {c.date_fin && (
                                <> au <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                  {format(parseISO(c.date_fin), "dd/MM/yyyy", { locale: fr })}
                                </span></>
                              )}
                              {!c.date_fin && <span className="ml-1 italic">(sans date de fin)</span>}
                            </p>
                            {c.reference_contrat && (
                              <p className="text-[10px] font-mono pt-0.5"
                                style={{ color: "hsl(var(--muted-foreground))" }}>
                                {c.reference_contrat}
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Aucun contrat actif
                        </p>
                      )}
                    </div>

                    {/* ─ Colonne AFFECTATION ───────────────────────── */}
                    <div className="p-4 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: "hsl(var(--muted-foreground))" }}>
                        Affectation
                      </p>
                      {a ? (
                        <div className="space-y-2">
                          {/* ─ Unité organisationnelle ─ */}
                          {(a.libelle_uo || a.raw?.unite_id) && (
                            <div>
                              <div className="flex items-start gap-1.5">
                                <Building2 size={13}
                                  style={{ color: a.couleur_uo || "hsl(var(--accent))", marginTop: 1, flexShrink: 0 }} />
                                <p className="text-sm font-semibold leading-tight"
                                  style={{ color: a.couleur_uo || "hsl(var(--foreground))" }}>
                                  {a.libelle_uo || "Unité organisationnelle"}
                                </p>
                              </div>
                              {a.date_debut_uo && (
                                <p className="text-[11px] pl-[18px]"
                                  style={{ color: "hsl(var(--muted-foreground))" }}>
                                  Affecté(e) le <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                    {format(parseISO(a.date_debut_uo), "dd/MM/yyyy", { locale: fr })}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}
                          {/* ─ Poste (intitulé du poste parent, pas l'instance) ─ */}
                          {(a.libelle_poste || a.code_instance_poste) && (
                            <div className="pt-1 border-t" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                              <div className="flex items-start gap-1.5 pt-1">
                                <UserCircle2 size={13}
                                  style={{ color: "hsl(var(--foreground))", marginTop: 1, flexShrink: 0 }} />
                                <p className="text-xs font-medium leading-tight"
                                  style={{ color: "hsl(var(--foreground))" }}>
                                  {a.libelle_poste || a.code_poste_parent || a.code_instance_poste}
                                </p>
                              </div>
                              {/* Sous-ligne : code instance + (parent si différent) */}
                              {(a.code_instance_poste || a.code_poste_parent) && (
                                <p className="text-[10px] font-mono pl-[18px]"
                                  style={{ color: "hsl(var(--muted-foreground))" }}>
                                  {a.code_instance_poste}
                                  {a.code_poste_parent && a.code_poste_parent !== a.code_instance_poste && (
                                    <span> · {a.code_poste_parent}</span>
                                  )}
                                </p>
                              )}
                              {a.date_debut_poste && (
                                <p className="text-[11px] pl-[18px]"
                                  style={{ color: "hsl(var(--muted-foreground))" }}>
                                  Attribué(e) le <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                    {format(parseISO(a.date_debut_poste), "dd/MM/yyyy", { locale: fr })}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Aucune affectation active
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Date de départ */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
              Date de départ *
            </Label>
            <Input type="date" {...register("date_depart")} className="h-9 text-sm" />
            {errors.date_depart && (
              <p className="text-xs mt-1" style={{ color: "hsl(var(--destructive))" }}>{errors.date_depart.message}</p>
            )}
            {/* Indicateur RG */}
            {watchDate && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg"
                style={{
                  background: isImmediate ? "hsl(0 70% 50% / 0.08)" : "hsl(45 100% 50% / 0.10)",
                  border: `1px solid ${isImmediate ? "hsl(0 70% 50% / 0.2)" : "hsl(45 100% 50% / 0.25)"}`,
                }}>
                {isImmediate ? (
                  <AlertTriangle size={14} style={{ color: "hsl(0 70% 40%)", flexShrink: 0, marginTop: 1 }} />
                ) : (
                  <Info size={14} style={{ color: "hsl(45 100% 35%)", flexShrink: 0, marginTop: 1 }} />
                )}
                <p className="text-xs" style={{ color: isImmediate ? "hsl(0 70% 40%)" : "hsl(45 100% 35%)" }}>
                  {isImmediate
                    ? "RG-DEP-01 : Date passée → Le départ sera exécuté immédiatement. Toutes les dates de fin seront clôturées et le poste libéré."
                    : "RG-DEP-02 : Date future → Le collaborateur sera mis en phase de départ. L'exécution se déclenchera automatiquement à l'échéance."}
                </p>
              </div>
            )}
          </div>

          {/* Motif */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
              Motif de départ *
            </Label>
            <select {...register("motif_depart")}
              className="w-full h-9 text-sm rounded-lg border px-3"
              style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              <option value="">— Sélectionner —</option>
              {MOTIFS_DEPART.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {errors.motif_depart && (
              <p className="text-xs mt-1" style={{ color: "hsl(var(--destructive))" }}>{errors.motif_depart.message}</p>
            )}
          </div>

          {/* Référence décision */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
              Référence de la décision
            </Label>
            <Input {...register("reference_decision")} placeholder="Ex : DRH/2025/042" className="h-9 text-sm" />
          </div>

          {/* Commentaire */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
              Commentaire
            </Label>
            <Textarea {...register("commentaire")} placeholder="Observations, circonstances particulières…" rows={3} className="text-sm resize-none" />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}
              style={{ background: isImmediate ? "hsl(0 70% 45%)" : "hsl(var(--accent))", color: "white" }}>
              {submitting
                ? "Enregistrement…"
                : isImmediate
                  ? "Confirmer le départ"
                  : "Planifier le départ"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DepartForm;
