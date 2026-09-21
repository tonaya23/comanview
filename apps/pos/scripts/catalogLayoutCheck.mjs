// Automated presentation-only check. Uses synthetic data; never contacts an Edge or acceptance lab.
// Requires installed Chrome. No production/browser identity is reused.
import { build } from 'vite';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'comanview-b2-layout-'));
const output = join(temp, 'dist');
const src = join(root, 'src').replaceAll('\\', '/');
await writeFile(
  join(temp, 'index.html'),
  '<div id="root"></div><script type="module" src="/entry.tsx"></script>',
);
await writeFile(
  join(temp, 'entry.tsx'),
  `
import React from '${src}/../node_modules/react/index.js';
import {createRoot} from '${src}/../node_modules/react-dom/client.js';
import {AdministrationPanel} from '${src}/AdministrationPanel.tsx';
import {catalogFixture,allPermissions} from '${src}/catalogAdminFixtures.ts';
import '${src}/styles.css';
const f=catalogFixture();
const original=f.products[0];
f.products.splice(0,1,...Array.from({length:28},(_,i)=>({...original,id:'layout-product-'+i,name:'Producto de prueba '+String(i+1).padStart(2,'0'),active:i%6!==0,available:i%4!==0,stationId:i%2?f.admin.stations[0].id:null,displayOrder:i})));
f.categories.push(...Array.from({length:6},(_,i)=>({...f.categories[1],id:'layout-category-'+i,name:'Categoría '+(i+1),active:i%3!==0,displayOrder:i+2})));
createRoot(document.getElementById('root')).render(<AdministrationPanel edge={f.edge} currentUserId="layout-fixture" permissions={allPermissions} initialTarget={{surface:'administration',section:'products'}} onClose={()=>{}}/>);
function check(phase){
 const expected=phase==='editor'?'.catalog-editor':phase.startsWith('categor')?'.catalog-admin>div:not([hidden]) .catalog-list':'.catalog-filters';
 if(!document.querySelector(expected)?.getClientRects().length)throw Error('Missing visible '+phase);
 const overflow=[...document.querySelectorAll('.catalog-admin,.catalog-list,.catalog-editor,.catalog-filters,.admin-shell-layout')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.className);
 const outside=[...document.querySelectorAll('.catalog-admin button,.catalog-admin input,.catalog-admin select')].filter(e=>e.getClientRects().length&&(e.getBoundingClientRect().right>innerWidth+1||e.getBoundingClientRect().left<0)).map(e=>e.textContent||e.getAttribute('aria-label'));
 const rows=[...document.querySelectorAll('.catalog-product-list>li')].filter(e=>e.getClientRects().length);
 const rowHeights=rows.map(e=>Math.round(e.getBoundingClientRect().height));
 const densityOK=!rows.length||Math.max(...rowHeights)<=(innerWidth>900?90:180);
 return {phase,width:innerWidth,height:innerHeight,overflow,outside,productRows:rows.length,rowHeights,densityOK};
}
let count=0;
const timer=setInterval(()=>{
 const edit=[...document.querySelectorAll('button')].find(b=>b.textContent==='Editar');
 if(!edit){if(++count>60){clearInterval(timer);parent.postMessage({error:'Catalog did not load'},'*');}return;}
 clearInterval(timer); const results=[check('products')];
 document.querySelector('.catalog-filter-disclosure').open=true;
 [...document.querySelectorAll('label')].find(e=>e.textContent==='Mostrar retirados').querySelector('input').click();
 setTimeout(()=>{results.push(check('products-filters-open'));edit.click();
 setTimeout(()=>{results.push(check('editor'));[...document.querySelectorAll('button')].find(b=>b.textContent==='Volver a productos').click();
 setTimeout(()=>{results.push(check('products-return'));[...document.querySelectorAll('nav button')].find(b=>b.textContent.startsWith('Categorías')).click();
 setTimeout(()=>{results.push(check('categories'));[...document.querySelectorAll('button')].find(b=>b.textContent==='Ordenar categorías').click();
 setTimeout(()=>{results.push(check('categories-reorder'));parent.postMessage({results},'*');},100);},100);},100);},100);},100);
},100);
`,
);
// Only replaces vi.fn for the presentation fixture; no security/product implementation is mocked.
await build({
  configFile: false,
  root: temp,
  logLevel: 'error',
  resolve: {
    alias: {
      react: join(root, 'node_modules/react').replaceAll('\\', '/'),
      'react-dom': join(root, 'node_modules/react-dom').replaceAll('\\', '/'),
    },
  },
  plugins: [
    {
      name: 'fixture-only',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'vitest') return '\0layout-vitest';
      },
      load(id) {
        if (id === '\0layout-vitest') return 'export const vi={fn:fn=>fn};';
      },
    },
  ],
  build: { outDir: output, emptyOutDir: false, rollupOptions: { input: join(temp, 'index.html') } },
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/check') {
    const width = Number(url.searchParams.get('w')),
      height = Number(url.searchParams.get('h'));
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<body><iframe style="border:0;width:' +
        width +
        'px;height:' +
        height +
        'px" src="/index.html"></iframe><script>addEventListener("message",e=>{document.body.setAttribute("data-result",btoa(JSON.stringify(e.data)));});</script>',
    );
    return;
  }
  const file = url.pathname === '/index.html' ? 'index.html' : url.pathname.replace(/^\//, '');
  if (!/^(index\.html|assets\/[\w.-]+)$/.test(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    res.setHeader(
      'Content-Type',
      file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
    );
    res.end(await readFile(join(output, file)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const port = server.address().port;
  for (const [w, h] of [
    [1366, 768],
    [768, 1024],
  ]) {
    const profile = join(temp, `browser-${w}`);
    const { stdout } = await run(
      process.env.COMANVIEW_LAYOUT_CHROME ??
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--window-size=1500,1200',
        '--virtual-time-budget=10000',
        '--dump-dom',
        `http://127.0.0.1:${port}/check?w=${w}&h=${h}`,
      ],
      { timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
    );
    const match = stdout.match(/data-result="([^"]+)"/);
    if (!match) throw Error('Layout runner returned no evidence.');
    const result = JSON.parse(Buffer.from(match[1], 'base64').toString());
    if (
      result.error ||
      result.results.some(
        (r) =>
          r.width !== w || r.height !== h || r.overflow.length || r.outside.length || !r.densityOK,
      )
    )
      throw Error(JSON.stringify(result));
    console.log(JSON.stringify({ viewport: `${w}x${h}`, status: 'PASS', checks: result.results }));
  }
} finally {
  server.close();
  console.log('Synthetic layout evidence directory: ' + temp);
}
