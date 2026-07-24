import { describe, it, expect } from 'vitest';
import { countWords, estimateTokens, readingTimeMinutes } from '../src/convert/tokens.js';

describe('countWords', () => {
  it('cuenta secuencias separadas por espacios', () => {
    expect(countWords('hola mundo cruel')).toBe(3);
    expect(countWords('   ')).toBe(0);
    expect(countWords('')).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('devuelve 0 para texto vacío', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   \n  ')).toBe(0);
  });

  it('crece de forma monótona con la longitud', () => {
    const corto = estimateTokens('una frase corta');
    const largo = estimateTokens('una frase corta '.repeat(20));
    expect(largo).toBeGreaterThan(corto);
    expect(corto).toBeGreaterThanOrEqual(1);
  });
});

describe('readingTimeMinutes', () => {
  it('estima al menos un minuto', () => {
    expect(readingTimeMinutes(0)).toBe(1);
    expect(readingTimeMinutes(400)).toBe(2);
  });
});
