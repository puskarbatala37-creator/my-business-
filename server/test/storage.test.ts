import { describe, expect, it } from 'vitest';
import { storageLines, storageReport } from '../src/core/storage.js';
import { openDatabase } from '../src/db/index.js';

const base = [
  { point: '/', type: 'overlay' },
  { point: '/proc', type: 'proc' },
  { point: '/etc/hosts', type: 'ext4' },
];

describe('is the data on a permanent disk?', () => {
  const db = openDatabase(':memory:');

  it('disk mounted at the data folder → safe', () => {
    const r = storageReport(db, '/data', [...base, { point: '/data', type: 'ext4' }]);
    expect(r).toMatchObject({ permanent: true, mount: '/data (ext4)', otherDisks: [] });
    expect(r.createdAt).toBeTruthy();
    expect(storageLines(r).ok).toBe(true);
  });

  it('disk mounted somewhere else (e.g. /var/data) → not safe, and says how to fix it', () => {
    const r = storageReport(db, '/data', [...base, { point: '/var/data', type: 'ext4' }], true);
    expect(r).toMatchObject({ permanent: false, mount: '/ (overlay)', otherDisks: ['/var/data'] });
    const { ok, lines } = storageLines(r);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/NOT on a permanent disk/);
    expect(lines.join('\n')).toMatch(/DATA_DIR=\/var\/data/);
  });

  it('no disk at all → not safe', () => {
    const r = storageReport(db, '/data', base, true);
    expect(r).toMatchObject({ permanent: false, otherDisks: [] });
    expect(storageLines(r).lines.join('\n')).toMatch(/No permanent disk is attached/);
  });

  it('on Render the server’s own drive is temporary, even when it is ext4', () => {
    const mounts = [{ point: '/', type: 'ext4' }, { point: '/var/data', type: 'ext4', options: 'rw' }, { point: '/opt/tools', type: 'ext4', options: 'ro,relatime' }];
    const onRender = storageReport(db, '/data', mounts, true);
    expect(onRender).toMatchObject({ permanent: false, otherDisks: ['/var/data'] }); // read-only /opt/tools isn't suggested
    // An ordinary server (VPS): "/" is a real disk, so data on it is kept.
    expect(storageReport(db, '/data', [{ point: '/', type: 'ext4' }], false)).toMatchObject({ permanent: true, otherDisks: [] });
  });

  it('a sub-folder of the disk counts as on the disk', () => {
    expect(storageReport(db, '/var/data/slay', [...base, { point: '/var/data', type: 'ext4' }]).permanent).toBe(true);
  });
});
