import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import { cleanDocument, pickMainContent } from '../src/convert/clean.js';

describe('cleanDocument', () => {
  it('elimina scripts, estilos, navegación y barras laterales', () => {
    const root = parse(`<body>
      <nav>menu</nav>
      <aside class="sidebar">lateral</aside>
      <script>evil()</script>
      <style>.a{}</style>
      <main><p>contenido</p></main>
      <footer>pie</footer>
    </body>`);
    cleanDocument(root);
    const text = root.text;
    expect(text).toContain('contenido');
    expect(text).not.toContain('menu');
    expect(text).not.toContain('lateral');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('pie');
  });

  it('elimina contenedores con class/id de ruido pero conserva el contenido principal', () => {
    const root = parse(`<body>
      <div class="ad-slot">anuncio</div>
      <div id="newsletter-signup">suscríbete</div>
      <div class="post-body"><p>artículo</p></div>
    </body>`);
    cleanDocument(root);
    const text = root.text;
    expect(text).toContain('artículo');
    expect(text).not.toContain('anuncio');
    expect(text).not.toContain('suscríbete');
  });

  it('conserva la cabecera de artículo (que lleva el título), no la de página', () => {
    const root = parse(`<body>
      <header class="site-header">cabecera de página</header>
      <article><header class="entry-header"><h1>Título</h1></header><p>cuerpo</p></article>
    </body>`);
    cleanDocument(root);
    const text = root.text;
    expect(text).toContain('Título');
    expect(text).toContain('cuerpo');
    expect(text).not.toContain('cabecera de página');
  });

  it('no confunde tokens legítimos con ruido (gradient no es "ad")', () => {
    const root = parse('<body><div class="gradient-hero"><p>hero</p></div></body>');
    cleanDocument(root);
    expect(root.text).toContain('hero');
  });
});

describe('pickMainContent', () => {
  it('prefiere <main>/<article> con cuerpo suficiente', () => {
    const longText = 'palabra '.repeat(60);
    const root = parse(`<body><div>ruido corto</div><article><p>${longText}</p></article></body>`);
    const main = pickMainContent(root);
    expect(main.text).toContain('palabra');
    expect(main.tagName?.toLowerCase()).toBe('article');
  });

  it('recurre al body cuando no hay contenedor semántico con cuerpo', () => {
    const root = parse('<body><div><p>solo un div</p></div></body>');
    const main = pickMainContent(root);
    expect(main.text).toContain('solo un div');
  });
});
