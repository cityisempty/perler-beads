'use client';

import { useState } from 'react';

import {
  isValidPhoneNumber,
  normalizePhoneNumber,
  type PhoneAccessSnapshot,
} from '@/lib/phoneAccess';

type AdminApiResponse = {
  data?: PhoneAccessSnapshot;
  error?: string;
};

async function parseAdminResponse(response: Response): Promise<AdminApiResponse> {
  try {
    return (await response.json()) as AdminApiResponse;
  } catch {
    return {};
  }
}

export default function AdminPhonesPage() {
  const [adminKey, setAdminKey] = useState('');
  const [phone, setPhone] = useState('');
  const [remainingUsesInput, setRemainingUsesInput] = useState('');
  const [record, setRecord] = useState<PhoneAccessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const normalizedPhone = normalizePhoneNumber(phone);

  const requireAdminKey = (): boolean => {
    if (!adminKey.trim()) {
      setError('请先输入管理员密钥。');
      return false;
    }

    return true;
  };

  const requirePhone = (): boolean => {
    if (!isValidPhoneNumber(normalizedPhone)) {
      setError('请输入正确的 11 位手机号。');
      return false;
    }

    return true;
  };

  const handleSearch = async () => {
    setError(null);
    setMessage(null);

    if (!requireAdminKey() || !requirePhone()) {
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/admin/phone-access?phone=${encodeURIComponent(normalizedPhone)}`,
        {
          headers: {
            'x-admin-key': adminKey.trim(),
          },
          cache: 'no-store',
        }
      );

      const payload = await parseAdminResponse(response);
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? '查询失败，请稍后重试。');
      }

      setRecord(payload.data);
      setRemainingUsesInput(String(payload.data.remainingUses));
      setMessage('查询成功。');
    } catch (searchError) {
      const nextError =
        searchError instanceof Error ? searchError.message : '查询失败，请稍后重试。';
      setRecord(null);
      setRemainingUsesInput('');
      setError(nextError);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setMessage(null);

    if (!requireAdminKey() || !requirePhone()) {
      return;
    }

    const remainingUses = Number(remainingUsesInput);
    if (!Number.isInteger(remainingUses) || remainingUses < 0) {
      setError('剩余次数必须是大于等于 0 的整数。');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/admin/phone-access', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey.trim(),
        },
        body: JSON.stringify({
          phone: normalizedPhone,
          remainingUses,
        }),
      });

      const payload = await parseAdminResponse(response);
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? '保存失败，请稍后重试。');
      }

      setRecord(payload.data);
      setRemainingUsesInput(String(payload.data.remainingUses));
      setMessage('手机号次数已更新。');
    } catch (saveError) {
      const nextError =
        saveError instanceof Error ? saveError.message : '保存失败，请稍后重试。';
      setError(nextError);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">
            Admin
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">手机号次数管理</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            输入管理员密钥和手机号后，可以查看剩余次数，并直接把该手机号的剩余次数改成指定值。
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">管理员密钥</span>
            <input
              type="password"
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              placeholder="请输入 PHONE_USAGE_ADMIN_KEY"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">手机号</span>
            <input
              type="tel"
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))
              }
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              placeholder="请输入 11 位手机号"
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleSearch}
              disabled={isSearching}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSearching ? '查询中...' : '查询手机号'}
            </button>
          </div>
        </div>

        {(error || message) && (
          <div
            className={`mt-5 rounded-2xl px-4 py-3 text-sm ${
              error
                ? 'border border-rose-200 bg-rose-50 text-rose-700'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {error ?? message}
          </div>
        )}

        {record && (
          <section className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-lg font-bold text-slate-900">当前记录</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">手机号</p>
                <p className="mt-2 text-base font-semibold">{normalizedPhone}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">已脱敏展示</p>
                <p className="mt-2 text-base font-semibold">{record.maskedPhone}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">剩余次数</p>
                <p className="mt-2 text-base font-semibold">{record.remainingUses}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">已使用次数</p>
                <p className="mt-2 text-base font-semibold">{record.usageCount}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">总次数</p>
                <p className="mt-2 text-base font-semibold">{record.maxUses}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">手机号哈希</p>
                <p className="mt-2 break-all font-mono text-xs text-slate-600">
                  {record.phoneHash}
                </p>
              </div>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  设置剩余次数
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={remainingUsesInput}
                  onChange={(event) => setRemainingUsesInput(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                  placeholder="例如 10000"
                />
              </label>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="mt-4 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isSaving ? '保存中...' : '保存次数'}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
