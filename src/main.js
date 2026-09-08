import { load as loadYaml } from 'js-yaml';
import { toString } from 'mdast-util-to-string';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from "rehype-katex";
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { generateConsoleCode, generateInjectScript, restoreConsoleCode } from './generate.js';
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
        <option value="github">Github 原版</option>
        <option value="github-tweaked">Github 优化</option>
      </select>
      <label for="widening-input" style="margin-left: 12px;">题目描述加宽</label>
      <input id="widening-input" type="number" step="1" style="width: 50px;" />
      <span>px</span>
    </div>
    <div class="actions">
      <button id="generate-btn" class="primary">生成脚本</button>
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
const wideningInputEl = document.querySelector('#widening-input');
const resultListEl = document.querySelector('#result-list');
const dialogEl = document.querySelector('#code-dialog');
const dialogCodeEl = document.querySelector('#dialog-code');

const CONFIG_KEY = 'oj-inject-config';
const defaultConfig = {
  style: 'github-tweaked',
  widening: 0,
};

let config;
try {
  config = {
    ...defaultConfig,
    ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'),
  };
} catch {
  config = {...defaultConfig};
}

function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

inputEl.value = localStorage.getItem('oj-inject-markdown') || initialMarkdown;

inputEl.addEventListener('input', () => {
  localStorage.setItem('oj-inject-markdown', inputEl.value);
});

styleSelectEl.value = config.style;
styleSelectEl.addEventListener('change', () => {
  config.style = styleSelectEl.value;
  saveConfig();
});

wideningInputEl.value = config.widening;
wideningInputEl.addEventListener('input', () => {
  config.widening = Number(wideningInputEl.value) || 0;
  saveConfig();
});

function showToast(text, type = 'success') {
  const backgroundColors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6',
  };

  Toastify({
    text,
    duration: 2500,
    gravity: 'bottom',
    position: 'center',
    stopOnFocus: true,
    style: {
      background: backgroundColors[type],
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      fontSize: '14px',
    },
  }).showToast();
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    showToast('已复制！请粘贴到题目编辑页面的控制台执行');
  } catch {
    showToast('复制失败，请使用“展示”按钮手动复制', 'error');
  }
}

function postProcessHtml(rawHtml) {
  let html = rawHtml

  const currentStyle = document.querySelector('#style-select')?.value || 'github-tweaked';
  if (currentStyle !== 'none') {
    const css = cssMap[currentStyle] || '';
    html = `<style>${css}</style><div class="markdown-body">\n${html}\n</div>`;
  }


  const widening = config.widening;
  if (widening !== 0) {
    const style = `<style>
:root {
  --oj-inject-widening: ${widening}px;
  --oj-inject-stat-max-narrowing: 75px;
  
  --oj-inject-stat-narrowing: clamp(0px, var(--oj-inject-widening), var(--oj-inject-stat-max-narrowing));
  --oj-inject-wrapper-delta: calc(var(--oj-inject-widening) - var(--oj-inject-stat-narrowing));
}
.problem-page {
    width: calc(670px + var(--oj-inject-widening));
}
.problem-statistics {
    width: calc(234px - var(--oj-inject-stat-narrowing));
}
#pageTitle {
    width: calc(932px + var(--oj-inject-wrapper-delta));
}
#pagebody .wrapper{
    width: calc(960px + var(--oj-inject-wrapper-delta));
}
</style>`
    html = style + html;
  }

  return html;
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
        const DEFAULT_TEXT = '\u200B'; // Zero-width space

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
  const problemHtml = items
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

  const restoreHtml = `
    <article class="result-item">
      <strong>恢复脚本 <span class="tooltip-icon" data-tooltip="恢复曾经注入的题目描述">ⓘ</span></strong>
      <div class="item-actions">
        <button data-action="copy-restore" title="复制">📋复制代码</button>
        <button data-action="show-restore">显示代码</button>
      </div>
    </article>`;

  resultListEl.innerHTML = problemHtml + restoreHtml;

  // 绑定普通题目项的事件
  resultListEl.querySelectorAll('button[data-action="copy"]').forEach((button) => {
    button.addEventListener('click', () => {
      const code = items[Number(button.dataset.index)].code;
      copyCode(code);
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

  const copyRestoreBtn = resultListEl.querySelector('button[data-action="copy-restore"]');
  if (copyRestoreBtn) {
    copyRestoreBtn.addEventListener('click', () => copyCode(restoreConsoleCode));
  }

  const showRestoreBtn = resultListEl.querySelector('button[data-action="show-restore"]');
  if (showRestoreBtn) {
    showRestoreBtn.addEventListener('click', () => {
      dialogCodeEl.value = restoreConsoleCode;
      dialogEl.showModal();
      dialogCodeEl.focus();
      dialogCodeEl.select();
    });
  }
}

document.querySelector('#generate-btn').addEventListener('click', async () => {
  const problems = await parseProblems(inputEl.value);
  renderResults(problems);

  if (problems.length === 0) {
    showToast('未找到题目（请检查一级标题 #）', 'error');
    return;
  }

  showToast('生成成功！', 'info');
  if (problems.length === 1) {
    await copyCode(problems[0].code);
  }
});

document.querySelector('#reset-btn').addEventListener('click', () => {
  if (!confirm('确认重置为模板内容？')) return;
  localStorage.removeItem('oj-inject-markdown');
  inputEl.value = initialMarkdown;
  renderResults([]);
});

document.querySelector('#close-dialog').addEventListener('click', () => dialogEl.close());

renderResults([]);
