function generateInjectScript(html) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(html);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return `<script>const s=document.currentScript,b64='${base64}';setTimeout(function(){const dl=s.closest('dl.problem-content');if(dl){const bin=atob(b64);const bytes=Uint8Array.from(bin,function(c){return c.charCodeAt(0)});dl.innerHTML=new TextDecoder().decode(bytes);}},0);<\/script>`;}

export function generateConsoleCode(html, params = {}) {
    const paramsFill = Object.entries(params)
        .map(([key, value]) => `document.querySelector('input[name="${key}"]').value = ${JSON.stringify(value)};`)
        .join('\n');
    const inject = generateInjectScript(html)

    return `${paramsFill}
const ed = tinymce.get('editor'); 
ed.getContent = () => "${inject}";
ed.setContent("<p>描述已注入，直接提交保存即可。</p>");`
}