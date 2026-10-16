/**
 * useNotifications – Charge les alertes à partir de la base de données :
 * 1. Contrats arrivant à échéance dans les N prochains jours
 * 2. Documents personnels arrivant à expiration (CIN, Passeport) dans les N prochains jours
 * 3. Anniversaires du jour / semaine en cours
 * 
 * Filtrage par rôle :
 * - Collaborateur : uniquement ses propres alertes
 * - Admin/RH/Paie/Manager : tous les collaborateurs non sortis
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type NotifType = "contrat" | "document" | "anniversaire" | "reprise" | "depart_provisoire" | "paiement" | "workflow";

export interface Notification {
  id: string;
  type: NotifType;
  titre: string;
  description: string;
  date: string;
  collaborateurId?: string;
  collaborateurNom?: string;
  collaborateurMatricule?: string;
  daysLeft?: number;
  lien?: string;              // cible de navigation (notifications persistées)
  source?: "db";              // "db" = table notifications ; sinon = alerte calculée
  lue: boolean;
}

const LS_KEY = "notifs_lues";

function getLuesSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function markLue(id: string) {
  const s = getLuesSet();
  s.add(id);
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(s)));
}
function markAllLues(ids: string[]) {
  const s = getLuesSet();
  ids.forEach(id => s.add(id));
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(s)));
}

const LS_KEY_MASK = "notifs_masquees";

function getMasqueesSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY_MASK);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function masquer(id: string) {
  const s = getMasqueesSet();
  s.add(id);
  localStorage.setItem(LS_KEY_MASK, JSON.stringify(Array.from(s)));
}
function masquerPlusieurs(ids: string[]) {
  const s = getMasqueesSet();
  ids.forEach(id => s.add(id));
  localStorage.setItem(LS_KEY_MASK, JSON.stringify(Array.from(s)));
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [intervalJours, setIntervalJours] = useState(14);
  const { activeRole, profile, user } = useAuth();
  const luesSet = getLuesSet();

  // Collaborateur voit uniquement ses propres notifs
  const isCollaborateur = activeRole === "collaborateur";
  const collaborateurId = profile?.collaborateur_id;

  const load = useCallback(async () => {
    setLoading(true);
    const notifs: Notification[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // --- Intervalle d'alerte ---
    try {
      const { data: param } = await supabase
        .from("parametres_rh" as never)
        .select("valeur")
        .eq("code" as never, "ALERTE_ECHEANCE_JOURS" as never)
        .maybeSingle();
      if (param) {
        const v = parseInt((param as any).valeur);
        if (!isNaN(v) && v > 0) setIntervalJours(v);
      }
    } catch { /* ignorer */ }

    const limitDate = new Date(today);
    limitDate.setDate(limitDate.getDate() + intervalJours);
    const lues = getLuesSet();

    const addNotif = (n: Omit<Notification, "lue">) => {
      notifs.push({ ...n, lue: lues.has(n.id) });
    };

    // ── 1. Contrats arrivant à échéance ──
    if (!isCollaborateur || collaborateurId) {
      try {
        let query = supabase
          .from("collaborateur_contrats")
          .select(`
            id, date_fin, date_depart_previsionnelle, code_type_contrat,
            collaborateur_id,
            collaborateurs!inner(id, matricule, nom, prenom, statut_collaborateur, archive)
          ` as never)
          .eq("archive" as never, false as never)
          .in("code_statut_contrat" as never, ["ACTIF", "EN_COURS"] as never)
          .neq("collaborateurs.statut_collaborateur" as never, "SORTI" as never)
          .eq("collaborateurs.archive" as never, false as never);

        if (isCollaborateur && collaborateurId) {
          query = query.eq("collaborateur_id" as never, collaborateurId as never);
        }

        const { data: contrats } = await query;

        ((contrats || []) as any[]).forEach((c: any) => {
          const collab = c.collaborateurs;
          const checkDate = (d: string | null, label: string) => {
            if (!d) return;
            const dt = new Date(d);
            dt.setHours(0, 0, 0, 0);
            if (dt >= today && dt <= limitDate) {
              const daysLeft = Math.round((dt.getTime() - today.getTime()) / 86400000);
              addNotif({
                id: `contrat_${c.id}_${label}`,
                type: "contrat",
                titre: `Contrat arrivant à échéance`,
                description: `${collab.prenom} ${collab.nom} (${collab.matricule}) — ${label} : ${new Date(d).toLocaleDateString("fr-FR")}`,
                date: d,
                collaborateurId: collab.id,
                collaborateurNom: `${collab.prenom} ${collab.nom}`,
                collaborateurMatricule: collab.matricule,
                daysLeft,
              });
            }
          };
          checkDate(c.date_fin, "Date fin");
          if (!c.date_fin) checkDate(c.date_depart_previsionnelle, "Date fin prévue");
        });
      } catch { /* ignorer */ }
    }

    // ── 2. Documents arrivant à expiration ──
    if (!isCollaborateur || collaborateurId) {
      try {
        let query = supabase
          .from("collaborateurs")
          .select("id, matricule, nom, prenom, cin_date_fin, passeport_date_fin")
          .eq("archive", false)
          .neq("statut_collaborateur", "SORTI");

        if (isCollaborateur && collaborateurId) {
          query = query.eq("id", collaborateurId);
        }

        const { data: collabs } = await query;

        ((collabs || []) as any[]).forEach((c: any) => {
          const checkDoc = (d: string | null, docLabel: string) => {
            if (!d) return;
            const dt = new Date(d);
            dt.setHours(0, 0, 0, 0);
            const daysLeft = Math.round((dt.getTime() - today.getTime()) / 86400000);
            // Inclure les documents déjà expirés (jusqu'à 90 jours en arrière) ET ceux à venir dans l'intervalle
            if (dt <= limitDate && daysLeft >= -90) {
              addNotif({
                id: `doc_${c.id}_${docLabel}`,
                type: "document",
                titre: daysLeft < 0 ? `${docLabel} expiré(e)` : `${docLabel} arrivant à expiration`,
                description: `${c.prenom} ${c.nom} (${c.matricule}) — ${daysLeft < 0 ? "expiré le" : "expire le"} ${new Date(d).toLocaleDateString("fr-FR")}`,
                date: d,
                collaborateurId: c.id,
                collaborateurNom: `${c.prenom} ${c.nom}`,
                collaborateurMatricule: c.matricule,
                daysLeft,
              });
            }
          };
          checkDoc(c.cin_date_fin, "CIN");
          checkDoc(c.passeport_date_fin, "Passeport");
        });
      } catch { /* ignorer */ }
    }

    // ── 3. Anniversaires dans les 7 prochains jours ──
    try {
      let query = supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom, date_naissance")
        .eq("archive", false)
        .neq("statut_collaborateur", "SORTI")
        .not("date_naissance", "is", null);

      if (isCollaborateur && collaborateurId) {
        query = query.eq("id", collaborateurId);
      }

      const { data: collabs } = await query;

      ((collabs || []) as any[]).forEach((c: any) => {
        if (!c.date_naissance) return;
        const dn = new Date(c.date_naissance);
        const anniv = new Date(today.getFullYear(), dn.getMonth(), dn.getDate());
        if (anniv < today) anniv.setFullYear(today.getFullYear() + 1);
        const daysLeft = Math.round((anniv.getTime() - today.getTime()) / 86400000);
        if (daysLeft <= 7) {
          const age = anniv.getFullYear() - dn.getFullYear();
          addNotif({
            id: `anniv_${c.id}_${anniv.getFullYear()}`,
            type: "anniversaire",
            titre: daysLeft === 0 ? `🎂 Anniversaire aujourd'hui !` : `🎂 Anniversaire dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`,
            description: `${c.prenom} ${c.nom} (${c.matricule}) fête ses ${age} ans`,
            date: anniv.toISOString().split("T")[0],
            collaborateurId: c.id,
            collaborateurNom: `${c.prenom} ${c.nom}`,
            collaborateurMatricule: c.matricule,
            daysLeft,
          });
        }
      });
    } catch { /* ignorer */ }

    // ── 4. Congés arrivant à terme sans reprise effective ──
    // RG-CONGE-REPRISE-01 (Adil DAIA): Alerte pour les congés dont le type exige une reprise
    // et dont la date de fin d'absence est dans l'intervalle d'alerte ou dépassée sans date_reprise_effective.
    if (!isCollaborateur || collaborateurId) {
      try {
        // Charger les types de congé avec reprise_obligatoire
        const { data: typesReprise } = await supabase
          .from("ref_type_conge" as never)
          .select("code, libelle" as never)
          .eq("actif" as never, true as never)
          .eq("reprise_obligatoire" as never, true as never);

        const codesReprise = ((typesReprise || []) as any[]).map((t: any) => t.code);

        if (codesReprise.length > 0) {
          let qDemandes = supabase
            .from("cong_demandes")
            .select(`
              id, collaborateur_id, code_type_conge, date_fin_absence, date_reprise_effective, reconduction_numero,
              collaborateurs!inner(id, matricule, nom, prenom, statut_collaborateur, archive)
            ` as never)
            .eq("archive" as never, false as never)
            .eq("statut" as never, "APPROUVEE" as never)
            .is("date_reprise_effective" as never, null as never)
            .in("code_type_conge" as never, codesReprise as never)
            .neq("collaborateurs.statut_collaborateur" as never, "SORTI" as never)
            .eq("collaborateurs.archive" as never, false as never);

          if (isCollaborateur && collaborateurId) {
            qDemandes = qDemandes.eq("collaborateur_id" as never, collaborateurId as never);
          }

          const { data: demandesReprise } = await qDemandes;

          const typesMap: Record<string, string> = {};
          ((typesReprise || []) as any[]).forEach((t: any) => { typesMap[t.code] = t.libelle; });

          ((demandesReprise || []) as any[]).forEach((d: any) => {
            const dateFin = new Date(d.date_fin_absence);
            dateFin.setHours(0, 0, 0, 0);
            const daysLeft = Math.round((dateFin.getTime() - today.getTime()) / 86400000);
            // Alerter si le congé arrive à terme dans l'intervalle OU est déjà dépassé (jusqu'à 30j)
            if (daysLeft <= intervalJours && daysLeft >= -30) {
              const collab = d.collaborateurs;
              const typeLabel = typesMap[d.code_type_conge] || d.code_type_conge;
              addNotif({
                id: `reprise_${d.id}`,
                type: "reprise",
                titre: daysLeft < 0
                  ? `⚠️ Reprise non enregistrée (${typeLabel})`
                  : daysLeft === 0
                  ? `⚠️ Congé se termine aujourd'hui — reprise attendue`
                  : `Congé arrivant à terme — reprise requise`,
                description: `${collab.prenom} ${collab.nom} (${collab.matricule}) — ${typeLabel} — fin le ${dateFin.toLocaleDateString("fr-FR")}${daysLeft < 0 ? ` (dépassé de ${Math.abs(daysLeft)}j)` : daysLeft === 0 ? " (aujourd'hui)" : ` (dans ${daysLeft}j)`}`,
                date: d.date_fin_absence,
                collaborateurId: collab.id,
                collaborateurNom: `${collab.prenom} ${collab.nom}`,
                collaborateurMatricule: collab.matricule,
                daysLeft,
              });
            }
          });
        }
      } catch { /* ignorer */ }
    }

    // ── 5. Départs provisoires arrivant à terme ──
    if (!isCollaborateur || collaborateurId) {
      try {
        let qDP = supabase
          .from("collaborateur_departs_provisoires" as never)
          .select(`
            id, collaborateur_id, date_fin_prevue, code_motif, statut, numero_reconduction,
            collaborateurs!inner(id, matricule, nom, prenom, statut_collaborateur, archive),
            ref_motif_depart_provisoire!inner(libelle)
          ` as never)
          .eq("archive" as never, false as never)
          .in("statut" as never, ["ACTIF", "RECONDUIT"] as never)
          .neq("collaborateurs.statut_collaborateur" as never, "SORTI" as never)
          .eq("collaborateurs.archive" as never, false as never);

        if (isCollaborateur && collaborateurId) {
          qDP = qDP.eq("collaborateur_id" as never, collaborateurId as never);
        }

        const { data: dps } = await qDP;

        ((dps || []) as any[]).forEach((dp: any) => {
          const dateFin = new Date(dp.date_fin_prevue);
          dateFin.setHours(0, 0, 0, 0);
          const daysLeft = Math.round((dateFin.getTime() - today.getTime()) / 86400000);
          if (daysLeft <= intervalJours && daysLeft >= -30) {
            const collab = dp.collaborateurs;
            const motifLabel = dp.ref_motif_depart_provisoire?.libelle || dp.code_motif;
            addNotif({
              id: `dp_${dp.id}`,
              type: "depart_provisoire",
              titre: daysLeft < 0
                ? `⚠️ Fin de ${motifLabel} dépassée`
                : daysLeft === 0
                ? `⚠️ Fin de ${motifLabel} aujourd'hui`
                : `Fin de ${motifLabel} à venir`,
              description: `${collab.prenom} ${collab.nom} (${collab.matricule}) — fin prévue le ${dateFin.toLocaleDateString("fr-FR")}${daysLeft < 0 ? ` (dépassé de ${Math.abs(daysLeft)}j)` : daysLeft === 0 ? " (aujourd'hui)" : ` (dans ${daysLeft}j)`}`,
              date: dp.date_fin_prevue,
              collaborateurId: collab.id,
              collaborateurNom: `${collab.prenom} ${collab.nom}`,
              collaborateurMatricule: collab.matricule,
              daysLeft,
            });
          }
        });
      } catch { /* ignorer */ }
    }

    // ── 6. Comptes bancaires principaux inactifs ──
    if (!isCollaborateur) {
      try {
        const { data: paiements } = await supabase
          .from("collaborateur_paiements" as never)
          .select(`
            id, collaborateur_id, principal, actif, date_fin, code_mode,
            collaborateurs!inner(id, matricule, nom, prenom, statut_collaborateur, archive)
          ` as never)
          .eq("archive" as never, false as never)
          .eq("principal" as never, true as never)
          .neq("collaborateurs.statut_collaborateur" as never, "SORTI" as never)
          .eq("collaborateurs.archive" as never, false as never);

        ((paiements || []) as any[]).forEach((p: any) => {
          // Check if inactive (date_fin < today)
          if (p.date_fin) {
            const df = new Date(p.date_fin);
            df.setHours(0, 0, 0, 0);
            if (df < today) {
              const collab = p.collaborateurs;
              const daysOver = Math.round((today.getTime() - df.getTime()) / 86400000);
              addNotif({
                id: `paiement_principal_inactif_${p.id}`,
                type: "paiement",
                titre: `⚠️ Compte principal inactif`,
                description: `${collab.prenom} ${collab.nom} (${collab.matricule}) — compte principal expiré le ${df.toLocaleDateString("fr-FR")} (depuis ${daysOver}j)`,
                date: p.date_fin,
                collaborateurId: collab.id,
                collaborateurNom: `${collab.prenom} ${collab.nom}`,
                collaborateurMatricule: collab.matricule,
                daysLeft: -daysOver,
              });
            }
          }
        });
      } catch { /* ignorer */ }
    }

    notifs.sort((a, b) => a.date.localeCompare(b.date));

    // ── Notifications PERSISTÉES (table notifications) ───────────────────────
    // Créées par le moteur de workflow (ex. « Demande de congés à valider »).
    // L'état "lue" vit en base (pas dans le localStorage des alertes calculées).
    if (user?.id) {
      try {
        const { data: dbRows } = await supabase
          .from("notifications" as never)
          .select("id,titre,message,lien,lue,created_at")
          .eq("user_id", user.id);
        const dbNotifs: Notification[] = ((dbRows || []) as any[]).map((r) => ({
          id: r.id,
          type: "workflow" as NotifType,
          titre: r.titre,
          description: r.message,
          date: r.created_at,
          lien: r.lien || undefined,
          source: "db" as const,
          lue: !!r.lue,
        }));
        dbNotifs.sort((a, b) => b.date.localeCompare(a.date)); // récentes d'abord
        notifs.unshift(...dbNotifs);                            // placées en tête
      } catch { /* table absente / erreur réseau : on ignore */ }
    }

    const masquees = getMasqueesSet();
    setNotifications(notifs.filter((n) => !masquees.has(n.id)));
    setLoading(false);
  }, [intervalJours, isCollaborateur, collaborateurId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const markAsRead = (id: string) => {
    const cible = notifications.find((x) => x.id === id);
    if (cible?.source === "db") {
      supabase.from("notifications" as never).update({ lue: true } as never).eq("id", id).then(() => {}, () => {});
    } else {
      markLue(id);
    }
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, lue: true } : n));
  };

  const markAllAsRead = () => {
    const calcIds = notifications.filter((n) => n.source !== "db").map((n) => n.id);
    const dbIds = notifications.filter((n) => n.source === "db" && !n.lue).map((n) => n.id);
    markAllLues(calcIds);
    dbIds.forEach((id) => {
      supabase.from("notifications" as never).update({ lue: true } as never).eq("id", id).then(() => {}, () => {});
    });
    setNotifications(prev => prev.map(n => ({ ...n, lue: true })));
  };

  // Retirer de la liste (masquage persistant, sans suppression en base)
  const dismiss = (id: string) => {
    masquer(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const dismissAll = () => {
    masquerPlusieurs(notifications.map(n => n.id));
    setNotifications([]);
  };

  const unreadCount = notifications.filter(n => !n.lue).length;

  return { notifications, loading, unreadCount, markAsRead, markAllAsRead, dismiss, dismissAll, reload: load, intervalJours };
}
