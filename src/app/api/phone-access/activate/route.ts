import { activatePhoneAccess, PhoneAccessError } from '@/lib/phoneAccessServer';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type ActivatePayload = {
  phone?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as ActivatePayload;
    const snapshot = await activatePhoneAccess(payload.phone ?? '');

    return Response.json({ data: snapshot });
  } catch (error) {
    if (error instanceof PhoneAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error('手机号激活接口失败:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : '手机号验证失败，请稍后重试。' },
      { status: 500 }
    );
  }
}
