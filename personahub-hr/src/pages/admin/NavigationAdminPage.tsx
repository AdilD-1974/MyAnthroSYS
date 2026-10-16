// ============================================================
// NavigationAdminPage.tsx — src/pages/admin/NavigationAdminPage.tsx
// Route : /admin/navigation  (réservé administrateur)
// ------------------------------------------------------------
// Refonte « conviviale » :
//   • Liste GROUPÉE PAR SECTION (en-têtes + écrans + sous-menus
//     indentés) — plus d'entremêlement.
//   • Gestion des sections : créer, renommer, réordonner (↑/↓),
//     désactiver, ajouter un écran directement dans la section.
//   • Réordonnancement par niveau (sections / écrans d'une section /
//     sous-menus d'un parent) via flèches, sans franchir les groupes.
//   • Icônes colorées par module, matrice de rôles, panneau d'édition.
// ============================================================
import React, { useCallback, useEffect, useState } from "react";
import {
  navApi, NavItem, NavSection, MODULES, couleurModule, labelModule,
} from "@/lib/navApi";
import {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell, LogOut,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image as ImageIcon, FileStack,
  UserPlus, GraduationCap, Target, HeartHandshake, ClipboardList,
  ChevronRight, ChevronDown, ChevronUp, Plus, FolderPlus, Pencil,
  X, Check, Trash2, Power, FolderTree, CornerDownRight, CornerUpLeft,
  GripVertical, LucideIcon,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// REGISTRE ICÔNES
// ──────────────────────────────────────────────────────────────
const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell, LogOut,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image: ImageIcon, FileStack,
  UserPlus, GraduationCap, Target, HeartHandshake, ClipboardList,
};
const ICONES_SUGGERES = Object.keys(ICONES);
const NIVEAU_MAX = 5; // 6 niveaux : racine (0) → ... → niveau 5

