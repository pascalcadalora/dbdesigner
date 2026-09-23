'use client';
import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react';
import { Database, KeyRound, Link2, Plus, Minus, Maximize, MousePointer2, Hand, Grid2X2 } from 'lucide-react';
import { Project, Table, tableHeight } from '../lib/schema';

type Selection = { type: 'table' | 'relation'; id: string } | null;
type Props = { project: Project; selection: Selection; onSelect: (s: Selection) => void; onMove: (id: string, x: number, y: number) => void; onView: (view: Project['viewport']) => void; onConnect: (a: string, ac: string, b: string, bc: string) => void; onEdit: (t: Table) => void; onSnap: () => void; onAdd: () => void; fitSignal: number };
type Drag = { kind: 'table'; id: string; sx: number; sy: number; ox: number; oy: number; x: number; y: number } | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; x: number; y: number } | { kind: 'link'; table: string; column: string; x: number; y: number; sx: number; sy: number };
export default function Diagram({project, selection, onSelect, onMove, onView, onConnect, onEdit, onSnap, onAdd, fitSignal}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number,{x:number;y:number}>());
  const gesture = useRef<{view:Project['viewport'];center:{x:number;y:number};distance:number;last:Project['viewport']}|null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [size, setSize] = useState({width:900,height:600});
  const view = project.viewport;
  const currentView = drag?.kind === 'pan' ? {...view, x: drag.x, y: drag.y} : view;
  const tables = project.tables.map(t => drag?.kind === 'table' && drag.id === t.id ? {...t, x: drag.x, y: drag.y} : t);
  function fit() {
    if (!root.current || !tables.length) { onView({x: 50, y: 50, zoom: .85}); return; }
    const minX = Math.min(...tables.map(t => t.x)), minY = Math.min(...tables.map(t => t.y));
    const w = Math.max(...tables.map(t => t.x + 270)) - minX, h = Math.max(...tables.map(t => t.y + tableHeight(t))) - minY;
    const zoom = Math.max(.2, Math.min(1.15, (root.current.clientWidth - 120) / w, (root.current.clientHeight - 150) / h));
    onView({x: (root.current.clientWidth - w * zoom) / 2 - minX * zoom, y: (root.current.clientHeight - h * zoom) / 2 - minY * zoom - 20, zoom});
  }
  const fitEvent = useEffectEvent(fit);
  useEffect(() => { if (fitSignal > 0) fitEvent(); }, [fitSignal]);
  useEffect(() => {
    const el=root.current; if(!el)return;
    const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));
    observer.observe(el);return()=>observer.disconnect();
  },[]);
  function point(e: {clientX: number; clientY: number}) { const r = root.current!.getBoundingClientRect(); return {x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom}; }
  function localPoint(e: {clientX:number;clientY:number}) { const r=root.current!.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
  function beginTouch(e: PointerEvent) {
    if (e.pointerType !== 'touch') return false;
    touches.current.set(e.pointerId,localPoint(e)); root.current?.setPointerCapture(e.pointerId);
    if (touches.current.size === 2) { const [first,second]=[...touches.current.values()]; const center={x:(first.x+second.x)/2,y:(first.y+second.y)/2}; const distance=Math.hypot(first.x-second.x,first.y-second.y); gesture.current={view,center,distance,last:view}; setDrag(null); }
    return true;
  }
  function capture(e: PointerEvent) { e.preventDefault(); e.stopPropagation(); beginTouch(e); root.current?.setPointerCapture(e.pointerId); }
  function move(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      if (!touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId,localPoint(e));
      if (touches.current.size < 2 || !gesture.current) return;
      const [first,second]=[...touches.current.values()]; const center={x:(first.x+second.x)/2,y:(first.y+second.y)/2}; const distance=Math.hypot(first.x-second.x,first.y-second.y); const start=gesture.current;
      // Parallel two-finger movement keeps the distance stable, so it pans only. Pinch changes the distance.
      const rawFactor=distance/start.distance; const factor=Math.abs(rawFactor-1)>.018?rawFactor:1; const zoom=Math.max(.2,Math.min(2,start.view.zoom*factor)); const scale=zoom/start.view.zoom;
      const next={zoom,x:start.view.x+(center.x-start.center.x)-(start.center.x-start.view.x)*(scale-1),y:start.view.y+(center.y-start.center.y)-(start.center.y-start.view.y)*(scale-1)};
      start.last=next; onView(next); return;
    }
    if (!drag) return;
    if (drag.kind === 'link') { setDrag({...drag, ...point(e)}); return; }
    const scale = drag.kind === 'table' ? view.zoom : 1;
    let x = drag.ox + (e.clientX - drag.sx) / scale, y = drag.oy + (e.clientY - drag.sy) / scale;
    if (drag.kind === 'table' && project.snap) { x = Math.round(x / 20) * 20; y = Math.round(y / 20) * 20; }
    setDrag({...drag, x, y});
  }
  function end(e: PointerEvent) {
    if (e.pointerType === 'touch') { touches.current.delete(e.pointerId); if (gesture.current && touches.current.size<2) { onView(gesture.current.last); gesture.current=null; } if (root.current?.hasPointerCapture(e.pointerId)) root.current.releasePointerCapture(e.pointerId); return; }
    if (drag?.kind === 'table' && (drag.x !== drag.ox || drag.y !== drag.oy)) onMove(drag.id, drag.x, drag.y);
    if (drag?.kind === 'pan') onView({...view, x: drag.x, y: drag.y});
    if (drag?.kind === 'link') {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-port]');
      if (target?.dataset.table && target.dataset.column) onConnect(drag.table, drag.column, target.dataset.table, target.dataset.column);
    }
    setDrag(null); if (root.current?.hasPointerCapture(e.pointerId)) root.current.releasePointerCapture(e.pointerId);
  }
  function zoomBy(factor: number, cx?: number, cy?: number) {
    const el = root.current; if (!el) return;
    const x = cx ?? el.clientWidth / 2, y = cy ?? el.clientHeight / 2;
    const zoom = Math.max(.2, Math.min(2, view.zoom * factor));
    onView({zoom, x: x - (x - view.x) * zoom / view.zoom, y: y - (y - view.y) * zoom / view.zoom});
  }
  const wheelEvent = useEffectEvent((event: WheelEvent) => { event.preventDefault(); const r=root.current?.getBoundingClientRect(); if(r)zoomBy(event.deltaY > 0 ? .94 : 1.06,event.clientX-r.left,event.clientY-r.top); });
  useEffect(()=>{const el=root.current;if(!el)return;const handler=(event:WheelEvent)=>wheelEvent(event);el.addEventListener('wheel',handler,{passive:false});return()=>el.removeEventListener('wheel',handler);},[]);
  const bounds = {x: Math.min(0,...tables.map(t=>t.x))-60, y: Math.min(0,...tables.map(t=>t.y))-60, right: Math.max(1000,...tables.map(t=>t.x+270))+60, bottom: Math.max(750,...tables.map(t=>t.y+tableHeight(t)))+60};
  return <div ref={root} className={`canvas ${tool === 'pan' ? 'pan-tool' : ''} ${drag ? 'dragging' : ''}`} aria-label="Canvas diagram database"
    style={{backgroundSize:`${20*currentView.zoom}px ${20*currentView.zoom}px`, backgroundPosition:`${currentView.x}px ${currentView.y}px`}}
    onPointerDown={e=>{ if(beginTouch(e)){onSelect(null);return;} if(e.button!==0&&e.button!==1)return; capture(e); onSelect(null); setDrag({kind:'pan',sx:e.clientX,sy:e.clientY,ox:view.x,oy:view.y,x:view.x,y:view.y}); }} onPointerMove={move} onPointerUp={end} onPointerCancel={e=>{touches.current.delete(e.pointerId);if(touches.current.size<2)gesture.current=null;setDrag(null);}}>
    <div className="canvas-caption"><span className="live-dot"/> VISUAL WORKSPACE <span>/</span> {project.name}</div>
    <div className="diagram-world" style={{transform:`translate(${currentView.x}px, ${currentView.y}px) scale(${currentView.zoom})`}}>
      <svg className="edges" aria-label="Garis relasi">
        {project.relations.map(r=>{
          const a=tables.find(t=>t.id===r.fromTable), b=tables.find(t=>t.id===r.toTable); if(!a||!b)return null;
          const same=a.id===b.id; const right= same || b.x>=a.x+135;
          const x1=a.x+(right?270:0), y1=a.y+70+a.columns.findIndex(c=>c.id===r.fromColumn)*36;
          const x2=b.x+(same?270:right?0:270), y2=b.y+70+b.columns.findIndex(c=>c.id===r.toColumn)*36;
          const bend=Math.max(65,Math.abs(x2-x1)*.5); const c1=x1+(right?bend:-bend), c2=same?x2+bend:x2+(right?-bend:bend);
          const path=`M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`; const selected=selection?.id===r.id;
          return <g key={r.id} className={`relation ${selected?'selected':''}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onSelect({type:'relation',id:r.id});}} role="button" tabIndex={0} aria-label={`Relasi ${a.name} ke ${b.name}`} onKeyDown={e=>{if(e.key==='Enter')onSelect({type:'relation',id:r.id});}}>
            <path d={path} className="edge-hit"/><path d={path} className="edge-line"/>
            <circle cx={x1} cy={y1} r={4} className="edge-dot"/><circle cx={x2} cy={y2} r={4} className="edge-dot"/>
            <text x={x1+(right?16:-22)} y={y1-9}>1</text><text x={x2+(same?16:right?-24:16)} y={y2-9}>{r.kind==='one-to-one'?'1':'N'}</text>
          </g>;
        })}
        {drag?.kind==='link'&&<path className="draft-edge" d={`M ${drag.sx} ${drag.sy} C ${drag.sx+80} ${drag.sy},${drag.x-80} ${drag.y},${drag.x} ${drag.y}`}/>}
      </svg>
      {tables.map(t=><article key={t.id} className={`table-card ${selection?.id===t.id?'selected':''}`} style={{left:t.x,top:t.y,'--table-color':t.color} as React.CSSProperties} onPointerDown={e=>{ if(tool==='pan')return; e.stopPropagation();onSelect({type:'table',id:t.id});}}>
        <header onPointerDown={e=>{if(tool==='pan')return;capture(e);onSelect({type:'table',id:t.id});setDrag({kind:'table',id:t.id,sx:e.clientX,sy:e.clientY,ox:t.x,oy:t.y,x:t.x,y:t.y});}} onDoubleClick={()=>onEdit(t)}>
          <Database size={17}/><strong>{t.name}</strong><span className="table-badge">{t.columns.length}</span>
        </header>
        {t.columns.map(c=>{
          const fk=project.relations.some(r=>r.toColumn===c.id);
          return <div className="column-row" key={c.id} title={[c.name, c.description, c.systemGenerated ? `Dihasilkan otomatis: ${c.generationPattern}` : ''].filter(Boolean).join('\n')} onDoubleClick={()=>onEdit(t)}>
            {(['left','right'] as const).map(side=><button key={side} className={`port ${side} ${drag?.kind==='link'?'connecting':''}`} data-port="true" data-table={t.id} data-column={c.id} aria-label={`Hubungkan ${t.name}.${c.name} ${side}`} title="Tarik dari PK / UNIQUE ke kolom FK" onPointerDown={e=>{capture(e); const x=t.x+(side==='right'?270:0), y=t.y+70+t.columns.indexOf(c)*36; setDrag({kind:'link',table:t.id,column:c.id,x,y,sx:x,sy:y});}}/>)}
            <span className={`key-icon ${c.primaryKey?'primary':fk?'foreign':''}`}>{c.primaryKey?<KeyRound size={13}/>:fk?<Link2 size={13}/>:<span className="col-dot"/>}</span><span className={`column-name ${c.displayName?'has-display-name':''}`}>{c.displayName||c.name}{c.displayName&&<small>{c.name}</small>}</span>{c.systemGenerated&&<span className="generated-badge" aria-label="Dihasilkan otomatis oleh sistem">AUTO</span>}<span className="column-type">{c.type}</span>{!c.nullable&&<span className="required-dot" title="NOT NULL"/>}
          </div>;
        })}
        <button className="table-footer" onPointerDown={e=>e.stopPropagation()} onClick={()=>onEdit(t)}><Plus size={12}/> Edit kolom <span>{t.note?'Ada catatan':'public'}</span></button>
      </article>)}
    </div>
    {!tables.length&&<div className="empty-canvas" onPointerDown={e=>e.stopPropagation()}><div className="empty-symbol"><Database size={32}/></div><h2>Ide besar dimulai dari satu tabel.</h2><p>Tambahkan tabel pertamamu, lalu hubungkan datanya.</p><button className="primary" onClick={onAdd}><Plus size={16}/> Tambah tabel pertama</button></div>}
    <div className="canvas-tools" onPointerDown={e=>e.stopPropagation()}><button aria-label="Pilih elemen" title="Pilih elemen" className={tool==='select'?'active':''} onClick={()=>setTool('select')}><MousePointer2 size={18}/></button><button aria-label="Geser canvas" title="Geser canvas" className={tool==='pan'?'active':''} onClick={()=>setTool('pan')}><Hand size={18}/></button><i/><button aria-label="Zoom out" onClick={()=>zoomBy(.85)}><Minus size={17}/></button><span>{Math.round(view.zoom*100)}%</span><button aria-label="Zoom in" onClick={()=>zoomBy(1.15)}><Plus size={17}/></button><i/><button aria-label="Fit diagram" title="Fit diagram" onClick={fit}><Maximize size={17}/></button><button aria-label="Snap to grid" title="Snap to grid" className={project.snap?'active':''} onClick={onSnap}><Grid2X2 size={17}/></button></div>
    <div className="canvas-hint">{drag?.kind==='link'?'Lepaskan di titik kolom FK tujuan':'Drag tabel untuk menyusun · Scroll untuk zoom · Tarik titik kolom untuk relasi'}</div>
    <div className="minimap" onPointerDown={e=>e.stopPropagation()}><span>OVERVIEW</span><svg viewBox={`${bounds.x} ${bounds.y} ${bounds.right-bounds.x} ${bounds.bottom-bounds.y}`} onClick={e=>{const r=e.currentTarget.getBoundingClientRect(); const x=bounds.x+(e.clientX-r.left)/r.width*(bounds.right-bounds.x),y=bounds.y+(e.clientY-r.top)/r.height*(bounds.bottom-bounds.y);onView({...view,x:(root.current?.clientWidth??800)/2-x*view.zoom,y:(root.current?.clientHeight??600)/2-y*view.zoom});}} preserveAspectRatio="none">
      {tables.map(t=><rect key={t.id} x={t.x} y={t.y} width={270} height={tableHeight(t)} rx={10} fill={t.color} opacity={.55}/>)}
      <rect x={-currentView.x/view.zoom} y={-currentView.y/view.zoom} width={size.width/view.zoom} height={size.height/view.zoom} fill="none" stroke="#8a7ae0" strokeWidth="10"/>
    </svg></div>
  </div>;
}
