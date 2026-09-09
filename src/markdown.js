import { load as loadYaml } from 'js-yaml';
import { toString } from 'mdast-util-to-string';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from "rehype-katex";
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { generateProblem } from './generate.js';
import { unified } from 'unified';

function createParser(config) {
  const parser = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, [{type: 'yaml', marker: '-', anywhere: true}])
      .use(remarkMath)
      .use(remarkDirective);

  if (config.singleLineBreak) {
    parser.use(remarkBreaks);
  }

  return parser;
}

const htmlCompiler = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex, { output: 'mathml' })
    .use(rehypeHighlight, {
      languages: {c, cpp, python},
      detect: false,
    })
    .use(rehypeStringify, { allowDangerousHtml: true });

let mermaidPromise;
let mermaidDiagramId = 0;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({default: mermaid}) => {
      mermaid.initialize({startOnLoad: false});
      return mermaid;
    });
  }
  return mermaidPromise;
}

async function renderMermaidDiagrams(node) {
  if (!Array.isArray(node.children)) return;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (child.type === 'code' && child.lang?.toLowerCase() === 'mermaid') {
      const mermaid = await loadMermaid();
      mermaidDiagramId += 1;
      const id = `oj-inject-mermaid-${mermaidDiagramId}`;
      const {svg} = await mermaid.render(id, child.value);
      node.children[index] = {type: 'html', value: svg};
      continue;
    }
    await renderMermaidDiagrams(child);
  }
}

function processOjRemoveDirectives(node, shouldRemove) {
  if (!Array.isArray(node.children)) return;

  node.children = node.children.flatMap((child) => {
    if (child.type === 'containerDirective' && child.name === 'oj-remove') {
      if (shouldRemove) return [];
      processOjRemoveDirectives(child, false);
      return child.children;
    }
    processOjRemoveDirectives(child, shouldRemove);
    return [child];
  });
}

function postProcessHtml(rawHtml, config, cssMap, highlightCss) {
  let html = rawHtml;
  const syntaxStyle = html.includes('class="hljs') ? `<style>${highlightCss}</style>` : '';

  const currentStyle = config.style || 'github-tweaked';
  if (currentStyle !== 'none') {
    const css = cssMap[currentStyle] || '';
    html = `<style>${css}</style>${syntaxStyle}<div class="markdown-body">\n${html}\n</div>`;
  } else {
    html = syntaxStyle + html;
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
</style>`;
    html = style + html;
  }

  return html;
}


function removalRanges(node, ranges = []) {
  if (node.type === 'containerDirective' && node.name === 'oj-remove') {
    ranges.push([node.position.start.offset, node.position.end.offset]);
  } else {
    for (const child of node.children || []) removalRanges(child, ranges);
  }
  return ranges;
}

export async function parseProblems(source, config, cssMap, highlightCss = '') {
  const parser = createParser(config);
  const tree = parser.runSync(parser.parse(source));
  const problems = [];
  let current;
  // Split before unwrapping containers: headings inside a container are body content.
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) {
      if (current) current.end = node.position.start.offset;
      current = {title: toString(node).trim(), start: node.position.start.offset, end: source.length, nodes: []};
      problems.push(current);
    } else if (current) {
      current.nodes.push(node);
    }
  }
  const results = [];
  for (const {title, start, end, nodes} of problems) {
    try {
      const content = {type: 'root', children: nodes};
      let original = source.slice(start, end);
      if (config.stripOjRemove) {
        for (const [from, to] of removalRanges(content).sort((a, b) => b[0] - a[0])) {
          original = original.slice(0, from - start) + original.slice(to - start);
        }
      }
      processOjRemoveDirectives(content, config.stripOjRemove);
      let params = {};
      const yamlIndex = content.children.findIndex(node => node.type === 'yaml');
      if (yamlIndex !== -1) {
        params = loadYaml(content.children[yamlIndex].value) ?? {};
        if (typeof params !== 'object' || Array.isArray(params)) {
          throw new Error('frontmatter 必须是键值对象');
        }
        content.children.splice(yamlIndex, 1);
      }
      await renderMermaidDiagrams(content);
      const html = String(htmlCompiler.stringify(htmlCompiler.runSync(content)));
      const finalHtml = postProcessHtml(html, config, cssMap, highlightCss);
      const {code} = await generateProblem({html: finalHtml, source: original, params: {...params, title}});
      results.push({title, finalHtml, code});
    } catch (error) {
      throw new Error('题目“' + title + '”：' + error.message, {cause: error});
    }
  }
  return results;
}
