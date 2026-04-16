import { Search } from 'lucide-react';

export default function SearchInput({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/70 backdrop-blur-sm
                   text-sm text-slate-700 placeholder:text-slate-400
                   focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500
                   transition-all duration-150 w-full min-w-0"
      />
    </div>
  );
}
