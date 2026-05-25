'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push(searchParams.get('next') ?? '/app');
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
          fontFamily: 'inherit',
          border: `1px solid ${error ? 'oklch(52% 0.20 25)' : 'oklch(88% 0.008 80)'}`,
          borderRadius: 8,
          outline: 'none',
          background: 'oklch(98.5% 0.004 80)',
          color: 'oklch(13% 0.008 265)',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <p style={{ fontSize: 13, color: 'oklch(52% 0.20 25)', margin: 0 }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: '12px',
          background: loading ? 'oklch(68% 0.008 265)' : 'oklch(13% 0.008 265)',
          color: 'oklch(98.5% 0.004 80)',
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 8,
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s',
        }}
      >
        {loading ? 'Verifying…' : 'Continue'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'oklch(98.5% 0.004 80)',
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 360,
        background: 'oklch(100% 0 0)',
        border: '1px solid oklch(88% 0.008 80)',
        borderRadius: 16,
        padding: '40px 36px',
        boxShadow: '0 4px 24px oklch(0% 0 0 / 0.06)',
      }}>
        <p style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 26,
          fontWeight: 400,
          letterSpacing: '-0.5px',
          color: 'oklch(13% 0.008 265)',
          margin: '0 0 6px',
        }}>
          Fordra
        </p>
        <p style={{
          fontSize: 14,
          color: 'oklch(46% 0.012 265)',
          margin: '0 0 32px',
        }}>
          Enter your password to continue.
        </p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
