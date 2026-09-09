import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {generateProblem, packFields, PAYLOAD_FIELDS, FIELD_LIMIT, LOADER, assertFieldSize} from '../src/generate.js';
import {parseProblems} from '../src/markdown.js';
import {extract} from '../public/extract.mjs';

function fillEditor(code, initial = {}) {
  const names = ['description', ...PAYLOAD_FIELDS, 'hint', 'title', 'source', 'timeLimit', 'caseTimeLimit', 'memoryLimit'];
  const controls = Object.fromEntries(names.map(name => [name, {value: initial[name] ?? ''}]));
  let content;
  const getContent = () => content;
  const editor = {getContent, setContent(value) {content = value;}, save() {controls.description.value = content;}};
  runInNewContext(code, {
    document: {querySelector: () => ({form: {elements: {namedItem: name => controls[name]}}})},
    tinymce: {get: () => editor}, console: {info() {}},
  });
  assert.equal(editor.getContent, getContent);
  return Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.value]));
}

function page(fields) {
  const br = text => text.replace(/\r?\n/g, '<br>');
  return '<dl class="problem-content"><dd>' + fields.description + '</dd>' +
    PAYLOAD_FIELDS.map(name => '<dd>' + (name.startsWith('sample') ? '<pre>' + br(fields[name]) + '</pre>' : br(fields[name])) + '</dd>').join('') +
    '<dd>' + br(fields.hint) + '</dd><dd>来源</dd></dl>';
}

test('多分块题面、中文源码在 OJ 换行处理后完整往返，重复填写不改写 getContent', async () => {
  const html = '<pre>' + randomBytes(150000).toString('base64') + '</pre>\n<p>中文</p>';
  const source = '# 题目\r\n\r\n```html\r\n</script><script>示例</script>\r\n```';
  const result = await generateProblem({html, source, params: {title: '题目', timeLimit: 1000, input: '不能覆盖', hint: '不能覆盖'}});
  const fields = fillEditor(result.code);
  assert.equal(fields.title, '题目');
  assert.equal(fields.input, result.fields.input);
  for (const field of [...PAYLOAD_FIELDS, 'hint']) {
    assert.ok(Buffer.byteLength(fields[field]) <= FIELD_LIMIT);
    assert.doesNotMatch(fields[field], /[\r\n]/);
  }
  assert.match(fields.sampleOutput, /[A-Za-z0-9+/]{100}/);
  assert.deepEqual(extract(page(fields)), {html, source, format: 'markdown'});
  assert.deepEqual(fillEditor(result.code, fields), fields);
  assert.doesNotMatch(result.code, /localStorage|new Function|getContent\s*=/);
});

test('字段包装也计入容量，四分块和提示字段超限明确报错', () => {
  assert.equal(assertFieldSize('input', 'a'.repeat(FIELD_LIMIT)), FIELD_LIMIT);
  assert.throws(() => assertFieldSize('hint', '汉'.repeat(21846)), /hint.*65538/);
  assert.throws(() => packFields('a'.repeat(FIELD_LIMIT * 4), '', 'markdown'), /总载荷容量/);
  assert.throws(() => packFields('', 'a'.repeat(FIELD_LIMIT), 'markdown'), /hint.*字节/);
});

test('Markdown 每题保存原始区间，按开关剔除容器，保留代码示例及 YAML 换行', async () => {
  const first = '# 一\r\n\r\n---\r\ntimeLimit: 1000\r\ncaseTimeLimit: 100\r\nmemoryLimit: 65536\r\n---\r\n\r\n正文\r\n第二行\r\n\r\n';
  const remove = '::::oj-remove\r\n**私密**\r\n\r\n:::oj-remove\r\n嵌套私密\r\n:::\r\n::::';
  const code = '\r\n\r\n```text\r\n:::oj-remove\r\n代码示例\r\n:::\r\n```\r\n\r\n';
  const second = '# 二\r\n\r\n第二题';
  for (const stripOjRemove of [false, true]) {
    const results = await parseProblems(first + remove + code + second, {style: 'none', widening: 0, singleLineBreak: true, stripOjRemove}, {});
    assert.equal(results.length, 2);
    const fields = fillEditor(results[0].code);
    const decoded = extract(page(fields));
    assert.equal(decoded.source, first + (stripOjRemove ? '' : remove) + code);
    assert.equal(fields.timeLimit, 1000);
    assert.match(decoded.html, /正文<br>\n第二行/);
    assert.match(decoded.html, /代码示例/);
    assert.equal(decoded.html.includes('私密'), !stripOjRemove);
    assert.equal(extract(page(fillEditor(results[1].code))).source, second);
  }
});

test('直接 HTML 原样存储，标题与来源保留，源码格式为 html', async () => {
  const html = '<style>p{color:red}</style>\n<p><!-- 原样 -->hello</p>';
  const {code} = await generateProblem({html, source: html, format: 'html'});
  const fields = fillEditor(code, {title: '旧标题', source: '旧来源'});
  assert.equal(fields.title, '旧标题');
  assert.equal(fields.source, '旧来源');
  assert.deepEqual(extract(page(fields)), {html, source: html, format: 'html'});
});

test('离线提取拒绝缺块、重复块、损坏的 gzip', async () => {
  const {fields} = await generateProblem({html: '<p>题面</p>', source: '# 题目'});
  assert.throws(() => extract(page({...fields, output: ''})), /缺少/);
  assert.throws(() => extract(page(fields) + fields.input), /重复/);
  const corrupt = {...fields, input: fields.input.replace(/>[^<]+<\/script>/, '>AAAA</script>')};
  assert.throws(() => extract(page(corrupt)));
});

test('加载器等待 DOM 完成，保留可提取数据；缺块时恢复可见错误', async () => {
  const html = '<p>加载后的题面</p>';
  const {fields} = await generateProblem({html, source: '# 原文'});
  for (const broken of [false, true]) {
    const parts = PAYLOAD_FIELDS.map((field, index) => ({dataset: {part: String(index), version: '2'}, textContent: fields[field].match(/>([^<]*)<\/script>/)[1]}));
    if (broken) parts.pop();
    const source = {dataset: {version: '2'}};
    let loaded;
    let finish;
    const done = new Promise(resolve => {finish = resolve;});
    let visible = '';
    const dl = {innerHTML: '占位说明', appended: [], style: {
      get visibility() {return visible;},
      set visibility(value) {visible = value; if (value === '') finish();},
    }, querySelectorAll: () => parts, querySelector: () => source, append(...items) {this.appended.push(...items);}};
    const document = {readyState: 'loading', currentScript: {closest: () => dl}, addEventListener(name, callback) {assert.equal(name, 'DOMContentLoaded'); loaded = callback;}, createElement: () => ({})};
    runInNewContext(LOADER.slice('<script>'.length, -'</script>'.length), {document, Uint8Array, Blob, Response, DecompressionStream, atob});
    assert.equal(dl.style.visibility, 'hidden');
    assert.equal(dl.innerHTML, '占位说明');
    loaded();
    await done;
    if (broken) {
      assert.equal(dl.innerHTML, '占位说明');
      assert.match(dl.appended[0].textContent, /加载失败.*缺失/);
    } else {
      assert.equal(dl.innerHTML, html);
      assert.deepEqual(dl.appended, [...parts, source]);
    }
    assert.equal(dl.style.visibility, '');
  }
});
