'use client';
import { Fragment, useState } from 'react';
import { X, Plus, Trash2, KeyRound, GripVertical } from 'lucide-react';
import { COLORS, DEFAULT_GENERATION_PATTERN, generationPatternError, generationPreview, newColumn, Project, Table, TYPES, validateProject } from '../lib/schema';

export default function TableDialog({table, project, onClose, onSave}: {table: Table; project: Project; onClose:()=>void; onSave:(t:Table)=>void}) {
  const [draft,setDraft]=useState<Table>(structuredClone(table)); const [error,setError]=useState('');
  const updateColumn=(id:string, patch:Partial<Table['columns'][number]>)=>setDraft(t=>({...t,columns:t.columns.map(c=>c.id===id?{...c,...patch}:c)}));
  function save() {
    try {
      const p={...project,tables:project.tables.some(t=>t.id===draft.id)?project.tables.map(t=>t.id===draft.id?draft:t):[...project.tables,draft]};
      const validated = validateProject(p); onSave(validated.tables.find(t=>t.id===draft.id)!);
    } catch(e) {setError((e as Error).message);}
  }
  return <div className="modal-backdrop"><section className="modal table-modal" role="dialog" aria-modal="true" aria-labelledby="table-dialog-title" onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
    <header className="modal-header"><div><span className="eyebrow">TABLE DESIGNER</span><h2 id="table-dialog-title">{project.tables.some(t=>t.id===draft.id)?'Edit tabel':'Tambah tabel'}</h2></div><button className="icon-button" aria-label="Tutup editor tabel" onClick={onClose}><X size={20}/></button></header>
    <div className="modal-body"><div className="table-basics"><label>Nama tabel<input autoFocus aria-label="Nama tabel" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="contoh: customers" maxLength={63}/></label><div><label>Warna tabel</label><div className="color-options">{COLORS.map(c=><button key={c} aria-label={`Warna ${c}`} className={draft.color===c?'chosen':''} style={{background:c}} onClick={()=>setDraft({...draft,color:c})}/>)}</div></div></div>
      <div className="section-heading"><h3>Kolom <span>{draft.columns.length}</span></h3><span>PK = primary key · NN = not null · UQ = unique</span></div>
      <div className="column-editor"><div className="column-editor-head"><span/><span>Nama kolom</span><span>Tipe data</span><span>PK</span><span>NN</span><span>UQ</span><span>Default value</span><span/></div>
        {draft.columns.map((c,index)=><Fragment key={c.id}>
          <div className="column-editor-row"><GripVertical size={14} className="muted"/><input aria-label={`Nama kolom ${index+1}`} value={c.name} onChange={e=>updateColumn(c.id,{name:e.target.value})}/><select aria-label={`Tipe kolom ${index+1}`} value={c.type} onChange={e=>updateColumn(c.id,{type:e.target.value as typeof c.type})}>{TYPES.map(t=><option key={t}>{t}</option>)}</select><input type="checkbox" aria-label={`Primary key ${index+1}`} checked={c.primaryKey} onChange={e=>updateColumn(c.id,{primaryKey:e.target.checked,...(e.target.checked?{nullable:false}:{})})}/><input type="checkbox" aria-label={`Not null ${index+1}`} checked={!c.nullable} disabled={c.primaryKey} onChange={e=>updateColumn(c.id,{nullable:!e.target.checked})}/><input type="checkbox" aria-label={`Unique ${index+1}`} checked={c.unique} onChange={e=>updateColumn(c.id,{unique:e.target.checked})}/><input aria-label={`Default kolom ${index+1}`} value={c.defaultValue} placeholder="—" onChange={e=>updateColumn(c.id,{defaultValue:e.target.value})}/><button className="icon-button danger" aria-label={`Hapus kolom ${index+1}`} disabled={draft.columns.length===1||project.relations.some(r=>r.fromColumn===c.id||r.toColumn===c.id)} title="Hapus relasi terkait terlebih dahulu" onClick={()=>setDraft({...draft,columns:draft.columns.filter(x=>x.id!==c.id)})}><Trash2 size={15}/></button></div>
          <div className="column-metadata">
            <div className="column-metadata-fields">
              <label>Nama Tampilan<input aria-label={`Nama tampilan kolom ${index+1}`} maxLength={120} value={c.displayName} placeholder="Contoh: Nomor Faktur" onChange={e=>updateColumn(c.id,{displayName:e.target.value})}/></label>
              <label>Deskripsi Kolom<textarea aria-label={`Deskripsi kolom ${index+1}`} maxLength={2000} rows={2} value={c.description} placeholder="Jelaskan tujuan atau penggunaan kolom ini…" onChange={e=>updateColumn(c.id,{description:e.target.value})}/></label>
            </div>
            <label className="generated-checkbox"><input type="checkbox" aria-label={`Dihasilkan otomatis oleh sistem ${index+1}`} checked={c.systemGenerated} onChange={e=>updateColumn(c.id,{systemGenerated:e.target.checked,...(e.target.checked&&!c.generationPattern?{generationPattern:DEFAULT_GENERATION_PATTERN}:{})})}/> Dihasilkan Otomatis oleh Sistem</label>
            {c.systemGenerated&&<div className="generation-settings">
              <label>Format Nilai Otomatis<input aria-label={`Format nilai otomatis ${index+1}`} maxLength={200} value={c.generationPattern} placeholder={DEFAULT_GENERATION_PATTERN} onChange={e=>updateColumn(c.id,{generationPattern:e.target.value})}/></label>
              <p className="generation-help"><code>{'{SEQ}'}</code> nomor urut · <code>{'{SEQ:5}'}</code> nomor urut minimal 5 digit · <code>{'{DD}'}</code> hari · <code>{'{MM}'}</code> bulan · <code>{'{YYYY}'}</code> tahun.</p>
              {generationPatternError(c.generationPattern)?<p className="generation-error" role="status">{generationPatternError(c.generationPattern)}</p>:<p className="generation-example">Contoh hasil: <code>{generationPreview(c.generationPattern)}</code><span>Nomor urut 1, tanggal 22 September 2026.</span></p>}
              <p className="generation-help">Pola ini mendokumentasikan aturan pengisian otomatis. Implementasi generator dan aturan reset nomor urut dilakukan pada aplikasi yang menggunakan database.</p>
            </div>}
          </div>
        </Fragment>)}
      </div><button className="add-column" disabled={draft.columns.length>=100} onClick={()=>{let n=draft.columns.length+1;while(draft.columns.some(c=>c.name===`column_${n}`))n++;setDraft({...draft,columns:[...draft.columns,newColumn(`column_${n}`,'varchar(255)')]});}}><Plus size={15}/> Tambah kolom</button>
      <label className="notes-label">Catatan <span>opsional</span><textarea aria-label="Catatan tabel" rows={2} maxLength={2000} value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})} placeholder="Jelaskan kegunaan tabel ini…"/></label>
      <p className="form-hint"><KeyRound size={13}/> Tarik titik dari kolom PK / UNIQUE ke kolom FK di canvas. Default teks ditulis tanpa tanda kutip.</p>
      {error&&<div className="form-error" role="alert">{error}</div>}
    </div><footer className="modal-footer"><button onClick={onClose}>Batal</button><button className="primary" onClick={save}>Simpan tabel</button></footer>
  </section></div>;
}
