import { describe, it, expect } from 'vitest';
import { shrink } from '../src/convert/shrink.js';

describe('shrink', () => {
  it('colapsa tres o más saltos de línea a un separador de párrafo', () => {
    expect(shrink('a\n\n\n\nb')).toBe('a\n\nb\n');
  });

  it('elimina el espacio al final de línea', () => {
    expect(shrink('hola   \nmundo\t')).toBe('hola\nmundo\n');
  });

  it('deja exactamente un salto de línea final', () => {
    expect(shrink('texto')).toBe('texto\n');
    expect(shrink('texto\n\n\n')).toBe('texto\n');
  });

  it('devuelve cadena vacía para entrada vacía', () => {
    expect(shrink('')).toBe('');
    expect(shrink('   \n  \n')).toBe('');
  });
});
