export default function ToggleSwitch({ checked, onChange, label, disabled = false }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none group">
      {label && (
        <span className={`text-sm font-medium transition-colors ${checked ? 'text-slate-800' : 'text-slate-500'}`}>
          {label}
        </span>
      )}
      <div
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200
          ${checked ? 'bg-primary-600' : 'bg-slate-200'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform duration-200
            ${checked ? 'translate-x-4' : 'translate-x-0.5'}
          `}
        />
      </div>
    </label>
  );
}