function Icone({ nom, size = 18, className, couleur }: { nom?: string; size?: number; className?: string; couleur?: string }) {
  if (!nom) return <span className="inline-block" style={{ width: size, height: size }} />;
  const Ic = ICONES[nom];
  const style = couleur ? { color: couleur } : undefined;
  if (Ic) return <Ic size={size} className={className} style={style} />;
  return (
    <span className={`inline-flex items-center justify-center rounded text-[9px] font-mono bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] ${className ?? ""}`}
      style={{ width: size, height: size }} title={nom}>
      {nom.slice(0, 2)}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────
// RÔLES
// ──────────────────────────────────────────────────────────────
const ROLES = [
  { code: "collaborateur",     label: "Collaborateur",     court: "Collab.", dot: "hsl(var(--muted-foreground))" },
  { code: "manager",           label: "Manager",           court: "Manager", dot: "hsl(var(--warning))" },
  { code: "gestionnaire_rh",   label: "Gestionnaire RH",   court: "RH",      dot: "hsl(var(--accent))" },
  { code: "gestionnaire_paie", label: "Gestionnaire Paie", court: "Paie",    dot: "hsl(var(--secondary))" },
  { code: "administrateur",    label: "Administrateur",    court: "Admin",   dot: "hsl(var(--primary))" },
];
const roleMeta = (code: string) => ROLES.find((r) => r.code === code);

function RoleDots({ roles }: { roles: string[] }) {
  const set = new Set(roles ?? []);
  return (
    <div className="flex items-center gap-1">
      {ROLES.map((r) => {
        const on = set.has(r.code);
        return (
          <span key={r.code} title={`${r.label}${on ? "" : " — masqué"}`} className="inline-block rounded-full transition-all"
            style={{ width: 9, height: 9, background: on ? r.dot : "transparent", border: on ? "none" : "1.5px solid hsl(var(--border))" }} />
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// PANNEAU ÉDITION D'UN ÉLÉMENT
// ──────────────────────────────────────────────────────────────
function ItemEditPanel({
  item, sections, items, sectionParDefaut, parentParDefaut, onSave, onClose, onActifToggled,
}: {
  item: NavItem | null;
  sections: NavSection[];
  items: NavItem[];
  sectionParDefaut?: string;
  parentParDefaut?: string;
  onSave: (updated: NavItem) => void;
  onClose: () => void;
  onActifToggled: (id: string, actif: boolean) => void;
}) {
  const isNew = !item;
  const [label, setLabel] = useState(item?.label ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [icone, setIcone] = useState(item?.icone ?? "");
  const [chemin, setChemin] = useState(item?.chemin ?? "");
  const [sectionId, setSectionId] = useState(item?.section_id ?? sectionParDefaut ?? "");
  const [parentId, setParentId] = useState(item?.parent_id ?? parentParDefaut ?? "");
  const [moduleCode, setModuleCode] = useState(item?.module_code ?? "");
  const [roles, setRoles] = useState<string[]>(item?.roles ?? []);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState("");

  const champ = "w-full text-sm rounded-lg px-3 py-2 outline-none bg-[hsl(var(--muted))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] focus:border-[hsl(var(--ring))] transition-colors";
  const lab = "block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1";

  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const sauvegarder = async () => {
    if (!label.trim()) { setErreur("Le libellé est obligatoire."); return; }
    if (isNew && !code.trim()) { setErreur("Le code est obligatoire."); return; }
    setSaving(true); setErreur("");
    try {
      const saved = isNew
        ? await navApi.creerItem({ code: code.trim(), label: label.trim(), icone: icone || undefined,
            chemin: chemin || undefined, section_id: sectionId || undefined, parent_id: parentId || undefined,
            module_code: moduleCode || undefined, ordre: 0, roles })
        : await navApi.modifierItem(item!.id, { label: label.trim(), icone: icone || undefined,
            chemin: chemin || undefined, section_id: sectionId || undefined, parent_id: parentId || undefined,
            module_code: moduleCode || undefined, roles });
      onSave(saved);
    } catch { setErreur("Erreur lors de la sauvegarde."); }
    finally { setSaving(false); }
  };

  const aEnfants = items.some((i) => i.parent_id === item?.id);
  const basculerActif = async () => {
    if (!item) return;
    if (item.actif) {
      if (!window.confirm(`Désactiver « ${item.label} » ?${aEnfants ? "\nSes sous-menus seront aussi désactivés." : ""}`)) return;
      await navApi.supprimerItem(item.id);
      onActifToggled(item.id, false);
    } else {
      await navApi.modifierItem(item.id, { actif: true });
      onActifToggled(item.id, true);
    }
  };

  const profondeur = (id: string): number => {
    let d = 0; let cur = items.find((x) => x.id === id);
    while (cur?.parent_id) { d++; cur = items.find((x) => x.id === cur!.parent_id); if (d > 6) break; }
    return d;
  };
  const descendantsDe = (id?: string): Set<string> => {
    const out = new Set<string>(); if (!id) return out;
    const stack = [id];
    while (stack.length) { const c = stack.pop()!; items.forEach((x) => { if (x.parent_id === c && !out.has(x.id)) { out.add(x.id); stack.push(x.id); } }); }
    return out;
  };
  const descSelf = descendantsDe(item?.id);
  const candidatsParent = items.filter((i) => i.id !== item?.id && !descSelf.has(i.id) && profondeur(i.id) < NIVEAU_MAX);

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--card))]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2 min-w-0">
          <Icone nom={icone} size={18} couleur={couleurModule(moduleCode)} className="shrink-0" />
          <h2 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{isNew ? "Nouvel élément" : item!.label}</h2>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {erreur && <p className="text-xs rounded-lg px-3 py-2 bg-[hsl(var(--destructive)_/_0.12)] text-[hsl(var(--destructive))]">{erreur}</p>}

        {isNew && (
          <div>
            <label className={lab}>Code (unique, non modifiable)</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s/g, "_"))} placeholder="ex: mon_module" className={`${champ} font-mono`} />
          </div>
        )}

        <div><label className={lab}>Libellé *</label><input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus className={champ} /></div>
        <div><label className={lab}>Route React</label><input value={chemin} onChange={(e) => setChemin(e.target.value)} placeholder="ex: /mon-module — vide = groupe parent" className={`${champ} font-mono`} /></div>

        <div>
          <label className={lab}>Icône</label>
          <div className="grid grid-cols-8 gap-1 max-h-32 overflow-y-auto p-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
            {ICONES_SUGGERES.map((ic) => (
              <button key={ic} type="button" title={ic} onClick={() => setIcone(ic)}
                className={`aspect-square flex items-center justify-center rounded-md transition-colors ${icone === ic ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--foreground))]"}`}>
                <Icone nom={ic} size={16} />
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lab}>Section</label>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={`${champ} px-2`}>
              <option value="">— aucune —</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lab}>Sous-menu de</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={`${champ} px-2`}>
              <option value="">— aucun —</option>
              {candidatsParent.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={lab}>Module</label>
          <select value={moduleCode} onChange={(e) => setModuleCode(e.target.value)} className={`${champ} px-2`}>
            <option value="">— aucun —</option>
            {Object.values(MODULES).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          {moduleCode && (
            <p className="text-xs mt-1.5 flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: couleurModule(moduleCode) }} />
              {labelModule(moduleCode)} — couleur de l'icône
            </p>
          )}
        </div>

        <div>
          <label className={lab}>Visible par les rôles</label>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => {
              const on = roles.includes(r.code);
              return (
                <button key={r.code} type="button" onClick={() => toggleRole(r.code)}
                  className="text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1 transition-colors"
                  style={{ borderColor: on ? r.dot : "hsl(var(--border))", color: on ? r.dot : "hsl(var(--muted-foreground))" }}>
                  {on && <Check size={12} />}{r.label}
                </button>
              );
            })}
          </div>
          {roles.length === 0 && <p className="text-xs mt-1.5 text-[hsl(var(--warning))]">⚠ Aucun rôle → invisible pour tous.</p>}
        </div>
      </div>

      <div className="p-4 border-t border-[hsl(var(--border))] space-y-2">
        <button onClick={sauvegarder} disabled={saving} className="w-full py-2 rounded-lg text-sm font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity disabled:opacity-40">
          {saving ? "Enregistrement…" : isNew ? "Créer l'élément" : "Enregistrer"}
        </button>
        {!isNew && item && (item.actif ? (
          <button onClick={basculerActif} className="w-full py-1.5 rounded-lg text-xs inline-flex items-center justify-center gap-1.5 text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)_/_0.1)] transition-colors">
            <Trash2 size={13} /> Désactiver{aEnfants ? " (et ses sous-menus)" : " cet élément"}
          </button>
        ) : (
          <button onClick={basculerActif} className="w-full py-1.5 rounded-lg text-xs inline-flex items-center justify-center gap-1.5 text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)_/_0.1)] transition-colors">
            <Power size={13} /> Réactiver{aEnfants ? " (et ses sous-menus)" : " cet élément"}
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// LIGNE D'ÉLÉMENT (écran / sous-menu)
// ──────────────────────────────────────────────────────────────
function ItemRow({
  item, depth, selected, canUp, canDown, canIndenter, canSortir, onMove, onSelect, onAddChild,
  onIndenter, onSortir, dragId, dragOverId, onDragStart, onDragEnd, onDragOverRow, onDrop,
}: {
  item: NavItem; depth: number; selected: boolean; canUp: boolean; canDown: boolean;
  canIndenter: boolean; canSortir: boolean;
  onMove: (item: NavItem, dir: -1 | 1) => void;
  onSelect: (item: NavItem) => void;
  onAddChild?: (item: NavItem) => void;
  onIndenter: (item: NavItem) => void;
  onSortir: (item: NavItem) => void;
  dragId: string | null;
  dragOverId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverRow: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const estGroupe = !item.chemin;
  const arrow = "w-5 h-4 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--primary))] disabled:opacity-25 disabled:hover:bg-transparent transition-colors";
  const enTrainDeGlisser = dragId === item.id;
  const survolePourDepot = dragOverId === item.id && dragId !== item.id;
  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(item.id); }}
      onDragEnd={(e) => { e.stopPropagation(); onDragEnd(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOverRow(item.id); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(item.id); }}
      onClick={() => onSelect(item)}
      className={`group flex items-center gap-2 pr-3 py-2 rounded-lg cursor-pointer select-none transition-colors ${selected ? "bg-[hsl(var(--accent)_/_0.14)]" : "hover:bg-[hsl(var(--muted))]"} ${!item.actif ? "opacity-40" : ""} ${enTrainDeGlisser ? "opacity-40" : ""} ${survolePourDepot ? "ring-2 ring-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.06)]" : ""}`}
      style={{ paddingLeft: 10 + depth * 22 }}>
      <span className="shrink-0 cursor-grab active:cursor-grabbing text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-60" title="Glisser pour déplacer / réimbriquer" onClick={(e) => e.stopPropagation()}>
        <GripVertical size={13} />
      </span>

      <span className="flex flex-col shrink-0" onClick={(e) => e.stopPropagation()}>
        <button className={arrow} disabled={!canUp} onClick={() => onMove(item, -1)} title="Monter"><ChevronUp size={12} /></button>
        <button className={arrow} disabled={!canDown} onClick={() => onMove(item, 1)} title="Descendre"><ChevronDown size={12} /></button>
      </span>

      <span className="flex flex-col shrink-0" onClick={(e) => e.stopPropagation()}>
        <button className={arrow} disabled={!canSortir} onClick={() => onSortir(item)} title="Sortir du groupe (remonter d'un niveau)"><CornerUpLeft size={12} /></button>
        <button className={arrow} disabled={!canIndenter} onClick={() => onIndenter(item)} title="Imbriquer sous l'élément précédent"><CornerDownRight size={12} /></button>
      </span>

      <span className="shrink-0">
        {depth > 0 && <ChevronRight size={12} className="inline -ml-1 mr-0.5 text-[hsl(var(--muted-foreground))]" />}
        <Icone nom={item.icone} size={18} className="inline" couleur={couleurModule(item.module_code)} />
      </span>

      <span className={`flex-1 text-sm truncate ${estGroupe ? "font-semibold" : ""} ${selected ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"}`}>
        {item.label}
        {estGroupe && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] inline-flex items-center gap-0.5"><FolderTree size={10} /> groupe</span>
        )}
      </span>

      {onAddChild && (
        <button onClick={(e) => { e.stopPropagation(); onAddChild(item); }} title="Ajouter un sous-menu"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-[hsl(var(--primary))] opacity-0 group-hover:opacity-100 hover:bg-[hsl(var(--primary)_/_0.1)] transition-opacity">
          <Plus size={13} />
        </button>
      )}
      <span className="text-xs font-mono truncate max-w-[150px] text-[hsl(var(--muted-foreground))]">{item.chemin ?? "—"}</span>
      <div className="shrink-0">
        {(item.roles?.length ?? 0) === 0 ? <span className="text-xs text-[hsl(var(--warning))]">⚠</span> : <RoleDots roles={item.roles} />}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// APERÇU SIDEBAR (groupé par section, fond bleu nuit)
// ──────────────────────────────────────────────────────────────
function ApercuSidebar({ sections, items, role }: { sections: NavSection[]; items: NavItem[]; role: string }) {
  const visible = (i: NavItem) => role === "tous" || (i.roles ?? []).includes(role);
  return (
    <div className="rounded-xl overflow-y-auto border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))] p-2 max-w-[240px] max-h-44">
      {[...sections].sort((a, b) => a.ordre - b.ordre).map((sec) => {
        const racines = items.filter((i) => i.section_id === sec.id && !i.parent_id && visible(i)).sort((a, b) => a.ordre - b.ordre);
        if (racines.length === 0) return null;
        return (
          <div key={sec.id} className="mb-1.5">
            <p className="px-2 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[hsl(var(--sidebar-foreground)_/_0.45)]">{sec.label}</p>
            {racines.map((i) => {
              const enfants = items.filter((c) => c.parent_id === i.id && visible(c)).sort((a, b) => a.ordre - b.ordre);
              return (
                <div key={i.id}>
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-[hsl(var(--sidebar-foreground)_/_0.85)]">
                    <Icone nom={i.icone} size={14} couleur={couleurModule(i.module_code)} /><span className="truncate">{i.label}</span>
                  </div>
                  {enfants.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 pl-7 pr-2 py-0.5 rounded-md text-xs text-[hsl(var(--sidebar-foreground)_/_0.6)]">
                      <Icone nom={c.icone} size={12} couleur={couleurModule(c.module_code)} /><span className="truncate">{c.label}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// PAGE
// ──────────────────────────────────────────────────────────────
export default function NavigationAdminPage() {
  const [items, setItems] = useState<NavItem[]>([]);
  const [sections, setSections] = useState<NavSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<NavItem | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [nouveauSectionId, setNouveauSectionId] = useState<string | undefined>(undefined);
  const [nouveauParentId, setNouveauParentId] = useState<string | undefined>(undefined);
  const [filtreSection, setFiltreSection] = useState("toutes");
  const [filtreRole, setFiltreRole] = useState("tous");
  const [filtreModule, setFiltreModule] = useState("tous");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [replies, setReplies] = useState<Set<string>>(new Set());
  const [editSectionId, setEditSectionId] = useState<string | null>(null);
  const [editSectionLabel, setEditSectionLabel] = useState("");
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [its, secs] = await Promise.all([navApi.items(), navApi.sections()]);
      setItems(Array.isArray(its) ? its : []);
      setSections(Array.isArray(secs) ? secs : []);
    } catch { setToast("Erreur de chargement (rôle administrateur requis)."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };
  // Prévient la sidebar (NavContext) qu'elle doit recharger son menu.
  const notifierSidebar = () => window.dispatchEvent(new Event("nav:refresh"));

  const passe = (i: NavItem) =>
    (filtreRole === "tous" || (i.roles ?? []).includes(filtreRole)) &&
    (filtreModule === "tous" || i.module_code === filtreModule);

  const racinesDe = (sectionId: string | null) =>
    items.filter((i) => (i.section_id ?? null) === sectionId && !i.parent_id && passe(i)).sort((a, b) => a.ordre - b.ordre);
  const enfantsDe = (parentId: string) =>
    items.filter((i) => i.parent_id === parentId && passe(i)).sort((a, b) => a.ordre - b.ordre);

  const sectionsTriees = [...sections].sort((a, b) => a.ordre - b.ordre)
    .filter((s) => filtreSection === "toutes" || s.id === filtreSection);
  const aSansSection = filtreSection === "toutes" && items.some((i) => !i.section_id && !i.parent_id);

  // ── Réordonnancement d'items (au sein du même groupe de frères) ──
  const deplacerItem = async (item: NavItem, dir: -1 | 1) => {
    const freres = (item.parent_id
      ? items.filter((i) => i.parent_id === item.parent_id)
      : items.filter((i) => (i.section_id ?? null) === (item.section_id ?? null) && !i.parent_id)
    ).sort((a, b) => a.ordre - b.ordre);
    const idx = freres.findIndex((f) => f.id === item.id);
    const cible = idx + dir;
    if (cible < 0 || cible >= freres.length) return;
    [freres[idx], freres[cible]] = [freres[cible], freres[idx]];
    const ordres = freres.map((f, i) => ({ id: f.id, ordre: i }));
    setItems((prev) => prev.map((p) => { const o = ordres.find((x) => x.id === p.id); return o ? { ...p, ordre: o.ordre } : p; }));
    setSaving(true);
    try { await navApi.reordonnerItems(ordres); showToast("Ordre mis à jour"); notifierSidebar(); }
    catch { showToast("Erreur lors du réordonnancement"); charger(); }
    finally { setSaving(false); }
  };

  // ── Profondeur d'un item (racine = 0), utilisée pour indenter/glisser ──
  const profondeurDe = (id: string): number => {
    let d = 0; let cur = items.find((x) => x.id === id);
    while (cur?.parent_id) { d++; cur = items.find((x) => x.id === cur!.parent_id); if (d > 6) break; }
    return d;
  };
  const estDescendantDe = (candidatId: string, ancetreId: string): boolean => {
    let cur = items.find((x) => x.id === candidatId);
    let d = 0;
    while (cur?.parent_id && d < 8) { if (cur.parent_id === ancetreId) return true; cur = items.find((x) => x.id === cur!.parent_id); d++; }
    return false;
  };
  const reparenter = async (id: string, nouveauParentId: string | undefined, ordre: number, nouveauSectionId?: string) => {
    setSaving(true);
    try {
      const maj: { parent_id?: string; ordre: number; section_id?: string } = { parent_id: nouveauParentId, ordre };
      if (nouveauSectionId !== undefined) maj.section_id = nouveauSectionId;
      await navApi.modifierItem(id, maj);
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...maj } : p)));
      notifierSidebar();
    } catch { showToast("Erreur lors du déplacement"); charger(); }
    finally { setSaving(false); }
  };

  // ── Indenter : l'item devient le dernier enfant de son frère précédent ──
  const indenterItem = async (item: NavItem) => {
    const freres = (item.parent_id
      ? items.filter((i) => i.parent_id === item.parent_id)
      : items.filter((i) => (i.section_id ?? null) === (item.section_id ?? null) && !i.parent_id)
    ).sort((a, b) => a.ordre - b.ordre);
    const idx = freres.findIndex((f) => f.id === item.id);
    if (idx <= 0) return; // pas de frère au-dessus
    const nouveauParent = freres[idx - 1];
    if (profondeurDe(nouveauParent.id) >= NIVEAU_MAX) { showToast("Profondeur maximale atteinte"); return; }
    const ordre = items.filter((i) => i.parent_id === nouveauParent.id).length;
    await reparenter(item.id, nouveauParent.id, ordre);
    showToast(`Imbriqué sous « ${nouveauParent.label} »`);
  };

  // ── Sortir : l'item devient frère de son parent actuel (remonte d'un cran) ──
  const sortirItem = async (item: NavItem) => {
    if (!item.parent_id) return;
    const ancienParent = items.find((p) => p.id === item.parent_id);
    if (!ancienParent) return;
    const nouveauParentId = ancienParent.parent_id;
    const freresCible = (nouveauParentId
      ? items.filter((i) => i.parent_id === nouveauParentId)
      : items.filter((i) => (i.section_id ?? null) === (ancienParent.section_id ?? null) && !i.parent_id)
    ).sort((a, b) => a.ordre - b.ordre);
    const idxParent = freresCible.findIndex((f) => f.id === ancienParent.id);
    const ordre = idxParent + 1;
    await reparenter(item.id, nouveauParentId, ordre, item.section_id !== ancienParent.section_id ? ancienParent.section_id : undefined);
    showToast("Sorti du groupe");
  };

  // ── Glisser-déposer : déposer A sur B fait de A un enfant de B ──
  const onDropSurItem = async (cibleId: string) => {
    setDragOverId(null);
    const sourceId = dragId; setDragId(null);
    if (!sourceId || sourceId === cibleId) return;
    if (estDescendantDe(cibleId, sourceId)) { showToast("Dépôt impossible : ce serait une boucle"); return; }
    const cible = items.find((i) => i.id === cibleId);
    if (!cible) return;
    if (profondeurDe(cibleId) >= NIVEAU_MAX) { showToast("Profondeur maximale atteinte"); return; }
    const ordre = items.filter((i) => i.parent_id === cibleId).length;
    await reparenter(sourceId, cibleId, ordre, cible.section_id);
    showToast(`Déplacé sous « ${cible.label} »`);
  };


  const deplacerSection = async (section: NavSection, dir: -1 | 1) => {
    const ordered = [...sections].sort((a, b) => a.ordre - b.ordre);
    const idx = ordered.findIndex((s) => s.id === section.id);
    const cible = idx + dir;
    if (cible < 0 || cible >= ordered.length) return;
    [ordered[idx], ordered[cible]] = [ordered[cible], ordered[idx]];
    const ordres = ordered.map((s, i) => ({ id: s.id, ordre: i }));
    setSections((prev) => prev.map((p) => { const o = ordres.find((x) => x.id === p.id); return o ? { ...p, ordre: o.ordre } : p; }));
    setSaving(true);
    try { await navApi.reordonnerSections(ordres); showToast("Sections réordonnées"); notifierSidebar(); }
    catch { showToast("Erreur"); charger(); }
    finally { setSaving(false); }
  };

  // ── Création / renommage / désactivation de section ──
  const creerSection = async () => {
    const label = newSectionLabel.trim();
    if (!label) return;
    const code = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const ordre = sections.reduce((m, s) => Math.max(m, s.ordre), -1) + 1;
    setSaving(true);
    try {
      const sec = await navApi.creerSection({ code: code || `section_${Date.now()}`, label, ordre });
      setSections((prev) => [...prev, sec]);
      setNewSectionLabel(""); setNewSectionOpen(false);
      showToast("Section créée"); notifierSidebar();
    } catch { showToast("Erreur (code de section déjà utilisé ?)"); }
    finally { setSaving(false); }
  };

  const renommerSection = async (id: string) => {
    const label = editSectionLabel.trim();
    if (!label) { setEditSectionId(null); return; }
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
    setEditSectionId(null);
    try { await navApi.modifierSection(id, { label }); showToast("Section renommée"); notifierSidebar(); }
    catch { showToast("Erreur"); charger(); }
  };

  const basculerSection = async (s: NavSection) => {
    const activer = !s.actif;
    if (!activer) {
      const n = items.filter((i) => i.section_id === s.id).length;
      if (!window.confirm(`Désactiver la section « ${s.label} » ?${n ? `\nSes ${n} écran(s) et sous-menus deviendront aussi inactifs.` : ""}`)) return;
    }
    try { await navApi.modifierSection(s.id, { actif: activer }); showToast(activer ? "Section réactivée" : "Section désactivée"); charger(); notifierSidebar(); }
    catch { showToast("Erreur"); }
  };

  const toggleRepli = (id: string) =>
    setReplies((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // ── Sauvegarde / suppression d'item ──
  const handleSave = (updated: NavItem) => {
    setItems((prev) => { const i = prev.findIndex((x) => x.id === updated.id); if (i >= 0) { const c = [...prev]; c[i] = updated; return c; } return [updated, ...prev]; });
    setSelected(updated); setShowNew(false); setNouveauSectionId(undefined); setNouveauParentId(undefined);
    showToast("Élément enregistré"); notifierSidebar();
  };
  const onActifToggled = async (id: string, actif: boolean) => {
    showToast(actif ? "Élément réactivé" : "Élément désactivé");
    try {
      const its = await navApi.items();
      const arr = Array.isArray(its) ? its : [];
      setItems(arr);
      setSelected(arr.find((i) => i.id === id) ?? null);
      notifierSidebar();
    } catch { charger(); }
  };

  const ouvrirNouveau = (sectionId?: string, parentId?: string) => { setSelected(null); setNouveauSectionId(sectionId); setNouveauParentId(parentId); setShowNew(true); };
  const ajouterSousMenu = (parent: NavItem) => ouvrirNouveau(parent.section_id ?? undefined, parent.id);

  const champFiltre = "text-sm rounded-lg px-2.5 py-1.5 outline-none bg-[hsl(var(--muted))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))]";
  const totalEcrans = items.length;

  const renderBranche = (noeuds: NavItem[], depth: number): React.ReactNode =>
    noeuds.map((node, i) => (
      <React.Fragment key={node.id}>
        <ItemRow item={node} depth={depth} selected={selected?.id === node.id}
          canUp={i > 0} canDown={i < noeuds.length - 1} onMove={deplacerItem}
          canIndenter={i > 0 && depth < NIVEAU_MAX} canSortir={depth > 0}
          onIndenter={indenterItem} onSortir={sortirItem}
          dragId={dragId} dragOverId={dragOverId}
          onDragStart={setDragId} onDragEnd={() => { setDragId(null); setDragOverId(null); }}
          onDragOverRow={setDragOverId} onDrop={onDropSurItem}
          onAddChild={depth < NIVEAU_MAX ? ajouterSousMenu : undefined}
          onSelect={(it) => { setSelected(it); setShowNew(false); }} />
        {renderBranche(enfantsDe(node.id), depth + 1)}
      </React.Fragment>
    ));
  const renderItems = (racines: NavItem[]) => renderBranche(racines, 0);

  return (
    <div className="flex h-full overflow-hidden bg-[hsl(var(--background))]">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Fil d'Ariane */}
        <div className="flex items-center gap-1.5 px-5 pt-4 pb-0 text-[13px] flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>
          <span>Configuration</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Navigation</span>
        </div>
        {/* Header */}
        <div className="px-5 pt-3 pb-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]"><Navigation size={18} /></span>
              <div>
                <h1 className="text-lg font-bold text-[hsl(var(--foreground))]">Navigation</h1>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{totalEcrans} écran{totalEcrans > 1 ? "s" : ""} · {sections.length} section{sections.length > 1 ? "s" : ""} — ↑↓ réordonner, ↳ imbriquer, glisser-déposer pour réorganiser</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {saving && <span className="text-xs text-[hsl(var(--muted-foreground))] animate-pulse">Sauvegarde…</span>}
              <button onClick={() => setNewSectionOpen((o) => !o)} className="px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"><FolderPlus size={15} /> Section</button>
              <button onClick={() => ouvrirNouveau()} className="px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"><Plus size={15} /> Écran</button>
            </div>
          </div>

          {newSectionOpen && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-[hsl(var(--muted))] border border-[hsl(var(--border))]">
              <FolderPlus size={15} className="text-[hsl(var(--primary))] ml-1" />
              <input autoFocus value={newSectionLabel} onChange={(e) => setNewSectionLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") creerSection(); if (e.key === "Escape") setNewSectionOpen(false); }}
                placeholder="Nom de la nouvelle section…" className="flex-1 text-sm rounded-md px-2 py-1.5 outline-none bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))]" />
              <button onClick={creerSection} className="px-3 py-1.5 rounded-md text-sm font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">Créer</button>
              <button onClick={() => { setNewSectionOpen(false); setNewSectionLabel(""); }} className="px-2 py-1.5 rounded-md text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--card))]">Annuler</button>
            </div>
          )}

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5"><span className="text-xs text-[hsl(var(--muted-foreground))]">Section</span>
                <select value={filtreSection} onChange={(e) => setFiltreSection(e.target.value)} className={champFiltre}>
                  <option value="toutes">Toutes</option>
                  {[...sections].sort((a, b) => a.ordre - b.ordre).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5"><span className="text-xs text-[hsl(var(--muted-foreground))]">Rôle</span>
                <select value={filtreRole} onChange={(e) => setFiltreRole(e.target.value)} className={champFiltre}>
                  <option value="tous">Tous</option>
                  {ROLES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5"><span className="text-xs text-[hsl(var(--muted-foreground))]">Module</span>
                <select value={filtreModule} onChange={(e) => setFiltreModule(e.target.value)} className={champFiltre}>
                  <option value="tous">Tous</option>
                  {Object.values(MODULES).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              {ROLES.map((r) => (
                <span key={r.code} className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.dot }} />{r.court}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Liste groupée par section */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading ? (
            <div className="space-y-1">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-9 rounded-lg animate-pulse bg-[hsl(var(--muted))]" />)}</div>
          ) : (
            <>
              {sectionsTriees.map((section, si) => {
                const racines = racinesDe(section.id);
                const replie = replies.has(section.id);
                const nbTotal = items.filter((i) => i.section_id === section.id).length;
                const arrow = "w-5 h-4 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--primary))] disabled:opacity-25 transition-colors";
                return (
                  <div key={section.id} className={`rounded-xl border border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--card))] ${!section.actif ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-2 px-3 py-2 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
                      <span className="flex flex-col shrink-0">
                        <button className={arrow} disabled={si === 0} onClick={() => deplacerSection(section, -1)} title="Monter la section"><ChevronUp size={12} /></button>
                        <button className={arrow} disabled={si === sectionsTriees.length - 1} onClick={() => deplacerSection(section, 1)} title="Descendre la section"><ChevronDown size={12} /></button>
                      </span>
                      <button onClick={() => toggleRepli(section.id)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                        {replie ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                      {editSectionId === section.id ? (
                        <input autoFocus value={editSectionLabel} onChange={(e) => setEditSectionLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") renommerSection(section.id); if (e.key === "Escape") setEditSectionId(null); }}
                          onBlur={() => renommerSection(section.id)}
                          className="flex-1 text-sm font-semibold rounded-md px-2 py-1 outline-none bg-[hsl(var(--card))] border border-[hsl(var(--ring))] text-[hsl(var(--foreground))]" />
                      ) : (
                        <button onClick={() => { setEditSectionId(section.id); setEditSectionLabel(section.label); }}
                          className="flex-1 text-left text-sm font-semibold uppercase tracking-wide text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] inline-flex items-center gap-1.5 group">
                          {section.label}
                          <Pencil size={11} className="opacity-0 group-hover:opacity-60" />
                        </button>
                      )}
                      {!section.actif && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--destructive)_/_0.12)] text-[hsl(var(--destructive))] uppercase tracking-wide">inactive</span>}
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{nbTotal} écran{nbTotal > 1 ? "s" : ""}</span>
                      <button onClick={() => ouvrirNouveau(section.id)} title="Ajouter un écran dans cette section" className="w-6 h-6 flex items-center justify-center rounded-md text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)_/_0.1)]"><Plus size={14} /></button>
                      <button onClick={() => basculerSection(section)} title={section.actif ? "Désactiver la section (et tous ses écrans)" : "Réactiver la section"}
                        className={`w-6 h-6 flex items-center justify-center rounded-md ${section.actif ? "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)_/_0.1)]" : "text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)_/_0.1)]"}`}>
                        {section.actif ? <Trash2 size={13} /> : <Power size={13} />}
                      </button>
                    </div>
                    {!replie && (
                      <div className="p-1.5 space-y-0.5">
                        {racines.length > 0 ? renderItems(racines)
                          : <p className="text-xs italic text-center py-3 text-[hsl(var(--muted-foreground))]">Aucun écran{filtreRole !== "tous" || filtreModule !== "tous" ? " pour ce filtre" : ""} — utilisez « + » pour en ajouter.</p>}
                      </div>
                    )}
                  </div>
                );
              })}

              {aSansSection && (() => {
                const racines = racinesDe(null);
                if (racines.length === 0) return null;
                return (
                  <div className="rounded-xl border border-dashed border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--card))]">
                    <div className="px-3 py-2 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
                      <span className="text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Sans section</span>
                    </div>
                    <div className="p-1.5 space-y-0.5">{renderItems(racines)}</div>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Aperçu sidebar */}
        <div className="border-t border-[hsl(var(--border))] px-5 py-3 bg-[hsl(var(--card))]">
          <p className="text-xs font-medium mb-2 text-[hsl(var(--muted-foreground))]">Aperçu de la sidebar — rôle : {filtreRole === "tous" ? "tous" : roleMeta(filtreRole)?.label}</p>
          <ApercuSidebar sections={sections} items={items} role={filtreRole} />
        </div>
      </div>

      {(selected || showNew) && (
        <div className="w-80 shrink-0 border-l border-[hsl(var(--border))] overflow-hidden flex flex-col">
          <ItemEditPanel key={`${showNew ? "new" : selected?.id}:${showNew ? "" : selected?.actif}`} item={showNew ? null : selected} sections={sections} items={items}
            sectionParDefaut={showNew ? nouveauSectionId : undefined}
            parentParDefaut={showNew ? nouveauParentId : undefined}
            onSave={handleSave} onClose={() => { setSelected(null); setShowNew(false); setNouveauSectionId(undefined); setNouveauParentId(undefined); }} onActifToggled={onActifToggled} />
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-2.5 text-sm shadow-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))]">{toast}</div>
      )}
    </div>
  );
}
