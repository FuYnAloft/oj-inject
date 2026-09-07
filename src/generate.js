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

    return `const setVal = (name, val) => {
  const el = document.querySelector('[name="' + name + '"]');
  if (el) el.value = val;
};
${paramsFill}
const ed = tinymce.get('editor'); 
ed.getContent = () => ${JSON.stringify(desc)};
ed.setContent("<p>描述已注入，直接提交保存即可。</p>");`
}