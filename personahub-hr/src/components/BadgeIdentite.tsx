// ============================================================
// BadgeIdentite.tsx — src/components/BadgeIdentite.tsx
// ------------------------------------------------------------
// Carte d'identité réutilisable (photo + nom + matricule + rôle).
// Autonome : récupère elle-même la photo du collaborateur lié
// (profile.collaborateur_id -> photo_path), avec repli initiales.
//
// variant="clair"  -> texte foncé (barre du haut claire)
// variant="sombre" -> texte blanc (bandeau bleu nuit)
// ============================================================
import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

const LABEL_ROLE: Record<string, string> = {
  administrateur: "Administrateur",
  gestionnaire_rh: "Gestionnaire RH",
  gestionnaire_paie: "Gestionnaire Paie",
  manager: "Manager",
  collaborateur: "Collaborateur",
};
const libelleRole = (r?: string | null) => (r && LABEL_ROLE[r]) || (r ?? "");

type Variant = "clair" | "sombre";

interface Theme {
  nom: string; sub: string; pillBg: string; pillTxt: string; hover: string;
  avBg: string; avTxt: string; avBorder: string; photoBorder: string;
}
const THEMES: Record<Variant, Theme> = {
  sombre: {
    nom: "#fff", sub: "rgba(255,255,255,0.78)",
    pillBg: "rgba(255,255,255,0.18)", pillTxt: "#fff",
    hover: "hover:bg-white/10",
    avBg: "rgba(255,255,255,0.18)", avTxt: "#fff",
    avBorder: "rgba(255,255,255,0.35)", photoBorder: "rgba(255,255,255,0.65)",
  },
  clair: {
    nom: "hsl(var(--foreground))", sub: "hsl(var(--muted-foreground))",
    pillBg: "hsl(var(--muted))", pillTxt: "hsl(var(--foreground))",
    hover: "hover:bg-[hsl(var(--muted))]",
    avBg: "hsl(var(--accent) / 0.15)", avTxt: "hsl(var(--accent))",
    avBorder: "hsl(var(--border))", photoBorder: "hsl(var(--border))",
  },
};

function Avatar({ url, initiales, size, t }: { url?: string; initiales: string; size: number; t: Theme }) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setErr(true)}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, border: `2px solid ${t.photoBorder}` }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{
        width: size, height: size, fontSize: size <= 36 ? 12 : 15,
        background: t.avBg, color: t.avTxt, border: `2px solid ${t.avBorder}`,
      }}
    >
      {initiales}
    </div>
  );
}

interface BadgeIdentiteProps {
  size?: number;
  showRole?: boolean;
  lien?: boolean;
  variant?: Variant;
  className?: string;
}

export default function BadgeIdentite({
  size = 48, showRole = true, lien = true, variant = "sombre", className = "",
}: BadgeIdentiteProps) {
  const { user, profile, activeRole } = useAuth();
  const t = THEMES[variant];
  const [collab, setCollab] = useState<{
    nom?: string; prenom?: string; matricule?: string; photo_path?: string;
  } | null>(null);

  useEffect(() => {
    const cid = profile?.collaborateur_id;
    if (!cid) { setCollab(null); return; }
    let actif = true;
    api
      .get<any>(`/db/collaborateurs?id=eq.${cid}&select=id,nom,prenom,matricule,photo_path`)
      .then((rows) => { if (actif) setCollab(Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null)); })
      .catch(() => { if (actif) setCollab(null); });
    return () => { actif = false; };
  }, [profile?.collaborateur_id]);

  const prenom = collab?.prenom ?? profile?.prenom ?? "";
  const nom = collab?.nom ?? profile?.nom ?? "";
  const nomComplet = `${prenom} ${nom}`.trim() || user?.email?.split("@")[0] || "Utilisateur";
  const matricule = collab?.matricule ?? profile?.matricule ?? "";
  const photoUrl = collab?.photo_path || "";
  const initiales =
    `${prenom?.[0] ?? ""}${nom?.[0] ?? ""}`.toUpperCase() ||
    (user?.email?.[0]?.toUpperCase() ?? "?");

  const contenu = (
    <>
      <div className="min-w-0 text-right">
        <p className="text-sm font-semibold leading-tight truncate" style={{ color: t.nom }}>
          {nomComplet}
        </p>
        {matricule && (
          <p className="text-xs leading-tight" style={{ color: t.sub }}>Mat. {matricule}</p>
        )}
        {showRole && activeRole && (
          <span
            className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: t.pillBg, color: t.pillTxt }}
          >
            {libelleRole(activeRole)}
          </span>
        )}
      </div>
      <Avatar url={photoUrl} initiales={initiales} size={size} t={t} />
    </>
  );

  const base = `flex items-center gap-3 rounded-xl px-3 py-1.5 ${className}`;

  return lien ? (
    <NavLink to="/profile" title="Voir mon profil" className={`${base} transition-colors ${t.hover}`}>
      {contenu}
    </NavLink>
  ) : (
    <div className={base}>{contenu}</div>
  );
}
