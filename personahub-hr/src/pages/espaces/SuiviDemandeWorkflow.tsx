import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  CheckCircle2, Circle, Clock, XCircle, Loader2, GitBranch,
  ChevronRight, Workflow, Bell, Mail, User, Users,
} from "lucide-react";

/**
 * SuiviDemandeWorkflow — affiche le déroulé réel du circuit de validation
 * d'une demande (table source + id), à partir du moteur de workflow.
 *
 * 1) GET /workflow/instance-of/{table}/{id}  → trouve l'instance liée à l'objet
 * 2) GET /workflow/instances/{instance_id}   → instance + etapes + actions
 *
 * Affiche une FRISE verticale (étapes franchies / en cours / à venir, dates, acteurs)
 * + un bouton "Schéma" qui ouvre une vue horizontale colorée selon l'état réel.
 *
 * Si aucune instance (demande sans workflow), affiche une frise de STATUT simple
 * basée sur le statut de la demande.
 */

// ── Types (calés sur le JSON réel de l'API) ──────────────────────────────────
interface WfInstance {
  id: string;
  code_workflow: string;
  statut: string;            // EN_COURS | APPROUVE | REJETE | EN_MODIFICATION | ...
  id_etape_courante: string | null;
  demandeur_id: string;
  date_debut: string | null;
  date_fin: string | null;
  workflow_libelle?: string;
}
interface WfResponsable {
  collaborateur_id?: string | null;
  nom?: string | null;
  prenom?: string | null;
  poste?: string | null;
  uo?: string | null;
  type: string;              // REEL | ROLE | UTILISATEUR_FIXE | HIERARCHIE_N1 | ...
  source: "reel" | "prevu";
  libelle_role?: string | null;
}

interface WfEtape {
  id: string;                // id_instance_etape
  id_etape_def: string;
  ordre: number;
  statut: string;            // EN_ATTENTE | EN_COURS | PASSE | REJETE | ...
  date_debut: string | null;
  date_fin: string | null;
  nb_acteurs_requis: number;
  nb_validations: number;
  nb_rejets: number;
  etape_code: string;
  etape_libelle: string;
  type_etape: string;        // VALIDATION | AUTOMATIQUE | INFORMATION | SIGNATURE | ...
  mode_validation: string;
  responsables?: WfResponsable[];
}
interface WfAction {
  id: string;
  id_instance_etape: string;
  acteur_id: string;
  type_decision: string | null;   // VALIDER | REJETER | RENVOYER | ...
  commentaire: string | null;
  date_action: string | null;
  type_action_sys: string | null; // NOTIFICATION_INTERNE | EMAIL | ...
  statut_action_sys: string | null;
  etape_ordre?: number;
}
interface WfInstanceFull {
  instance: WfInstance;
  etapes: WfEtape[];
  actions: WfAction[];
}

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

// ── Helpers d'affichage ──────────────────────────────────────────────────────
function fmtDateTime(d?: string | null): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return d; }
}

const ETAPE_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  PASSE:      { color: "hsl(142 55% 38%)", bg: "hsl(142 55% 45% / 0.12)", label: "Terminée" },
  EN_COURS:   { color: "hsl(210 80% 50%)", bg: "hsl(210 80% 50% / 0.12)", label: "En cours" },
  EN_ATTENTE: { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.4)", label: "À venir" },
  REJETE:     { color: "hsl(0 70% 50%)",   bg: "hsl(0 70% 50% / 0.12)",   label: "Rejetée" },
  IGNORE:     { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.3)", label: "Ignorée" },
};
function etapeStyle(statut: string) {
  return ETAPE_STYLE[statut] ?? ETAPE_STYLE.EN_ATTENTE;
}
function EtapeIcon({ statut, size = 18 }: { statut: string; size?: number }) {
  if (statut === "PASSE") return <CheckCircle2 size={size} style={{ color: ETAPE_STYLE.PASSE.color }} />;
  if (statut === "EN_COURS") return <Loader2 size={size} className="animate-spin" style={{ color: ETAPE_STYLE.EN_COURS.color }} />;
  if (statut === "REJETE") return <XCircle size={size} style={{ color: ETAPE_STYLE.REJETE.color }} />;
  return <Circle size={size} style={{ color: ETAPE_STYLE.EN_ATTENTE.color }} />;
}

