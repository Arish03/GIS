import { AlertTriangle, Info, CheckCircle, X } from 'lucide-react';

export default function ConfirmModal({ show, title, message, confirmLabel = 'OK', cancelLabel, type = 'info', onConfirm, onCancel }) {
  if (!show) return null;

  const icons = {
    danger:  <AlertTriangle size={22} className="text-red-500" />,
    warning: <AlertTriangle size={22} className="text-amber-500" />,
    info:    <Info size={22} className="text-blue-500" />,
    success: <CheckCircle size={22} className="text-primary-500" />,
  };

  const confirmBtnClass = {
    danger:  'btn-danger',
    warning: 'bg-amber-500 hover:bg-amber-600 text-white inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95',
    info:    'btn-primary',
    success: 'btn-primary',
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" onClick={onCancel}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md bg-white/90 backdrop-blur-2xl border border-white/90
                   rounded-2xl shadow-glass-lg animate-slide-up overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent bar */}
        <div className={`h-1 w-full ${type === 'danger' ? 'bg-gradient-to-r from-red-400 to-red-600' : type === 'warning' ? 'bg-gradient-to-r from-amber-400 to-amber-600' : 'bg-gradient-to-r from-primary-400 to-teal-400'}`} />

        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-center gap-3">
            {icons[type]}
            <h2 className="font-heading font-bold text-slate-800 text-lg">{title}</h2>
          </div>
          {onCancel && (
            <button onClick={onCancel} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 pb-4">
          <p className="text-slate-600 text-sm leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          {cancelLabel && (
            <button onClick={onCancel} className="btn-secondary">
              {cancelLabel}
            </button>
          )}
          <button onClick={onConfirm} className={confirmBtnClass[type] || 'btn-primary'}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
