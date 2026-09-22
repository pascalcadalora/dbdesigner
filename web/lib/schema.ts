import { z } from 'zod';

export const TYPES = ['int', 'bigint', 'uuid', 'varchar(255)', 'text', 'boolean', 'decimal(18,2)', 'date', 'timestamp', 'json'] as const;
export const COLORS = ['#6d5ce7', '#289d8e', '#db9843', '#d56583', '#558bc5', '#8a70ad'];
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/, 'Gunakan huruf, angka, underscore; awali dengan huruf/underscore (maks. 63).');
export const columnSchema = z.object({ id: z.uuid(), name: identifier, type: z.enum(TYPES), primaryKey: z.boolean(), nullable: z.boolean(), unique: z.boolean(), defaultValue: z.string().max(500), displayName: z.string().trim().max(120).default(''), description: z.string().max(2000).default(''), systemGenerated: z.boolean().default(false), generationPattern: z.string().trim().max(200).default('') });
export const tableSchema = z.object({ id: z.uuid(), name: identifier, x: z.number().finite(), y: z.number().finite(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), note: z.string().max(2000), columns: z.array(columnSchema).min(1).max(100) });
export const relationSchema = z.object({ id: z.uuid(), fromTable: z.uuid(), fromColumn: z.uuid(), toTable: z.uuid(), toColumn: z.uuid(), kind: z.enum(['one-to-many', 'one-to-one']), joinedColumns: z.array(z.uuid()).max(100).default([]), showForeignKey: z.boolean().default(true) });
export const projectSchema = z.object({ version: z.literal(1), id: z.uuid(), revision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(120), dialect: z.enum(['postgres', 'mysql', 'sqlserver']), tables: z.array(tableSchema).max(200), relations: z.array(relationSchema).max(1000), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(.2).max(2) }), snap: z.boolean(), updatedAt: z.string().optional() });
export type Column = z.infer<typeof columnSchema>;
export type Table = z.infer<typeof tableSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectInfo = Pick<Project, 'id' | 'name' | 'revision' | 'updatedAt'> & { tableCount: number };
export const uid = () => crypto.randomUUID();
export function newColumn(name = 'id', type: Column['type'] = 'int', primaryKey = false): Column {
  return { id: uid(), name, type, primaryKey, nullable: !primaryKey, unique: false, defaultValue: '', displayName: '', description: '', systemGenerated: false, generationPattern: '' };
}
export const DEFAULT_GENERATION_PATTERN = '{SEQ:5}/INV/{MM}/{YYYY}';
export function generationPatternError(pattern: string): string | null {
  if (!pattern.trim()) return 'Format nilai otomatis wajib diisi.';
  const tokens = /\{(?:SEQ(?::[1-9])?|MM|YYYY|DD)\}/g;
  if (pattern.length > 200 || /[\r\n]/.test(pattern) || /[{}]/.test(pattern.replace(tokens, '')) || !pattern.match(tokens)) return 'Gunakan token {SEQ}, {SEQ:1}–{SEQ:9}, {DD}, {MM}, atau {YYYY}; tanda kurung kurawal hanya untuk token.';
  return null;
}
export function generationPreview(pattern: string): string {
  if (generationPatternError(pattern)) return '';
  // Fixed example date and sequence make this a reproducible design preview, not a number allocator.
  return pattern.replace(/\{SEQ(?::([1-9]))?\}/g, (_, width) => '1'.padStart(Number(width || 1), '0')).replaceAll('{DD}', '22').replaceAll('{MM}', '09').replaceAll('{YYYY}', '2026');
}
export function newTable(name: string, x = 100, y = 100, color = COLORS[0]): Table {
  return { id: uid(), name, x, y, color, note: '', columns: [newColumn('id', 'int', true)] };
}
export function blankProject(): Project {
  return { version: 1, id: uid(), revision: 0, name: 'Untitled schema', dialect: 'postgres', tables: [], relations: [], viewport: { x: 50, y: 50, zoom: .85 }, snap: true };
}
export function demoProject(): Project {
  const p = blankProject(); p.name = 'Commerce workspace';
  const make = (name: string, x: number, y: number, color: string, fields: [string, Column['type']][]) => {
    const t = newTable(name, x, y, color); t.columns.push(...fields.map(([n, type]) => newColumn(n, type))); return t;
  };
  const customers = make('customers', 40, 60, COLORS[0], [['full_name','varchar(255)'],['email','varchar(255)'],['created_at','timestamp']]);
  customers.columns[2].unique = true; customers.note = 'Data pelanggan dan informasi kontak.';
  const orders = make('orders', 440, 160, COLORS[1], [['customer_id','int'],['status','varchar(255)'],['total','decimal(18,2)'],['created_at','timestamp']]);
  const items = make('order_items', 840, 160, COLORS[2], [['order_id','int'],['product_id','int'],['quantity','int'],['unit_price','decimal(18,2)']]);
  const products = make('products', 440, 540, COLORS[4], [['category_id','int'],['name','varchar(255)'],['price','decimal(18,2)'],['stock','int']]);
  const categories = make('categories', 40, 490, COLORS[3], [['name','varchar(255)'],['description','text']]);
  const rel = (a: Table, b: Table, col: number): Relation => ({ id: uid(), fromTable: a.id, fromColumn: a.columns[0].id, toTable: b.id, toColumn: b.columns[col].id, kind: 'one-to-many', joinedColumns: [], showForeignKey: true });
  p.tables = [customers, orders, items, products, categories];
  p.relations = [rel(customers, orders, 1), rel(orders, items, 1), rel(products, items, 2), rel(categories, products, 1)];
  return p;
}
export function validateProject(input: unknown): Project {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('\n'));
  const p = parsed.data; const ids = new Set<string>(); const names = new Set<string>();
  const checkId = (id: string) => { if (ids.has(id)) throw new Error('ID tabel, kolom, dan relasi harus unik.'); ids.add(id); };
  for (const t of p.tables) {
    checkId(t.id);
    if (names.has(t.name.toLowerCase())) throw new Error(`Nama tabel ${t.name} sudah digunakan.`);
    names.add(t.name.toLowerCase()); const cols = new Set<string>();
    for (const c of t.columns) {
      checkId(c.id);
      if (cols.has(c.name.toLowerCase())) throw new Error(`Kolom ${t.name}.${c.name} duplikat.`);
      cols.add(c.name.toLowerCase());
      if (c.primaryKey && c.nullable) throw new Error('Primary key tidak boleh nullable.');
      if (c.systemGenerated) { const error = generationPatternError(c.generationPattern); if (error) throw new Error(`${t.name}.${c.name}: ${error}`); }
    }
  }
  const targets = new Set<string>();
  for (const r of p.relations) {
    checkId(r.id);
    const a = p.tables.find(t => t.id === r.fromTable), b = p.tables.find(t => t.id === r.toTable);
    const ac = a?.columns.find(c => c.id === r.fromColumn), bc = b?.columns.find(c => c.id === r.toColumn);
    if (!a || !b || !ac || !bc || ac.id === bc.id) throw new Error('Endpoint relasi tidak valid.');
    if (!isReferenceKey(a, ac)) throw new Error(`${a.name}.${ac.name} harus PK tunggal atau UNIQUE.`);
    if (ac.type !== bc.type) throw new Error('Tipe data kedua kolom relasi harus sama.');
    if (targets.has(bc.id)) throw new Error('Kolom FK sudah memiliki referensi.'); targets.add(bc.id);
    if (r.kind === 'one-to-one' && !isReferenceKey(b, bc)) throw new Error('Kolom FK one-to-one harus UNIQUE.');
    const joined = new Set<string>();
    for (const columnId of r.joinedColumns) {
      const column = a.columns.find(c => c.id === columnId);
      if (!column || joined.has(columnId)) throw new Error('Konfigurasi kolom hasil join tidak valid.');
      joined.add(columnId);
      if (b.columns.some(c => c.name.toLowerCase() === column.name.toLowerCase())) throw new Error(`Kolom ${column.name} sudah ada pada tabel tujuan; tidak dapat ditambahkan dari hasil join.`);
    }
  }
  return p;
}
export function isReferenceKey(t: Table, c: Column) { return c.unique || (c.primaryKey && t.columns.filter(x => x.primaryKey).length === 1); }
export function connect(p: Project, fromTable: string, fromColumn: string, toTable: string, toColumn: string, kind: Relation['kind'], options: Pick<Relation, 'joinedColumns' | 'showForeignKey'> = {joinedColumns: [], showForeignKey: true}): Project {
  const next = structuredClone(p);
  if (kind === 'one-to-one') { const c = next.tables.find(t => t.id === toTable)?.columns.find(c => c.id === toColumn); if (c) c.unique = true; }
  next.relations.push({ id: uid(), fromTable, fromColumn, toTable, toColumn, kind, ...options });
  return validateProject(next);
}
export function junction(p: Project, left: Table, right: Table): Project {
  const a = left.columns.find(c => isReferenceKey(left, c)), b = right.columns.find(c => isReferenceKey(right, c));
  if (!a || !b) throw new Error('Kedua tabel memerlukan PK tunggal atau kolom UNIQUE.');
  const next = structuredClone(p); const base = `${left.name}_${right.name}`.slice(0, 55); let name = base; let i = 2;
  while (next.tables.some(t => t.name.toLowerCase() === name.toLowerCase())) name = `${base}_${i++}`;
  const t = newTable(name, (left.x + right.x) / 2, Math.max(left.y + left.columns.length * 36, right.y + right.columns.length * 36) + 180, COLORS[2]);
  t.columns = [newColumn(`${left.name.slice(0, 45)}_id`, a.type, true), newColumn(`${right.name.slice(0, 45)}_${left.id === right.id ? 'related_' : ''}id`, b.type, true)];
  next.tables.push(t);
  next.relations.push({id: uid(), fromTable: left.id, fromColumn: a.id, toTable: t.id, toColumn: t.columns[0].id, kind: 'one-to-many', joinedColumns: [], showForeignKey: true}, {id: uid(), fromTable: right.id, fromColumn: b.id, toTable: t.id, toColumn: t.columns[1].id, kind: 'one-to-many', joinedColumns: [], showForeignKey: true});
  return validateProject(next);
}
export function sqlExport(p: Project): string {
  p = validateProject(p);
  const q = (s: string) => p.dialect === 'mysql' ? '`' + s + '`' : p.dialect === 'sqlserver' ? '[' + s + ']' : '"' + s + '"';
  const type = (s: Column['type']) => {
    if (s === 'uuid') return p.dialect === 'sqlserver' ? 'UNIQUEIDENTIFIER' : p.dialect === 'mysql' ? 'CHAR(36)' : 'UUID';
    if (s === 'timestamp') return p.dialect === 'sqlserver' ? 'DATETIME2' : p.dialect === 'mysql' ? 'DATETIME' : 'TIMESTAMP';
    if (s === 'boolean' && p.dialect === 'sqlserver') return 'BIT';
    if (s === 'json' && p.dialect === 'sqlserver') return 'NVARCHAR(MAX)';
    if (s === 'text' && p.dialect === 'sqlserver') return 'NVARCHAR(MAX)';
    return s.toUpperCase();
  };
  const defaultSql = (c: Column) => {
    if (!c.defaultValue.trim()) return '';
    const v = c.defaultValue.trim();
    if (v.toUpperCase() === 'CURRENT_TIMESTAMP' && ['date','timestamp'].includes(c.type)) return ' DEFAULT CURRENT_TIMESTAMP';
    if (['int','bigint','decimal(18,2)'].includes(c.type)) { if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`Default ${c.name} harus angka.`); return ` DEFAULT ${v}`; }
    if (c.type === 'boolean') { if (!/^(true|false|0|1)$/i.test(v)) throw new Error(`Default ${c.name} harus true/false.`); const yes = /^(true|1)$/i.test(v); return ` DEFAULT ${p.dialect === 'postgres' ? String(yes).toUpperCase() : yes ? '1' : '0'}`; }
    return ` DEFAULT '${v.replaceAll("'", "''")}'`;
  };
  const tables = p.tables.map(t => {
    const lines = t.columns.map(c => `  ${q(c.name)} ${type(c.type)}${c.nullable ? '' : ' NOT NULL'}${c.unique ? ' UNIQUE' : ''}${defaultSql(c)}`);
    const pk = t.columns.filter(c => c.primaryKey); if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(c => q(c.name)).join(', ')})`);
    const metadata = t.columns.flatMap(c => {
      const entries = [c.displayName ? `Display name: ${c.displayName}` : '', c.description ? `Description: ${c.description}` : '', c.systemGenerated ? `System generated (design metadata only): ${c.generationPattern}` : ''].filter(Boolean);
      return entries.flatMap(entry => `${c.name} — ${entry}`.split(/[\r\n\u2028\u2029]+/).map(line => `-- ${line}`));
    });
    return `${metadata.length ? metadata.join('\n') + '\n' : ''}CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);`;
  });
  const relations = p.relations.map(r => {
    const a = p.tables.find(t => t.id === r.fromTable)!, b = p.tables.find(t => t.id === r.toTable)!;
    return `ALTER TABLE ${q(b.name)} ADD CONSTRAINT ${q('fk_' + r.id.replaceAll('-', ''))} FOREIGN KEY (${q(b.columns.find(c => c.id === r.toColumn)!.name)}) REFERENCES ${q(a.name)} (${q(a.columns.find(c => c.id === r.fromColumn)!.name)});`;
  });
  return `-- Schema Studio · ${p.dialect}\n-- Review this DDL before running against your database.\n\n${[...tables, ...relations].join('\n\n')}\n`;
}
export const tableHeight = (t: Table) => 52 + t.columns.length * 36 + 34;
