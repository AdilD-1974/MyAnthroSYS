/**
 * MonEspacePage — Espace self-service du collaborateur connecté.
 *
 * Onglets : Ma fiche · Mes congés · Mes documents · Trombinoscope · Apparence
 *
 * Sécurité : ne montre QUE les données du collaborateur lié au compte connecté
 * (résolu via useCurrentCollaborateur). Aucune possibilité de voir un autre collab.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  User, CalendarDays, FileText, Users as UsersIcon, Palette,
  Mail, Phone, Calendar, Plane, AlertCircle, ChevronRight, Loader2,
} from "lucide-react";
import { useCurrentCollaborateur } from "@/hooks/useCurrentCollaborateur";
import { useFormatMasks, fmtDate } from "@/hooks/useFormatMasks";

type TabKey = "fiche" | "conges" | "documents" | "trombinoscope" | "apparence";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "fiche", label: "Ma fiche", icon: User },
  { key: "conges", label: "Mes congés", icon: CalendarDays },
  { key: "documents", label: "Mes documents", icon: FileText },
  { key: "trombinoscope", label: "Trombinoscope", icon: UsersIcon },
  { key: "apparence", label: "Apparence", icon: Palette },
];

const MonEspacePage: React.FC = () => {
  useFormatMasks(); // charge le cache des masques
  const navigate = useNavigate();
  const { collaborateur, collaborateurId, loading, error, isLinked } = useCurrentCollaborateur();
  const [tab, setTab] = useState<TabKey>("fiche");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} size={28} />
      </div>
    );
  }

  if (!isLinked || !collaborateur) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl p-6 flex items-start gap-3"
          style={{ background: "hsl(45 95% 55% / 0.1)", border: "1px solid hsl(45 95% 55% / 0.3)" }}>
          <AlertCircle size={20} style={{ color: "hsl(45 95% 42%)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>
              Compte non rattaché
            </p>
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              {error || "Votre compte n'est lié à aucune fiche collaborateur. Contactez votre administrateur RH."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const initials = `${collaborateur.prenom?.[0] || ""}${collaborateur.nom?.[0] || ""}`;
  const photoUrl = collaborateur.photo_path || null;
  const age = collaborateur.date_naissance
    ? Math.floor((Date.now() - new Date(collaborateur.date_naissance).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto">
      {/* En-tête de bienvenue */}
      <div className="rounded-2xl mb-6 relative overflow-hidden"
        style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border) / 0.7)",
          boxShadow: "0 1px 3px hsl(var(--foreground) / 0.03), 0 8px 24px -10px hsl(var(--foreground) / 0.08)",
        }}>
        <div className="absolute left-0 right-0 top-0 h-[3px]"
          style={{ background: "linear-gradient(90deg, hsl(var(--accent)) 0%, hsl(var(--accent) / 0.4) 60%, transparent 100%)" }} />
        <div className="px-8 py-6 flex items-center gap-6">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="w-24 h-24 rounded-full object-cover"
              style={{ border: "4px solid hsl(var(--card))", boxShadow: "0 0 0 1px hsl(var(--border))" }} />
          ) : (
            <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
              style={{
                background: "linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--card)) 100%)",
                color: "hsl(var(--foreground) / 0.55)",
                border: "4px solid hsl(var(--card))", boxShadow: "0 0 0 1px hsl(var(--border))",
              }}>
              {initials}
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] mb-1"
              style={{ color: "hsl(var(--muted-foreground) / 0.8)" }}>
              Bienvenue
            </p>
            <h1 className="text-[26px] font-bold leading-none" style={{ color: "hsl(var(--foreground))", letterSpacing: "-0.02em" }}>
              {collaborateur.prenom} <span style={{ fontWeight: 800 }}>{collaborateur.nom?.toUpperCase()}</span>
            </h1>
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <span className="text-[13px] font-mono font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                #{collaborateur.matricule}
              </span>
              {collaborateur.email_professionnel && (
                <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Mail size={13} /> {collaborateur.email_professionnel}
                </span>
              )}
            </div>
          </div>
        </div>
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
            </button>
          );
        })}
      </div>

      {/* Contenu */}
      {tab === "fiche" && (
        <div className="space-y-5">
          <SelfCard title="État civil" icon={<User size={15} />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Info label="Matricule" value={`#${collaborateur.matricule}`} />
              <Info label="Civilité" value={collaborateur.civilite} />
              <Info label="Nom" value={collaborateur.nom} />
              <Info label="Prénom" value={collaborateur.prenom} />
              <Info label="Date de naissance" value={collaborateur.date_naissance ? `${fmtDate(collaborateur.date_naissance)}${age ? ` · ${age} ans` : ""}` : undefined} />
              <Info label="Statut" value={collaborateur.statut_collaborateur} />
            </div>
          </SelfCard>
          <SelfCard title="Coordonnées" icon={<Phone size={15} />}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Info label="Email professionnel" value={collaborateur.email_professionnel} />
              <Info label="Téléphone" value={collaborateur.telephone} />
              <Info label="GSM" value={collaborateur.gsm} />
            </div>
            <p className="text-[11px] mt-4" style={{ color: "hsl(var(--muted-foreground))" }}>
              Pour mettre à jour vos coordonnées, contactez le service RH ou utilisez le bouton ci-dessous.
            </p>
          </SelfCard>
        </div>
      )}

      {tab === "conges" && (
        <SelfCard title="Mes congés" icon={<CalendarDays size={15} />}>
          <p className="text-sm mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
            Consultez votre solde et soumettez une demande de congé.
          </p>
          <button
            onClick={() => navigate(`/absences/saisie?collaborateur=${collaborateurId}`)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plane size={15} /> Demander un congé
          </button>
        </SelfCard>
      )}

      {tab === "documents" && (
        <SelfCard title="Mes documents" icon={<FileText size={15} />}>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            Vos bulletins de paie et attestations apparaîtront ici.
          </p>
        </SelfCard>
      )}

      {tab === "trombinoscope" && (
        <SelfCard title="Trombinoscope" icon={<UsersIcon size={15} />}>
          <button
            onClick={() => navigate("/trombinoscope")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))", border: "1px solid hsl(var(--accent) / 0.25)" }}>
            Ouvrir le trombinoscope <ChevronRight size={15} />
          </button>
        </SelfCard>
      )}

      {tab === "apparence" && (
        <SelfCard title="Apparence" icon={<Palette size={15} />}>
          <button
            onClick={() => navigate("/apparence")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))", border: "1px solid hsl(var(--accent) / 0.25)" }}>
            Personnaliser l'apparence <ChevronRight size={15} />
          </button>
        </SelfCard>
      )}
    </div>
  );
};

// ── Sous-composants UI ───────────────────────────────────────────────────────
const SelfCard: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="rounded-xl mb-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.7)" }}>
    <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: "1px solid hsl(var(--border) / 0.4)" }}>
      {icon && <span style={{ color: "hsl(var(--muted-foreground))" }}>{icon}</span>}
      <h3 className="text-sm font-semibold tracking-tight" style={{ color: "hsl(var(--foreground))" }}>{title}</h3>
    </div>
    <div className="px-6 py-5">{children}</div>
  </div>
);

const Info: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div>
    <p className="text-[11px] mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
    <p className="text-sm font-medium" style={{ color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
      {value || "—"}
    </p>
  </div>
);

export default MonEspacePage;
