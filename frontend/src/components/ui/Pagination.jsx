import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const delta = 2;
  const left = Math.max(1, page - delta);
  const right = Math.min(totalPages, page + delta);

  for (let i = left; i <= right; i++) pages.push(i);

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      <button
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 bg-white/70 text-slate-600 hover:border-primary-300 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        <ChevronLeft size={14} />
      </button>

      {left > 1 && (
        <>
          <button onClick={() => onChange(1)} className="w-8 h-8 rounded-lg text-xs border border-slate-200 bg-white/70 text-slate-600 hover:border-primary-300 hover:text-primary-600 transition-all">1</button>
          {left > 2 && <span className="text-slate-400 text-xs px-1">…</span>}
        </>
      )}

      {pages.map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`w-8 h-8 rounded-lg text-xs border transition-all
            ${p === page
              ? 'bg-primary-600 border-primary-600 text-white font-semibold shadow-green-glow-sm'
              : 'border-slate-200 bg-white/70 text-slate-600 hover:border-primary-300 hover:text-primary-600'
            }`}
        >
          {p}
        </button>
      ))}

      {right < totalPages && (
        <>
          {right < totalPages - 1 && <span className="text-slate-400 text-xs px-1">…</span>}
          <button onClick={() => onChange(totalPages)} className="w-8 h-8 rounded-lg text-xs border border-slate-200 bg-white/70 text-slate-600 hover:border-primary-300 hover:text-primary-600 transition-all">{totalPages}</button>
        </>
      )}

      <button
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 bg-white/70 text-slate-600 hover:border-primary-300 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
