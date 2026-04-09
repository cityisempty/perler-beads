import {
  getPhoneAccessByPhone,
  PhoneAccessError,
  upsertPhoneRemainingUses,
} from '@/lib/phoneAccessServer';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type UpdatePayload = {
  phone?: string;
  remainingUses?: number;
};

function isAdminAuthorized(request: Request): boolean {
  const { env } = getRequestContext();
  const expectedAdminKey = env.PHONE_USAGE_ADMIN_KEY?.trim();

  if (!expectedAdminKey) {
    throw new PhoneAccessError('未配置 PHONE_USAGE_ADMIN_KEY 管理员密钥。', 500);
  }

  const providedAdminKey = request.headers.get('x-admin-key')?.trim();
  return providedAdminKey === expectedAdminKey;
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!isAdminAuthorized(request)) {
      return Response.json({ error: '管理员密钥无效。' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone') ?? '';
    const snapshot = await getPhoneAccessByPhone(phone);

    return Response.json({ data: snapshot });
  } catch (error) {
    if (error instanceof PhoneAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error('管理员查询手机号失败:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : '查询手机号次数失败，请稍后重试。' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    if (!isAdminAuthorized(request)) {
      return Response.json({ error: '管理员密钥无效。' }, { status: 401 });
    }

    const payload = (await request.json()) as UpdatePayload;
    const snapshot = await upsertPhoneRemainingUses(
      payload.phone ?? '',
      payload.remainingUses ?? Number.NaN
    );

    return Response.json({ data: snapshot });
  } catch (error) {
    if (error instanceof PhoneAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error('管理员更新手机号次数失败:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : '更新手机号次数失败，请稍后重试。' },
      { status: 500 }
    );
  }
}
