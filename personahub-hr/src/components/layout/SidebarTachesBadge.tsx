// src/components/layout/SidebarTachesBadge.tsx
// ------------------------------------------------------------
// Composant badge à insérer dans Sidebar.tsx à côté de l'entrée "Tâches"
// Utilise useTacheCompteurs() pour le polling automatique
// ------------------------------------------------------------
import { useTacheCompteurs } from "@/hooks/useTaches";

/**
 * Badge affiché dans la Sidebar à côté de l'entrée "Tâches".
 * Montre le nombre de tâches en retard (rouge) ou dues aujourd'hui (orange).
 * Se rafraîchit toutes les 60 secondes automatiquement.
 *
 * Usage dans Sidebar.tsx :
 *   import SidebarTachesBadge from "@/components/layout/SidebarTachesBadge";
 *
 *   // Dans votre liste de nav items, là où vous affichez "Tâches" :
 *   <NavItem icon={CheckSquare} label="Tâches" to="/taches">
 *     <SidebarTachesBadge />
 *   </NavItem>
 *
 *   // OU si votre Sidebar est différente, directement :
 *   {navItem.label === "Tâches" && <SidebarTachesBadge />}
 */
export default function SidebarTachesBadge() {
  const { en_retard, dues_aujourd_hui } = useTacheCompteurs();

  if (en_retard > 0) {
    return (
      <span style={{
        marginLeft: "auto",
        minWidth: 18, height: 18,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: 10,
        background: "var(--color-text-danger)",
        color: "#fff",
        fontSize: "calc(10px * var(--font-scale))", fontWeight: 700,
        padding: "0 5px",
        lineHeight: 1,
      }}>
        {en_retard > 99 ? "99+" : en_retard}
      </span>
    );
  }

  if (dues_aujourd_hui > 0) {
    return (
      <span style={{
        marginLeft: "auto",
        minWidth: 18, height: 18,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: 10,
        background: "var(--color-text-warning)",
        color: "#fff",
        fontSize: "calc(10px * var(--font-scale))", fontWeight: 700,
        padding: "0 5px",
        lineHeight: 1,
      }}>
        {dues_aujourd_hui > 99 ? "99+" : dues_aujourd_hui}
      </span>
    );
  }

  return null;
}


// ────────────────────────────────────────────────────────────
// INSTRUCTIONS D'INTÉGRATION dans Sidebar.tsx
// ────────────────────────────────────────────────────────────
//
// 1. Importer le composant :
//    import SidebarTachesBadge from "@/components/layout/SidebarTachesBadge";
//
// 2. Dans votre tableau de navigation (navItems), ajouter l'entrée Tâches
//    si elle n'existe pas encore :
//
//    { label: "Tâches", to: "/taches", icon: CheckSquare }
//
// 3. Dans le rendu de chaque navItem, appliquer le badge :
//
//    {item.label === "Tâches" && <SidebarTachesBadge />}
//
//    Exemple complet dans un <NavLink> :
//
//    <NavLink to={item.to} style={...}>
//      <item.icon size={18} />
//      <span>{item.label}</span>
//      {item.label === "Tâches" && <SidebarTachesBadge />}
//    </NavLink>
//
// 4. Ajouter la route dans votre router (ex: App.tsx / router.tsx) :
//
//    import TachesPage from "@/pages/espaces/TachesPage";
//    ...
//    { path: "/taches", element: <TachesPage /> }
//
// 5. Ajouter le widget dans MonEspacePage.tsx :
//
//    import WidgetMesTaches from "@/components/widgets/WidgetMesTaches";
//    ...
//    <WidgetMesTaches />
//
// ────────────────────────────────────────────────────────────
