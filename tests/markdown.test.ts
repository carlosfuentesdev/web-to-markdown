import { describe, it, expect } from 'vitest';
import { convertHtml } from '../src/convert/convert.js';

/** HTML realista: artículo rodeado de menús, anuncios, cookies y pie de página. */
const COMPLEX_PAGE = `<!doctype html>
<html>
<head>
  <title>Guía de Markdown</title>
  <meta name="description" content="Cómo escribir Markdown denso.">
  <script>window.analytics = true;</script>
  <style>.x{color:red}</style>
</head>
<body>
  <header class="site-header"><a href="/">Logo</a><nav><a href="/blog">Blog</a></nav></header>
  <div class="cookie-banner">Aceptamos cookies. <button>OK</button></div>
  <div class="ad-container"><iframe src="//ads.example"></iframe>Publicidad</div>
  <main>
    <article>
      <h1>Título principal</h1>
      <p>Un párrafo con <strong>negrita</strong>, <em>cursiva</em> y un
         <a href="/destino">enlace</a>.</p>
      <h2>Una lista</h2>
      <ul>
        <li>Primero</li>
        <li>Segundo con <code>código</code></li>
      </ul>
      <pre><code class="language-js">const x = 1;</code></pre>
      <blockquote><p>Una cita.</p></blockquote>
      <table>
        <thead><tr><th>Clave</th><th>Valor</th></tr></thead>
        <tbody><tr><td>a</td><td>1</td></tr></tbody>
      </table>
    </article>
  </main>
  <aside class="sidebar">Artículos relacionados</aside>
  <footer>© 2026</footer>
</body>
</html>`;

describe('convertHtml sobre una página compleja', () => {
  const { markdown } = convertHtml(COMPLEX_PAGE);

  it('conserva la estructura semántica', () => {
    expect(markdown).toContain('# Título principal');
    expect(markdown).toContain('## Una lista');
    expect(markdown).toContain('**negrita**');
    expect(markdown).toContain('*cursiva*');
    expect(markdown).toContain('[enlace](/destino)');
    expect(markdown).toContain('- Primero');
    expect(markdown).toContain('`código`');
  });

  it('genera bloques de código con lenguaje', () => {
    expect(markdown).toContain('```js\nconst x = 1;\n```');
  });

  it('genera citas y tablas GFM', () => {
    expect(markdown).toContain('> Una cita.');
    expect(markdown).toContain('| Clave | Valor |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| a | 1 |');
  });

  it('elimina el ruido (scripts, menús, anuncios, cookies, pie)', () => {
    expect(markdown).not.toContain('window.analytics');
    expect(markdown).not.toContain('Publicidad');
    expect(markdown).not.toContain('Aceptamos cookies');
    expect(markdown).not.toContain('Artículos relacionados');
    expect(markdown).not.toContain('© 2026');
    expect(markdown).not.toContain('Blog');
  });
});

describe('opciones de imágenes', () => {
  const html = '<article><h1>T</h1><p>x</p><img src="/foto.png" alt="Una foto"></article>';

  it('omite las imágenes por defecto', () => {
    expect(convertHtml(html).markdown).not.toContain('![');
  });

  it('las incluye con includeImages', () => {
    expect(convertHtml(html, { includeImages: true }).markdown).toContain('![Una foto](/foto.png)');
  });
});

describe('listas anidadas', () => {
  it('indenta las sublistas', () => {
    const html = '<article><ul><li>Uno<ul><li>Uno.uno</li></ul></li><li>Dos</li></ul></article>';
    const { markdown } = convertHtml(html);
    expect(markdown).toContain('- Uno');
    expect(markdown).toContain('  - Uno.uno');
    expect(markdown).toContain('- Dos');
  });
});

describe('resolución de enlaces con baseUrl', () => {
  it('convierte enlaces relativos en absolutos', () => {
    const html = '<article><h1>T</h1><p><a href="/a/b">x</a></p></article>';
    const { markdown } = convertHtml(html, { baseUrl: 'https://ejemplo.com/seccion/' });
    expect(markdown).toContain('[x](https://ejemplo.com/a/b)');
  });
});
