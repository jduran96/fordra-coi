'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const C = {
  paper:  'oklch(98.5% 0.004 80)',
  surface:'oklch(100% 0 0)',
  border: 'oklch(88% 0.008 80)',
  txt:    'oklch(13% 0.008 265)',
  txt2:   'oklch(46% 0.012 265)',
  txt3:   'oklch(68% 0.008 265)',
  earthy: 'oklch(52% 0.17 38)',
  error:  'oklch(52% 0.20 25)',
  serif:  "'DM Serif Display', Georgia, serif",
  sans:   "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
};

function PasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const hasInput = password.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!hasInput) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push('/app');
      } else {
        setError('Incorrect password.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Password"
        autoFocus
        required
        style={{
          width: '100%',
          padding: '11px 14px',
          fontSize: 15,
          fontFamily: C.sans,
          border: `1px solid ${error ? C.error : C.border}`,
          borderRadius: 8,
          outline: 'none',
          background: C.paper,
          color: C.txt,
          boxSizing: 'border-box' as const,
        }}
      />
      {error && (
        <p style={{ fontSize: 13, color: C.error, margin: 0, fontFamily: C.sans }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={!hasInput || loading}
        style={{
          width: '100%',
          padding: '12px',
          background: hasInput ? C.earthy : C.border,
          color: hasInput ? 'oklch(100% 0 0)' : C.txt3,
          fontSize: 14,
          fontWeight: 600,
          fontFamily: C.sans,
          borderRadius: 8,
          border: 'none',
          cursor: hasInput && !loading ? 'pointer' : 'not-allowed',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        Continue
      </button>
    </form>
  );
}

export default function PasswordPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: C.paper,
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 360,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: '40px 36px',
        boxShadow: '0 4px 24px oklch(0% 0 0 / 0.06)',
      }}>
        <p style={{
          fontFamily: C.serif,
          fontSize: 26,
          fontWeight: 400,
          letterSpacing: '-0.5px',
          color: C.txt,
          margin: '0 0 6px',
        }}>
          Fordra Demo
        </p>
        <p style={{
          fontSize: 14,
          color: C.txt2,
          fontFamily: C.sans,
          margin: '0 0 32px',
        }}>
          Enter the password to continue.
        </p>
        <Suspense>
          <PasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