// ── Frise de statut simple (demandes SANS workflow) ──────────────────────────
const STATUT_FLOW: Record<string, { label: string; etapes: { key: string; label: string }[] }> = {
  _default: {
    label: "Suivi de la demande",
    etapes: [
      { key: "soumise", label: "Soumise" },
      { key: "attente", label: "En attente de validation" },
      { key: "final", label: "Décision" },
    ],
  },
};
function FriseStatutSimple({ statut }: { statut: string }) {
  const s = (statut || "").toLowerCase();
  const final = s === "approuvee" ? "Approuvée" : s === "refusee" ? "Refusée" : s === "annulee" ? "Annulée" : "Décision";
  const finalColor = s === "approuvee" ? "hsl(142 55% 38%)" : s === "refusee" || s === "annulee" ? "hsl(0 70% 50%)" : "hsl(var(--muted-foreground))";
  const step2Done = s !== "brouillon";
  const step3Done = ["approuvee", "refusee", "annulee"].includes(s);
  const rows = [
    { label: "Soumise", done: true, color: "hsl(142 55% 38%)" },
    { label: "En attente de validation", done: step2Done && !step3Done, current: s === "en_attente", color: "hsl(210 80% 50%)" },
    { label: final, done: step3Done, color: finalColor },
  ];
  return (
    <div className="space-y-0">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            {r.done ? <CheckCircle2 size={16} style={{ color: r.color }} />
              : r.current ? <Loader2 size={16} className="animate-spin" style={{ color: r.color }} />
              : <Circle size={16} style={{ color: "hsl(var(--muted-foreground))" }} />}
            {i < rows.length - 1 && <div className="w-px h-6" style={{ background: "hsl(var(--border))" }} />}
          </div>
          <div className="pb-4 -mt-0.5">
            <p className="text-xs font-medium" style={{ color: r.done || r.current ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>{r.label}</p>
          </div>
        </div>
      ))}
      <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
        Cette demande ne suit pas de circuit de validation paramétré.
      </p>
    </div>
  );
}

