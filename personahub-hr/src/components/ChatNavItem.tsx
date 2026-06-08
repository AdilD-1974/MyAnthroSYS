// =====================================================================
//  Élément de sidebar « Messages » + badge de non-lus.
//  Cible : src/components/ChatNavItem.tsx
//
//  ⚠️  Adapte les classes pour qu'elles collent EXACTEMENT au style de tes
//      autres entrées de sidebar (mêmes paddings, mêmes états actif/hover).
//      Ici on utilise les tokens sidebar de shadcn (--sidebar-*).
//  ⚠️  On suppose react-router-dom (NavLink). Si tu utilises un autre routeur,
//      remplace NavLink par l'équivalent.
// =====================================================================
import { NavLink } from "react-router-dom";
import { MessageSquare } from "lucide-react";

import { useChatContext } from "@/contexts/ChatContext";

export function ChatNavItem() {
  const { nonLusTotal } = useChatContext();

  return (
    <NavLink
      to="/chat"
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
        }`
      }
    >
      <div className="relative">
        <MessageSquare className="h-5 w-5" />
        {nonLusTotal > 0 && (
          <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--destructive))] px-1 text-[10px] font-semibold leading-none text-white">
            {nonLusTotal > 99 ? "99+" : nonLusTotal}
          </span>
        )}
      </div>
      <span>Messages</span>
    </NavLink>
  );
}
