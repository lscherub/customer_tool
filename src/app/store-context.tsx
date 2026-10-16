'use client';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { loadStore, saveStore, type StoreShape } from '@/lib/store';

interface StoreCtx {
  store: StoreShape;
  setStore: (updater: (s: StoreShape) => StoreShape) => void;
  loaded: boolean;
}

const Ctx = createContext<StoreCtx>({ store: loadStore(), setStore: () => {}, loaded: false });

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStoreState] = useState<StoreShape>(() => loadStore());
  const setStore = (updater: (s: StoreShape) => StoreShape) => {
    setStoreState((prev) => {
      const next = updater(prev);
      saveStore(next);
      return next;
    });
  };
  const value = useMemo(() => ({ store, setStore, loaded: true }), [store]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  return useContext(Ctx);
}

export function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export const btn = 'rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50';
export const btnGhost = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-50';
export const input = 'rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm w-full';
export const th = 'border-b border-stone-200 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-stone-500';
export const td = 'border-b border-stone-100 px-2 py-1.5 text-sm';
