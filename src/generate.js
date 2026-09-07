export const restoreConsoleCode = `
(function() {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) throw new Error("URL 缺少 id 参数");
    const key = 'oj-inject-restore';
    const store = JSON.parse(localStorage.getItem(key) || '{}');
    code = store[id];
    if (!code) throw new Error('未找到 id=' + id + '的缓存代码');
    return new Function(code)();
})();`

export async function generateInjectScript(html) {
  const stream = new Blob([new TextEncoder().encode(html)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));

  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  return `<script>(async()=>{const s=document.currentScript,dl=s?.closest('dl.problem-content'),b='${base64}';if(!dl)return;const bytes=Uint8Array.from(atob(b),c=>c.charCodeAt(0));const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();dl.innerHTML=text;})();<\/script>`;
}

export function generateConsoleCode(desc, params = {}) {
    const paramsFill = Object.entries(params)
        .map(([key, value]) => `setVal('${key}', ${JSON.stringify(value)});`)
        .join('\n');

    const internalConsoleCode =  `
const setVal = (name, val) => {
  const el = document.querySelector('[name="' + name + '"]');
  if (el) el.value = val;
};
${paramsFill}
const ed = tinymce.get('editor'); 
ed.getContent = () => ${JSON.stringify(desc)};
ed.setContent("<p>描述已注入，直接提交保存即可。</p><p><strong>如果因为页面刷新等导致此行描述消失，你需要执行“恢复脚本”恢复。当然，把原注入脚本再执行一遍也行。</strong></p>");`

    return  `
(function() {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) throw new Error("URL 缺少 id 参数");
    const key = 'oj-inject-restore';
    const store = JSON.parse(localStorage.getItem(key) || '{}');
    const code = ${JSON.stringify(internalConsoleCode)}
    store[id] = code;
    localStorage.setItem(key, JSON.stringify(store));
    return new Function(code)();
})();`
}

