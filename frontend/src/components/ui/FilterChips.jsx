export default function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all duration-150
            ${value === opt.value
              ? 'border-primary-500 text-primary-700 bg-primary-50 ring-1 ring-primary-200'
              : 'border-slate-200 text-slate-600 bg-white/70 hover:border-primary-300 hover:text-primary-700'
            }`}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span className="ml-1.5 opacity-60">{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
