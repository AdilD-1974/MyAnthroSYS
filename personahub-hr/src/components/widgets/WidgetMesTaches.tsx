// src/components/widgets/WidgetMesTaches.tsx
// ------------------------------------------------------------
// Widget "Mes tâches du jour" — affiché dans MonEspacePage
// Affiche les tâches dues aujourd'hui + en retard + haute priorité
// ------------------------------------------------------------
import { useState } from "react";
import { CheckCircle2, Clock, AlertCircle, ChevronRight, Plus } from "lucide-react";
import { useTaches } from "@/hooks/useTaches";
import { Tache, TacheStatut } from "@/lib/tachesApi";
import { useNavigate } from "react-router-dom";

// ─── Helpers ─────────────────────────────────────────────────

function isToday(d?: string) {
  if (!d) return false;
  return d.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function isPast(d?: string) {
  if (!d) return false;
  return d.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

// ─── Petite carte tâche ───────────────────────────────────────

function MiniTacheRow({
  tache,
  onStatutChange,
}: {
  tache: Tache;
  onStatutChange: (id: string, s: TacheStatut) => void;
}) {
  const [done, setDone] = useState(tache.statut === "terminee");

  const handleCheck = async () => {
    const next: TacheStatut = done ? "a_faire" : "terminee";
    setDone(!done);
    onStatutChange(tache.id, next);
  };

  const overdue = isPast(tache.date_echeance) && !done;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 0",
      borderBottom: "1px solid var(--color-border-tertiary)",
      opacity: done ? 0.5 : 1,
      transition: "opacity 0.2s",
    }}>
      {/* Checkbox rapide */}
      <button
        onClick={handleCheck}
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          width: 20, height: 20, borderRadius: "50%",
          border: `2px solid ${done ? "var(--color-text-success)" : "var(--color-border-secondary)"}`,
          background: done ? "var(--color-text-success)" : "transparent",
          cursor: "pointer",
        }}
      >
        {done && <CheckCircle2 size={12} style={{ color: "var(--color-background-primary)" }} />}
      </button>

      {/* Titre */}
      <span style={{
        flex: 1, fontSize: "calc(13px * var(--font-scale))",
        color: "var(--color-text-primary)",
        textDecoration: done ? "line-through" : "none",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {tache.titre}
      </span>

      {/* Badge retard / urgence */}
      {overdue && (
        <span style={{
          fontSize: "calc(10px * var(--font-scale))", padding: "1px 5px", borderRadius: 4, flexShrink: 0,
          background: "var(--color-background-danger)",
          color: "var(--color-text-danger)", fontWeight: 600,
        }}>
          En retard
        </span>
      )}
      {!overdue && tache.priorite === "urgente" && (
        <AlertCircle size={13} style={{ color: "var(--color-text-danger)", flexShrink: 0 }} />
      )}
      {!overdue && tache.priorite === "haute" && !done && (
        <span style={{
          fontSize: "calc(10px * var(--font-scale))", padding: "1px 5px", borderRadius: 4, flexShrink: 0,
          background: "var(--color-background-warning)",
          color: "var(--color-text-warning)",
        }}>
          Haute
        </span>
      )}
    </div>
  );
}

// ─── Widget principal ─────────────────────────────────────────

export default function WidgetMesTaches() {
  const navigate = useNavigate();
  const { taches, loading, changeStatut } = useTaches({ include_terminees: false });

  // Sélection : dues aujourd'hui + en retard + urgentes/hautes (max 8 lignes)
  const pertinentes = taches
    .filter(t =>
      isToday(t.date_echeance)
      || isPast(t.date_echeance)
      || t.priorite === "urgente"
      || t.priorite === "haute"
    )
    .sort((a, b) => {
      // En retard d'abord, puis urgentes, puis date_echeance
      const aRetard = isPast(a.date_echeance) ? 0 : 1;
      const bRetard = isPast(b.date_echeance) ? 0 : 1;
      if (aRetard !== bRetard) return aRetard - bRetard;
      const prio = { urgente: 0, haute: 1, normale: 2, basse: 3 };
      return (prio[a.priorite] ?? 2) - (prio[b.priorite] ?? 2);
    })
    .slice(0, 8);

  const nbRetard    = taches.filter(t => isPast(t.date_echeance)).length;
  const nbAujourdhui = taches.filter(t => isToday(t.date_echeance)).length;

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "1px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-xl)",
      padding: "18px 20px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Clock size={16} style={{ color: "var(--color-text-secondary)" }} />
        <span style={{ fontSize: "calc(14px * var(--font-scale))", fontWeight: 600, color: "var(--color-text-primary)", flex: 1 }}>
          Mes tâches
        </span>

        {/* Stats rapides */}
        {nbRetard > 0 && (
          <span style={{
            fontSize: "calc(11px * var(--font-scale))", padding: "2px 7px", borderRadius: 10,
            background: "var(--color-background-danger)",
            color: "var(--color-text-danger)", fontWeight: 600,
          }}>
            {nbRetard} en retard
          </span>
        )}
        {nbAujourdhui > 0 && (
          <span style={{
            fontSize: "calc(11px * var(--font-scale))", padding: "2px 7px", borderRadius: 10,
            background: "var(--color-background-info)",
            color: "var(--color-text-info)",
          }}>
            {nbAujourdhui} auj.
          </span>
        )}
      </div>

      {/* Liste */}
      {loading && (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: "calc(13px * var(--font-scale))", color: "var(--color-text-tertiary)" }}>
          Chargement…
        </div>
      )}

      {!loading && pertinentes.length === 0 && (
        <div style={{
          padding: "20px 0", textAlign: "center",
          fontSize: "calc(13px * var(--font-scale))", color: "var(--color-text-tertiary)",
        }}>
          <CheckCircle2 size={22} style={{ marginBottom: 6, color: "var(--color-text-success)", display: "block", margin: "0 auto 8px" }} />
          Aucune tâche urgente pour aujourd'hui 🎉
        </div>
      )}

      {!loading && pertinentes.map(t => (
        <MiniTacheRow key={t.id} tache={t} onStatutChange={changeStatut} />
      ))}

      {/* Footer */}
      <div style={{
        display: "flex", alignItems: "center", marginTop: 12, gap: 8,
      }}>
        <button
          onClick={() => navigate("/taches")}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            padding: "6px 12px", fontSize: "calc(12px * var(--font-scale))",
            background: "var(--color-background-secondary)",
            border: "1px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-md)", cursor: "pointer",
            color: "var(--color-text-secondary)",
          }}
        >
          Voir toutes les tâches
          <ChevronRight size={12} />
        </button>
        <button
          onClick={() => navigate("/taches?new=1")}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "6px 10px", fontSize: "calc(12px * var(--font-scale))",
            background: "var(--color-text-primary)", color: "var(--color-background-primary)",
            border: "none", borderRadius: "var(--border-radius-md)", cursor: "pointer",
          }}
        >
          <Plus size={12} /> Nouvelle
        </button>
      </div>
    </div>
  );
}
