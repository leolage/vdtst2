import { useEffect, useState, useCallback } from 'react';
import { api, jsonHeaders, media, type Output, type Category } from './api';

type Filtro = 'todos' | 'golden' | 'aprovados' | 'pendentes';

export function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [login, setLogin] = useState('');

  useEffect(() => {
    api<{ login: string }>('/api/auth/me').then((m) => { setLogado(true); setLogin(m.login); }).catch(() => setLogado(false));
  }, []);

  if (logado === null) return <div className="center muted">carregando…</div>;
  if (!logado) return <LoginView onOk={(l) => { setLogado(true); setLogin(l); }} />;
  return <Gallery login={login} onLogout={() => setLogado(false)} />;
}

function LoginView({ onOk }: { onOk: (login: string) => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [erro, setErro] = useState('');
  async function entrar() {
    setErro('');
    try {
      const r = await api<{ login: string }>('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ login: u, senha: p }) });
      onOk(r.login);
    } catch { setErro('Credenciais inválidas.'); }
  }
  return (
    <div className="center">
      <div className="card login">
        <h1>WAN Studio</h1>
        <input placeholder="login" value={u} onChange={(e) => setU(e.target.value)} />
        <input placeholder="senha" type="password" value={p} onChange={(e) => setP(e.target.value)} />
        <button onClick={entrar}>Entrar</button>
        <div className="erro">{erro}</div>
      </div>
    </div>
  );
}

function Gallery({ login, onLogout }: { login: string; onLogout: () => void }) {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const qs = filtro === 'golden' ? '?golden=true'
      : filtro === 'aprovados' ? '?aprovado=true'
      : filtro === 'pendentes' ? '?aprovado=false' : '';
    try { setOutputs(await api<Output[]>('/api/outputs' + qs)); } finally { setCarregando(false); }
  }, [filtro]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { api<Category[]>('/api/image-categories').then(setCats).catch(() => setCats([])); }, []);

  async function sair() { await api('/api/auth/logout', { method: 'POST' }); onLogout(); }

  return (
    <div className="wrap">
      <header>
        <h1>Galeria</h1>
        <div className="row">
          {(['todos', 'golden', 'aprovados', 'pendentes'] as Filtro[]).map((f) => (
            <button key={f} className={'tab' + (filtro === f ? ' on' : '')} onClick={() => setFiltro(f)}>{f}</button>
          ))}
          <span className="muted">· {login}</span>
          <button className="ghost" onClick={sair}>sair</button>
        </div>
      </header>

      {carregando && <p className="muted">carregando…</p>}
      {!carregando && outputs.length === 0 && (
        <p className="muted">Nenhum vídeo ainda. Os outputs aparecem aqui quando o worker conclui jobs (Fase 4).</p>
      )}

      <div className="grid">
        {outputs.map((o) => <Card key={o.id} o={o} cats={cats} onChange={carregar} />)}
      </div>
    </div>
  );
}

function Card({ o, cats, onChange }: { o: Output; cats: Category[]; onChange: () => void }) {
  const [frames, setFrames] = useState<string[] | null>(null);
  const [framesRel, setFramesRel] = useState<string | null>(o.frames_rel);
  const [catId, setCatId] = useState<number | ''>('');
  const golden = Boolean(o.golden);
  const aprovado = o.aprovado == null ? null : Boolean(o.aprovado);

  async function toggleGolden() {
    await api(`/api/outputs/${o.id}/golden`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ golden: !golden }) });
    onChange();
  }
  async function aprovar(v: boolean | null) {
    await api(`/api/outputs/${o.id}/approve`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ aprovado: v }) });
    onChange();
  }
  async function carregarFrames() {
    const r = await api<{ frames: string[]; frames_rel: string | null }>(`/api/outputs/${o.id}/frames`);
    setFrames(r.frames); setFramesRel(r.frames_rel);
  }
  async function promover(frame: string) {
    try {
      await api(`/api/outputs/${o.id}/promote-frame`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ frame, category_id: catId || undefined }) });
      alert(`Frame "${frame}" promovido para a biblioteca.`);
    } catch (e) { alert('Falha ao promover: ' + ((e as { body?: { detalhe?: string } }).body?.detalhe ?? '')); }
  }

  return (
    <div className="card out">
      <div className="vidwrap">
        {o.video_rel ? <video src={media(o.video_rel)} controls preload="metadata" /> : <div className="noVid muted">sem vídeo</div>}
        {golden && <span className="goldenBadge">⭐</span>}
      </div>
      <div className="row meta">
        <span className="muted">#{o.id} · cena {o.scene_id ?? '—'} · {o.frames_count} frames</span>
      </div>
      <div className="row actions">
        <button className={'ghost' + (golden ? ' on' : '')} onClick={toggleGolden}>{golden ? '★ golden' : '☆ golden'}</button>
        <button className={'ghost' + (aprovado === true ? ' okOn' : '')} onClick={() => aprovar(aprovado === true ? null : true)}>✓ aprovar</button>
        <button className={'ghost' + (aprovado === false ? ' noOn' : '')} onClick={() => aprovar(aprovado === false ? null : false)}>✕ reprovar</button>
      </div>

      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && frames === null) void carregarFrames(); }}>
        <summary className="muted">frames &amp; encadeamento</summary>
        <div className="row" style={{ margin: '6px 0' }}>
          <select value={catId} onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">categoria do frame promovido…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="frames">
          {frames === null && <span className="muted">carregando…</span>}
          {frames && frames.length === 0 && <span className="muted">sem frames extraídos</span>}
          {frames && framesRel && frames.map((f) => (
            <div key={f} className="frame" title={f}>
              <img src={media(framesRel + '/' + f)} loading="lazy" />
              <button className="ghost tiny" onClick={() => promover(f)}>promover →</button>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
