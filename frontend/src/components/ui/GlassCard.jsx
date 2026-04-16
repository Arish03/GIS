export default function GlassCard({ children, className = '', hover = false, onClick }) {
  const base = 'bg-white/60 backdrop-blur-glass border border-white/80 rounded-2xl shadow-glass';
  const hoverClass = hover
    ? 'transition-all duration-200 hover:bg-white/75 hover:shadow-glass-hover hover:-translate-y-0.5 cursor-pointer'
    : '';
  return (
    <div
      className={`${base} ${hoverClass} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
