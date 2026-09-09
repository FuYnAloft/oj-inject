// Offline OJ Inject V2 extractor. Requires only Node.js built-ins.
import {gunzipSync} from 'node:zlib';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function extract(pageHtml) {
  const parts = new Map();
  let source;
  for (const match of pageHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = {};
    for (const attr of match[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    }
    const type = attributes.type;
    if (type !== 'application/x-oj-inject-data' && type !== 'application/x-oj-inject-source') continue;
    if (attributes['data-version'] !== '2') throw new Error('不支持的数据版本');
    if (type === 'application/x-oj-inject-source') {
      if (source) throw new Error('存在多份源码数据，请每次提取一道题');
      source = {format: attributes['data-format'], data: match[2]};
    } else {
      const index = attributes['data-part'];
      if (!/^[0-3]$/.test(index) || parts.has(index)) throw new Error('题面分块编号无效或重复');
      parts.set(index, match[2]);
    }
  }
  if (parts.size !== 4 || !source) throw new Error('缺少完整的 OJ Inject V2 数据节点');
  if (!['markdown', 'html'].includes(source.format)) throw new Error('不支持的源码格式');
  const decode = data => {
    const base64 = data.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      throw new Error('Base64 数据损坏');
    }
    return new TextDecoder('utf-8', {fatal: true}).decode(gunzipSync(Buffer.from(base64, 'base64')));
  };
  return {
    html: decode(['0', '1', '2', '3'].map(index => parts.get(index)).join('')),
    source: decode(source.data),
    format: source.format,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , input, prefix = 'recovered'] = process.argv;
    if (!input) throw new Error('用法：node extract.mjs page.html [输出文件名前缀]');
    const result = extract(readFileSync(input, 'utf8'));
    const outputs = [[prefix + '.html', result.html], [prefix + (result.format === 'markdown' ? '.md' : '.source.html'), result.source]];
    for (const [path] of outputs) {
      if (existsSync(path)) throw new Error('文件已存在，请换一个输出前缀：' + path);
    }
    for (const [path, content] of outputs) writeFileSync(path, content, {encoding: 'utf8', flag: 'wx'});
    console.log(outputs.map(([path]) => path).join('\n'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
