export const FIELD_LIMIT = 65535;
export const PAYLOAD_FIELDS = ['input', 'output', 'sampleInput', 'sampleOutput'];
const encoder = new TextEncoder();

export const DESCRIPTION = '<p>题目描述加载中。如果持续看到此说明，请确认浏览器没有禁用 JavaScript，并查看是否有加载错误。</p>' +
  '<p>本题使用 <a href="https://github.com/FuYnAloft/oj-inject">OJ Inject（FuYnAloft/oj-inject）</a> 构建。</p>' +
  '<p>无需浏览器也可从本页 HTML 提取题面和源码：查找 type="application/x-oj-inject-data" 的四个 script 数据节点，按 data-part="0" 至 "3" 排序拼接文本，再依次进行 Base64 解码、gzip 解压和 UTF-8 解码，即得到 HTML 题面。查找 type="application/x-oj-inject-source" 的 script 数据节点，对文本做同样的解码，即得到 Markdown 原文（或 HTML 原文，data-format 表示源码格式）。</p>' +
  '<p>也可以从上方的仓库下载 public/extract.mjs，用 Node.js 执行：<code>node extract.mjs page.html recovered</code>，输出 recovered.html 和 recovered.md（或 recovered.source.html）。适用于服务器返回的页面源码，以及保留数据节点的渲染后 HTML。</p>';

export async function compressToBase64(text) {
  const stream = new Blob([encoder.encode(text)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// Self-contained browser function. No line comments: the emitted script is one line.
function loadProblem() {
  const dl = document.currentScript?.closest('dl.problem-content');
  if (!dl) return;
  const visibility = dl.style.visibility;
  dl.style.visibility = 'hidden';
  const ready = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once: true}))
    : Promise.resolve();
  ready.then(async () => {
    try {
      const parts = [...dl.querySelectorAll('script[type="application/x-oj-inject-data"]')];
      parts.sort((a, b) => Number(a.dataset.part) - Number(b.dataset.part));
      if (parts.length !== 4 || parts.some((part, i) => part.dataset.part !== String(i) || part.dataset.version !== '2')) {
        throw new Error('题面数据缺失或版本不支持');
      }
      const source = dl.querySelector('script[type="application/x-oj-inject-source"]');
      if (!source || source.dataset.version !== '2') throw new Error('源码数据缺失');
      const bytes = Uint8Array.from(atob(parts.map(part => part.textContent).join('')), c => c.charCodeAt(0));
      const html = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      dl.innerHTML = html;
      dl.append(...parts, source);
    } catch (error) {
      const message = document.createElement('dd');
      message.textContent = 'OJ Inject 加载失败：' + error.message;
      dl.append(message);
    } finally {
      dl.style.visibility = visibility;
    }
  });
}

export const LOADER = '<script>(' + loadProblem.toString().replace(/[\r\n]+\s*/g, '') + ')();</script>';

export function assertFieldSize(name, value) {
  const size = encoder.encode(value).length;
  if (size > FIELD_LIMIT) throw new Error(name + ' 字段为 ' + size + ' 字节，超过 ' + FIELD_LIMIT + ' 字节上限');
  return size;
}

export function packFields(htmlBase64, sourceBase64, format) {
  if (!['markdown', 'html'].includes(format)) throw new Error('不支持的源码格式');
  const fields = {description: DESCRIPTION};
  let offset = 0;
  for (const [index, field] of PAYLOAD_FIELDS.entries()) {
    const open = '<script type="application/x-oj-inject-data" data-version="2" data-part="' + index + '">';
    const close = '</script>';
    const capacity = FIELD_LIMIT - encoder.encode(open + close).length;
    const chunk = htmlBase64.slice(offset, offset + capacity);
    fields[field] = open + chunk + close;
    offset += chunk.length;
  }
  if (offset !== htmlBase64.length) {
    throw new Error('题面 Base64 共 ' + htmlBase64.length + ' 字节，超过四个字段的总载荷容量 ' + offset + ' 字节');
  }
  fields.hint = '<script type="application/x-oj-inject-source" data-version="2" data-format="' + format + '">' + sourceBase64 + '</script>' + LOADER;
  for (const [name, value] of Object.entries(fields)) assertFieldSize(name, value);
  return fields;
}

export async function generateProblem({html, source, format = 'markdown', params = {}}) {
  const [payload, original] = await Promise.all([compressToBase64(html), compressToBase64(source)]);
  const fields = packFields(payload, original, format);
  return {fields, code: generateConsoleCode(fields, params)};
}

export function generateConsoleCode(fields, params = {}) {
  // Frontmatter cannot overwrite storage fields or the problem ID.
  const allowed = ['title', 'timeLimit', 'caseTimeLimit', 'memoryLimit', 'source'];
  const metadata = Object.fromEntries(Object.entries(params).filter(([key, value]) => allowed.includes(key) && value != null));
  const values = {...metadata, ...fields};
  return '(function() {\n' +
    'const values = ' + JSON.stringify(values) + ';\n' +
    'const editor = globalThis.tinymce?.get("editor");\n' +
    'if (!editor) throw new Error("未找到题目描述编辑器，请在 OpenJudge 题目编辑页执行");\n' +
    'const form = document.querySelector(\'textarea[name="description"]\')?.form;\n' +
    'const targets = Object.keys(values).map(name => [name, form?.elements.namedItem(name)]);\n' +
    'for (const [name, element] of targets) { if (!element || !("value" in element)) throw new Error("未找到字段：" + name); }\n' +
    'editor.setContent(values.description);\n' +
    'editor.save();\n' +
    'for (const [name, element] of targets) { if (name !== "description") element.value = values[name]; }\n' +
    'console.info("OJ Inject 已填入，请提交保存。之后可直接编辑并保存，无需恢复脚本。");\n' +
    '})();';
}

