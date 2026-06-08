/**
 * useCollaborateurNotifications – Returns a map of collaborateur_id → Notification[]
 * for use in the collaborateurs list page (badge per collaborateur).
 */
import { useNotifications, Notification } from "./useNotifications";
import { useMemo } from "react";

export function useCollaborateurNotifications() {
  const { notifications, loading } = useNotifications();

  const notifMap = useMemo(() => {
    const map: Record<string, Notification[]> = {};
    notifications.forEach((n) => {
      if (n.collaborateurId) {
        if (!map[n.collaborateurId]) map[n.collaborateurId] = [];
        map[n.collaborateurId].push(n);
      }
    });
    return map;
  }, [notifications]);

  return { notifMap, loading };
}
