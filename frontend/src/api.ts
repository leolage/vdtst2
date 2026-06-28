export async function api<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const isJson = res.headers.get('content-type')?.includes('json');
  const body = isJson ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error('erro'), { status: res.status, body });
  return body as T;
}

export const jsonHeaders = { 'content-type': 'application/json' };

/** Monta a URL de mídia a partir de um caminho relativo à raiz de outputs. */
export function media(rel: string): string {
  return '/api/media/' + rel.split('/').map(encodeURIComponent).join('/');
}

export interface Output {
  id: number;
  scene_id: number | null;
  tipo: string;
  golden: boolean | number;
  aprovado: boolean | number | null;
  frames_count: number;
  video_rel: string | null;
  thumb_rel: string | null;
  frames_rel: string | null;
}

export interface Category {
  id: number;
  nome: string;
}
