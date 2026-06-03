export default function Tabs({ items, activeId, onChange }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              className={[
                'rounded-lg px-3 py-2 text-sm font-medium transition',
                active
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'text-zinc-700 hover:bg-zinc-100',
              ].join(' ')}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

