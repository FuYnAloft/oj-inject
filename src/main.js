import { load as loadYaml } from 'js-yaml';
import { toString } from 'mdast-util-to-string';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from "rehype-katex";
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { generateConsoleCode, generateInjectScript } from './generate.js';
import { unified } from 'unified';
import './style.css';
import Toastify from 'toastify-js';
import 'toastify-js/src/toastify.css';

const [initialMarkdown, githubCss, githubTweakedCss] = await Promise.all([
  fetch(`${import.meta.env.BASE_URL}template.md`).then((res) => res.text()),
  fetch(`${import.meta.env.BASE_URL}styles/github-markdown.css`).then((res) => res.text()),
  fetch(`${import.meta.env.BASE_URL}styles/github-markdown-tweaked.css`).then((res) => res.text()),
]);

const cssMap = {
  github: githubCss,
  'github-tweaked': githubTweakedCss,
};

const parser = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkMath);
const htmlCompiler = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex, { output: 'mathml' })
    .use(rehypeStringify, { allowDangerousHtml: true });

document.querySelector('#app').innerHTML = `
  <main class="container">
    <h1>OpenJudge 自由题目描述</h1>
    <textarea id="markdown-input"></textarea>
    <div class="config-bar" style="margin: 10px 0;">
      <label for="style-select">样式：</label>
      <select id="style-select">
        <option value="none">无</option>
        <option value="github">Github</option>
        <option value="github-tweaked">Github 微调</option>
      </select>
    </div>
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
const styleSelectEl = document.querySelector('#style-select');
const resultListEl = document.querySelector('#result-list');
const dialogEl = document.querySelector('#code-dialog');
const dialogCodeEl = document.querySelector('#dialog-code');

inputEl.value = localStorage.getItem('oj-inject-markdown') || initialMarkdown;

inputEl.addEventListener('input', () => {
  localStorage.setItem('oj-inject-markdown', inputEl.value);
});

styleSelectEl.value = localStorage.getItem('oj-inject-style') || 'github-tweaked';
styleSelectEl.addEventListener('change', () => {
  localStorage.setItem('oj-inject-style', styleSelectEl.value);
});

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

function postProcessHtml(rawHtml) {
  const currentStyle = document.querySelector('#style-select')?.value || 'github-tweaked';
  if (currentStyle === 'none') {
    return rawHtml;
  }

  const css = cssMap[currentStyle] || '';
  return `<style>${css}</style><div class="markdown-body">\n${rawHtml}\n</div>`;
}

async function parseProblems(source) {
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

  return Promise.all(
      problems.map(async ({title, nodes}) => {
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

        const finalHtml = postProcessHtml(html);
        const desc = await generateInjectScript(finalHtml);

        return {
          title,
          code: generateConsoleCode(desc, {...params, title}),
        };
      }));
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

document.querySelector('#generate-btn').addEventListener('click', async () => {
  renderResults(await parseProblems(inputEl.value));
});

document.querySelector('#reset-btn').addEventListener('click', () => {
  if (!confirm('确认重置为模板内容？')) return;
  localStorage.removeItem('oj-inject-markdown');
  inputEl.value = initialMarkdown;
  resultListEl.innerHTML = '';
});

document.querySelector('#close-dialog').addEventListener('click', () => dialogEl.close());
