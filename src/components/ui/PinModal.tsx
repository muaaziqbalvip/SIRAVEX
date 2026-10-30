import { useState } from 'react';
import { LockKeyhole, ShieldAlert, X } from 'lucide-react';
import { Button, Input } from '@/components/ui/ui';
import { useStore } from '@/app/store';

export function PinModal({
  open,
  title = 'Parental PIN Required',
  subtitle = 'Ye channel ya category Parental Lock se mehfooz hai. Kholne ke liye apna PIN darj karein.',
  onSuccess,
  onClose,
}: {
  open: boolean;
  title?: string;
  subtitle?: string;
  onSuccess?: () => void;
  onClose: () => void;
}) {
  const { unlockParental } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setBusy(true);
    setError('');
    const ok = await unlockParental(pin);
    setBusy(false);
    if (ok) {
      setPin('');
      onSuccess?.();
      onClose();
    } else {
      setError('Ghalat PIN — dobara check karein.');
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-3xl border border-border bg-panel p-5 shadow-card">
        <div className="flex items-start justify-between gap-2">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/15 text-amber-300">
            <LockKeyhole size={21} aria-hidden />
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PIN dialog"
            className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-card hover:text-silver"
          >
            <X size={18} />
          </button>
        </div>
        <h2 className="mt-3 text-lg font-extrabold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted">{subtitle}</p>
        <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3">
          <Input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            aria-label="Enter Parental PIN"
            className="text-center font-mono text-xl tracking-[0.45em]"
          />
          {error && (
            <p className="flex items-center gap-1.5 rounded-xl bg-red-950/60 px-3 py-2 text-xs text-red-200" role="alert">
              <ShieldAlert size={14} aria-hidden />
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy || pin.length < 4}>
              {busy ? 'Checking…' : 'Unlock (30 min)'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
