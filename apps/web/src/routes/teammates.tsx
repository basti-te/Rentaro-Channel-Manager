import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { SectionCard } from '../components/ui/SectionCard';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

type TeammateRole = 'cleaner' | 'handyman' | 'other';
const ROLES: { value: TeammateRole; label: string }[] = [
  { value: 'cleaner', label: 'Reinigung' },
  { value: 'handyman', label: 'Hausmeister' },
  { value: 'other', label: 'Sonstige' },
];

export function TeammatesPage() {
  const meQ = trpc.me.current.useQuery();
  const role = meQ.data?.memberships?.[0]?.role;
  const isAdmin = role === 'owner' || role === 'admin';

  return (
    <>
      <PageHeader
        title="Teammates"
        subtitle="Cleaner und interne Empfänger für die Reinigungs-Erinnerungen."
      />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-5">
        {!isAdmin && meQ.data && (
          <Card className="px-4 py-3 bg-warning-soft/40 border-warning/30">
            <p className="text-[12.5px] text-ink-soft">
              Nur Owner/Admin können Teammates verwalten — du kannst sie ansehen.
            </p>
          </Card>
        )}
        <TeammatesSection disabled={!isAdmin} />
      </div>
    </>
  );
}

function TeammatesSection({ disabled }: { disabled: boolean }) {
  const utils = trpc.useUtils();
  const listQ = trpc.teammates.list.useQuery();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<TeammateRole>('cleaner');

  const refresh = () => utils.teammates.list.invalidate();
  const create = trpc.teammates.create.useMutation({
    onSuccess: () => {
      toast.success('Teammate angelegt');
      setName('');
      setPhone('');
      setRole('cleaner');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.teammates.update.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.teammates.delete.useMutation({
    onSuccess: () => {
      toast.success('Teammate gelöscht');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const phoneValid = /^\+[1-9]\d{6,14}$/.test(phone.trim());

  return (
    <SectionCard
      title="Teammates"
      desc="Cleaner / interne Empfänger für die Reinigungs-Erinnerungen (SMS). Telefon im Format +49170…"
    >
      {!disabled && (
        <div className="flex items-end gap-2 flex-wrap mb-3">
          <div className="space-y-1 flex-1 min-w-[160px]">
            <Label htmlFor="tm-name">Name</Label>
            <Input
              id="tm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Anna"
            />
          </div>
          <div className="space-y-1 min-w-[160px]">
            <Label htmlFor="tm-phone">Telefon</Label>
            <Input
              id="tm-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49170…"
            />
          </div>
          <div className="space-y-1 min-w-[140px]">
            <Label htmlFor="tm-role">Rolle</Label>
            <select
              id="tm-role"
              value={role}
              onChange={(e) => setRole(e.target.value as TeammateRole)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="brand"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            loading={create.isPending}
            disabled={!name.trim() || !phoneValid}
            onClick={() =>
              create.mutate({ name: name.trim(), phone: phone.trim(), role })
            }
          >
            Teammate
          </Button>
        </div>
      )}

      {listQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (listQ.data?.length ?? 0) === 0 ? (
        <p className="text-[12.5px] text-muted">
          Noch keine Teammates angelegt.
        </p>
      ) : (
        <ul className="rounded-md border border-line divide-y divide-line">
          {listQ.data!.map((tm) => (
            <li key={tm.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] text-ink truncate">
                  {tm.name}
                </div>
                <div className="num text-[12px] text-muted">{tm.phone}</div>
              </div>
              <select
                value={tm.role}
                disabled={disabled}
                onChange={(e) =>
                  update.mutate({ id: tm.id, role: e.target.value as TeammateRole })
                }
                className="h-8 rounded-md border border-line bg-surface px-2 text-[12px] text-ink focus:border-ink focus:outline-none transition-colors disabled:opacity-60"
                aria-label="Rolle"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <Switch
                size="sm"
                checked={tm.active}
                onChange={(next) =>
                  update.mutate({ id: tm.id, active: next })
                }
                aria-label="Aktiv"
                disabled={disabled}
              />
              {!disabled && (
                <button
                  type="button"
                  className="text-whisper hover:text-negative p-1.5 rounded hover:bg-negative-soft transition-colors"
                  onClick={() => {
                    if (confirm(`Teammate „${tm.name}“ löschen?`))
                      del.mutate({ id: tm.id });
                  }}
                  aria-label="Löschen"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
