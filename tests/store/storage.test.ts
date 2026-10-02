import { describe, it, expect, beforeEach } from 'vitest';
import { loadJson, saveJson, isObject } from '../../src/store/storage';

beforeEach(() => localStorage.clear());

describe('loadJson', () => {
  it('returns fallback for missing key', () => {
    expect(loadJson('tsp.x', 5)).toBe(5);
  });
  it('returns parsed value', () => {
    saveJson('tsp.x', { a: 1 });
    expect(loadJson('tsp.x', {})).toEqual({ a: 1 });
  });
  it('drops broken JSON and returns fallback', () => {
    localStorage.setItem('tsp.x', '{oops');
    expect(loadJson('tsp.x', [])).toEqual([]);
    expect(localStorage.getItem('tsp.x')).toBeNull();
  });
  it('drops values that fail validation', () => {
    localStorage.setItem('tsp.x', 'null');
    expect(loadJson('tsp.x', [], Array.isArray)).toEqual([]);
    expect(localStorage.getItem('tsp.x')).toBeNull();
  });
  it('keeps values that pass validation', () => {
    localStorage.setItem('tsp.x', '[1]');
    expect(loadJson('tsp.x', [], Array.isArray)).toEqual([1]);
  });
});

describe('isObject', () => {
  it('accepts plain objects only', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject('x')).toBe(false);
  });
});
