import { load as loadYaml } from 'js-yaml';
import { toString } from 'mdast-util-to-string';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { generateConsoleCode } from './generate.js';
import { unified } from 'unified';
import './style.css';
import Toastify from 'toastify-js';
import 'toastify-js/src/toastify.css';

const initialMarkdown = await fetch(`${import.meta.env.BASE_URL}template.md`).then((res) => res.text());
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);
const htmlCompiler = unified().use(remarkRehype).use(rehypeStringify);

document.querySelector('#app').innerHTML = `
  <main class="container">
    <h1>OpenJudge 自由题目描述</h1>
    <textarea id="markdown-input"></textarea>
    <div class="actions">
      <button id="generate-btn" class="primary">生成代码</button>
      <button id="reset-btn">重置</button>
    </div>
    <section id="result-list"></section>
    
    <section class="guide-section">
      <img src="${import.meta.env.BASE_URL}guide.png" alt="使用指南" class="guide-img" />
    </section>
  </main>
  <dialog id="code-dialog">
    <textarea id="dialog-code" readonly></textarea>
    <button id="close-dialog">关闭</button>
  </dialog>
`;

const inputEl = document.querySelector('#markdown-input');
const resultListEl = document.querySelector('#result-list');
const dialogEl = document.querySelector('#code-dialog');
const dialogCodeEl = document.querySelector('#dialog-code');

inputEl.value = initialMarkdown;

function showToast(text, isError = false) {
  Toastify({
    text,
    duration: 2500,
    gravity: 'bottom',
    position: 'center',
    stopOnFocus: true,
    style: {
      background: isError ? '#ef4444' : '#10b981',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      fontSize: '14px',
    },
  }).showToast();
}

function parseProblems(source) {
  const tree = parser.parse(source);
  const problems = [];
  let current = null;

  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) {
      if (current) {
        problems.push(current);
      }
      current = {
        title: toString(node).trim(),
        nodes: [],
      };
      continue;
    }
    if (current) {
      current.nodes.push(node);
    }
  }
  if (current) {
    problems.push(current);
  }

  return problems.map(({ title, nodes }) => {
    let params = {};
    const contentNodes = [...nodes];
    const headingYaml = contentNodes.find(
      (node) => node.type === 'heading' && node.depth === 2 && toString(node).includes(':'),
    );
    if (headingYaml) {
      params = loadYaml(toString(headingYaml)) || {};
      const yamlIndex = contentNodes.indexOf(headingYaml);
      let removeFrom = yamlIndex;
      while (removeFrom > 0 && contentNodes[removeFrom - 1].type === 'thematicBreak') {
        removeFrom -= 1;
      }
      let removeTo = yamlIndex;
      while (removeTo + 1 < contentNodes.length && contentNodes[removeTo + 1].type === 'thematicBreak') {
        removeTo += 1;
      }
      contentNodes.splice(removeFrom, removeTo - removeFrom + 1);
    }

    const defaultFields = ['input', 'output', 'sampleInput', 'sampleOutput', 'hint', 'source'];
    const DEFAULT_TEXT = '（不需要写，写了也没用）';

    defaultFields.forEach((field) => {
      if (params[field] === undefined || params[field] === null) {
        params[field] = DEFAULT_TEXT;
      }
    });

    const html = String(
      htmlCompiler.stringify(
        htmlCompiler.runSync({
          type: 'root',
          children: contentNodes,
        }),
      ),
    );

    return {
      title,
      code: generateConsoleCode(html, { ...params, title }),
    };
  });
}

function renderResults(items) {
  if (items.length === 0) {
    resultListEl.innerHTML = '<p class="empty">未找到题目（请检查一级标题 #）。</p>';
    return;
  }
  resultListEl.innerHTML = items
    .map(
      ({ title }, idx) => `
      <article class="result-item">
        <strong>${title}</strong>
        <div class="item-actions">
          <button data-action="copy" data-index="${idx}" title="复制">📋复制代码</button>
          <button data-action="show" data-index="${idx}">显示代码</button>
        </div>
      </article>`,
    )
    .join('');

  resultListEl.querySelectorAll('button[data-action="copy"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = items[Number(button.dataset.index)].code;
      try {
        await navigator.clipboard.writeText(code);
        showToast('已复制！请粘贴到题目编辑页面的控制台执行');
      } catch {
        showToast('复制失败，请使用“展示”按钮手动复制', true);
      }
    });
  });

  resultListEl.querySelectorAll('button[data-action="show"]').forEach((button) => {
    button.addEventListener('click', () => {
      dialogCodeEl.value = items[Number(button.dataset.index)].code;
      dialogEl.showModal();
      dialogCodeEl.focus();
      dialogCodeEl.select();
    });
  });
}

document.querySelector('#generate-btn').addEventListener('click', () => {
  renderResults(parseProblems(inputEl.value));
});

document.querySelector('#reset-btn').addEventListener('click', () => {
  if (!confirm('确认重置为模板内容？')) return;
  inputEl.value = initialMarkdown;
  resultListEl.innerHTML = '';
});

document.querySelector('#close-dialog').addEventListener('click', () => dialogEl.close());
