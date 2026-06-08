import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, Users, Mail, Phone, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Collab {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  photo_path: string | null;
  email_professionnel: string | null;
  gsm: string | null;
  code_genre: string;
  poste?: string;
  unite?: string;
}

const TrombinoscopePage: React.FC = () => {
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadCollabs();
  }, []);

  const loadCollabs = async () => {
    setLoading(true);
    try {
      // 3 requetes separees, jointure cote JavaScript
      // Avantage : ne depend d'aucune FK, marche dans tous les cas
      const [
        { data: collabsRaw },
        { data: affectations },
        { data: refPostes },
        { data: unitesData },
      ] = await Promise.all([
        supabase
          .from("collaborateurs")
          .select("id,matricule,nom,prenom,photo_path,email_professionnel,gsm,code_genre")
          .eq("archive", false)
          .neq("statut_collaborateur", "SORTI")
          .order("nom"),
        supabase
          .from("collaborateur_affectations")
          .select("collaborateur_id, code_poste, unite_id, date_fin_uo, date_debut_uo, archive")
          .eq("archive", false),
        supabase.from("ref_poste" as never).select("code, libelle"),
        supabase.from("unites_organisationnelles" as never).select("id, libelle"),
      ]);

      // Maps pour lookup rapide
      const posteMap: Record<string, string> = {};
      ((refPostes as any[]) || []).forEach((r: any) => { posteMap[r.code] = r.libelle; });

      const uniteMap: Record<string, string> = {};
      ((unitesData as any[]) || []).forEach((u: any) => { uniteMap[u.id] = u.libelle; });

      // Index des affectations par collaborateur_id
      const today = new Date().toISOString().split("T")[0];
      const affByCollab: Record<string, any[]> = {};
      ((affectations as any[]) || [])
        .filter((a: any) => !a.date_fin_uo || a.date_fin_uo >= today)
        .forEach((a: any) => {
          if (!affByCollab[a.collaborateur_id]) affByCollab[a.collaborateur_id] = [];
          affByCollab[a.collaborateur_id].push(a);
        });

      const resolvePosteLibelle = (codeInstance: string): string => {
        if (posteMap[codeInstance]) return posteMap[codeInstance];
        const parentCode = codeInstance.includes("-") ? codeInstance.split("-").slice(0, -1).join("-") : codeInstance;
        return posteMap[parentCode] || codeInstance;
      };

      const result: Collab[] = ((collabsRaw || []) as any[]).map(c => {
        // Affectation la plus recente parmi celles actives
        const affs = affByCollab[c.id] || [];
        const aff = affs.sort((a: any, b: any) => (b.date_debut_uo || "").localeCompare(a.date_debut_uo || ""))[0];
        return {
          id: c.id,
          matricule: c.matricule,
          nom: c.nom,
          prenom: c.prenom,
          photo_path: c.photo_path,
          email_professionnel: c.email_professionnel,
          gsm: c.gsm,
          code_genre: c.code_genre,
          poste: aff?.code_poste ? resolvePosteLibelle(aff.code_poste) : undefined,
          unite: aff?.unite_id ? uniteMap[aff.unite_id] : undefined,
        };
      });
      setCollabs(result);
    } catch (e) {
      console.error("Erreur chargement trombinoscope:", e);
    }
    setLoading(false);
  };

  const filtered = collabs.filter(c => {
    const q = search.toLowerCase();
    return !q || `${c.prenom} ${c.nom} ${c.matricule} ${c.poste || ""} ${c.unite || ""}`.toLowerCase().includes(q);
  });

  const getPhotoUrl = (path: string | null) => {
    // Depuis la migration vers FastAPI, photo_path contient déjà l'URL complète
    // (ex: http://localhost:8000/api/v1/storage/photos_collaborateurs/{uuid}.png?v=...)
    // Pour les anciennes valeurs (chemin relatif Supabase), on retourne null.
    if (!path) return null;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return null;
  };

  const getInitials = (c: Collab) => `${c.prenom[0] || ""}${c.nom[0] || ""}`.toUpperCase();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
          <Users size={24} /> Annuaire / Trombinoscope
        </h1>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <input
            type="text"
            placeholder="Rechercher un collaborateur…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 rounded-lg border text-sm w-72"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
          />
        </div>
      </div>

      <p className="text-sm mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
        {filtered.length} collaborateur{filtered.length > 1 ? "s" : ""}
      </p>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map(c => {
            const photoUrl = getPhotoUrl(c.photo_path);
            return (
              <div
                key={c.id}
                onClick={() => navigate(`/collaborateurs/${c.id}`)}
                className="rounded-xl border p-4 flex flex-col items-center gap-2 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              >
                {photoUrl ? (
                  <img src={photoUrl} alt={`${c.prenom} ${c.nom}`} className="w-16 h-16 rounded-full object-cover border-2" style={{ borderColor: "hsl(var(--border))" }} />
                ) : (
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold"
                    style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}
                  >
                    {getInitials(c)}
                  </div>
                )}
                <div className="text-center">
                  <p className="text-sm font-semibold truncate max-w-[140px]" style={{ color: "hsl(var(--foreground))" }}>
                    {c.prenom} {c.nom}
                  </p>
                  <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</p>
                </div>
                {c.poste && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full truncate max-w-full" style={{ background: "hsl(var(--accent) / 0.08)", color: "hsl(var(--accent))" }}>
                    {c.poste}
                  </span>
                )}
                {c.unite && (
                  <span className="text-[10px] flex items-center gap-1 truncate max-w-full" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <Building2 size={9} /> {c.unite}
                  </span>
                )}
                <div className="flex gap-2 mt-1">
                  {c.email_professionnel && (
                    <a href={`mailto:${c.email_professionnel}`} onClick={e => e.stopPropagation()} title={c.email_professionnel}>
                      <Mail size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                    </a>
                  )}
                  {c.gsm && (
                    <a href={`tel:${c.gsm}`} onClick={e => e.stopPropagation()} title={c.gsm}>
                      <Phone size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrombinoscopePage;
