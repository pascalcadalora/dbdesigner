// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TableDialog from './TableDialog';
import RelationDialog from './RelationDialog';
import Diagram from './Diagram';
import Editor from './Editor';
import { blankProject, demoProject, newColumn, newTable, Project, validateProject } from '../lib/schema';

beforeEach(()=>{
  vi.stubGlobal('React', React);
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  vi.stubGlobal('PointerEvent',MouseEvent);
  HTMLElement.prototype.setPointerCapture=vi.fn();
  HTMLElement.prototype.hasPointerCapture=()=>false;
  HTMLElement.prototype.releasePointerCapture=vi.fn();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('table form',()=>{
  it('edits per-column metadata and previews the generation format',()=>{
    const p=blankProject(),t=newTable('invoices'),save=vi.fn();
    render(<TableDialog project={p} table={t} onClose={()=>{}} onSave={save}/>);
    fireEvent.change(screen.getByLabelText('Nama tampilan kolom 1'),{target:{value:'Nomor Faktur'}});
    fireEvent.change(screen.getByLabelText('Deskripsi kolom 1'),{target:{value:'Nomor faktur internal.'}});
    expect(screen.queryByLabelText('Format nilai otomatis 1')).toBeNull();
    fireEvent.click(screen.getByLabelText('Dihasilkan otomatis oleh sistem 1'));
    expect(screen.getByText('00001/INV/09/2026')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Format nilai otomatis 1'),{target:{value:'{SEQ:4}/INV/{YYYY}'}});
    expect(screen.getByText('0001/INV/2026')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dihasilkan otomatis oleh sistem 1'));
    expect(screen.queryByLabelText('Format nilai otomatis 1')).toBeNull();
    fireEvent.click(screen.getByLabelText('Dihasilkan otomatis oleh sistem 1'));
    fireEvent.click(screen.getByRole('button',{name:'Simpan tabel'}));
    expect(save.mock.calls[0][0].columns[0]).toMatchObject({name:'id',displayName:'Nomor Faktur',description:'Nomor faktur internal.',systemGenerated:true,generationPattern:'{SEQ:4}/INV/{YYYY}'});
  });
  it('adds typed columns entirely via UI, retaining key settings',()=>{
    const p=blankProject(),t=newTable('customers'),save=vi.fn();
    render(<TableDialog project={p} table={t} onClose={()=>{}} onSave={save}/>);
    fireEvent.click(screen.getByRole('button',{name:'Tambah kolom'}));
    fireEvent.change(screen.getByLabelText('Nama kolom 2'),{target:{value:'email'}});
    fireEvent.click(screen.getByLabelText('Unique 2'));
    fireEvent.click(screen.getByRole('button',{name:'Simpan tabel'}));
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].columns[0]).toMatchObject({primaryKey:true,nullable:false});
    expect(save.mock.calls[0][0].columns[1]).toMatchObject({name:'email',type:'varchar(255)',unique:true});
  });
  it('keeps invalid changes in the dialog and explains duplicate names',()=>{
    const p=demoProject(),save=vi.fn();render(<TableDialog project={p} table={p.tables[0]} onClose={()=>{}} onSave={save}/>);
    fireEvent.change(screen.getByLabelText('Nama tabel'),{target:{value:'orders'}});
    fireEvent.click(screen.getByRole('button',{name:'Simpan tabel'}));
    expect(screen.getByRole('alert').textContent).toContain('sudah digunakan');expect(save).not.toHaveBeenCalled();
  });
  it('prevents deleting a referenced column',()=>{const p=demoProject();render(<TableDialog project={p} table={p.tables[0]} onClose={()=>{}} onSave={()=>{}}/>);expect((screen.getByRole('button',{name:'Hapus kolom 1'}) as HTMLButtonElement).disabled).toBe(true);});
});
describe('visual relationships',()=>{
  it('commits one-to-one with a unique foreign key through the form',()=>{
    const p=blankProject(),a=newTable('customers'),b=newTable('profiles');b.columns.push(newColumn('customer_id'));p.tables=[a,b];const save=vi.fn();
    render(<RelationDialog project={p} onClose={()=>{}} onSave={save}/>);
    fireEvent.change(screen.getByLabelText('Jenis relasi'),{target:{value:'one-to-one'}});
    fireEvent.click(screen.getByRole('button',{name:'Buat relasi'}));
    expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0].relations[0].kind).toBe('one-to-one');expect(save.mock.calls[0][0].tables[1].columns[1].unique).toBe(true);
  });
  it('creates a junction table using the many-to-many form',()=>{
    const p=demoProject(),save=vi.fn();render(<RelationDialog project={p} onClose={()=>{}} onSave={save}/>);
    fireEvent.change(screen.getByLabelText('Jenis relasi'),{target:{value:'many-to-many'}});fireEvent.click(screen.getByRole('button',{name:'Buat relasi'}));
    expect(save.mock.calls[0][0].tables).toHaveLength(6);expect(save.mock.calls[0][0].relations).toHaveLength(6);
  });
  it('drags a table with grid snapping and reports dragged column endpoints',()=>{
    const p=demoProject();p.viewport={x:0,y:0,zoom:1};const move=vi.fn(),connect=vi.fn();
    const {container}=render(<Diagram project={p} selection={null} onSelect={()=>{}} onMove={move} onView={()=>{}} onConnect={connect} onEdit={()=>{}} onSnap={()=>{}} onAdd={()=>{}} fitSignal={0}/>);
    const canvas=screen.getByLabelText('Canvas diagram database'),header=container.querySelector('.table-card header')!;
    fireEvent.pointerDown(header,{button:0,clientX:70,clientY:80,pointerId:1});fireEvent.pointerMove(canvas,{clientX:119,clientY:111,pointerId:1});fireEvent.pointerUp(canvas,{clientX:119,clientY:111,pointerId:1});
    expect(move).toHaveBeenCalledWith(p.tables[0].id,80,100);
    const from=screen.getByRole('button',{name:'Hubungkan customers.id right'}),to=screen.getByRole('button',{name:'Hubungkan orders.customer_id left'});
    document.elementFromPoint=vi.fn(()=>to);
    fireEvent.pointerDown(from,{button:0,clientX:310,clientY:130,pointerId:2});fireEvent.pointerMove(canvas,{clientX:440,clientY:266,pointerId:2});fireEvent.pointerUp(canvas,{clientX:440,clientY:266,pointerId:2});
    expect(connect).toHaveBeenCalledWith(p.tables[0].id,p.tables[0].columns[0].id,p.tables[1].id,p.tables[1].columns[1].id);
  });
});
describe('editor workflow',()=>{
  it('loads, creates a table, autosaves, undoes, and redoes with revision tracking',async()=>{
    let persisted:Project=demoProject();const writes:Project[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
      if(url==='/api/projects')return Response.json([{id:persisted.id,name:persisted.name,revision:persisted.revision,tableCount:persisted.tables.length}]);
      if(options?.method==='PUT'){
        const next=validateProject(JSON.parse(options.body as string));expect(next.revision).toBe(persisted.revision);persisted={...next,revision:next.revision+1};writes.push(persisted);return Response.json(persisted);
      }return Response.json(persisted);
    }));
    render(<Editor/>);await screen.findByRole('button',{name:'Fit diagram'});
    fireEvent.click(screen.getAllByRole('button',{name:'Tambah tabel'})[0]);
    fireEvent.change(screen.getByLabelText('Nama tabel'),{target:{value:'payments'}});fireEvent.click(screen.getByRole('button',{name:'Simpan tabel'}));
    expect(screen.getAllByText('payments').length).toBeGreaterThan(0);
    await waitFor(()=>expect(writes).toHaveLength(1),{timeout:2500});expect(persisted.tables).toHaveLength(6);
    fireEvent.click(screen.getByRole('button',{name:'Undo'}));await waitFor(()=>expect(writes).toHaveLength(2),{timeout:2500});expect(persisted.tables).toHaveLength(5);
    fireEvent.click(screen.getByRole('button',{name:'Redo'}));await waitFor(()=>expect(writes).toHaveLength(3),{timeout:2500});expect(persisted.tables).toHaveLength(6);
    fireEvent.click(screen.getByRole('button',{name:/Export schema/}));expect(within(screen.getByRole('dialog',{name:'Export schema'})).getByText(/CREATE TABLE "payments"/).textContent).toContain('CREATE TABLE "payments"');
  });
  it('keeps edits and reports a save conflict rather than claiming success',async()=>{
    const p=demoProject();vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>options?.method==='PUT'?Response.json({error:'Project berubah di sesi lain.'},{status:409}):Response.json(url==='/api/projects'?[{id:p.id,name:p.name,revision:0,tableCount:5}]:p)));
    render(<Editor/>);await screen.findByRole('button',{name:'Fit diagram'});fireEvent.change(screen.getByLabelText('Nama project'),{target:{value:'My unsaved project'}});fireEvent.click(screen.getByRole('button',{name:'Simpan'}));
    await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain('Project berubah');expect((screen.getByLabelText('Nama project') as HTMLInputElement).value).toBe('My unsaved project');
  });
});
