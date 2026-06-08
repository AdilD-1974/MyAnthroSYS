/**
 * MonEquipePage — Espace manager : pilotage de l'équipe.
 *
 * Onglets : Mon équipe · Demandes à valider · Planning/Absences · Actions
 *
 * L'équipe est résolue via useMonEquipe (collaborateurs dont le manager connecté
 * est responsable N1, optionnellement N2). Sécurité : un manager ne voit que SES
 * subordonnés.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, CheckSquare, CalendarRange, Settings2, Loader2, AlertCircle,
  ChevronRight, UserCircle2, Mail, ArrowRightLeft, DoorOpen, Plane,
} from "lucide-react";
import { useCurrentCollaborateur } from "@/hooks/useCurrentCollaborateur";
import { useMonEquipe, MembreEquipe } from "@/hooks/useMonEquipe";
import { useFormatMasks } from "@/hooks/useFormatMasks";

type TabKey = "equipe" | "validations" | "planning" | "actions";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "equipe", label: "Mon équipe", icon: Users },
  { key: "validations", label: "Demandes à valider", icon: CheckSquare },
  { key: "planning", label: "Planning / Absences", icon: CalendarRange },
  { key: "actions", label: "Actions", icon: Settings2 },
];

const MonEquipePage: React.FC = () => {
  useFormatMasks();
  const navigate = useNavigate();
  const { collaborateur, collaborateurId, loading: loadingMe, isLinked } = useCurrentCollaborateur();
  const { equipe, loading: loadingTeam, count } = useMonEquipe(collaborateurId, true);
  const [tab, setTab] = useState<TabKey>("equipe");

  if (loadingMe) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} size={28} />
      </div>
    );
  }

  if (!isLinked) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl p-6 flex items-start gap-3"
          style={{ background: "hsl(45 95% 55% / 0.1)", border: "1px solid hsl(45 95% 55% / 0.3)" }}>
          <AlertCircle size={20} style={{ color: "hsl(45 95% 42%)", flexShrink: 0, marginTop: 2 }} />
          <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
            Votre compte n'est lié à aucune fiche collaborateur. Contactez votre administrateur RH.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      {/* En-tête */}
      <div className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1" style={{ color: "hsl(var(--muted-foreground) / 0.8)" }}>
          Espace Manager
        </p>
        <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))", letterSpacing: "-0.02em" }}>
          Mon équipe
          {count > 0 && (
            <span className="ml-3 text-sm font-semibold px-2.5 py-1 rounded-md align-middle"
              style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
              {count} membre{count > 1 ? "s" : ""}
            </span>
          )}
        </h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {collaborateur?.prenom} {collaborateur?.nom} · pilotage et validations
        </p>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 overflow-x-auto mb-6" style={{ borderBottom: "1px solid hsl(var(--border) / 0.6)" }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)}
              className="flex items-center gap-2 px-4 py-3 text-[13px] whitespace-nowrap transition-all"
              style={{
                color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                fontWeight: active ? 600 : 500,
                marginBottom: "-1px",
                borderBottom: active ? "2px solid hsl(var(--accent))" : "2px solid transparent",
              }}>
              <Icon size={15} style={{ color: active ? "hsl(var(--accent))" : "currentColor" }} />
              {label}
              {key === "equipe" && count > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-md text-[10px] font-bold"
                  style={{ background: active ? "hsl(var(--accent) / 0.12)" : "hsl(var(--muted))", color: active ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Mon équipe ── */}
      {tab === "equipe" && (
        loadingTeam ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} /></div>
        ) : equipe.length === 0 ? (
          <EmptyState icon={<Users size={28} />} text="Aucun collaborateur ne vous est rattaché actuellement." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {equipe.map(m => <MembreCard key={m.id} membre={m} onOpen={() => navigate(`/collaborateurs/${m.id}`)} />)}
          </div>
        )
      )}

      {/* ── Validations ── */}
      {tab === "validations" && (
        <ManagerCard title="Demandes à valider" icon={<CheckSquare size={15} />}>
          <p className="text-sm mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
            Les demandes de congé de votre équipe en attente de validation apparaîtront ici.
          </p>
          <button onClick={() => navigate("/absences/validation")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            Ouvrir la validation des demandes <ChevronRight size={15} />
          </button>
        </ManagerCard>
      )}

      {/* ── Planning ── */}
      {tab === "planning" && (
        <ManagerCard title="Planning / Absences de l'équipe" icon={<CalendarRange size={15} />}>
          <p className="text-sm mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
            Visualisez les absences et présences de votre équipe.
          </p>
          <button onClick={() => navigate("/absences/planning")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))", border: "1px solid hsl(var(--accent) / 0.25)" }}>
            Ouvrir le planning <ChevronRight size={15} />
          </button>
        </ManagerCard>
      )}

      {/* ── Actions ── */}
      {tab === "actions" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ActionTile
            icon={<ArrowRightLeft size={20} />}
            title="Mouvement interne"
            desc="Initier un changement d'affectation ou de poste pour un membre de l'équipe."
            onClick={() => navigate("/mouvements")}
          />
          <ActionTile
            icon={<DoorOpen size={20} />}
            title="Départ provisoire"
            desc="Déclarer un départ provisoire (mission, détachement, suspension)."
            onClick={() => navigate("/departs-provisoires")}
          />
          <ActionTile
            icon={<Plane size={20} />}
            title="Saisir un congé"
            desc="Saisir une demande de congé au nom d'un collaborateur."
            onClick={() => navigate("/absences/saisie")}
          />
          <ActionTile
            icon={<Users size={20} />}
            title="Organigramme"
            desc="Voir la structure organisationnelle complète."
            onClick={() => navigate("/organisations")}
          />
        </div>
      )}
    </div>
  );
};

