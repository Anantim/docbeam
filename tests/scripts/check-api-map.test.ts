import { describe, expect, it } from 'vitest';
import { check, loadInputs, pathsInSource, shapeOf, type Inputs } from '../../scripts/check-api-map.js';

const root = new URL('../..', import.meta.url).pathname;

describe('shapeOf', () => {
  it('turns ids, template holes and named holes into {} and drops the query', () => {
    expect(shapeOf('/files/3f2a1b4c-1111-4222-8333-444455556666/downloads')).toBe('/files/{}/downloads');
    expect(shapeOf('/files/${fileId}/downloads')).toBe('/files/{}/downloads');
    expect(shapeOf('/files/{fileId}/downloads')).toBe('/files/{}/downloads');
    expect(shapeOf('/jobs?scope=all&limit=20')).toBe('/jobs');
    expect(shapeOf('/')).toBe('/');
  });

  it('knows a multipart upload id is not a UUID', () => {
    expect(shapeOf('/files/3f2a1b4c-1111-4222-8333-444455556666/multipart-uploads/jsXsGnZh-1_6L/complete')).toBe('/files/{}/multipart-uploads/{}/complete');
    expect(shapeOf('/files/{fileId}/multipart-uploads/{uploadId}/parts')).toBe('/files/{}/multipart-uploads/{}/parts');
  });
});

describe('pathsInSource', () => {
  it('finds API paths in strings and templates, and nothing else', () => {
    const source = "const a = apiFetch(`/jobs/${id}/tasks?page=1`); const b = '/teams'; const c = `${API_BASE}/auth/login`; const d = '/not/an/api'; const e = 'a/jobs';";
    expect(pathsInSource(source).sort()).toEqual(['/auth/login', '/jobs/{}/tasks', '/teams']);
  });
});

describe('the guide leaves nothing out (D-F1-70)', () => {
  it('passes on the repository: the code, the gateway routes, the recording and the guide agree with the inventory', () => {
    const report = check(loadInputs(root));
    // The output of the check, for the record (also printed by `node --no-warnings scripts/check-api-map.ts`).
    for (const line of report.summary) console.log(line);
    console.log(report.problems.length === 0 ? 'check-api-map: PASS (nothing missing)' : `check-api-map: FAIL (${report.problems.length} problems)`);
    expect(report.problems).toEqual([]);
    expect(report.summary.join('\n')).toMatch(/inventory: 36 calls/);
  });

  const base = (): Inputs => loadInputs(root);

  it('fails when a call in the code is not in the inventory', () => {
    const inputs = base();
    inputs.code.set('web/src/new/thing.ts', "export const x = () => apiFetch('/jobs/archive');");
    expect(check(inputs).problems.join('\n')).toContain('/jobs/archive');
  });

  it('fails when a new file opens a network connection', () => {
    const inputs = base();
    inputs.code.set('web/src/new/socket.ts', 'export const s = () => new WebSocket("ws://x");');
    expect(check(inputs).problems.join('\n')).toContain('web/src/new/socket.ts opens a network connection');
  });

  it('fails when the guide stops naming a call', () => {
    const inputs = base();
    inputs.guide = inputs.guide.split('POST /jobs/{jobId}/retry').join('removed');
    expect(check(inputs).problems.join('\n')).toContain('"POST /jobs/{jobId}/retry" is not in docs/USER-FLOW-AND-APIS.md');
  });

  it('fails when a request seen in the recording is not in the inventory, or a WebSocket frame is unknown', () => {
    const inputs = base();
    inputs.capture = [...inputs.capture, { kind: 'api', method: 'GET', path: '/jobs/abc/history' }, { kind: 'ws', frame: 'mystery' }];
    const problems = check(inputs).problems.join('\n');
    expect(problems).toContain('GET /jobs/abc/history');
    expect(problems).toContain('"mystery"');
  });

  it('fails when a public gateway route is in neither list', () => {
    const inputs = base();
    inputs.routes = [...inputs.routes, 'GET /folders/{folderId}/history'];
    expect(check(inputs).problems.join('\n')).toContain('gateway: GET /folders/{folderId}/history is not in the inventory');
  });

  it('fails when the inventory names a call the code no longer makes', () => {
    const inputs = base();
    inputs.code.set('web/src/upload/api.ts', '// no calls here any more');
    expect(check(inputs).problems.join('\n')).toContain('is not found in the code any more');
  });
});
