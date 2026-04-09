import { deductPhoneAccessByHash, PhoneAccessError } from '@/lib/phoneAccessServer';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type DeductPayload = {
  phoneHash?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as DeductPayload;
    const snapshot = await deductPhoneAccessByHash(payload.phoneHash ?? '');

    return Response.json({ data: snapshot });
  } catch (error) {
    if (error instanceof PhoneAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error('手机号扣次接口失败:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : '扣减手机号次数失败，请稍后重试。' },
      { status: 500 }
    );
  }
}