// ── Sous-composants ────────────────────────────────────────────────────────
const MembreCard: React.FC<{ membre: MembreEquipe; onOpen: () => void }> = ({ membre, onOpen }) => {
  const initials = `${membre.prenom?.[0] || ""}${membre.nom?.[0] || ""}`;
  return (
    <button onClick={onOpen}
      className="text-left rounded-xl p-4 transition-all hover:shadow-md hover:-translate-y-px"
      style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.7)" }}>
      <div className="flex items-center gap-3">
        {membre.photo_path ? (
          <img src={membre.photo_path} alt="" className="w-12 h-12 rounded-full object-cover"
            style={{ border: "2px solid hsl(var(--card))", boxShadow: "0 0 0 1px hsl(var(--border))" }} />
        ) : (
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground) / 0.55)" }}>
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
            {membre.prenom} {membre.nom}
          </p>
          <p className="text-[11px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
            #{membre.matricule}
          </p>
        </div>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
          style={{
            background: membre.niveau === "N1" ? "hsl(var(--accent) / 0.12)" : "hsl(var(--muted))",
            color: membre.niveau === "N1" ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
          }}>
          {membre.niveau}
        </span>
      </div>
      {membre.email_professionnel && (
        <p className="text-[11px] mt-3 flex items-center gap-1.5 truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Mail size={11} /> {membre.email_professionnel}
        </p>
      )}
    </button>
  );
};

const ManagerCard: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.7)" }}>
    <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: "1px solid hsl(var(--border) / 0.4)" }}>
      {icon && <span style={{ color: "hsl(var(--muted-foreground))" }}>{icon}</span>}
      <h3 className="text-sm font-semibold tracking-tight" style={{ color: "hsl(var(--foreground))" }}>{title}</h3>
    </div>
    <div className="px-6 py-5">{children}</div>
  </div>
);

const ActionTile: React.FC<{ icon: React.ReactNode; title: string; desc: string; onClick: () => void }> = ({ icon, title, desc, onClick }) => (
  <button onClick={onClick}
    className="text-left rounded-xl p-5 transition-all hover:shadow-md hover:-translate-y-px"
    style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.7)" }}>
    <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl mb-3"
      style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
      {icon}
    </div>
    <h3 className="text-sm font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>{title}</h3>
    <p className="text-[12px] leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>{desc}</p>
  </button>
);

const EmptyState: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="text-center py-16 rounded-xl" style={{ border: "1px dashed hsl(var(--border))" }}>
    <div className="inline-flex mb-3" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>{icon}</div>
    <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{text}</p>
  </div>
);

export default MonEquipePage;
