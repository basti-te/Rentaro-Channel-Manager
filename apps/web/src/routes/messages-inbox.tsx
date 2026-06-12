import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { Inbox, MessageSquare, ChevronLeft, Send, Sparkles } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

type InboxItem = inferRouterOutputs<AppRouter>['guestMessages']['inbox'][number];

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

const SOURCE_LABEL: Record<string, { label: string; dot: string }> = {
  airbnb: { label: 'Airbnb', dot: 'bg-[rgb(229_70_70)]' },
  booking_com: { label: 'Booking.com', dot: 'bg-[rgb(36_67_135)]' },
  expedia: { label: 'Expedia', dot: 'bg-[rgb(255_193_7)]' },
  other_ota: { label: 'OTA', dot: 'bg-muted' },
  internal: { label: 'Intern', dot: 'bg-brand' },
};

const fmtTime = (d: string | Date | null) =>
  d ? format(new Date(d), 'dd.MM. HH:mm', { locale: de }) : '';

export function MessagesInboxPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const inboxQ = trpc.guestMessages.inbox.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Universeller Posteingang über alle Apartments — mit KI-Vorschlägen direkt im Chat."
      />
      <div className="px-0 sm:px-4 md:px-6 lg:px-8 sm:py-5">
        <div className="flex md:gap-4 sm:rounded-xl sm:border sm:border-line sm:overflow-hidden bg-surface h-[calc(100dvh-180px)] min-h-[440px]">
          {/* List */}
          <div
            className={cn(
              'w-full md:w-[360px] md:flex-shrink-0 md:border-r border-line flex flex-col',
              selected ? 'hidden md:flex' : 'flex',
            )}
          >
            <ConversationList
              data={inboxQ.data}
              loading={inboxQ.isLoading}
              selected={selected}
              onSelect={setSelected}
            />
          </div>

          {/* Thread */}
          <div
            className={cn(
              'flex-1 min-w-0 flex flex-col',
              selected ? 'flex' : 'hidden md:flex',
            )}
          >
            {selected ? (
              <ConversationThread
                bookingId={selected}
                onBack={() => setSelected(null)}
                onChanged={() => void inboxQ.refetch()}
              />
            ) : (
              <EmptyThread />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ConversationList({
  data,
  loading,
  selected,
  onSelect,
}: {
  data: InboxItem[] | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 text-muted">
        <Inbox className="h-8 w-8 mb-3 text-whisper" strokeWidth={1.5} />
        <p className="text-[13px]">Noch keine Gast-Konversationen.</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto divide-y divide-line">
      {data.map((c) => {
        const src = SOURCE_LABEL[c.source] ?? SOURCE_LABEL.other_ota!;
        const active = c.bookingId === selected;
        const attention = c.unread > 0 || c.hasDraft || c.needsReply;
        return (
          <button
            key={c.bookingId}
            type="button"
            onClick={() => onSelect(c.bookingId)}
            className={cn(
              'w-full text-left px-4 py-3 flex gap-3 transition-colors',
              active ? 'bg-sunken' : 'hover:bg-sunken/50',
            )}
          >
            <span className={cn('mt-1.5 h-2 w-2 rounded-sm flex-shrink-0', src.dot)} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'text-[13.5px] truncate',
                    c.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink',
                  )}
                >
                  {c.guestName ?? 'Gast'}
                </span>
                <span className="text-[11px] text-whisper flex-shrink-0">{c.apartmentName}</span>
                <span className="ml-auto text-[10.5px] text-whisper flex-shrink-0">
                  {fmtTime(c.lastAt)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span
                  className={cn(
                    'text-[12px] truncate flex-1',
                    c.unread > 0 ? 'text-ink-soft' : 'text-muted',
                  )}
                >
                  {c.lastDirection === 'outbound' && (
                    <span className="text-whisper">Du: </span>
                  )}
                  {c.lastBody}
                </span>
                {c.hasDraft && (
                  <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-brand bg-brand-soft/50 rounded px-1.5 py-0.5">
                    <Sparkles className="h-2.5 w-2.5" /> KI
                  </span>
                )}
                {c.unread > 0 && (
                  <span className="flex-shrink-0 num text-[10px] font-semibold text-canvas bg-brand rounded-full min-w-[18px] h-[18px] inline-flex items-center justify-center px-1">
                    {c.unread}
                  </span>
                )}
                {c.unread === 0 && !c.hasDraft && c.needsReply && (
                  <span className="flex-shrink-0 h-2 w-2 rounded-full bg-warning" aria-label="unbeantwortet" />
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 text-muted">
      <MessageSquare className="h-9 w-9 mb-3 text-whisper" strokeWidth={1.4} />
      <p className="text-[13.5px]">Wähle links eine Konversation.</p>
    </div>
  );
}

const DISPATCH_ROLE_LABEL: Record<string, string> = {
  cleaner: 'Reinigung',
  handyman: 'Hausmeister',
  other: 'Team',
};

function ConversationThread({
  bookingId,
  onBack,
  onChanged,
}: {
  bookingId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const q = trpc.guestMessages.thread.useQuery({ bookingId }, { refetchInterval: 20_000 });
  const refresh = () => {
    void utils.guestMessages.thread.invalidate({ bookingId });
    onChanged();
  };

  const markRead = trpc.guestMessages.markRead.useMutation({ onSuccess: onChanged });
  // Mark read whenever a conversation is opened.
  useEffect(() => {
    markRead.mutate({ bookingId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const approve = trpc.guestMessages.approveDraft.useMutation({
    onSuccess: () => {
      refresh();
      toast.success('Gesendet');
    },
    onError: (e) => toast.error(e.message),
  });
  const dismiss = trpc.guestMessages.dismissDraft.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const reply = trpc.guestMessages.sendReply.useMutation({
    onSuccess: () => {
      setReplyText('');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [replyText, setReplyText] = useState('');

  const messages = q.data?.messages ?? [];
  const dispatches = q.data?.dispatches ?? [];
  const convo = messages.filter((m) => m.status !== 'draft' && m.status !== 'dismissed');
  const draft = messages.find((m) => m.status === 'draft');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="md:hidden text-muted hover:text-ink p-1 -ml-1"
          aria-label="Zurück"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <MessageSquare className="h-4 w-4 text-muted" />
        <span className="text-[13px] font-medium text-ink">Gast-Chat</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : convo.length === 0 && !draft ? (
          <p className="text-[12.5px] text-muted text-center py-6">Noch keine Nachrichten.</p>
        ) : (
          convo.map((m) => {
            const mine = m.direction === 'outbound';
            return (
              <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[78%] rounded-lg px-3 py-2 text-[13px] leading-relaxed',
                    mine ? 'bg-brand-soft text-ink' : 'bg-sunken text-ink',
                  )}
                >
                  {m.sender === 'ai' && (
                    <span className="mb-0.5 block text-[9.5px] font-medium uppercase tracking-wider text-brand">
                      KI
                    </span>
                  )}
                  <span className="whitespace-pre-wrap">{m.body}</span>
                  <span className="mt-1 block text-[10px] text-whisper">
                    {fmtTime(m.otaCreatedAt ?? m.createdAt)}
                    {m.status === 'failed' ? ' · fehlgeschlagen' : ''}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {/* AI draft inline */}
        {draft && (
          <div className="rounded-lg border border-brand/30 bg-brand-soft/30 p-3">
            <div className="text-[9.5px] font-medium uppercase tracking-wider text-brand">
              KI-Entwurf · zur Freigabe
            </div>
            {editing ? (
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={4}
                maxLength={4000}
                autoFocus
                className="mt-1.5 w-full resize-y rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed text-ink focus:border-ink focus:outline-none"
              />
            ) : (
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                {draft.body}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <Button
                    size="sm"
                    variant="brand"
                    loading={approve.isPending}
                    disabled={draftText.trim().length === 0}
                    onClick={() => approve.mutate({ id: draft.id, body: draftText.trim() })}
                  >
                    Bearbeitet senden
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Abbrechen
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="brand"
                    loading={approve.isPending}
                    onClick={() => approve.mutate({ id: draft.id })}
                  >
                    Senden
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraftText(draft.body);
                      setEditing(true);
                    }}
                  >
                    Bearbeiten
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={dismiss.isPending}
                    onClick={() => dismiss.mutate({ id: draft.id })}
                  >
                    Verwerfen
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {dispatches.length > 0 && (
          <div className="space-y-1 border-t border-line pt-2 mt-2">
            <div className="text-[10px] uppercase tracking-widest text-whisper">
              KI-Benachrichtigungen ans Team
            </div>
            {dispatches.map((d) => (
              <div key={d.id} className="flex items-start gap-1.5 text-[11.5px] text-ink-soft">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
                <span>
                  <span className="font-medium text-ink">
                    {DISPATCH_ROLE_LABEL[d.role] ?? d.role}
                  </span>{' '}
                  informiert: {d.summary}
                  {d.urgency ? ` (${d.urgency})` : ''}
                  {d.status !== 'sent' ? ` — ${d.status}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual reply */}
      <div className="border-t border-line p-3 flex items-end gap-2 flex-shrink-0">
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          rows={1}
          placeholder="Antwort schreiben…"
          className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink focus:border-ink focus:outline-none max-h-32"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && replyText.trim()) {
              reply.mutate({ bookingId, body: replyText.trim() });
            }
          }}
        />
        <Button
          variant="brand"
          size="sm"
          iconLeft={<Send className="h-4 w-4" />}
          loading={reply.isPending}
          disabled={!replyText.trim()}
          onClick={() => reply.mutate({ bookingId, body: replyText.trim() })}
        >
          Senden
        </Button>
      </div>
    </div>
  );
}
