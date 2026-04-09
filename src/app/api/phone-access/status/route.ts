import { getPhoneAccessByHash, PhoneAccessError } from '@/lib/phoneAccessServer';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const phoneHash = searchParams.get('phoneHash') ?? '';
    const snapshot = await getPhoneAccessByHash(phoneHash);

    return Response.json({ data: snapshot });
  } catch (error) {
    if (error instanceof PhoneAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error('手机号状态接口失败:', error);
    return Response.json({ error: '获取手机号次数失败，请稍后重试。' }, { status: 500 });
  }
}
