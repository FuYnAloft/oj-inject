import rawHighlightCss from 'highlight.js/styles/github.css?raw';
import {parseProblems} from './markdown.js';
import {generateProblem} from './generate.js';
import './style.css';
import Toastify from 'toastify-js';
import 'toastify-js/src/toastify.css';

const highlightCss = rawHighlightCss.replace(/(?:pre )?code\.hljs\s*\{[^}]*\}\s*/g, '');

const [initialMarkdown, githubCss, githubTweakedCss, githubTweakedCompactCss] = await Promise.all([
  fetch(`${import.meta.env.BASE_URL}template.md`).then((res) => res.text()),
  fetch(`${import.meta.env.BASE_URL}styles/github-markdown.css`).then((res) => res.text()),
  fetch(`${import.meta.env.BASE_URL}styles/github-markdown-tweaked.css`).then((res) => res.text()),
  fetch(`${import.meta.env.BASE_URL}styles/github-markdown-tweaked-compact.css`).then((res) => res.text()),
]);

const cssMap = {
  github: githubCss,
  'github-tweaked': githubTweakedCss,
  'github-tweaked-compact': githubTweakedCompactCss,
};

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
        <option value="github-tweaked-compact">Github 优化 紧凑</option>
      </select>
      <label for="widening-input" style="margin-left: 12px;">题目描述加宽</label>
      <input id="widening-input" type="number" step="1" style="width: 50px;" />
      <span>px</span>
      <label style="margin-left: 12px;" title="普通单换行会转换为 &lt;br&gt;">
        <input id="single-line-break-input" type="checkbox" />
        单换行
      </label>
      <div class="strip-oj-remove-control">
        <label>
          <input id="strip-oj-remove-input" type="checkbox" />
          剔除标记内容
        </label>
        <span class="tooltip-icon" data-tooltip="剔除所有 :::oj-remove 容器及其内容">ⓘ</span>
      </div>
    </div>
    <div class="actions">
      <button id="html-generate-btn">直接输入 HTML</button>
      <button id="generate-btn" class="primary">生成脚本</button>
      <button id="reset-btn">重置</button>
    </div>
    <section id="result-list"></section>
    
    <section class="guide-section">
      <img src="${import.meta.env.BASE_URL}guide.png" alt="使用指南" class="guide-img" />
    </section>
  </main>
  <dialog id="html-input-dialog">
    <h2>直接输入 HTML</h2>
    <textarea id="html-input" placeholder="在这里输入 HTML"></textarea>
    <div class="dialog-actions">
      <button id="cancel-html-input">取消</button>
      <button id="confirm-html-input">确定</button>
    </div>
  </dialog>
  <dialog id="code-dialog">
    <textarea id="dialog-code" readonly></textarea>
    <button id="close-dialog">关闭</button>
  </dialog>
`;

const inputEl = document.querySelector('#markdown-input');
const styleSelectEl = document.querySelector('#style-select');
const wideningInputEl = document.querySelector('#widening-input');
const singleLineBreakInputEl = document.querySelector('#single-line-break-input');
const stripOjRemoveInputEl = document.querySelector('#strip-oj-remove-input');
const resultListEl = document.querySelector('#result-list');
const htmlInputDialogEl = document.querySelector('#html-input-dialog');
const htmlInputEl = document.querySelector('#html-input');
const dialogEl = document.querySelector('#code-dialog');
const dialogCodeEl = document.querySelector('#dialog-code');

const CONFIG_KEY = 'oj-inject-config';
const defaultConfig = {
  style: 'github-tweaked',
  widening: 0,
  singleLineBreak: true,
  stripOjRemove: true,
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

singleLineBreakInputEl.checked = config.singleLineBreak;
singleLineBreakInputEl.addEventListener('change', () => {
  config.singleLineBreak = singleLineBreakInputEl.checked;
  saveConfig();
});

stripOjRemoveInputEl.checked = config.stripOjRemove;
stripOjRemoveInputEl.addEventListener('change', () => {
  config.stripOjRemove = stripOjRemoveInputEl.checked;
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

function showCode(code) {
  dialogCodeEl.value = code;
  dialogEl.showModal();
  dialogCodeEl.focus();
  dialogCodeEl.select();
}

function renderResults(items) {
  const problemHtml = items
    .map(
      ({ title }, idx) => `
      <article class="result-item">
        <div class="result-title">
          <strong>${title}</strong>
          <button class="html-preview-button" data-action="show-html" data-index="${idx}" title="显示HTML" aria-label="显示HTML">👁️</button>
        </div>
        <div class="item-actions">
          <button data-action="copy" data-index="${idx}" title="复制">📋复制代码</button>
          <button data-action="show" data-index="${idx}">显示代码</button>
        </div>
      </article>`,
    )
    .join('');

  resultListEl.innerHTML = problemHtml;

  // 绑定普通题目项的事件
  resultListEl.querySelectorAll('button[data-action="copy"]').forEach((button) => {
    button.addEventListener('click', () => {
      const code = items[Number(button.dataset.index)].code;
      copyCode(code);
    });
  });

  resultListEl.querySelectorAll('button[data-action="show"]').forEach((button) => {
    button.addEventListener('click', () => {
      showCode(items[Number(button.dataset.index)].code);
    });
  });

  resultListEl.querySelectorAll('button[data-action="show-html"]').forEach((button) => {
    button.addEventListener('click', () => {
      showCode(items[Number(button.dataset.index)].finalHtml);
    });
  });

}

document.querySelector('#generate-btn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  renderResults([]);
  try {
    const problems = await parseProblems(inputEl.value, {...config}, cssMap, highlightCss);
    renderResults(problems);
    if (problems.length === 0) {
      showToast('未找到题目（请检查一级标题 #）', 'error');
      return;
    }
    showToast('生成成功！', 'info');
    if (problems.length === 1) await copyCode(problems[0].code);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#reset-btn').addEventListener('click', () => {
  if (!confirm('确认重置为模板内容？')) return;
  localStorage.removeItem('oj-inject-markdown');
  inputEl.value = initialMarkdown;
  renderResults([]);
});

document.querySelector('#html-generate-btn').addEventListener('click', () => {
  htmlInputDialogEl.showModal();
  htmlInputEl.focus();
});

document.querySelector('#cancel-html-input').addEventListener('click', () => {
  htmlInputDialogEl.close();
});

document.querySelector('#confirm-html-input').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const html = htmlInputEl.value;
    const {code} = await generateProblem({html, source: html, format: 'html'});
    htmlInputDialogEl.close();
    showCode(code);
    await copyCode(code);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#close-dialog').addEventListener('click', () => dialogEl.close());

renderResults([]);
