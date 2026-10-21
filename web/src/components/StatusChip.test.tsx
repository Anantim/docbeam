// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PageFile } from '../upload/manager.js';
import { jobChip, taskLook } from '../tracking/format.js';
import { tooltipOf } from '../testing/tooltip.js';
import { statusView } from './FileTable.js';
import { StatusChip } from './StatusChip.js';
import { TypeBadge } from './TypeBadge.js';

afterEach(cleanup);

const file = (status: PageFile['status']): PageFile => ({
  id: 'a',
  file: new File([new Uint8Array(1)], 'a.pdf'),
  name: 'a.pdf',
  sizeBytes: 1,
  contentType: 'application/pdf',
  status,
  progress: 0.5,
  partsDone: 0,
  partCount: 0,
});

describe('one status chip, one colour meaning (D-M3-12)', () => {
  it('draws a coloured box with a dot from the tone', () => {
    render(<StatusChip tone="ok" label="Delivered" meaning="Delivered to the folder in the platform." />);
    const chip = screen.getByText('Delivered');
    expect(chip.className).toContain('status-chip');
    expect(chip.getAttribute('data-tone')).toBe('ok');
    expect(chip.querySelector('.status-dot')).not.toBeNull();
    expect(chip.getAttribute('title')).toBeNull(); // the meaning is a tooltip, not a title attribute (D-F1-47)
    expect(tooltipOf(chip)).toBe('Delivered to the folder in the platform.');
  });

  it('gives a delivered file, a verified upload and a completed distribution the same tone (green)', () => {
    expect(taskLook('completed').tone).toBe('ok');
    expect(jobChip('completed').tone).toBe('ok');
    expect(statusView(file('verified')).tone).toBe('ok');
  });

  it('gives a failed delivery, a refused upload and a distribution with errors the same tone (red)', () => {
    expect(taskLook('failed').tone).toBe('bad');
    expect(jobChip('completed_with_errors').tone).toBe('bad');
    for (const s of ['refused', 'interrupted', 'unchecked', 'infected'] as const) expect(statusView(file(s)).tone, s).toBe('bad');
  });

  it('gives work in progress blue, and waiting grey, on both pages', () => {
    expect(taskLook('in_progress').tone).toBe('busy');
    expect(jobChip('in_progress').tone).toBe('busy');
    expect(statusView(file('uploading')).tone).toBe('busy');
    expect(taskLook('pending').tone).toBe('idle');
    expect(jobChip('pending').tone).toBe('idle');
    expect(statusView(file('waiting')).tone).toBe('idle');
    expect(statusView(file('checking')).tone).toBe('warn');
  });

  it('sets no colour itself: the tone attribute picks the tokens in styles.css (D-F1-5)', () => {
    render(<StatusChip tone="bad" label="Failed" />);
    expect(screen.getByText('Failed').getAttribute('style')).toBeNull();
  });
});

describe('TypeBadge', () => {
  it.each([
    ['application/pdf', 'PDF'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
    ['image/png', 'PNG'],
    ['image/jpeg', 'JPG'],
  ])('%s shows %s', (contentType, label) => {
    render(<TypeBadge contentType={contentType} />);
    const badge = screen.getByText(label);
    expect(badge.className).toContain('typetile');
    cleanup();
  });
});
