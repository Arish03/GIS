export default function Badge({ status, children, dot = false }) {
  const s = (status || '').toLowerCase().replace(/\s/g, '_');
  const map = {
    ready:          'bg-primary-50 text-primary-700 ring-1 ring-primary-200',
    processing:     'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    uploading:      'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    error:          'bg-red-50 text-red-700 ring-1 ring-red-200',
    draft:          'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
    created:        'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
    review:         'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
    review_pending: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
    unassigned:     'bg-slate-100 text-slate-400 ring-1 ring-slate-200',
    healthy:        'bg-primary-50 text-primary-700 ring-1 ring-primary-200',
    moderate:       'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    poor:           'bg-red-50 text-red-700 ring-1 ring-red-200',
  };
  const cls = map[s] || 'bg-slate-100 text-slate-500 ring-1 ring-slate-200';
  const showDot = dot || ['processing', 'uploading', 'review_pending'].includes(s);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${cls}`}>
      {showDot && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {children || status}
    </span>
  );
}
