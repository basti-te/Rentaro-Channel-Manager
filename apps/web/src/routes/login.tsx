import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Mail, ArrowRight } from 'lucide-react';

import { Brand } from '../components/Brand';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (auth.user) nav({ to: '/calendar' });
  }, [auth.user, nav]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    const { error } = await auth.signInWithEmail(email.trim());
    setSending(false);
    if (error) {
      toast.error(error);
      return;
    }
    setSent(true);
    toast.success('Magic link sent — check your inbox.');
  }

  return (
    <div className="grain min-h-dvh flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px] animate-fade-up">
        {/* Brand */}
        <div className="flex justify-center mb-10">
          <Brand size="lg" />
        </div>

        {/* Card */}
        <div className="rounded-xl border border-line bg-surface shadow-lg p-7">
          {/* Heading */}
          <div className="mb-6">
            <h1 className="display text-[28px] font-medium text-ink">
              Welcome back
            </h1>
            <p className="mt-1.5 text-[14px] text-muted leading-relaxed">
              We&rsquo;ll email you a sign-in link — no password needed.
            </p>
          </div>

          {sent ? (
            <SentState email={email} onReset={() => setSent(false)} />
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={sending}
                />
              </div>

              <Button
                type="submit"
                variant="brand"
                size="lg"
                loading={sending}
                iconRight={<ArrowRight className="h-4 w-4" />}
                className="w-full"
              >
                Send magic link
              </Button>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-line" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-surface px-3 text-[11px] uppercase tracking-widest text-whisper">
                    or
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => auth.signInWithGoogle()}
                className="w-full"
                iconLeft={<GoogleMark />}
              >
                Continue with Google
              </Button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-[12px] text-whisper">
          By signing in you agree to our terms and privacy policy.
        </p>
        <p className="mt-2 text-center text-[12px]">
          <Link
            to="/impressum"
            className="text-muted hover:text-ink transition-colors"
          >
            Impressum
          </Link>
        </p>
      </div>
    </div>
  );
}

function SentState({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <div className="text-center py-2">
      <div className="mx-auto mb-4 inline-flex items-center justify-center h-12 w-12 rounded-full bg-brand-soft text-brand">
        <Mail className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2 className="text-[17px] font-semibold text-ink">Check your inbox</h2>
      <p className="mt-2 text-[13px] text-muted leading-relaxed">
        We sent a sign-in link to{' '}
        <span className="num text-ink">{email}</span>.<br />
        Click the link to continue. It expires in 60 minutes.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-5 text-[13px] text-muted hover:text-ink transition-colors"
      >
        Use a different email
      </button>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.83z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
