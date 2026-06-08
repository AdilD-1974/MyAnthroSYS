import React, { useState } from 'react'

// ─── Hiérarchie UO ───────────────────────────────────────────────────────────
export interface UONode { id: string; libelle: string; parentId: string | null; code?: string }

// Étend une sélection d'UO à toutes leurs sous-UO (descendance récursive).
export function expandUO(selectedIds: string[], tree: UONode[]): Set<string> {
  const out = new Set<string>(selectedIds)
  const childrenOf: Record<string, string[]> = {}
  tree.forEach(n => { if (n.parentId) (childrenOf[n.parentId] = childrenOf[n.parentId] || []).push(n.id) })
  const stack = [...selectedIds]
  while (stack.length) {
    const cur = stack.pop()!
    ;(childrenOf[cur] || []).forEach(c => { if (!out.has(c)) { out.add(c); stack.push(c) } })
  }
  return out
}

// ─── Filtre multi-sélection à cases à cocher (LIBELLÉS uniquement) ───────────
export function MultiSelect({ label, options, selected, onChange, width = 'w-60' }: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const count = selected.length
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`text-[12px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 cursor-pointer transition-colors ${
          count
            ? 'border-[#4B6FE4] text-[#4B6FE4] bg-[#4B6FE4]/5'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
        }`}>
        <span className="font-medium">{label}</span>
        {count > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#4B6FE4] text-white">{count}</span>}
        <i className={`ti ti-chevron-down text-[13px] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 mt-1 ${width} max-h-72 overflow-y-auto rounded-lg p-1.5 shadow-lg border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700`}>
            {count > 0 && (
              <button type="button" onClick={() => onChange([])}
                className="w-full text-left text-[11px] px-2 py-1 mb-1 rounded text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                Tout désélectionner
              </button>
            )}
            {options.length === 0
              ? <p className="text-[12px] px-2 py-3 text-center text-gray-400">Aucune option</p>
              : options.map(o => {
                const on = selected.includes(o.value)
                return (
                  <button key={o.value} type="button" onClick={() => toggle(o.value)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-left text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${on ? 'bg-[#4B6FE4] border-[#4B6FE4]' : 'border-gray-300 dark:border-gray-600'}`}>
                      {on && <i className="ti ti-check text-white text-[10px]" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                )
              })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Filtre par plage de dates ───────────────────────────────────────────────
export function DateRangeFilter({ from, to, onChange }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const active = !!(from || to)
  return (
    <div className={`flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border ${
      active ? 'border-[#4B6FE4] bg-[#4B6FE4]/5' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
    }`}>
      <i className="ti ti-calendar-event text-[13px] text-gray-400" />
      <input type="date" value={from} onChange={e => onChange(e.target.value, to)}
        className="bg-transparent outline-none text-gray-700 dark:text-gray-300 w-[118px]" />
      <span className="text-gray-400">→</span>
      <input type="date" value={to} onChange={e => onChange(from, e.target.value)}
        className="bg-transparent outline-none text-gray-700 dark:text-gray-300 w-[118px]" />
      {active && (
        <button type="button" onClick={() => onChange('', '')} className="text-gray-400 hover:text-gray-600 ml-0.5">
          <i className="ti ti-x text-[13px]" />
        </button>
      )}
    </div>
  )
}

// ─── Sélecteur d'UO hiérarchique (recherche + cascade + Appliquer) ───────────
export function UOTreeFilter({ tree, selected, onApply, allLabel = 'Toutes les UOs' }: {
  tree: UONode[]
  selected: string[]
  onApply: (ids: string[]) => void
  allLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [temp, setTemp] = useState<Set<string>>(new Set(selected))

  // (Ré)initialise la sélection temporaire à l'ouverture
  React.useEffect(() => { if (open) setTemp(new Set(selected)) }, [open]) // eslint-disable-line

  const byId = React.useMemo(() => { const m: Record<string, UONode> = {}; tree.forEach(n => { m[n.id] = n }); return m }, [tree])
  const childrenOf = React.useMemo(() => {
    const c: Record<string, UONode[]> = {}
    tree.forEach(n => { if (n.parentId && byId[n.parentId]) (c[n.parentId] = c[n.parentId] || []).push(n) })
    return c
  }, [tree, byId])

  const ordered = React.useMemo(() => {
    const sortFn = (a: UONode, b: UONode) => a.libelle.localeCompare(b.libelle, 'fr')
    const roots = tree.filter(n => !n.parentId || !byId[n.parentId]).sort(sortFn)
    const out: { node: UONode; depth: number }[] = []
    const walk = (n: UONode, depth: number) => { out.push({ node: n, depth }); (childrenOf[n.id] || []).slice().sort(sortFn).forEach(c => walk(c, depth + 1)) }
    roots.forEach(r => walk(r, 0))
    return out
  }, [tree, byId, childrenOf])

  const descendants = (id: string): string[] => {
    const acc: string[] = [id]
    const stack = [id]
    while (stack.length) { const cur = stack.pop()!; (childrenOf[cur] || []).forEach(c => { acc.push(c.id); stack.push(c.id) }) }
    return acc
  }
  const toggle = (id: string) => {
    const desc = descendants(id)
    const next = new Set(temp)
    const isOn = temp.has(id)
    desc.forEach(d => isOn ? next.delete(d) : next.add(d))
    setTemp(next)
  }

  const q = search.trim().toLowerCase()
  const visible = q
    ? ordered.filter(({ node }) => node.libelle.toLowerCase().includes(q) || (node.code || '').toLowerCase().includes(q))
    : ordered

  const count = selected.length
  const label = count === 0 ? allLabel : `${count} UO`

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`text-[12px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 cursor-pointer transition-colors ${
          count ? 'border-[#4B6FE4] text-[#4B6FE4] bg-[#4B6FE4]/5'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
        }`}>
        <i className="ti ti-sitemap text-[14px]" />
        <span className="font-medium">{label}</span>
        <i className={`ti ti-chevron-down text-[13px] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-80 rounded-xl shadow-xl border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Recherche */}
            <div className="p-2.5 border-b border-gray-100 dark:border-gray-800">
              <div className="relative">
                <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[13px]" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une UO…"
                  className="w-full text-[12px] pl-8 pr-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 outline-none text-gray-700 dark:text-gray-300" />
              </div>
              <div className="flex items-center gap-3 mt-2 px-0.5">
                <button type="button" onClick={() => setTemp(new Set(tree.map(n => n.id)))}
                  className="text-[12px] text-[#4B6FE4] font-medium hover:underline">Tout sélectionner</button>
                <button type="button" onClick={() => setTemp(new Set())}
                  className="text-[12px] text-gray-400 hover:text-gray-600 hover:underline">Effacer</button>
              </div>
            </div>

            {/* Arbre */}
            <div className="max-h-64 overflow-y-auto py-1">
              {visible.length === 0 ? (
                <p className="text-[12px] px-3 py-4 text-center text-gray-400">Aucune UO</p>
              ) : visible.map(({ node, depth }) => {
                const on = temp.has(node.id)
                return (
                  <button key={node.id} type="button" onClick={() => toggle(node.id)}
                    className="w-full flex items-center gap-2 pr-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    style={{ paddingLeft: `${12 + (q ? 0 : depth * 16)}px` }}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${on ? 'bg-[#4B6FE4] border-[#4B6FE4]' : 'border-gray-300 dark:border-gray-600'}`}>
                      {on && <i className="ti ti-check text-white text-[10px]" />}
                    </span>
                    <span className="flex-1 truncate text-[12px] text-gray-700 dark:text-gray-300">{node.libelle}</span>
                    {node.code && <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{node.code}</span>}
                  </button>
                )
              })}
            </div>

            {/* Appliquer */}
            <div className="p-2 border-t border-gray-100 dark:border-gray-800">
              <button type="button" onClick={() => { onApply([...temp]); setOpen(false) }}
                className="w-full py-2 rounded-lg bg-[#1E2A4A] text-white text-[13px] font-medium hover:bg-[#16203A] transition-colors">
                Appliquer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
