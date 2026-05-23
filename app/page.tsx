'use client';

import { useState } from 'react';
import Link from 'next/link';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px 16px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#fff',
  fontSize: 15,
  fontFamily: 'inherit',
  outline: 'none',
};

export default function LandingPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emailErr, setEmailErr] = useState(false);
  const [phoneErr, setPhoneErr] = useState(false);

  function formatPhone(val: string) {
    const digits = val.replace(/\D/g, '').slice(0, 10);
    if (digits.length >= 7) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length >= 4) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (digits.length >= 1) return `(${digits}`;
    return '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const phoneOk = phone.replace(/\D/g, '').length === 10;
    setEmailErr(!emailOk);
    setPhoneErr(!phoneOk);
    if (!emailOk || !phoneOk) return;
    try {
      await fetch('https://formspree.io/f/mzdwgrja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, email, phone: `+1 ${phone}` }),
      });
    } finally {
      setSubmitted(true);
    }
  }

  return (
    <div style={{ fontFamily: 'Inter, -apple-system, sans-serif', background: '#0a0a0a', color: '#fff', minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={{ padding: '28px 48px', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.6px' }}>Fordra</span>
        <Link href="/app" style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>
          Open app →
        </Link>
      </nav>

      {/* Hero */}
      <section style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '120px 48px 80px' }}>
        <h1 style={{ fontSize: 'clamp(44px, 7vw, 82px)', fontWeight: 900, letterSpacing: '-3.5px', lineHeight: 1.0, marginBottom: 24 }}>
          Insurance verification,<br />handled.
        </h1>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.4)', lineHeight: 1.65, maxWidth: 440, marginBottom: 44 }}>
          Fordra automates COI collection and verification for supply chain companies across America.
        </p>
        <button
          onClick={() => setModalOpen(true)}
          style={{ padding: '13px 26px', background: '#fff', color: '#0a0a0a', fontSize: 14, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer' }}
        >
          Request access
        </button>
      </section>

      {/* Cards */}
      <section style={{ maxWidth: 860, margin: '0 auto', padding: '0 48px 140px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 22, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 24, textAlign: 'center' }}>
          What we do:
        </p>
        {[
          { n: '01', title: 'Collect', desc: 'We request, follow-up, and store COIs for all your vendors.' },
          { n: '02', title: 'Verify', desc: 'We analyze docs and make calls to validate your requirements.' },
          { n: '03', title: 'Track', desc: 'We monitor policies, chase agents, and send you alerts.' },
          { n: '04', title: 'Program', desc: 'Access Fordra via API or through our mobile-friendly dashboard.' },
        ].map(card => (
          <div key={card.n} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '56px 56px 56px 48px', display: 'flex', gap: 40, alignItems: 'flex-start', background: 'rgba(255,255,255,0.02)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.2)', letterSpacing: 0.5, paddingTop: 6, minWidth: 28 }}>{card.n}</span>
            <div>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1.2px', marginBottom: 14 }}>{card.title}</h2>
              <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', lineHeight: 1.65, maxWidth: 560 }}>{card.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer style={{ padding: '28px 48px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
        &copy; Fordra 2026
      </footer>

      {/* Modal overlay */}
      {modalOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}
        >
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 48, width: '100%', maxWidth: 440, position: 'relative' }}>
            <button onClick={() => setModalOpen(false)} style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
              &times;
            </button>
            <h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', marginBottom: 6 }}>Request access</h3>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 32 }}>We&apos;ll be in touch within 24 hours.</p>
            {!submitted ? (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" required style={inputStyle} />
                <div>
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" required style={{ ...inputStyle, borderColor: emailErr ? '#ff5f5f' : 'rgba(255,255,255,0.1)' }} />
                  {emailErr && <p style={{ fontSize: 12, color: '#ff5f5f', marginTop: 4 }}>Enter a valid email address.</p>}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', border: `1px solid ${phoneErr ? '#ff5f5f' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, overflow: 'hidden' }}>
                    <span style={{ padding: '13px 12px 13px 16px', fontSize: 15, color: 'rgba(255,255,255,0.4)', borderRight: '1px solid rgba(255,255,255,0.1)', userSelect: 'none' }}>+1</span>
                    <input value={phone} onChange={e => setPhone(formatPhone(e.target.value))} placeholder="(555) 555-5555" maxLength={14} style={{ ...inputStyle, border: 'none', borderRadius: 0, paddingLeft: 12, background: 'transparent' }} />
                  </div>
                  {phoneErr && <p style={{ fontSize: 12, color: '#ff5f5f', marginTop: 4 }}>Enter a valid 10-digit US number.</p>}
                </div>
                <button type="submit" style={{ width: '100%', padding: '14px', background: '#fff', color: '#0a0a0a', fontSize: 15, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', marginTop: 4 }}>
                  Submit
                </button>
              </form>
            ) : (
              <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', paddingTop: 20, fontSize: 15 }}>You&apos;re on the list!</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