// ── Schéma horizontal (vue d'ensemble du circuit, coloré selon l'état réel) ──
function SchemaWorkflow({ etapes }: { etapes: WfEtape[] }) {
  return (
    <div className="overflow-x-auto py-3">
      <div className="flex items-stretch gap-0 min-w-min">
        {etapes.map((e, i) => {
          const st = etapeStyle(e.statut);
          return (
            <div key={e.id} className="flex items-center">
              <div className="flex flex-col items-center justify-center px-4 py-3 rounded-xl min-w-[140px]"
                   style={{ background: st.bg, border: `1.5px solid ${st.color}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <EtapeIcon statut={e.statut} size={15} />
                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: st.color }}>{st.label}</span>
                </div>
                <p className="text-[11px] font-semibold text-center leading-tight" style={{ color: "hsl(var(--foreground))" }}>{e.etape_libelle}</p>
                {e.date_fin && <p className="text-[9px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{fmtDateTime(e.date_fin)}</p>}
              </div>
              {i < etapes.length - 1 && (
                <ChevronRight size={18} className="mx-1 flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────
export default function SuiviDemandeWorkflow({
  tableSource = "cong_demandes",
  demandeId,
  statutDemande,
}: {
  tableSource?: string;
  demandeId: string;
  statutDemande?: string;
}) {
  const [showSchema, setShowSchema] = useState(false);

  // 1) instance liée à l'objet
  const { data: instRef, isLoading: l1 } = useQuery<{ instance: { id: string } | null }>({
    queryKey: ["wf-instance-of", tableSource, demandeId],
    enabled: !!demandeId,
    staleTime: 30 * 1000,
    queryFn: async () =>
      await api.get(`/workflow/instance-of/${tableSource}/${demandeId}`).catch(() => ({ instance: null })),
  });

  const instanceId = instRef?.instance?.id || null;

  // 2) détail complet de l'instance
  const { data: full, isLoading: l2 } = useQuery<WfInstanceFull>({
    queryKey: ["wf-instance-full", instanceId],
    enabled: !!instanceId,
    staleTime: 30 * 1000,
    queryFn: async () => await api.get(`/workflow/instances/${instanceId}`),
  });

  if (l1 || (instanceId && l2)) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        <Loader2 size={14} className="animate-spin" /> Chargement du circuit…
      </div>
    );
  }

  // Pas d'instance → frise de statut simple
  if (!instanceId || !full) {
    return (
      <div className="pt-1">
        <FriseStatutSimple statut={statutDemande || ""} />
      </div>
    );
  }

  const { instance, etapes, actions } = full;
  const etapesTriees = [...etapes].sort((a, b) => a.ordre - b.ordre);

  // Décisions humaines par étape (on exclut les actions système / notifications)
  const decisionsParEtape = (ieId: string) =>
    actions.filter(a => a.id_instance_etape === ieId && a.acteur_id !== SYSTEM_ACTOR && a.type_decision);

  // Actions système par étape (notifications, e-mails) — affichées discrètement
  const sysParEtape = (ieId: string) =>
    actions.filter(a => a.id_instance_etape === ieId && (a.type_action_sys || a.acteur_id === SYSTEM_ACTOR));

  const wfStatutLabel =
    instance.statut === "APPROUVE" ? "Approuvé"
    : instance.statut === "REJETE" ? "Rejeté"
    : instance.statut === "EN_MODIFICATION" ? "Renvoyé pour modification"
    : "En cours";
  const wfStatutColor =
    instance.statut === "APPROUVE" ? "hsl(142 55% 38%)"
    : instance.statut === "REJETE" ? "hsl(0 70% 50%)"
    : instance.statut === "EN_MODIFICATION" ? "hsl(38 92% 45%)"
    : "hsl(210 80% 50%)";

  return (
    <div className="pt-1">
      {/* En-tête circuit */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Workflow size={14} style={{ color: "hsl(var(--primary))" }} />
          <span className="text-xs font-semibold">{instance.workflow_libelle || instance.code_workflow}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${wfStatutColor}1f`, color: wfStatutColor }}>{wfStatutLabel}</span>
        </div>
        <button onClick={() => setShowSchema(v => !v)}
          className="text-[11px] font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:opacity-70"
          style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--foreground))" }}>
          <GitBranch size={12} /> {showSchema ? "Masquer le schéma" : "Voir le schéma"}
        </button>
      </div>

      {/* Schéma horizontal (toggle) */}
      {showSchema && (
        <div className="mb-4 p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.25)", border: "1px solid hsl(var(--border))" }}>
          <SchemaWorkflow etapes={etapesTriees} />
        </div>
      )}

      {/* Frise verticale détaillée */}
      <div className="space-y-0">
        {etapesTriees.map((e, i) => {
          const st = etapeStyle(e.statut);
          const decisions = decisionsParEtape(e.id);
          const sys = sysParEtape(e.id);
          const isLast = i === etapesTriees.length - 1;
          return (
            <div key={e.id} className="flex items-start gap-3">
              {/* Colonne icône + ligne */}
              <div className="flex flex-col items-center flex-shrink-0">
                <EtapeIcon statut={e.statut} />
                {!isLast && <div className="w-px flex-1 min-h-[2rem]" style={{ background: "hsl(var(--border))" }} />}
              </div>

              {/* Contenu de l'étape */}
              <div className="pb-5 flex-1 -mt-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>{e.etape_libelle}</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  {e.type_etape === "AUTOMATIQUE" && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>Automatique</span>
                  )}
                </div>

                {/* Dates de l'étape */}
                <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {e.date_debut && <span className="flex items-center gap-1"><Clock size={10} /> Démarrée le {fmtDateTime(e.date_debut)}</span>}
                  {e.date_fin && <span className="flex items-center gap-1"><CheckCircle2 size={10} /> Terminée le {fmtDateTime(e.date_fin)}</span>}
                </div>

                {/* Responsable(s) de l'étape — réel(s) si décidée, prévu(s) sinon */}
                {decisions.length === 0 && (e.responsables?.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {e.responsables!.map((r, idx) => {
                      const isRole = r.type === "ROLE";
                      const nomComplet = `${r.prenom || ""} ${r.nom || ""}`.trim();
                      const sousTitre = [r.poste, r.uo].filter(Boolean).join(" · ");
                      return (
                        <div key={idx} className="flex items-start gap-2 p-2 rounded-lg"
                             style={{ background: "hsl(var(--muted) / 0.35)", border: "1px solid hsl(var(--border))" }}>
                          {isRole
                            ? <Users size={12} style={{ color: "hsl(var(--primary))", marginTop: 1 }} />
                            : <User size={12} style={{ color: "hsl(var(--primary))", marginTop: 1 }} />}
                          <div className="flex-1 min-w-0">
                            {isRole ? (
                              <p className="text-[11px] font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                                {r.libelle_role}
                                <span className="ml-1.5 font-normal" style={{ color: "hsl(var(--muted-foreground))" }}>· à valider</span>
                              </p>
                            ) : (
                              <>
                                <p className="text-[11px] font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                                  {nomComplet || "Responsable"}
                                  {r.source === "prevu" && (
                                    <span className="ml-1.5 font-normal text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>· responsable prévu</span>
                                  )}
                                </p>
                                {sousTitre && <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{sousTitre}</p>}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Décisions humaines */}
                {decisions.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {decisions.map(d => {
                      const dec = (d.type_decision || "").toUpperCase();
                      const isReject = dec === "REJETER";
                      const c = isReject ? "hsl(0 70% 50%)" : dec === "VALIDER" ? "hsl(142 55% 38%)" : "hsl(38 92% 45%)";
                      const label = dec === "VALIDER" ? "Validé" : dec === "REJETER" ? "Rejeté" : dec === "RENVOYER" ? "Renvoyé" : dec;
                      return (
                        <div key={d.id} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: `${c}10`, border: `1px solid ${c}33` }}>
                          <User size={12} style={{ color: c, marginTop: 1 }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px]"><span className="font-semibold" style={{ color: c }}>{label}</span>
                              {d.date_action && <span style={{ color: "hsl(var(--muted-foreground))" }}> · {fmtDateTime(d.date_action)}</span>}</p>
                            {d.commentaire && <p className="text-[10px] mt-0.5 italic" style={{ color: "hsl(var(--muted-foreground))" }}>« {d.commentaire} »</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Compteur de validations pour étape en cours */}
                {e.statut === "EN_COURS" && e.nb_acteurs_requis > 0 && (
                  <p className="text-[10px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {e.nb_validations}/{e.nb_acteurs_requis} validation(s) · en attente de décision
                  </p>
                )}

                {/* Actions système (notifications) — discret */}
                {sys.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {sys.map(a => (
                      <span key={a.id} className="text-[9px] flex items-center gap-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {a.type_action_sys === "EMAIL" ? <Mail size={9} /> : <Bell size={9} />}
                        {a.type_action_sys === "EMAIL" ? "E-mail envoyé" : "Notification envoyée"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
