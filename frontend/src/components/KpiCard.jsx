import GlassCard from './ui/GlassCard';

const strips = {
  blue:   'bg-blue-500',
  green:  'bg-primary-500',
  amber:  'bg-amber-500',
  purple: 'bg-purple-500',
  red:    'bg-red-500',
};

export default function KpiCard({ label, value, sub, color = 'green', icon: Icon }) {
  return (
    <GlassCard className="relative overflow-hidden pl-4 pr-5 py-5">
      <div className={`absolute inset-y-0 left-0 w-1 rounded-l-2xl ${strips[color] || strips.green}`} />
      {Icon && (
        <div className="absolute top-4 right-4 text-slate-300">
          <Icon size={20} strokeWidth={1.5} />
        </div>
      )}
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-3xl font-extrabold font-heading tracking-tight mb-1 ${color === 'green' ? 'text-primary-600' : 'text-slate-800'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </GlassCard>
  );
}
