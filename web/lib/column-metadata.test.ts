import { describe, expect, it } from 'vitest';
import { demoProject, generationPatternError, generationPreview, sqlExport, validateProject } from './schema';

describe('column metadata', () => {
  it('opens old projects with safe metadata defaults', () => {
    const legacy = JSON.parse(JSON.stringify(demoProject()));
    for (const table of legacy.tables) for (const column of table.columns) {
      delete column.displayName; delete column.description;
      delete column.systemGenerated; delete column.generationPattern;
    }
    expect(validateProject(legacy).tables[0].columns[0]).toMatchObject({ displayName: '', description: '', systemGenerated: false, generationPattern: '' });
  });
  it('round-trips labels, descriptions and generation rules without changing physical names', () => {
    const p = demoProject();
    Object.assign(p.tables[0].columns[1], { displayName: 'Nomor Faktur', description: 'Nomor dokumen yang ditetapkan sistem.', systemGenerated: true, generationPattern: '{SEQ:5}/INV/{MM}/{YYYY}' });
    const roundTrip = validateProject(JSON.parse(JSON.stringify(p)));
    expect(roundTrip).toEqual(p);
    const sql = sqlExport(roundTrip);
    expect(sql).toContain('Display name: Nomor Faktur');
    expect(sql).toContain('System generated (design metadata only): {SEQ:5}/INV/{MM}/{YYYY}');
    expect(sql).toContain('"full_name" VARCHAR(255)');
    expect(sql).not.toContain('DEFAULT \'{SEQ');
  });
  it('validates tokens and previews padded sequence numbers', () => {
    expect(generationPreview('{SEQ:5}/INV/{DD}/{MM}/{YYYY}')).toBe('00001/INV/22/09/2026');
    expect(generationPreview('{SEQ}/INV/{MM}/{YYYY}')).toBe('1/INV/09/2026');
    for (const pattern of ['', 'INV/MM/YYYY', '{INDEX}/INV/{MM}', '{SEQ:0}', '{SEQ:10}', '{SEQ', '{SEQ}\nINV']) expect(generationPatternError(pattern)).not.toBeNull();
  });
  it('requires a valid format only while automatic generation is enabled', () => {
    const p = demoProject(); const c = p.tables[0].columns[0]; c.systemGenerated = true;
    expect(() => validateProject(p)).toThrow('Format nilai otomatis');
    c.systemGenerated = false;
    expect(() => validateProject(p)).not.toThrow();
  });
  it('keeps multiline descriptions inside SQL comments', () => {
    const p = demoProject(); p.tables[0].columns[0].description = 'Line one\nDROP TABLE example;';
    expect(sqlExport(p)).toContain('-- DROP TABLE example;');
    expect(sqlExport(p)).not.toContain('\nDROP TABLE example;');
  });
});
